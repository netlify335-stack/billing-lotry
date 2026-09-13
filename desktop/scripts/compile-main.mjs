/* Main-process source (electron/src/main.js) ko V8 bytecode (electron/main.jsc)
   mein compile karta hai — Electron ke andar wale exact V8 ke saath.
   bytenode khud electron executable spawn karta hai. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const bytenode = require('bytenode');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, '..');
const src = path.join(DESKTOP, 'electron', 'src', 'main.js');
const out = path.join(DESKTOP, 'electron', 'main.jsc');

if (!fs.existsSync(src)) {
    console.error('Source missing:', src);
    process.exit(1);
}

(async () => {
    // electronMain: Electron >= 42 / V8 >= 14.8 ke liye zaroori
    await bytenode.compileFile({
        filename: src,
        output: out,
        electron: true,
        electronMain: true,
        compileAsModule: true
    });
    const kb = (fs.statSync(out).size / 1024).toFixed(1);
    console.log(`Compiled main.js -> main.jsc (${kb} KB)`);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
