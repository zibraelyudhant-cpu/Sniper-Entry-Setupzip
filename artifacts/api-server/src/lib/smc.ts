// SMC (Smart Money Concepts) Analysis Library
// Implements top-down analysis: H4 → H1 → 15M → 5M

const BINANCE_FUTURES_BASE = "https://fapi.binance.com";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KlineData {
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  volumes: number[];
  times: number[];
}

export interface PriceStructure {
  bias: "bullish" | "bearish" | "ranging";
  strength: "strong" | "weak" | "neutral";
  description: string;
}

export interface OrderBlock {
  high: number;
  low: number;
  mid: number;
  index: number;
  type: "bullish" | "bearish";
  strength: number;
  touches: number;       // berapa kali harga sudah masuk ke zona setelah terbentuk
  candlesAgo: number;    // berapa candle lalu zona ini terbentuk
}

export interface FVG {
  high: number;
  low: number;
  mid: number;
  index: number;
  type: "bullish" | "bearish";
  touches: number;       // berapa kali harga sudah masuk ke zona setelah terbentuk
  candlesAgo: number;    // berapa candle lalu zona ini terbentuk
}

export interface UnfilledOrderZone {
  high: number;
  low: number;
  mid: number;
  volume: number;
}

export interface SRLevel {
  price: number;
  touches: number;
  type: "support" | "resistance";
}

export interface SnDZone {
  high: number;
  low: number;
  mid: number;
  type: "supply" | "demand";
  strength: number;
}

export interface FibLevels {
  swingHigh: number;
  swingLow: number;
  levels: Record<string, number>;
}

export interface SelectedZone {
  high: number;
  low: number;
  mid: number;
  entryPrice: number;
  zoneType: string;
  tier: number;
  srLevel?: SRLevel;
  fibLevel?: number;
  touches?: number;
  candlesAgo?: number;
}

export interface RefinedZone {
  high: number;
  low: number;
  mid: number;
  entryPrice: number;
  zoneType: string;
  refined: boolean;
}

export interface EntryConfirmation {
  confirmed: boolean;
  candleType: string;
  entryPrice: number;
}

export interface SniperLevels {
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  riskAmount: number;
  setupValidHours: number;
  estimatedHitHours: number;
  expiryHours: number;
}

export type DowPhase = 'accumulation' | 'participation' | 'distribution' | 'unknown';

export interface SkipConditions {
  shouldSkip: boolean;
  reasons: string[];
  rsi: number;
  rsiDivergence: boolean;
  chochDetected: boolean;
  chochH4Detected: boolean;
  oiChange: number;
  oiAccumulation: boolean;
  oiAccumulationDesc: string;
  fundingRate: number;
  dowPhase: DowPhase;
  dowPhaseDesc: string;
  volumeTrendValid: boolean;
  volumeTrendDesc: string;
}

export interface SniperResult {
  status: "ready" | "no_trend" | "no_zone" | "skip_conditions" | "error";
  message: string;
  symbol: string;
  currentPrice: number;
  timestamp: string;
  bias?: "bullish" | "bearish";
  entryPrice?: number;
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  h4?: { bias: string; strength: string };
  zoneType?: string;
  zoneRange?: { low: number; high: number };
  refinedZoneType?: string;
  entryConfirmed?: boolean;
  confirmationCandle?: string;
  rsi?: number;
  rsiDivergence?: boolean;
  chochDetected?: boolean;
  oiChange?: number;
  oiAccumulation?: boolean;
  oiAccumulationDesc?: string;
  fundingRate?: number;
  setupValidHours?: number;
  estimatedHitHours?: number;
  expiryHours?: number;
  skipReasons?: string[];
  reasoning?: string;
  // Confirmation fields
  rejection15M?: boolean;
  rejection15MCandle?: string;
  choch15M?: boolean;
  choch15MDescription?: string;
  patternConfirmed?: boolean;
  patternName?: string;
  // Probability scoring
  profitProbability?: number;
  probabilityFactors?: string[];
  // Teori Dow
  dowPhase?: string;
  dowPhaseDesc?: string;
  volumeTrendValid?: boolean;
  volumeTrendDesc?: string;
  chochH4Detected?: boolean;
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number
): Promise<KlineData> {
  const url = `${BINANCE_FUTURES_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Klines fetch failed: ${res.status}`);
  const data: unknown[][] = await res.json();
  return {
    opens: data.map((k) => parseFloat(k[1] as string)),
    highs: data.map((k) => parseFloat(k[2] as string)),
    lows: data.map((k) => parseFloat(k[3] as string)),
    closes: data.map((k) => parseFloat(k[4] as string)),
    volumes: data.map((k) => parseFloat(k[5] as string)),
    times: data.map((k) => k[0] as number),
  };
}

// ─── Utility Calculations ─────────────────────────────────────────────────────

export function calcMACD(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9
): { macdLine: number; signalLine: number; histogram: number } {
  const ema = (data: number[], period: number): number[] => {
    const k = 2 / (period + 1);
    let e = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const result = [e];
    for (let i = period; i < data.length; i++) {
      e = data[i] * k + e * (1 - k);
      result.push(e);
    }
    return result;
  };
  if (closes.length < slow + signal) {
    return { macdLine: 0, signalLine: 0, histogram: 0 };
  }
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const diff = ef.length - es.length;
  const macdSeries = ef.slice(diff).map((v, i) => v - es[i]);
  const signalSeries = ema(macdSeries, signal);
  const ml = macdSeries[macdSeries.length - 1];
  const sl = signalSeries[signalSeries.length - 1];
  return { macdLine: ml, signalLine: sl, histogram: ml - sl };
}

