# 🖥️ CHANDRA ERP BILLING — WINDOWS DESKTOP APP (100% OFFLINE)

Yeh document batata hai ki web app **Windows desktop app** mein kaise convert hui,
aur aapko apni machine par **one-click installer (.exe)** kaise banana hai.

---

## 1. Architecture (kya bana hai)

```
billing-lotry/
├── index.html              ← Wahi purana single-file app (UI bilkul same).
│                             Store engine ab DO backends bolta hai:
│                               * Browser  → IndexedDB (web deploy, tests)
│                               * Desktop  → SQLite (hard disk database)
├── Chandra_bill - Copy.html  ← identical copy (tests check karte hain)
├── vendor/
│   └── pdf.min.js          ← pdf.js 2.16.105 AB LOCAL bundled (pehle CDN tha)
├── desktop/
│   ├── main.js             ← Electron MAIN process: window, offline guard
│   │                         (saari http/https requests network-level BLOCK),
│   │                         downloads par native Save-As dialog,
│   │                         safe-close flush protocol, single-instance lock
│   ├── preload.js          ← secure bridge (contextBridge): window.desktopAPI
│   │                         renderer ko sirf yeh chhota API dikhta hai —
│   │                         Node access page ko bilkul nahi
│   └── db.js               ← SQLite DATA-ACCESS LAYER (better-sqlite3):
│                             schema + migrations + kv table + disk stats
├── build/
│   └── icon.png            ← app icon (installer/shortcut/taskbar)
├── tests/
│   ├── app.test.mjs        ← purane 20 browser-mode tests (unchanged)
│   ├── desktop.test.mjs    ← 17 desktop tests (sqlite mode, backup/restore,
│   │                         safe-close, offline guarantee, packaging config)
│   └── db.test.mjs         ← 8 REAL SQLite tests (disk file par, no mock)
└── package.json            ← Electron + electron-builder (NSIS installer) config
```

### Data kahan save hota hai (desktop)
```
C:\Users\<AAPKA-NAAM>\AppData\Roaming\ChandraERP\chandra-erp.db      (SQLite file)
                                          ├─ chandra-erp.db-wal     (journal)
```
* **Koi limit NAHI** — browser quota nahi; jitni disk par jagah hai utna data.
* **Crash/reboot safe** — WAL journal + `synchronous=FULL` (har committed
  write power-cut mein bhi bachti hai).
* **Uninstall par bhi data SAFE** — installer `%APPDATA%\ChandraERP` nahi hatata.
* **Schema/migrations:** `desktop/db.js` mein versioned migrations
  (`schema_migrations` table) — naye versions mein schema badalna safe hai.

### Store engine: ek code, do backends
`index.html` ka `Store` module pehle jaisa hi hai — in-memory mirror +
write-queue + **durable commit (write + read-back verify)**. Bas backend
badalta hai:

| Feature            | Browser (web) | Desktop (Electron) |
|--------------------|---------------|--------------------|
| Engine             | IndexedDB     | SQLite (better-sqlite3) |
| Location           | browser profile | hard-disk file |
| Quota              | browser estimate | **none** (disk free space) |
| Auto-delete risk   | haan (persist maangna padta tha) | **nahi** (permanent by design) |
| Backup/restore (.bak) | same | same |
| UI                 | same | same |

Desktop par `window.desktopAPI` (preload) maujood hota hai → Store `'sqlite'`
mode mein chalta hai; browser/tests mein wo undefined hai → `'idb'` mode.
Isliye **ek hi index.html** teeno jagah chalta hai aur feature-parity guaranteed hai.

---

## 2. Zaroori cheezein (build machine par)

1. **Windows 10/11** (64-bit)
2. **Node.js LTS** (18 ya naya) — https://nodejs.org → "LTS" download karke
   Next-Next install karein. (Yeh sirf INSTALLER BANANE ke liye chahiye;
   end users ko kuch install NAHI karna hota.)
3. Internet sirf pehli baar `npm install` ke liye (dependencies download).
   Uske baad sab kuch offline build/run hota hai.

> Note: `better-sqlite3` ke **prebuilt binaries** Electron 42 ke liye publish
> hote hain, isliye aam taur par **C++ compiler ki zaroorat NAHI**. Agar phir
> bhi `npm install` compile error de, to Visual Studio Build Tools
> ("Desktop development with C++" workload) + Python 3 install kar lein.

