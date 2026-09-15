import { Router } from 'express';
import { analyzeScalpingEntry, analyzeScalping15M, classifyScalpingMode, fetchKlines, getRecentPerformance } from '../lib/smc';
import { getUniverse, getMarketMetadata } from './screener';

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

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESSIVE SCAN STATE (request user, "hasil muncul progresif, gak nunggu
// 300 koin kelar semua") -- state di-simpen di module-level (bukan per-user
// session, cukup buat tool personal-use kayak gini), di-update progresif
// tiap batch kelar. Frontend POLLING endpoint yang SAMA berulang-ulang
// (bukan pakai EventSource/SSE, karena EventSource GAK native-compatible
// di React Native -- cuma jalan di web. Polling pakai fetch() biasa, jalan
// sama di web/iOS/Android tanpa dependency baru).
// ═══════════════════════════════════════════════════════════════════════════
type ScalpingScanState = {
  results: Array<Awaited<ReturnType<typeof analyzeScalpingEntry>> & { mode: string; marketMeta?: unknown }>;
  scanned: number;
  total: number;
  status: 'idle' | 'running' | 'complete' | 'error';
  errorMessage?: string;
  fetchedAt: number;
};
let scalpingScanState: ScalpingScanState = { results: [], scanned: 0, total: 0, status: 'idle', fetchedAt: 0 };
let scalpingScanRunning = false;

async function runScalpingScan(): Promise<void> {
  if (scalpingScanRunning) return; // udah ada yang jalan, gak usah start baru
  scalpingScanRunning = true;
  scalpingScanState = { results: [], scanned: 0, total: 0, status: 'running', fetchedAt: Date.now() };
  try {
    // REVISI (request user): naik dari 300 jadi 400 koin
    // REVISI (request user): naik dari 400 jadi 500 koin
    const universe = await getUniverse(500);
    scalpingScanState.total = universe.length;
    const batchSize = 2; // FIX (ketemu user, kena rate limit Binance): batch 4 kombinasi 150 koin x 2 skill itu TERLALU AGRESIF (~32 request simultan tiap 300ms). Diturunkan ke 2 + delay diperpanjang jadi 500ms.
    for (let i = 0; i < universe.length; i += batchSize) {
      const batch = universe.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.flatMap((s) => [
          analyzeScalpingEntry(s).then(val => ({ ...val, mode: 'structural' as const })),
          analyzeScalping15M(s).then(val => ({ ...val, mode: 'scalping15m' as const })),
        ])
      );
      scalpingScanState.scanned += batch.length;
      const newValid: typeof scalpingScanState.results = [];
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          const val = r.value;
          if (val.status === 'in_zone' || val.status === 'approaching' || val.status === 'waiting')
            newValid.push(val);
        }
      }
      if (newValid.length > 0) {
        const metadata = await getMarketMetadata(newValid.map(r => r.symbol));
        for (const r of newValid) (r as any).marketMeta = metadata.get(r.symbol) ?? null;
      }
      scalpingScanState.results.push(...newValid);
      // Sort ulang tiap batch (biar hasil yang udah nongol tetep urut)
      const order: Record<string, number> = { in_zone: 0, approaching: 1, waiting: 2 };
      scalpingScanState.results.sort((a, b) => {
        const ao = order[a.status] ?? 2, bo = order[b.status] ?? 2;
        if (ao !== bo) return ao - bo;
        return ((b as any).score ?? 0) - ((a as any).score ?? 0);
      });
      if (i + batchSize < universe.length) await new Promise(r => setTimeout(r, 500));
    }
    scalpingScanState.status = 'complete';
    scalpingScanState.fetchedAt = Date.now();
  } catch (err) {
    scalpingScanState.status = 'error';
    scalpingScanState.errorMessage = err instanceof Error ? err.message : 'Unknown error';
  } finally {
    scalpingScanRunning = false;
  }
}

// GET /api/breakout/scan — REVISI (request user, "progresif + notif
// complete"): sekarang POLLING-BASED. Panggilan PERTAMA (status masih
// 'idle') mulai scan baru (fire-and-forget, gak di-await penuh) dan
// langsung return state saat itu (results kosong/scanned=0). Panggilan
// SELANJUTNYA (poll berkala dari frontend) cuma baca state TERBARU yang
// terus ke-update di background -- results makin lama makin nambah,
// sampai status jadi 'complete'. Query ?fresh=true maksa mulai scan baru
// (buat tombol "Refresh" manual), walau status sebelumnya udah 'complete'.
router.get('/breakout/scan', async (req, res) => {
  try {
    const forceFresh = req.query['fresh'] === 'true';
    if (scalpingScanState.status === 'idle' || (forceFresh && !scalpingScanRunning)) {
      runScalpingScan(); // fire-and-forget, SENGAJA gak di-await
    }
    res.json({
      coins: scalpingScanState.results,
      scanned: scalpingScanState.scanned,
      total: scalpingScanState.total,
      status: scalpingScanState.status,
      errorMessage: scalpingScanState.errorMessage,
      fetchedAt: scalpingScanState.fetchedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;