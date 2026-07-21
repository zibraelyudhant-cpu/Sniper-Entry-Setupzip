import { Router } from "express";
import { analyzePriceActionStructure, fetchKlines } from "../lib/smc";

const router = Router();
const BINANCE_FUTURES_BASE = "https://fapi.binance.com";

// ─── Symbol cache ─────────────────────────────────────────────────────────────

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

// ─── Technical indicators ─────────────────────────────────────────────────────

function calcATR(highs: number[], lows: number[], closes: number[], period = 14): number {
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }
  const slice = trs.slice(-period);
  return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
}

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  let avgGain = gains.reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.reduce((a, b) => a + b, 0) / period;
  const recentCloses = closes.slice(period);
  const prevCloses = closes.slice(period - 1, -1);
  for (let i = 0; i < recentCloses.length; i++) {
    const diff = recentCloses[i] - prevCloses[i];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function getLastEMA(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}



function calcADX(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (highs.length < period * 2 + 1) return 0;
  const trs: number[] = [];
  const dmPlus: number[] = [];
  const dmMinus: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    dmPlus.push(up > down && up > 0 ? up : 0);
    dmMinus.push(down > up && down > 0 ? down : 0);
  }
  let atr14 = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let dm14Plus = dmPlus.slice(0, period).reduce((a, b) => a + b, 0);
  let dm14Minus = dmMinus.slice(0, period).reduce((a, b) => a + b, 0);
  const dxArr: number[] = [];
  for (let i = period; i < trs.length; i++) {
    atr14 = atr14 - atr14 / period + trs[i];
    dm14Plus = dm14Plus - dm14Plus / period + dmPlus[i];
    dm14Minus = dm14Minus - dm14Minus / period + dmMinus[i];
    const dip = atr14 ? (dm14Plus / atr14) * 100 : 0;
    const dim = atr14 ? (dm14Minus / atr14) * 100 : 0;
    const sum = dip + dim;
    dxArr.push(sum ? (Math.abs(dip - dim) / sum) * 100 : 0);
  }
  if (dxArr.length < period) return 0;
  return dxArr.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScreenerEntry {
  symbol: string;
  bias: "bullish" | "bearish";       // trend utama H4
  correctionBias: "bullish" | "bearish"; // arah koreksi H1 (berlawanan dengan bias)
  score: number;
  confidence: "HIGH" | "MODERATE" | "LOW";
  price: number;
  change24h: number;
  volume24h: number;
  rsiH4: number;
  rsiH1: number;
  atrH4: number;
  atrH4Pct: number;
  adxH4: number;
  correctionDepthPct: number; // seberapa dalam koreksi dari high/low terakhir
  volumeValid: boolean;
  oiDirection: "up" | "down" | "neutral";
  fundingRate: number;
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get("/screener", async (req, res) => {
  try {
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

    // Top 50 by volume as candidates — filters will reduce to ≤20
    const candidates = allTickers
      .filter((t) => cryptoSymbols.has(t.symbol))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 50);

    const batchSize = 5;
    const results: ScreenerEntry[] = [];

    for (let i = 0; i < candidates.length && results.length < 20; i += batchSize) {
      const batch = candidates.slice(i, Math.min(i + batchSize, candidates.length));

      const batchResults = await Promise.all(
        batch.map(async (ticker): Promise<ScreenerEntry | null> => {
          try {
            const price = parseFloat(ticker.lastPrice);

            const [h4, h1] = await Promise.all([
              fetchKlines(ticker.symbol, "4h", 100),
              fetchKlines(ticker.symbol, "1h", 50),
            ]);

            // ── Filter 1: H4 harus trend jelas (tidak ranging) ───────────────
            const strH4 = analyzePriceActionStructure(h4.highs, h4.lows, h4.closes);
            if (strH4.bias === "ranging") return null;
            const bias = strH4.bias as "bullish" | "bearish";

            // ── Filter 2: H1 harus berlawanan dengan H4 (koreksi sedang terjadi)
            const strH1 = analyzePriceActionStructure(h1.highs, h1.lows, h1.closes);
            // H1 harus bearish kalau H4 bullish (pullback), atau H1 bullish kalau H4 bearish (bounce)
            // H1 ranging juga ok — bisa berarti konsolidasi sebelum lanjut trend
            const h1IsCorrection = strH1.bias !== bias;
            const h1IsRanging = strH1.bias === "ranging";
            if (!h1IsCorrection && !h1IsRanging) return null; // H1 searah H4 = belum koreksi

            const correctionBias = bias === "bullish" ? "bearish" : "bullish";

            // ── Filter 3: ADX H4 >= 25 (trend kuat) ──────────────────────────
            const adxH4 = calcADX(h4.highs, h4.lows, h4.closes);
            if (adxH4 < 25) return null;

            // ── Filter 4: RSI H1 belum oversold/overbought ekstrem ────────────
            // Koreksi masih sehat: RSI H1 tidak boleh melewati level ekstrem
            // Bullish trend: RSI H1 pullback tapi tidak < 25 (terlalu dalam = reversal)
            // Bearish trend: RSI H1 bounce tapi tidak > 75 (terlalu tinggi = reversal)
            const rsiH1 = calcRSI(h1.closes);
            const rsiH4 = calcRSI(h4.closes);
            if (bias === "bullish" && rsiH1 < 25) return null; // koreksi terlalu dalam
            if (bias === "bearish" && rsiH1 > 75) return null; // bounce terlalu tinggi

            // ── Filter 5: ATR H4 >= 0.5% (volatilitas cukup) ─────────────────
            const atrH4 = calcATR(h4.highs, h4.lows, h4.closes);
            const atrH4Pct = (atrH4 / price) * 100;
            if (atrH4Pct < 0.5) return null;

            // ── Hitung kedalaman koreksi dari high/low H4 terakhir ────────────
            const recentH4Highs = h4.highs.slice(-20);
            const recentH4Lows = h4.lows.slice(-20);
            let correctionDepthPct = 0;
            if (bias === "bullish") {
              const swingHigh = Math.max(...recentH4Highs);
              correctionDepthPct = ((swingHigh - price) / swingHigh) * 100;
            } else {
              const swingLow = Math.min(...recentH4Lows);
              correctionDepthPct = ((price - swingLow) / swingLow) * 100;
            }

            const fundingRate = 0;
            const oiDirection: "up" | "down" | "neutral" = "neutral";

            // ── Volume ratio ──────────────────────────────────────────────────
            const recent24h = h4.volumes.slice(-6).reduce((a, b) => a + b, 0);
            const prev24h = h4.volumes.slice(-12, -6).reduce((a, b) => a + b, 0);
            const volumeValid = prev24h > 0 && recent24h >= prev24h * 0.8; // volume koreksi wajar lebih kecil

            // ── Scoring (max 8) ───────────────────────────────────────────────
            let score = 0;
            // H4 trend kuat
            if (strH4.strength === "strong") score += 2;
            else if (strH4.strength === "moderate") score += 1;
            // ADX kuat
            if (adxH4 > 35) score += 2;
            else if (adxH4 > 25) score += 1;
            // RSI H4 di zona trend sehat
            const rsiH4Healthy = bias === "bullish"
              ? rsiH4 >= 50 && rsiH4 <= 75  // trend bullish sehat
              : rsiH4 >= 25 && rsiH4 <= 50; // trend bearish sehat
            if (rsiH4Healthy) score += 1;
            // Koreksi belum terlalu dalam (masih dalam range normal 3–15%)
            const correctionHealthy = correctionDepthPct >= 3 && correctionDepthPct <= 15;
            if (correctionHealthy) score += 1;
            // H1 sudah mulai melemah (koreksi mau selesai)
            // RSI H1 di area oversold ringan untuk bullish, overbought ringan untuk bearish
            const rsiH1Exhausted = bias === "bullish"
              ? rsiH1 >= 25 && rsiH1 <= 45  // pullback hampir habis
              : rsiH1 >= 55 && rsiH1 <= 75; // bounce hampir habis
            if (rsiH1Exhausted) score += 1;
            // Volume koreksi sehat
            if (volumeValid) score += 1;

            const confidence: "HIGH" | "MODERATE" | "LOW" =
              score >= 6 ? "HIGH" : score >= 3 ? "MODERATE" : "LOW";

            return {
              symbol: ticker.symbol,
              bias,
              correctionBias,
              score,
              confidence,
              price,
              change24h: parseFloat(ticker.priceChangePercent),
              volume24h: parseFloat(ticker.quoteVolume),
              rsiH4,
              rsiH1,
              atrH4,
              atrH4Pct,
              adxH4,
              correctionDepthPct,
              volumeValid,
              oiDirection,
              fundingRate,
            };
          } catch {
            return null;
          }
        })
      );

      for (const r of batchResults) {
        if (r !== null && results.length < 20) results.push(r);
      }
    }

    // Sort by score desc — setup terbaik muncul paling atas
    results.sort((a, b) => b.score - a.score);

    res.json({ coins: results, fetchedAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log.error({ err }, "Screener error");
    res.status(500).json({ error: message });
  }
});

export default router;

// Cache universe 10 menit supaya tidak spam Binance
let universeCache: { symbols: string[]; ts: number } | null = null;
const UNIVERSE_CACHE_MS = 10 * 60 * 1000;

export async function getUniverse(): Promise<string[]> {
  if (universeCache && Date.now() - universeCache.ts < UNIVERSE_CACHE_MS) {
    return universeCache.symbols;
  }

  // Retry max 2x dengan timeout 8 detik
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const [cryptoSymbols, tickersRes] = await Promise.all([
        getCryptoPerpetualSymbols(),
        fetch(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/24hr`, { signal: controller.signal }),
      ]);
      clearTimeout(timeout);
      if (!tickersRes.ok) {
        if (attempt < 1) { await new Promise(r => setTimeout(r, 1000)); continue; }
        throw new Error(`Failed to fetch tickers (${tickersRes.status})`);
      }
      const allTickers: Array<{ symbol: string; quoteVolume: string }> = await tickersRes.json();
      const symbols = allTickers
        .filter(t => cryptoSymbols.has(t.symbol))
        .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
        .slice(0, 50)
        .map(t => t.symbol);
      universeCache = { symbols, ts: Date.now() };
      return symbols;
    } catch (err) {
      if (attempt < 1) { await new Promise(r => setTimeout(r, 1000)); continue; }
      // Kalau cache lama masih ada, pakai itu daripada throw
      if (universeCache) return universeCache.symbols;
      throw err;
    }
  }
  throw new Error('Failed to fetch universe after retries');
}