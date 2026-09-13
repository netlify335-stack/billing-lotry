# Chandra Agency ERP — Billing System (V11 — OFFLINE WINDOWS DESKTOP APP + WEB)

**V11 (Desktop):** ab yeh app **Windows desktop application** ke roop mein bhi
chalti hai — **100% OFFLINE** (koi internet zaroorat nahi), data **hard disk ki
SQLite database file** mein (**koi storage limit nahi**), aur **one-click
installer** (`ChandraERP-Setup-*.exe`) ke saath. Poori guide: **[DESKTOP.md](DESKTOP.md)**

```bash
# Desktop app (source se):
npm install
npm run desktop        # app window khulti hai

# Windows installer banayein (Windows machine par):
npm run dist           # -> dist-installer\ChandraERP-Setup-11.0.0.exe

# Tests (browser + desktop + real SQLite):
npm test               # 45 tests
```

* **Framework:** Electron + better-sqlite3 — renderer wahi Chromium hai jo web
  app chalata hai, isliye UI/features **pixel-perfect same**; SQLite main process
  mein synchronous API deta hai jo Store engine ke durable-write model se exact
  match karta hai. (Tauri chhoda kyunki usko Rust toolchain + WebView2 chahiye
  hota aur rendering engine Windows-version ke saath badal jaata hai.)
* **Offline:** pdf.js ab `vendor/` mein local bundled hai (pehle CDN); main
  process saari http/https requests network-level par block karta hai.
* **Data:** `%APPDATA%\ChandraERP\chandra-erp.db` (WAL + synchronous=FULL —
  crash/reboot safe; uninstall par bhi data safe rehta hai).
* **Web version bilkul pehle jaisa:** `npm start` / Vercel / Railway deploy
  unchanged — browser mein app IndexedDB use karti rehti hai.

---

# (V10 notes — web version)

# Chandra Agency ERP — Billing System (V10 — Company Fix + Bilkul Unlimited Local Storage)

Single-file billing/ERP app jo **Railway aur Vercel dono pe deploy** ho jaati hai,
**koi login / device activation / license key nahi** maangti, aur poora data
**aapke hi device** mein (IndexedDB) rakhti hai — **kisi size limit ke bina**.

---

## 🔧 V10 — is version mein theek hui cheezein

### 1. ❌→✅ "Nayi company add nahi ho rahi thi" — FIX
**Problem:** `ADD` dabane par company list memory mein to jud jaati thi, par turant
`window.location.reload()` ho jaata tha. IndexedDB ka write **abhi commit bhi nahi hua
hota tha**, isliye refresh ke baad nayi company **gayab** ho jaati thi. (Yahi cheez
company **switch** ke saath bhi hoti thi — purani company wapas select ho jaati thi.)

**Fix:**
- Company add / switch / rename / delete ab **durable write** karte hain:
  IndexedDB transaction **commit + read-back verify** hone ke baad hi reload hota hai.
- Verify fail ho to saaf error dikhta hai aur company list **rollback** ho jaati hai
  (UI aur storage kabhi aadhe-adhure match nahi karte).
- Duplicate check ab **case-insensitive** hai (`chandra agency` = `Chandra Agency`),
  naam trim/normalize hota hai, aur HTML todne waale characters hat jaate hain.
- Naya **COMPANY MANAGER** (header ka `MANAGE` button ya Tools menu):
  companies ki list, unke records ka count, **ADD / OPEN / RENAME / DELETE**.
  - `RENAME` company ka poora data naye naam par migrate kar deta hai.
  - `DELETE` company + uska data hata deta hai (last company delete nahi hoti).
  - Naam type karne ka input bhi hai — jahan browser `prompt()` block karta hai
    (kuch iframe/embedded situations), wahan bhi add ho jaayega.

### 2. 💾 "2GB limit kyu dikha raha tha?" — ab koi limit nahi dikhti
**Problem:** Tools > STORAGE STATUS mein likha aata tha
`X MB used of 2048 MB available` — jo ek **hard limit** jaisa lagta tha.
Wo number asal mein browser ka *estimate* hota hai (device ki free space ka),
app ki limit nahi.

