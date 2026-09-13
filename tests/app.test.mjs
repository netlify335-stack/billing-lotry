import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, ev, settle, newDB } from './harness.mjs';

// ---------------------------------------------------------------------------
// 1. COMPANY ADD — reload ke baad bhi company bachi rahe (pehle yeh kho jaati thi)
// ---------------------------------------------------------------------------
test('ADD COMPANY: reload ke baad nayi company IndexedDB mein bachti hai', async () => {
    const db = newDB();
    const app = await bootApp({
        idb: db,
        dialogs: { prompt: () => 'SHREE BALAJI AGENCY' }
    });
    assert.equal(ev(app.win, 'Store.mode'), 'idb', 'IndexedDB engine chahiye');
    assert.deepEqual(JSON.parse(ev(app.win, 'JSON.stringify(companyList)')), ['Chandra Agency']);

    await app.win.eval('addCompany()');
    await settle(200);
    assert.equal(app.reloads(), 1, 'addCompany ne reload trigger kiya');

    // ---- reload simulate: naya document, wahi database ----
    const after = await bootApp({ idb: db });
    assert.deepEqual(
        JSON.parse(ev(after.win, 'JSON.stringify(companyList)')),
        ['Chandra Agency', 'SHREE BALAJI AGENCY'],
        'nayi company persist honi chahiye'
    );
    assert.equal(ev(after.win, 'activeCompany'), 'SHREE BALAJI AGENCY', 'nayi company active honi chahiye');
    assert.match(after.win.document.getElementById('companySelect').innerHTML, /SHREE BALAJI AGENCY/);
    assert.deepEqual(after.consoleErrors, [], 'koi JS error nahi aana chahiye');
});

test('ADD COMPANY: duplicate naam (case alag ho tab bhi) block hota hai', async () => {
    const db = newDB();
    const app = await bootApp({ idb: db, dialogs: { prompt: () => '  chandra   agency ' } });
    await app.win.eval('addCompany()');
    await settle(120);
    assert.deepEqual(JSON.parse(ev(app.win, 'JSON.stringify(companyList)')), ['Chandra Agency'],
        'duplicate company add nahi honi chahiye');
    const msgs = app.dialogLog.filter(d => d[0] === 'alert' || d[0] === 'confirm').map(d => d[1]).join(' | ');
    assert.match(msgs, /pehle se/);
});

test('ADD COMPANY: khaali naam reject hota hai', async () => {
    const app = await bootApp({ dialogs: { prompt: () => '   ' } });
    await app.win.eval('addCompany()');
    await settle(80);
    assert.deepEqual(JSON.parse(ev(app.win, 'JSON.stringify(companyList)')), ['Chandra Agency']);
    assert.equal(app.reloads(), 0, 'khaali naam par reload nahi hona chahiye');
});

// ---------------------------------------------------------------------------
// 2. COMPANY SWITCH
// ---------------------------------------------------------------------------
test('SWITCH COMPANY: reload ke baad active company wahi rehti hai', async () => {
    const db = newDB();
    const app = await bootApp({ idb: db, dialogs: { prompt: () => 'RAJ TRADERS' } });
    await app.win.eval('addCompany()');
    await settle(150);

    const after = await bootApp({ idb: db });
    const sel = after.win.document.getElementById('companySelect');
    sel.value = 'Chandra Agency';
    await after.win.eval('switchCompany()');
    await settle(150);
    assert.equal(after.reloads(), 1);

    const final = await bootApp({ idb: db });
    assert.equal(ev(final.win, 'activeCompany'), 'Chandra Agency');
});

// ---------------------------------------------------------------------------
// 3. HAR COMPANY KA DATA ALAG
// ---------------------------------------------------------------------------
test('har company ka data alag keys mein save hota hai', async () => {
    const db = newDB();
    const app = await bootApp({ idb: db, dialogs: { prompt: () => 'NEW CO' } });
    await app.win.eval(`debtors = ['PARTY A']; safeLSSet(lKey('debtors'), JSON.stringify(debtors));`);
    await app.win.eval('Store.flush()');
    await app.win.eval('addCompany()');
    await settle(150);

    const after = await bootApp({ idb: db });
    assert.equal(ev(after.win, 'Store.get("erp_Chandra Agency_debtors")'), '["PARTY A"]');
    assert.equal(ev(after.win, 'Store.get("erp_NEW CO_debtors")'), null, 'nayi company khaali honi chahiye');
});