export function calcADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number {
  const n = closes.length;
  if (n < period * 2) return 0;
  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  for (let i = 1; i < n; i++) {
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    trs.push(Math.max(hl, hc, lc));
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const smooth = (arr: number[]): number[] => {
    let val = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const result = [val];
    for (let i = period; i < arr.length; i++) {
      val = val - val / period + arr[i];
      result.push(val);
    }
    return result;
  };
  const atr14 = smooth(trs);
  const plusDI = smooth(plusDMs).map((v, i) => (v / atr14[i]) * 100);
  const minusDI = smooth(minusDMs).map((v, i) => (v / atr14[i]) * 100);
  const dx = plusDI.map((p, i) => {
    const sum = p + minusDI[i];
    return sum === 0 ? 0 : (Math.abs(p - minusDI[i]) / sum) * 100;
  });
  const adxSeries = smooth(dx);
  return adxSeries[adxSeries.length - 1] ?? 0;
}
function calcATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number {
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    trs.push(Math.max(hl, hc, lc));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
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
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function findSwingHighs(highs: number[], lookback: number): number[] {
  const swings: number[] = [];
  for (let i = 2; i < highs.length - 2; i++) {
    if (
      highs[i] > highs[i - 1] &&
      highs[i] > highs[i - 2] &&
      highs[i] > highs[i + 1] &&
      highs[i] > highs[i + 2]
    ) {
      swings.push(highs[i]);
    }
  }
  return swings.slice(-lookback);
}

function findSwingLows(lows: number[], lookback: number): number[] {
  const swings: number[] = [];
  for (let i = 2; i < lows.length - 2; i++) {
    if (
      lows[i] < lows[i - 1] &&
      lows[i] < lows[i - 2] &&
      lows[i] < lows[i + 1] &&
      lows[i] < lows[i + 2]
    ) {
      swings.push(lows[i]);
    }
  }
  return swings.slice(-lookback);
}

// ─── Step 1: Price Action Structure ──────────────────────────────────────────

export function analyzePriceActionStructure(
  highs: number[],
  lows: number[],
  closes: number[]
): PriceStructure {
  const swingHighs = findSwingHighs(highs, 6);
  const swingLows = findSwingLows(lows, 6);

  if (swingHighs.length < 2 || swingLows.length < 2) {
    return { bias: "ranging", strength: "neutral", description: "Insufficient swing data" };
  }

  // Check last 3 swing highs and lows for HH/HL or LH/LL
  const lastHighs = swingHighs.slice(-3);
  const lastLows = swingLows.slice(-3);

  let bullishSignals = 0;
  let bearishSignals = 0;

  // Check Higher Highs
  for (let i = 1; i < lastHighs.length; i++) {
    if (lastHighs[i] > lastHighs[i - 1]) bullishSignals++;
    else if (lastHighs[i] < lastHighs[i - 1]) bearishSignals++;
  }

  // Check Higher Lows
  for (let i = 1; i < lastLows.length; i++) {
    if (lastLows[i] > lastLows[i - 1]) bullishSignals++;
    else if (lastLows[i] < lastLows[i - 1]) bearishSignals++;
  }

  // Recent momentum from closes
  const recentCloses = closes.slice(-10);
  const firstHalf = recentCloses.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const secondHalf = recentCloses.slice(5).reduce((a, b) => a + b, 0) / 5;
  if (secondHalf > firstHalf * 1.001) bullishSignals++;
  else if (secondHalf < firstHalf * 0.999) bearishSignals++;

  const total = bullishSignals + bearishSignals;
  if (total === 0) return { bias: "ranging", strength: "neutral", description: "No clear structure" };

  const dominance = Math.max(bullishSignals, bearishSignals) / total;

  if (bullishSignals > bearishSignals) {
    const strength = dominance >= 0.75 ? "strong" : "weak";
    return { bias: "bullish", strength, description: "HH+HL terbentuk" };
  } else if (bearishSignals > bullishSignals) {
    const strength = dominance >= 0.75 ? "strong" : "weak";
    return { bias: "bearish", strength, description: "LH+LL terbentuk" };
  }

  return { bias: "ranging", strength: "neutral", description: "Struktur ranging/sideways" };
}

// ─── Step 2: Detect Zones at H1 ──────────────────────────────────────────────

export function detectOrderBlocksH1(
  opens: number[],
  highs: number[],
  lows: number[],
  closes: number[],
  bias: "bullish" | "bearish",
  lookback = 50
): OrderBlock[] {
  const obs: OrderBlock[] = [];
  const start = Math.max(0, opens.length - lookback);

  for (let i = start; i < opens.length - 3; i++) {
    if (bias === "bullish") {
      // Bearish OB: bearish candle followed by strong bullish impulse
      const isBearishCandle = closes[i] < opens[i];
      if (!isBearishCandle) continue;

      // Check for strong bullish move after
      let maxClose = closes[i];
      for (let j = i + 1; j < Math.min(i + 5, closes.length); j++) {
        maxClose = Math.max(maxClose, closes[j]);
      }

      const range = highs[i] - lows[i];
      const impulse = maxClose - closes[i];
      if (impulse > range * 1.5) {
        const strength = impulse / range;
        // Hitung touches: berapa kali harga masuk ke zona setelah OB terbentuk
        let touches = 0;
        for (let j = i + 1; j < closes.length; j++) {
          if (lows[j] <= highs[i] && highs[j] >= lows[i]) touches++;
        }
        obs.push({
          high: highs[i],
          low: lows[i],
          mid: (highs[i] + lows[i]) / 2,
          index: i,
          type: "bullish",
          strength,
          touches,
          candlesAgo: opens.length - 1 - i,
        });
      }
    } else {
      // Bullish OB: bullish candle followed by strong bearish impulse
      const isBullishCandle = closes[i] > opens[i];
      if (!isBullishCandle) continue;

      let minClose = closes[i];
      for (let j = i + 1; j < Math.min(i + 5, closes.length); j++) {
        minClose = Math.min(minClose, closes[j]);
      }

      const range = highs[i] - lows[i];
      const impulse = closes[i] - minClose;
      if (impulse > range * 1.5) {
        const strength = impulse / range;
        let touches = 0;
        for (let j = i + 1; j < closes.length; j++) {
          if (lows[j] <= highs[i] && highs[j] >= lows[i]) touches++;
        }
        obs.push({
          high: highs[i],
          low: lows[i],
          mid: (highs[i] + lows[i]) / 2,
          index: i,
          type: "bearish",
          strength,
          touches,
          candlesAgo: opens.length - 1 - i,
        });
      }
    }
  }

  // Filter: zona fresh (touches <= 1) diprioritaskan, tapi tetap include touches 2 kalau tidak ada yang fresh
  const fresh = obs.filter(ob => ob.touches <= 1);
  const pool = fresh.length > 0 ? fresh : obs.filter(ob => ob.touches <= 2);
  const final = pool.length > 0 ? pool : obs;

  // Sort by strength and recency, return top 5
  return final
    .sort((a, b) => b.strength * (b.index / opens.length) - a.strength * (a.index / opens.length))
    .slice(0, 5);
}

export function detectFVGH1(
  highs: number[],
  lows: number[],
  bias: "bullish" | "bearish",
  lookback = 50
): FVG[] {
  const fvgs: FVG[] = [];
  const start = Math.max(1, highs.length - lookback);

  for (let i = start; i < highs.length - 1; i++) {
    if (bias === "bullish") {
      // Bullish FVG: gap up — candle[i-1].high < candle[i+1].low
      if (highs[i - 1] < lows[i + 1]) {
        const low = highs[i - 1];
        const high = lows[i + 1];
        // Hitung touches: berapa kali harga masuk ke FVG setelah terbentuk
        let touches = 0;
        for (let j = i + 2; j < highs.length; j++) {
          if (lows[j] <= high && highs[j] >= low) touches++;
        }
        fvgs.push({ high, low, mid: (high + low) / 2, index: i, type: "bullish", touches, candlesAgo: highs.length - 1 - i });
      }
    } else {
      // Bearish FVG: gap down — candle[i-1].low > candle[i+1].high
      if (lows[i - 1] > highs[i + 1]) {
        const high = lows[i - 1];
        const low = highs[i + 1];
        let touches = 0;
        for (let j = i + 2; j < highs.length; j++) {
          if (lows[j] <= high && highs[j] >= low) touches++;
        }
        fvgs.push({ high, low, mid: (high + low) / 2, index: i, type: "bearish", touches, candlesAgo: highs.length - 1 - i });
      }
    }
  }

  // Filter: prioritaskan FVG fresh (touches = 0, belum pernah disentuh)
  const fresh = fvgs.filter(f => f.touches === 0);
  const pool = fresh.length > 0 ? fresh : fvgs.filter(f => f.touches <= 1);
  const final = pool.length > 0 ? pool : fvgs;

  return final.slice(-5);
}

export async function detectUnfilledOrdersH1(
  symbol: string,
  currentPrice: number,
  bias: "bullish" | "bearish"
): Promise<UnfilledOrderZone[]> {
  try {
    const url = `${BINANCE_FUTURES_BASE}/fapi/v1/aggTrades?symbol=${symbol}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const trades: Array<{ p: string; q: string }> = await res.json();

    // Bin trades by price level (0.05% bins)
    const binSize = currentPrice * 0.0005;
    const bins = new Map<number, number>();
    for (const t of trades) {
      const price = parseFloat(t.p);
      const qty = parseFloat(t.q);
      const bin = Math.floor(price / binSize) * binSize;
      bins.set(bin, (bins.get(bin) ?? 0) + qty);
    }

    // Find low-volume zones (potential unfilled orders)
    const entries = Array.from(bins.entries()).sort((a, b) => a[0] - b[0]);
    const avgVol = entries.reduce((s, e) => s + e[1], 0) / entries.length;
    const zones: UnfilledOrderZone[] = [];

    for (const [price, vol] of entries) {
      if (vol < avgVol * 0.3) {
        // Low volume = potential unfilled order area
        if (bias === "bullish" && price < currentPrice) {
          zones.push({ high: price + binSize, low: price, mid: price + binSize / 2, volume: vol });
        } else if (bias === "bearish" && price > currentPrice) {
          zones.push({ high: price + binSize, low: price, mid: price + binSize / 2, volume: vol });
        }
      }
    }

    return zones.slice(0, 3);
  } catch {
    return [];
  }
}

export function detectSRLevels(
  highs: number[],
  lows: number[],
  closes: number[],
  lookback = 100
): SRLevel[] {
  const recentHighs = highs.slice(-lookback);
  const recentLows = lows.slice(-lookback);
  const threshold = (Math.max(...recentHighs) - Math.min(...recentLows)) * 0.005;

  const levels: Array<{ price: number; touches: number; type: "support" | "resistance" }> = [];

  // Collect swing highs as resistance
  for (let i = 2; i < recentHighs.length - 2; i++) {
    if (
      recentHighs[i] > recentHighs[i - 1] &&
      recentHighs[i] > recentHighs[i - 2] &&
      recentHighs[i] > recentHighs[i + 1] &&
      recentHighs[i] > recentHighs[i + 2]
    ) {
      let merged = false;
      for (const lvl of levels) {
        if (Math.abs(lvl.price - recentHighs[i]) < threshold) {
          lvl.touches++;
          merged = true;
          break;
        }
      }
      if (!merged) levels.push({ price: recentHighs[i], touches: 1, type: "resistance" });
    }
  }

  // Collect swing lows as support
  for (let i = 2; i < recentLows.length - 2; i++) {
    if (
      recentLows[i] < recentLows[i - 1] &&
      recentLows[i] < recentLows[i - 2] &&
      recentLows[i] < recentLows[i + 1] &&
      recentLows[i] < recentLows[i + 2]
    ) {
      let merged = false;
      for (const lvl of levels) {
        if (Math.abs(lvl.price - recentLows[i]) < threshold) {
          lvl.touches++;
          merged = true;
          break;
        }
      }
      if (!merged) levels.push({ price: recentLows[i], touches: 1, type: "support" });
    }
  }

  return levels.filter((l) => l.touches >= 2).sort((a, b) => b.touches - a.touches).slice(0, 8);
}

export function detectSnDZones(
  opens: number[],
  highs: number[],
  lows: number[],
  closes: number[]
): SnDZone[] {
  const zones: SnDZone[] = [];
  const lookback = Math.min(100, opens.length);

  for (let i = 2; i < lookback - 2; i++) {
    const candleSize = Math.abs(closes[i] - opens[i]);
    const avgSize =
      (Math.abs(closes[i - 1] - opens[i - 1]) +
        Math.abs(closes[i - 2] - opens[i - 2])) /
      2;

    // Strong bullish candle after consolidation → demand zone (support area)
    if (
      closes[i] > opens[i] &&
      candleSize > avgSize * 2 &&
      closes[i] > highs[i - 1]
    ) {
      zones.push({
        high: highs[i],
        low: lows[i],
        mid: (highs[i] + lows[i]) / 2,
        type: "demand",
        strength: candleSize / avgSize,
      });
    }

    // Strong bearish candle after consolidation → supply zone (resistance area)
    if (
      closes[i] < opens[i] &&
      candleSize > avgSize * 2 &&
      closes[i] < lows[i - 1]
    ) {
      zones.push({
        high: highs[i],
        low: lows[i],
        mid: (highs[i] + lows[i]) / 2,
        type: "supply",
        strength: candleSize / avgSize,
      });
    }
  }

  return zones.sort((a, b) => b.strength - a.strength).slice(0, 5);
}

export function calcFibonacci(
  highs: number[],
  lows: number[],
  closes: number[]
): FibLevels | null {
  const recentHighs = highs.slice(-30);
  const recentLows = lows.slice(-30);
  const swingHigh = Math.max(...recentHighs);
  const swingLow = Math.min(...recentLows);
  const range = swingHigh - swingLow;

  if (range === 0) return null;

  return {
    swingHigh,
    swingLow,
    levels: {
      "0.0": swingLow,
      "0.236": swingLow + range * 0.236,
      "0.382": swingLow + range * 0.382,
      "0.5": swingLow + range * 0.5,
      "0.618": swingLow + range * 0.618,
      "0.786": swingLow + range * 0.786,
      "1.0": swingHigh,
    },
  };
}

// ─── Zone Selection (Hierarchy) ───────────────────────────────────────────────

export function selectBestZoneH1(
  obs: OrderBlock[],
  fvgs: FVG[],
  unfilledOrders: UnfilledOrderZone[],
  srLevels: SRLevel[],
  sndZones: SnDZone[],
  fibLevels: FibLevels | null,
  bias: "bullish" | "bearish",
  currentPrice: number
): SelectedZone | null {
  // Filter zones relevant to bias direction (below price for BUY, above for SELL)
  const priceFilter = (low: number, high: number) =>
    bias === "bullish"
      ? low < currentPrice && high < currentPrice * 1.1
      : high > currentPrice && low > currentPrice * 0.9;

  // Helper: does zone overlap with another?
  const overlaps = (
    zLow: number,
    zHigh: number,
    other: { low: number; high: number }
  ) => zLow <= other.high && zHigh >= other.low;

  // TIER 1: Unfilled Order within OB
  for (const uo of unfilledOrders) {
    if (!priceFilter(uo.low, uo.high)) continue;
    for (const ob of obs) {
      if (overlaps(uo.low, uo.high, ob)) {
        return {
          high: ob.high,
          low: ob.low,
          mid: uo.mid,
          entryPrice: uo.mid,
          zoneType: "Unfilled Order dalam OB",
          tier: 1,
          touches: ob.touches,
          candlesAgo: ob.candlesAgo,
        };
      }
    }
  }

  // TIER 2: OB + FVG overlap
  for (const ob of obs) {
    if (!priceFilter(ob.low, ob.high)) continue;
    for (const fvg of fvgs) {
      if (overlaps(ob.low, ob.high, fvg)) {
        return {
          high: ob.high,
          low: ob.low,
          mid: fvg.mid,
          entryPrice: fvg.mid,
          zoneType: "Order Block + FVG overlap",
          tier: 2,
          touches: Math.max(ob.touches, fvg.touches),
          candlesAgo: ob.candlesAgo,
        };
      }
    }
  }

  // TIER 3: OB + S&R or SnD confluence
  for (const ob of obs) {
    if (!priceFilter(ob.low, ob.high)) continue;
    const threshold = (ob.high - ob.low) * 2;
    for (const sr of srLevels) {
      if (Math.abs(sr.price - ob.mid) < threshold) {
        const goldenZone =
          bias === "bullish"
            ? ob.low + (ob.high - ob.low) * 0.382
            : ob.high - (ob.high - ob.low) * 0.382;
        return {
          high: ob.high,
          low: ob.low,
          mid: goldenZone,
          entryPrice: goldenZone,
          zoneType: "Order Block + S&R confluence",
          tier: 3,
          srLevel: sr,
          touches: ob.touches,
          candlesAgo: ob.candlesAgo,
        };
      }
    }
    for (const snd of sndZones) {
      if (overlaps(ob.low, ob.high, snd)) {
        const goldenZone =
          bias === "bullish"
            ? ob.low + (ob.high - ob.low) * 0.382
            : ob.high - (ob.high - ob.low) * 0.382;
        return {
          high: ob.high,
          low: ob.low,
          mid: goldenZone,
          entryPrice: goldenZone,
          zoneType: "Order Block + Supply/Demand confluence",
          tier: 3,
          touches: ob.touches,
          candlesAgo: ob.candlesAgo,
        };
      }
    }
  }

  // TIER 4: OB murni
  if (obs.length > 0) {
    const ob = obs[0];
    if (priceFilter(ob.low, ob.high)) {
      const goldenZone =
        bias === "bullish"
          ? ob.low + (ob.high - ob.low) * 0.382
          : ob.high - (ob.high - ob.low) * 0.382;
      return {
        high: ob.high,
        low: ob.low,
        mid: goldenZone,
        entryPrice: goldenZone,
        zoneType: "Order Block murni",
        tier: 4,
        touches: ob.touches,
        candlesAgo: ob.candlesAgo,
      };
    }
  }

  // TIER 5: FVG + S&R or SnD
  for (const fvg of fvgs) {
    if (!priceFilter(fvg.low, fvg.high)) continue;
    const threshold = (fvg.high - fvg.low) * 3;
    for (const sr of srLevels) {
      if (Math.abs(sr.price - fvg.mid) < threshold) {
        return {
          high: fvg.high,
          low: fvg.low,
          mid: fvg.mid,
          entryPrice: fvg.mid,
          zoneType: "FVG + S&R confluence",
          tier: 5,
          srLevel: sr,
          touches: fvg.touches,
          candlesAgo: fvg.candlesAgo,
        };
      }
    }
  }

  // TIER 6: FVG murni
  const validFvgs = fvgs.filter((f) => priceFilter(f.low, f.high));
  if (validFvgs.length > 0) {
    const fvg = validFvgs[validFvgs.length - 1];
    return {
      high: fvg.high,
      low: fvg.low,
      mid: fvg.mid,
      entryPrice: fvg.mid,
      zoneType: "FVG murni",
      tier: 6,
      touches: fvg.touches,
      candlesAgo: fvg.candlesAgo,
    };
  }

  // TIER 7: S&R/SnD + Fibonacci (WAJIB ada Fib, kalau tidak skip)
  if (fibLevels) {
    const fibPrices = [
      fibLevels.levels["0.382"],
      fibLevels.levels["0.5"],
      fibLevels.levels["0.618"],
      fibLevels.levels["0.786"],
    ];
    for (const sr of srLevels) {
      for (const fibPrice of fibPrices) {
        if (
          Math.abs(sr.price - fibPrice) / currentPrice < 0.003 &&
          priceFilter(fibPrice * 0.998, fibPrice * 1.002)
        ) {
          return {
            high: fibPrice * 1.002,
            low: fibPrice * 0.998,
            mid: fibPrice,
            entryPrice: fibPrice,
            zoneType: "S&R + Fibonacci",
            tier: 7,
            srLevel: sr,
            fibLevel: fibPrice,
          };
        }
      }
    }
  }

  return null;
}

// ─── Step 3: Refine at 15M ────────────────────────────────────────────────────

export function refineZone15M(
  zone: SelectedZone,
  opens15m: number[],
  highs15m: number[],
  lows15m: number[],
  closes15m: number[],
  bias: "bullish" | "bearish"
): RefinedZone {
  // Look for OB or FVG within the H1 zone
  const obs15m = detectOrderBlocksH1(opens15m, highs15m, lows15m, closes15m, bias, 30);
  const fvgs15m = detectFVGH1(highs15m, lows15m, bias, 30);

  // Find OB within zone
  for (const ob of obs15m) {
    if (ob.low >= zone.low && ob.high <= zone.high) {
      const goldenZone =
        bias === "bullish"
          ? ob.low + (ob.high - ob.low) * 0.382
          : ob.high - (ob.high - ob.low) * 0.382;
      return {
        high: ob.high,
        low: ob.low,
        mid: goldenZone,
        entryPrice: goldenZone,
        zoneType: `OB 15M dalam range H1 (${zone.zoneType})`,
        refined: true,
      };
    }
  }

  // Find FVG within zone
  for (const fvg of fvgs15m) {
    if (fvg.low >= zone.low && fvg.high <= zone.high) {
      return {
        high: fvg.high,
        low: fvg.low,
        mid: fvg.mid,
        entryPrice: fvg.mid,
        zoneType: `FVG 15M dalam range H1 (${zone.zoneType})`,
        refined: true,
      };
    }
  }

  // Use H1 zone directly
  return {
    high: zone.high,
    low: zone.low,
    mid: zone.mid,
    entryPrice: zone.entryPrice,
    zoneType: zone.zoneType,
    refined: false,
  };
}

// ─── Step 4: Entry Confirmation at 5M ────────────────────────────────────────

export interface Rejection15M {
  confirmed: boolean;
  candleType: string;
  rejectionHigh: number;  // high candle rejection (untuk SL bearish)
  rejectionLow: number;   // low candle rejection (untuk SL bullish)
  entryPrice: number;     // entry lebih presisi dari rejection candle
  volumeConfirmed: boolean; // volume candle rejection > 1.2x rata-rata
  volumeRatio: number;      // rasio volume vs rata-rata
}

export function checkRejection15M(
  refinedZone: RefinedZone,
  opens15m: number[],
  highs15m: number[],
  lows15m: number[],
  closes15m: number[],
  bias: "bullish" | "bearish",
  volumes15m: number[] = []
): Rejection15M {
  const zoneLow = refinedZone.low;
  const zoneHigh = refinedZone.high;
  const buffer = (zoneHigh - zoneLow) * 0.1; // 10% dari lebar zona

  // Exclude candle terakhir (live/belum close) supaya konsisten antara scan dan analisa
  // Cek 3 candle 15M terakhir (dari candle yang sudah close)
  const opens = opens15m.slice(0, -1);
  const highs = highs15m.slice(0, -1);
  const lows = lows15m.slice(0, -1);
  const closes = closes15m.slice(0, -1);
  const volumes = volumes15m.length > 0 ? volumes15m.slice(0, -1) : [];

  // Hitung rata-rata volume 20 candle terakhir (untuk volume konfirmasi)
  const volSlice = volumes.slice(-20);
  const avgVolume = volSlice.length > 0
    ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length
    : 0;

  const start = Math.max(0, opens.length - 3);

  for (let i = opens.length - 1; i >= start; i--) {
    const isInZone = lows[i] <= zoneHigh + buffer && highs[i] >= zoneLow - buffer;
    if (!isInZone) continue;

    const body = Math.abs(closes[i] - opens[i]);
    const range = highs[i] - lows[i];
    if (range === 0) continue;

    const upperWick = highs[i] - Math.max(opens[i], closes[i]);
    const lowerWick = Math.min(opens[i], closes[i]) - lows[i];

    if (bias === "bullish") {
      // Hammer / Pin Bar: lower wick > 1.5x body DAN candle bullish
      const isHammer = lowerWick > body * 1.5 && closes[i] > opens[i];
      // Rejection kuat: lower wick > 60% dari range total
      const isStrongRejection = lowerWick > range * 0.6;

      if (isHammer || isStrongRejection) {
        const entryPrice = lows[i] + range * 0.1;
        const volRatio = avgVolume > 0 && volumes.length > i ? volumes[i] / avgVolume : 0;
        const volConfirmed = volRatio >= 1.2;
        const baseType = isHammer ? "Hammer 15M" : "Pin Bar 15M";
        return {
          confirmed: true,
          candleType: volConfirmed ? `${baseType} ✅ Vol ${volRatio.toFixed(1)}x` : baseType,
          rejectionHigh: highs[i],
          rejectionLow: lows[i],
          entryPrice: Math.max(entryPrice, zoneLow),
          volumeConfirmed: volConfirmed,
          volumeRatio: volRatio,
        };
      }
    } else {
      // Shooting Star: upper wick > 1.5x body DAN candle bearish
      const isShootingStar = upperWick > body * 1.5 && closes[i] < opens[i];
      // Rejection kuat: upper wick > 60% dari range total
      const isStrongRejection = upperWick > range * 0.6;

      if (isShootingStar || isStrongRejection) {
        const entryPrice = highs[i] - range * 0.1;
        const volRatio = avgVolume > 0 && volumes.length > i ? volumes[i] / avgVolume : 0;
        const volConfirmed = volRatio >= 1.2;
        const baseType = isShootingStar ? "Shooting Star 15M" : "Pin Bar 15M";
        return {
          confirmed: true,
          candleType: volConfirmed ? `${baseType} ✅ Vol ${volRatio.toFixed(1)}x` : baseType,
          rejectionHigh: highs[i],
          rejectionLow: lows[i],
          entryPrice: Math.min(entryPrice, zoneHigh),
          volumeConfirmed: volConfirmed,
          volumeRatio: volRatio,
        };
      }
    }
  }

  return {
    confirmed: false,
    candleType: "Belum ada rejection 15M",
    rejectionHigh: refinedZone.high,
    rejectionLow: refinedZone.low,
    entryPrice: refinedZone.entryPrice,
    volumeConfirmed: false,
    volumeRatio: 0,
  };
}

export function checkEntryConfirmation5M(
  refinedZone: RefinedZone,
  opens5m: number[],
  highs5m: number[],
  lows5m: number[],
  closes5m: number[],
  bias: "bullish" | "bearish"
): EntryConfirmation {
  const zoneLow = refinedZone.low;
  const zoneHigh = refinedZone.high;

  // Check last 10 candles for confirmation
  const start = Math.max(0, opens5m.length - 10);

  for (let i = opens5m.length - 1; i >= start; i--) {
    const isInZone =
      lows5m[i] <= zoneHigh && highs5m[i] >= zoneLow;
    if (!isInZone) continue;

    if (bias === "bullish") {
      const candleRange = highs5m[i] - lows5m[i];
      const bodySize = Math.abs(closes5m[i] - opens5m[i]);
      const lowerWick = Math.min(opens5m[i], closes5m[i]) - lows5m[i];
      const upperWick = highs5m[i] - Math.max(opens5m[i], closes5m[i]);

      // Pin bar (hammer)
      if (lowerWick > candleRange * 0.6 && candleRange > 0) {
        return { confirmed: true, candleType: "Pin Bar (Hammer)", entryPrice: refinedZone.entryPrice };
      }
      // Bullish engulfing
      if (
        i > 0 &&
        closes5m[i] > opens5m[i] &&
        closes5m[i] > opens5m[i - 1] &&
        opens5m[i] < closes5m[i - 1] &&
        closes5m[i - 1] < opens5m[i - 1]
      ) {
        return { confirmed: true, candleType: "Bullish Engulfing", entryPrice: refinedZone.entryPrice };
      }
      // Rejection candle: bullish close with lower wick
      if (closes5m[i] > opens5m[i] && lowerWick > bodySize) {
        return { confirmed: true, candleType: "Rejection Candle", entryPrice: refinedZone.entryPrice };
      }
    } else {
      const candleRange = highs5m[i] - lows5m[i];
      const bodySize = Math.abs(closes5m[i] - opens5m[i]);
      const upperWick = highs5m[i] - Math.max(opens5m[i], closes5m[i]);
      const lowerWick = Math.min(opens5m[i], closes5m[i]) - lows5m[i];

      // Shooting star
      if (upperWick > candleRange * 0.6 && candleRange > 0) {
        return { confirmed: true, candleType: "Shooting Star", entryPrice: refinedZone.entryPrice };
      }
      // Bearish engulfing
      if (
        i > 0 &&
        closes5m[i] < opens5m[i] &&
        closes5m[i] < opens5m[i - 1] &&
        opens5m[i] > closes5m[i - 1] &&
        closes5m[i - 1] > opens5m[i - 1]
      ) {
        return { confirmed: true, candleType: "Bearish Engulfing", entryPrice: refinedZone.entryPrice };
      }
      // Rejection candle
      if (closes5m[i] < opens5m[i] && upperWick > bodySize) {
        return { confirmed: true, candleType: "Rejection Candle", entryPrice: refinedZone.entryPrice };
      }
    }
  }

  return { confirmed: false, candleType: "Belum ada konfirmasi 5M", entryPrice: refinedZone.entryPrice };
}

// ─── Step 5: Calculate SL, TP, Timing ────────────────────────────────────────

  export function calcSniperLevels(
    entryPrice: number,
    refinedZone: RefinedZone,
    atrSl: number,
    atrH4: number,
    bias: "bullish" | "bearish",
    h1Highs: number[],
    h1Lows: number[],
    atrH1: number,
): SniperLevels {
    let stopLoss: number;

    // SL berdasarkan swing high/low H1 terdekat (20 candle lookback)
    const swingHighs = findSwingHighs(h1Highs, 20);
    const swingLows = findSwingLows(h1Lows, 20);
    const buffer = atrH1 * 0.2;

    if (bias === "bullish") {
      // Cari swing low H1 terdekat di bawah entry
      const relevantLows = swingLows.filter(l => l < entryPrice);
      const nearestSwingLow = relevantLows.length > 0
        ? Math.max(...relevantLows)
        : Math.min(...h1Lows.slice(-20));
      const rawSl = nearestSwingLow - buffer;
      // Minimum SL = 1x ATR H2 dari entry
      const minSl = entryPrice - atrSl;
      stopLoss = Math.min(rawSl, minSl);
    } else {
      // Cari swing high H1 terdekat di atas entry
      const relevantHighs = swingHighs.filter(h => h > entryPrice);
      const nearestSwingHigh = relevantHighs.length > 0
        ? Math.min(...relevantHighs)
        : Math.max(...h1Highs.slice(-20));
      const rawSl = nearestSwingHigh + buffer;
      // Minimum SL = 1x ATR H2 dari entry
      const minSl = entryPrice + atrSl;
      stopLoss = Math.max(rawSl, minSl);
    }

  const riskAmount = Math.abs(entryPrice - stopLoss);

  const takeProfit1 =
    bias === "bullish"
      ? entryPrice + riskAmount * 1.5
      : entryPrice - riskAmount * 1.5;

  const takeProfit2 =
    bias === "bullish"
      ? entryPrice + riskAmount * 3
      : entryPrice - riskAmount * 3;

  // Timing estimates
    const setupValidHours = Math.round((atrH4 / atrSl) * 2);
  const distanceToEntry = Math.abs(entryPrice - 0); // placeholder - calculated per call
    const estimatedHitHours = Math.round((atrSl > 0 ? Math.abs(entryPrice) / atrSl : 1) * 1);
  const expiryHours = setupValidHours + 4;

  return {
    entryPrice,
    stopLoss,
    takeProfit1,
    takeProfit2,
    riskAmount,
    setupValidHours: Math.max(2, setupValidHours),
    estimatedHitHours: Math.max(1, Math.min(estimatedHitHours, setupValidHours)),
    expiryHours: Math.max(6, expiryHours),
  };
}

// ─── Step 6: Skip Conditions ──────────────────────────────────────────────────

// CHoCH: detects if H1 has broken structure against the bias (change of character)
// Bullish: close breaks below most recent swing low → CHoCH formed → skip
// Bearish: close breaks above most recent swing high → CHoCH formed → skip
function detectCHoCH(
  highs: number[],
  lows: number[],
  closes: number[],
  bias: "bullish" | "bearish"
): boolean {
  const lastClose = closes[closes.length - 1];
  if (bias === "bullish") {
    const swingLows = findSwingLows(lows, 5);
    if (swingLows.length < 1) return false;
    const recentHL = swingLows[swingLows.length - 1];
    return lastClose < recentHL;
  } else {
    const swingHighs = findSwingHighs(highs, 5);
    if (swingHighs.length < 1) return false;
    const recentLH = swingHighs[swingHighs.length - 1];
    return lastClose > recentLH;
  }
}

// CHoCH 15M: deteksi CHoCH yang SEARAH bias (konfirmasi, bukan skip)
// Bullish: harga sebelumnya bikin LL, lalu breakout bikin HH → struktur mulai bullish
// Bearish: harga sebelumnya bikin HH, lalu breakdown bikin LL → struktur mulai bearish
function detectCHoCH15M(
  highs: number[],
  lows: number[],
  closes: number[],
  bias: "bullish" | "bearish"
): { detected: boolean; description: string } {
  // Exclude candle terakhir (live/belum close) supaya konsisten antara scan dan analisa
  const h = highs.slice(0, -1);
  const l = lows.slice(0, -1);
  const c = closes.slice(0, -1);
  const n = c.length;
  if (n < 10) return { detected: false, description: "Data tidak cukup" };

  // Ambil 20 candle terakhir
  const sliceH = h.slice(Math.max(0, n - 20));
  const sliceL = l.slice(Math.max(0, n - 20));
  const sliceC = c.slice(Math.max(0, n - 20));

  const swingHighs = findSwingHighs(sliceH, 3);
  const swingLows = findSwingLows(sliceL, 3);

  const lastClose = sliceC[sliceC.length - 1];

  if (bias === "bullish") {
    // CHoCH bullish: sebelumnya ada LL, lalu close breakout di atas HH terakhir
    if (swingHighs.length < 2 || swingLows.length < 2) return { detected: false, description: "Swing tidak cukup" };

    const prevHH = swingHighs[swingHighs.length - 2];
    const lastHH = swingHighs[swingHighs.length - 1];
    const prevLL = swingLows[swingLows.length - 2];
    const lastLL = swingLows[swingLows.length - 1];

    // Struktur sebelumnya bearish (LL terbentuk)
    const hadBearStructure = lastLL < prevLL;
    // Sekarang close breakout di atas HH sebelumnya
    const chochConfirmed = lastClose > prevHH;

    if (hadBearStructure && chochConfirmed) {
      return {
        detected: true,
        description: `CHoCH Bullish 15M — LL terbentuk di ${lastLL.toFixed(4)}, close breakout HH ${prevHH.toFixed(4)}`
      };
    }
  } else {
    // CHoCH bearish: sebelumnya ada HH, lalu close breakdown di bawah LL terakhir
    if (swingHighs.length < 2 || swingLows.length < 2) return { detected: false, description: "Swing tidak cukup" };

    const prevHH = swingHighs[swingHighs.length - 2];
    const lastHH = swingHighs[swingHighs.length - 1];
    const prevLL = swingLows[swingLows.length - 2];
    const lastLL = swingLows[swingLows.length - 1];

    // Struktur sebelumnya bullish (HH terbentuk)
    const hadBullStructure = lastHH > prevHH;
    // Sekarang close breakdown di bawah LL sebelumnya
    const chochConfirmed = lastClose < prevLL;

    if (hadBullStructure && chochConfirmed) {
      return {
        detected: true,
        description: `CHoCH Bearish 15M — HH terbentuk di ${lastHH.toFixed(4)}, close breakdown LL ${prevLL.toFixed(4)}`
      };
    }
  }

  return { detected: false, description: "CHoCH 15M belum terbentuk" };
}

// ─── Teori Dow: Deteksi Fase Trend ───────────────────────────────────────────

function detectDowPhase(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  bias: "bullish" | "bearish"
): { phase: DowPhase; description: string } {
  const n = closes.length;
  if (n < 30) return { phase: 'unknown', description: 'Data tidak cukup' };

  // Bagi data jadi 3 bagian (awal, tengah, akhir)
  const third = Math.floor(n / 3);
  const early = { closes: closes.slice(0, third), volumes: volumes.slice(0, third) };
  const mid   = { closes: closes.slice(third, third * 2), volumes: volumes.slice(third, third * 2) };
  const late  = { closes: closes.slice(third * 2), volumes: volumes.slice(third * 2) };

  const avgVolEarly = early.volumes.reduce((a, b) => a + b, 0) / early.volumes.length;
  const avgVolMid   = mid.volumes.reduce((a, b) => a + b, 0) / mid.volumes.length;
  const avgVolLate  = late.volumes.reduce((a, b) => a + b, 0) / late.volumes.length;

  // Price change per periode
  const priceChangeMid  = (mid.closes[mid.closes.length - 1] - mid.closes[0]) / mid.closes[0] * 100;
  const priceChangeLate = (late.closes[late.closes.length - 1] - late.closes[0]) / late.closes[0] * 100;

  // Volume trend: naik atau turun dari periode ke periode
  const volAccelerating = avgVolMid > avgVolEarly * 1.1 && avgVolLate > avgVolMid * 1.1;
  const volDecelerating = avgVolLate < avgVolMid * 0.85;

  if (bias === "bullish") {
    // Accumulation: harga sideways/naik perlahan, volume rendah dan stabil
    if (Math.abs(priceChangeMid) < 5 && avgVolMid <= avgVolEarly * 1.1) {
      return { phase: 'accumulation', description: `Accumulation — harga konsolidasi, volume stabil (${avgVolLate.toFixed(0)} avg)` };
    }
    // Distribution: harga masih naik tapi volume turun (divergence)
    if (priceChangeLate > 2 && volDecelerating) {
      return { phase: 'distribution', description: `Distribution — harga naik tapi volume melemah (vol turun ${((1 - avgVolLate/avgVolMid)*100).toFixed(0)}%)` };
    }
    // Public participation: harga naik kuat dengan volume naik
    if (priceChangeMid > 3 && volAccelerating) {
      return { phase: 'participation', description: `Public Participation — harga naik kuat dengan volume menguat` };
    }
  } else {
    // Accumulation (bearish): harga sideways/turun perlahan, volume rendah
    if (Math.abs(priceChangeMid) < 5 && avgVolMid <= avgVolEarly * 1.1) {
      return { phase: 'accumulation', description: `Accumulation — harga konsolidasi bearish, volume stabil` };
    }
    // Distribution (bearish): harga turun tapi volume melemah = potensi reversal
    if (priceChangeLate < -2 && volDecelerating) {
      return { phase: 'distribution', description: `Distribution — harga turun tapi volume melemah (potensi reversal)` };
    }
    // Public participation bearish: harga turun kuat dengan volume naik
    if (priceChangeMid < -3 && volAccelerating) {
      return { phase: 'participation', description: `Public Participation — harga turun kuat dengan volume menguat` };
    }
  }

  return { phase: 'unknown', description: 'Fase tidak terdeteksi jelas' };
}

// ─── Teori Dow: Volume Konfirmasi Trend ──────────────────────────────────────

function checkVolumeTrend(
  closes: number[],
  volumes: number[],
  bias: "bullish" | "bearish"
): { valid: boolean; description: string } {
  const n = closes.length;
  if (n < 20 || volumes.length < 20) return { valid: true, description: 'Data tidak cukup' };

  // Pisahkan candle impulse (searah bias) dan candle pullback (berlawanan)
  const recent = closes.slice(-20);
  const recentVols = volumes.slice(-20);

  let impulseVol = 0, impulseCount = 0;
  let pullbackVol = 0, pullbackCount = 0;

  for (let i = 1; i < recent.length; i++) {
    const isUp = recent[i] > recent[i - 1];
    if ((bias === 'bullish' && isUp) || (bias === 'bearish' && !isUp)) {
      impulseVol += recentVols[i];
      impulseCount++;
    } else {
      pullbackVol += recentVols[i];
      pullbackCount++;
    }
  }

  const avgImpulseVol  = impulseCount  > 0 ? impulseVol  / impulseCount  : 0;
  const avgPullbackVol = pullbackCount > 0 ? pullbackVol / pullbackCount : 0;

  // Volume Dow: impulse candle harus lebih tinggi volumenya dari pullback
  const ratio = avgPullbackVol > 0 ? avgImpulseVol / avgPullbackVol : 1;
  const valid = ratio >= 1.0; // impulse vol >= pullback vol

  if (valid) {
    return { valid: true, description: `Volume trend valid — impulse vol ${ratio.toFixed(1)}x vs pullback` };
  } else {
    return { valid: false, description: `Volume melemah — pullback vol lebih tinggi dari impulse (${ratio.toFixed(1)}x)` };
  }
}

export async function checkSkipConditions(
  symbol: string,
  bias: "bullish" | "bearish",
  h1Closes: number[],
  h1Highs: number[],
  h1Lows: number[],
  h4Highs: number[] = [],
  h4Lows: number[] = [],
  h4Closes: number[] = [],
  h4Volumes: number[] = [],
): Promise<SkipConditions> {
  const reasons: string[] = [];
  let shouldSkip = false;

  // 1. RSI
  const rsi = calcRSI(h1Closes);
  let rsiDivergence = false;

  // Detect divergence: check last 5 candles
  const recentCloses = h1Closes.slice(-10);
  const recentHighs = h1Highs.slice(-10);
  const recentLows = h1Lows.slice(-10);

  // Calculate RSI for first half and second half
  const firstRsi = calcRSI(h1Closes.slice(0, -5));
  const secondRsi = calcRSI(h1Closes);

  if (bias === "bullish") {
    // Bearish divergence on bullish bias: price makes HH but RSI makes LH
    const priceHigher = recentHighs[recentHighs.length - 1] > recentHighs[recentHighs.length - 6];
    if (priceHigher && secondRsi < firstRsi * 0.95) {
      rsiDivergence = true;
      reasons.push("RSI divergence terdeteksi di H1 (harga HH tapi RSI LH)");
      shouldSkip = true;
    }
  } else {
    // Bullish divergence on bearish bias: price makes LL but RSI makes HL
    const priceLower = recentLows[recentLows.length - 1] < recentLows[recentLows.length - 6];
    if (priceLower && secondRsi > firstRsi * 1.05) {
      rsiDivergence = true;
      reasons.push("RSI divergence terdeteksi di H1 (harga LL tapi RSI HL)");
      shouldSkip = true;
    }
  }

  // 2. CHoCH on H1
  const chochDetected = detectCHoCH(h1Highs, h1Lows, h1Closes, bias);
  if (chochDetected) {
    reasons.push("CHoCH terbentuk di H1 — struktur H1 sudah berbalik arah");
    shouldSkip = true;
  }

  // 2b. CHoCH on H4 (Teori Dow: primary trend reversal — hard filter lebih kuat)
  const chochH4Detected = h4Highs.length > 0
    ? detectCHoCH(h4Highs, h4Lows, h4Closes, bias)
    : false;
  if (chochH4Detected) {
    reasons.push("CHoCH terbentuk di H4 — primary trend sudah berbalik, setup invalid");
    shouldSkip = true;
  }

  // 2c. Dow Phase Detection
  const dowResult = h4Closes.length > 0
    ? detectDowPhase(h4Highs, h4Lows, h4Closes, h4Volumes, bias)
    : { phase: 'unknown' as DowPhase, description: 'Data H4 tidak tersedia' };

  // Distribution phase = sinyal bahaya, skip
  if (dowResult.phase === 'distribution') {
    reasons.push(`Fase Distribution terdeteksi di H4 — ${dowResult.description}`);
    shouldSkip = true;
  }

  // 2d. Volume Trend (Teori Dow: volume harus konfirmasi trend)
  const volTrend = h4Closes.length > 0
    ? checkVolumeTrend(h4Closes, h4Volumes, bias)
    : { valid: true, description: 'Data volume tidak tersedia' };

  // 3. OI + Accumulation Detection
  let oiChange = 0;
  let oiAccumulation = false;
  let oiAccumulationDesc = "Data OI tidak tersedia";
  try {
    const oiUrl = `${BINANCE_FUTURES_BASE}/fapi/v1/openInterest?symbol=${symbol}`;
    const oiHistUrl = `${BINANCE_FUTURES_BASE}/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=8`;
    const [oiRes, oiHistRes] = await Promise.all([fetch(oiUrl), fetch(oiHistUrl)]);
    if (oiRes.ok && oiHistRes.ok) {
      const oiHist: Array<{ sumOpenInterest: string; sumOpenInterestValue: string }> = await oiHistRes.json();
      if (oiHist.length >= 2) {
        const latest = parseFloat(oiHist[oiHist.length - 1].sumOpenInterest);
        const prev = parseFloat(oiHist[0].sumOpenInterest);
        oiChange = ((latest - prev) / prev) * 100;

        // Skip conditions
        if (bias === "bullish" && oiChange < -2) {
          reasons.push(`OI turun ${oiChange.toFixed(1)}% saat harga naik (kemungkinan short covering)`);
          shouldSkip = true;
        } else if (bias === "bearish" && oiChange < -2) {
          reasons.push(`OI turun ${oiChange.toFixed(1)}% saat harga turun (kemungkinan long liquidation)`);
          shouldSkip = true;
        }

        // OI Accumulation Detection
        // Cek apakah OI naik konsisten dalam 5 jam terakhir saat harga ranging
        if (oiHist.length >= 5) {
          const recent5 = oiHist.slice(-5);
          const oiValues = recent5.map(d => parseFloat(d.sumOpenInterest));

          // OI naik konsisten: tiap jam OI >= jam sebelumnya (minimal 3 dari 4 step naik)
          let risingCount = 0;
          for (let i = 1; i < oiValues.length; i++) {
            if (oiValues[i] >= oiValues[i - 1]) risingCount++;
          }
          const oiRising = risingCount >= 3;

          // OI naik signifikan dalam 5 jam (>= 1.5%)
          const oiChange5h = ((oiValues[oiValues.length - 1] - oiValues[0]) / oiValues[0]) * 100;
          const oiSignificant = oiChange5h >= 1.5;

          if (oiRising && oiSignificant) {
            oiAccumulation = true;
            oiAccumulationDesc = `OI naik ${oiChange5h.toFixed(2)}% dalam 5 jam — akumulasi posisi terdeteksi`;
          } else if (oiChange5h < -1.5) {
            oiAccumulationDesc = `OI turun ${Math.abs(oiChange5h).toFixed(2)}% dalam 5 jam — distribusi/likuidasi`;
          } else {
            oiAccumulationDesc = `OI stabil (${oiChange5h >= 0 ? '+' : ''}${oiChange5h.toFixed(2)}% dalam 5 jam)`;
          }
        }
      }
    }
  } catch { /* OI check failed silently */ }

  // 4. Funding rate
  let fundingRate = 0;
  try {
    const frUrl = `${BINANCE_FUTURES_BASE}/fapi/v1/fundingRate?symbol=${symbol}&limit=1`;
    const frRes = await fetch(frUrl);
    if (frRes.ok) {
      const frData: Array<{ fundingRate: string }> = await frRes.json();
      if (frData.length > 0) {
        fundingRate = parseFloat(frData[0].fundingRate) * 100;
        if (bias === "bullish" && fundingRate < -0.1) {
          reasons.push(`Funding rate sangat negatif (${fundingRate.toFixed(3)}%) — pasar bet turun`);
          shouldSkip = true;
        } else if (bias === "bearish" && fundingRate > 0.1) {
          reasons.push(`Funding rate sangat positif (${fundingRate.toFixed(3)}%) — pasar bet naik`);
          shouldSkip = true;
        }
      }
    }
  } catch { /* Funding rate check failed silently */ }

  return {
    shouldSkip, reasons, rsi, rsiDivergence,
    chochDetected, chochH4Detected,
    oiChange, oiAccumulation, oiAccumulationDesc,
    fundingRate,
    dowPhase: dowResult.phase,
    dowPhaseDesc: dowResult.description,
    volumeTrendValid: volTrend.valid,
    volumeTrendDesc: volTrend.description,
  };
}

// ─── Main Analysis Function ───────────────────────────────────────────────────

export async function analyzeSniperEntry(symbol: string): Promise<SniperResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }) + ' WIB';

  try {
    // Fetch all data in parallel
    const [h4, h2, h1, m15, m5, currentTickerRes] = await Promise.all([
      fetchKlines(symbol, "4h", 100),
      fetchKlines(symbol, "2h", 50),
      fetchKlines(symbol, "1h", 200),
      fetchKlines(symbol, "15m", 100),
      fetchKlines(symbol, "5m", 50),
      fetch(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);

    let currentPrice: number;
    if (currentTickerRes.ok) {
      const ticker: { price: string } = await currentTickerRes.json();
      currentPrice = parseFloat(ticker.price);
    } else {
      currentPrice = h1.closes[h1.closes.length - 1];
    }

    // STEP 1: Confirm trend H4
    const structH4 = analyzePriceActionStructure(h4.highs, h4.lows, h4.closes);

    if (structH4.bias === "ranging") {
      return {
        status: "no_trend",
        message: `Struktur H4 ranging, tidak ada trend jelas untuk ${symbol}`,
        symbol,
        currentPrice,
        timestamp,
        h4: { bias: structH4.bias, strength: structH4.strength },
      };
    }

    const bias = structH4.bias as "bullish" | "bearish";

    // STEP 2: Detect zones at H1
    const [obs, fvgs, unfilledOrders] = await Promise.all([
      Promise.resolve(detectOrderBlocksH1(h1.opens, h1.highs, h1.lows, h1.closes, bias)),
      Promise.resolve(detectFVGH1(h1.highs, h1.lows, bias)),
      detectUnfilledOrdersH1(symbol, currentPrice, bias),
    ]);

    const srLevels = detectSRLevels(h1.highs, h1.lows, h1.closes);
    const sndZones = detectSnDZones(h1.opens, h1.highs, h1.lows, h1.closes);
    const fibLevels = calcFibonacci(h4.highs, h4.lows, h4.closes);

    const selectedZone = selectBestZoneH1(
      obs, fvgs, unfilledOrders, srLevels, sndZones, fibLevels, bias, currentPrice
    );

    if (!selectedZone) {
      return {
        status: "no_zone",
        message: `Trend H4 valid (${bias}) tapi belum ada zona OB/FVG/S&R yang cukup kuat di H1`,
        symbol,
        currentPrice,
        timestamp,
        bias,
        h4: { bias: structH4.bias, strength: structH4.strength },
      };
    }

    // STEP 3: Check skip conditions (after zone found)
    const skipConds = await checkSkipConditions(
      symbol, bias,
      h1.closes, h1.highs, h1.lows,
      h4.highs, h4.lows, h4.closes, h4.volumes
    );

    if (skipConds.shouldSkip) {
      return {
        status: "skip_conditions",
        message: `Zona ditemukan tapi ada kondisi yang tidak mendukung untuk ${symbol}`,
        symbol,
        currentPrice,
        timestamp,
        bias,
        h4: { bias: structH4.bias, strength: structH4.strength },
        zoneType: selectedZone.zoneType,
        rsi: skipConds.rsi,
        rsiDivergence: skipConds.rsiDivergence,
        chochDetected: skipConds.chochDetected,
        oiChange: skipConds.oiChange,
        fundingRate: skipConds.fundingRate,
        skipReasons: skipConds.reasons,
      };
    }

    // STEP 3: Refine at 15M
    const refinedZone = refineZone15M(
      selectedZone, m15.opens, m15.highs, m15.lows, m15.closes, bias
    );

    // STEP 4a: CHoCH 15M (scoring, bukan hard filter)
    const choch15M = detectCHoCH15M(m15.highs, m15.lows, m15.closes, bias);

    // STEP 4b: Rejection candle 15M (scoring, bukan hard filter)
    const rejection15M = checkRejection15M(
      refinedZone, m15.opens, m15.highs, m15.lows, m15.closes, bias, m15.volumes
    );

    // STEP 4c: Pattern konfirmasi H1/H4 (scoring, bukan hard filter)
    const validPatterns = bias === "bullish"
      ? ["Bull Flag", "Ascending Triangle", "Double Bottom", "Inverse H&S", "Falling Wedge", "Pennant"]
      : ["Bear Flag", "Descending Triangle", "Double Top", "Head & Shoulders", "Rising Wedge", "Pennant"];

    const allPatterns = [
      detectBullFlag(h1.highs, h1.lows, h1.closes, h1.volumes),
      detectBearFlag(h1.highs, h1.lows, h1.closes, h1.volumes),
      detectAscendingTriangle(h1.highs, h1.lows, h1.closes),
      detectDescendingTriangle(h1.highs, h1.lows, h1.closes),
      detectDoubleBottom(h1.highs, h1.lows, h1.closes),
      detectDoubleTop(h1.highs, h1.lows, h1.closes),
      detectInverseHS(h1.highs, h1.lows, h1.closes),
      detectHeadAndShoulders(h1.highs, h1.lows, h1.closes),
      detectFallingWedge(h1.highs, h1.lows, h1.closes),
      detectRisingWedge(h1.highs, h1.lows, h1.closes),
      detectPennant(h1.highs, h1.lows, h1.closes, h1.volumes),
      detectBullFlag(h4.highs, h4.lows, h4.closes, h4.volumes),
      detectBearFlag(h4.highs, h4.lows, h4.closes, h4.volumes),
      detectAscendingTriangle(h4.highs, h4.lows, h4.closes),
      detectDescendingTriangle(h4.highs, h4.lows, h4.closes),
      detectDoubleBottom(h4.highs, h4.lows, h4.closes),
      detectDoubleTop(h4.highs, h4.lows, h4.closes),
    ].filter(p => p !== null && validPatterns.includes(p!.name));
    const confirmedPattern = allPatterns.length > 0 ? allPatterns[0] : null;

    // STEP 4d: Jam sesi (London/NY = 14.00-23.00 WIB)
    const nowWIBHour = (new Date().getUTCHours() + 7) % 24;
    const isLondonNYSession = nowWIBHour >= 14 && nowWIBHour <= 23;

    // STEP 4e: Konfirmasi 5M (opsional)
    const confirmation = checkEntryConfirmation5M(
      refinedZone, m5.opens, m5.highs, m5.lows, m5.closes, bias
    );

    // STEP 5: Probability scoring
    let profitProbability = 0;
    const probabilityFactors: string[] = [];

    if (choch15M.detected) {
      profitProbability += 30;
      probabilityFactors.push("✅ CHoCH 15M terkonfirmasi (+30%)");
    } else {
      probabilityFactors.push("⚠️ CHoCH 15M belum terbentuk");
    }

    if (rejection15M.confirmed) {
      if (rejection15M.volumeConfirmed) {
        profitProbability += 25;
        probabilityFactors.push(`✅ Rejection 15M + Volume: ${rejection15M.candleType} (+25%)`);
      } else {
        profitProbability += 15;
        probabilityFactors.push(`✅ Rejection 15M: ${rejection15M.candleType} (+15%) — volume lemah`);
      }
    } else {
      probabilityFactors.push("⚠️ Tidak ada rejection candle 15M di zona");
    }

    if (confirmedPattern) {
      profitProbability += 20;
      probabilityFactors.push(`✅ Pattern: ${confirmedPattern.name} (+20%)`);
    } else {
      probabilityFactors.push("⚠️ Tidak ada pattern konfirmasi");
    }

    if (isLondonNYSession) {
      profitProbability += 15;
      probabilityFactors.push("✅ Sesi London/NY (+15%)");
    } else {
      probabilityFactors.push(`⚠️ Asian session — di luar jam London/NY (sekarang ${nowWIBHour}:00 WIB)`);
    }

    if (selectedZone.tier <= 2) {
      profitProbability += 10;
      probabilityFactors.push(`✅ Zona Tier ${selectedZone.tier} (+10%)`);
    } else {
      probabilityFactors.push(`⚠️ Zona Tier ${selectedZone.tier} (Tier 1-2 lebih baik)`);
    }

    // Fresh zone check — zona yang belum pernah disentuh lebih kuat
    const zoneTouches = selectedZone.touches ?? 0;
    if (zoneTouches === 0) {
      probabilityFactors.push(`✅ Zona fresh — belum pernah ditest`);
    } else if (zoneTouches === 1) {
      probabilityFactors.push(`⚠️ Zona sudah disentuh 1x — masih valid`);
    } else {
      probabilityFactors.push(`🚫 Zona sudah disentuh ${zoneTouches}x — kekuatan berkurang`);
    }

    // Teori Dow: fase trend
    if (skipConds.dowPhase === 'accumulation') {
      profitProbability += 10;
      probabilityFactors.push(`✅ Fase Dow: Accumulation (+10%) — ${skipConds.dowPhaseDesc}`);
    } else if (skipConds.dowPhase === 'participation') {
      profitProbability += 5;
      probabilityFactors.push(`✅ Fase Dow: Public Participation (+5%) — ${skipConds.dowPhaseDesc}`);
    } else if (skipConds.dowPhase === 'unknown') {
      probabilityFactors.push(`⚠️ Fase Dow tidak teridentifikasi`);
    }

    // Teori Dow: volume konfirmasi trend
    if (skipConds.volumeTrendValid) {
      profitProbability += 5;
      probabilityFactors.push(`✅ Volume Dow valid (+5%) — ${skipConds.volumeTrendDesc}`);
    } else {
      probabilityFactors.push(`⚠️ Volume Dow lemah — ${skipConds.volumeTrendDesc}`);
    }

    // Entry price: pakai rejection 15M kalau ada, fallback ke zona entry
    const finalEntryPrice = rejection15M.confirmed
      ? rejection15M.entryPrice
      : refinedZone.entryPrice;

    // STEP 6: Calculate SL/TP
    const atrH1 = calcATR(h1.highs, h1.lows, h1.closes);
    const atrH2 = calcATR(h2.highs, h2.lows, h2.closes);
    const atrH4 = calcATR(h4.highs, h4.lows, h4.closes);

    const sniperLevels = calcSniperLevels(
      finalEntryPrice, refinedZone, atrH2, atrH4, bias,
      h1.highs, h1.lows, atrH1
    );

    // Estimate time to hit entry
    const distanceToEntry = Math.abs(currentPrice - sniperLevels.entryPrice);
    const estimatedHitHours = Math.max(1, Math.round(distanceToEntry / atrH2));

    // Build reasoning
    const reasoning = [
      `Entry di ${selectedZone.zoneType} (${selectedZone.low.toFixed(4)}-${selectedZone.high.toFixed(4)}).`,
      refinedZone.refined ? `Direfine menggunakan ${refinedZone.zoneType}.` : "Zona H1 digunakan langsung.",
      choch15M.detected ? `✅ ${choch15M.description}.` : "⏳ CHoCH 15M belum terbentuk.",
      rejection15M.confirmed
        ? `✅ Rejection 15M: ${rejection15M.candleType} — entry limit di ${finalEntryPrice.toFixed(4)}.`
        : "⏳ Belum ada rejection 15M — limit order di tengah zona.",
      confirmedPattern ? `✅ Pattern: ${confirmedPattern.name}.` : "⏳ Tidak ada pattern konfirmasi.",
      confirmation.confirmed ? `Konfirmasi 5M: ${confirmation.candleType}.` : "",
      `SL di ${bias === "bullish" ? "bawah" : "atas"} swing H1 terdekat.`,
      `TP1 R:R 1:1.5, TP2 R:R 1:3.`,
    ].filter(Boolean).join(" ");

    return {
      status: "ready",
      message: `Setup sniper tersedia untuk ${symbol}`,
      symbol,
      currentPrice,
      timestamp,
      bias,
      entryPrice: sniperLevels.entryPrice,
      stopLoss: sniperLevels.stopLoss,
      takeProfit1: sniperLevels.takeProfit1,
      takeProfit2: sniperLevels.takeProfit2,
      h4: { bias: structH4.bias, strength: structH4.strength },
      zoneType: selectedZone.zoneType,
      zoneRange: { low: selectedZone.low, high: selectedZone.high },
      refinedZoneType: refinedZone.zoneType,
      entryConfirmed: rejection15M.confirmed || confirmation.confirmed,
      confirmationCandle: rejection15M.confirmed
        ? rejection15M.candleType
        : confirmation.candleType,
      rejection15M: rejection15M.confirmed,
      rejection15MCandle: rejection15M.candleType,
      choch15M: choch15M.detected,
      choch15MDescription: choch15M.description,
      patternConfirmed: !!confirmedPattern,
      patternName: confirmedPattern?.name,
      profitProbability,
      probabilityFactors,
      dowPhase: skipConds.dowPhase,
      dowPhaseDesc: skipConds.dowPhaseDesc,
      volumeTrendValid: skipConds.volumeTrendValid,
      volumeTrendDesc: skipConds.volumeTrendDesc,
      chochH4Detected: skipConds.chochH4Detected,
      rsi: skipConds.rsi,
      rsiDivergence: skipConds.rsiDivergence,
      chochDetected: skipConds.chochDetected,
      oiChange: skipConds.oiChange,
      oiAccumulation: skipConds.oiAccumulation,
      oiAccumulationDesc: skipConds.oiAccumulationDesc,
      fundingRate: skipConds.fundingRate,
      setupValidHours: sniperLevels.setupValidHours,
      estimatedHitHours,
      expiryHours: sniperLevels.expiryHours,
      reasoning,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      status: "error",
      message: `Gagal menganalisa ${symbol}: ${message}`,
      symbol,
      currentPrice: 0,
      timestamp,
    };
  }
}
// ─── Menu 4: Breakout Detection ───────────────────────────────────────────────

export interface BreakoutInfo {
  type: 'sr_horizontal' | 'structure_hh' | 'range_squeeze';
  direction: 'bullish' | 'bearish';
  brokenLevel: number;
  breakoutCandleIdx: number;
  impulseHigh: number;
  impulseLow: number;
  volumeRatio: number;
  isValid: boolean;
}

export function detectBreakoutH1(
  opens: number[],
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  bias: 'bullish' | 'bearish'
): BreakoutInfo | null {
  const n = closes.length;
  const avgVol = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
  const atrRecent = calcATR(highs.slice(-20), lows.slice(-20), closes.slice(-20));

  for (let i = n - 1; i >= Math.max(n - 10, 5); i--) {
    const body = Math.abs(closes[i] - opens[i]);
    const range = highs[i] - lows[i];
    if (range === 0) continue;
    if (body < range * 0.3) continue;
    const volRatio = avgVol > 0 ? volumes[i] / avgVol : 0;
    if (volRatio < 1.5) continue;

    // TIPE 1: S/R Horizontal
    const lookbackHighs = highs.slice(Math.max(0, i - 50), i);
    const lookbackLows = lows.slice(Math.max(0, i - 50), i);
    const priceRange = (Math.max(...lookbackHighs) - Math.min(...lookbackLows)) * 0.005;
    const srLevels: number[] = [];
    for (let j = 2; j < lookbackHighs.length - 2; j++) {
      if (lookbackHighs[j] > lookbackHighs[j-1] && lookbackHighs[j] > lookbackHighs[j+1])
        srLevels.push(lookbackHighs[j]);
      if (lookbackLows[j] < lookbackLows[j-1] && lookbackLows[j] < lookbackLows[j+1])
        srLevels.push(lookbackLows[j]);
    }
    for (const lvl of srLevels) {
      const touches = srLevels.filter(l => Math.abs(l - lvl) < priceRange).length;
      if (touches < 2) continue;
      if (bias === 'bullish' && closes[i] > lvl && lows[i] < lvl) {
        return { type: 'sr_horizontal', direction: 'bullish', brokenLevel: lvl,
          breakoutCandleIdx: i, impulseHigh: Math.max(...highs.slice(i)),
          impulseLow: Math.min(...lows.slice(i)), volumeRatio: volRatio, isValid: true };
      }
      if (bias === 'bearish' && closes[i] < lvl && highs[i] > lvl) {
        return { type: 'sr_horizontal', direction: 'bearish', brokenLevel: lvl,
          breakoutCandleIdx: i, impulseHigh: Math.max(...highs.slice(i)),
          impulseLow: Math.min(...lows.slice(i)), volumeRatio: volRatio, isValid: true };
      }
    }

    // TIPE 2: Struktur HH/LL baru
    if (i >= 3) {
      const prev3Range = Math.max(highs[i-1]-lows[i-1], highs[i-2]-lows[i-2], highs[i-3]-lows[i-3]);
      if (prev3Range < atrRecent * 0.5) {
        const recentHighs = highs.slice(Math.max(0, i - 20), i);
        const recentLows = lows.slice(Math.max(0, i - 20), i);
        const swingHighs = findSwingHighs(recentHighs, 5);
        const swingLows = findSwingLows(recentLows, 5);
        if (bias === 'bullish' && swingHighs.length >= 1) {
          const prevHH = swingHighs[swingHighs.length - 1];
          if (closes[i] > prevHH) {
            return { type: 'structure_hh', direction: 'bullish', brokenLevel: prevHH,
              breakoutCandleIdx: i, impulseHigh: Math.max(...highs.slice(i)),
              impulseLow: Math.min(...lows.slice(i)), volumeRatio: volRatio, isValid: true };
          }
        }
        if (bias === 'bearish' && swingLows.length >= 1) {
          const prevLL = swingLows[swingLows.length - 1];
          if (closes[i] < prevLL) {
            return { type: 'structure_hh', direction: 'bearish', brokenLevel: prevLL,
              breakoutCandleIdx: i, impulseHigh: Math.max(...highs.slice(i)),
              impulseLow: Math.min(...lows.slice(i)), volumeRatio: volRatio, isValid: true };
          }
        }
      }
    }

    // TIPE 3: Range Squeeze
    if (i >= 30) {
      const atr10 = calcATR(highs.slice(i-10, i), lows.slice(i-10, i), closes.slice(i-10, i));
      const atr20prev = calcATR(highs.slice(i-30, i-10), lows.slice(i-30, i-10), closes.slice(i-30, i-10));
      if (atr20prev > 0 && atr10 <= atr20prev * 0.5 && body >= atrRecent * 1.5 && volRatio >= 2.0) {
        const brokenLevel = bias === 'bullish'
          ? Math.max(...highs.slice(i-10, i))
          : Math.min(...lows.slice(i-10, i));
        if (bias === 'bullish' && closes[i] > brokenLevel) {
          return { type: 'range_squeeze', direction: 'bullish', brokenLevel,
            breakoutCandleIdx: i, impulseHigh: Math.max(...highs.slice(i)),
            impulseLow: Math.min(...lows.slice(i)), volumeRatio: volRatio, isValid: true };
        }
        if (bias === 'bearish' && closes[i] < brokenLevel) {
          return { type: 'range_squeeze', direction: 'bearish', brokenLevel,
            breakoutCandleIdx: i, impulseHigh: Math.max(...highs.slice(i)),
            impulseLow: Math.min(...lows.slice(i)), volumeRatio: volRatio, isValid: true };
        }
      }
    }
  }
  return null;
}

export interface RetestZone {
  price: number;
  zoneLow: number;
  zoneHigh: number;
  type: string;
  tier: number;
  reason: string;
  distancePct: number;
  isReached: boolean;
}

export function findRetestZone(
  highs: number[], lows: number[], closes: number[], opens: number[], volumes: number[],
  highs15m: number[], lows15m: number[], closes15m: number[],
  breakout: BreakoutInfo,
  currentPrice: number,
  atrH1: number,
  bias: 'bullish' | 'bearish',
  atrH2: number,
): RetestZone | null {
  const candidates: RetestZone[] = [];

  // TIER 1: Role Reversal — buffer pakai ATR H2 × 0.3
  const rrPrice = breakout.brokenLevel;
  candidates.push({
    price: rrPrice,
    zoneLow: rrPrice - atrH2 * 0.3,
    zoneHigh: rrPrice + atrH2 * 0.3,
    type: 'Role Reversal',
    tier: 1,
    reason: `Level ${rrPrice.toFixed(4)} ditembus — jadi ${bias === 'bullish' ? 'support' : 'resistance'} baru`,
    distancePct: Math.abs(currentPrice - rrPrice) / currentPrice * 100,
    isReached: bias === 'bullish'
      ? currentPrice <= rrPrice + atrH2 * 0.3
      : currentPrice >= rrPrice - atrH2 * 0.3,
  });

  // TIER 2: OB pre-breakout
  const obIdx = breakout.breakoutCandleIdx - 1;
  if (obIdx >= 0) {
    const obHigh = highs[obIdx];
    const obLow = lows[obIdx];
    const obEntry = bias === 'bullish'
      ? obLow + (obHigh - obLow) * 0.382
      : obHigh - (obHigh - obLow) * 0.382;
    candidates.push({
      price: obEntry, zoneLow: obLow, zoneHigh: obHigh,
      type: 'Order Block pre-breakout', tier: 2,
      reason: `OB candle sebelum breakout (${obLow.toFixed(4)}–${obHigh.toFixed(4)})`,
      distancePct: Math.abs(currentPrice - obEntry) / currentPrice * 100,
      isReached: bias === 'bullish' ? currentPrice <= obHigh : currentPrice >= obLow,
    });
  }

  // TIER 3: FVG dari impulse breakout
  for (let i = breakout.breakoutCandleIdx + 2; i < closes.length; i++) {
    if (bias === 'bullish' && highs[i-2] < lows[i]) {
      const fvgLow = highs[i-2], fvgHigh = lows[i], fvgMid = (fvgLow + fvgHigh) / 2;
      candidates.push({ price: fvgMid, zoneLow: fvgLow, zoneHigh: fvgHigh,
        type: 'FVG impulse breakout', tier: 3,
        reason: `Gap ${fvgLow.toFixed(4)}–${fvgHigh.toFixed(4)} terbentuk saat breakout`,
        distancePct: Math.abs(currentPrice - fvgMid) / currentPrice * 100,
        isReached: currentPrice <= fvgHigh });
      break;
    }
    if (bias === 'bearish' && lows[i-2] > highs[i]) {
      const fvgHigh = lows[i-2], fvgLow = highs[i], fvgMid = (fvgLow + fvgHigh) / 2;
      candidates.push({ price: fvgMid, zoneLow: fvgLow, zoneHigh: fvgHigh,
        type: 'FVG impulse breakout', tier: 3,
        reason: `Gap ${fvgLow.toFixed(4)}–${fvgHigh.toFixed(4)} terbentuk saat breakout`,
        distancePct: Math.abs(currentPrice - fvgMid) / currentPrice * 100,
        isReached: currentPrice >= fvgLow });
      break;
    }
  }

  // TIER 4: Fibonacci dari impulse
  const impulseRange = breakout.impulseHigh - breakout.impulseLow;
  if (impulseRange > 0) {
    for (const fib of [0.382, 0.5, 0.618]) {
      const fibPrice = bias === 'bullish'
        ? breakout.impulseHigh - impulseRange * fib
        : breakout.impulseLow + impulseRange * fib;
      candidates.push({
        price: fibPrice, zoneLow: fibPrice - atrH1 * 0.2, zoneHigh: fibPrice + atrH1 * 0.2,
        type: `Fibonacci ${(fib * 100).toFixed(1)}%`, tier: 4,
        reason: `Retracement ${(fib * 100).toFixed(1)}% dari impulse breakout`,
        distancePct: Math.abs(currentPrice - fibPrice) / currentPrice * 100,
        isReached: bias === 'bullish'
          ? currentPrice <= fibPrice + atrH1 * 0.2
          : currentPrice >= fibPrice - atrH1 * 0.2,
      });
    }
  }

  const valid = candidates.filter(c => c.distancePct < 5.0);
  if (valid.length === 0) return null;
  valid.sort((a, b) => a.tier !== b.tier ? a.tier - b.tier : a.distancePct - b.distancePct);
  return valid[0];
}

export interface BreakoutResult {
  status: 'ready' | 'in_zone' | 'approaching' | 'no_breakout' | 'no_zone' | 'no_trend' | 'skip' | 'error';
  symbol: string;
  bias?: 'bullish' | 'bearish';
  currentPrice: number;
  timestamp: string;
  message?: string;
  breakoutType?: 'sr_horizontal' | 'structure_hh' | 'range_squeeze';
  brokenLevel?: number;
  volumeRatio?: number;
  retestZone?: RetestZone;
  retestConfirmed?: boolean;
  patternConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  confirmingPatterns?: string[];
  entryPrice?: number;
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  takeProfit3?: number;
  fundingRate?: number;
  setupExpiryHours?: number;
  reason?: string;
}

export async function analyzeBreakoutEntry(symbol: string): Promise<BreakoutResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';

  try {
    const [h4, h1, m30, m15, tickerRes, frRes] = await Promise.all([
      fetchKlines(symbol, '4h', 100),
      fetchKlines(symbol, '1h', 100),
      fetchKlines(symbol, '30m', 100),
      fetchKlines(symbol, '15m', 100),
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`),
      fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`),
    ]);

    const currentPrice = tickerRes.ok
      ? parseFloat((await tickerRes.json() as { price: string }).price)
      : h1.closes[h1.closes.length - 1];

    let fundingRate = 0;
    if (frRes.ok) {
      const frData = await frRes.json() as Array<{ fundingRate: string }>;
      if (frData.length > 0) fundingRate = parseFloat(frData[0].fundingRate) * 100;
    }

    const structH4 = analyzePriceActionStructure(h4.highs, h4.lows, h4.closes);
    if (structH4.bias === 'ranging')
      return { status: 'no_trend', symbol, currentPrice, timestamp, message: 'H4 ranging' };

    const bias = structH4.bias as 'bullish' | 'bearish';

    if (bias === 'bullish' && fundingRate < -0.1)
      return { status: 'skip', symbol, bias, currentPrice, timestamp, message: 'Funding rate sangat negatif', fundingRate };
    if (bias === 'bearish' && fundingRate > 0.1)
      return { status: 'skip', symbol, bias, currentPrice, timestamp, message: 'Funding rate sangat positif', fundingRate };

    // Deteksi breakout di H1 dan M30 — ambil yang paling kuat (volume ratio tertinggi)
    const breakoutH1 = detectBreakoutH1(h1.opens, h1.highs, h1.lows, h1.closes, h1.volumes, bias);
    const breakoutM30 = detectBreakoutH1(m30.opens, m30.highs, m30.lows, m30.closes, m30.volumes, bias);

    let breakout = breakoutH1;
    let breakoutTf = 'H1';
    if (!breakoutH1 && breakoutM30) {
      breakout = breakoutM30;
      breakoutTf = 'M30';
    } else if (breakoutH1 && breakoutM30 && breakoutM30.volumeRatio > breakoutH1.volumeRatio) {
      breakout = breakoutM30;
      breakoutTf = 'M30';
    }

    if (!breakout)
      return { status: 'no_breakout', symbol, bias, currentPrice, timestamp, message: 'Tidak ada breakout valid di H1/M30' };

    const atrH1 = calcATR(h1.highs, h1.lows, h1.closes);
    const atrH2 = calcATR(m30.highs, m30.lows, m30.closes); // M30 ≈ H2
    const atr15m = calcATR(m15.highs, m15.lows, m15.closes);

    // Gunakan data TF yang terdeteksi breakout untuk findRetestZone
    const brkData = breakoutTf === 'M30' ? m30 : h1;
    const retestZone = findRetestZone(
      brkData.highs, brkData.lows, brkData.closes, brkData.opens, brkData.volumes,
      m15.highs, m15.lows, m15.closes,
      breakout, currentPrice, atrH1, bias, atrH2
    );

    if (!retestZone)
      return { status: 'no_zone', symbol, bias, currentPrice, timestamp,
        message: 'Tidak ada zona retest valid',
        breakoutType: breakout.type, brokenLevel: breakout.brokenLevel, volumeRatio: breakout.volumeRatio };

    const inZone = retestZone.isReached;

    // ─── OPSI A: Cek pattern di H4/H1/M30 yang searah (confidence boost) ─────
    const bullishContinuation = ['Bull Flag', 'Ascending Triangle', 'Pennant', 'Symmetrical Triangle'];
    const bullishReversal = ['Double Bottom', 'Inverse H&S', 'Falling Wedge'];
    const bearishContinuation = ['Bear Flag', 'Descending Triangle', 'Pennant', 'Symmetrical Triangle'];
    const bearishReversal = ['Double Top', 'Head & Shoulders', 'Rising Wedge'];
    const validBullish = [...bullishContinuation, ...bullishReversal];
    const validBearish = [...bearishContinuation, ...bearishReversal];

    const detectAllPatterns = (kline: KlineData): PatternResult[] => {
      const { highs: h, lows: l, closes: c, volumes: v } = kline;
      const results: PatternResult[] = [];
      const checks = [
        detectBullFlag(h, l, c, v), detectBearFlag(h, l, c, v),
        detectAscendingTriangle(h, l, c), detectDescendingTriangle(h, l, c),
        detectSymmetricalTriangle(h, l, c), detectPennant(h, l, c, v),
        detectDoubleTop(h, l, c), detectDoubleBottom(h, l, c),
        detectHeadAndShoulders(h, l, c), detectInverseHS(h, l, c),
        detectRisingWedge(h, l, c), detectFallingWedge(h, l, c),
      ];
      for (const r of checks) { if (r) results.push(r); }
      return results;
    };

    // Cek pattern di H4, H1, M30
    const validList = bias === 'bullish' ? validBullish : validBearish;
    const h4Patterns = detectAllPatterns(h4).filter(p => validList.includes(p.name));
    const h1Patterns = detectAllPatterns(h1).filter(p => validList.includes(p.name));
    const m30Patterns = detectAllPatterns(m30).filter(p => validList.includes(p.name));
    const allConfirmingPatterns = [
      ...h4Patterns.map(p => `H4: ${p.name}`),
      ...h1Patterns.map(p => `H1: ${p.name}`),
      ...m30Patterns.map(p => `M30: ${p.name}`),
    ];
    const patternCount = allConfirmingPatterns.length;
    const patternConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' =
      patternCount >= 2 ? 'HIGH' : patternCount === 1 ? 'MEDIUM' : 'LOW';

    // ─── OPSI B: Cek pattern 15M untuk konfirmasi zona retest ─────────────────
    const bullishReversalShort = ['Double Bottom', 'Inverse H&S', 'Falling Wedge', 'Bull Flag'];
    const bearishReversalShort = ['Double Top', 'Head & Shoulders', 'Rising Wedge', 'Bear Flag'];
    const validZoneList = bias === 'bullish' ? bullishReversalShort : bearishReversalShort;

    let retestConfirmed = false;
    let zonePatternConfirmed = false;

    if (inZone) {
      // Rejection candle di 15M
      const last = m15.closes.length - 1;
      for (let i = last; i >= Math.max(0, last - 2); i--) {
        const body = Math.abs(m15.closes[i] - m15.opens[i]);
        const wick = bias === 'bullish'
          ? Math.min(m15.opens[i], m15.closes[i]) - m15.lows[i]
          : m15.highs[i] - Math.max(m15.opens[i], m15.closes[i]);
        if (body > 0 && wick > body * 1.5) { retestConfirmed = true; break; }
      }

      // Pattern konfirmasi di 15M
      const m15Patterns = detectAllPatterns(m15).filter(p => validZoneList.includes(p.name));
      zonePatternConfirmed = m15Patterns.length > 0;
    }

    // Status: ready hanya kalau rejection + (pattern 15M ATAU pattern H1/M30 HIGH)
    const isReady = inZone && retestConfirmed && (zonePatternConfirmed || patternConfidence === 'HIGH');
    const status = isReady ? 'ready' : inZone ? 'in_zone' : 'approaching';

    const entryPrice = retestZone.price;
    const dir = bias === 'bullish' ? 1 : -1;

    // SL berdasarkan swing high/low H1 terdekat (20 candle lookback)
    const m4SwingHighs = findSwingHighs(h1.highs, 20);
    const m4SwingLows = findSwingLows(h1.lows, 20);
    const m4Buffer = atrH1 * 0.2;

    let stopLoss: number;
    if (bias === 'bullish') {
      const relevantLows = m4SwingLows.filter(l => l < entryPrice);
      const nearestSwingLow = relevantLows.length > 0
        ? Math.max(...relevantLows)
        : Math.min(...h1.lows.slice(-20));
      const rawSl = nearestSwingLow - m4Buffer;
      const minSl = entryPrice - atrH2;
      stopLoss = Math.min(rawSl, minSl);
    } else {
      const relevantHighs = m4SwingHighs.filter(h => h > entryPrice);
      const nearestSwingHigh = relevantHighs.length > 0
        ? Math.min(...relevantHighs)
        : Math.max(...h1.highs.slice(-20));
      const rawSl = nearestSwingHigh + m4Buffer;
      const minSl = entryPrice + atrH2;
      stopLoss = Math.max(rawSl, minSl);
    }
    const risk = Math.abs(entryPrice - stopLoss);
    const takeProfit1 = entryPrice + risk * 1.5 * dir;
    const takeProfit2 = entryPrice + risk * 3.0 * dir;
    const takeProfit3 = breakout.volumeRatio >= 2.0 ? entryPrice + risk * 5.0 * dir : undefined;

    const reasonParts = [`${retestZone.type} (Tier ${retestZone.tier}) — ${retestZone.reason}`];
    if (allConfirmingPatterns.length > 0)
      reasonParts.push(`Pattern: ${allConfirmingPatterns.join(', ')}`);

    return {
      status,
      symbol, bias, currentPrice, timestamp,
      breakoutType: breakout.type, brokenLevel: breakout.brokenLevel, volumeRatio: breakout.volumeRatio,
      retestZone, retestConfirmed,
      patternConfidence,
      confirmingPatterns: allConfirmingPatterns,
      entryPrice, stopLoss, takeProfit1, takeProfit2, takeProfit3,
      fundingRate, setupExpiryHours: 8,
      reason: reasonParts.join(' | '),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { status: 'error', symbol, currentPrice: 0, timestamp, message };
  }
}

// ─── Menu 5: Chart Pattern Detection ─────────────────────────────────────────

export interface PatternResult {
  name: string;
  category: 'continuation' | 'reversal';
  direction: 'bullish' | 'bearish';
  confidence: 'high' | 'medium' | 'low';
  description: string;
}

export interface TFPatterns {
  tf: string;
  patterns: PatternResult[];
}

function detectBullFlag(highs: number[], lows: number[], closes: number[], volumes: number[]): PatternResult | null {
  const n = closes.length;
  if (n < 20) return null;
  const poleStart = n - 20, poleEnd = n - 10;
  const poleMove = (closes[poleEnd] - closes[poleStart]) / closes[poleStart] * 100;
  if (poleMove < 3) return null;
  const flagHighs = highs.slice(n - 8), flagLows = lows.slice(n - 8);
  const flagRange = (Math.max(...flagHighs) - Math.min(...flagLows)) / closes[n - 8] * 100;
  if (flagRange > 4) return null;
  const flagDrift = (closes[n - 1] - closes[n - 8]) / closes[n - 8] * 100;
  if (flagDrift > 1.5) return null;
  const poleVol = volumes.slice(poleStart, poleEnd).reduce((a, b) => a + b, 0) / (poleEnd - poleStart);
  const flagVol = volumes.slice(n - 8).reduce((a, b) => a + b, 0) / 8;
  if (flagVol >= poleVol) return null;
  return { name: 'Bull Flag', category: 'continuation', direction: 'bullish', confidence: poleMove > 6 ? 'high' : 'medium', description: `Pole +${poleMove.toFixed(1)}%, flag konsolidasi ${flagRange.toFixed(1)}%` };
}

function detectBearFlag(highs: number[], lows: number[], closes: number[], volumes: number[]): PatternResult | null {
  const n = closes.length;
  if (n < 20) return null;
  const poleStart = n - 20, poleEnd = n - 10;
  const poleMove = (closes[poleStart] - closes[poleEnd]) / closes[poleStart] * 100;
  if (poleMove < 3) return null;
  const flagHighs = highs.slice(n - 8), flagLows = lows.slice(n - 8);
  const flagRange = (Math.max(...flagHighs) - Math.min(...flagLows)) / closes[n - 8] * 100;
  if (flagRange > 4) return null;
  const flagDrift = (closes[n - 1] - closes[n - 8]) / closes[n - 8] * 100;
  if (flagDrift < -1.5) return null;
  const poleVol = volumes.slice(poleStart, poleEnd).reduce((a, b) => a + b, 0) / (poleEnd - poleStart);
  const flagVol = volumes.slice(n - 8).reduce((a, b) => a + b, 0) / 8;
  if (flagVol >= poleVol) return null;
  return { name: 'Bear Flag', category: 'continuation', direction: 'bearish', confidence: poleMove > 6 ? 'high' : 'medium', description: `Pole -${poleMove.toFixed(1)}%, flag konsolidasi ${flagRange.toFixed(1)}%` };
}

function detectAscendingTriangle(highs: number[], lows: number[], closes: number[]): PatternResult | null {
  const n = closes.length;
  if (n < 15) return null;
  const swingH = findSwingHighs(highs.slice(n - 15), 3);
  if (swingH.length < 2) return null;
  const maxH = Math.max(...swingH), minH = Math.min(...swingH);
  if ((maxH - minH) / minH * 100 > 1.5) return null;
  const swingL = findSwingLows(lows.slice(n - 15), 3);
  if (swingL.length < 2) return null;
  if (swingL[swingL.length - 1] <= swingL[0]) return null;
  return { name: 'Ascending Triangle', category: 'continuation', direction: 'bullish', confidence: 'medium', description: `Resistance flat di ${maxH.toFixed(4)}, support naik` };
}

function detectDescendingTriangle(highs: number[], lows: number[], closes: number[]): PatternResult | null {
  const n = closes.length;
  if (n < 15) return null;
  const swingL = findSwingLows(lows.slice(n - 15), 3);
  if (swingL.length < 2) return null;
  const maxL = Math.max(...swingL), minL = Math.min(...swingL);
  if ((maxL - minL) / minL * 100 > 1.5) return null;
  const swingH = findSwingHighs(highs.slice(n - 15), 3);
  if (swingH.length < 2) return null;
  if (swingH[swingH.length - 1] >= swingH[0]) return null;
  return { name: 'Descending Triangle', category: 'continuation', direction: 'bearish', confidence: 'medium', description: `Support flat di ${minL.toFixed(4)}, resistance turun` };
}

function detectSymmetricalTriangle(highs: number[], lows: number[], closes: number[]): PatternResult | null {
  const n = closes.length;
  if (n < 15) return null;
  const swingH = findSwingHighs(highs.slice(n - 15), 3);
  const swingL = findSwingLows(lows.slice(n - 15), 3);
  if (swingH.length < 2 || swingL.length < 2) return null;
  if (swingH[swingH.length - 1] >= swingH[0]) return null;
  if (swingL[swingL.length - 1] <= swingL[0]) return null;
  const bias = closes[n - 1] > closes[n - 8] ? 'bullish' : 'bearish';
  return { name: 'Symmetrical Triangle', category: 'continuation', direction: bias as 'bullish' | 'bearish', confidence: 'low', description: `HH turun + HL naik, bias ${bias}` };
}

function detectPennant(highs: number[], lows: number[], closes: number[], volumes: number[]): PatternResult | null {
  const n = closes.length;
  if (n < 20) return null;
  const poleStart = n - 20, poleEnd = n - 12;
  const poleMove = Math.abs((closes[poleEnd] - closes[poleStart]) / closes[poleStart] * 100);
  if (poleMove < 4) return null;
  const dir = closes[poleEnd] > closes[poleStart] ? 'bullish' : 'bearish';
  const swH = findSwingHighs(highs.slice(n - 10), 2);
  const swL = findSwingLows(lows.slice(n - 10), 2);
  if (swH.length < 2 || swL.length < 2) return null;
  if (swH[swH.length - 1] >= swH[0]) return null;
  if (swL[swL.length - 1] <= swL[0]) return null;
  const poleVol = volumes.slice(poleStart, poleEnd).reduce((a, b) => a + b, 0) / (poleEnd - poleStart);
  const pennantVol = volumes.slice(n - 10).reduce((a, b) => a + b, 0) / 10;
  if (pennantVol >= poleVol) return null;
  return { name: 'Pennant', category: 'continuation', direction: dir as 'bullish' | 'bearish', confidence: 'medium', description: `Pole ${dir === 'bullish' ? '+' : '-'}${poleMove.toFixed(1)}%, pennant konsolidasi volume turun` };
}

function detectDoubleTop(highs: number[], lows: number[], closes: number[]): PatternResult | null {
  const n = closes.length;
  if (n < 30) return null;
  const swingH = findSwingHighs(highs.slice(n - 30), 5);
  if (swingH.length < 2) return null;
  const last = swingH[swingH.length - 1], prev = swingH[swingH.length - 2];
  const diff = Math.abs(last - prev) / prev * 100;
  if (diff > 1.5) return null;
  const neckline = Math.min(...lows.slice(n - 30));
  if (closes[n - 1] < neckline * 1.005) {
    return { name: 'Double Top', category: 'reversal', direction: 'bearish', confidence: diff < 0.8 ? 'high' : 'medium', description: `Dua puncak di ~${((last + prev) / 2).toFixed(4)}, neckline ${neckline.toFixed(4)}` };
  }
  return null;
}

function detectDoubleBottom(highs: number[], lows: number[], closes: number[]): PatternResult | null {
  const n = closes.length;
  if (n < 30) return null;
  const swingL = findSwingLows(lows.slice(n - 30), 5);
  if (swingL.length < 2) return null;
  const last = swingL[swingL.length - 1], prev = swingL[swingL.length - 2];
  const diff = Math.abs(last - prev) / prev * 100;
  if (diff > 1.5) return null;
  const neckline = Math.max(...highs.slice(n - 30));
  if (closes[n - 1] > neckline * 0.995) {
    return { name: 'Double Bottom', category: 'reversal', direction: 'bullish', confidence: diff < 0.8 ? 'high' : 'medium', description: `Dua lembah di ~${((last + prev) / 2).toFixed(4)}, neckline ${neckline.toFixed(4)}` };
  }
  return null;
}

function detectHeadAndShoulders(highs: number[], lows: number[], closes: number[]): PatternResult | null {
  const n = closes.length;
  if (n < 40) return null;
  const swingH = findSwingHighs(highs.slice(n - 40), 5);
  if (swingH.length < 3) return null;
  const [ls, head, rs] = swingH.slice(-3);
  if (head <= ls || head <= rs) return null;
  const shoulderDiff = Math.abs(ls - rs) / ls * 100;
  if (shoulderDiff > 3) return null;
  if (head < Math.max(ls, rs) * 1.01) return null;
  return { name: 'Head & Shoulders', category: 'reversal', direction: 'bearish', confidence: shoulderDiff < 1.5 ? 'high' : 'medium', description: `LS ${ls.toFixed(4)}, Head ${head.toFixed(4)}, RS ${rs.toFixed(4)}` };
}

function detectInverseHS(highs: number[], lows: number[], closes: number[]): PatternResult | null {
  const n = closes.length;
  if (n < 40) return null;
  const swingL = findSwingLows(lows.slice(n - 40), 5);
  if (swingL.length < 3) return null;
  const [ls, head, rs] = swingL.slice(-3);
  if (head >= ls || head >= rs) return null;
  const shoulderDiff = Math.abs(ls - rs) / ls * 100;
  if (shoulderDiff > 3) return null;
  if (head > Math.min(ls, rs) * 0.99) return null;
  return { name: 'Inverse H&S', category: 'reversal', direction: 'bullish', confidence: shoulderDiff < 1.5 ? 'high' : 'medium', description: `LS ${ls.toFixed(4)}, Head ${head.toFixed(4)}, RS ${rs.toFixed(4)}` };
}

function detectRisingWedge(highs: number[], lows: number[], closes: number[]): PatternResult | null {
  const n = closes.length;
  if (n < 15) return null;
  const swingH = findSwingHighs(highs.slice(n - 15), 3);
  const swingL = findSwingLows(lows.slice(n - 15), 3);
  if (swingH.length < 2 || swingL.length < 2) return null;
  if (swingH[swingH.length - 1] <= swingH[0]) return null;
  if (swingL[swingL.length - 1] <= swingL[0]) return null;
  const slopeH = (swingH[swingH.length - 1] - swingH[0]) / swingH[0];
  const slopeL = (swingL[swingL.length - 1] - swingL[0]) / swingL[0];
  if (slopeL <= slopeH) return null;
  return { name: 'Rising Wedge', category: 'reversal', direction: 'bearish', confidence: 'medium', description: `Support naik lebih cepat dari resistance — sinyal bearish reversal` };
}

function detectFallingWedge(highs: number[], lows: number[], closes: number[]): PatternResult | null {
  const n = closes.length;
  if (n < 15) return null;
  const swingH = findSwingHighs(highs.slice(n - 15), 3);
  const swingL = findSwingLows(lows.slice(n - 15), 3);
  if (swingH.length < 2 || swingL.length < 2) return null;
  if (swingH[swingH.length - 1] >= swingH[0]) return null;
  if (swingL[swingL.length - 1] >= swingL[0]) return null;
  const slopeH = (swingH[0] - swingH[swingH.length - 1]) / swingH[0];
  const slopeL = (swingL[0] - swingL[swingL.length - 1]) / swingL[0];
  if (slopeL <= slopeH) return null;
  return { name: 'Falling Wedge', category: 'reversal', direction: 'bullish', confidence: 'medium', description: `Resistance turun lebih cepat dari support — sinyal bullish reversal` };
}

export async function analyzeChartPatterns(symbol: string): Promise<{ symbol: string; timestamp: string; timeframes: TFPatterns[] }> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';

  const [h4, h1, m30, m15, m5] = await Promise.all([
    fetchKlines(symbol, '4h', 100),
    fetchKlines(symbol, '1h', 100),
    fetchKlines(symbol, '30m', 100),
    fetchKlines(symbol, '15m', 100),
    fetchKlines(symbol, '5m', 100),
  ]);

  const detect = (kline: KlineData): PatternResult[] => {
    const { highs: h, lows: l, closes: c, volumes: v } = kline;
    const results: PatternResult[] = [];
    const checks = [
      detectBullFlag(h, l, c, v),
      detectBearFlag(h, l, c, v),
      detectAscendingTriangle(h, l, c),
      detectDescendingTriangle(h, l, c),
      detectSymmetricalTriangle(h, l, c),
      detectPennant(h, l, c, v),
      detectDoubleTop(h, l, c),
      detectDoubleBottom(h, l, c),
      detectHeadAndShoulders(h, l, c),
      detectInverseHS(h, l, c),
      detectRisingWedge(h, l, c),
      detectFallingWedge(h, l, c),
    ];
    for (const r of checks) { if (r) results.push(r); }
    return results;
  };

  return {
    symbol,
    timestamp,
    timeframes: [
      { tf: 'H4', patterns: detect(h4) },
      { tf: 'H1', patterns: detect(h1) },
      { tf: 'M30', patterns: detect(m30) },
      { tf: 'M15', patterns: detect(m15) },
      { tf: 'M5', patterns: detect(m5) },
    ],
  };
}
// ─── Menu 6: Backtesting Engine ───────────────────────────────────────────────

export interface BacktestTrade {
  menu: 'sniper' | 'breakout';
  entryTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  bias: 'bullish' | 'bearish';
  result: 'TP1' | 'TP2' | 'SL' | 'EXPIRED';
  exitPrice: number;
  rr: number; // R:R terealisasi
  // Kondisi saat sinyal
  hasChoch15M: boolean;
  hasRejection15M: boolean;
  hasPattern: boolean;
  patternConfidence: string;
  zoneTier: number;
  breakoutType?: string;
  volumeRatio?: number;
  hour: number; // jam WIB saat sinyal
}

export interface BacktestAnalysis {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgRR: number;
  // Breakdown kondisi
  breakdown: {
    withChoch15M: { trades: number; wins: number; winRate: number };
    withoutChoch15M: { trades: number; wins: number; winRate: number };
    withRejection15M: { trades: number; wins: number; winRate: number };
    withoutRejection15M: { trades: number; wins: number; winRate: number };
    withPattern: { trades: number; wins: number; winRate: number };
    withoutPattern: { trades: number; wins: number; winRate: number };
    tier1to2: { trades: number; wins: number; winRate: number };
    tier3plus: { trades: number; wins: number; winRate: number };
    londonNY: { trades: number; wins: number; winRate: number };
    asian: { trades: number; wins: number; winRate: number };
    highVolume: { trades: number; wins: number; winRate: number };
    lowVolume: { trades: number; wins: number; winRate: number };
  };
  // Penyebab lose
  lossCauses: Array<{ cause: string; count: number; percentage: number }>;
  // Rekomendasi (hanya jika winRate < 75%)
  recommendations: string[];
}

export interface BacktestResult {
  symbol: string;
  period: string;
  totalCandles: number;
  sniperResult?: BacktestAnalysis & { trades: BacktestTrade[] };
  breakoutResult?: BacktestAnalysis & { trades: BacktestTrade[] };
  comparison?: {
    better: 'sniper' | 'breakout' | 'equal';
    sniperWinRate: number;
    breakoutWinRate: number;
    mostImpactfulFilter: string;
  };
  timestamp: string;
}

function getWIBHour(timestamp: number): number {
  const date = new Date(timestamp);
  return (date.getUTCHours() + 7) % 24;
}

function isLondonNY(hour: number): boolean {
  return (hour >= 14 && hour <= 23);
}

function analyzeWinRate(wins: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((wins / total) * 100 * 10) / 10;
}

function buildAnalysis(trades: BacktestTrade[]): BacktestAnalysis {
  const total = trades.length;
  const wins = trades.filter(t => t.result === 'TP1' || t.result === 'TP2').length;
  const winRate = analyzeWinRate(wins, total);
  const avgRR = total > 0
    ? Math.round(trades.reduce((sum, t) => sum + t.rr, 0) / total * 100) / 100
    : 0;

  // Breakdown
  const groups = {
    withChoch15M: trades.filter(t => t.hasChoch15M),
    withoutChoch15M: trades.filter(t => !t.hasChoch15M),
    withRejection15M: trades.filter(t => t.hasRejection15M),
    withoutRejection15M: trades.filter(t => !t.hasRejection15M),
    withPattern: trades.filter(t => t.hasPattern),
    withoutPattern: trades.filter(t => !t.hasPattern),
    tier1to2: trades.filter(t => t.zoneTier <= 2),
    tier3plus: trades.filter(t => t.zoneTier > 2),
    londonNY: trades.filter(t => isLondonNY(t.hour)),
    asian: trades.filter(t => !isLondonNY(t.hour)),
    highVolume: trades.filter(t => t.volumeRatio !== undefined && t.volumeRatio >= 2),
    lowVolume: trades.filter(t => t.volumeRatio !== undefined && t.volumeRatio < 2),
  };

  const breakdown: BacktestAnalysis['breakdown'] = {} as BacktestAnalysis['breakdown'];
  for (const [key, group] of Object.entries(groups)) {
    const w = group.filter(t => t.result === 'TP1' || t.result === 'TP2').length;
    (breakdown as any)[key] = {
      trades: group.length,
      wins: w,
      winRate: analyzeWinRate(w, group.length),
    };
  }

  // Analisa penyebab lose
  const loseTrades = trades.filter(t => t.result === 'SL');
  const causeCounts: Record<string, number> = {};

  for (const t of loseTrades) {
    if (!t.hasChoch15M) {
      causeCounts['CHoCH 15M tidak terkonfirmasi'] = (causeCounts['CHoCH 15M tidak terkonfirmasi'] ?? 0) + 1;
    }
    if (!t.hasRejection15M) {
      causeCounts['Tidak ada rejection candle 15M'] = (causeCounts['Tidak ada rejection candle 15M'] ?? 0) + 1;
    }
    if (!t.hasPattern) {
      causeCounts['Tidak ada pattern konfirmasi'] = (causeCounts['Tidak ada pattern konfirmasi'] ?? 0) + 1;
    }
    if (t.zoneTier > 2) {
      causeCounts['Entry di zona Tier 3+ (kualitas rendah)'] = (causeCounts['Entry di zona Tier 3+ (kualitas rendah)'] ?? 0) + 1;
    }
    if (!isLondonNY(t.hour)) {
      causeCounts['Entry di luar jam London/NY (Asian session)'] = (causeCounts['Entry di luar jam London/NY (Asian session)'] ?? 0) + 1;
    }
    if (t.volumeRatio !== undefined && t.volumeRatio < 2) {
      causeCounts['Volume breakout rendah (< 2x)'] = (causeCounts['Volume breakout rendah (< 2x)'] ?? 0) + 1;
    }
  }

  const lossCauses = Object.entries(causeCounts)
    .map(([cause, count]) => ({
      cause,
      count,
      percentage: Math.round((count / Math.max(loseTrades.length, 1)) * 100),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Rekomendasi hanya jika winRate < 75%
  const recommendations: string[] = [];
  if (winRate < 75) {
    const bd = breakdown;
    if (bd.withChoch15M.winRate > bd.withoutChoch15M.winRate + 10 && bd.withoutChoch15M.trades > 3) {
      recommendations.push(
        `Win rate dengan CHoCH 15M (${bd.withChoch15M.winRate}%) jauh lebih tinggi dari tanpa CHoCH (${bd.withoutChoch15M.winRate}%) → Hanya entry jika CHoCH 15M sudah terkonfirmasi`
      );
    }
    if (bd.withRejection15M.winRate > bd.withoutRejection15M.winRate + 10 && bd.withoutRejection15M.trades > 3) {
      recommendations.push(
        `Win rate dengan rejection 15M (${bd.withRejection15M.winRate}%) jauh lebih tinggi → Tunggu candle rejection sebelum pasang limit order`
      );
    }
    if (bd.withPattern.winRate > bd.withoutPattern.winRate + 10 && bd.withoutPattern.trades > 3) {
      recommendations.push(
        `Win rate dengan pattern konfirmasi (${bd.withPattern.winRate}%) lebih tinggi → Prioritaskan sinyal yang ada pattern searah`
      );
    }
    if (bd.tier1to2.winRate > bd.tier3plus.winRate + 10 && bd.tier3plus.trades > 3) {
      recommendations.push(
        `Win rate zona Tier 1-2 (${bd.tier1to2.winRate}%) jauh lebih baik dari Tier 3+ (${bd.tier3plus.winRate}%) → Fokus hanya di zona Tier 1-2`
      );
    }
    if (bd.londonNY.winRate > bd.asian.winRate + 10 && bd.asian.trades > 3) {
      recommendations.push(
        `Win rate London/NY session (${bd.londonNY.winRate}%) lebih tinggi dari Asian session (${bd.asian.winRate}%) → Hindari entry jam 00.00-13.00 WIB`
      );
    }
    if (bd.highVolume.winRate > bd.lowVolume.winRate + 10 && bd.lowVolume.trades > 3) {
      recommendations.push(
        `Win rate volume breakout tinggi (${bd.highVolume.winRate}%) jauh lebih baik → Skip sinyal dengan volume ratio < 2x`
      );
    }
    if (recommendations.length === 0) {
      recommendations.push('Tingkatkan ukuran sampel — perlu lebih banyak trade untuk analisa yang akurat');
    }
  }

  return { totalTrades: total, wins, losses: total - wins, winRate, avgRR, breakdown, lossCauses, recommendations };
}

function simulateTrade(
  entryPrice: number,
  stopLoss: number,
  takeProfit1: number,
  takeProfit2: number,
  bias: 'bullish' | 'bearish',
  futureHighs: number[],
  futureLows: number[],
  maxCandles: number = 48 // max 48 candle H1 = 2 hari
): { result: 'TP1' | 'TP2' | 'SL' | 'EXPIRED'; exitPrice: number; rr: number } {
  const risk = Math.abs(entryPrice - stopLoss);
  const dir = bias === 'bullish' ? 1 : -1;
  const limit = Math.min(futureHighs.length, maxCandles);

  for (let i = 0; i < limit; i++) {
    const high = futureHighs[i];
    const low = futureLows[i];

    if (bias === 'bullish') {
      if (low <= stopLoss) return { result: 'SL', exitPrice: stopLoss, rr: -1 };
      if (high >= takeProfit2 && takeProfit2 > 0) return { result: 'TP2', exitPrice: takeProfit2, rr: Math.round(((takeProfit2 - entryPrice) / risk) * 10) / 10 };
      if (high >= takeProfit1) return { result: 'TP1', exitPrice: takeProfit1, rr: Math.round(((takeProfit1 - entryPrice) / risk) * 10) / 10 };
    } else {
      if (high >= stopLoss) return { result: 'SL', exitPrice: stopLoss, rr: -1 };
      if (low <= takeProfit2 && takeProfit2 > 0) return { result: 'TP2', exitPrice: takeProfit2, rr: Math.round(((entryPrice - takeProfit2) / risk) * 10) / 10 };
      if (low <= takeProfit1) return { result: 'TP1', exitPrice: takeProfit1, rr: Math.round(((entryPrice - takeProfit1) / risk) * 10) / 10 };
    }
  }
  return { result: 'EXPIRED', exitPrice: futureHighs[limit - 1] ?? entryPrice, rr: 0 };
}

function getPeriodLimit(period: '1m' | '3m' | '6m' | '1y'): number {
  // H1 candles needed
  const map = { '1m': 720, '3m': 2160, '6m': 4320, '1y': 8640 };
  return map[period];
}

export async function runBacktest(
  symbol: string,
  period: '1m' | '3m' | '6m' | '1y',
  menu: 'sniper' | 'breakout' | 'both'
): Promise<BacktestResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';

  const periodLabel = { '1m': '1 Bulan', '3m': '3 Bulan', '6m': '6 Bulan', '1y': '1 Tahun' }[period];
  const limit = getPeriodLimit(period);

  // Fetch data historis H4 dan H1 dalam batch (max 1500 per request)
  async function fetchHistorical(interval: string, totalLimit: number): Promise<KlineData> {
    const batchSize = 1000;
    const batches = Math.ceil(totalLimit / batchSize);
    const allHighs: number[] = [];
    const allLows: number[] = [];
    const allCloses: number[] = [];
    const allOpens: number[] = [];
    const allVolumes: number[] = [];
    const allTimes: number[] = [];

    // Fetch dari yang paling lama dulu
    let endTime: number | undefined;
    for (let b = batches - 1; b >= 0; b--) {
      const url = endTime
        ? `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${batchSize}&endTime=${endTime}`
        : `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${batchSize}`;
      const res = await fetch(url);
      if (!res.ok) break;
      const data: number[][] = await res.json();
      if (data.length === 0) break;
      endTime = data[0][0] - 1;

      // Prepend ke array (dari lama ke baru)
      for (let i = data.length - 1; i >= 0; i--) {
        allTimes.unshift(data[i][0]);
        allOpens.unshift(parseFloat(String(data[i][1])));
        allHighs.unshift(parseFloat(String(data[i][2])));
        allLows.unshift(parseFloat(String(data[i][3])));
        allCloses.unshift(parseFloat(String(data[i][4])));
        allVolumes.unshift(parseFloat(String(data[i][5])));
      }
    }

    return {
      highs: allHighs.slice(-totalLimit),
      lows: allLows.slice(-totalLimit),
      closes: allCloses.slice(-totalLimit),
      opens: allOpens.slice(-totalLimit),
      volumes: allVolumes.slice(-totalLimit),
      times: allTimes.slice(-totalLimit),
    };
  }

  // Fetch semua data yang diperlukan
  const [h4Data, h1Data, m15Data] = await Promise.all([
    fetchHistorical('4h', Math.ceil(limit / 4)),
    fetchHistorical('1h', limit),
    fetchHistorical('15m', limit * 4),
  ]);

  const result: BacktestResult = {
    symbol,
    period: periodLabel,
    totalCandles: h1Data.closes.length,
    timestamp,
  };

  // ─── BACKTEST MENU 2 (SNIPER) ─────────────────────────────────────────────
  if (menu === 'sniper' || menu === 'both') {
    const sniperTrades: BacktestTrade[] = [];
    const MIN_CANDLES = 50;
    const STEP = 4; // cek setiap 4 jam (tidak perlu tiap candle)

    for (let i = MIN_CANDLES; i < h1Data.closes.length - 50; i += STEP) {
      // Data sampai candle i
      const h4Slice = {
        highs: h4Data.highs.slice(0, Math.floor(i / 4)),
        lows: h4Data.lows.slice(0, Math.floor(i / 4)),
        closes: h4Data.closes.slice(0, Math.floor(i / 4)),
        opens: h4Data.opens.slice(0, Math.floor(i / 4)),
        volumes: h4Data.volumes.slice(0, Math.floor(i / 4)),
      };
      const h1Slice = {
        highs: h1Data.highs.slice(0, i),
        lows: h1Data.lows.slice(0, i),
        closes: h1Data.closes.slice(0, i),
        opens: h1Data.opens.slice(0, i),
        volumes: h1Data.volumes.slice(0, i),
      };
      const m15Slice = {
        highs: m15Data.highs.slice(0, i * 4),
        lows: m15Data.lows.slice(0, i * 4),
        closes: m15Data.closes.slice(0, i * 4),
        opens: m15Data.opens.slice(0, i * 4),
        volumes: m15Data.volumes.slice(0, i * 4),
      };

      if (h4Slice.closes.length < 10) continue;

      // Step 1: H4 trend
      const structH4 = analyzePriceActionStructure(h4Slice.highs, h4Slice.lows, h4Slice.closes);
      if (structH4.bias === 'ranging') continue;
      const bias = structH4.bias as 'bullish' | 'bearish';

      // Step 2: H1 zona — gunakan selectBestZoneH1 dengan existing functions
      const currentPrice = h1Slice.closes[h1Slice.closes.length - 1];
      const h1OBs = detectOrderBlocksH1(h1Slice.opens, h1Slice.highs, h1Slice.lows, h1Slice.closes, bias);
      const h1FVGs = detectFVGH1(h1Slice.highs, h1Slice.lows, bias);
      const h1SRLevels = detectSRLevels(h1Slice.highs, h1Slice.lows, h1Slice.closes);
      const h1SnDZones = detectSnDZones(h1Slice.opens, h1Slice.highs, h1Slice.lows, h1Slice.closes);
      const h1Fib = calcFibonacci(h1Slice.highs, h1Slice.lows, h1Slice.closes);
      const selectedZone = selectBestZoneH1(h1OBs, h1FVGs, [], h1SRLevels, h1SnDZones, h1Fib, bias, currentPrice);
      if (!selectedZone) continue;

      // Skip kalau CHoCH H1 terbentuk (konflik)
      const chochH1 = detectCHoCH(h1Slice.highs, h1Slice.lows, h1Slice.closes, bias);
      if (chochH1) continue;

      // Cek apakah harga approaching zona
      const zoneBuffer = (selectedZone.high - selectedZone.low) * 2;
      const nearZone = bias === 'bullish'
        ? currentPrice >= selectedZone.low - zoneBuffer && currentPrice <= selectedZone.high + zoneBuffer
        : currentPrice <= selectedZone.high + zoneBuffer && currentPrice >= selectedZone.low - zoneBuffer;
      if (!nearZone) continue;

      // Kondisi konfirmasi
      const choch15M = detectCHoCH15M(m15Slice.highs, m15Slice.lows, m15Slice.closes, bias);
      const rejection15M = checkRejection15M(
        { low: selectedZone.low, high: selectedZone.high, entryPrice: selectedZone.entryPrice, zoneType: selectedZone.zoneType, refined: false },
        m15Slice.opens, m15Slice.highs, m15Slice.lows, m15Slice.closes, bias, m15Slice.volumes
      );

      // Pattern konfirmasi
      const validPatterns = bias === 'bullish'
        ? ['Bull Flag', 'Ascending Triangle', 'Double Bottom', 'Inverse H&S', 'Falling Wedge', 'Pennant']
        : ['Bear Flag', 'Descending Triangle', 'Double Top', 'Head & Shoulders', 'Rising Wedge', 'Pennant'];
      const h1Patterns = [
        detectBullFlag(h1Slice.highs, h1Slice.lows, h1Slice.closes, h1Slice.volumes),
        detectBearFlag(h1Slice.highs, h1Slice.lows, h1Slice.closes, h1Slice.volumes),
        detectAscendingTriangle(h1Slice.highs, h1Slice.lows, h1Slice.closes),
        detectDescendingTriangle(h1Slice.highs, h1Slice.lows, h1Slice.closes),
        detectDoubleBottom(h1Slice.highs, h1Slice.lows, h1Slice.closes),
        detectDoubleTop(h1Slice.highs, h1Slice.lows, h1Slice.closes),
        detectInverseHS(h1Slice.highs, h1Slice.lows, h1Slice.closes),
        detectHeadAndShoulders(h1Slice.highs, h1Slice.lows, h1Slice.closes),
        detectFallingWedge(h1Slice.highs, h1Slice.lows, h1Slice.closes),
        detectRisingWedge(h1Slice.highs, h1Slice.lows, h1Slice.closes),
        detectPennant(h1Slice.highs, h1Slice.lows, h1Slice.closes, h1Slice.volumes),
      ].filter(p => p && validPatterns.includes(p!.name));
      const hasPattern = h1Patterns.length > 0;

      // Entry & SL/TP
      const entryPrice = rejection15M.confirmed ? rejection15M.entryPrice : selectedZone.entryPrice;
      const atrH1 = calcATR(h1Slice.highs, h1Slice.lows, h1Slice.closes);
      const swingHighs = findSwingHighs(h1Slice.highs, 20);
      const swingLows = findSwingLows(h1Slice.lows, 20);

      let stopLoss: number;
      if (bias === 'bullish') {
        const relevantLows = swingLows.filter(l => l < entryPrice);
        const nearestLow = relevantLows.length > 0 ? Math.max(...relevantLows) : Math.min(...h1Slice.lows.slice(-20));
        stopLoss = nearestLow - atrH1 * 0.2;
      } else {
        const relevantHighs = swingHighs.filter(h => h > entryPrice);
        const nearestHigh = relevantHighs.length > 0 ? Math.min(...relevantHighs) : Math.max(...h1Slice.highs.slice(-20));
        stopLoss = nearestHigh + atrH1 * 0.2;
      }

      const risk = Math.abs(entryPrice - stopLoss);
      if (risk <= 0) continue;
      const dir = bias === 'bullish' ? 1 : -1;
      const takeProfit1 = entryPrice + risk * 1.5 * dir;
      const takeProfit2 = entryPrice + risk * 3.0 * dir;

      // Simulasi trade dengan candle H1 ke depan
      const futureHighs = h1Data.highs.slice(i, i + 48);
      const futureLows = h1Data.lows.slice(i, i + 48);
      const sim = simulateTrade(entryPrice, stopLoss, takeProfit1, takeProfit2, bias, futureHighs, futureLows);

      const entryTime = h1Data.times ? h1Data.times[i] : Date.now();
      const hour = getWIBHour(entryTime);

      sniperTrades.push({
        menu: 'sniper',
        entryTime,
        entryPrice,
        stopLoss,
        takeProfit1,
        takeProfit2,
        bias,
        result: sim.result,
        exitPrice: sim.exitPrice,
        rr: sim.rr,
        hasChoch15M: choch15M.detected,
        hasRejection15M: rejection15M.confirmed,
        hasPattern,
        patternConfidence: hasPattern ? 'MEDIUM' : 'NONE',
        zoneTier: 1, // simplified
        hour,
      });
    }

    result.sniperResult = { ...buildAnalysis(sniperTrades), trades: sniperTrades };
  }

  // ─── BACKTEST MENU 4 (BREAKOUT) ───────────────────────────────────────────
  if (menu === 'breakout' || menu === 'both') {
    const breakoutTrades: BacktestTrade[] = [];
    const MIN_CANDLES = 50;
    const STEP = 4;

    for (let i = MIN_CANDLES; i < h1Data.closes.length - 50; i += STEP) {
      const h4Slice = {
        highs: h4Data.highs.slice(0, Math.floor(i / 4)),
        lows: h4Data.lows.slice(0, Math.floor(i / 4)),
        closes: h4Data.closes.slice(0, Math.floor(i / 4)),
        opens: h4Data.opens.slice(0, Math.floor(i / 4)),
        volumes: h4Data.volumes.slice(0, Math.floor(i / 4)),
      };
      const h1Slice = {
        highs: h1Data.highs.slice(0, i),
        lows: h1Data.lows.slice(0, i),
        closes: h1Data.closes.slice(0, i),
        opens: h1Data.opens.slice(0, i),
        volumes: h1Data.volumes.slice(0, i),
      };
      const m15Slice = {
        highs: m15Data.highs.slice(0, i * 4),
        lows: m15Data.lows.slice(0, i * 4),
        closes: m15Data.closes.slice(0, i * 4),
        opens: m15Data.opens.slice(0, i * 4),
        volumes: m15Data.volumes.slice(0, i * 4),
      };

      if (h4Slice.closes.length < 10) continue;

      const structH4 = analyzePriceActionStructure(h4Slice.highs, h4Slice.lows, h4Slice.closes);
      if (structH4.bias === 'ranging') continue;
      const bias = structH4.bias as 'bullish' | 'bearish';

      // Deteksi breakout H1
      const breakout = detectBreakoutH1(h1Slice.opens, h1Slice.highs, h1Slice.lows, h1Slice.closes, h1Slice.volumes, bias);
      if (!breakout) continue;

      const currentPrice = h1Slice.closes[h1Slice.closes.length - 1];
      const atrH1 = calcATR(h1Slice.highs, h1Slice.lows, h1Slice.closes);
      const atrH2 = calcATR(m15Slice.highs, m15Slice.lows, m15Slice.closes);

      // Cari zona retest
      const retestZone = findRetestZone(
        h1Slice.highs, h1Slice.lows, h1Slice.closes, h1Slice.opens, h1Slice.volumes,
        m15Slice.highs, m15Slice.lows, m15Slice.closes,
        breakout, currentPrice, atrH1, bias, atrH2
      );
      if (!retestZone) continue;

      // Pattern konfirmasi
      const validPatterns = bias === 'bullish'
        ? ['Bull Flag', 'Ascending Triangle', 'Double Bottom', 'Inverse H&S', 'Falling Wedge', 'Pennant']
        : ['Bear Flag', 'Descending Triangle', 'Double Top', 'Head & Shoulders', 'Rising Wedge', 'Pennant'];
      const confirmPatterns = [
        detectBullFlag(h1Slice.highs, h1Slice.lows, h1Slice.closes, h1Slice.volumes),
        detectBearFlag(h1Slice.highs, h1Slice.lows, h1Slice.closes, h1Slice.volumes),
        detectAscendingTriangle(h1Slice.highs, h1Slice.lows, h1Slice.closes),
        detectDescendingTriangle(h1Slice.highs, h1Slice.lows, h1Slice.closes),
        detectDoubleBottom(h1Slice.highs, h1Slice.lows, h1Slice.closes),
        detectDoubleTop(h1Slice.highs, h1Slice.lows, h1Slice.closes),
      ].filter(p => p && validPatterns.includes(p!.name));
      const hasPattern = confirmPatterns.length > 0;
      const patternCount = confirmPatterns.length;
      const patternConfidence = patternCount >= 2 ? 'HIGH' : patternCount === 1 ? 'MEDIUM' : 'NONE';

      // Entry
      const entryPrice = retestZone.price;
      const swingHighs = findSwingHighs(h1Slice.highs, 20);
      const swingLows = findSwingLows(h1Slice.lows, 20);
      const m4Buffer = atrH1 * 0.2;

      let stopLoss: number;
      if (bias === 'bullish') {
        const relevantLows = swingLows.filter(l => l < entryPrice);
        const nearestLow = relevantLows.length > 0 ? Math.max(...relevantLows) : Math.min(...h1Slice.lows.slice(-20));
        stopLoss = nearestLow - m4Buffer;
      } else {
        const relevantHighs = swingHighs.filter(h => h > entryPrice);
        const nearestHigh = relevantHighs.length > 0 ? Math.min(...relevantHighs) : Math.max(...h1Slice.highs.slice(-20));
        stopLoss = nearestHigh + m4Buffer;
      }

      const risk = Math.abs(entryPrice - stopLoss);
      if (risk <= 0) continue;
      const dir = bias === 'bullish' ? 1 : -1;
      const takeProfit1 = entryPrice + risk * 1.5 * dir;
      const takeProfit2 = entryPrice + risk * 3.0 * dir;

      const futureHighs = h1Data.highs.slice(i, i + 48);
      const futureLows = h1Data.lows.slice(i, i + 48);
      const sim = simulateTrade(entryPrice, stopLoss, takeProfit1, takeProfit2, bias, futureHighs, futureLows);

      const entryTime = h1Data.times ? h1Data.times[i] : Date.now();
      const hour = getWIBHour(entryTime);

      breakoutTrades.push({
        menu: 'breakout',
        entryTime,
        entryPrice,
        stopLoss,
        takeProfit1,
        takeProfit2,
        bias,
        result: sim.result,
        exitPrice: sim.exitPrice,
        rr: sim.rr,
        hasChoch15M: false,
        hasRejection15M: false,
        hasPattern,
        patternConfidence,
        zoneTier: retestZone.tier,
        breakoutType: breakout.type,
        volumeRatio: breakout.volumeRatio,
        hour,
      });
    }

    result.breakoutResult = { ...buildAnalysis(breakoutTrades), trades: breakoutTrades };
  }

  // Comparison
  if (result.sniperResult && result.breakoutResult) {
    const sWR = result.sniperResult.winRate;
    const bWR = result.breakoutResult.winRate;
    const better = sWR > bWR + 5 ? 'sniper' : bWR > sWR + 5 ? 'breakout' : 'equal';

    // Cari filter paling impactful dari semua trades
    const allBreakdowns = [result.sniperResult.breakdown, result.breakoutResult.breakdown];
    let maxDiff = 0;
    let mostImpactful = 'CHoCH 15M';
    const checks = [
      ['withChoch15M', 'withoutChoch15M', 'CHoCH 15M'],
      ['withRejection15M', 'withoutRejection15M', 'Rejection 15M'],
      ['withPattern', 'withoutPattern', 'Pattern Konfirmasi'],
      ['tier1to2', 'tier3plus', 'Zona Tier 1-2'],
      ['londonNY', 'asian', 'Sesi London/NY'],
    ] as const;

    for (const [with_, without_, label] of checks) {
      for (const bd of allBreakdowns) {
        const diff = Math.abs((bd as any)[with_].winRate - (bd as any)[without_].winRate);
        if (diff > maxDiff) { maxDiff = diff; mostImpactful = label; }
      }
    }

    result.comparison = {
      better,
      sniperWinRate: sWR,
      breakoutWinRate: bWR,
      mostImpactfulFilter: mostImpactful,
    };
  }

  return result;
}