import { Router } from 'express';
import { analyzeBreakoutEntry } from '../lib/smc';
import { getUniverse } from './screener';

const router = Router();

router.get('/breakout', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  const normalized = symbol.toUpperCase().endsWith('USDT')
    ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
  const result = await analyzeBreakoutEntry(normalized);
  res.json(result);
});

router.get('/breakout/scan', async (req, res) => {
  try {
    const universe = await getUniverse();
    const results: Awaited<ReturnType<typeof analyzeBreakoutEntry>>[] = [];
    const batchSize = 5;
    for (let i = 0; i < universe.length; i += batchSize) {
      const batch = universe.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch.map(s => analyzeBreakoutEntry(s)));
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          const val = r.value;
          if (val.status === 'ready' || val.status === 'in_zone' || val.status === 'approaching')
            results.push(val);
        }
      }
    }
    const order: Record<string, number> = { ready: 0, in_zone: 1, approaching: 2 };
    results.sort((a, b) => {
      const ao = order[a.status] ?? 3, bo = order[b.status] ?? 3;
      if (ao !== bo) return ao - bo;
      return (b.volumeRatio ?? 0) - (a.volumeRatio ?? 0);
    });
    res.json({ coins: results, fetchedAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
