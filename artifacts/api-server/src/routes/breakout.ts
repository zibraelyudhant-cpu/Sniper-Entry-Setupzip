import { Router } from 'express';
import { analyzeScalpingEntry, checkTaProBonus, getTaProScoreSnapshot } from '../lib/smc';
import { getUniverse, getMarketMetadata } from './screener';

const router = Router();

// Menu Scalping (request user): mode "15M" (analyzeScalping15M) DIHAPUS
// bareng fungsinya di smc.ts -- balik ke 1 mode doang: Structural
// (analyzeScalpingEntry). Classifier auto-pilih-mode juga DILEPAS (gak
// relevan lagi given cuma 1 mode). Route name/param 'mode' dipertahankan
// buat kompatibilitas, tapi sekarang cuma nerima 'structural'.
router.get('/breakout', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  const normalized = symbol.toUpperCase().endsWith('USDT')
    ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
  const mode = 'structural' as const;
  try {
    const result = await analyzeScalpingEntry(normalized);
    // 2026-10-23: mini-backtest 30 hari DIHAPUS dari Scalping — dulu menjalankan backtest Python strategi lama (bukan CRT) dan bikin Analisa lambat/gagal.
    // FIX (audit): TA PRO Bonus (checkTaProBonus) sebelumnya gak pernah
    // dipanggil sama sekali, jadi banner-nya di UI gak pernah muncul
    // walaupun datanya mestinya ada. Di-wire di sini doang -- endpoint
    // DETAIL 1 koin (request user: biar gak 2x-in beban fetch pas SCAN
    // ratusan koin di /breakout/scan, yang sengaja TETEP gak dikasih ini).
    let taProBonus: { confirmed: boolean; classification: string | null; score: number } | null = null;
    if ((result as any).bias === 'bullish' || (result as any).bias === 'bearish') {
      taProBonus = await checkTaProBonus(normalized, (result as any).bias);
    }
    const taPro = (result as any).bias === 'bullish' || (result as any).bias === 'bearish' ? await getTaProScoreSnapshot(normalized) : null;
    res.json({
      taPro,
      ...result, mode,
      taProBonusConfirmed: taProBonus?.confirmed ?? false,
      taProBonusClassification: taProBonus?.classification ?? null,
      taProBonusScore: taProBonus?.score ?? 0,
    });
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
// REVISI (request user): balik jadi 1 mode doang per koin (mode 15M
// dihapus dari scan juga).
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
    const universe = await getUniverse(500);
    scalpingScanState.total = universe.length;
    const batchSize = 3; // REVERT (request user): batch 5 + delay pendek bikin rate-limit cascade, hasil scan jadi 0 sinyal sama sekali
    for (let i = 0; i < universe.length; i += batchSize) {
      const batch = universe.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map((s) => analyzeScalpingEntry(s).then(val => ({ ...val, mode: 'structural' as const })))
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
        // Skor TA PRO dibekukan SAAT sinyal dibuat (cuma koin yang punya arah + entry)
        await Promise.all(newValid.filter(r => ((r as any).bias === 'bullish' || (r as any).bias === 'bearish') && (r as any).entryPrice !== undefined)
          .map(async r => { (r as any).taPro = await getTaProScoreSnapshot(r.symbol); }));
      }
      scalpingScanState.results.push(...newValid);
      // Sort ulang tiap batch (biar hasil yang udah nongol tetep urut)
      const order: Record<string, number> = { in_zone: 0, approaching: 1, waiting: 2 };
      scalpingScanState.results.sort((a, b) => {
        const ao = order[a.status] ?? 2, bo = order[b.status] ?? 2;
        if (ao !== bo) return ao - bo;
        return ((b as any).score ?? 0) - ((a as any).score ?? 0);
      });
      if (i + batchSize < universe.length) await new Promise(r => setTimeout(r, 400)); // REVERT: balik ke 400ms, batch 5 kena rate-limit Binance
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

// GET /api/breakout/scan — POLLING-BASED (lihat catatan panjang di atas).
// Query ?fresh=true maksa mulai scan baru (buat tombol "Refresh" manual),
// walau status sebelumnya udah 'complete'.
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