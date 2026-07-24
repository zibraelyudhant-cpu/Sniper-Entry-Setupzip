import { Router } from 'express';
import { analyzeScalpingEntry } from '../lib/smc';
import { getUniverse } from './screener';

const router = Router();

// GET /api/breakout?symbol=BTCUSDT  (route name dipertahankan agar tidak perlu ubah index.ts)
router.get('/breakout', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  const normalized = symbol.toUpperCase().endsWith('USDT')
    ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
  try {
    const result = await analyzeScalpingEntry(normalized);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/breakout/scan
router.get('/breakout/scan', async (req, res) => {
  try {
    const universe = await getUniverse();
    const results: Awaited<ReturnType<typeof analyzeScalpingEntry>>[] = [];
    const batchSize = 3;
    for (let i = 0; i < universe.length; i += batchSize) {
      const batch = universe.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch.map(s => analyzeScalpingEntry(s)));
      if (i + batchSize < universe.length) await new Promise(r => setTimeout(r, 300));
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          const val = r.value;
          // Expired tidak ditampilkan — in_zone, approaching, waiting
          if (val.status === 'in_zone' || val.status === 'approaching' || val.status === 'waiting')
            results.push(val);
        }
      }
    }
    // Sort: in_zone → approaching → waiting, sort by score desc
    const order: Record<string, number> = { in_zone: 0, approaching: 1, waiting: 2 };
    results.sort((a, b) => {
      const ao = order[a.status] ?? 2, bo = order[b.status] ?? 2;
      if (ao !== bo) return ao - bo;
      return (b.score ?? 0) - (a.score ?? 0);
    });
    res.json({ coins: results, fetchedAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;