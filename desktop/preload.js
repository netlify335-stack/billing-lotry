/**
 * =====================================================================
 * Chandra ERP — PRELOAD SCRIPT (Electron)
 * =====================================================================
 * Renderer (index.html) ko sirf ek safe, chhota-sa API surface deta hai:
 *     window.desktopAPI = { isDesktop, versions(), db {...}, onBeforeClose() }
 *
 *  * contextIsolation ON, nodeIntegration OFF — page ke JS ko Node ka
 *    direct access NAHI (security).
 *  * Saara DB kaam main process mein better-sqlite3 se hota hai; yahan
 *    sirf ipcRenderer.invoke bridge hai.
 *  * Browser/web version mein yeh file load hi nahi hoti — isliye
 *    index.html bina desktopAPI ke IndexedDB mode mein chalta rehta hai.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
    isDesktop: true,

    /** Version info (diagnostics ke liye). */
    versions: () => ({
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome
    }),

    /**
     * SQLite data-access bridge.
     * Store engine (index.html) isi ko IndexedDB ki jagah use karta hai:
     *   loadAll()        -> [[key, value], ...]
     *   get(key)         -> value | null
     *   writeBatch(rows) -> ek transaction mein put/delete (null = delete)
     *   diskInfo()       -> { usage, quota } (STORAGE STATUS bar ke liye)
     *   dbPath()         -> database file kahan hai (info ke liye)
     */
    db: {
        loadAll: () => ipcRenderer.invoke('db:loadAll'),
        get: (key) => ipcRenderer.invoke('db:get', key),
        writeBatch: (entries) => ipcRenderer.invoke('db:writeBatch', entries),
        diskInfo: () => ipcRenderer.invoke('db:diskInfo'),
        dbPath: () => ipcRenderer.invoke('db:path')
    },

    /**
     * Window band hone se PEHLE main process 'app:before-close' bhejta hai.
     * Renderer apne pending writes flush karke 'app:flush-done' reply karta
     * hai — tabhi window band hoti hai. Isse close/crash par data loss nahi.
     * @param {() => Promise<void>} handler
     */
    onBeforeClose: (handler) => {
        ipcRenderer.on('app:before-close', async () => {
            try { await handler(); } catch (e) { /* flush fail bhi ho to window rukni nahi chahiye */ }
            try { ipcRenderer.send('app:flush-done'); } catch (e) {}
        });
    }
});
