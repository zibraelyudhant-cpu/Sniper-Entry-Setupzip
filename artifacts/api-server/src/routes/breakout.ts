import { Router } from 'express';
import { analyzeScalpingEntry, analyzeScalping15M, classifyScalpingMode, fetchKlines, getRecentPerformance } from '../lib/smc';
import { getUniverse } from './screener';

const router = Router();

// GET /api/breakout?symbol=BTCUSDT&mode=structural|scalping15m (route name
// dipertahankan agar tidak perlu ubah index.ts). mode opsional — kalau gak
// dikasih, classifier (volume M15 vs MA20) yang nentuin otomatis.
router.get('/breakout', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  const modeParam = req.query['mode'] as string | undefined;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  const normalized = symbol.toUpperCase().endsWith('USDT')
    ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
  try {
    const classifyData = await fetchKlines(normalized, '15m', 250);
    const classification = classifyScalpingMode(classifyData.closes, classifyData.volumes);

    const mode: 'structural' | 'scalping15m' =
      modeParam === 'structural' || modeParam === 'scalping15m' ? modeParam : classification.recommendedMode;

    const result = mode === 'scalping15m'
      ? await analyzeScalping15M(normalized)
      : await analyzeScalpingEntry(normalized);

    const recentPerformance = await getRecentPerformance(normalized, 'scalping');
    res.json({ ...result, mode, recommendedMode: classification.recommendedMode, recentPerformance });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/breakout/scan — classifier-driven: tiap koin di-classify dulu (murah,
// pake data M15 yang emang udah di-fetch), BARU dianalisa penuh sesuai mode yang
// cocok (1x per koin, BUKAN 2x/koin)
router.get('/breakout/scan', async (req, res) => {
  try {
    const universe = await getUniverse();
    const results: Array<Awaited<ReturnType<typeof analyzeScalpingEntry>> & { mode: string; recommendedMode: string }> = [];
    const batchSize = 3;
    for (let i = 0; i < universe.length; i += batchSize) {
      const batch = universe.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch.map(async (s) => {
        const classifyData = await fetchKlines(s, '15m', 250);
        const classification = classifyScalpingMode(classifyData.closes, classifyData.volumes);
        const val = classification.recommendedMode === 'scalping15m'
          ? await analyzeScalping15M(s)
          : await analyzeScalpingEntry(s);
        return { ...val, mode: classification.recommendedMode, recommendedMode: classification.recommendedMode };
      }));
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