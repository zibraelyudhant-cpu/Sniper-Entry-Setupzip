import { Router } from 'express';
import { analyzeMomentumHunter } from '../lib/smc';
import { getUniverse } from './screener';

const router = Router();

// GET /api/momentum-hunter?symbol=BTCUSDT — 1 fungsi doang (gak ada
// classifier/mode kaya menu lain), karena internal-nya udah otomatis coba
// 4 pasangan TF x 3 tipe setup + fallback sideways single-TF.
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
// analisa (gak ada classifier murah kayak menu lain, karena "murah"-nya di
// sini gak relevan — semua koin emang butuh dicoba semua TF x tipe)
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
          // Tampilin siap_entry (fully confirmed) DAN approaching (proyeksi)
          if (val.status === 'siap_entry' || val.status === 'approaching') results.push(val);
        }
      }
    }
    // Sort: siap_entry duluan, baru approaching. Di dalam grup siap_entry,
    // prioritasin tipe retest > reversal_ekstrem > breakout_antisipasi >
    // sideways_rejection (urutan sesuai keandalan, konsisten sama basis internal)
    const statusOrder: Record<string, number> = { siap_entry: 0, approaching: 1 };
    const typeOrder: Record<string, number> = { retest: 0, reversal_ekstrem: 1, breakout_antisipasi: 2, sideways_rejection: 3 };
    results.sort((a, b) => {
      const so = (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2);
      if (so !== 0) return so;
      return (typeOrder[a.setupType ?? ''] ?? 4) - (typeOrder[b.setupType ?? ''] ?? 4);
    });
    res.json({ coins: results, fetchedAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
