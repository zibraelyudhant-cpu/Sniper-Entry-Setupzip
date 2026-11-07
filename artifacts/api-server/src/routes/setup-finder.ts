import { Router } from 'express';
import { getUniverse } from './screener';
import {
  SF, sfState, sfIsRunning, runSetupFinderScan, getAllUsdtPerps, analyzeSetupFinderCoin, checkSetupEntry, rankSetups, normalizeRr, sfUsedWeight,
  type SFScanParams,
} from '../lib/setup-finder';

const router = Router();

// Spesifikasi Setup Finder (user, 2026-11-05). Scan POLLING-BASED, pola sama menu lain.
// Universe koin = getUniverse(500) (sama dengan menu lain, + cadangan s/d 550 buat ganti koin yang gagal).
// Scan MANUAL (request user 2026-11-05, semua menu): hanya mulai lewat ?start=true (tombol). ±70-80 weight per koin, 500 koin ≈ 37 rb weight (± 20 menit, rem otomatis di 2000/menit).
// Param scan (rr, side, minWall, coins) fix selama scan jalan; minWr/show/onlyPositive cuma filter tampilan.

function parseParams(q: Record<string, unknown>): SFScanParams {
  const rr = normalizeRr(String(q['rr'] ?? '').split(',').map(x => parseFloat(x)).filter(x => !isNaN(x)));
  const sideQ = String(q['side'] ?? 'BOTH').toUpperCase();
  const side = sideQ === 'BUY' || sideQ === 'SELL' ? sideQ : 'BOTH';
  const minWall = Math.min(5_000_000, Math.max(10_000, parseFloat(String(q['minWall'] ?? SF.walls.minUsdt)) || SF.walls.minUsdt));
  const slCap = String(q['slCap'] ?? 'potong') === 'tolak' ? 'tolak' : 'potong';
  // daftar manual: "btc,eth,sol" -> BTCUSDT,ETHUSDT,SOLUSDT (tidak ada koin pengganti). Kalau kosong: N koin volume 24 jam terbesar (default 20; "semua" = semua USDT perpetual TRADING).
  const symbols = String(q['symbols'] ?? '').split(/[\s,;]+/).map(x => x.trim().toUpperCase()).filter(Boolean).map(x => (x.endsWith('USDT') ? x : `${x}USDT`));
  const coinsQ = String(q['coins'] ?? '20').toLowerCase();
  const allCoins = coinsQ === 'semua' || coinsQ === 'all';
  const coins = allCoins ? 100000 : Math.min(100000, Math.max(1, parseInt(coinsQ, 10) || 20)); // "semua" = semua USDT perpetual TRADING, tanpa batas 550
  return { rr, side, minWall, coins: symbols.length ? symbols.length : coins, slCap, symbols: symbols.length ? [...new Set(symbols)] : undefined };
}

// GET /api/setup-finder/scan?start=true&rr=1,1.5,2,3&side=BOTH&minWall=100000&coins=20&symbols=btc,eth,sol&slCap=potong&minWr=0&show=10
router.get('/setup-finder/scan', async (req, res) => {
  try {
    const q = req.query as Record<string, unknown>;
    if (q['start'] === 'true' && !sfIsRunning()) {
      const p = parseParams(q);
      const pool = p.symbols ?? (p.coins > 550 ? await getAllUsdtPerps() : await getUniverse(550));
      void runSetupFinderScan(pool, p); // fire-and-forget
      await new Promise(r => setTimeout(r, 50));
    }
    const minWr = Math.max(0, parseFloat(String(q['minWr'] ?? '0')) || 0);
    const show = Math.max(0, parseInt(String(q['show'] ?? '10'), 10) || 0);
    const onlyPositive = q['onlyPositive'] === 'true';
    res.json({
      status: sfState.status, errorMessage: sfState.errorMessage, params: sfState.params,
      target: sfState.target, scanned: sfState.scanned, failed: sfState.failed, skippedSetups: sfState.skippedSetups,
      usedWeight: sfUsedWeight(), startedAt: sfState.startedAt, fetchedAt: sfState.fetchedAt,
      totalSetups: sfState.results.reduce((s, r) => s + r.setups.length, 0),
      ...(() => { const r = rankSetups(sfState.results, minWr, show, onlyPositive); return { setups: r.rows, rrComparison: r.comparison }; })(),
      clippedSetups: sfState.results.reduce((n, r) => n + r.setups.filter(x => x.slClipped).length, 0),
      version: SF.VERSION,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/setup-finder?symbol=BTCUSDT&rr=1,2,3&side=BOTH&minWall=100000&slCap=potong  (1 koin, depth 1000)
router.get('/setup-finder', async (req, res) => {
  try {
    const symbol = String(req.query['symbol'] ?? '').toUpperCase();
    if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
    const sym = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
    const p = parseParams(req.query as Record<string, unknown>);
    const r = await analyzeSetupFinderCoin(sym, { rr: p.rr, side: p.side, minWall: p.minWall, slCap: p.slCap }, true);
    res.json({ ...r, version: SF.VERSION });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/setup-finder/check?symbol=BTCUSDT&side=BUY&entry=..&sl=..&tp=..&status=belum|berjalan&minRr=2&minWall=50000
router.get('/setup-finder/check', async (req, res) => {
  try {
    const q = req.query as Record<string, unknown>;
    const symbol = String(q['symbol'] ?? '').toUpperCase();
    if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
    const sym = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
    const side = String(q['side'] ?? '').toUpperCase();
    if (side !== 'BUY' && side !== 'SELL') { res.status(400).json({ error: 'side harus BUY / SELL' }); return; }
    const status = String(q['status'] ?? '') === 'berjalan' ? 'berjalan' : 'belum';
    const entry = parseFloat(String(q['entry'] ?? '')), sl = parseFloat(String(q['sl'] ?? '')), tp = parseFloat(String(q['tp'] ?? ''));
    if (![sl, tp].every(x => isFinite(x) && x > 0) || (status === 'belum' && !(isFinite(entry) && entry > 0))) { res.status(400).json({ error: 'entry / sl / tp harus angka > 0' }); return; }
    const minRr = Math.max(0.5, parseFloat(String(q['minRr'] ?? '2')) || 2);
    const minWall = Math.min(5_000_000, Math.max(10_000, parseFloat(String(q['minWall'] ?? SF.walls.minUsdt)) || SF.walls.minUsdt));
    res.json(await checkSetupEntry(sym, { side, entry: isFinite(entry) ? entry : 0, sl, tp, status, minRr, minWall }));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
