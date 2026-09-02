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

    const recentPerformance = await getRecentPerformance(normalized, mode);
    res.json({ ...result, mode, recommendedMode: classification.recommendedMode, recentPerformance });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/breakout/scan — CEK KEDUA SKILL per koin (request user eksplisit,
// dengan izin khusus menyentuh Menu 4 HANYA buat perubahan ini — logic internal
// analyzeScalpingEntry & analyzeScalping15M TIDAK disentuh sama sekali,
// cuma cara route MANGGIL mereka yang berubah dari 'classifier pilih 1' jadi
// 'cek dua-duanya'. Lebih lambat (2x fetch per koin) tapi kedua skill selalu
// dapet kesempatan dianalisa, gak tergantung classifier volume M15 vs MA20.
router.get('/breakout/scan', async (req, res) => {
  try {
    const universe = await getUniverse();
    const results: Array<Awaited<ReturnType<typeof analyzeScalpingEntry>> & { mode: string }> = [];
    const batchSize = 2; // FIX (ketemu user, kena rate limit Binance): batch 4 kombinasi 150 koin x 2 skill itu TERLALU AGRESIF (~32 request simultan tiap 300ms). Diturunkan ke 2 + delay diperpanjang jadi 500ms.
    for (let i = 0; i < universe.length; i += batchSize) {
      const batch = universe.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.flatMap((s) => [
          analyzeScalpingEntry(s).then(val => ({ ...val, mode: 'structural' as const })),
          analyzeScalping15M(s).then(val => ({ ...val, mode: 'scalping15m' as const })),
        ])
      );
      if (i + batchSize < universe.length) await new Promise(r => setTimeout(r, 500));
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