// =====================================================================
// DESKTOP APP TESTS — index.html Electron-style environment mein:
// window.desktopAPI (preload bridge) ke saath Store engine 'sqlite' mode
// mein chalta hai aur data "hard disk" (Map) par commit hota hai.
//
// Verify hota hai:
//   * SQLite engine boot + persistence (restart ke baad data wahi)
//   * Company add/switch/rename/delete — durable, restart-safe
//   * Entry save — disk DB tak round-trip
//   * BACKUP export + RESTORE (replace / merge / corrupt) — desktop par
//   * STORAGE STATUS desktop wording + disk estimate
//   * Safe-close flush (window band karte waqt pending writes commit)
//   * OFFLINE guarantee: HTML mein koi external http(s) resource nahi,
//     pdf.js local vendor/ mein maujood
//   * Packaging config sanity (nsis one-click, shortcuts, files list)
// =====================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bootApp, ev, settle, newDesktopDB } from './harness.mjs';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');

// ---------------------------------------------------------------------------
// 1. BOOT: desktop par SQLite engine, permanent storage
// ---------------------------------------------------------------------------
test('DESKTOP BOOT: Store.mode sqlite hai, data disk DB se load hota hai', async () => {
    const disk = newDesktopDB({
        'erp_global_companies': JSON.stringify(['Chandra Agency', 'DESKTOP CO']),
        'erp_global_active': 'DESKTOP CO',
        'erp_DESKTOP CO_debtors': JSON.stringify(['SAVED PARTY'])
    });
    const app = await bootApp({ desktop: disk });
    assert.deepEqual(app.consoleErrors, [], 'boot par errors nahi: ' + app.consoleErrors.join(' | '));
    assert.equal(ev(app.win, 'Store.mode'), 'sqlite', 'desktop par sqlite engine chahiye');
    assert.equal(ev(app.win, 'Store.persisted'), true, 'desktop data hamesha permanent hai');
    assert.deepEqual(JSON.parse(ev(app.win, 'JSON.stringify(companyList)')), ['Chandra Agency', 'DESKTOP CO']);
    assert.equal(ev(app.win, 'activeCompany'), 'DESKTOP CO');
    assert.deepEqual(JSON.parse(ev(app.win, 'JSON.stringify(debtors)')), ['SAVED PARTY'],
        'disk DB se parties load honi chahiye');
    assert.match(ev(app.win, 'Store.engineLabel()'), /SQLITE/);
});

// ---------------------------------------------------------------------------
// 2. COMPANY ADD — durable write + app restart ke baad bhi maujood
// ---------------------------------------------------------------------------
test('DESKTOP COMPANY ADD: restart ke baad nayi company disk DB mein bachti hai', async () => {
    const disk = newDesktopDB();
    const app = await bootApp({ desktop: disk, dialogs: { prompt: () => 'NAYI DESKTOP CO' } });
    await app.win.eval('addCompany()');
    await settle(200);
    assert.equal(app.reloads(), 1, 'addCompany ne reload trigger kiya');

    // disk par commit verify — Map (SQLite file simulation) mein key honi chahiye
    const companies = JSON.parse(disk.get('erp_global_companies'));
    assert.deepEqual(companies, ['Chandra Agency', 'NAYI DESKTOP CO']);
    assert.equal(disk.get('erp_global_active'), 'NAYI DESKTOP CO');

    // ---- APP RESTART simulate: naya boot, wahi disk ----
    const after = await bootApp({ desktop: disk });
    assert.equal(ev(after.win, 'activeCompany'), 'NAYI DESKTOP CO');
    assert.match(after.win.document.getElementById('companySelect').innerHTML, /NAYI DESKTOP CO/);
});

test('DESKTOP COMPANY SWITCH: restart ke baad wahi company active', async () => {
    const disk = newDesktopDB({
        'erp_global_companies': JSON.stringify(['Chandra Agency', 'OTHER CO']),
        'erp_global_active': 'OTHER CO'
    });
    const app = await bootApp({ desktop: disk });
    const sel = app.win.document.getElementById('companySelect');
    sel.value = 'Chandra Agency';
    await app.win.eval('switchCompany()');
    await settle(200);
    assert.equal(app.reloads(), 1);

    const after = await bootApp({ desktop: disk });
    assert.equal(ev(after.win, 'activeCompany'), 'Chandra Agency');
});

