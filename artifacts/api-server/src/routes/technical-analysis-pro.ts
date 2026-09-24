import { Router } from 'express';
import {
  analyzeTrendIdentification, analyzeMultiTFReading, analyzeBreakoutBounceFilter,
  analyzeLongShortScore, analyzeMarketStructureV2, analyzeDivergenceTrend, analyzeBtcCorrelation, fetchKlines,
} from '../lib/smc';
import type { TFLabelV2 } from '../lib/smc';

const router = Router();

function normalizeSymbol(raw: string): string {
  const up = raw.toUpperCase();
  return up.endsWith('USDT') ? up : `${up}USDT`;
}

const TF_TO_INTERVAL: Record<string, string> = {
  D1: '1d', H4: '4h', H1: '1h', M30: '30m', M15: '15m', M5: '5m',
};

// GET /api/technical-analysis-pro/trend?symbol=BTCUSDT&tf=H4 -- FITUR 1
router.get('/technical-analysis-pro/trend', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  const tf = req.query['tf'] as string;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  if (!tf || !TF_TO_INTERVAL[tf]) { res.status(400).json({ error: 'tf required (D1/H4/H1/M30/M15/M5)' }); return; }
  try {
    const normalized = normalizeSymbol(symbol);
    const k = await fetchKlines(normalized, TF_TO_INTERVAL[tf]!, 100);
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

// GET /api/technical-analysis-pro/transition?symbol=BTCUSDT&tf=H4 -- FITUR 3 (reuse Market Structure V2)
router.get('/technical-analysis-pro/transition', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  const tf = req.query['tf'] as string;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  if (!tf || !TF_TO_INTERVAL[tf]) { res.status(400).json({ error: 'tf required (D1/H4/H1/M30/M15/M5)' }); return; }
  try {
    const normalized = normalizeSymbol(symbol);
    const k = await fetchKlines(normalized, TF_TO_INTERVAL[tf]!, 100);
    const result = analyzeMarketStructureV2(k.opens, k.highs, k.lows, k.closes, tf as TFLabelV2, k.volumes);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/technical-analysis-pro/breakout-bounce?symbol=BTCUSDT&tf=H4 -- FITUR 4
router.get('/technical-analysis-pro/breakout-bounce', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  const tf = req.query['tf'] as string;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  if (!tf || !TF_TO_INTERVAL[tf]) { res.status(400).json({ error: 'tf required (D1/H4/H1/M30/M15/M5)' }); return; }
  try {
    const normalized = normalizeSymbol(symbol);
    const k = await fetchKlines(normalized, TF_TO_INTERVAL[tf]!, 100);
    const result = analyzeBreakoutBounceFilter(k.opens, k.highs, k.lows, k.closes, k.volumes, tf as TFLabelV2);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/technical-analysis-pro/long-short-score?symbol=BTCUSDT -- FITUR 5 (TF fixed D1 vs H4)
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
  if (!tf || !TF_TO_INTERVAL[tf]) { res.status(400).json({ error: 'tf required (D1/H4/H1/M30/M15/M5)' }); return; }
  try {
    const normalized = normalizeSymbol(symbol);
    const k = await fetchKlines(normalized, TF_TO_INTERVAL[tf]!, 150);
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