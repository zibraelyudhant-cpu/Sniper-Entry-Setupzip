import { Router } from 'express';
import { analyzeExtremeScalpingEntry, getRecentPerformance } from '../lib/smc';
import { getUniverse } from './screener';

const router = Router();

// GET /api/extreme-scalping?symbol=BTCUSDT
router.get('/extreme-scalping', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  const normalized = symbol.toUpperCase().endsWith('USDT')
    ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
  try {
    const result = await analyzeExtremeScalpingEntry(normalized);
    // Mini-backtest instan — cuma di endpoint single-symbol ini, BUKAN di scan
    const recentPerformance = await getRecentPerformance(normalized, 'extreme_scalping');
    res.json({ ...result, recentPerformance });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/extreme-scalping/scan
router.get('/extreme-scalping/scan', async (req, res) => {
  try {
    const universe = await getUniverse();
    const results: Awaited<ReturnType<typeof analyzeExtremeScalpingEntry>>[] = [];
    const batchSize = 3;
    for (let i = 0; i < universe.length; i += batchSize) {
      const batch = universe.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch.map(s => analyzeExtremeScalpingEntry(s)));
      if (i + batchSize < universe.length) await new Promise(r => setTimeout(r, 300));
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          const val = r.value;
          // Rule engine v4 (TF15M struktur -> TF5M eksekusi) — cuma status
          // 'siap_entry' yang ditampilin (semua syarat wajib udah lolos di
          // dalam analyzeExtremeScalpingEntry)
          if (val.status === 'siap_entry') results.push(val);
        }
      }
    }
    // Sort by confidence desc (informasional — SEMUA hasil di sini udah lolos
    // rule engine wajib, confidence cuma nunjukin kekuatan konfluensi bonus)
    results.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    res.json({ coins: results, fetchedAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;