// ═══════════════════════════════════════════════════════════════════════════
// 📐 Market Structure (v26) — TAMBAHAN program ini. Analisa dijalankan oleh kode Python ASLI (msa_py/, tanpa diubah)
// sebagai proses terpisah; route ini hanya meneruskan request apa adanya:
//   POST /api/msa/screen, POST /api/msa/check, GET /api/screener/job/:id   (nama endpoint sama dengan program asli)
// Tambahan: GET /api/msa/store/status (progres gudang candle), GET /api/msa/symbols (daftar koin di gudang),
//           GET /api/msa/ui (halaman HTML/JS asli untuk WebView), POST/GET /api/msa/png (simpan gambar di HP).
// ═══════════════════════════════════════════════════════════════════════════
import { Router, type Request, type Response } from 'express';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { logger } from '../lib/logger';
import { msaStatus, startMsaStore } from '../lib/msa-store';

const router = Router();
// folder artifacts/api-server: cari ke atas dari file ini (dist/index.mjs saat jalan, src/routes/msa.ts saat tes)
const API_DIR = (() => {
  let d = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) { if (fs.existsSync(path.join(d, 'msa_py'))) return d; d = path.dirname(d); }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
})();
const PY_DIR = path.join(API_DIR, 'msa_py');
const WEB_DIR = path.join(API_DIR, 'msa_web');
const DATA_DIR = process.env['MSA_DATA_DIR'] ?? path.join(API_DIR, 'msa_data');
const PY_PORT = Number(process.env['MSA_PORT'] ?? 8791);
const PY_URL = `http://127.0.0.1:${PY_PORT}`;

// ─── proses Python (dinyalakan & dijaga oleh api-server) ───
let py: ChildProcess | null = null;
let pyReady = false;
function startPython(): void {
  const bin = process.env['MSA_PYTHON'] ?? 'python3';
  py = spawn(bin, ['serve.py'], { cwd: PY_DIR, env: { ...process.env, MSA_PORT: String(PY_PORT), MSA_DATA_DIR: DATA_DIR }, stdio: ['ignore', 'pipe', 'pipe'] });
  py.stdout?.on('data', (d: Buffer) => { const s = d.toString().trim(); if (s) logger.info({ msaPy: s }, 'MSA python'); if (s.includes('siap')) pyReady = true; });
  py.stderr?.on('data', (d: Buffer) => { const s = d.toString().trim(); if (s) logger.warn({ msaPy: s }, 'MSA python stderr'); });
  py.on('exit', (code) => {
    pyReady = false; py = null;
    logger.warn({ code }, 'MSA python berhenti, dinyalakan ulang 5 detik lagi');
    setTimeout(startPython, 5000);
  });
  py.on('error', (err) => { logger.error({ err }, 'MSA python gagal dijalankan (python3 + numpy ada?)'); });
}
export function startMarketStructure(): void {
  if (!fs.existsSync(path.join(PY_DIR, 'serve.py'))) { logger.warn({ PY_DIR }, 'MSA: folder msa_py tidak ditemukan'); return; }
  startPython();
  startMsaStore(DATA_DIR, async () => {
    try { await fetch(`${PY_URL}/reload`, { method: 'POST' }); } catch { /* python belum siap */ }
  });
}

async function proxy(req: Request, res: Response): Promise<void> {
  if (!pyReady) { res.status(503).json({ detail: 'layanan Market Structure (Python) belum siap, coba lagi sebentar' }); return; }
  try {
    const r = await fetch(`${PY_URL}${req.originalUrl}`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: req.method === 'POST' ? JSON.stringify(req.body ?? {}) : undefined,
    });
    const text = await r.text();
    res.status(r.status).type('application/json').send(text);
  } catch (err) {
    res.status(502).json({ detail: `layanan Market Structure tidak menjawab: ${err instanceof Error ? err.message : String(err)}` });
  }
}

router.post('/msa/screen', proxy);
router.post('/msa/check', proxy);
router.get('/screener/job/:id', proxy);

router.get('/msa/store/status', (_req, res) => { res.json({ ...msaStatus, pythonReady: pyReady }); });

router.get('/msa/symbols', (_req, res) => {
  try {
    const syms = [...new Set(fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.npz')).map(f => f.replace(/_\w+\.npz$/, '')))].sort();
    res.json({ symbols: syms });
  } catch { res.json({ symbols: [] }); }
});

// ─── halaman HTML/JS asli (WebView) ───
const ASSETS: Record<string, string> = {
  'style.css': 'text/css', 'helpers.js': 'application/javascript', 'msacard.js': 'application/javascript',
  'app_market_structure.js': 'application/javascript', 'bridge.js': 'application/javascript',
};
router.get('/msa/ui', (_req, res) => {
  try {
    const shell = fs.readFileSync(path.join(WEB_DIR, 'shell.html'), 'utf8');
    const section = fs.readFileSync(path.join(WEB_DIR, 'index_market_structure.html'), 'utf8'); // file asli, tanpa diubah
    res.type('text/html').send(shell.replace('<!--MSA_SECTION-->', section));
  } catch (err) { res.status(500).send(`halaman Market Structure tidak ditemukan: ${err instanceof Error ? err.message : String(err)}`); }
});
router.get('/msa/ui/:file', (req, res) => {
  const f = req.params['file'] ?? '';
  const type = ASSETS[f];
  if (!type) { res.status(404).send('not found'); return; }
  res.type(type).send(fs.readFileSync(path.join(WEB_DIR, f), 'utf8'));
});

// ─── simpan gambar PNG di HP: WebView mengirim PNG, HP membuka URL ini di browser (layar penuh, tekan lama -> simpan) ───
const pngStore = new Map<string, { at: number; buf: Buffer; name: string }>();
router.post('/msa/png', (req, res) => {
  const m = /^data:image\/png;base64,(.+)$/.exec(String((req.body as { dataUrl?: string })?.dataUrl ?? ''));
  if (!m) { res.status(400).json({ detail: 'gambar tidak valid' }); return; }
  for (const [k, v] of pngStore) if (Date.now() - v.at > 30 * 60_000) pngStore.delete(k);
  const id = crypto.randomBytes(8).toString('hex');
  pngStore.set(id, { at: Date.now(), buf: Buffer.from(m[1]!, 'base64'), name: String((req.body as { name?: string })?.name ?? 'market_structure.png').replace(/[^\w.-]/g, '_') });
  res.json({ id, url: `/api/msa/png/${id}` });
});
router.get('/msa/png/:id', (req, res) => {
  const x = pngStore.get(req.params['id'] ?? '');
  if (!x) { res.status(404).send('gambar sudah kedaluwarsa, unduh ulang dari aplikasi'); return; }
  res.type('image/png').setHeader('Content-Disposition', `inline; filename="${x.name}"`);
  res.send(x.buf);
});

export default router;
