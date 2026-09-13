'use strict';

/* =========================================================================
 * Chandra ERP Billing — Desktop main process
 * 100% offline. Koi network call nahi. Saara data userData ke andar
 * Chromium IndexedDB (LevelDB) mein rehta hai — disk jitni free ho utni.
 *
 * Freeze/bug fixes (purani Electron app ki problems ke liye):
 *  - renderer kabhi background/suspend nahi hota (throttling off)
 *  - Windows occlusion detection off (background jaate hi jamna band)
 *  - render-process crash/gone par app khud reload/respawn karti hai
 *  - unresponsive par user ko safe Reload option milta hai
 *  - downloads ke liye native Save dialog; galat path par crash nahi
 *  - poori app ek hi stable custom origin (app://app) par chalti hai
 * ========================================================================= */

const {
    app, BrowserWindow, Menu, shell, session, dialog, protocol, ipcMain
} = require('electron');

const path = require('path');
const fs = require('fs');

const APP_SCHEME = 'app';
const APP_HOST = 'app';
const isDev = process.env.CHANDRA_DEV === '1' || process.env.NODE_ENV === 'development';
const isSmoke = process.env.CHANDRA_SMOKE === '1' || process.argv.includes('--smoke');

// __dirname yahan electron/ hai (main.jsc electron/ mein compile hota hai)
const APP_DIR = path.join(__dirname, '..', 'app');
const PRELOAD = path.join(__dirname, 'preload.js');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'desktop-settings.json');

// ---------- secure custom scheme (secure origin -> stable IndexedDB) -------
protocol.registerSchemesAsPrivileged([{
    scheme: APP_SCHEME,
    privileges: {
        standard: true,
        secure: true,
        corsEnabled: true,
        supportFetchAPI: true,
        stream: true,
        allowServiceWorkers: false,
        bypassCSP: false
    }
}]);

// ---------- Windows freeze fixes (process start se hi) ---------------------
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// Bade PDFs / lambi parsing ke dauraan stable frame rate
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.bak': 'application/octet-stream'
};

// Note: app ke inline <script> blocks aur inline onclick handlers ki wajah se
// script-src mein 'unsafe-inline' chahiye. Koi remote source kabhi load nahi
// hota (default/connect/object sab 'self'/'none'), isliye offline app safe hai.
const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'"
].join('; ');

let mainWindow = null;
let unresponsiveTimer = null;

function log(...args) {
    const line = `[${new Date().toISOString()}] ${args.map(a => {
        try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); }
    }).join(' ')}\n`;
    process.stdout.write(line);
    try {
        const logDir = path.join(app.getPath('userData'), 'logs');
        fs.mkdirSync(logDir, { recursive: true });
        const logPath = path.join(logDir, 'main.log');
        let size = 0;
        try { size = fs.statSync(logPath).size; } catch { /* new file */ }
        if (size > 2 * 1024 * 1024) {
            try { fs.renameSync(logPath, path.join(logDir, 'main-prev.log')); } catch { /* ignore */ }
        }
        fs.appendFileSync(logPath, line);
    } catch { /* logging best effort */ }
}

function readSettings() {
    try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; }
}
function writeSettings(s) {
    try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2)); } catch (e) { log('settings write failed', e.message); }
}

// ---------- app:// protocol: files asar ke andar se, bina network ----------
function registerAppProtocol() {
    protocol.handle(APP_SCHEME, async (request) => {
        let filePath;
        try {
            const u = new URL(request.url);
            const raw = u.pathname === '/' ? '/index.html' : u.pathname;
            const decoded = decodeURIComponent(raw);
            filePath = path.normalize(path.join(APP_DIR, decoded));
            if (!filePath.startsWith(APP_DIR + path.sep) && filePath !== path.join(APP_DIR, 'index.html')) {
                return new Response('Forbidden', { status: 403 });
            }
            let stat;
            try { stat = fs.statSync(filePath); } catch { stat = null; }
            if (!stat) {
                // SPA-style fallback (favicon etc. ko 404 ke bajaye index)
                if (decoded.endsWith('.ico')) return new Response(null, { status: 204 });
                filePath = path.join(APP_DIR, 'index.html');
            } else if (stat.isDirectory()) {
                filePath = path.join(filePath, 'index.html');
            }
            const data = fs.readFileSync(filePath); // Electron fs asar paths read kar leta hai
            const ext = path.extname(filePath).toLowerCase();
            const headers = {
                'content-type': MIME[ext] || 'application/octet-stream',
                'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
            };
            return new Response(new Uint8Array(data), { status: 200, headers });
        } catch (e) {
            log('protocol handler error', request.url, e && e.message);
            return new Response('Not found', { status: 404 });
        }
    });
}

