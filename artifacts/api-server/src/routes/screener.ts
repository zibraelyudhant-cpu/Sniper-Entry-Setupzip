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

interface MACDResult { macdLine: number; signalLine: number; histogram: number }

function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9): MACDResult {
  if (closes.length < slow + signal) return { macdLine: 0, signalLine: 0, histogram: 0 };
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const macdValid = macdLine.slice(slow - 1);
  const signalArr = calcEMA(macdValid, signal);
  const lastMacd = macdValid[macdValid.length - 1];
  const lastSignal = signalArr[signalArr.length - 1];
  return { macdLine: lastMacd, signalLine: lastSignal, histogram: lastMacd - lastSignal };
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
  bias: "bullish" | "bearish";
  score: number;
  confidence: "HIGH" | "MODERATE" | "LOW";
  price: number;
  change24h: number;
  volume24h: number;
  rsiH4: number;
  rsiH1: number;
  macdValidH4: boolean;
  macdValidH1: boolean;
  atrH4: number;
  atrH4Pct: number;
  adxH4: number;
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

            const [h4, h1, oiHistRes, frRes] = await Promise.all([
              fetchKlines(ticker.symbol, "4h", 100),
              fetchKlines(ticker.symbol, "1h", 50),
              fetch(`${BINANCE_FUTURES_BASE}/futures/data/openInterestHist?symbol=${ticker.symbol}&period=1h&limit=6`),
              fetch(`${BINANCE_FUTURES_BASE}/fapi/v1/fundingRate?symbol=${ticker.symbol}&limit=1`),
            ]);

            // ── Filter 1: H4 dan H1 harus searah, keduanya tidak ranging ─────
            const strH4 = analyzePriceActionStructure(h4.highs, h4.lows, h4.closes);
            const strH1 = analyzePriceActionStructure(h1.highs, h1.lows, h1.closes);
            if (strH4.bias === "ranging") return null;
            if (strH4.bias !== strH1.bias) return null;
            const bias = strH4.bias as "bullish" | "bearish";

            // ── Filter 2: ADX H4 >= 25 ────────────────────────────────────────
            const adxH4 = calcADX(h4.highs, h4.lows, h4.closes);
            if (adxH4 < 25) return null;

            // ── Filter 3: RSI H4 valid range ──────────────────────────────────
            const rsiH4 = calcRSI(h4.closes);
            const rsiH1 = calcRSI(h1.closes);
            if (bias === "bullish" && (rsiH4 < 50 || rsiH4 > 80)) return null;
            if (bias === "bearish" && (rsiH4 < 30 || rsiH4 > 50)) return null;

            // ── Filter 4: MACD H4 valid ───────────────────────────────────────
            const macdH4 = calcMACD(h4.closes);
            const macdH1 = calcMACD(h1.closes);
            const macdValidH4 =
              bias === "bullish"
                ? macdH4.macdLine > macdH4.signalLine && macdH4.macdLine > 0
                : macdH4.macdLine < macdH4.signalLine && macdH4.macdLine < 0;
            if (!macdValidH4) return null;
            const macdValidH1 =
              bias === "bullish"
                ? macdH1.macdLine > macdH1.signalLine
                : macdH1.macdLine < macdH1.signalLine;

            // ── Filter 5: ATR H4 >= 0.5% dari harga ──────────────────────────
            const atrH4 = calcATR(h4.highs, h4.lows, h4.closes);
            const atrH4Pct = (atrH4 / price) * 100;
            if (atrH4Pct < 0.5) return null;

            // ── Filter 6: OI + Funding ────────────────────────────────────────
            let fundingRate = 0;
            let oiDirection: "up" | "down" | "neutral" = "neutral";

            if (frRes.ok) {
              const frData: Array<{ fundingRate: string }> = await frRes.json();
              if (frData.length > 0) {
                fundingRate = parseFloat(frData[0].fundingRate) * 100;
                if (bias === "bullish" && fundingRate > 0.1) return null;
                if (bias === "bearish" && fundingRate < -0.1) return null;
              }
            }

            if (oiHistRes.ok) {
              const oiHist: Array<{ sumOpenInterest: string }> = await oiHistRes.json();
              if (oiHist.length >= 2) {
                const latest = parseFloat(oiHist[oiHist.length - 1].sumOpenInterest);
                const first = parseFloat(oiHist[0].sumOpenInterest);
                const oiChange = ((latest - first) / first) * 100;
                oiDirection = oiChange > 0.5 ? "up" : oiChange < -0.5 ? "down" : "neutral";
                if (bias === "bullish" && oiChange < -2) return null;
                if (bias === "bearish" && oiChange < -2) return null;
              }
            }

            // ── Volume ratio: H4 last 24h vs prev 24h (6 candles x 4h = 24h) ─
            const recent24h = h4.volumes.slice(-6).reduce((a, b) => a + b, 0);
            const prev24h = h4.volumes.slice(-12, -6).reduce((a, b) => a + b, 0);
            const volumeValid = prev24h > 0 && recent24h >= prev24h * 1.2;

            // ── Scoring ───────────────────────────────────────────────────────
            let score = 0;
            if (strH4.strength === "strong") score += 2;
            if (strH1.strength === "strong") score += 1;
            if (adxH4 > 30) score += 2;
            else if (adxH4 > 25) score += 1;
            const rsiH4Optimal =
              bias === "bullish" ? rsiH4 >= 55 && rsiH4 <= 70 : rsiH4 >= 30 && rsiH4 <= 45;
            if (rsiH4Optimal) score += 1;
            const rsiH1Optimal =
              bias === "bullish" ? rsiH1 >= 50 && rsiH1 <= 70 : rsiH1 >= 30 && rsiH1 <= 50;
            if (rsiH1Optimal) score += 1;
            if (bias === "bullish" ? macdH4.histogram > 0 : macdH4.histogram < 0) score += 1;
            if (bias === "bullish" ? macdH1.histogram > 0 : macdH1.histogram < 0) score += 1;
            if (volumeValid) score += 1;

            const confidence: "HIGH" | "MODERATE" | "LOW" =
              score >= 7 ? "HIGH" : score >= 4 ? "MODERATE" : "LOW";

            return {
              symbol: ticker.symbol,
              bias,
              score,
              confidence,
              price,
              change24h: parseFloat(ticker.priceChangePercent),
              volume24h: parseFloat(ticker.quoteVolume),
              rsiH4,
              rsiH1,
              macdValidH4,
              macdValidH1,
              atrH4,
              atrH4Pct,
              adxH4,
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

export async function getUniverse(): Promise<string[]> {
  const [cryptoSymbols, tickersRes] = await Promise.all([
    getCryptoPerpetualSymbols(),
    fetch(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/24hr`),
  ]);
  if (!tickersRes.ok) throw new Error('Failed to fetch tickers');
  const allTickers: Array<{ symbol: string; quoteVolume: string }> = await tickersRes.json();
  return allTickers
    .filter(t => cryptoSymbols.has(t.symbol))
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, 50)
    .map(t => t.symbol);
}
