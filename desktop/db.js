/**
 * =====================================================================
 * Chandra ERP — SQLITE DATA-ACCESS LAYER (desktop app)
 * =====================================================================
 * better-sqlite3 par bana clean data layer. Poora app data ek hi file
 * mein rehta hai:  <userData>\chandra-erp.db   (Windows par:
 * C:\Users\<YOU>\AppData\Roaming\ChandraERP\chandra-erp.db)
 *
 *  * Koi browser quota NAHI — jitni disk par jagah hai, utna data.
 *  * WAL journal + synchronous=FULL — crash/reboot ke baad bhi data safe.
 *  * Schema migrations — versioned, transactional, aage badhne-ready.
 *  * Data model: app ka storage key-value hai (web version ki IndexedDB
 *    jaisa hi), isliye ek normalized `kv` table poori feature-parity
 *    deti hai — backup/restore (.bak) bhi exactly waise hi kaam karta hai.
 *
 * Yeh module MAIN PROCESS mein chalta hai (renderer se IPC ke through).
 * Test mein isko kisi bhi temp file path ke saath use kiya ja sakta hai.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// ---------------------------------------------------------------------------
// MIGRATIONS — har migration ek version number ke saath, ek hi baar chalti hai.
// Naye migrations sirf is array mein ADD karein (purane kabhi badlein nahi).
// ---------------------------------------------------------------------------
const MIGRATIONS = [
    {
        version: 1,
        name: 'initial-schema',
        // Web app ki IndexedDB (ChandraERP_DB > 'kv' object store) ka
        // exact SQLite equivalent: string key -> string value.
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS kv (
                    key   TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                ) WITHOUT ROWID;
            `);
        }
    }
];

class ErpDatabase {
    /**
     * @param {string} dbPath  SQLite file ka poora path.
     */
    constructor(dbPath) {
        this.dbPath = dbPath;
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });

        this.db = new Database(dbPath);

        // Durability + concurrency pragmas:
        //  * WAL        — reader/writer ek saath; crash-safe.
        //  * synchronous=FULL — power cut par bhi committed data nahi jaata.
        //  * busy_timeout — do process takraayein to 5s wait, turant error nahi.
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = FULL');
        this.db.pragma('busy_timeout = 5000');

        this.migrate();

        // Prepared statements — baar-baar use hone waale queries fast rehte hain.
        this._stmtAll = this.db.prepare('SELECT key, value FROM kv');
        this._stmtGet = this.db.prepare('SELECT value FROM kv WHERE key = ?');
        this._stmtPut = this.db.prepare(
            'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        );
        this._stmtDel = this.db.prepare('DELETE FROM kv WHERE key = ?');
        this._stmtCount = this.db.prepare('SELECT COUNT(*) AS n FROM kv');
        this._stmtBytes = this.db.prepare(
            'SELECT COALESCE(SUM(LENGTH(key) + LENGTH(value)), 0) AS b FROM kv'
        );
    }

    /** Default DB location: <userData>/chandra-erp.db */
    static defaultPath(userDataDir) {
        return path.join(userDataDir, 'chandra-erp.db');
    }

    // -----------------------------------------------------------------------
    // MIGRATION RUNNER — schema_migrations table mein applied versions track
    // hote hain; har pending migration apne transaction mein chalti hai.
    // -----------------------------------------------------------------------
    migrate() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version    INTEGER PRIMARY KEY,
                name       TEXT NOT NULL,
                applied_at TEXT NOT NULL
            );
        `);
        const applied = new Set(
            this.db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
        );
        const record = this.db.prepare(
            'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
        );
        for (const m of MIGRATIONS) {
            if (applied.has(m.version)) continue;
            const run = this.db.transaction(() => {
                m.up(this.db);
                record.run(m.version, m.name, new Date().toISOString());
            });
            run(); // transaction fail hua to poora migration roll back
        }
    }

    // -----------------------------------------------------------------------
    // KV API — Store engine (renderer) isi ko IPC ke through use karta hai.
    // -----------------------------------------------------------------------

    /** Saari rows: [[key, value], ...] — app boot par in-memory mirror banta hai. */
    loadAll() {
        return this._stmtAll.all().map(r => [r.key, r.value]);
    }

    /** Ek key ka value, ya null. */
    get(key) {
        const row = this._stmtGet.get(String(key));
        return row ? row.value : null;
    }

    /**
     * Batch write — EK hi transaction mein (all-or-nothing).
     * entries: [[key, valueString] | [key, null], ...]  (null = delete)
     */
    writeBatch(entries) {
        if (!Array.isArray(entries)) throw new Error('writeBatch: entries array chahiye');
        const tx = this.db.transaction((rows) => {
            for (const entry of rows) {
                if (!Array.isArray(entry) || entry.length < 1) continue;
                const k = String(entry[0]);
                const v = entry[1];
                if (v === null || v === undefined) this._stmtDel.run(k);
                else this._stmtPut.run(k, String(v));
            }
        });
        tx(entries);
        return { ok: true, count: entries.length };
    }

    // -----------------------------------------------------------------------
    // INFO / STATS
    // -----------------------------------------------------------------------

    /** Kitni keys, kitna data (chars), DB file kitni badi. */
    stats() {
        const n = this._stmtCount.get().n;
        const chars = this._stmtBytes.get().b;
        let fileSize = 0;
        try { fileSize = fs.statSync(this.dbPath).size; } catch (e) { /* nayi file */ }
        try { fileSize += fs.statSync(this.dbPath + '-wal').size; } catch (e) { /* WAL optional */ }
        return { keys: n, chars: chars, bytes: fileSize, path: this.dbPath };
    }

    /**
     * navigator.storage.estimate() jaisa shape — STORAGE STATUS ka quota bar
     * desktop par DISK ki free space dikhata hai (koi artificial limit nahi).
     *   usage = is app ki DB file ka size
     *   quota = usage + disk par bachhi hui jagah
     */
    diskInfo() {
        const st = this.stats();
        try {
            // fs.statfsSync: Node >= 18.15 (Electron ke saath aata hai)
            const fsInfo = fs.statfsSync(path.dirname(this.dbPath));
            const freeBytes = fsInfo.bavail * fsInfo.bsize;
            return { usage: st.bytes, quota: st.bytes + freeBytes, desktop: true };
        } catch (e) {
            return null; // UI gracefully "no quota info" branch dikha dega
        }
    }

    close() {
        try { this.db.close(); } catch (e) { /* already closed */ }
    }
}

module.exports = { ErpDatabase, MIGRATIONS };