test('DESKTOP COMPANY RENAME: data naye naam par disk DB mein migrate', async () => {
    const disk = newDesktopDB();
    const app = await bootApp({ desktop: disk, dialogs: { prompt: () => 'PURANI CO' } });
    await app.win.eval('addCompany()');
    await settle(150);

    const a2 = await bootApp({ desktop: disk, dialogs: { prompt: () => 'NAYI CO' } });
    await a2.win.eval(`debtors = ['RENAME PARTY']; safeLSSet(lKey('debtors'), JSON.stringify(debtors)); Store.flush();`);
    await settle(150);
    await a2.win.eval('renameCompany(1)');
    await settle(250);

    assert.equal(disk.get('erp_NAYI CO_debtors'), '["RENAME PARTY"]', 'data naye naam par disk mein hona chahiye');
    assert.equal(disk.get('erp_PURANI CO_debtors'), undefined, 'purani keys disk se hat jaani chahiye');
    const a3 = await bootApp({ desktop: disk });
    assert.deepEqual(JSON.parse(ev(a3.win, 'JSON.stringify(companyList)')), ['Chandra Agency', 'NAYI CO']);
});

test('DESKTOP COMPANY DELETE: company + data disk se hat jaata hai', async () => {
    const disk = newDesktopDB();
    const app = await bootApp({ desktop: disk, dialogs: { prompt: () => 'HATANE WALI CO' } });
    await app.win.eval('addCompany()');
    await settle(150);

    const a2 = await bootApp({ desktop: disk });
    await a2.win.eval(`debtors = ['DEL PARTY']; safeLSSet(lKey('debtors'), JSON.stringify(debtors)); Store.flush();`);
    await settle(150);
    await a2.win.eval('deleteCompany(1)');
    await settle(300);

    assert.deepEqual(JSON.parse(disk.get('erp_global_companies')), ['Chandra Agency']);
    assert.equal(disk.get('erp_HATANE WALI CO_debtors'), undefined, 'deleted company ka data disk se hat jaaye');
});

// ---------------------------------------------------------------------------
// 3. ENTRY SAVE — grid data SQLite disk DB tak round-trip
// ---------------------------------------------------------------------------
test('DESKTOP ENTRY SAVE: grid data disk DB mein commit + restart ke baad wapas', async () => {
    const disk = newDesktopDB();
    const app = await bootApp({ desktop: disk });
    await app.win.eval(`
        debtors = ['PARTY Z']; safeLSSet(lKey('debtors'), JSON.stringify(debtors));
        currentSession = '1 PM';
    `);
    app.win.eval('updateDebtorDropdown()');
    await settle(60);
    app.win.document.getElementById('debtorSelect').value = 'PARTY Z';
    await app.win.eval(`
        gridData.p = [{ sem: sems[0], pfx: 'AB', from: '41950', to: '41960', qty: 11 }];
        saveGridsToStorage();
        Store.flush();
    `);
    await settle(250);

    // disk (SQLite simulation) par keys commit hui?
    const diskKeys = Array.from(disk.keys());
    assert.ok(diskKeys.some(k => /_\d{4}-\d{2}-\d{2}_1 PM_PARTY Z_p_/.test(k)),
        'entry keys disk par honi chahiye: ' + diskKeys.join(','));
    const rawKey = diskKeys.find(k => k.endsWith('_PARTY Z_p_raw'));
    assert.ok(rawKey && disk.get(rawKey).includes('41950'), 'raw grid disk par hona chahiye');

    // restart ke baad wahi data wapas load
    const after = await bootApp({ desktop: disk });
    await after.win.eval(`currentSession = '1 PM';`);
    after.win.document.getElementById('debtorSelect').value = 'PARTY Z';
    await after.win.eval('onPartySwitch(); setSession("1 PM");');
    await settle(120);
    const grid = JSON.parse(ev(after.win, 'JSON.stringify(gridData.p)'));
    assert.ok(grid.some(r => r.from === '41950' && r.to === '41960' && r.pfx === 'AB'),
        'restart ke baad grid data wahi milna chahiye: ' + JSON.stringify(grid));
});