---

## 3. Development / try karna (source se)

```bash
npm install        # electron + better-sqlite3 + native rebuild (postinstall)
npm run desktop    # app window khulti hai (DevTools ke saath)
npm test           # saare tests: browser + desktop + real SQLite
```

---

## 4. INSTALLER BANANA (apni Windows machine par)

```bash
npm install
npm run dist
```

Bas! Kuch minute baad installer yahan milega:

```
dist-installer\ChandraERP-Setup-11.0.0.exe
```

(`npm run dist:dir` = bina installer ke unpacked app — jhatpat test karne ke liye.)

### Installer kaisa hai (end user ke liye)
* **NSIS one-click** — user sirf double-click karta hai → install → app khud
  khul jaati hai (`runAfterFinish`). Koi wizard-ke-sawaal nahi.
* **Desktop shortcut** + **Start Menu entry** ("Chandra ERP Billing") banta hai.
* Per-user install — **admin rights ki zaroorat nahi** (agar kabhi chahiye ho
  to installer khud elevation maang leta hai).
* App ke saath **Node.js install karne ki zaroorat NAHI** — Electron runtime
  aur SQLite binary installer ke andar bundled hain.
* Uninstall: Settings → Apps → "Chandra ERP Billing" (data `%APPDATA%\ChandraERP`
  mein safe rehta hai).

### Anpadh / non-technical user ko screen par kya dikhta hai
1. `ChandraERP-Setup-11.0.0.exe` par **double-click** (double-tap).
2. Ek chhoti window khulti hai — bas progress bar chalta hai ("Installing...").
   Na koi folder chunna, na koi license page, na koi button dabana.
3. Progress khatam → **app KHUD khul jaati hai** — seedha dashboard
   (koi login/password nahi). Desktop par icon aa chuka hota hai.
4. Agle din se: desktop icon par double-click → app khuli. Bas.
   (Internet kabhi nahi chahiye.)

> Agar Windows **SmartScreen** ki neeli warning dikhe (naya/unsigned app hone
> par): "More info" → "Run anyway" ek baar click karna hota hai. Code-signing
> certificate lagwane ke baad yeh warning bhi nahi aayegi.

### Installer ko doosre computers par dena
`ChandraERP-Setup-11.0.0.exe` ko USB/WhatsApp se kisi bhi Windows 10/11
(64-bit) machine par copy karein — **bina internet ke** install + run hoti hai.

---

## 5. Purane WEB data ko desktop app mein laana (migration)

Web/browser version ka data IndexedDB mein tha; desktop ka SQLite mein.
Migration ka official tareeka (app ke andar hi maujood hai):

1. Browser mein purana app kholo → **Tools → BACKUP & SYNC → DOWNLOAD BACKUP**
   (`.bak` file mil jaayegi — saari companies, parties, entries, results, SEMs).
2. Desktop app kholo → **Tools → BACKUP & SYNC** → wahi `.bak` select karo →
   **UPLOAD & REPLACE ALL** (ya **MERGE** agar desktop par pehle se data hai).
3. Done — reload ke baad poora data desktop app mein.

Naye desktop install par pehli baar app kholti hai to bilkul saaf
("Chandra Agency" default company) milti hai — koi error nahi.

---

## 6. TESTING CHECKLIST (release se pehle khud verify karein)

### A. Offline guarantee
- [ ] Installer wali machine ka **Wi-Fi/LAN band** kar do (airplane mode).
- [ ] App kholti hai, dashboard aata hai — koi "internet" error nahi.
- [ ] Result PDF upload + Extract Data chalta hai (pdf.js local bundled hai).
- [ ] Bill generate + DOWNLOAD TEXT chalta hai (Save-As dialog aata hai).
- [ ] Tools → STORAGE STATUS khulta hai (disk estimate dikhta hai).
- (Technical check: DevTools → Network tab mein koi request bahar nahi jaati;
  main process saari http/https requests network-level par cancel karta hai.)

### B. Data disk par, bina limit
- [ ] Entry save karo → app BAND karo → dobara kholo → entry wahi hai.
- [ ] Task Manager se app ko **END TASK** (crash simulate) karo → dobara kholo
      → last committed data safe hai (WAL + synchronous=FULL).
