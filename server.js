/**
 * Chandra ERP - Zero-dependency static file server.
 * Railway / Render / kisi bhi Node host pe chalne ke liye.
 * Start: npm start  (ya: node server.js)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json'
};

const server = http.createServer((req, res) => {
    let urlPath;
    try {
        urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch (e) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('400 Bad Request');
    }

    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

    // Path traversal se bachav
    let filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('403 Forbidden');
    }

    fs.stat(filePath, (err, stat) => {
        if (!err && stat.isDirectory()) {
            filePath = path.join(filePath, 'index.html');
        }

        fs.readFile(filePath, (readErr, data) => {
            if (readErr) {
                // SPA-style fallback: koi bhi unknown route -> index.html
                const indexPath = path.join(ROOT, 'index.html');
                fs.readFile(indexPath, (idxErr, idxData) => {
                    if (idxErr) {
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        return res.end('404 Not Found (index.html missing?)');
                    }
                    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
                    res.end(idxData);
                });
                return;
            }

            const ext = path.extname(filePath).toLowerCase();
            const headers = {
                'Content-Type': MIME[ext] || 'application/octet-stream'
            };
            // HTML kabhi cache na ho - updates turant dikhein
            headers['Cache-Control'] = ext === '.html' || ext === '.htm' ? 'no-cache' : 'public, max-age=3600';
            res.writeHead(200, headers);
            res.end(data);
        });
    });
});

server.listen(PORT, HOST, () => {
    console.log(`Chandra ERP server chal raha hai: http://${HOST}:${PORT}`);
});
