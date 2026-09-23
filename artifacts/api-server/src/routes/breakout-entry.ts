import { Router } from 'express';
import { analyzeCounterStructural, getRecentPerformance } from '../lib/smc';
import { getUniverse, getMarketMetadata } from './screener';

const router = Router();

// Menu Breakout Entry (request user): balik jadi 1 skill doang -- Sniper
// Breakout Skill 1 (analyzeCounterStructural). Sub-tab "Money Magnet 3"
// (analyzeMoneyMagnet3) DIHAPUS (request user) bareng fungsinya di smc.ts.
// Route name/param 'mode' dipertahankan buat kompatibilitas, tapi sekarang
// cuma nerima 'structural'.

// GET /api/breakout-entry?symbol=BTCUSDT
router.get('/breakout-entry', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  const normalized = symbol.toUpperCase().endsWith('USDT')
    ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
  const mode = 'structural' as const;
  try {
    const result = await analyzeCounterStructural(normalized);
    const recentPerformance = await getRecentPerformance(normalized, 'counter_scalping');
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
// REVISI (request user): balik jadi 1 skill doang per koin (Money Magnet 3
// dihapus dari scan juga).
// ═══════════════════════════════════════════════════════════════════════════
type SniperScanState = {
  results: Array<Awaited<ReturnType<typeof analyzeCounterStructural>> & { mode: string; marketMeta?: unknown }>;
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
    const universe = await getUniverse(500);
    sniperScanState.total = universe.length;
    const batchSize = 3;
    for (let i = 0; i < universe.length; i += batchSize) {
      const batch = universe.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map((s) => analyzeCounterStructural(s).then(val => ({ ...val, mode: 'structural' as const })))
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
      if (i + batchSize < universe.length) await new Promise(r => setTimeout(r, 300));
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

// GET /api/breakout-entry/scan — POLLING-BASED (sama pola kayak
// breakout.ts). ?fresh=true maksa mulai scan baru (tombol Refresh manual).
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