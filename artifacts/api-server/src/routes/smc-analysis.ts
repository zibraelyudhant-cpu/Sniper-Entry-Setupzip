import { Router } from "express";
import {
  analyzeSniperEntry,
  analyzeRSI2Entry,
  classifyEntryMode,
  fetchKlines,
  getRecentPerformance,
} from "../lib/smc";

const router = Router();

// GET /api/smc-analysis?symbol=BTCUSDT&mode=sniper|rsi2 (mode opsional — kalau
// gak dikasih, classifier yang nentuin otomatis berdasarkan ADX+RSI(2) H4)
router.get("/smc-analysis", async (req, res) => {
  const symbol = req.query["symbol"] as string;
  const modeParam = req.query["mode"] as string | undefined;
  if (!symbol) {
    res.status(400).json({ error: "symbol required" });
    return;
  }

  const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
    ? symbol.toUpperCase()
    : `${symbol.toUpperCase()}USDT`;

  try {
    // Classifier dulu (murah, cuma ADX+RSI2) — buat kasih tau recommendedMode
    // ke UI, INDEPENDEN dari mode yang akhirnya dipilih (user bisa override manual)
    const classifyData = await fetchKlines(normalizedSymbol, "4h", 250);
    const classification = classifyEntryMode(classifyData.highs, classifyData.lows, classifyData.closes);

    const mode: "sniper" | "rsi2" =
      modeParam === "sniper" || modeParam === "rsi2" ? modeParam : classification.recommendedMode;

    const result = mode === "rsi2"
      ? await analyzeRSI2Entry(normalizedSymbol)
      : await analyzeSniperEntry(normalizedSymbol);

    // Mini-backtest instan — cuma buat mode Sniper dulu (RSI-2 belum ada backtest-nya)
    const recentPerformance = mode === "sniper"
      ? await getRecentPerformance(normalizedSymbol, "sniper")
      : null;

    res.json({ ...result, mode, recommendedMode: classification.recommendedMode, recentPerformance });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// GET /api/sniper/scan — classifier-driven: tiap koin di-classify dulu (murah),
// BARU dianalisa penuh sesuai mode yang cocok (1x per koin, BUKAN 2x/koin)
router.get('/sniper/scan', async (req, res) => {
  try {
    const { getUniverse } = await import('./screener');
    const universe = await getUniverse();
    const results: Array<Awaited<ReturnType<typeof analyzeSniperEntry>> & { mode: string; recommendedMode: string }> = [];
    const batchSize = 3; // kurangi batch size untuk hindari rate limit

    for (let i = 0; i < universe.length; i += batchSize) {
      const batch = universe.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch.map(async (s) => {
        const classifyData = await fetchKlines(s, '4h', 250);
        const classification = classifyEntryMode(classifyData.highs, classifyData.lows, classifyData.closes);
        const val = classification.recommendedMode === 'rsi2'
          ? await analyzeRSI2Entry(s)
          : await analyzeSniperEntry(s);
        return { ...val, mode: classification.recommendedMode, recommendedMode: classification.recommendedMode };
      }));
      // Delay antar batch untuk hindari rate limit Binance
      if (i + batchSize < universe.length) await new Promise(r => setTimeout(r, 300));
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          const val = r.value;
          if (val.status !== 'ready') continue;
          // Threshold: kedua mode sekarang pakai score/maxScore (profitProbability
          // udah dihapus dari mode Sniper — algoritma breakout+retest yang baru
          // udah punya hard filter sendiri: pullback volume wajib, min 1/2
          // konfirmasi tambahan, BTC correlation — jadi gak butuh threshold ekstra).
          results.push(val);
        }
      }
    }

    // Sort pakai confidence yang dinormalisasi ke skala 0-100, konsisten buat
    // kedua mode (sniper & rsi2) — sama-sama pakai score/maxScore sekarang.
    const confidenceOf = (v: typeof results[number]) => ((v.score ?? 0) / (v.maxScore || 1)) * 100;
    results.sort((a, b) => confidenceOf(b) - confidenceOf(a));

    res.json({ coins: results, fetchedAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;