// ---------------------------------------------------------------------------
// 4. BACKUP: saari keys (global 'sems' samet) export honi chahiye
// ---------------------------------------------------------------------------
test('BACKUP: global keys (sems/theme) export mein jaati hain', async () => {
    const app = await bootApp({});
    await app.win.eval(`sems = [2,4,6,8,10]; safeLSSet(lKey('sems'), JSON.stringify(sems));`);
    await app.win.eval(`sysSettings.marketRate = 9; safeLSSet(lKey('settings'), JSON.stringify(sysSettings));`);
    await app.win.eval(`debtors = ['PARTY ONE']; safeLSSet(lKey('debtors'), JSON.stringify(debtors));`);
    await app.win.eval('exportData()');
    await settle(150);

    assert.equal(app.win.__blobs.length, 1, 'backup file download honi chahiye');
    const obj = JSON.parse(await app.win.__blobs[0].text());
    assert.ok(obj.__erpBackup, 'wrapper metadata chahiye');
    assert.ok(obj.data.sems, "custom SEM list backup mein honi chahiye (pehle kho jaati thi)");
    assert.equal(obj.data.sems, '[2,4,6,8,10]');
    assert.equal(obj.data['erp_Chandra Agency_debtors'], '["PARTY ONE"]');
    assert.equal(obj.data['erp_Chandra Agency_settings'].includes('"marketRate":9'), true);
    assert.equal(obj.__erpBackup.companies.length, 1);
});

// ---------------------------------------------------------------------------
// 5. RESTORE: bilkul khaali (naye) device par poora data wapas
// ---------------------------------------------------------------------------
test('RESTORE: naye device (khaali DB) par backup se poora data wapas aata hai', async () => {
    const src = await bootApp({});
    await src.win.eval(`sems = [1,3,7,11]; safeLSSet(lKey('sems'), JSON.stringify(sems));`);
    await src.win.eval(`debtors = ['PARTY X','PARTY Y']; safeLSSet(lKey('debtors'), JSON.stringify(debtors));`);
    await src.win.eval('exportData()');
    await settle(150);
    const backupText = await src.win.__blobs[0].text();

    // ---- naya device: khaali database, khaali localStorage ----
    const fresh = await bootApp({ idb: newDB() });
    assert.deepEqual(JSON.parse(ev(fresh.win, 'JSON.stringify(debtors)')), [], 'naya device khaali hai');

    fresh.win.eval("switchTool('backup')");
    const input = fresh.win.document.getElementById('importFile');
    assert.ok(input, 'restore ke liye file input chahiye (Tools > BACKUP panel)');
    const file = new fresh.win.File([backupText], 'backup.bak', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });

    await fresh.win.eval("importData('replace')");
    await settle(300);

    const restored = await bootApp({ idb: fresh.idb });
    assert.deepEqual(JSON.parse(ev(restored.win, 'JSON.stringify(debtors)')), ['PARTY X', 'PARTY Y']);
    assert.deepEqual(JSON.parse(ev(restored.win, 'JSON.stringify(sems)')), [1, 3, 7, 11],
        "restore ke baad SEM list wapas aani chahiye");
});

// ---------------------------------------------------------------------------
// 6. Corrupt / galat file se current data delete NAHI hona chahiye
// ---------------------------------------------------------------------------
test('RESTORE: corrupt file par current data safe rehta hai', async () => {
    const app = await bootApp({});
    await app.win.eval(`debtors = ['MEHFOOZ PARTY']; safeLSSet(lKey('debtors'), JSON.stringify(debtors));`);
    await app.win.eval('Store.flush()');
    await settle(120);

    app.win.eval("switchTool('backup')");
    const input = app.win.document.getElementById('importFile');
    const bad = new app.win.File(['{ yeh json nahi hai !!!'], 'bad.bak', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [bad] });
    await app.win.eval("importData('replace')");
    await settle(120);

    assert.equal(app.reloads(), 0, 'invalid file par reload nahi hona chahiye');
    assert.equal(ev(app.win, 'Store.get("erp_Chandra Agency_debtors")'), '["MEHFOOZ PARTY"]',
        'data delete nahi hona chahiye');

    // valid JSON par ERP data nahi -> bhi reject
    const bad2 = new app.win.File([JSON.stringify([{ a: 1 }])], 'arr.bak', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [bad2] });
    await app.win.eval("importData('replace')");
    await settle(120);
    assert.equal(ev(app.win, 'Store.get("erp_Chandra Agency_debtors")'), '["MEHFOOZ PARTY"]');
});

