import { Router } from 'express';
import { analyzeMomentumHunter } from '../lib/smc';
import { getUniverse } from './screener';

const router = Router();

// GET /api/momentum-hunter?symbol=BTCUSDT — 1 fungsi doang (gak ada
// classifier/mode kaya menu lain). Basis: Pump/Dump Entry (H4→H1→M15→M5,
// request user, gantiin 4 tipe setup lama).
// NOTE: gak ada recentPerformance — runBacktest belum support menu ini
// (technical debt yang sama kayak menu-menu lain, backtest emang belum disync).
router.get('/momentum-hunter', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  const normalized = symbol.toUpperCase().endsWith('USDT')
    ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
  try {
    const result = await analyzeMomentumHunter(normalized);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/momentum-hunter/scan — loop universe, tiap koin langsung full
// analisa (gak ada classifier murah, basis-nya 1 alur tetap H4→H1→M15→M5)
router.get('/momentum-hunter/scan', async (req, res) => {
  try {
    const universe = await getUniverse();
    const results: Awaited<ReturnType<typeof analyzeMomentumHunter>>[] = [];
    const batchSize = 3;
    for (let i = 0; i < universe.length; i += batchSize) {
      const batch = universe.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch.map((s) => analyzeMomentumHunter(s)));
      if (i + batchSize < universe.length) await new Promise(r => setTimeout(r, 300));
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          const val = r.value;
          if (val.status === 'siap_entry') results.push(val);
        }
      }
    }
    // Sort by jumlah bonus yang lolos (CVD + ATR Squeeze) — proxy kekuatan
    // sinyal, given basis WAJIB-nya SAMA buat semua (H4→H1→M15→M5), yang
    // beda cuma berapa banyak konfirmasi BONUS yang nyambung.
    const bonusCount = (v: typeof results[number]) =>
      (v.filterResults ?? []).filter(f => f.includes('Bonus:') && f.startsWith('✅')).length;
    results.sort((a, b) => bonusCount(b) - bonusCount(a));
    res.json({ coins: results, fetchedAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;