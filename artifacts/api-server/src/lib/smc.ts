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
}

export interface FVG {
  high: number;
  low: number;
  mid: number;
  index: number;
  type: "bullish" | "bearish";
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

export interface SkipConditions {
  shouldSkip: boolean;
  reasons: string[];
  rsi: number;
  rsiDivergence: boolean;
  chochDetected: boolean;
  oiChange: number;
  fundingRate: number;
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
  fundingRate?: number;
  setupValidHours?: number;
  estimatedHitHours?: number;
  expiryHours?: number;
  skipReasons?: string[];
  reasoning?: string;
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
        obs.push({
          high: highs[i],
          low: lows[i],
          mid: (highs[i] + lows[i]) / 2,
          index: i,
          type: "bullish",
          strength,
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
        obs.push({
          high: highs[i],
          low: lows[i],
          mid: (highs[i] + lows[i]) / 2,
          index: i,
          type: "bearish",
          strength,
        });
      }
    }
  }

  // Sort by strength and recency, return top 5
  return obs
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
        fvgs.push({ high, low, mid: (high + low) / 2, index: i, type: "bullish" });
      }
    } else {
      // Bearish FVG: gap down — candle[i-1].low > candle[i+1].high
      if (lows[i - 1] > highs[i + 1]) {
        const high = lows[i - 1];
        const low = highs[i + 1];
        fvgs.push({ high, low, mid: (high + low) / 2, index: i, type: "bearish" });
      }
    }
  }

  return fvgs.slice(-5);
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
    bias: "bullish" | "bearish"
): SniperLevels {
    let stopLoss: number;

    if (bias === "bullish") {
      // SL = zone_low - ATR_H2 * 0.5 (lebih longgar dari H1, tahan stop hunt)
      const rawSl = refinedZone.low - atrSl * 0.5;
      // Minimal SL = 1x ATR H2 dari entry
      const minSl = entryPrice - atrSl;
      stopLoss = Math.min(rawSl, minSl);
    } else {
      const rawSl = refinedZone.high + atrSl * 0.5;
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

export async function checkSkipConditions(
  symbol: string,
  bias: "bullish" | "bearish",
  h1Closes: number[],
  h1Highs: number[],
  h1Lows: number[],
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

  // 3. OI (approximated from volume delta)
  let oiChange = 0;
  try {
    const oiUrl = `${BINANCE_FUTURES_BASE}/fapi/v1/openInterest?symbol=${symbol}`;
    const oiHistUrl = `${BINANCE_FUTURES_BASE}/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=5`;
    const [oiRes, oiHistRes] = await Promise.all([fetch(oiUrl), fetch(oiHistUrl)]);
    if (oiRes.ok && oiHistRes.ok) {
      const oiHist: Array<{ sumOpenInterest: string }> = await oiHistRes.json();
      if (oiHist.length >= 2) {
        const latest = parseFloat(oiHist[oiHist.length - 1].sumOpenInterest);
        const prev = parseFloat(oiHist[0].sumOpenInterest);
        oiChange = ((latest - prev) / prev) * 100;
        if (bias === "bullish" && oiChange < -2) {
          reasons.push(`OI turun ${oiChange.toFixed(1)}% saat harga naik (kemungkinan short covering)`);
          shouldSkip = true;
        } else if (bias === "bearish" && oiChange < -2) {
          reasons.push(`OI turun ${oiChange.toFixed(1)}% saat harga turun (kemungkinan long liquidation)`);
          shouldSkip = true;
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

  return { shouldSkip, reasons, rsi, rsiDivergence, chochDetected, oiChange, fundingRate };
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
      h1.closes, h1.highs, h1.lows
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

    // STEP 4: Confirm entry at 5M
    const confirmation = checkEntryConfirmation5M(
      refinedZone, m5.opens, m5.highs, m5.lows, m5.closes, bias
    );

    // STEP 5: Calculate SL/TP
    const atrH1 = calcATR(h1.highs, h1.lows, h1.closes);
    const atrH2 = calcATR(h2.highs, h2.lows, h2.closes);
    const atrH4 = calcATR(h4.highs, h4.lows, h4.closes);

    const sniperLevels = calcSniperLevels(
      confirmation.entryPrice, refinedZone, atrH2, atrH4, bias
    );

    // Estimate time to hit entry
    const distanceToEntry = Math.abs(currentPrice - sniperLevels.entryPrice);
    const estimatedHitHours = Math.max(1, Math.round(distanceToEntry / atrH2));

    // Build reasoning
    const reasoning = [
      `Entry di ${selectedZone.zoneType} (${selectedZone.low.toFixed(2)}-${selectedZone.high.toFixed(2)}).`,
      refinedZone.refined ? `Direfine menggunakan ${refinedZone.zoneType}.` : "Zona H1 digunakan langsung.",
      confirmation.confirmed
        ? `Konfirmasi 5M: ${confirmation.candleType}.`
        : "Belum ada konfirmasi 5M — gunakan limit order pada zona.",
      `SL di ${bias === "bullish" ? "bawah" : "atas"} zone + 0.5x ATR H1 sebagai buffer.`,
      `TP1 dan TP2 berdasarkan R:R 1:1.5 dan 1:3 dari jarak entry ke SL.`,
    ].join(" ");

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
      entryConfirmed: confirmation.confirmed,
      confirmationCandle: confirmation.candleType,
      rsi: skipConds.rsi,
      rsiDivergence: skipConds.rsiDivergence,
      chochDetected: skipConds.chochDetected,
      oiChange: skipConds.oiChange,
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
  bias: 'bullish' | 'bearish'
): RetestZone | null {
  const candidates: RetestZone[] = [];

  // TIER 1: Role Reversal
  const rrPrice = breakout.brokenLevel;
  candidates.push({
    price: rrPrice,
    zoneLow: rrPrice - atrH1 * 0.3,
    zoneHigh: rrPrice + atrH1 * 0.3,
    type: 'Role Reversal',
    tier: 1,
    reason: `Level ${rrPrice.toFixed(4)} ditembus — jadi ${bias === 'bullish' ? 'support' : 'resistance'} baru`,
    distancePct: Math.abs(currentPrice - rrPrice) / currentPrice * 100,
    isReached: bias === 'bullish'
      ? currentPrice <= rrPrice + atrH1 * 0.3
      : currentPrice >= rrPrice - atrH1 * 0.3,
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
    const [h4, h1, m15, tickerRes, frRes] = await Promise.all([
      fetchKlines(symbol, '4h', 100),
      fetchKlines(symbol, '1h', 100),
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

    const breakout = detectBreakoutH1(h1.opens, h1.highs, h1.lows, h1.closes, h1.volumes, bias);
    if (!breakout)
      return { status: 'no_breakout', symbol, bias, currentPrice, timestamp, message: 'Tidak ada breakout valid di H1' };

    const atrH1 = calcATR(h1.highs, h1.lows, h1.closes);
    const atr15m = calcATR(m15.highs, m15.lows, m15.closes);

    const retestZone = findRetestZone(
      h1.highs, h1.lows, h1.closes, h1.opens, h1.volumes,
      m15.highs, m15.lows, m15.closes,
      breakout, currentPrice, atrH1, bias
    );

    if (!retestZone)
      return { status: 'no_zone', symbol, bias, currentPrice, timestamp,
        message: 'Tidak ada zona retest valid',
        breakoutType: breakout.type, brokenLevel: breakout.brokenLevel, volumeRatio: breakout.volumeRatio };

    const inZone = retestZone.isReached;
    let retestConfirmed = false;
    if (inZone) {
      const last = m15.closes.length - 1;
      for (let i = last; i >= Math.max(0, last - 2); i--) {
        const body = Math.abs(m15.closes[i] - m15.opens[i]);
        const wick = bias === 'bullish'
          ? Math.min(m15.opens[i], m15.closes[i]) - m15.lows[i]
          : m15.highs[i] - Math.max(m15.opens[i], m15.closes[i]);
        if (body > 0 && wick > body * 1.5) { retestConfirmed = true; break; }
      }
    }

    const entryPrice = retestZone.price;
    const dir = bias === 'bullish' ? 1 : -1;
    const rawSl = bias === 'bullish'
      ? retestZone.zoneLow - atr15m * 0.5
      : retestZone.zoneHigh + atr15m * 0.5;
    const minSl = bias === 'bullish' ? entryPrice - atr15m : entryPrice + atr15m;
    const stopLoss = bias === 'bullish' ? Math.min(rawSl, minSl) : Math.max(rawSl, minSl);
    const risk = Math.abs(entryPrice - stopLoss);
    const takeProfit1 = entryPrice + risk * 1.5 * dir;
    const takeProfit2 = entryPrice + risk * 3.0 * dir;
    const takeProfit3 = breakout.volumeRatio >= 2.0 ? entryPrice + risk * 5.0 * dir : undefined;

    return {
      status: inZone && retestConfirmed ? 'ready' : inZone ? 'in_zone' : 'approaching',
      symbol, bias, currentPrice, timestamp,
      breakoutType: breakout.type, brokenLevel: breakout.brokenLevel, volumeRatio: breakout.volumeRatio,
      retestZone, retestConfirmed,
      entryPrice, stopLoss, takeProfit1, takeProfit2, takeProfit3,
      fundingRate, setupExpiryHours: 8,
      reason: `${retestZone.type} (Tier ${retestZone.tier}) — ${retestZone.reason}`,
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
