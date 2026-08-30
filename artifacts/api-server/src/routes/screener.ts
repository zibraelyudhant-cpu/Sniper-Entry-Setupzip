import { Router } from "express";
import { analyzeMarketStructureV2, fetchKlines } from "../lib/smc";

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
  rsiD1: number;
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

            const [d1, h4] = await Promise.all([
              fetchKlines(ticker.symbol, "1d", 50),
              fetchKlines(ticker.symbol, "4h", 100),
            ]);

            // ── Filter 1: D1 harus trend jelas (bukan sideways) — Market
            // Structure V2 (request user: "semua market structure wajib V2,
            // gak ada pengecualian"). Gantiin analyzePriceActionStructure +
            // zigzagBias hard-gate — V2 udah punya klasifikasi strength
            // built-in (bullish_strong/weak dst) yang lebih robust daripada
            // ZigZag konfirmasi terpisah, jadi zigzagBias gak diperluin lagi.
            const d1V2 = analyzeMarketStructureV2(d1.opens, d1.highs, d1.lows, d1.closes, 'D1');
            if (d1V2.bias === 'sideways') return null;
            const bias = d1V2.bias;

            const h4V2 = analyzeMarketStructureV2(h4.opens, h4.highs, h4.lows, h4.closes, 'H4');

            // ── Filter 2: H4 harus berlawanan dengan D1 (koreksi sedang terjadi)
            const h4IsCorrection = h4V2.bias !== bias && h4V2.bias !== 'sideways';
            const h4IsRanging = h4V2.bias === 'sideways';
            if (!h4IsCorrection && !h4IsRanging) return null; // H4 searah D1 = belum koreksi

            const correctionBias = bias === "bullish" ? "bearish" : "bullish";

            // ── Filter 3: ADX D1 >= 25 (trend kuat di D1) ────────────────────
            const adxH4 = calcADX(d1.highs, d1.lows, d1.closes);
            if (adxH4 < 25) return null;

            // ── Filter 4: EMA 21/34/61 hard filter (H4) ─────────────────────
            // Bullish: harga harus di atas EMA 21 atau minimal di antara EMA 21-61
            // Bearish: harga harus di bawah EMA 21 atau minimal di antara EMA 21-61
            const ema21H4 = getLastEMA(h4.closes, 21);
            const ema34H4 = getLastEMA(h4.closes, 34);
            const ema61H4 = getLastEMA(h4.closes, 61);
            if (bias === "bullish" && price < ema61H4) return null; // harga terlalu jauh di bawah EMA
            if (bias === "bearish" && price > ema61H4) return null; // harga terlalu jauh di atas EMA

            // ── Filter 5: RSI H4 dan D1 ──────────────────────────────────────
            const rsiH4 = calcRSI(h4.closes); // RSI H4 — label fix (sebelumnya kebalik)
            const rsiD1 = calcRSI(d1.closes); // RSI D1 — label fix
            if (bias === "bullish" && rsiH4 < 25) return null; // koreksi H4 terlalu dalam
            if (bias === "bearish" && rsiH4 > 75) return null; // bounce H4 terlalu tinggi

            // ── Filter 5: ATR D1 >= 0.5% (volatilitas cukup di D1) ───────────
            const atrH4 = calcATR(d1.highs, d1.lows, d1.closes);
            const atrH4Pct = (atrH4 / price) * 100;
            if (atrH4Pct < 0.5) return null;

            // ── Hitung kedalaman koreksi dari high/low D1 terakhir ────────────
            const recentH4Highs = d1.highs.slice(-20);
            const recentH4Lows = d1.lows.slice(-20);
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
            const recent24h = d1.volumes.slice(-3).reduce((a, b) => a + b, 0);
            const prev24h = d1.volumes.slice(-6, -3).reduce((a, b) => a + b, 0);
            const volumeValid = prev24h > 0 && recent24h >= prev24h * 0.8; // volume koreksi wajar lebih kecil

            // ── Scoring (max 8) ───────────────────────────────────────────────
            let score = 0;
            // H4 trend kuat — mapping dari classification V2 (gantiin strH4.strength
            // lama yang udah gak ada, V2 gak punya field "strength" terpisah)
            if (h4V2.classification === "bullish_strong" || h4V2.classification === "bearish_strong") score += 2;
            else if (h4V2.classification === "bullish_weak" || h4V2.classification === "bearish_weak") score += 1;
            // ADX kuat
            if (adxH4 > 35) score += 2;
            else if (adxH4 > 25) score += 1;
            // RSI D1 di zona trend sehat (trend utama)
            const rsiD1Healthy = bias === "bullish"
              ? rsiD1 >= 45 && rsiD1 <= 75  // trend D1 bullish sehat
              : rsiD1 >= 25 && rsiD1 <= 55; // trend D1 bearish sehat
            if (rsiD1Healthy) score += 1;
            // Koreksi belum terlalu dalam (masih dalam range normal 3–15%)
            const correctionHealthy = correctionDepthPct >= 3 && correctionDepthPct <= 15;
            if (correctionHealthy) score += 1;
            // H4 sudah mulai melemah (koreksi mau selesai)
            // RSI H4 di area oversold ringan untuk bullish, overbought ringan untuk bearish
            const rsiH4Exhausted = bias === "bullish"
              ? rsiH4 >= 25 && rsiH4 <= 45  // pullback H4 hampir habis
              : rsiH4 >= 55 && rsiH4 <= 75; // bounce H4 hampir habis
            if (rsiH4Exhausted) score += 1;
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
              rsiD1,
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
        .slice(0, 150) // Dinaikkan dari 50 (request user, lebih banyak sinyal tanpa turunin threshold — SEMUA menu termasuk Menu 4 pakai fungsi shared ini, TIDAK ada logic analyze yang disentuh)
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