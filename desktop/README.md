# Chandra ERP Billing — Windows Offline Desktop App

Billing website (`../index.html`) ko ek **100% offline Windows desktop app** mein
pack karta hai. Koi internet, koi online database nahi — saara data laptop ke andar
**IndexedDB** mein rehta hai, disk jitni free ho utni jagah (koi 2GB/5MB limit nahi).

## App kya karti hai (warranty-level points)

- **Offline:** app ka ek bhi resource internet se nahi aata. Website ki akeli online
  cheez (pdf.js CDN) ko local `app/vendor/` mein bundle kar diya gaya hai. Build ke
  baad HTML mein koi `http://` / `https://` URL na bache — yeh build script khud check
  karti hai.
- **Unlimited local DB:** Chromium ka IndexedDB, `%APPDATA%\Chandra ERP Billing\` ke
  andar. Persistent-storage permission app khud grant kar deti hai.
- **Source protected:**
  - Renderer ka poora business logic **javascript-obfuscator** se obfuscate hota hai
    (globals/inline handlers preserve; control-flow-flattening & dead-code **jaan-bujh
    kar off** taaki app smooth rahe, freeze na ho).
  - Electron ka main-process code **V8 bytecode (`.jsc`, bytenode)** mein compile hota
    hai — sirf bytecode package hota hai, `.js` source nahi.
  - Sab kuch **asar archive** mein band hota hai.
- **Freeze fixes (purani employee wali app ke issues):**
  - renderer backgrounding / timer-throttling / Windows occlusion detection band
  - render-process crash par auto reload, 20s unresponsive par safe Reload dialog
  - downloads ke liye native Save dialog, window ki position/size yaad rehti hai
  - single instance, strict Content-Security-Policy, bahar ke links/popups blocked

## Build outputs

| File | Matlab |
|---|---|
| `ChandraERPBilling-Setup-10.0.0.exe` | Installer (Start Menu/Desktop shortcut, install folder chuno) |
| `ChandraERPBilling-Portable-10.0.0.exe` | Single-file portable — pendrive se bhi chalao, install nahi chahiye |

Dono ka data same jagah (`%APPDATA%\Chandra ERP Billing`) rehta hai.

## Local development / build (Windows/Linux/Mac — sirf build machine par)

```bash
cd desktop
npm install
npm run build:renderer     # ../index.html -> app/index.html (offline + obfuscated)
npm run test:renderer      # obfuscated app ko jsdom + real IndexedDB mein test
npm run compile            # main process -> electron/main.jsc (bytecode)
npm run dist:win           # Windows installer + portable exe (Windows par best)
npm run dev                # source mode mein live app (debug)
npm run smoke              # headless self-test (CI; xvfb ke saath)
```

> Windows `.exe` Windows (ya CI Windows runner) par banta hai. Is repo mein
> GitHub Actions workflow (`.github/workflows/desktop-build.yml`) push hote hi Windows
> build karke installer/portable dono bana deta hai.

## Data safety (end user ko bata dein)

1. Har hafte app ke **Tools → BACKUP & RESTORE → EXPORT** se `.bak` nikalein.
2. `.bak` pendrive/email par rakhein.
3. Naya laptop: app install karke wahi `.bak` RESTORE kar dein.
4. App uninstall karne par bhi data delete nahi hota (`deleteAppDataOnUninstall: false`).
