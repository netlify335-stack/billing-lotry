/**
 * =====================================================================
 * Chandra ERP — ELECTRON MAIN PROCESS (Windows desktop app)
 * =====================================================================
 * 100% OFFLINE desktop app:
 *   * Koi internet request nahi — saare http(s) requests network level
 *     par hi BLOCK kar diye jaate hain (session.webRequest).
 *   * Data hard disk ki SQLite file mein: %APPDATA%\ChandraERP\chandra-erp.db
 *   * Downloads (backup .bak / bill .txt) par native "Save As" dialog.
 *   * Window band karte waqt pending writes flush hote hain (data-loss safe).
 *   * Single-instance lock — ek hi waqt mein ek hi app (DB safe rehta hai).
 *
 * Renderer wahi purana index.html hai — UI/features bilkul same.
 */
'use strict';

const { app, BrowserWindow, ipcMain, dialog, session, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { ErpDatabase } = require('./db');

// ---------------------------------------------------------------------------
// DATA LOCATION (app ready se PEHLE fix karna zaroori hai)
// Windows: C:\Users\<YOU>\AppData\Roaming\ChandraERP\
// Yeh path productName/version badalne par bhi SAME rehta hai — data kabhi
// "kho" nahi jaata. Uninstall par bhi data delete nahi hota.
// ---------------------------------------------------------------------------
const USER_DATA_DIR = path.join(app.getPath('appData'), 'ChandraERP');
app.setPath('userData', USER_DATA_DIR);

// Ek waqt mein ek hi instance — dobara icon dabane par wahi window aage aati hai.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {

let mainWindow = null;
let erpDb = null;

/** SQLite DB lazily kholo (pehli IPC call ya app ready par). */
function getDb() {
    if (!erpDb) erpDb = new ErpDatabase(ErpDatabase.defaultPath(USER_DATA_DIR));
    return erpDb;
}

// ---------------------------------------------------------------------------
// IPC HANDLERS — renderer ka desktopAPI.db isi se baat karta hai.
// Har handler input validate karta hai (renderer compromised ho tab bhi safe).
// ---------------------------------------------------------------------------
ipcMain.handle('db:loadAll', () => {
    return getDb().loadAll();
});

ipcMain.handle('db:get', (_e, key) => {
    if (typeof key !== 'string' || key.length === 0 || key.length > 2000) return null;
    return getDb().get(key);
});

ipcMain.handle('db:writeBatch', (_e, entries) => {
    if (!Array.isArray(entries) || entries.length === 0) return { ok: true, count: 0 };
    if (entries.length > 100000) throw new Error('writeBatch: bahut bada batch');
    // Sanitize: sirf [string, string|null] pairs
    const clean = entries
        .filter(en => Array.isArray(en) && typeof en[0] === 'string')
        .map(en => [en[0].slice(0, 2000), (en[1] === null || en[1] === undefined) ? null : String(en[1])]);
    return getDb().writeBatch(clean);
});

ipcMain.handle('db:diskInfo', () => {
    return getDb().diskInfo();
});

ipcMain.handle('db:path', () => {
    return getDb().dbPath;
});

// ---------------------------------------------------------------------------
// WINDOW
// ---------------------------------------------------------------------------
function createWindow() {
    // Dev icon (packaged app mein exe ka icon Windows khud use karta hai)
    let iconPath = path.join(__dirname, '..', 'build', 'icon.png');
    if (!fs.existsSync(iconPath)) iconPath = undefined;

    mainWindow = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 1024,
        minHeight: 700,
        show: false,                 // ready-to-show par dikhayein — flash nahi
        autoHideMenuBar: true,       // Alt dabane par menu dikhta hai (standard Windows UX)
        icon: iconPath,
        backgroundColor: '#f0f2f5',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,  // SECURITY: renderer Node se alag
            nodeIntegration: false,  // SECURITY: page mein require() nahi
            sandbox: true,           // SECURITY: renderer Chromium sandbox mein
            spellcheck: false,       // offline — koi spellcheck service nahi
            webSecurity: true
        }
    });

    // Wahi purana single-file app load karo — UI pixel-perfect same.
    mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

    mainWindow.once('ready-to-show', () => mainWindow.show());

    // ---- OFFLINE GUARANTEE ------------------------------------------------
    // Koi bhi http/https request (page se ya kisi script se) network par
    // jaane se PEHLE cancel. App mein ab koi remote resource hai hi nahi
    // (pdf.js vendor/ mein local hai) — yeh belt-and-suspenders hai.
    mainWindow.webContents.session.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*'] },
        (_details, callback) => callback({ cancel: true })
    );

    // Naye window popups band; external links (kabhi aayein to) OS browser mein.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
        return { action: 'deny' };
    });

    // Page ko app ki file chhod kar kahin aur navigate nahi karne denge.
    // (window.location.reload() allowed — company switch/restore isi se hota hai.)
    const appFileUrl = 'file://' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');
    mainWindow.webContents.on('will-navigate', (e, url) => {
        const isSelf = url === appFileUrl || url.startsWith(appFileUrl + '?') || url.startsWith(appFileUrl + '#');
        if (!isSelf) e.preventDefault();
    });

    // ---- DOWNLOADS: backup (.bak), bills (.txt) ----------------------------
    // Web version mein browser Downloads folder mein file daalta tha.
    // Desktop par native "Save As" dialog — non-technical user ko saaf dikhta
    // hai ki file kahan ja rahi hai.
    mainWindow.webContents.session.on('will-download', (_event, item) => {
        const suggested = item.getFilename() || 'download.txt';
        const savePath = dialog.showSaveDialogSync(mainWindow, {
            title: 'Save File',
            defaultPath: path.join(app.getPath('documents'), suggested),
            filters: [
                { name: 'All Files', extensions: ['*'] },
                { name: 'Backup / Text', extensions: ['bak', 'json', 'txt'] }
            ]
        });
        if (savePath) item.setSavePath(savePath);
        else item.cancel();
    });

    // ---- SAFE CLOSE: pending SQLite writes pehle flush, phir band -----------
    let forceClose = false;
    let closeTimer = null;
    mainWindow.on('close', (e) => {
        if (forceClose) return;              // flush ho chuka — ab band hone do
        e.preventDefault();
        // Renderer ko flush ka chance; 2.5s mein reply na aaye to zabardasti band
        // (SQLite WAL ki wajah se committed data waise bhi safe rehta hai).
        closeTimer = setTimeout(() => { forceClose = true; mainWindow.close(); }, 2500);
        try { mainWindow.webContents.send('app:before-close'); }
        catch (err) { forceClose = true; clearTimeout(closeTimer); mainWindow.close(); }
    });
    ipcMain.on('app:flush-done', () => {
        if (!mainWindow) return;
        forceClose = true;
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        try { mainWindow.close(); } catch (e) {}
    });

    mainWindow.on('closed', () => { mainWindow = null; });

    // Debugging sirf dev env mein (source se chalate waqt / CHANDRA_DEV=1).
    // Packaged app (jo end users install karte hain) mein DevTools kabhi nahi khulta.
    if (!app.isPackaged || process.env.CHANDRA_DEV === '1') {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
}

// ---------------------------------------------------------------------------
// MENU — sirf standard Edit shortcuts (Ctrl+C/V/X/Z). Auto-hide rehta hai,
// Alt dabane par dikhta hai. Koi "reload/devtools" end-user ke liye nahi.
// ---------------------------------------------------------------------------
function buildMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                { role: 'quit', label: 'Exit' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo', label: 'Undo' },
                { role: 'redo', label: 'Redo' },
                { type: 'separator' },
                { role: 'cut', label: 'Cut' },
                { role: 'copy', label: 'Copy' },
                { role: 'paste', label: 'Paste' },
                { role: 'selectAll', label: 'Select All' }
            ]
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// APP LIFECYCLE
// ---------------------------------------------------------------------------
app.on('second-instance', () => {
    // User ne dobara icon dabaya — purani window aage laao
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

app.whenReady().then(() => {
    buildMenu();
    getDb();            // DB pehle hi khul jaaye — first paint tak ready
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    app.quit();         // Windows par: saari windows band = app band
});

app.on('before-quit', () => {
    if (erpDb) { erpDb.close(); erpDb = null; }
});

} // end single-instance lock
