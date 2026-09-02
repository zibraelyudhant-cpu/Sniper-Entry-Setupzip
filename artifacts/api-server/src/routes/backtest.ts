import { Router } from 'express';
import { runBacktest } from '../lib/smc';

const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
const router = Router();

// GET /api/backtest/listing-info?symbol=BTCUSDT
// Return: berapa lama koin sudah listing di Binance Futures
router.get('/backtest/listing-info', async (req, res) => {
  const symbol = (req.query['symbol'] as string)?.toUpperCase();
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }

  try {
    const url = `${BINANCE_FUTURES_BASE}/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=1&startTime=0`;
    const r = await fetch(url);
    if (!r.ok) { res.status(500).json({ error: 'Gagal fetch Binance' }); return; }
    const data: number[][] = await r.json();
    if (!data.length) { res.status(404).json({ error: 'Data tidak ditemukan' }); return; }

    const listingTimestamp = data[0]![0]!;
    const listingDate = new Date(listingTimestamp);
    const now = Date.now();
    const diffMs = now - listingTimestamp;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);
    const h1Candles = Math.floor(diffMs / (1000 * 60 * 60));

    let ageLabel: string;
    if (diffDays < 30) ageLabel = `${diffDays} hari`;
    else if (diffMonths < 12) ageLabel = `${diffMonths} bulan`;
    else ageLabel = `${diffYears} tahun ${diffMonths % 12} bulan`;

    res.json({
      symbol, listingTimestamp,
      listingDate: listingDate.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }),
      diffDays, diffMonths, diffYears, h1Candles, ageLabel,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /api/backtest — request user "sekalian diperbarui": GANTI TOTAL ke
// Python vectorized (pandas/numpy). Semua logic (fetch multi-TF, spawn
// subprocess, fix EPIPE) SEKARANG DI SATU TEMPAT DOANG (lib/smc.ts,
// fungsi runBacktest) — route ini CUMA manggil, TIDAK PUNYA implementasi
// duplikat sendiri lagi (BUG SEBELUMNYA: route ini sempat punya salinan
// runPythonBacktest+fetchKlinesLong SENDIRI yang gak ke-update pas smc.ts
// diperbaiki — itu kenapa fix EPIPE gak kepakai, bikin server tetep crash).
router.post('/backtest', async (req, res) => {
  const { symbol, period, menu } = req.body as {
    symbol: string;
    period: '1m' | '3m' | '6m' | '1y' | '2y' | '3y';
    menu: 'structural' | 'scalping15m' | 'counter_scalping' | 'both';
  };

  if (!symbol || !period || !menu) {
    res.status(400).json({ error: 'symbol, period, dan menu required' });
    return;
  }

  const normalized = symbol.toUpperCase().endsWith('USDT')
    ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;

  try {
    const result = await runBacktest(normalized, period, menu);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;