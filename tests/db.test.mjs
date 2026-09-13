// =====================================================================
// SQLITE DATA-ACCESS LAYER TESTS — desktop/db.js REAL better-sqlite3 ke
// saath, REAL disk file par chalta hai (koi mock nahi).
//
// Note: agar machine par better-sqlite3 ELECTRON ke liye rebuild hai
// (`npm run rebuild` ke baad), plain Node mein load nahi hoga — tab yeh
// tests gracefully SKIP ho jaate hain (renderer-side desktop tests
// tests/desktop.test.mjs mein hamesha chalte hain).
// =====================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let ErpDatabase = null;
let nativeOK = true;
try {
    ({ ErpDatabase } = require('../desktop/db.js'));
} catch (e) {
    nativeOK = false;
    console.warn('[db.test] better-sqlite3 is Node runtime mein load nahi hua — skip. (' +
        'Electron-ABI build ho sakta hai; `npm rebuild better-sqlite3` se Node ke liye wapas laayein.) ' + e.message);
}

function tmpDbPath(name) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chandra-erp-test-'));
    return path.join(dir, name || 'chandra-erp.db');
}

test('SQLITE: migrations table + kv schema banti hai', { skip: !nativeOK }, () => {
    const p = tmpDbPath();
    const db = new ErpDatabase(p);
    const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
    assert.ok(tables.includes('kv'), 'kv table chahiye: ' + tables);
    assert.ok(tables.includes('schema_migrations'), 'migration tracking table chahiye');
    const applied = db.db.prepare('SELECT version, name FROM schema_migrations').all();
    assert.deepEqual(applied.map(a => a.version), [1]);
    db.close();
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
});

test('SQLITE: WAL journal + FULL synchronous (crash-safe durability)', { skip: !nativeOK }, () => {
    const p = tmpDbPath();
    const db = new ErpDatabase(p);
    assert.equal(db.db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.db.pragma('synchronous', { simple: true }), 2); // FULL
    db.close();
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
});

test('SQLITE: writeBatch atomic hai — put + delete ek transaction mein', { skip: !nativeOK }, () => {
    const p = tmpDbPath();
    const db = new ErpDatabase(p);
    db.writeBatch([
        ['erp_global_companies', '["Chandra Agency"]'],
        ['erp_Chandra Agency_debtors', '["PARTY A"]'],
        ['temp_key', 'x']
    ]);
    assert.equal(db.get('erp_Chandra Agency_debtors'), '["PARTY A"]');
    db.writeBatch([['temp_key', null]]);   // null = delete
    assert.equal(db.get('temp_key'), null);
    // upsert: wahi key dobara likho
    db.writeBatch([['erp_Chandra Agency_debtors', '["PARTY A","PARTY B"]']]);
    assert.equal(db.get('erp_Chandra Agency_debtors'), '["PARTY A","PARTY B"]');
    db.close();
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
});

test('SQLITE: loadAll poora data wapas deta hai (app boot path)', { skip: !nativeOK }, () => {
    const p = tmpDbPath();
    const db = new ErpDatabase(p);
    const rows = [['k1', 'v1'], ['k2', 'v2'], ['sems', '[3,5,10]']];
    db.writeBatch(rows);
    const all = db.loadAll();
    assert.equal(all.length, 3);
    assert.deepEqual(all.sort(), rows.sort());
    db.close();
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
});

test('SQLITE: DATA PERSISTENCE — close/reopen (app restart) ke baad data wahi', { skip: !nativeOK }, () => {
    const p = tmpDbPath();
    const db1 = new ErpDatabase(p);
    db1.writeBatch([
        ['erp_global_companies', '["Chandra Agency","RESTART CO"]'],
        ['erp_RESTART CO_history', JSON.stringify([{ id: 1, date: '2026-09-13', session: '1 PM', resultData: { 1: ['12345'] } }])]
    ]);
    db1.close();

    // "restart"
    const db2 = new ErpDatabase(p);
    assert.equal(db2.get('erp_global_companies'), '["Chandra Agency","RESTART CO"]');
    const h = JSON.parse(db2.get('erp_RESTART CO_history'));
    assert.equal(h[0].resultData[1][0], '12345');
    // migration dobara NAHI chalni chahiye
    assert.deepEqual(db2.db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version), [1]);
    db2.close();
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
});

test('SQLITE: bada data — koi limit nahi (10k keys, ~10MB) round-trip', { skip: !nativeOK }, () => {
    const p = tmpDbPath();
    const db = new ErpDatabase(p);
    const entries = [];
    const bigValue = 'x'.repeat(1000); // ~1KB per key
    for (let i = 0; i < 10000; i++) entries.push([`erp_bulk_co_2026-01-01_1 PM_PARTY${i}_p_10`, i + '|' + bigValue]);
    const t0 = Date.now();
    db.writeBatch(entries);
    const writeMs = Date.now() - t0;
    assert.equal(db.loadAll().length, 10000);
    assert.equal(db.get('erp_bulk_co_2026-01-01_1 PM_PARTY42_p_10'), '42|' + bigValue);
    const st = db.stats();
    assert.equal(st.keys, 10000);
    assert.ok(st.bytes > 5 * 1024 * 1024, 'file size meaningful honi chahiye: ' + st.bytes);
    console.log(`[db.test] 10k keys (~11MB) write: ${writeMs}ms — disk-par koi quota nahi`);
    db.close();
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
});

test('SQLITE: diskInfo quota-bar shape deta hai (usage/quota)', { skip: !nativeOK }, () => {
    const p = tmpDbPath();
    const db = new ErpDatabase(p);
    db.writeBatch([['k', 'v'.repeat(5000)]]);
    const info = db.diskInfo();
    assert.ok(info, 'diskInfo null nahi hona chahiye (linux/win par statfsSync chalta hai)');
    assert.ok(typeof info.usage === 'number' && info.usage > 0);
    assert.ok(typeof info.quota === 'number' && info.quota >= info.usage);
    assert.equal(info.desktop, true);
    db.close();
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
});

test('SQLITE: writeBatch galat input par bhi transaction integrity rakhta hai', { skip: !nativeOK }, () => {
    const p = tmpDbPath();
    const db = new ErpDatabase(p);
    assert.throws(() => db.writeBatch('not-an-array'));
    // adhoora entry skip hota hai, baaki commit
    db.writeBatch([['ok_key', 'yes'], ['junk'], null]);
    assert.equal(db.get('ok_key'), 'yes');
    db.close();
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
});
