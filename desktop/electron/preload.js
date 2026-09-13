'use strict';

/* Sandboxed preload — renderer (app code) ko Node access NAHI milta.
   Sirf safe metadata + error collection expose hoti hai. */
const { contextBridge } = require('electron');

function argValue(name) {
    const prefix = '--' + name + '=';
    const found = (process.argv || []).find((a) => a.startsWith(prefix));
    return found ? found.slice(prefix.length) : '';
}

const errors = [];
window.addEventListener('error', (e) => {
    try { errors.push(String((e && e.message) || e)); } catch { /* ignore */ }
});
window.addEventListener('unhandledrejection', (e) => {
    try { errors.push('UnhandledPromise: ' + String((e && e.reason && e.reason.message) || (e && e.reason) || e)); } catch { /* ignore */ }
});

contextBridge.exposeInMainWorld('CHANDRA_DESKTOP', {
    isDesktop: true,
    version: argValue('app-version') || '10.0.0',
    dev: argValue('app-dev') === '1',
    platform: process.platform,
    getErrors: () => errors.slice()
});
