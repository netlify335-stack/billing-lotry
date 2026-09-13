/* Artifact chunk/assemble — GitHub par 100MB file limit hoti hai, isliye
   build outputs ko chhote chunks mein todo / wapas jodo (sha256 verify).
   Usage:
     node scripts/artifact.mjs chunk  <outDir> <file ...>
     node scripts/artifact.mjs assemble <manifestDir or manifest.json> <outDir>
*/
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHUNK = 45 * 1024 * 1024; // 45 MB — safe under every git/GitHub limit

function sha256(file) {
    const h = crypto.createHash('sha256');
    h.update(fs.readFileSync(file));
    return h.digest('hex');
}

function safeName(name) {
    return name.replace(/[^A-Za-z0-9._-]+/g, '_');
}

function chunk(outDir, files) {
    fs.mkdirSync(outDir, { recursive: true });
    const manifest = { tool: 'chandra-artifact', version: 1, createdAt: new Date().toISOString(), files: [] };
    for (const file of files) {
        const abs = path.resolve(file);
        const name = path.basename(abs);
        const size = fs.statSync(abs).size;
        const hash = sha256(abs);
        const total = Math.ceil(size / CHUNK);
        const base = safeName(name);
        const fd = fs.openSync(abs, 'r');
        for (let i = 0; i < total; i++) {
            const buf = Buffer.alloc(Math.min(CHUNK, size - i * CHUNK));
            fs.readSync(fd, buf, 0, buf.length, i * CHUNK);
            const part = `${base}.part${String(i).padStart(3, '0')}`;
            fs.writeFileSync(path.join(outDir, part), buf);
            process.stdout.write('.');
        }
        fs.closeSync(fd);
        manifest.files.push({ name, size, sha256: hash, chunks: total, partPrefix: base + '.part' });
        console.log(` ${name} -> ${total} chunks (${(size / 1048576).toFixed(1)} MB)`);
    }
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log('manifest written:', path.resolve(outDir, 'manifest.json'));
}

async function assemble(manifestArg, outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    const manifestPath = fs.statSync(manifestArg).isDirectory()
        ? path.join(manifestArg, 'manifest.json') : manifestArg;
    const dir = path.dirname(manifestPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const f of manifest.files) {
        const out = path.join(outDir, f.name);
        await new Promise((resolve, reject) => {
            const ws = fs.createWriteStream(out);
            ws.on('error', reject);
            ws.on('finish', resolve);
            for (let i = 0; i < f.chunks; i++) {
                const p = path.join(dir, `${f.partPrefix}${String(i).padStart(3, '0')}`);
                if (!fs.existsSync(p)) throw new Error('missing chunk: ' + p);
                ws.write(fs.readFileSync(p));
            }
            ws.end();
        });
        const h = crypto.createHash('sha256');
        h.update(fs.readFileSync(out));
        const got = h.digest('hex');
        if (got !== f.sha256) throw new Error(`sha mismatch for ${f.name}: ${got} != ${f.sha256}`);
        const stat = fs.statSync(out);
        if (stat.size !== f.size) throw new Error(`size mismatch for ${f.name}`);
        console.log(`OK ${f.name} (${(stat.size / 1048576).toFixed(1)} MB) sha256 verified`);
    }
}

const [cmd, ...rest] = process.argv.slice(2);
(async () => {
    if (cmd === 'chunk') chunk(rest[0], rest.slice(1));
    else if (cmd === 'assemble') await assemble(rest[0], rest[1]);
    else { console.error('usage: artifact.mjs chunk|assemble ...'); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
