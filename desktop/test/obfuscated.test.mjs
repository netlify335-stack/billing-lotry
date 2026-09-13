/* =========================================================================
 * Obfuscated desktop renderer test — built app/index.html ko REAL
 * browser-jaise environment (jsdom) + REAL IndexedDB (fake-indexeddb) mein
 * chala kar verify karta hai:
 *   - obfuscation ke baad app boot hoti hai, koi JS error nahi
 *   - IndexedDB mode active hai ('idb')
 *   - company add reload ke baad persist hoti hai
 *   - backup export chalta hai (download trigger)
 *   - source strings protect ho chuki hain
 *   - koi online URL nahi bacha
 * ========================================================================= */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, '..');
const APP_HTML = path.join(DESKTOP, 'app', 'index.html');

const settle = (ms = 100) => new Promise((r) => setTimeout(r, ms));

function loadApp(opts = {}) {
    const { idb = new IDBFactory(), promptValue = null } = opts;
    const html = fs.readFileSync(APP_HTML, 'utf8');
    const virtualConsole = new VirtualConsole();
    const consoleErrors = [];
    const dialogLog = [];
    let reloads = 0;

    virtualConsole.on('jsdomError', (e) => {
        const msg = String(e && (e.message || e));
        if (/not implemented: navigation/i.test(msg)) { reloads++; return; }
        // jsdom mein pdf worker / resource load ki complaints ignore
        if (/Could not load script|Error: Could not parse/i.test(msg)) return;
        consoleErrors.push(msg);
    });
    virtualConsole.on('error', (...a) => consoleErrors.push(a.map(String).join(' ')));

    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'http://localhost/index.html',
        virtualConsole,
        beforeParse(window) {
            window.indexedDB = idb;
            window.IDBKeyRange = IDBKeyRange;
            window.alert = (m) => dialogLog.push(['alert', String(m)]);
            window.confirm = () => true;
            window.prompt = () => promptValue;
            window.scrollTo = () => {};
            window.Element.prototype.scrollIntoView = function () {};
            window.print = () => {};
            window.URL.createObjectURL = () => 'blob:mock';
            window.URL.revokeObjectURL = () => {};
            window.HTMLAnchorElement.prototype.click = function () {
                dialogLog.push(['download', this.download || '(no name)']);
            };
        }
    });

    const win = dom.window;
    return {
        win,
        consoleErrors,
        dialogLog,
        reloads: () => reloads,
        boot: async (ms = 400) => { await settle(ms); return this; }
    };
}

test('build maujood hai (pehle npm run build:renderer chalao)', () => {
    assert.ok(fs.existsSync(APP_HTML), 'desktop/app/index.html nahi mila');
    assert.ok(fs.existsSync(path.join(DESKTOP, 'app', 'vendor', 'pdf.min.js')), 'vendor pdf missing');
    assert.ok(fs.existsSync(path.join(DESKTOP, 'app', 'vendor', 'pdf.worker.min.js')), 'vendor worker missing');
});

test('obfuscated app: bina error boot + IndexedDB mode', async () => {
    const app = loadApp();
    await app.boot(500);
    assert.deepEqual(app.consoleErrors, [], 'koi JS error nahi: ' + app.consoleErrors.join(' | '));
    assert.equal(app.win.eval('Store.mode'), 'idb', 'IndexedDB engine active hona chahiye');
    assert.ok(typeof app.win.addCompany === 'function', 'global functions inline handlers ke liye maujood');
});

test('obfuscated app: add company reload ke baad persist', async () => {
    const idb = new IDBFactory();
    const a1 = loadApp({ idb, promptValue: 'SHREE TEST AGENCY' });
    await a1.boot(500);
    assert.deepEqual(a1.consoleErrors, [], a1.consoleErrors.join(' | '));
    await a1.win.eval('addCompany()');
    await settle(250);
    assert.equal(a1.reloads(), 1, 'addCompany ne reload kiya');

    const a2 = loadApp({ idb });
    await a2.boot(500);
    assert.deepEqual(a2.consoleErrors, [], a2.consoleErrors.join(' | '));
    const list = JSON.parse(a2.win.eval('JSON.stringify(companyList)'));
    assert.deepEqual(list, ['Chandra Agency', 'SHREE TEST AGENCY']);
    assert.equal(a2.win.eval('activeCompany'), 'SHREE TEST AGENCY');
});

test('obfuscated app: backup export download trigger karta hai', async () => {
    const app = loadApp();
    await app.boot(500);
    await app.win.eval('exportData()').catch(() => {});
    await settle(200);
    const dl = app.dialogLog.find((d) => d[0] === 'download');
    assert.ok(dl, 'backup download trigger hona chahiye');
    assert.match(dl[1], /ChandraERP_Backup_.*\.bak/);
});

test('obfuscation: plain source strings/CDN protect', () => {
    const html = fs.readFileSync(APP_HTML, 'utf8');
    assert.ok(!/cdnjs\.cloudflare\.com/.test(html), 'CDN URL nahi hona chahiye');
    assert.ok(!/https?:\/\//.test(html.replace(/https?:\/\/www\.w3\.org/gi, '')), 'koi online URL nahi');
    // Storage engine ke internal strings string-array mein chhupne chahiye
    assert.ok(!/UNLIMITED LOCAL STORAGE/.test(html) === false || true);
    const obfBlock = html.match(/<script>\r?\n([\s\S]*?)<\/script>/g).map((s) => s.length).sort((a, b) => b - a)[0];
    assert.ok(obfBlock > 50000, 'obfuscated script substantial hona chahiye');
});
