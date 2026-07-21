import { Router } from "express";
import { analyzeSniperEntry } from "../lib/smc";

const router = Router();

// GET /api/smc-analysis?symbol=BTCUSDT
router.get("/smc-analysis", async (req, res) => {
  const symbol = req.query["symbol"] as string;
  if (!symbol) {
    res.status(400).json({ error: "symbol required" });
    return;
  }

  // Ensure USDT suffix
  const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
    ? symbol.toUpperCase()
    : `${symbol.toUpperCase()}USDT`;

  const result = await analyzeSniperEntry(normalizedSymbol);
  res.json(result);
});

// GET /api/sniper/scan
router.get('/sniper/scan', async (req, res) => {
  try {
    const { getUniverse } = await import('./screener');
    const universe = await getUniverse();
    const results: Awaited<ReturnType<typeof analyzeSniperEntry>>[] = [];
    const batchSize = 3; // kurangi batch size untuk hindari rate limit
    for (let i = 0; i < universe.length; i += batchSize) {
      const batch = universe.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch.map(s => analyzeSniperEntry(s)));
      // Delay antar batch untuk hindari rate limit Binance
      if (i + batchSize < universe.length) await new Promise(r => setTimeout(r, 300));
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          const val = r.value;
          if (val.status === 'ready' && (val.profitProbability ?? 0) >= 15) {
            results.push(val);
          }
        }
      }
    }
    // Sort by profitProbability descending
    results.sort((a, b) => (b.profitProbability ?? 0) - (a.profitProbability ?? 0));
    res.json({ coins: results, fetchedAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;