// ---------------------------------------------------------------------------
// 4. BACKUP + RESTORE — desktop par bhi exactly waise hi
// ---------------------------------------------------------------------------
test('DESKTOP BACKUP: export mein saari keys + engine sqlite metadata', async () => {
    const disk = newDesktopDB();
    const app = await bootApp({ desktop: disk });
    await app.win.eval(`sems = [2,4,6,8,10]; safeLSSet(lKey('sems'), JSON.stringify(sems));`);
    await app.win.eval(`debtors = ['BACKUP PARTY']; safeLSSet(lKey('debtors'), JSON.stringify(debtors));`);
    await app.win.eval('exportData()');
    await settle(200);

    assert.equal(app.win.__blobs.length, 1, 'backup file download honi chahiye');
    const obj = JSON.parse(await app.win.__blobs[0].text());
    assert.equal(obj.__erpBackup.magic, 'CHANDRA_ERP_BACKUP');
    assert.equal(obj.__erpBackup.engine, 'sqlite', 'backup metadata mein desktop engine dikhe');
    assert.equal(obj.data.sems, '[2,4,6,8,10]', 'global SEM list backup mein honi chahiye');
    assert.equal(obj.data['erp_Chandra Agency_debtors'], '["BACKUP PARTY"]');
});

test('DESKTOP RESTORE (REPLACE): naye computer (khaali disk DB) par poora data wapas', async () => {
    // purana device: data banao + backup lo
    const oldDisk = newDesktopDB();
    const src = await bootApp({ desktop: oldDisk });
    await src.win.eval(`sems = [1,3,7,11]; safeLSSet(lKey('sems'), JSON.stringify(sems));`);
    await src.win.eval(`debtors = ['PARTY X','PARTY Y']; safeLSSet(lKey('debtors'), JSON.stringify(debtors));`);
    await src.win.eval('exportData()');
    await settle(200);
    const backupText = await src.win.__blobs[0].text();

    // naya device: khaali SQLite disk DB
    const freshDisk = newDesktopDB();
    const fresh = await bootApp({ desktop: freshDisk });
    assert.deepEqual(JSON.parse(ev(fresh.win, 'JSON.stringify(debtors)')), [], 'naya device khaali hai');

    fresh.win.eval("switchTool('backup')");
    const input = fresh.win.document.getElementById('importFile');
    const file = new fresh.win.File([backupText], 'backup.bak', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await fresh.win.eval("importData('replace')");
    await settle(350);

    // disk DB par keys commit verify
    assert.equal(freshDisk.get('sems'), '[1,3,7,11]', 'restore disk par commit hona chahiye');
    assert.equal(freshDisk.get('erp_Chandra Agency_debtors'), '["PARTY X","PARTY Y"]');

    // restart karke UI check
    const restored = await bootApp({ desktop: freshDisk });
    assert.deepEqual(JSON.parse(ev(restored.win, 'JSON.stringify(debtors)')), ['PARTY X', 'PARTY Y']);
    assert.deepEqual(JSON.parse(ev(restored.win, 'JSON.stringify(sems)')), [1, 3, 7, 11]);
});

test('DESKTOP RESTORE (MERGE): backup + current data jud jaate hain', async () => {
    const backup = JSON.stringify({
        __erpBackup: { magic: 'CHANDRA_ERP_BACKUP', version: 2, keyCount: 3, companies: ['Chandra Agency', 'BACKUP CO'] },
        data: {
            erp_global_companies: JSON.stringify(['Chandra Agency', 'BACKUP CO']),
            erp_global_active: 'Chandra Agency',
            'erp_BACKUP CO_debtors': JSON.stringify(['PURANI PARTY'])
        }
    });
    const disk = newDesktopDB();
    const cur = await bootApp({ desktop: disk });
    await cur.win.eval(`debtors = ['NAYI PARTY']; safeLSSet(lKey('debtors'), JSON.stringify(debtors));`);
    await cur.win.eval(`sysSettings.marketRate = 12; safeLSSet(lKey('settings'), JSON.stringify(sysSettings));`);
    await cur.win.eval('Store.flush()');
    await settle(150);

    cur.win.eval("switchTool('backup')");
    const input = cur.win.document.getElementById('importFile');
    const file = new cur.win.File([backup], 'old.bak', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await cur.win.eval("importData('merge')");
    await settle(300);

    const after = await bootApp({ desktop: disk });
    const companies = JSON.parse(ev(after.win, 'JSON.stringify(companyList)'));
    assert.ok(companies.includes('BACKUP CO'), 'merge mein backup ki company aani chahiye: ' + companies);
    assert.deepEqual(JSON.parse(ev(after.win, 'JSON.stringify(debtors)')), ['NAYI PARTY'],
        'current company ka data bacha rahe');
    assert.equal(JSON.parse(ev(after.win, 'Store.get("erp_Chandra Agency_settings")')).marketRate, 12,
        'jo key backup mein nahi thi wo bachi rahe');
    assert.equal(after.win.eval('Store.get("erp_BACKUP CO_debtors")'), '["PURANI PARTY"]');
});

test('DESKTOP RESTORE: corrupt file par disk data bilkul safe', async () => {
    const disk = newDesktopDB();
    const app = await bootApp({ desktop: disk });
    await app.win.eval(`debtors = ['MEHFOOZ PARTY']; safeLSSet(lKey('debtors'), JSON.stringify(debtors));`);
    await app.win.eval('Store.flush()');
    await settle(150);

    app.win.eval("switchTool('backup')");
    const input = app.win.document.getElementById('importFile');
    const bad = new app.win.File(['{ yeh json nahi hai !!!'], 'bad.bak', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [bad] });
    await app.win.eval("importData('replace')");
    await settle(150);

    assert.equal(app.reloads(), 0, 'invalid file par reload nahi');
    assert.equal(disk.get('erp_Chandra Agency_debtors'), '["MEHFOOZ PARTY"]',
        'disk par data delete nahi hona chahiye');
});

// ---------------------------------------------------------------------------
// 5. STORAGE STATUS — desktop wording + disk estimate
// ---------------------------------------------------------------------------
test('DESKTOP STORAGE STATUS: SQLITE badge + disk free space dikhta hai', async () => {
    const app = await bootApp({ desktop: newDesktopDB() });
    app.win.eval("switchTool('storage')");
    await settle(200);
    const txt = app.win.document.getElementById('toolContentArea').textContent;
    assert.match(txt, /SQLITE/, 'engine SQLITE dikhna chahiye');
    assert.match(txt, /HARD DISK DATABASE/, 'desktop par hard-disk database ka zikr ho');
    assert.match(txt, /KOI STORAGE LIMIT NAHI/i, 'unlimited message wahi rahe');
    assert.doesNotMatch(txt, /LOCALSTORAGE FALLBACK/, 'fallback badge nahi dikhna chahiye');
    const quotaTxt = app.win.document.getElementById('quotaText').textContent;
    assert.match(quotaTxt, /Khaali/i, 'disk free space dikhna chahiye');
    assert.match(quotaTxt, /500/, 'diskInfo ka quota (500 GB) render ho');

    // PERMANENT STORAGE desktop par hamesha ON
    const ok = await app.win.eval('enablePermanentStorage()');
    await settle(120);
    assert.equal(ok, true);
    assert.equal(ev(app.win, 'Store.persisted'), true);
});

// ---------------------------------------------------------------------------
// 6. SAFE CLOSE — window band karte waqt pending writes disk par flush
// ---------------------------------------------------------------------------
test('DESKTOP SAFE CLOSE: band karne par pending writes disk par commit hote hain', async () => {
    const disk = newDesktopDB();
    const app = await bootApp({ desktop: disk });
    assert.equal(app.win.desktopAPI.__hasCloseHandler(), true,
        'onBeforeClose hook register hona chahiye (preload protocol)');

    // Debit: write queue mein daalo, debounce (250ms) ka WAIT NAHI karo —
    // seedha close simulate karo. Flush usi waqt commit hona chahiye.
    await app.win.eval(`safeLSSet(lKey('debtors'), JSON.stringify(['CLOSE TEST PARTY']));`);
    await app.win.eval('__closeWindow()');   // main.js 'app:before-close' bhejta hai
    await settle(60);
    assert.equal(disk.get('erp_Chandra Agency_debtors'), '["CLOSE TEST PARTY"]',
        'close se pehle pending write disk par commit hona chahiye');
});

test('DESKTOP DURABLE WRITE: setDurable commit + read-back verify karta hai', async () => {
    const disk = newDesktopDB();
    const app = await bootApp({ desktop: disk });
    const ok = await app.win.eval(`Store.setDurable({ 'erp_test_key': 'test-value-123' })`);
    assert.equal(ok, true, 'setDurable true return kare (verify pass)');
    assert.equal(disk.get('erp_test_key'), 'test-value-123', 'value disk par honi chahiye');
    // remove bhi durable
    const ok2 = await app.win.eval(`Store.removeAll(['erp_test_key'])`);
    assert.equal(ok2, true);
    assert.equal(disk.get('erp_test_key'), undefined, 'delete disk par apply hona chahiye');
});

// ---------------------------------------------------------------------------
// 7. OFFLINE GUARANTEE — koi external resource nahi
// ---------------------------------------------------------------------------
test('OFFLINE: HTML mein koi external http(s) resource reference nahi', async () => {
    for (const f of ['index.html', 'Chandra_bill - Copy.html']) {
        const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
        const external = html.match(/(src|href)\s*=\s*["']https?:\/\/[^"']+["']/gi) || [];
        assert.deepEqual(external, [], `${f} mein external resource nahi hona chahiye: ${external.join(', ')}`);
        // CDN ke koi bhi traces (fetch/XHR URLs) nahi
        assert.equal(html.includes('cdnjs.cloudflare.com'), false, `${f}: CDN reference nahi bachna chahiye`);
    }
});

test('OFFLINE: pdf.js local vendor/ mein bundled hai (same version 2.16.105)', async () => {
    const vendorPath = path.join(ROOT, 'vendor', 'pdf.min.js');
    assert.ok(fs.existsSync(vendorPath), 'vendor/pdf.min.js honi chahiye');
    const lib = fs.readFileSync(vendorPath, 'utf8');
    assert.ok(lib.length > 100000, 'pdf.min.js poori library honi chahiye (' + lib.length + ' bytes)');
    assert.match(lib, /2\.16\.105/, 'version 2.16.105 (web CDN waali hi) honi chahiye');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.match(html, /<script src="vendor\/pdf\.min\.js"><\/script>/, 'index.html local pdf.js use kare');
});

test('OFFLINE: desktop main process saare http(s) requests block karta hai', async () => {
    const mainSrc = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8');
    assert.match(mainSrc, /onBeforeRequest/, 'network-level request blocker hona chahiye');
    assert.match(mainSrc, /cancel:\s*true/, 'requests cancel hone chahiye');
    assert.match(mainSrc, /nodeIntegration:\s*false/, 'security: nodeIntegration off');
    assert.match(mainSrc, /contextIsolation:\s*true/, 'security: contextIsolation on');
    assert.match(mainSrc, /sandbox:\s*true/, 'security: renderer sandboxed');
});

// ---------------------------------------------------------------------------
// 8. PACKAGING CONFIG — one-click NSIS installer sanity
// ---------------------------------------------------------------------------
test('PACKAGING: package.json mein one-click Windows installer config hai', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.main, 'desktop/main.js', 'Electron main entry');
    assert.ok(pkg.dependencies['better-sqlite3'], 'better-sqlite3 dependency');
    assert.ok(pkg.devDependencies['electron'], 'electron devDependency');
    assert.ok(pkg.devDependencies['electron-builder'], 'electron-builder devDependency');

    const b = pkg.build;
    assert.ok(b, 'electron-builder config hona chahiye');
    assert.equal(b.productName, 'Chandra ERP Billing');
    assert.ok(b.win.target.some(t => t.target === 'nsis'), 'NSIS installer target');
    assert.equal(b.nsis.oneClick, true, 'one-click install (non-technical users)');
    assert.equal(b.nsis.createDesktopShortcut, true, 'desktop shortcut');
    assert.equal(b.nsis.createStartMenuShortcut, true, 'start menu entry');
    assert.equal(b.nsis.runAfterFinish, true, 'install ke baad app khud khule');
    assert.equal(b.nsis.deleteAppDataOnUninstall, false, 'uninstall par user data safe rahe');
    assert.ok(b.files.includes('index.html'), 'app files packaged');
    assert.ok(b.files.some(f => f.startsWith('vendor/')), 'local pdf.js packaged');
    assert.ok(b.files.some(f => f.startsWith('desktop/')), 'desktop layer packaged');
    assert.ok(b.asarUnpack.some(p => p.includes('better-sqlite3')), 'native module asar se bahar');

    // desktop layer files maujood
    for (const f of ['desktop/main.js', 'desktop/preload.js', 'desktop/db.js']) {
        assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' hona chahiye');
    }
});
