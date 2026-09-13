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

// Ek "page load". Same idb instance dobara dene se window.location.reload()
// simulate hota hai: naya document, wahi IndexedDB database (real browser jaisa).
export function loadApp(opts = {}) {
    const { dialogs = {}, storageQuota = null, onReload = null, idb = null } = opts;
    const db = idb || newDB();

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
    return { dom, win, dialogLog, consoleErrors, reloads: () => reloads, idb: db };
}

// Page load + boot complete hone ka wait
export async function bootApp(opts) {
    const app = loadApp(opts);
    await settle(250);
    return app;
}

// App ke andar koi expression chalao (global let/const bindings eval se dikhte hain)
export const ev = (win, expr) => win.eval(expr);