// ---------- session hardening + unlimited persistent storage --------------
function configureSession() {
    const ses = session.defaultSession;

    // Storage permission hamesha grant — koi prompt nahi, data persistent
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
        callback(permission === 'persistent-storage' ||
                 permission === 'clipboard-read' ||
                 permission === 'clipboard-sanitized-write' ||
                 permission === 'clipboard-write');
    });
    ses.setPermissionCheckHandler((_wc, permission) => {
        return permission === 'persistent-storage' ||
               permission === 'clipboard-read' ||
               permission === 'clipboard-sanitized-write' ||
               permission === 'clipboard-write';
    });

    // Strict CSP — koi bhi online resource load nahi ho sakta
    ses.webRequest.onHeadersReceived((details, callback) => {
        const headers = { ...(details.responseHeaders || {}) };
        headers['Content-Security-Policy'] = [CSP];
        headers['X-Content-Type-Options'] = ['nosniff'];
        callback({ responseHeaders: headers });
    });

    // Download (backup .bak / result .txt) ke liye Save As dialog
    ses.on('will-download', (event, item) => {
        event.preventDefault();
        const settings = readSettings();
        const suggested = item.getFilename() || 'download.bin';
        const ext = path.extname(suggested).toLowerCase();
        const filters = [];
        if (ext === '.bak') filters.push({ name: 'Backup File', extensions: ['bak'] });
        else if (ext === '.txt') filters.push({ name: 'Text Document', extensions: ['txt'] });
        filters.push({ name: 'All Files', extensions: ['*'] });

        dialog.showSaveDialog(mainWindow, {
            title: 'Save File — Chandra ERP',
            defaultPath: path.join(settings.lastDownloadDir || app.getPath('downloads'), suggested),
            filters
        }).then((res) => {
            if (res.canceled || !res.filePath) {
                item.cancel();
                return;
            }
            try {
                writeSettings({ ...settings, lastDownloadDir: path.dirname(res.filePath) });
                item.setSavePath(res.filePath);
                item.once('done', (_e, state) => {
                    log('download', state, res.filePath);
                    if (state === 'interrupted') {
                        dialog.showMessageBox(mainWindow, {
                            type: 'error',
                            title: 'Download Failed',
                            message: 'File save nahi ho payi. Dobara try karein.'
                        });
                    }
                });
                item.resume();
            } catch (e) {
                log('download start failed', e && e.message);
                item.cancel();
            }
        }).catch((e) => { log('save dialog error', e && e.message); item.cancel(); });
    });
}

// ---------- CI smoke test --------------------------------------------------
function wireSmoke(win) {
    const hardTimeout = setTimeout(() => { log('SMOKE_FAIL: timeout'); app.exit(3); }, 60000);
    let ran = false;
    win.webContents.on('did-finish-load', () => {
        setTimeout(async () => {
            if (ran) return;
            ran = true;
            try {
                const r = await win.webContents.executeJavaScript(`(async () => {
                    await new Promise((res) => setTimeout(res, 2500));
                    const errs = (window.CHANDRA_DESKTOP && CHANDRA_DESKTOP.getErrors) ? CHANDRA_DESKTOP.getErrors() : [];
                    return {
                        title: document.title,
                        mode: (window.Store && Store.mode) || null,
                        hasPdf: !!window.pdfjsLib,
                        companies: window.companyList || null,
                        bodyLen: document.body ? document.body.innerHTML.length : 0,
                        errs
                    };
                })()`, true);
                log('SMOKE_RESULT ' + JSON.stringify(r));
                const ok = r && r.mode === 'idb' && r.hasPdf === true &&
                    Array.isArray(r.companies) && r.companies.length > 0 &&
                    r.bodyLen > 5000 && (!r.errs || r.errs.length === 0);
                clearTimeout(hardTimeout);
                app.exit(ok ? 0 : 2);
            } catch (e) {
                log('SMOKE_FAIL: evaluate', e && e.stack || e);
                clearTimeout(hardTimeout);
                app.exit(2);
            }
        }, 3500);
    });
}

// ---------- window ---------------------------------------------------------
function loadWindowState() {
    try {
        return Object.assign({ width: 1440, height: 900 }, readSettings().windowState || {});
    } catch { return { width: 1440, height: 900 }; }
}
function saveWindowState(win) {
    if (!win || win.isDestroyed()) return;
    try {
        const b = win.getBounds();
        const s = readSettings();
        s.windowState = { ...b, maximized: win.isMaximized() };
        writeSettings(s);
    } catch { /* ignore */ }
}

