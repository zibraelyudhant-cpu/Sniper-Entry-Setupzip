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
  volumeTrend: "increasing" | "decreasing" | "neutral";
  oiChange: number;
  fundingRate: number;
}

export interface SniperResult {
  status: "ready" | "no_trend" | "no_zone" | "skip_conditions" | "error";
  message: string;
  symbol: string;
  currentPrice: number;
  timestamp: number;
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
  volumeTrend?: string;
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
  atrH1: number,
  atrH4: number,
  bias: "bullish" | "bearish"
): SniperLevels {
  let stopLoss: number;

  if (bias === "bullish") {
    // SL = zone_low - ATR_H1 * 0.5
    const rawSl = refinedZone.low - atrH1 * 0.5;
    // Minimal SL = 1x ATR H1 from entry
    const minSl = entryPrice - atrH1;
    stopLoss = Math.min(rawSl, minSl);
  } else {
    const rawSl = refinedZone.high + atrH1 * 0.5;
    const minSl = entryPrice + atrH1;
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
  const setupValidHours = Math.round((atrH4 / atrH1) * 2);
  const distanceToEntry = Math.abs(entryPrice - 0); // placeholder - calculated per call
  const estimatedHitHours = Math.round((Math.abs(entryPrice) / atrH1) * 1);
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

export async function checkSkipConditions(
  symbol: string,
  bias: "bullish" | "bearish",
  h1Closes: number[],
  h1Highs: number[],
  h1Lows: number[],
  h1Volumes: number[],
  h4Volumes: number[]
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

  // 2. Volume trend
  const recentVols = h1Volumes.slice(-5);
  const prevVols = h1Volumes.slice(-10, -5);
  const avgRecentVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
  const avgPrevVol = prevVols.reduce((a, b) => a + b, 0) / prevVols.length;

  let volumeTrend: "increasing" | "decreasing" | "neutral" = "neutral";
  if (avgRecentVol > avgPrevVol * 1.1) volumeTrend = "increasing";
  else if (avgRecentVol < avgPrevVol * 0.9) {
    volumeTrend = "decreasing";
    reasons.push("Volume H1 menurun saat harga bergerak searah tren");
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

  return { shouldSkip, reasons, rsi, rsiDivergence, volumeTrend, oiChange, fundingRate };
}

// ─── Main Analysis Function ───────────────────────────────────────────────────

export async function analyzeSniperEntry(symbol: string): Promise<SniperResult> {
  const timestamp = Date.now();

  try {
    // Fetch all data in parallel
    const [h4, h1, m15, m5, currentTickerRes] = await Promise.all([
      fetchKlines(symbol, "4h", 100),
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
      h1.closes, h1.highs, h1.lows, h1.volumes, h4.volumes
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
        volumeTrend: skipConds.volumeTrend,
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
    const atrH4 = calcATR(h4.highs, h4.lows, h4.closes);

    const sniperLevels = calcSniperLevels(
      confirmation.entryPrice, refinedZone, atrH1, atrH4, bias
    );

    // Estimate time to hit entry
    const distanceToEntry = Math.abs(currentPrice - sniperLevels.entryPrice);
    const estimatedHitHours = Math.max(1, Math.round(distanceToEntry / atrH1));

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
      volumeTrend: skipConds.volumeTrend,
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
