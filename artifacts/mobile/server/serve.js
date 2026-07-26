/**
 * Standalone production server — serve hasil `expo export --platform web`.
 * Web app biasa: buka domain apa aja, langsung dapet app-nya (bukan QR/Expo Go lagi).
 * Zero external dependencies — cuma Node.js built-in (http, fs, path).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const STATIC_ROOT = path.resolve(__dirname, '..', 'dist');
const basePath = (process.env.BASE_PATH || '/').replace(/\/+$/, '');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json',
};

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'content-type': contentType });
  res.end(content);
}

function serveStatic(urlPath, res) {
  const safePath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, '');
  let filePath = path.join(STATIC_ROOT, safePath);

  if (!filePath.startsWith(STATIC_ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // File statis ada (JS, CSS, gambar, font, dll) → serve langsung
  if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
    serveFile(filePath, res);
    return;
  }

  // Route SPA (misal /calculator, /sniper) yang gak match file fisik →
  // fallback ke index.html biar expo-router client-side routing yang nanganin
  const indexPath = path.join(STATIC_ROOT, 'index.html');
  if (fs.existsSync(indexPath)) {
    serveFile(indexPath, res);
    return;
  }

  res.writeHead(404);
  res.end('Not Found — jalankan `pnpm run build` dulu buat generate folder dist/');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || '/';
  }

  serveStatic(pathname, res);
});

const port = parseInt(process.env.PORT || '3000', 10);
server.listen(port, '0.0.0.0', () => {
  console.log(`Serving web app (dist/) on port ${port}`);
});