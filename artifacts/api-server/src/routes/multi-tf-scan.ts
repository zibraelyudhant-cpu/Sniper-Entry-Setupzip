import { Router } from 'express';
import { scanMultiTFTrendCoin, analyzeMultiTFDetail } from '../lib/smc';
import { getUniverse } from './screener';

const router = Router();

// GET /api/multi-tf-scan — kriteria: D1 ADX>=25 DAN H4 ADX>=25 (independen,
// gak perlu searah). Menu ini SCAN-ONLY, gak ada endpoint single-symbol
// "analisa" manual terpisah — detail dibuka langsung dari tap koin di Scan.
router.get('/multi-tf-scan', async (req, res) => {
  try {
    const universe = await getUniverse();
    const results: NonNullable<Awaited<ReturnType<typeof scanMultiTFTrendCoin>>>[] = [];
    const batchSize = 3;
    for (let i = 0; i < universe.length; i += batchSize) {
      const batch = universe.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch.map(s => scanMultiTFTrendCoin(s)));
      if (i + batchSize < universe.length) await new Promise(r => setTimeout(r, 300));
      for (const r of batchResults) {
        if (r.status === 'fulfilled' && r.value !== null) results.push(r.value);
      }
    }
    // Sort by ADX gabungan (D1+H4) desc — trend paling kuat di atas
    results.sort((a, b) => (b.d1Adx + b.h4Adx) - (a.d1Adx + a.h4Adx));
    res.json({ coins: results, fetchedAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/multi-tf-detail?symbol=BTCUSDT — breakdown 6 TF buat koin +
// 6 TF buat BTC (selalu ada, buat perbandingan manual)
router.get('/multi-tf-detail', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  const normalized = symbol.toUpperCase().endsWith('USDT')
    ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
  try {
    const result = await analyzeMultiTFDetail(normalized);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;