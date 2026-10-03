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
    '.mp3': 'audio/mpeg',
};

http.createServer((req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.join(root, pathname);
    if (path.relative(root, file).startsWith('..')) {
        res.writeHead(403).end();
        return;
    }
    fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
            return;
        }
        const headers = {
            'Content-Type': types[path.extname(file)] || 'application/octet-stream',
            'Cache-Control': 'no-store',
            'Accept-Ranges': 'bytes',
        };
        // Teilabrufe (Range) braucht der Audio-Player zum Spulen und Wiederholen
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
        let from = 0;
        let to = stat.size - 1;
        let status = 200;
        if (range && (range[1] || range[2])) {
            if (range[1]) {
                from = Number(range[1]);
                if (range[2]) to = Math.min(Number(range[2]), to);
            } else {
                from = Math.max(0, stat.size - Number(range[2]));
            }
            if (from > to) {
                res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
                return;
            }
            status = 206;
            headers['Content-Range'] = `bytes ${from}-${to}/${stat.size}`;
        }
        headers['Content-Length'] = to - from + 1;
        res.writeHead(status, headers);
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        fs.createReadStream(file, { start: from, end: to }).pipe(res);
    });
}).listen(port, () => console.log(`Brettspiele läuft auf http://localhost:${port}`));