- [ ] Computer **restart** karo → data wahi.
- [ ] File verify: `%APPDATA%\ChandraERP\chandra-erp.db` maujood hai aur
      entries ke saath size badhti hai (Run → `%appdata%\ChandraERP`).
- [ ] STORAGE STATUS mein engine badge: **SQLITE ✓ UNLIMITED + PERMANENT**.
- [ ] Bada test (optional): 10,000+ ticket entries daalo — koi quota error nahi.

### C. Feature parity (har purana feature)
- [ ] Company ADD / SWITCH / RENAME / DELETE (header + COMPANY MANAGER).
- [ ] Party add/delete + per-party P-RATE / C-RATE.
- [ ] Session tabs (1 PM / 6 PM / 8 PM) + ALT shortcuts (ALT+P/C/R/B/M/Q/1/2/3, ESC).
- [ ] Purchase/Choice/Return grids: paste, arrow-key navigation, duplicate
      warnings, RETURN-blocked validation.
- [ ] Result import (PDF/TXT) → 5 ranks → save → FILE MANAGER mein VIEW/DELETE.
- [ ] SINGLE PARTY BILL, MASTER SUMMARY BILL, PWT REPORT, MASTER PWT —
      numbers/calculation web version jaise hi.
- [ ] SMART SELF-DIAGNOSIS, MASTER SETTINGS (SEMs add/delete, rates, prizes).
- [ ] Dark/Light theme (restart ke baad bhi wahi).
- [ ] STORAGE STATUS: COMPACT / PURGE buttons.

### D. Backup & Restore (desktop par re-verified)
- [ ] **DOWNLOAD BACKUP** → Save-As dialog → `.bak` file banti hai.
- [ ] .bak ka JSON khol kar dekho: `__erpBackup.engine = "sqlite"`, saari keys
      (`sems` samet) maujood.
- [ ] Naye/khaali profile par **UPLOAD & REPLACE ALL** → poora data wapas.
- [ ] **MERGE** → dono taraf ka data judta hai, current data nahi udta.
- [ ] Galat/corrupt file select karo → saaf error, **current data safe**.
- [ ] Restore ke baad app reload → companies/parties/results sahi.
- [ ] Automated: `npm test` → 45/45 pass (browser + desktop + SQLite).

### E. Install/UX
- [ ] Double-click installer → install → app khud khulti hai.
- [ ] Desktop shortcut + Start Menu entry kaam karte hain.
- [ ] App icon taskbar/shortcut par dikhta hai.
- [ ] Dobara icon dabane par doosri window NAHI khulti (single-instance),
      purani window focus hoti hai.
- [ ] Window band karte waqt pending entry save hoti hai (safe-close flush).

---

## 7. Troubleshooting

| Problem | Hal |
|---|---|
| `npm install` mein better-sqlite3 compile error | Visual Studio Build Tools (C++ workload) + Python 3 install karein; phir `npm install` dobara. (Aam taur par prebuilt binary download ho jaata hai — compiler nahi lagta.) |
| `npm run desktop` par "NODE_MODULE_VERSION mismatch" | `npm run rebuild` chalayein (Electron ke liye native rebuild), phir `npm run desktop`. |
| `npm test` mein db.test skip ho rahe hain | better-sqlite3 Electron-ABI par rebuilt hai — yeh normal hai; `npm rebuild better-sqlite3` se Node tests wapas aa jaate hain. Desktop logic tests (desktop.test.mjs) hamesha chalte hain. |
| Windows SmartScreen warning (naya/unsigned app) | Code-signing certificate se sign karne par hat jaata hai. Bina sign ke: "More info → Run anyway". |
| DevTools chahiye (debug) | Source se chalate waqt khud khulte hain; packaged app mein band rehte hain. |

---

## 8. Security notes
* Renderer mein Node access NAHI (`nodeIntegration:false`, `contextIsolation:true`,
  `sandbox:true`) — page sirf `window.desktopAPI` ke through DB se baat karta hai.
* Main process har IPC input validate karta hai.
* Koi external navigation/popup nahi; saari network requests cancel.
* Koi telemetry/analytics nahi — app mein aisi koi cheez hai hi nahi.
