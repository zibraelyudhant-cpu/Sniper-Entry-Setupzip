import { Router } from 'express';
import { analyzeBreakoutTrading, analyzeBreakoutCrossover, classifyBreakoutMode, fetchKlines, getRecentPerformance } from '../lib/smc';
import { getUniverse } from './screener';

const router = Router();

// GET /api/breakout-entry?symbol=BTCUSDT&mode=confidence|crossover (mode opsional —
// kalau gak dikasih, classifier (ADX H1) yang nentuin otomatis)
router.get('/breakout-entry', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  const modeParam = req.query['mode'] as string | undefined;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  const normalized = symbol.toUpperCase().endsWith('USDT')
    ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
  try {
    // Classifier dulu (murah) — buat kasih tau recommendedMode ke UI, independen
    // dari mode yang akhirnya dipilih (user bisa override manual)
    const classifyData = await fetchKlines(normalized, '30m', 250);
    const classification = classifyBreakoutMode(classifyData.highs, classifyData.lows, classifyData.closes, classifyData.volumes);

    const mode: 'confidence' | 'crossover' =
      modeParam === 'confidence' || modeParam === 'crossover' ? modeParam : classification.recommendedMode;

    const result = mode === 'crossover'
      ? await analyzeBreakoutCrossover(normalized)
      : await analyzeBreakoutTrading(normalized);

    const recentPerformance = await getRecentPerformance(normalized, 'breakout_entry');
    res.json({ ...result, mode, recommendedMode: classification.recommendedMode, recentPerformance });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/breakout-entry/scan — classifier-driven: tiap koin di-classify dulu (murah),
// BARU dianalisa penuh sesuai mode yang cocok (1x per koin, BUKAN 2x/koin)
router.get('/breakout-entry/scan', async (req, res) => {
  try {
    const universe = await getUniverse();
    const results: Array<Awaited<ReturnType<typeof analyzeBreakoutTrading>> & { mode: string; recommendedMode: string }> = [];
    const batchSize = 3;
    for (let i = 0; i < universe.length; i += batchSize) {
      const batch = universe.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch.map(async (s) => {
        const classifyData = await fetchKlines(s, '30m', 250);
        const classification = classifyBreakoutMode(classifyData.highs, classifyData.lows, classifyData.closes, classifyData.volumes);
        const val = classification.recommendedMode === 'crossover'
          ? await analyzeBreakoutCrossover(s)
          : await analyzeBreakoutTrading(s);
        return { ...val, mode: classification.recommendedMode, recommendedMode: classification.recommendedMode };
      }));
      if (i + batchSize < universe.length) await new Promise(r => setTimeout(r, 300));
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          const val = r.value;
          if (val.status === 'siap_breakout' || val.status === 'siap_retest')
            results.push(val);
        }
      }
    }
    // Sort: siap_retest duluan, di dalam grup sort by confidence yang dinormalisasi
    // (confidence mode: confidenceScore 0-100 apa adanya; crossover mode: score/maxScore*100)
    const confidenceOf = (v: typeof results[number]) =>
      v.mode === 'crossover' ? ((v.score ?? 0) / (v.maxScore || 1)) * 100 : (v.confidenceScore ?? 0);
    const order: Record<string, number> = { siap_retest: 0, siap_breakout: 1 };
    results.sort((a, b) => {
      const ao = order[a.status] ?? 2, bo = order[b.status] ?? 2;
      if (ao !== bo) return ao - bo;
      return confidenceOf(b) - confidenceOf(a);
    });
    res.json({ coins: results, fetchedAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;