import { Router } from 'express';
import { analyzeMoneyMagnetScalping } from '../lib/smc';
import { getUniverse, getMarketMetadata } from './screener';

const router = Router();

// Menu BARU (request user): Money Magnet Scalping -- logic Money Magnet
// (Scalping, single-level) TF diganti: H4->M30 (trend), M30->M5 (eksekusi).
// Cuma 1 skill, jadi gak ada toggle mode kayak menu Scalping/Sniper Breakout.

// GET /api/money-magnet-scalping?symbol=BTCUSDT
router.get('/money-magnet-scalping', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  const normalized = symbol.toUpperCase().endsWith('USDT')
    ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
  try {
    const result = await analyzeMoneyMagnetScalping(normalized);
    res.json({ ...result, recentPerformance: null }); // recentPerformance belum didukung, sama kayak Money Magnet 3
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESSIVE SCAN STATE (request user, "otomatis scan pas buka app, hasil
// progresif tanpa nunggu selesai") -- pola sama persis Sniper Breakout &
// Scalping. Universe SENDIRI 300 koin (bukan gabung sama menu lain).
// ═══════════════════════════════════════════════════════════════════════════
type MoneyMagnetScalpingScanState = {
  results: Array<Awaited<ReturnType<typeof analyzeMoneyMagnetScalping>> & { marketMeta?: unknown }>;
  scanned: number;
  total: number;
  status: 'idle' | 'running' | 'complete' | 'error';
  errorMessage?: string;
  fetchedAt: number;
};
let mmScalpingScanState: MoneyMagnetScalpingScanState = { results: [], scanned: 0, total: 0, status: 'idle', fetchedAt: 0 };
let mmScalpingScanRunning = false;

async function runMoneyMagnetScalpingScan(): Promise<void> {
  if (mmScalpingScanRunning) return;
  mmScalpingScanRunning = true;
  mmScalpingScanState = { results: [], scanned: 0, total: 0, status: 'running', fetchedAt: Date.now() };
  try {
    // REVISI (request user): naik dari 300 jadi 500 koin
    const universe = await getUniverse(500);
    mmScalpingScanState.total = universe.length;
    const batchSize = 3; // 1 skill doang, bisa agak lebih agresif dari 2-skill menu lain
    for (let i = 0; i < universe.length; i += batchSize) {
      const batch = universe.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map((s) => analyzeMoneyMagnetScalping(s))
      );
      mmScalpingScanState.scanned += batch.length;
      const newValid: typeof mmScalpingScanState.results = [];
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
      mmScalpingScanState.results.push(...newValid);
      const order: Record<string, number> = { in_zone: 0, approaching: 1, waiting: 2 };
      mmScalpingScanState.results.sort((a, b) => {
        const ao = order[a.status] ?? 2, bo = order[b.status] ?? 2;
        return ao - bo;
      });
      if (i + batchSize < universe.length) await new Promise(r => setTimeout(r, 500));
    }
    mmScalpingScanState.status = 'complete';
    mmScalpingScanState.fetchedAt = Date.now();
  } catch (err) {
    mmScalpingScanState.status = 'error';
    mmScalpingScanState.errorMessage = err instanceof Error ? err.message : 'Unknown error';
  } finally {
    mmScalpingScanRunning = false;
  }
}

// GET /api/money-magnet-scalping/scan — POLLING-BASED, sama pola kayak
// breakout.ts/breakout-entry.ts. ?fresh=true maksa mulai scan baru.
router.get('/money-magnet-scalping/scan', async (req, res) => {
  try {
    const forceFresh = req.query['fresh'] === 'true';
    if (mmScalpingScanState.status === 'idle' || (forceFresh && !mmScalpingScanRunning)) {
      runMoneyMagnetScalpingScan(); // fire-and-forget, SENGAJA gak di-await
    }
    res.json({
      coins: mmScalpingScanState.results,
      scanned: mmScalpingScanState.scanned,
      total: mmScalpingScanState.total,
      status: mmScalpingScanState.status,
      errorMessage: mmScalpingScanState.errorMessage,
      fetchedAt: mmScalpingScanState.fetchedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;