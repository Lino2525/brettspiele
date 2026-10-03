// Minimaler lokaler Webserver ohne Abhängigkeiten:  node serve.js  ->  http://localhost:8080
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8080;
const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.join(root, pathname);
    if (path.relative(root, file).startsWith('..')) {
        res.writeHead(403).end();
        return;
    }
    fs.readFile(file, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
            return;
        }
        res.writeHead(200, {
            'Content-Type': types[path.extname(file)] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        res.end(data);
    });
}).listen(port, () => console.log(`Brettspiele läuft auf http://localhost:${port}`));
