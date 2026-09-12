# Chandra Agency ERP — Billing System (V9.6 Fixed)

Single-file billing/ERP app jo ab **Railway aur Vercel dono pe deploy** ho jaata hai,
aur **storage-full crash** se bhi fix ho gaya hai.

## 🔴 Purani problems (jo fix ho gayi)

### 1. Deploy fail kyu ho raha tha?
- Repo mein sirf `Chandra_bill - Copy.html` tha — Railway ko **start command** chahiye aur
  Vercel ko root pe **`index.html`** chahiye. Dono kuch nahi milta tha isliye error aata tha.
- **Fix:** `index.html` + `server.js` (zero-dependency Node server) + `package.json` + `vercel.json` add kar diye.

### 2. "10MB / 50MB resources ke baad band ho jaata hai" — yeh error kya hai?
Yeh **browser ka localStorage quota limit** hai. Har website ko browser sirf **~5–10MB** storage
deta hai. Aapka app har entry ko do baar save karta tha (bucket + raw format) aur result files
ka poora HTML bhi isi mein jaata tha. Quota full hone par:
- Kuch writes **chupchaap fail** ho jaate the ("SAVED" dikhta tha par data save nahi hota tha)
- Kuch direct `localStorage` calls **crash** Maar dete the (blank screen / app band)

**Fix (V9.6):** Poora data ab **IndexedDB** mein jaata hai — same browser, par limit
**100s of MB / GBs** (aapki disk jitni khane pe mil jaati hai). Purana data pehli baar
khulte hi **automatically migrate** ho jaata hai, kuch delete nahi hota. Agar IndexedDB
available na ho to app pehle jaise localStorage pe chalti rahegi (fallback mode).

## ✅ Naya kya hai
- **STORAGE STATUS** tool (Tools panel mein): kitna storage use hua, browser quota,
  purani entries/results delete karke space free karne ke buttons.
- Backup/restore ab bhi Tools > BACKUP & SYNC mein — ab naye engine ke saath.
- Save tab-band hone se pehle automatically flush hota hai (data loss ka risk kam).

## 🚀 Deploy kaise karein

### Railway
1. GitHub repo connect karo (New Project → Deploy from GitHub repo).
2. Railway automatically Node detect karega aur `npm start` chalayega. **Koi build command set karne ki zarurat nahi.**
3. Bas. App `PORT` environment variable pe auto chal jaata hai.

### Vercel
1. Import project from GitHub (framework preset: **Other** — auto detect ho jaata hai).
2. Koi build command nahi, koi output directory nahi chahiye.
3. Deploy. `vercel.json` pehle se configured hai.

### Local test
```bash
npm start
# ya phir directly:
node server.js
# phir browser mein: http://localhost:3000
```

Ya bina server ke bhi: `index.html` ko seedha browser mein kholo (file:// pe bhi chalega,
localStorage fallback mode mein).

## 📁 Files
| File | Kaam |
|---|---|
| `index.html` | **Main app (V9.6 fixed)** — yahi deploy hota hai |
| `Chandra_bill - Copy.html` | Purana original (reference ke liye rakha hai) |
| `server.js` | Zero-dependency static server (Railway/Node hosts ke liye) |
| `package.json` | Node start script (`npm start`) |
| `vercel.json` | Vercel static deploy config |

## 💡 Aage kya add karna chahiye (suggestions)
1. **Auto daily backup** — roz ka data automatic JSON file mein download/reminder.
2. **WhatsApp share button** — bill/report seedha party ko WhatsApp pe bhejo.
3. **Print/PDF bill** — browser print se proper invoice layout.
4. **CSV/Excel export** — reports ko Excel mein kholne ke liye.
5. **PIN/password lock** — galat haath se data bachane ke liye screen lock.
6. **Cloud sync (Firebase/Supabase)** — do alag device pe same data (abhi data sirf ek browser mein rehta hai).
7. **Monthly dashboard/chart** — kitna sale hua, kitna return, party-wise graph.
8. **Purana data auto-archive** — 6 mahine+ purana data alag file mein — app fast rahega.