function createWindow() {
    const st = loadWindowState();
    const win = new BrowserWindow({
        width: st.width,
        height: st.height,
        x: st.x,
        y: st.y,
        minWidth: 960,
        minHeight: 640,
        show: false,
        title: 'Chandra ERP Billing',
        backgroundColor: '#1a2a6c',
        icon: path.join(__dirname, '..', 'build', 'icon.ico'),
        autoHideMenuBar: false,
        webPreferences: {
            preload: PRELOAD,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            spellcheck: false,
            backgroundThrottling: false,
            devTools: isDev,
            additionalArguments: [`--app-version=${app.getVersion()}`, `--app-dev=${isDev ? '1' : '0'}`]
        }
    });

    if (st.maximized) win.maximize();

    win.once('ready-to-show', () => { if (!isSmoke) win.show(); });
    win.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);

    if (isSmoke) wireSmoke(win);

    // Koi bhi bahar navigation / popup block — app single-page hai
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/i.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });

    // Jamne par safe recovery
    win.webContents.on('unresponsive', () => {
        log('renderer unresponsive');
        if (isSmoke) { log('SMOKE_FAIL: unresponsive'); app.exit(5); return; }
        clearTimeout(unresponsiveTimer);
        unresponsiveTimer = setTimeout(() => {
            if (win.isDestroyed()) return;
            dialog.showMessageBox(win, {
                type: 'warning',
                title: 'App Respond Nahi Kar Rahi',
                message: 'Screen thodi der se respond nahi kar rahi.',
                detail: 'Reload karein? Aapka data IndexedDB mein safe hai (reload se saved data nahi jaata).',
                buttons: ['Wait', 'Reload App'],
                defaultId: 1,
                cancelId: 0
            }).then((r) => { if (r.response === 1 && !win.isDestroyed()) win.webContents.forceReload(); })
                .catch(() => {});
        }, 20000);
    });
    win.webContents.on('responsive', () => { clearTimeout(unresponsiveTimer); });

    win.webContents.on('render-process-gone', (_e, details) => {
        log('render-process-gone', details && details.reason);
        if (details && details.reason === 'clean-exit') return;
        if (isSmoke) { log('SMOKE_FAIL: render-process-gone', details && details.reason); app.exit(4); return; }
        dialog.showErrorBox(
            'Chandra ERP Dobara Khul Rahi Hai',
            'Ek technical issue ke baad app automatically reload ho rahi hai. Aapka saved data safe hai.'
        );
        if (!win.isDestroyed()) win.webContents.forceReload();
    });

    win.webContents.on('did-fail-load', (_e, code, desc, validatedURL, isMainFrame) => {
        if (isMainFrame && code !== -3) { // -3 = aborted by user
            log('did-fail-load', code, desc, validatedURL);
            if (isSmoke) { log('SMOKE_FAIL: did-fail-load', code, desc); app.exit(6); return; }
            setTimeout(() => { if (!win.isDestroyed()) win.webContents.forceReload(); }, 1000);
        }
    });

    const onClose = () => saveWindowState(win);
    win.on('close', onClose);

    return win;
}

// ---------- menu -----------------------------------------------------------
function buildMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Open Downloads Folder',
                    click: () => shell.openPath(app.getPath('downloads'))
                },
                {
                    label: 'Open App Data Folder (Database)',
                    click: () => shell.openPath(app.getPath('userData'))
                },
                { type: 'separator' },
                { role: 'quit', label: 'Exit' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow && mainWindow.webContents.reload() },
                { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => mainWindow && mainWindow.webContents.forceReload() },
                { type: 'separator' },
                { role: 'resetZoom', label: 'Actual Size' },
                { role: 'zoomIn', label: 'Zoom In' },
                { role: 'zoomOut', label: 'Zoom Out' },
                { type: 'separator' },
                { role: 'togglefullscreen', label: 'Full Screen' },
                { role: 'minimize', label: 'Minimize' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About Chandra ERP',
                    click: () => dialog.showMessageBox(mainWindow, {
                        type: 'info',
                        title: 'About',
                        icon: path.join(__dirname, '..', 'build', 'icon.ico'),
                        message: 'Chandra ERP Billing',
                        detail: [
                            `Version: ${app.getVersion()} (offline desktop)`,
                            'Owner: Prop. Amit Chandra',
                            '',
                            'Poora data is laptop ke andar rehta hai (IndexedDB).',
                            'Koi internet / online database use nahi hota.',
                            '',
                            `Data folder: ${app.getPath('userData')}`,
                            'Backup: app ke Tools menu > BACKUP & RESTORE.'
                        ].join('\n')
                    })
                },
                {
                    label: 'Backup Guide (Offline)',
                    click: () => dialog.showMessageBox(mainWindow, {
                        type: 'info',
                        title: 'Backup Guide',
                        message: 'Data Safe Kaise Rakhein',
                        detail: [
                            '1. Har hafta Tools > BACKUP & RESTORE se EXPORT lein.',
                            '2. .bak file ko pendrive/email/cloud par copy kar lein.',
                            '3. Naya laptop ho to wahi .bak file RESTORE kar dein.',
                            '4. App uninstall karne par bhi data delete nahi hota.'
                        ].join('\n')
                    })
                }
            ]
        }
    ];

    if (isDev) {
        template.push({
            label: 'Developer',
            submenu: [
                { role: 'toggleDevTools' },
                { role: 'reload' },
                { role: 'forceReload' }
            ]
        });
    }

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- app lifecycle --------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.setAppUserModelId('com.chandra.erp.billing');

    app.whenReady().then(() => {
        log('app ready, version', app.getVersion(), 'dev=', isDev);
        registerAppProtocol();
        configureSession();
        buildMenu();
        mainWindow = createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
        });
    });

    app.on('window-all-closed', () => {
        clearTimeout(unresponsiveTimer);
        app.quit();
    });

    process.on('uncaughtException', (e) => log('uncaughtException', e && e.stack || e));
    process.on('unhandledRejection', (e) => log('unhandledRejection', e && e.stack || e));
}
