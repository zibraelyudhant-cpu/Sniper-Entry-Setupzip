import { Router } from "express";
import { analyzePriceActionStructure, fetchKlines } from "../lib/smc";

const router = Router();

const BINANCE_FUTURES_BASE = "https://fapi.binance.com";

// Cache valid perpetual crypto symbols for 10 minutes to avoid hitting exchangeInfo on every request
let cryptoSymbolCache: Set<string> | null = null;
let cryptoSymbolCacheAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

async function getCryptoPerpetualSymbols(): Promise<Set<string>> {
  const now = Date.now();
  if (cryptoSymbolCache && now - cryptoSymbolCacheAt < CACHE_TTL_MS) {
    return cryptoSymbolCache;
  }

  const res = await fetch(`${BINANCE_FUTURES_BASE}/fapi/v1/exchangeInfo`);
  if (!res.ok) throw new Error("Failed to fetch exchangeInfo");

  const data: {
    symbols: Array<{
      symbol: string;
      contractType: string;
      status: string;
      quoteAsset: string;
      underlyingType: string;
    }>;
  } = await res.json();

  // Only USDT perpetuals where the underlying is a crypto coin (not equity/commodity)
  const symbols = new Set(
    data.symbols
      .filter(
        (s) =>
          s.contractType === "PERPETUAL" &&
          s.quoteAsset === "USDT" &&
          s.status === "TRADING" &&
          s.underlyingType === "COIN"
      )
      .map((s) => s.symbol)
  );

  cryptoSymbolCache = symbols;
  cryptoSymbolCacheAt = now;
  return symbols;
}

router.get("/screener", async (req, res) => {
  try {
    // Fetch valid crypto perpetual symbols and 24h tickers in parallel
    const [cryptoSymbols, tickersRes] = await Promise.all([
      getCryptoPerpetualSymbols(),
      fetch(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/24hr`),
    ]);

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

    // Top 20 crypto-only USDT perpetuals by 24h quote volume
    const tickers = allTickers
      .filter((t) => cryptoSymbols.has(t.symbol))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
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
