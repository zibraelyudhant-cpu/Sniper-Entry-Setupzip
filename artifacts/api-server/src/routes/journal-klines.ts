import { Router } from 'express';
import { binanceWeightGate, noteBinanceWeight } from '../lib/smc';

// ═══════════════════════════════════════════════════════════════════════════
// v27 (request user 2026-11-13): candle untuk penilaian Jurnal diambil lewat server.
// Sebelumnya HP memanggil fapi.binance.com langsung; kalau gagal (diblokir jaringan/browser),
// sinyal diam-diam tetap PENDING. Endpoint ini hanya meneruskan klines Binance Futures APA ADANYA
// (bentuk array sama persis), tanpa logika penilaian. Rem weight Binance sama dengan menu scan.
//   GET /api/journal-klines?symbol=AIOTUSDT&interval=15m&startTime=..&endTime=..&limit=..
// ═══════════════════════════════════════════════════════════════════════════
const router = Router();
const INTERVALS = new Set(['1m', '5m', '15m', '30m', '1h', '4h']);

router.get('/journal-klines', async (req, res) => {
  const symbol = String(req.query['symbol'] ?? '').toUpperCase();
  const interval = String(req.query['interval'] ?? '');
  const startTime = Number(req.query['startTime']);
  const endTime = Number(req.query['endTime']);
  const limit = Math.min(1500, Math.max(1, Number(req.query['limit'] ?? 500) || 500));
  if (!/^[A-Z0-9]{2,30}$/.test(symbol)) { res.status(400).json({ error: 'symbol tidak valid' }); return; }
  if (!INTERVALS.has(interval)) { res.status(400).json({ error: `interval tidak dikenal: ${interval}` }); return; }
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) { res.status(400).json({ error: 'startTime/endTime tidak valid' }); return; }
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${Math.floor(startTime)}&endTime=${Math.floor(endTime)}&limit=${limit}`;
  try {
    await binanceWeightGate();
    const r = await fetch(url);
    noteBinanceWeight(r);
    const text = await r.text();
    if (!r.ok) { res.status(502).json({ error: `Binance ${r.status}: ${text.slice(0, 200)}` }); return; }
    res.type('application/json').send(text);
  } catch (err) {
    res.status(502).json({ error: `Binance tidak bisa diakses dari server: ${err instanceof Error ? err.message : String(err)}` });
  }
});

export default router;
