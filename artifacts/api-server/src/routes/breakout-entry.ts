import { Router } from 'express';
import { analyzeCounterStructural, getRecentPerformance } from '../lib/smc';
import { getUniverse } from './screener';

const router = Router();

// Menu Breakout Entry diubah TOTAL (request user) dari 2 skill (OI Surge
// Breakout + Funding Kontrarian, DIHAPUS) jadi 1 skill doang: Counter
// Structural (kebalikan dari Skill Structural Menu 4). Classifier dan logic
// pilih-mode DIHAPUS — gak relevan lagi given cuma 1 skill.

// GET /api/breakout-entry?symbol=BTCUSDT
router.get('/breakout-entry', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  const normalized = symbol.toUpperCase().endsWith('USDT')
    ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
  try {
    const result = await analyzeCounterStructural(normalized);
    const recentPerformance = await getRecentPerformance(normalized, 'counter_scalping');
    res.json({ ...result, recentPerformance });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/breakout-entry/scan — CUMA 1 skill sekarang, scan lebih ringan
// (1x fetch per koin, BUKAN 2x lagi kayak sebelumnya pas masih 2 skill)
router.get('/breakout-entry/scan', async (req, res) => {
  try {
    const universe = await getUniverse();
    const results: Array<Awaited<ReturnType<typeof analyzeCounterStructural>>> = [];
    const batchSize = 3; // 1 skill doang sekarang, bisa sedikit lebih agresif dari batchSize=2 (2 skill)
    for (let i = 0; i < universe.length; i += batchSize) {
      const batch = universe.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map((s) => analyzeCounterStructural(s))
      );
      if (i + batchSize < universe.length) await new Promise(r => setTimeout(r, 500));
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          const val = r.value;
          if (val.status === 'approaching' || val.status === 'siap_retest' || val.status === 'waiting')
            results.push(val);
        }
      }
    }
    const order: Record<string, number> = { siap_retest: 0, approaching: 1 };
    results.sort((a, b) => {
      const ao = order[a.status] ?? 2, bo = order[b.status] ?? 2;
      return ao - bo;
    });
    res.json({ coins: results, fetchedAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;