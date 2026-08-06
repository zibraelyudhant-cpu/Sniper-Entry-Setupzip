import { Router } from 'express';
import { analyzeExtremeScalpingEntry, analyzeSniperExtremeScalping, classifyExtremeScalpingMode, fetchKlines, getRecentPerformance } from '../lib/smc';
import { getUniverse } from './screener';

const router = Router();

// GET /api/extreme-scalping?symbol=BTCUSDT&mode=quant|sniper — mode opsional,
// classifier (ADX 5M) yang nentuin otomatis kalau gak dikasih
router.get('/extreme-scalping', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  const modeParam = req.query['mode'] as string | undefined;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  const normalized = symbol.toUpperCase().endsWith('USDT')
    ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
  try {
    const classifyData = await fetchKlines(normalized, '5m', 288);
    const classification = classifyExtremeScalpingMode(classifyData.highs, classifyData.lows, classifyData.closes);

    const mode: 'quant' | 'sniper' =
      modeParam === 'quant' || modeParam === 'sniper' ? modeParam : classification.recommendedMode;

    const result = mode === 'sniper'
      ? await analyzeSniperExtremeScalping(normalized)
      : await analyzeExtremeScalpingEntry(normalized);

    const recentPerformance = await getRecentPerformance(normalized, 'extreme_scalping');
    res.json({ ...result, mode, recommendedMode: classification.recommendedMode, recentPerformance });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/extreme-scalping/scan — classifier-driven: tiap koin di-classify
// dulu (murah, pake data 5M), BARU dianalisa penuh sesuai mode yang cocok
// (1x per koin, BUKAN 2x/koin)
router.get('/extreme-scalping/scan', async (req, res) => {
  try {
    const universe = await getUniverse();
    const results: Array<Awaited<ReturnType<typeof analyzeExtremeScalpingEntry>> & { mode: string; recommendedMode: string }> = [];
    const batchSize = 3;
    for (let i = 0; i < universe.length; i += batchSize) {
      const batch = universe.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch.map(async (s) => {
        const classifyData = await fetchKlines(s, '5m', 288);
        const classification = classifyExtremeScalpingMode(classifyData.highs, classifyData.lows, classifyData.closes);
        const val = classification.recommendedMode === 'sniper'
          ? await analyzeSniperExtremeScalping(s)
          : await analyzeExtremeScalpingEntry(s);
        return { ...val, mode: classification.recommendedMode, recommendedMode: classification.recommendedMode };
      }));
      if (i + batchSize < universe.length) await new Promise(r => setTimeout(r, 300));
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          const val = r.value;
          // Rule engine (semua syarat wajib) — cuma status 'siap_entry' yang ditampilin
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