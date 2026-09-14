import { Router } from 'express';
import { analyzeCounterStructural, analyzeMoneyMagnet3, getRecentPerformance } from '../lib/smc';
import { getUniverse, getMarketMetadata } from './screener';

const router = Router();

// Menu Breakout Entry diubah TOTAL (request user) dari 2 skill (OI Surge
// Breakout + Funding Kontrarian, DIHAPUS) jadi 1 skill doang: Counter
// Structural (kebalikan dari Skill Structural Menu 4). Classifier dan logic
// pilih-mode DIHAPUS — gak relevan lagi given cuma 1 skill.
//
// REVISI (request user): sub-tab BARU "Money Magnet 3" ditambahin --
// logic Money Magnet 2 (cascading multi-level), TF H4->H1, M30->M15.
// (Sempat dicoba tambah "Money Magnet 1" jadi 3-combo, TAPI DIBATALKAN
// user -- balik ke 2 sub-tab doang: Sniper Breakout + Money Magnet 3.
// Fungsi analyzeMoneyMagnet1 di smc.ts DIBIARKAN ada tapi GAK DIPAKAI di
// sini, siapa tau dibutuhin lagi nanti.)

// GET /api/breakout-entry?symbol=BTCUSDT&mode=structural|moneymagnet3 (route
// name dipertahankan). mode opsional, default 'structural' (Sniper Breakout
// asli) -- GAK ada classifier auto-recommend, user pilih manual di UI.
router.get('/breakout-entry', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  const modeParam = req.query['mode'] as string | undefined;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  const normalized = symbol.toUpperCase().endsWith('USDT')
    ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
  const mode: 'structural' | 'moneymagnet3' = modeParam === 'moneymagnet3' ? 'moneymagnet3' : 'structural';
  try {
    const result = mode === 'moneymagnet3'
      ? await analyzeMoneyMagnet3(normalized)
      : await analyzeCounterStructural(normalized);
    // CATATAN: recentPerformance (mini-backtest 30 hari) CUMA didukung buat
    // mode 'structural' -- Money Magnet 3 butuh dukungan baru di fungsi
    // runBacktest terpisah (infra backtest, beda dari live analysis) yang
    // BELUM diupdate. Daripada nyampur statistik gak akurat, di-skip dulu
    // buat mode ini.
    const recentPerformance = mode === 'moneymagnet3' ? null : await getRecentPerformance(normalized, 'counter_scalping');
    res.json({ ...result, mode, recentPerformance });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESSIVE SCAN STATE (request user, sama kayak Scalping — "hasil muncul
// progresif, gak nunggu 300 koin kelar semua"). Lihat breakout.ts buat
// penjelasan lengkap kenapa polling (bukan SSE/EventSource — gak native-
// compatible di React Native).
// REVISI: scan sekarang jalanin KEDUA skill per koin (Sniper Breakout +
// Money Magnet 3).
// ═══════════════════════════════════════════════════════════════════════════
type SniperScanState = {
  results: Array<(Awaited<ReturnType<typeof analyzeCounterStructural>> | Awaited<ReturnType<typeof analyzeMoneyMagnet3>>) & { mode: string; marketMeta?: unknown }>;
  scanned: number;
  total: number;
  status: 'idle' | 'running' | 'complete' | 'error';
  errorMessage?: string;
  fetchedAt: number;
};
let sniperScanState: SniperScanState = { results: [], scanned: 0, total: 0, status: 'idle', fetchedAt: 0 };
let sniperScanRunning = false;

async function runSniperScan(): Promise<void> {
  if (sniperScanRunning) return;
  sniperScanRunning = true;
  sniperScanState = { results: [], scanned: 0, total: 0, status: 'running', fetchedAt: Date.now() };
  try {
    // REVISI (request user): naik dari 300 jadi 400 koin
    const universe = await getUniverse(400);
    sniperScanState.total = universe.length;
    const batchSize = 2; // 2 skill per koin
    for (let i = 0; i < universe.length; i += batchSize) {
      const batch = universe.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.flatMap((s) => [
          analyzeCounterStructural(s).then(val => ({ ...val, mode: 'structural' as const })),
          analyzeMoneyMagnet3(s).then(val => ({ ...val, mode: 'moneymagnet3' as const })),
        ])
      );
      sniperScanState.scanned += batch.length;
      const newValid: typeof sniperScanState.results = [];
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          const val = r.value;
          if (val.status === 'siap_breakout' || val.status === 'approaching' || val.status === 'siap_retest' || val.status === 'waiting' || val.status === 'in_zone')
            newValid.push(val as any);
        }
      }
      if (newValid.length > 0) {
        const metadata = await getMarketMetadata(newValid.map(r => r.symbol));
        for (const r of newValid) (r as any).marketMeta = metadata.get(r.symbol) ?? null;
      }
      sniperScanState.results.push(...newValid);
      const order: Record<string, number> = { siap_breakout: 0, in_zone: 0, siap_retest: 0, approaching: 1, waiting: 2 };
      sniperScanState.results.sort((a, b) => {
        const ao = order[a.status] ?? 2, bo = order[b.status] ?? 2;
        return ao - bo;
      });
      if (i + batchSize < universe.length) await new Promise(r => setTimeout(r, 500));
    }
    sniperScanState.status = 'complete';
    sniperScanState.fetchedAt = Date.now();
  } catch (err) {
    sniperScanState.status = 'error';
    sniperScanState.errorMessage = err instanceof Error ? err.message : 'Unknown error';
  } finally {
    sniperScanRunning = false;
  }
}

// GET /api/breakout-entry/scan — REVISI (request user, "progresif + notif
// complete"): POLLING-BASED, sama pola kayak breakout.ts. ?fresh=true maksa
// mulai scan baru (tombol Refresh manual).
router.get('/breakout-entry/scan', async (req, res) => {
  try {
    const forceFresh = req.query['fresh'] === 'true';
    if (sniperScanState.status === 'idle' || (forceFresh && !sniperScanRunning)) {
      runSniperScan(); // fire-and-forget, SENGAJA gak di-await
    }
    res.json({
      coins: sniperScanState.results,
      scanned: sniperScanState.scanned,
      total: sniperScanState.total,
      status: sniperScanState.status,
      errorMessage: sniperScanState.errorMessage,
      fetchedAt: sniperScanState.fetchedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;