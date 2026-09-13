/* =========================================================================
 * Renderer build: repo-root index.html  ->  desktop/app/index.html
 *  1. CDN pdf.js ki jagah local vendor files (100% offline)
 *  2. Inline business-logic script ko obfuscate karta hai (source na dikhe)
 *     - globals/HTML inline handlers preserve (renameGlobals:false)
 *     - control-flow-flattening / dead-code OFF -> smooth, no freeze
 *  3. Verify: koi http(s) URL na bache
 * ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JsObf = require('javascript-obfuscator');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, '..');
const ROOT = path.resolve(DESKTOP, '..');

const SRC_HTML = path.join(ROOT, 'index.html');
const OUT_HTML = path.join(DESKTOP, 'app', 'index.html');
const VENDOR_DIR = path.join(DESKTOP, 'app', 'vendor');
const PDF_DIR = path.join(DESKTOP, 'node_modules', 'pdfjs-dist', 'build');

const log = (...a) => console.log('[build-renderer]', ...a);

function copyVendor() {
    fs.mkdirSync(VENDOR_DIR, { recursive: true });
    const files = [
        ['pdf.min.js', 'pdf.min.js'],
        ['pdf.worker.min.js', 'pdf.worker.min.js']
    ];
    for (const [from, to] of files) {
        const src = path.join(PDF_DIR, from);
        if (!fs.existsSync(src)) throw new Error('pdfjs-dist vendor missing: ' + src + ' (npm install pdfjs-dist in repo root)');
        fs.copyFileSync(src, path.join(VENDOR_DIR, to));
    }
    log('vendor pdf.js copied (offline)');
}

function buildHtml() {
    let html = fs.readFileSync(SRC_HTML, 'utf8');

    const cdnTag = '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js"></script>';
    if (!html.includes(cdnTag)) throw new Error('CDN pdf.js tag source HTML mein nahi mila — build abort (source change?)');
    const localTags = [
        '<script src="vendor/pdf.min.js"></script>',
        '<script>try{if(window.pdfjsLib){pdfjsLib.GlobalWorkerOptions.workerSrc="vendor/pdf.worker.min.js";}}catch(e){}</script>'
    ].join('\r\n    ');
    html = html.replace(cdnTag, localTags);

    // Sabse bada <script> ... </script> block = business logic
    const blocks = [];
    const re = /<script>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html)) !== null) blocks.push({ start: m.index, end: re.lastIndex, code: m[1] });
    if (!blocks.length) throw new Error('Koi inline script block nahi mila');
    blocks.sort((a, b) => b.code.length - a.code.length);
    const main = blocks[0];
    log('main app script size:', (main.code.length / 1024).toFixed(1), 'KB');

    const t0 = Date.now();
    const result = JsObf.obfuscate(main.code, {
        target: 'browser',
        compact: true,
        simplify: true,
        renameGlobals: false,                 // CRITICAL: inline onclick="" handlers chalte rahein
        identifierNamesGenerator: 'mangled',
        identifiersDictionary: [],
        numbersToExpressions: true,
        splitStrings: true,
        splitStringsChunkLength: 14,
        stringArray: true,
        stringArrayCallsTransform: true,
        stringArrayCallsTransformThreshold: 0.5,
        stringArrayEncoding: ['base64'],
        stringArrayIndexShift: true,
        stringArrayRotate: true,
        stringArrayShuffle: true,
        stringArrayWrappersCount: 2,
        stringArrayWrappersChainedCalls: true,
        stringArrayWrappersParametersMaxCount: 4,
        stringArrayWrappersType: 'function',
        stringArrayThreshold: 0.8,
        // Performance / stability — ye sab deliberately OFF (purani app isliye jamti thi)
        controlFlowFlattening: false,
        controlFlowFlatteningThreshold: 0,
        deadCodeInjection: false,
        deadCodeInjectionThreshold: 0,
        selfDefending: false,
        debugProtection: false,
        disableConsoleOutput: false,
        transformObjectKeys: false,
        unicodeEscapeSequence: false,
        reservedNames: [
            // globals jo HTML handlers / runtime expect karte hain
            'pdfjsLib', 'CHANDRA_DESKTOP'
        ],
        reservedStrings: [],
        sourceMap: false,
        sourceMapMode: 'separate'
    });
    const obf = result.getObfuscatedCode();
    log('obfuscated in', ((Date.now() - t0) / 1000).toFixed(1), 's ->', (obf.length / 1024).toFixed(1), 'KB');

    html = html.slice(0, main.start) + '<script>\r\n' + obf + '\r\n</script>' + html.slice(main.end);

    // Offline guard: koi bhi online URL bachna nahi chahiye
    const urls = html.match(/https?:\/\/[^\s"'`)<>]+/g) || [];
    const allowed = urls.filter((u) => !/^https?:\/\/(www\.w3\.org|localhost|127\.0\.0\.1)/i.test(u));
    if (allowed.length) throw new Error('Offline guard fail — online URLs mile:\n' + [...new Set(allowed)].join('\n'));

    fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });
    fs.writeFileSync(OUT_HTML, html, 'utf8');
    log('written:', path.relative(ROOT, OUT_HTML), (html.length / 1024).toFixed(1), 'KB');
}

copyVendor();
buildHtml();
log('DONE');
