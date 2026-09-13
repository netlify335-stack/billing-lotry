// =====================================================================
// Test harness — index.html ko REAL browser-jaise environment (jsdom) mein
// load karta hai aur REAL IndexedDB API (fake-indexeddb) deta hai.
// App ka APNA code chalta hai — koi re-implemented / fake logic nahi.
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

export const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));

export function newDB() { return new IDBFactory(); }

// DESKTOP APP: SQLite database file ka simulation — ek Map jo "disk" hai.
// Same Map dobara bootApp ko dene se app-restart/reload simulate hota hai
// (data disk par bacha rehta hai, bilkul real chandra-erp.db jaisa).
export function newDesktopDB(seed = {}) { return new Map(Object.entries(seed)); }

// Ek "page load". Same idb instance dobara dene se window.location.reload()
// simulate hota hai: naya document, wahi IndexedDB database (real browser jaisa).
// opts.desktop (Map) dene par DESKTOP APP mode: preload jaisa window.desktopAPI
// inject hota hai aur Store engine SQLite backend use karta hai.
export function loadApp(opts = {}) {
    const { dialogs = {}, storageQuota = null, onReload = null, idb = null, desktop = null } = opts;
    const db = idb || newDB();
    const desktopKV = desktop || null;

    const virtualConsole = new VirtualConsole();
    const consoleErrors = [];
    const dialogLog = [];
    let reloads = 0;

    virtualConsole.on('jsdomError', (e) => {
        const msg = String(e && (e.message || e));
        // jsdom real navigation support nahi karta — reload() isi se detect hota hai
        if (/not implemented: navigation/i.test(msg)) { reloads++; if (onReload) onReload(); return; }
        consoleErrors.push(msg);
    });
    virtualConsole.on('error', (...a) => consoleErrors.push(a.map(String).join(' ')));

    const dom = new JSDOM(HTML, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'http://localhost:3000/index.html',
        virtualConsole,
        beforeParse(window) {
            window.indexedDB = db;
            window.IDBKeyRange = IDBKeyRange;

            // ---- DESKTOP APP MODE: Electron preload ka window.desktopAPI ----
            // Real app mein yeh bridge IPC se main-process ke better-sqlite3
            // database tak jaata hai; yahan usi contract ki in-memory "disk" hai.
            if (desktopKV) {
                let closeHandler = null;
                let writeCalls = 0;
                window.desktopAPI = {
                    isDesktop: true,
                    versions: () => ({ electron: 'test', node: process.version, chrome: 'test' }),
                    db: {
                        loadAll: async () => Array.from(desktopKV.entries()),
                        get: async (k) => (desktopKV.has(String(k)) ? desktopKV.get(String(k)) : null),
                        writeBatch: async (entries) => {
                            if (!Array.isArray(entries)) throw new Error('entries array chahiye');
                            writeCalls++;
                            for (const en of entries) {
                                if (!Array.isArray(en)) continue;
                                const k = String(en[0]);
                                const v = en[1];
                                if (v === null || v === undefined) desktopKV.delete(k);
                                else desktopKV.set(k, String(v));
                            }
                            return { ok: true, count: entries.length };
                        },
                        diskInfo: async () => ({ usage: 2 * 1048576, quota: 500 * 1073741824, desktop: true }),
                        dbPath: async () => '/fake/AppData/Roaming/ChandraERP/chandra-erp.db'
                    },
                    onBeforeClose: (h) => { closeHandler = h; },
                    // test helpers
                    __writeCalls: () => writeCalls,
                    __hasCloseHandler: () => !!closeHandler
                };
                // main.js ka safe-close protocol: 'app:before-close' -> flush -> done
                window.__closeWindow = async () => { if (closeHandler) await closeHandler(); };
            }

            window.alert = (m) => { dialogLog.push(['alert', String(m)]); if (dialogs.alert) dialogs.alert(String(m)); };
            window.confirm = (m) => { dialogLog.push(['confirm', String(m)]); return dialogs.confirm ? dialogs.confirm(String(m)) : true; };
            window.prompt = (m, d) => { dialogLog.push(['prompt', String(m)]); return dialogs.prompt ? dialogs.prompt(String(m), d) : (d ?? null); };
            if (storageQuota) {
                Object.defineProperty(window.navigator, 'storage', {
                    configurable: true,
                    value: {
                        estimate: async () => storageQuota,
                        persist: async () => storageQuota.persisted !== false,
                        persisted: async () => storageQuota.persisted === true
                    }
                });
            }
            window.scrollTo = () => {};
            window.Element.prototype.scrollIntoView = function () {};
            window.print = () => {};
            window.__blobs = [];
            window.URL.createObjectURL = (b) => { window.__blobs.push(b); return 'blob:mock'; };
            window.URL.revokeObjectURL = () => {};
            window.HTMLAnchorElement.prototype.click = function () {
                dialogLog.push(['download', this.download || '(no name)']);
            };
        }
    });

    const win = dom.window;
    win.__dialogLog = dialogLog;
    win.__consoleErrors = consoleErrors;
    win.__reloads = () => reloads;
    win.__db = db;
    return { dom, win, dialogLog, consoleErrors, reloads: () => reloads, idb: db, desktop: desktopKV };
}

// Page load + boot complete hone ka wait
export async function bootApp(opts) {
    const app = loadApp(opts);
    await settle(250);
    return app;
}

// App ke andar koi expression chalao (global let/const bindings eval se dikhte hain)
export const ev = (win, expr) => win.eval(expr);