test('RESTORE: MERGE mode current data ke saath jodta hai', async () => {
    const src = await bootApp({ dialogs: { prompt: () => 'OLD CO' } });
    await src.win.eval(`debtors = ['PURANI PARTY']; safeLSSet(lKey('debtors'), JSON.stringify(debtors));`);
    await src.win.eval('addCompany()');           // 'OLD CO' add karke backup lo
    await settle(150);
    const src2 = await bootApp({ idb: src.idb });
    await src2.win.eval('exportData()');
    await settle(150);
    const backupText = await src2.win.__blobs[0].text();
    assert.ok(backupText.includes('OLD CO'), 'backup mein OLD CO honi chahiye');

    const cur = await bootApp({ idb: newDB() });
    await cur.win.eval(`debtors = ['NAYI PARTY']; safeLSSet(lKey('debtors'), JSON.stringify(debtors));`);
    await cur.win.eval(`sysSettings.marketRate = 12; safeLSSet(lKey('settings'), JSON.stringify(sysSettings));`);
    await cur.win.eval('Store.flush()');
    await settle(120);
    cur.win.eval("switchTool('backup')");
    const input = cur.win.document.getElementById('importFile');
    const file = new cur.win.File([backupText], 'old.bak', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await cur.win.eval("importData('merge')");
    await settle(300);

    const after = await bootApp({ idb: cur.idb });
    // companies jud jaani chahiye, aur jo key backup mein nahi thi (settings) wo bachi rahe
    const companies = JSON.parse(ev(after.win, 'JSON.stringify(companyList)'));
    assert.ok(companies.includes('OLD CO'), 'merge mein backup ki companies aani chahiye: ' + companies);
    assert.ok(JSON.parse(ev(after.win, 'Store.get("erp_Chandra Agency_settings")')).marketRate === 12,
        'merge mein backup se na aayi hui key bachi rahe');
});

// ---------------------------------------------------------------------------
// 7. STORAGE STATUS: "limit" wali baat nahi, unlimited clear hona chahiye
// ---------------------------------------------------------------------------
test('STORAGE STATUS: 2GB/limit jaisi wording nahi, UNLIMITED dikhta hai', async () => {
    const app = await bootApp({
        storageQuota: { usage: 50 * 1048576, quota: 2 * 1073741824, persisted: false }
    });
    app.win.eval("switchTool('storage')");
    await settle(200);
    const txt = app.win.document.getElementById('toolContentArea').textContent;
    assert.match(txt, /KOI STORAGE LIMIT NAHI/i, 'saaf kehna chahiye ki koi limit nahi');
    assert.match(txt, /INDEXEDDB/, 'engine IndexedDB dikhna chahiye');
    assert.doesNotMatch(txt, /of 2048 MB available/, 'purani "limit" wali line nahi honi chahiye');
    const quotaTxt = app.win.document.getElementById('quotaText').textContent;
    assert.match(quotaTxt, /Khaali/i, 'free space dikhna chahiye');
    assert.match(quotaTxt, /2\.00 GB|2 GB|1\.9/, 'quota readable format mein');
});

test('PERMANENT STORAGE button browser se persist maangta hai', async () => {
    const app = await bootApp({
        storageQuota: { usage: 1048576, quota: 5 * 1073741824, persisted: true }
    });
    app.win.eval("switchTool('storage')");
    await settle(150);
    const ok = await app.win.eval('enablePermanentStorage()');
    await settle(120);
    assert.equal(ok === true, true, 'persist grant hona chahiye');
    assert.equal(ev(app.win, 'Store.persisted'), true);
});

// ---------------------------------------------------------------------------
// 8. RESULT FILES: html duplicate save nahi hota, view phir bhi chalta hai
// ---------------------------------------------------------------------------
test('RESULT FILE: save mein duplicate HTML nahi jaata, VIEW phir bhi chalta hai', async () => {
    const app = await bootApp({});
    const data = { 1: ['01', '02'], 2: ['11'], 3: ['21'], 4: ['31'], 5: ['41'] };
    app.win.eval(`
        currentDate = '2026-01-05'; currentSession = '1 PM';
        (function(){
            let h = [];
            h.push({ id: Date.now(), date: currentDate, session: currentSession, time: '10:00:00', resultData: ${JSON.stringify(data)} });
            safeLSSet(lKey('history'), JSON.stringify(h));
        })();
    `);
    await app.win.eval('Store.flush()');
    await settle(150);

    const raw = ev(app.win, 'Store.get(lKey("history"))');
    assert.equal(raw.includes('"html"'), false, 'result record mein html duplicate nahi hona chahiye');

    // purana record (jis mein html tha) aur naya record — dono view ho jaayein
    const id = JSON.parse(raw)[0].id;
    app.win.eval("switchTool('results')");
    await settle(80);
    app.win.eval(`viewHistoryFile(${id}, 'Result_x.txt')`);
    await settle(80);
    const viewer = app.win.document.getElementById('fileViewerArea').innerHTML;
    assert.match(viewer, /RANK 1/, 'resultData se HTML ban jaana chahiye');
    assert.match(viewer, /01\s+02/, 'numbers dikhne chahiye');
});

test('COMPACT: purane records ka redundant HTML hata deta hai', async () => {
    const app = await bootApp({});
    app.win.eval(`
        (function(){
            let h = [{ id: 1, date: '2026-01-01', session: '1 PM', time: '10:00',
                       html: '<div>'.padEnd(500, 'x') + '</div>',
                       resultData: {1:['a'],2:['b'],3:['c'],4:['d'],5:['e']} }];
            safeLSSet(lKey('history'), JSON.stringify(h));
        })();
    `);
    await app.win.eval('Store.flush()');
    const before = ev(app.win, 'Store.bytes()');
    app.win.eval("switchTool('storage')");
    await settle(80);
    await app.win.eval('compactStorage()');
    await settle(300);
    const after = ev(app.win, 'Store.bytes()');
    assert.ok(after < before, `size kam honi chahiye (${before} -> ${after})`);
    assert.equal(ev(app.win, 'Store.get(lKey("history"))').includes('"html"'), false);
});

// ---------------------------------------------------------------------------
// 9. PURGE (storage cleanup)
// ---------------------------------------------------------------------------
test('PURGE: cutoff se purani entries delete, nayi safe', async () => {
    const app = await bootApp({});
    await app.win.eval(`
        safeLSSet(lKey('2020-01-01_1 PM_PARTY A_p_10'), '1-5');
        safeLSSet(lKey('2020-01-01_1 PM_PARTY A_p_raw'), '[]');
        safeLSSet(lKey('2099-01-01_1 PM_PARTY A_p_10'), '6-9');
        Store.flush();
    `);
    await settle(150);
    app.win.eval("switchTool('storage')");
    await settle(80);
    app.win.document.getElementById('purgeCutoffDate').value = '2025-01-01';
    await app.win.eval('purgeOldEntries()');
    await settle(250);
    assert.equal(ev(app.win, 'Store.get(lKey("2020-01-01_1 PM_PARTY A_p_10"))'), null, 'purani entry delete honi chahiye');
    assert.equal(ev(app.win, 'Store.get(lKey("2099-01-01_1 PM_PARTY A_p_10"))'), '6-9', 'nayi entry safe rehni chahiye');
});

// ---------------------------------------------------------------------------
// 10. ENTRY SAVE + RELOAD (durable write round-trip)
// ---------------------------------------------------------------------------
test('ENTRY SAVE: grid data IndexedDB mein commit hota hai aur reload ke baad milta hai', async () => {
    const db = newDB();
    const app = await bootApp({ idb: db });
    await app.win.eval(`
        debtors = ['PARTY Z']; safeLSSet(lKey('debtors'), JSON.stringify(debtors));
        currentSession = '1 PM';
    `);
    app.win.eval("updateDebtorDropdown()");
    await settle(60);
    app.win.document.getElementById('debtorSelect').value = 'PARTY Z';
    await app.win.eval(`
        gridData.p = [{ sem: sems[0], pfx: 'AB', from: '41950', to: '41960', qty: 11 }];
        saveGridsToStorage();
        Store.flush();
    `);
    await settle(250);

    const after = await bootApp({ idb: db });
    const keys = JSON.parse(ev(after.win, 'JSON.stringify(Store.allKeys())'));
    assert.ok(keys.some(k => /2\d{3}-\d{2}-\d{2}_1 PM_PARTY Z_p_/.test(k)), 'entry keys save honi chahiye: ' + keys.join(','));
    const rawKey = keys.find(k => k.endsWith('_PARTY Z_p_raw'));
    assert.ok(rawKey, 'raw grid key save honi chahiye');
    const rawVal = ev(after.win, `Store.get(${JSON.stringify(rawKey)})`);
    assert.ok(rawVal.includes('41950') && rawVal.includes('AB'), 'raw grid data (number + prefix) save hona chahiye: ' + rawVal);
});

// ---------------------------------------------------------------------------
// 11. Boot par koi JS error nahi
// ---------------------------------------------------------------------------
test('APP BOOT: koi console/JS error nahi, dashboard ready', async () => {
    const app = await bootApp({});
    assert.deepEqual(app.consoleErrors, [], 'boot par errors nahi aani chahiye: ' + app.consoleErrors.join(' | '));
    assert.equal(ev(app.win, 'Store.mode'), 'idb');
    assert.ok(app.win.document.getElementById('companySelect').innerHTML.includes('Chandra Agency'));
    assert.ok(ev(app.win, 'typeof renderCompanyManager') === 'function');
    assert.ok(ev(app.win, 'typeof openCompanyManager') === 'function');
});

// ---------------------------------------------------------------------------
// 12. COMPANY MANAGER: rename (data ke saath) aur delete
// ---------------------------------------------------------------------------
test('COMPANY MANAGER: rename company ka data bhi naye naam par chala jaata hai', async () => {
    const db = newDB();
    const app = await bootApp({ idb: db, dialogs: { prompt: () => 'PURANA NAAM' } });
    await app.win.eval('addCompany()');
    await settle(150);

    const a2 = await bootApp({ idb: db, dialogs: { prompt: () => 'NAYA NAAM' } });
    await a2.win.eval(`debtors = ['RENAME PARTY']; safeLSSet(lKey('debtors'), JSON.stringify(debtors)); Store.flush();`);
    await settle(150);
    await a2.win.eval('renameCompany(1)');      // index 1 = PURANA NAAM
    await settle(250);

    const a3 = await bootApp({ idb: db });
    const companies = JSON.parse(ev(a3.win, 'JSON.stringify(companyList)'));
    assert.deepEqual(companies, ['Chandra Agency', 'NAYA NAAM']);
    assert.equal(ev(a3.win, 'Store.get("erp_NAYA NAAM_debtors")'), '["RENAME PARTY"]', 'data naye naam par migrate hona chahiye');
    assert.equal(ev(a3.win, 'Store.get("erp_PURANA NAAM_debtors")'), null, 'purani keys hat jaani chahiye');
});

test('COMPANY MANAGER: delete company uska data bhi hata deta hai', async () => {
    const db = newDB();
    const app = await bootApp({ idb: db, dialogs: { prompt: () => 'HATANE WALI CO' } });
    await app.win.eval('addCompany()');
    await settle(150);

    const a2 = await bootApp({ idb: db });
    await a2.win.eval(`debtors = ['DELETE PARTY']; safeLSSet(lKey('debtors'), JSON.stringify(debtors)); Store.flush();`);
    await settle(150);
    assert.equal(ev(a2.win, 'Store.get("erp_HATANE WALI CO_debtors")'), '["DELETE PARTY"]');

    await a2.win.eval('deleteCompany(1)');
    await settle(300);

    const a3 = await bootApp({ idb: db });
    assert.deepEqual(JSON.parse(ev(a3.win, 'JSON.stringify(companyList)')), ['Chandra Agency']);
    assert.equal(ev(a3.win, 'activeCompany'), 'Chandra Agency', 'active company safe fallback par chali jaaye');
    assert.equal(ev(a3.win, 'Store.get("erp_HATANE WALI CO_debtors")'), null, 'deleted company ka data bhi hat jaaye');
});

test('COMPANY MANAGER: last company delete nahi hoti', async () => {
    const app = await bootApp({});
    await app.win.eval('deleteCompany(0)');
    await settle(120);
    assert.deepEqual(JSON.parse(ev(app.win, 'JSON.stringify(companyList)')), ['Chandra Agency']);
    assert.equal(app.reloads(), 0);
});

// ---------------------------------------------------------------------------
// 13. Dono HTML files same honi chahiye (warna "Chandra_bill - Copy.html"
//     kholne par user ko purana/buggy version mil jaata hai)
// ---------------------------------------------------------------------------
test('index.html aur "Chandra_bill - Copy.html" identical hain', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
    const a = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const b = fs.readFileSync(path.join(root, 'Chandra_bill - Copy.html'), 'utf8');
    assert.equal(a, b, 'dono files same honi chahiye — copy file purani/buggy na rahe');
});