**Fix:**
- App par **pehle bhi koi limit nahi thi aur ab bhi nahi hai** — poora data browser ke
  **IndexedDB** mein jaata hai, jo aapki disk ki free space ke hisaab se **GBs** tak
  jaata hai (5–10MB wala localStorage limit yahan lagu nahi).
- Ab screen par saaf likha aata hai: **"IS APP KI KOI STORAGE LIMIT NAHI HAI"**, aur
  browser ka number **"aapke device ki storage (estimate) — yeh limit nahi"** ke roop mein
  dikhta hai. App us number par kabhi band/block nahi hoti.
- **PERMANENT STORAGE ON** ka button: browser se persistent-storage permission maangta
  hai, jisse data kabhi auto-delete nahi hota.
- **WRITE HEALTH** indicator: kitne writes successful hue, koi fail hua to kya error aaya.
- Write fail hone par data **phenka nahi jaata** — auto-retry, auto-compaction
  (result files ki duplicate HTML copy hata kar) aur saaf warning.
- **COMPACT DATA** button: purane result files ki extra HTML copy hata deta hai
  (wo `resultData` se dobara ban jaati hai) — size lagbhag aadha.

### 3. 💾→✅ Backup / Restore — check kiya aur theek kiya
**Jo bugs mile:**
- Backup mein sirf `erp_` se shuru hone waali keys jaati thi — isliye **custom SEM list
  (`sems` key) har backup se chhoot jaati thi** aur naye device par restore karne ke baad
  SEM settings default `[3,5,10,15,20]` par chali jaati thi.
- Purani localStorage → IndexedDB migration mein bhi wahi `sems` key chhoot jaati thi.
- Galat/corrupt `.bak` file select karne par `RESTORE SUCCESSFUL` kehkar **poora data
  delete** ho sakta tha (valid JSON, par ERP data nahi → sab kuch wipe).

**Fix:**
- Export ab **saari keys** leta hai (global `sems`, `erp_theme` samet) + wrapper metadata
  (version, date, companies, key count). Purane (flat) backups bhi import ho jaate hain.
- Migration ab global keys bhi IndexedDB mein le aati hai.
- Restore se pehle file **parse + validate** hoti hai: corrupt/ galat/ khaali file par
  kuch delete nahi hota, saaf error dikhta hai.
- Restore ke baad **commit verify** hota hai, phir hi reload.
- Do mode: **REPLACE ALL** (current data hata kar backup) aur **MERGE**
  (backup ka data current data ke saath jodo — naya device + purana backup milaane ke liye).
- Restore se pehle summary dikhti hai: file, size, keys, companies, export date.

---

## ✅ Test kaise karein
Repo mein automated tests hain jo app ko **real browser-jaise environment (jsdom) + real
IndexedDB** mein chalaate hain — app ka apna code, koi duplicate logic nahi:

```bash
npm install        # sirf dev-dependencies (jsdom, fake-indexeddb)
npm test           # 20 tests: company add/switch/rename/delete, backup, restore,
                   # corrupt file, merge, storage status, compact, purge, entry save
```

## 🚀 Deploy / chalana
```bash
npm start          # http://localhost:3000
```
- **Railway / Render:** start command `npm start`
- **Vercel:** root par `index.html` hai, `vercel.json` ready hai — kuch extra nahi karna.
- Note: `index.html` aur `Chandra_bill - Copy.html` **identical** rakhe jaate hain
  (test bhi yeh check karta hai), taaki kaun si bhi file kholein — same fixed app mile.

## 📦 Data kahan rehta hai?
- 100% **aapke browser/device** mein — IndexedDB database `ChandraERP_DB`.
- Server par kuch nahi jaata. Backup file aap khud download karte hain (`.bak`).
- Har company ka data alag keys mein: `erp_<Company>_<date>_<session>_<party>_<type>_<sem>`.
- Backup/restore: **Tools > BACKUP & RESTORE**. Storage info: **Tools > STORAGE STATUS**.

## 🔓 Login / activation
Koi password, PIN, device code ya license key nahi — app khulte hi seedha dashboard.
