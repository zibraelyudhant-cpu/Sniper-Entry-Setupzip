import { Router } from "express";
import { analyzePriceActionStructure, fetchKlines } from "../lib/smc";

const router = Router();

const BINANCE_FUTURES_BASE = "https://fapi.binance.com";

// Top symbols to screen (major futures pairs)
const TOP_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT",
  "MATICUSDT", "NEARUSDT", "ATOMUSDT", "UNIUSDT", "LTCUSDT",
  "BCHUSDT", "AAVEUSDT", "APTUSDT", "ARBUSDT", "OPUSDT",
  "SUIUSDT", "SEIUSDT", "TIAUSDT", "INJUSDT", "WLDUSDT",
];

router.get("/screener", async (req, res) => {
  try {
    // Fetch 24h tickers for all symbols in one call
    const tickersRes = await fetch(
      `${BINANCE_FUTURES_BASE}/fapi/v1/ticker/24hr`
    );
    if (!tickersRes.ok) {
      res.status(500).json({ error: "Failed to fetch tickers" });
      return;
    }

    const allTickers: Array<{
      symbol: string;
      lastPrice: string;
      priceChangePercent: string;
      quoteVolume: string;
    }> = await tickersRes.json();

    // Filter to our symbol list
    const tickers = allTickers
      .filter((t) => TOP_SYMBOLS.includes(t.symbol))
      .sort(
        (a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume)
      )
      .slice(0, 20);

    // Run D1 analysis for each symbol in parallel (batched to avoid rate limits)
    const batchSize = 5;
    const results: Array<{
      symbol: string;
      price: number;
      change24h: number;
      volume24h: number;
      bias: "bullish" | "bearish" | "ranging";
      strength: "strong" | "weak" | "neutral";
    }> = [];

    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (ticker) => {
          try {
            const d1 = await fetchKlines(ticker.symbol, "1d", 30);
            const struct = analyzePriceActionStructure(
              d1.highs,
              d1.lows,
              d1.closes
            );
            return {
              symbol: ticker.symbol,
              price: parseFloat(ticker.lastPrice),
              change24h: parseFloat(ticker.priceChangePercent),
              volume24h: parseFloat(ticker.quoteVolume),
              bias: struct.bias,
              strength: struct.strength,
            };
          } catch {
            return {
              symbol: ticker.symbol,
              price: parseFloat(ticker.lastPrice),
              change24h: parseFloat(ticker.priceChangePercent),
              volume24h: parseFloat(ticker.quoteVolume),
              bias: "ranging" as const,
              strength: "neutral" as const,
            };
          }
        })
      );
      results.push(...batchResults);
    }

    res.json({
      coins: results,
      fetchedAt: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err }, "Screener error");
    res.status(500).json({ error: message });
  }
});

export default router;
