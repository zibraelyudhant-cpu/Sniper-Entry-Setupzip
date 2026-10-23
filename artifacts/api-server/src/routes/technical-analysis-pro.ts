import { Router } from 'express';
import {
  analyzeTrendIdentification, analyzeMultiTFReading, analyzeSnrZones,
  analyzeLongShortScore, analyzeDivergenceTrend, analyzeBtcCorrelation, fetchKlines,
  TA_PRO_CANDLE_LIMIT,
} from '../lib/smc';
import type { TFLabelV2 } from '../lib/smc';

const router = Router();

function normalizeSymbol(raw: string): string {
  const up = raw.toUpperCase();
  return up.endsWith('USDT') ? up : `${up}USDT`;
}

// BARU (request user): M1 ditambahin sebagai opsi TF, dipasangin ke
// TA_PRO_CANDLE_LIMIT (default fetch candle standar, lihat definisinya di
// lib/smc) -- Fitur 1/3/4/6 bisa milih TF ini sekarang.
const TF_TO_INTERVAL: Record<string, string> = {
  D1: '1d', H4: '4h', H1: '1h', M30: '30m', M15: '15m', M5: '5m', M1: '1m',
};
const TF_REQUIRED_MSG = 'tf required (D1/H4/H1/M30/M15/M5/M1)';

// GET /api/technical-analysis-pro/trend?symbol=BTCUSDT&tf=H4 -- FITUR 1
router.get('/technical-analysis-pro/trend', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  const tf = req.query['tf'] as string;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  if (!tf || !TF_TO_INTERVAL[tf]) { res.status(400).json({ error: TF_REQUIRED_MSG }); return; }
  try {
    const normalized = normalizeSymbol(symbol);
    const k = await fetchKlines(normalized, TF_TO_INTERVAL[tf]!, TA_PRO_CANDLE_LIMIT[tf as keyof typeof TA_PRO_CANDLE_LIMIT]);
    const result = analyzeTrendIdentification(k.opens, k.highs, k.lows, k.closes, k.volumes, tf as TFLabelV2);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/technical-analysis-pro/multi-tf?symbol=BTCUSDT -- FITUR 2 (TF fixed, gak perlu param tf)
router.get('/technical-analysis-pro/multi-tf', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  try {
    const normalized = normalizeSymbol(symbol);
    const result = await analyzeMultiTFReading(normalized);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/technical-analysis-pro/snr-zones?symbol=BTCUSDT&tf=H4|H1|M15|M5 -- FITUR 4 (200 candle, default H4)
router.get('/technical-analysis-pro/snr-zones', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  try {
    const tfQ = req.query['tf'];
    const tf = tfQ === 'H1' || tfQ === 'M15' || tfQ === 'M5' ? tfQ : 'H4';
    res.json(await analyzeSnrZones(normalizeSymbol(symbol), tf));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/technical-analysis-pro/long-short-score?symbol=BTCUSDT -- FITUR 5 (struktur H4+H1, OI, L/S ratio, funding)
router.get('/technical-analysis-pro/long-short-score', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  try {
    const normalized = normalizeSymbol(symbol);
    const result = await analyzeLongShortScore(normalized);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/technical-analysis-pro/divergence-trend?symbol=BTCUSDT&tf=H4 -- FITUR 6
// (request user): RSI/MACD/Volume/Stochastic(5,3,3) divergence + Kekuatan
// Trend (ADX/Force Index/Volume/ATR) di TF yang dipilih; OI+Price+Volume+
// Funding SELALU D1+H4, gak ngikut TF (dihandle di dalam analyzeDivergenceTrend).
router.get('/technical-analysis-pro/divergence-trend', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  const tf = req.query['tf'] as string;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  if (!tf || !TF_TO_INTERVAL[tf]) { res.status(400).json({ error: TF_REQUIRED_MSG }); return; }
  try {
    const normalized = normalizeSymbol(symbol);
    const k = await fetchKlines(normalized, TF_TO_INTERVAL[tf]!, TA_PRO_CANDLE_LIMIT[tf as keyof typeof TA_PRO_CANDLE_LIMIT]);
    const result = await analyzeDivergenceTrend(k.opens, k.highs, k.lows, k.closes, k.volumes, tf as TFLabelV2, normalized);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/technical-analysis-pro/btc-correlation -- FITUR 7 (request user:
// "sebelum analisa koin wajib liat outlook BTC dulu"). BTC-only, gak perlu
// symbol/tf param -- selalu H4+D1.
router.get('/technical-analysis-pro/btc-correlation', async (_req, res) => {
  try {
    const result = await analyzeBtcCorrelation();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;