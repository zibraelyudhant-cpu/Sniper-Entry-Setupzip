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
  strength: "strong" | "moderate" | "weak" | "neutral";
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
  // Multi-TF Confluence
  h4ConfluenceConfirmed?: boolean;
  h4ConfluenceStrength?: string;
  h4ConfluenceDesc?: string;
}

// ─── Data Fetching ────────────────────────────────────────────────────────────

// Cache klines untuk kurangi request ke Binance
const klinesCache = new Map<string, { data: KlineData; ts: number }>();
const KLINES_CACHE_MS = 5 * 60 * 1000; // 5 menit

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number
): Promise<KlineData> {
  const cacheKey = `${symbol}_${interval}_${limit}`;
  const cached = klinesCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < KLINES_CACHE_MS) return cached.data;

  const url = `${BINANCE_FUTURES_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

  // Retry max 2x dengan delay kalau kena rate limit (418/429)
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    if (res.status === 418 || res.status === 429) {
      // Rate limited — tunggu sebentar lalu retry
      await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Klines fetch failed: ${res.status}`);
    const data: unknown[][] = await res.json();
    const result: KlineData = {
      opens: data.map((k) => parseFloat(k[1] as string)),
      highs: data.map((k) => parseFloat(k[2] as string)),
      lows: data.map((k) => parseFloat(k[3] as string)),
      closes: data.map((k) => parseFloat(k[4] as string)),
      volumes: data.map((k) => parseFloat(k[5] as string)),
      times: data.map((k) => k[0] as number),
    };
    klinesCache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  }
  throw new Error(`Klines fetch failed after retries: rate limited`);
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
    const diff = closes[i]! - closes[i - 1]!;
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  let avgGain = gains.reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.reduce((a, b) => a + b, 0) / period;
  const recentCloses = closes.slice(period);
  const prevCloses = closes.slice(period - 1, -1);
  for (let i = 0; i < recentCloses.length; i++) {
    const diff = recentCloses[i]! - prevCloses[i]!;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * RSI dihitung untuk SETIAP candle (bukan cuma nilai terakhir).
 * Perlu buat cek divergence yang presisi — bandingin RSI tepat di titik swing high/low,
 * bukan cuma "RSI sekarang vs RSI beberapa candle lalu" yang gak akurat lokasinya.
 */
function calcRSISeries(closes: number[], period = 14): number[] {
  const series: number[] = new Array(closes.length).fill(50);
  if (closes.length < period + 1) return series;
  for (let end = period + 1; end <= closes.length; end++) {
    series[end - 1] = calcRSI(closes.slice(0, end), period);
  }
  return series;
}

/**
 * Hitung Bollinger Bands untuk candle terakhir.
 * Return { upper, middle, lower, bandwidth } untuk candle terakhir.
 */
function calcBB(closes: number[], period = 20, stdDevMult = 2): {
  upper: number; middle: number; lower: number; bandwidth: number;
} {
  if (closes.length < period) {
    const last = closes[closes.length - 1] ?? 0;
    return { upper: last, middle: last, lower: last, bandwidth: 0 };
  }
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = mean + stdDevMult * stdDev;
  const lower = mean - stdDevMult * stdDev;
  const bandwidth = mean > 0 ? (upper - lower) / mean : 0;
  return { upper, middle: mean, lower, bandwidth };
}

/**
 * Deteksi BB Squeeze aktif di candle terakhir.
 * Squeeze = bandwidth sekarang < 50% dari rata-rata bandwidth 20 candle terakhir.
 * Return { isSqueezing, currentBW, avgBW, ratio } 
 */
function detectBBSqueeze(closes: number[], period = 20, lookback = 20): {
  isSqueezing: boolean;
  currentBW: number;
  avgBW: number;
  ratio: number;
} {
  if (closes.length < period + lookback) {
    return { isSqueezing: false, currentBW: 0, avgBW: 0, ratio: 1 };
  }
  // Hitung bandwidth untuk `lookback` candle terakhir
  const bwHistory: number[] = [];
  for (let i = lookback; i >= 0; i--) {
    const slice = closes.slice(-(period + i), closes.length - i || undefined);
    const { bandwidth } = calcBB(slice, period);
    bwHistory.push(bandwidth);
  }
  const currentBW = bwHistory[bwHistory.length - 1] ?? 0;
  const historicalBWs = bwHistory.slice(0, -1);
  const avgBW = historicalBWs.reduce((a, b) => a + b, 0) / historicalBWs.length;
  const ratio = avgBW > 0 ? currentBW / avgBW : 1;
  // Squeeze = lebar band sekarang < 50% dari rata-rata historis
  const isSqueezing = ratio < 0.5;
  return { isSqueezing, currentBW, avgBW, ratio };
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

// ─── ZigZag — filter noise buat penentuan trend yang lebih presisi ───────────

export interface ZigZagPoint {
  idx: number;
  value: number;
  type: 'high' | 'low';
}

/**
 * ZigZag klasik: nyambungin swing high/low yang BENERAN signifikan,
 * ngabaikan gerakan kecil di bawah threshold%. Beda dari findSwingHighs/Lows
 * yang fixed left-right bars — ZigZag pakai threshold pergerakan harga (%),
 * jadi lebih adaptif ke volatilitas coin yang beda-beda.
 */
export function calcZigZag(highs: number[], lows: number[], thresholdPct: number): ZigZagPoint[] {
  const points: ZigZagPoint[] = [];
  const n = highs.length;
  if (n < 2) return points;

  let direction: 'up' | 'down' | 'unknown' = 'unknown';
  let pendingIdx = 0;
  let pendingHigh = highs[0]!;
  let pendingLow = lows[0]!;

  for (let i = 1; i < n; i++) {
    const h = highs[i]!;
    const l = lows[i]!;

    if (direction === 'unknown') {
      const upMove = pendingLow > 0 ? ((h - pendingLow) / pendingLow) * 100 : 0;
      const downMove = pendingHigh > 0 ? ((pendingHigh - l) / pendingHigh) * 100 : 0;
      if (upMove >= thresholdPct && upMove >= downMove) {
        points.push({ idx: pendingIdx, value: pendingLow, type: 'low' });
        direction = 'up';
        pendingHigh = h; pendingIdx = i;
      } else if (downMove >= thresholdPct) {
        points.push({ idx: pendingIdx, value: pendingHigh, type: 'high' });
        direction = 'down';
        pendingLow = l; pendingIdx = i;
      } else {
        if (h > pendingHigh) pendingHigh = h;
        if (l < pendingLow) pendingLow = l;
      }
    } else if (direction === 'up') {
      if (h > pendingHigh) {
        pendingHigh = h; pendingIdx = i;
      } else {
        const retrace = pendingHigh > 0 ? ((pendingHigh - l) / pendingHigh) * 100 : 0;
        if (retrace >= thresholdPct) {
          points.push({ idx: pendingIdx, value: pendingHigh, type: 'high' });
          direction = 'down';
          pendingLow = l; pendingIdx = i;
        }
      }
    } else {
      if (l < pendingLow) {
        pendingLow = l; pendingIdx = i;
      } else {
        const retrace = pendingLow > 0 ? ((h - pendingLow) / pendingLow) * 100 : 0;
        if (retrace >= thresholdPct) {
          points.push({ idx: pendingIdx, value: pendingLow, type: 'low' });
          direction = 'up';
          pendingHigh = h; pendingIdx = i;
        }
      }
    }
  }
  // Titik pending terakhir (belum terkonfirmasi reversal, tapi tetap dimasukin biar keliatan progress-nya)
  if (direction === 'up') points.push({ idx: pendingIdx, value: pendingHigh, type: 'high' });
  else if (direction === 'down') points.push({ idx: pendingIdx, value: pendingLow, type: 'low' });

  return points;
}

/**
 * Tentuin bias trend dari ZigZag point terakhir: HH+HL = bullish, LH+LL = bearish, selain itu ranging.
 * Dipakai sebagai HARD FILTER konfirmasi trend — kalau ZigZag bilang ranging/gak searah
 * sama structure biasa, sinyal di-skip.
 */
export function zigzagBias(highs: number[], lows: number[], thresholdPct: number): {
  bias: 'bullish' | 'bearish' | 'ranging';
  points: ZigZagPoint[];
} {
  const points = calcZigZag(highs, lows, thresholdPct);
  const zzHighs = points.filter(p => p.type === 'high');
  const zzLows = points.filter(p => p.type === 'low');
  if (zzHighs.length < 2 || zzLows.length < 2) return { bias: 'ranging', points };

  const h2 = zzHighs.slice(-2);
  const l2 = zzLows.slice(-2);
  const hh = h2[1]!.value > h2[0]!.value;
  const hl = l2[1]!.value > l2[0]!.value;
  const lh = h2[1]!.value < h2[0]!.value;
  const ll = l2[1]!.value < l2[0]!.value;

  if (hh && hl) return { bias: 'bullish', points };
  if (lh && ll) return { bias: 'bearish', points };
  return { bias: 'ranging', points };
}

// ─── Step 1: Price Action Structure ──────────────────────────────────────────

export function analyzePriceActionStructure(
  highs: number[],
  lows: number[],
  closes: number[]
): PriceStructure {
  // Pakai lookback 8 untuk stabilitas deteksi swing
  const swingHighs = findSwingHighs(highs, 8);
  const swingLows = findSwingLows(lows, 8);

  if (swingHighs.length < 2 || swingLows.length < 2) {
    return { bias: "ranging", strength: "neutral", description: "Insufficient swing data" };
  }

  // ── PENENTUAN BIAS: dari transisi swing PALING BARU, bukan voting ──────────
  // Riset (Dow Theory, SMC, ICT — konsensus luas): arah tren ditentukan oleh
  // break struktur TERBARU, bukan mayoritas suara dari beberapa swing ke belakang.
  // Sistem voting lama bisa telat baca reversal karena swing basi (lama) bisa
  // "mengalahkan" 1 break fresh yang sebenarnya sudah mengubah karakter market.
  const lastHH = swingHighs[swingHighs.length - 1]!;
  const prevHH = swingHighs[swingHighs.length - 2]!;
  const lastLL = swingLows[swingLows.length - 1]!;
  const prevLL = swingLows[swingLows.length - 2]!;

  const madeHigherHigh = lastHH > prevHH;
  const madeHigherLow = lastLL > prevLL;
  const madeLowerHigh = lastHH < prevHH;
  const madeLowerLow = lastLL < prevLL;

  let bias: "bullish" | "bearish" | "ranging";
  if (madeHigherHigh && madeHigherLow) bias = "bullish";
  else if (madeLowerHigh && madeLowerLow) bias = "bearish";
  else bias = "ranging"; // swing high & low kasih sinyal campuran = struktur belum jelas/transisi

  if (bias === "ranging") {
    return { bias: "ranging", strength: "neutral", description: "Swing high & low sinyal campuran — struktur belum jelas" };
  }

  // ── STRENGTH: seberapa matang/konsisten tren ini, BUKAN penentu arah ──────
  // Ini bekas logic voting lama — didaur ulang jadi grading kekuatan tren aja,
  // supaya arah gak lagi bisa "dikalahkan" swing basi, tapi datanya tetap kepake.
  const lastHighs = swingHighs.slice(-4);
  const lastLows = swingLows.slice(-4);
  let confirmCount = 0, totalCount = 0;
  for (let i = 1; i < lastHighs.length; i++) {
    totalCount++;
    if (bias === "bullish" ? lastHighs[i]! > lastHighs[i - 1]! : lastHighs[i]! < lastHighs[i - 1]!) confirmCount++;
  }
  for (let i = 1; i < lastLows.length; i++) {
    totalCount++;
    if (bias === "bullish" ? lastLows[i]! > lastLows[i - 1]! : lastLows[i]! < lastLows[i - 1]!) confirmCount++;
  }
  // Momentum MA10 vs MA20 — dilemahin jadi catatan tambahan aja (bukan suara setara),
  // karena moving average itu lagging indicator, gak seharusnya ikut nentuin ARAH.
  const recent20 = closes.slice(-20);
  const avg10 = recent20.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const avg20 = recent20.reduce((a, b) => a + b, 0) / 20;
  const momentumAgrees = bias === "bullish" ? avg10 > avg20 * 1.001 : avg10 < avg20 * 0.999;

  const dominance = totalCount > 0 ? confirmCount / totalCount : 0;
  const strength: "strong" | "moderate" | "weak" = dominance >= 0.75 ? "strong" : dominance >= 0.5 ? "moderate" : "weak";

  const label = bias === "bullish" ? "HH+HL" : "LH+LL";
  return {
    bias, strength,
    description: `${label} (swing terbaru) — ${confirmCount}/${totalCount} history konsisten${momentumAgrees ? ", momentum align" : ""}`,
  };
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
      const isBearishCandle = closes[i]! < opens[i]!;
      if (!isBearishCandle) continue;

      let maxClose = closes[i]!;
      let impulseEndIdx = i;
      for (let j = i + 1; j < Math.min(i + 5, closes.length); j++) {
        if (closes[j]! > maxClose) { maxClose = closes[j]!; impulseEndIdx = j; }
      }

      const range = highs[i]! - lows[i]!;
      const impulse = maxClose - closes[i]!;
      if (range <= 0 || impulse <= range * 1.5) continue;

      // ICT wajib: displacement harus tinggalkan FVG — ciri institutional move, bukan grinding retail
      let hasFVG = false;
      for (let j = i + 1; j < Math.min(impulseEndIdx, closes.length - 1); j++) {
        if (highs[j - 1]! < lows[j + 1]!) { hasFVG = true; break; }
      }
      if (!hasFVG) continue;

      // Structure break wajib: impulse harus lewatin swing high sebelum OB (BOS beneran)
      const priorSwingHighs = findSwingHighs(highs.slice(Math.max(0, i - 20), i), 5);
      const priorSwingHigh = priorSwingHighs.length > 0 ? Math.max(...priorSwingHighs) : -Infinity;
      if (maxClose <= priorSwingHigh) continue;

      // Mitigasi 50% body: kalau harga udah pernah close nembus tengah body OB, zona dianggap invalid
      const obMid = (opens[i]! + closes[i]!) / 2;
      let mitigated = false;
      for (let j = i + 1; j < closes.length; j++) {
        if (closes[j]! < obMid) { mitigated = true; break; }
      }
      if (mitigated) continue;

      const strength = impulse / range;
      let touches = 0;
      for (let j = i + 1; j < closes.length; j++) {
        if (lows[j]! <= highs[i]! && highs[j]! >= lows[i]!) touches++;
      }
      obs.push({
        high: highs[i]!, low: lows[i]!, mid: (highs[i]! + lows[i]!) / 2,
        index: i, type: "bullish", strength, touches, candlesAgo: opens.length - 1 - i,
      });
    } else {
      // Bullish OB: bullish candle followed by strong bearish impulse
      const isBullishCandle = closes[i]! > opens[i]!;
      if (!isBullishCandle) continue;

      let minClose = closes[i]!;
      let impulseEndIdx = i;
      for (let j = i + 1; j < Math.min(i + 5, closes.length); j++) {
        if (closes[j]! < minClose) { minClose = closes[j]!; impulseEndIdx = j; }
      }

      const range = highs[i]! - lows[i]!;
      const impulse = closes[i]! - minClose;
      if (range <= 0 || impulse <= range * 1.5) continue;

      let hasFVG = false;
      for (let j = i + 1; j < Math.min(impulseEndIdx, lows.length - 1); j++) {
        if (lows[j - 1]! > highs[j + 1]!) { hasFVG = true; break; }
      }
      if (!hasFVG) continue;

      const priorSwingLows = findSwingLows(lows.slice(Math.max(0, i - 20), i), 5);
      const priorSwingLow = priorSwingLows.length > 0 ? Math.min(...priorSwingLows) : Infinity;
      if (minClose >= priorSwingLow) continue;

      const obMid = (opens[i]! + closes[i]!) / 2;
      let mitigated = false;
      for (let j = i + 1; j < closes.length; j++) {
        if (closes[j]! > obMid) { mitigated = true; break; }
      }
      if (mitigated) continue;

      const strength = impulse / range;
      let touches = 0;
      for (let j = i + 1; j < closes.length; j++) {
        if (lows[j]! <= highs[i]! && highs[j]! >= lows[i]!) touches++;
      }
      obs.push({
        high: highs[i]!, low: lows[i]!, mid: (highs[i]! + lows[i]!) / 2,
        index: i, type: "bearish", strength, touches, candlesAgo: opens.length - 1 - i,
      });
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
      if (highs[i - 1]! < lows[i + 1]!) {
        const low = highs[i - 1]!;
        const high = lows[i + 1]!;
        // Gap wajib punya ukuran signifikan (min 0.05% dari harga) — gap receh cuma noise, bukan imbalance beneran
        const gapPct = (high - low) / low * 100;
        if (gapPct < 0.05) continue;
        // Hitung touches: berapa kali harga masuk ke FVG setelah terbentuk
        let touches = 0;
        for (let j = i + 2; j < highs.length; j++) {
          if (lows[j]! <= high && highs[j]! >= low) touches++;
        }
        fvgs.push({ high, low, mid: (high + low) / 2, index: i, type: "bullish", touches, candlesAgo: highs.length - 1 - i });
      }
    } else {
      // Bearish FVG: gap down — candle[i-1].low > candle[i+1].high
      if (lows[i - 1]! > highs[i + 1]!) {
        const high = lows[i - 1]!;
        const low = highs[i + 1]!;
        const gapPct = (high - low) / low * 100;
        if (gapPct < 0.05) continue;
        let touches = 0;
        for (let j = i + 2; j < highs.length; j++) {
          if (lows[j]! <= high && highs[j]! >= low) touches++;
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
      // OTE (Optimal Trade Entry, konsep ICT) — zona 62%-79%, sweet spot 70.5%.
      // 0.618 & 0.786 di atas/bawah ini udah mendekati batas OTE (golden ratio ~62%,
      // 0.786 ~79%), tapi kita tambahin level eksplisit biar zona OTE bisa diidentifikasi
      // & diberi label sendiri, bukan ketimbun jadi "Fib 0.618" generik.
      "0.705": swingLow + range * 0.705, // OTE sweet spot
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
  // Level 0.618-0.786 dilabelin "OTE" (Optimal Trade Entry, konsep ICT) — riset
  // nunjukin ini zona dengan dasar logika paling kuat dibanding level fib lain,
  // jadi dikasih label beda biar keliatan bedanya di UI/log.
  if (fibLevels) {
    const fibPrices: { price: number; isOTE: boolean }[] = [
      { price: fibLevels.levels["0.382"]!, isOTE: false },
      { price: fibLevels.levels["0.5"]!, isOTE: false },
      { price: fibLevels.levels["0.618"]!, isOTE: true },
      { price: fibLevels.levels["0.705"]!, isOTE: true }, // OTE sweet spot
      { price: fibLevels.levels["0.786"]!, isOTE: true },
    ];
    for (const sr of srLevels) {
      for (const { price: fibPrice, isOTE } of fibPrices) {
        if (
          Math.abs(sr.price - fibPrice) / currentPrice < 0.003 &&
          priceFilter(fibPrice * 0.998, fibPrice * 1.002)
        ) {
          return {
            high: fibPrice * 1.002,
            low: fibPrice * 0.998,
            mid: fibPrice,
            entryPrice: fibPrice,
            zoneType: isOTE ? "S&R + OTE (62-79%)" : "S&R + Fibonacci",
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


// ─── Multi-TF Zone Refinement: H1 → 15M → 5M ────────────────────────────────
// Cari zona terkuat di setiap TF dalam batas zona TF lebih tinggi
// Hierarki zona per TF: OB > FVG > S&R > Fib > UFO

function findBestZoneInRange(
  opens: number[], highs: number[], lows: number[], closes: number[], volumes: number[],
  bias: "bullish" | "bearish",
  zoneLow: number, zoneHigh: number,
  tfLabel: string,
  parentZoneType: string,
  currentPrice: number
): RefinedZone | null {
  const range = zoneHigh - zoneLow;
  if (range <= 0) return null;
  const margin = range * 0.15; // toleransi 15% keluar zona parent

  // 1. OB dalam zona
  const obs = detectOrderBlocksH1(opens, highs, lows, closes, bias, 50);
  for (const ob of obs) {
    const inZone = bias === "bullish"
      ? ob.high <= zoneHigh + margin && ob.low >= zoneLow - margin && ob.high < currentPrice
      : ob.low >= zoneLow - margin && ob.high <= zoneHigh + margin && ob.low > currentPrice;
    if (inZone) {
      const entry = bias === "bullish"
        ? ob.low + (ob.high - ob.low) * 0.382
        : ob.high - (ob.high - ob.low) * 0.382;
      return { high: ob.high, low: ob.low, mid: (ob.high + ob.low) / 2, entryPrice: entry, zoneType: `OB ${tfLabel} (${parentZoneType})`, refined: true };
    }
  }

  // 2. FVG dalam zona
  const fvgs = detectFVGH1(highs, lows, bias, 50);
  for (const fvg of fvgs) {
    const inZone = fvg.low >= zoneLow - margin && fvg.high <= zoneHigh + margin;
    if (inZone) {
      const inPriceRange = bias === "bullish" ? fvg.high < currentPrice : fvg.low > currentPrice;
      if (inPriceRange) return { high: fvg.high, low: fvg.low, mid: fvg.mid, entryPrice: fvg.mid, zoneType: `FVG ${tfLabel} (${parentZoneType})`, refined: true };
    }
  }

  // 3. S&R dalam zona
  const srLevels = detectSRLevels(highs, lows, closes);
  for (const sr of srLevels) {
    const inZone = sr.price >= zoneLow - margin && sr.price <= zoneHigh + margin;
    if (inZone) {
      const isRelevant = bias === "bullish" ? sr.price < currentPrice : sr.price > currentPrice;
      if (isRelevant) {
        const hw = range * 0.1;
        return { high: sr.price + hw, low: sr.price - hw, mid: sr.price, entryPrice: sr.price, zoneType: `S&R ${tfLabel} ${sr.type} (${parentZoneType})`, refined: true };
      }
    }
  }

  // 4. Fibonacci dalam zona
  const fib = calcFibonacci(highs, lows, closes);
  if (fib) {
    const fibKeys = bias === "bullish" ? ["0.618", "0.5", "0.382"] : ["0.382", "0.5", "0.618"];
    for (const k of fibKeys) {
      const lvl = fib.levels[k as keyof typeof fib.levels];
      if (lvl && lvl >= zoneLow - margin && lvl <= zoneHigh + margin) {
        const inPriceRange = bias === "bullish" ? lvl < currentPrice : lvl > currentPrice;
        if (inPriceRange) {
          const hw = range * 0.08;
          return { high: lvl + hw, low: lvl - hw, mid: lvl, entryPrice: lvl, zoneType: `Fib ${k} ${tfLabel} (${parentZoneType})`, refined: true };
        }
      }
    }
  }

  // 5. UFO — cari volume void dalam zona (low volume area = unfilled)
  const avgVol = volumes.length > 0 ? volumes.slice(-50).reduce((a, b) => a + b, 0) / Math.min(50, volumes.length) : 0;
  if (avgVol > 0) {
    for (let i = Math.max(0, highs.length - 50); i < highs.length - 3; i++) {
      const candleHigh = highs[i], candleLow = lows[i];
      const vol = volumes[i] ?? 0;
      const inZone = candleLow >= zoneLow - margin && candleHigh <= zoneHigh + margin;
      const isLowVol = vol < avgVol * 0.4; // volume < 40% avg = area tidak terisi
      const isGap = highs[i + 1] > candleHigh * 1.001 || lows[i + 1] < candleLow * 0.999; // ada gap setelahnya
      if (inZone && isLowVol && isGap) {
        const inPriceRange = bias === "bullish" ? candleHigh < currentPrice : candleLow > currentPrice;
        if (inPriceRange) return { high: candleHigh, low: candleLow, mid: (candleHigh + candleLow) / 2, entryPrice: (candleHigh + candleLow) / 2, zoneType: `UFO ${tfLabel} (${parentZoneType})`, refined: true };
      }
    }
  }

  return null;
}

export function refineZoneMultiTF(
  h1Zone: SelectedZone,
  opens15m: number[], highs15m: number[], lows15m: number[], closes15m: number[], volumes15m: number[],
  opens5m: number[], highs5m: number[], lows5m: number[], closes5m: number[], volumes5m: number[],
  bias: "bullish" | "bearish",
  currentPrice: number
): RefinedZone {
  // Step 1: Cari zona terkuat di 15M dalam range H1
  const zone15M = findBestZoneInRange(
    opens15m, highs15m, lows15m, closes15m, volumes15m,
    bias, h1Zone.low, h1Zone.high, "15M", h1Zone.zoneType, currentPrice
  );

  if (zone15M) {
    // Step 2: Cari zona terkuat di 5M dalam range zona 15M yang ditemukan
    const zone5M = findBestZoneInRange(
      opens5m, highs5m, lows5m, closes5m, volumes5m,
      bias, zone15M.low, zone15M.high, "5M", zone15M.zoneType, currentPrice
    );
    if (zone5M) return zone5M; // Zona 5M paling presisi
    return zone15M; // Fallback ke 15M
  }

  // Fallback ke H1 zone langsung
  return {
    high: h1Zone.high, low: h1Zone.low, mid: h1Zone.mid,
    entryPrice: h1Zone.entryPrice, zoneType: h1Zone.zoneType, refined: false,
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
    atrSl: number,     // ATR D1 untuk SL
    atrH4: number,
    bias: "bullish" | "bearish",
    h1Highs: number[],
    h1Lows: number[],
    atrH1: number,
    d1Highs: number[] = [],
    d1Lows: number[] = [],
): SniperLevels {
    let stopLoss: number;

    // SL berdasarkan swing high/low D1 terdekat (20 candle lookback = 20 hari)
    const d1HighsToUse = d1Highs.length >= 3 ? d1Highs : h1Highs;
    const d1LowsToUse = d1Lows.length >= 3 ? d1Lows : h1Lows;
    const swingHighs = findSwingHighs(d1HighsToUse, 10);
    const swingLows = findSwingLows(d1LowsToUse, 10);
    const buffer = atrSl * 0.2; // buffer 20% ATR D1

    if (bias === "bullish") {
      // Cari swing low D1 terdekat di bawah entry
      const relevantLows = swingLows.filter(l => l < entryPrice);
      const nearestSwingLow = relevantLows.length > 0
        ? Math.max(...relevantLows)
        : Math.min(...d1LowsToUse.slice(-10));
      const rawSl = nearestSwingLow - buffer;
      // Minimum SL = 1x ATR D1 dari entry
      const minSl = entryPrice - atrSl;
      stopLoss = Math.min(rawSl, minSl);
    } else {
      // Cari swing high D1 terdekat di atas entry
      const relevantHighs = swingHighs.filter(h => h > entryPrice);
      const nearestSwingHigh = relevantHighs.length > 0
        ? Math.min(...relevantHighs)
        : Math.max(...d1HighsToUse.slice(-10));
      const rawSl = nearestSwingHigh + buffer;
      // Minimum SL = 1x ATR D1 dari entry
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
    // CHoCH bullish: sebelumnya ada LL, lalu close breakout di atas swing high PALING BARU
    if (swingHighs.length < 2 || swingLows.length < 2) return { detected: false, description: "Swing tidak cukup" };

    const lastHH = swingHighs[swingHighs.length - 1]!;
    const prevLL = swingLows[swingLows.length - 2]!;
    const lastLL = swingLows[swingLows.length - 1]!;

    // Struktur sebelumnya bearish (LL terbentuk)
    const hadBearStructure = lastLL < prevLL;
    // FIX BUG: konfirmasi breakout wajib terhadap swing high PALING BARU (lastHH),
    // bukan yang kedua-terakhir (prevHH) — gak ada metodologi SMC/ICT yang valid
    // pakai swing lama buat konfirmasi CHoCH, itu bikin sinyal telat/salah.
    const chochConfirmed = lastClose! > lastHH;

    if (hadBearStructure && chochConfirmed) {
      return {
        detected: true,
        description: `CHoCH Bullish 15M — LL terbentuk di ${lastLL.toFixed(4)}, close breakout HH terbaru ${lastHH.toFixed(4)}`
      };
    }
  } else {
    // CHoCH bearish: sebelumnya ada HH, lalu close breakdown di bawah swing low PALING BARU
    if (swingHighs.length < 2 || swingLows.length < 2) return { detected: false, description: "Swing tidak cukup" };

    const lastHH = swingHighs[swingHighs.length - 1]!;
    const prevHH = swingHighs[swingHighs.length - 2]!;
    const lastLL = swingLows[swingLows.length - 1]!;

    // Struktur sebelumnya bullish (HH terbentuk)
    const hadBullStructure = lastHH > prevHH;
    // FIX BUG: konfirmasi breakdown wajib terhadap swing low PALING BARU (lastLL)
    const chochConfirmed = lastClose! < lastLL;

    if (hadBullStructure && chochConfirmed) {
      return {
        detected: true,
        description: `CHoCH Bearish 15M — HH terbentuk di ${lastHH.toFixed(4)}, close breakdown LL terbaru ${lastLL.toFixed(4)}`
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

  // Divergence presisi: bandingin RSI TEPAT di titik swing high/low, bukan RSI global
  const rsiSeries = calcRSISeries(h1Closes);
  const swingHighsIdx = findSwingPointsIdx(h1Highs, 'high', 2);
  const swingLowsIdx = findSwingPointsIdx(h1Lows, 'low', 2);

  if (bias === "bullish") {
    // Bearish divergence: 2 swing high terakhir — harga HH tapi RSI di titik itu LH
    if (swingHighsIdx.length >= 2) {
      const h1 = swingHighsIdx[swingHighsIdx.length - 2]!;
      const h2 = swingHighsIdx[swingHighsIdx.length - 1]!;
      const priceHH = h2.value > h1.value;
      const rsiAtH1 = rsiSeries[h1.idx] ?? 50;
      const rsiAtH2 = rsiSeries[h2.idx] ?? 50;
      if (priceHH && rsiAtH2 < rsiAtH1 - 2) { // RSI turun minimal 2 poin di puncak lebih tinggi = divergence
        rsiDivergence = true;
        reasons.push(`RSI divergence terdeteksi di H1 (harga HH ${h1.value.toFixed(4)}→${h2.value.toFixed(4)}, RSI ${rsiAtH1.toFixed(0)}→${rsiAtH2.toFixed(0)})`);
        shouldSkip = true;
      }
    }
  } else {
    // Bullish divergence: 2 swing low terakhir — harga LL tapi RSI di titik itu HL
    if (swingLowsIdx.length >= 2) {
      const l1 = swingLowsIdx[swingLowsIdx.length - 2]!;
      const l2 = swingLowsIdx[swingLowsIdx.length - 1]!;
      const priceLL = l2.value < l1.value;
      const rsiAtL1 = rsiSeries[l1.idx] ?? 50;
      const rsiAtL2 = rsiSeries[l2.idx] ?? 50;
      if (priceLL && rsiAtL2 > rsiAtL1 + 2) {
        rsiDivergence = true;
        reasons.push(`RSI divergence terdeteksi di H1 (harga LL ${l1.value.toFixed(4)}→${l2.value.toFixed(4)}, RSI ${rsiAtL1.toFixed(0)}→${rsiAtL2.toFixed(0)})`);
        shouldSkip = true;
      }
    }
  }

  // CHoCH H1 dihapus dari skip condition — justru ini yang kita cari (koreksi/pullback)
  const chochDetected = detectCHoCH(h1Highs, h1Lows, h1Closes, bias);

  // CHoCH H4 dihapus — sudah dicek di Step 1 (trend H4 harus valid sebelum masuk sini)
  const chochH4Detected = false;

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

  return {
    shouldSkip, reasons, rsi, rsiDivergence,
    chochDetected, chochH4Detected,
    oiChange: 0, oiAccumulation: false, oiAccumulationDesc: '',
    fundingRate: 0,
    dowPhase: dowResult.phase,
    dowPhaseDesc: dowResult.description,
    volumeTrendValid: volTrend.valid,
    volumeTrendDesc: volTrend.description,
  };
}

// ─── Main Analysis Function ───────────────────────────────────────────────────

// ─── Multi-TF Confluence: H4 approaching H1 zone ─────────────────────────────

function detectH4Confluence(
  h4Highs: number[],
  h4Lows: number[],
  h4Closes: number[],
  h4Volumes: number[],
  zoneLow: number,
  zoneHigh: number,
  bias: "bullish" | "bearish"
): { confirmed: boolean; strength: "strong" | "moderate" | "weak"; description: string } {
  const n = h4Closes.length;
  if (n < 10) return { confirmed: false, strength: "weak", description: "Data H4 tidak cukup" };

  const lastClose = h4Closes[n - 1];
  const zoneRange = zoneHigh - zoneLow;
  const zoneMid = (zoneHigh + zoneLow) / 2;

  // Jarak harga H4 ke tepi zona (sebagai % dari harga)
  const distToZone = bias === "bullish"
    ? (lastClose - zoneHigh) / lastClose * 100   // jarak ke atas zona (bullish: approaching dari atas)
    : (zoneLow - lastClose) / lastClose * 100;    // jarak ke bawah zona (bearish: approaching dari bawah)

  // Tidak confluence kalau harga sudah di dalam zona atau sudah lewat
  if (distToZone < 0) {
    return { confirmed: false, strength: "weak", description: "Harga H4 sudah melewati zona" };
  }

  // Cek apakah H4 sedang bergerak menuju zona (momentum searah)
  const last5Closes = h4Closes.slice(-5);
  const isApproaching = bias === "bullish"
    ? last5Closes[last5Closes.length - 1] < last5Closes[0]  // harga turun menuju zona support
    : last5Closes[last5Closes.length - 1] > last5Closes[0]; // harga naik menuju zona resistance

  // Cek volume H4 saat approaching (harus melemah = pullback sehat)
  const recentVols = h4Volumes.slice(-5);
  const avgVol = h4Volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, h4Volumes.length);
  const lastVol = recentVols[recentVols.length - 1];
  const pullbackHealthy = lastVol < avgVol * 0.9; // volume pullback < rata-rata = sehat

  // Kekuatan confluence berdasarkan jarak dan kondisi
  if (distToZone <= 1.0 && isApproaching && pullbackHealthy) {
    return {
      confirmed: true,
      strength: "strong",
      description: `H4 approaching zona (${distToZone.toFixed(2)}% jauh), pullback volume sehat`
    };
  } else if (distToZone <= 2.5 && isApproaching) {
    return {
      confirmed: true,
      strength: "moderate",
      description: `H4 menuju zona (${distToZone.toFixed(2)}% jauh), momentum approaching`
    };
  } else if (distToZone <= 5.0) {
    return {
      confirmed: true,
      strength: "weak",
      description: `H4 dalam radius zona (${distToZone.toFixed(2)}% jauh)`
    };
  }

  return { confirmed: false, strength: "weak", description: `H4 masih jauh dari zona (${distToZone.toFixed(2)}%)` };
}

// ─── BTC Correlation Filter ─────────────────────────────────────────────────
// BTC dump/pump sering nyeret SEMUA altcoin ikut (cascading liquidation cross-margin,
// panic sell/FOMO, market maker re-hedge) — ini efek makro, BUKAN soal analisa
// teknikal koin itu sendiri salah. Sinyal yang SEARAH BTC lebih aman; sinyal yang
// LAWAN ARAH BTC beresiko lebih tinggi ke-tarik gerakan BTC walau setup-nya sendiri
// valid. Ini bukan hard-skip — cuma warning + sedikit penyesuaian confidence,
// karena BTC bisa aja balik korelasi sebelum posisi ditutup.
async function checkBtcAlignment(
  bias: 'bullish' | 'bearish',
  symbol: string
): Promise<{ aligned: boolean; btcBias: 'bullish' | 'bearish' | 'ranging'; btcStrength: string; message: string }> {
  // Skip self-check kalau yang dianalisa emang BTC sendiri — gak ada gunanya BTC ngecek dirinya sendiri
  if (symbol === 'BTCUSDT') {
    return { aligned: true, btcBias: bias, btcStrength: 'strong', message: '' };
  }
  try {
    // Pakai H2 (bukan H4) — lebih cepet nangkep reversal BTC (swing kebentuk 2x
    // lebih sering) tapi masih lebih "tenang" dari H1. Jumlah candle digandain
    // jadi 100 biar cakupan waktu tetep mirip (~8 hari) kayak sebelumnya (50×H4).
    const btcH2 = await fetchKlines('BTCUSDT', '2h', 100);
    const btcStruct = analyzePriceActionStructure(btcH2.highs, btcH2.lows, btcH2.closes);
    const aligned = btcStruct.bias === bias || btcStruct.bias === 'ranging';
    const message =
      btcStruct.bias === 'ranging'
        ? 'BTC netral/ranging — gak ada tekanan makro searah/lawan arah'
        : aligned
        ? `✅ Searah BTC (${btcStruct.bias}, ${btcStruct.strength}) — risiko ke-tarik gerakan makro lebih rendah`
        : `⚠️ Lawan arah BTC (BTC lagi ${btcStruct.bias}) — waspada risiko ke-tarik gerakan makro BTC`;
    return { aligned, btcBias: btcStruct.bias, btcStrength: btcStruct.strength, message };
  } catch {
    // Fail-safe: kalau fetch BTC gagal, jangan ganggu alur analisa koin utama
    return { aligned: true, btcBias: 'ranging', btcStrength: 'neutral', message: '' };
  }
}

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
    const [d1, h4, h1, m15, m5, currentTickerRes] = await Promise.all([
      fetchKlines(symbol, "1d", 30),   // D1 — trend utama
      fetchKlines(symbol, "4h", 100),  // H4 — zona entry
      fetchKlines(symbol, "1h", 50),   // H1 — refine zona
      fetchKlines(symbol, "15m", 100), // 15M — refine lebih presisi
      fetchKlines(symbol, "5m", 200),  // 5M — entry presisi
      fetch(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);

    let currentPrice: number;
    if (currentTickerRes.ok) {
      const ticker: { price: string } = await currentTickerRes.json();
      currentPrice = parseFloat(ticker.price);
    } else {
      currentPrice = h1.closes[h1.closes.length - 1];
    }

    // STEP 1: Confirm trend D1 (trend utama)
    const structD1 = analyzePriceActionStructure(d1.highs, d1.lows, d1.closes);

    if (structD1.bias === "ranging") {
      return {
        status: "no_trend",
        message: `Struktur D1 ranging, tidak ada trend jelas untuk ${symbol}`,
        symbol,
        currentPrice,
        timestamp,
        h4: { bias: structD1.bias, strength: structD1.strength },
      };
    }

    // HARD FILTER: konfirmasi ZigZag D1 (threshold 5%) — filter noise, wajib searah sama structure biasa
    const zzD1 = zigzagBias(d1.highs, d1.lows, 5);
    if (zzD1.bias === "ranging" || zzD1.bias !== structD1.bias) {
      return {
        status: "no_trend",
        message: `ZigZag D1 tidak konfirmasi trend (structure: ${structD1.bias}, zigzag: ${zzD1.bias}) — kemungkinan trend palsu/noise`,
        symbol,
        currentPrice,
        timestamp,
        h4: { bias: structD1.bias, strength: structD1.strength },
      };
    }

    const bias = structD1.bias as "bullish" | "bearish";
    // Catat juga struktur H4 untuk info
    const structH4 = analyzePriceActionStructure(h4.highs, h4.lows, h4.closes);

    // STEP 2: Detect zones at H4 (zona entry utama, lebih besar dari H1)
    const [obs, fvgs, unfilledOrders] = await Promise.all([
      Promise.resolve(detectOrderBlocksH1(h4.opens, h4.highs, h4.lows, h4.closes, bias)),
      Promise.resolve(detectFVGH1(h4.highs, h4.lows, bias)),
      detectUnfilledOrdersH1(symbol, currentPrice, bias),
    ]);

    const srLevels = detectSRLevels(h4.highs, h4.lows, h4.closes);
    const sndZones = detectSnDZones(h4.opens, h4.highs, h4.lows, h4.closes);
    const fibLevels = calcFibonacci(d1.highs, d1.lows, d1.closes);

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
        h4: { bias: structD1.bias, strength: structD1.strength }, // D1 trend
        h4Actual: { bias: structH4.bias, strength: structH4.strength }, // H4 info
      };
    }

    // STEP 3: Check skip conditions (after zone found)
    const skipConds = await checkSkipConditions(
      symbol, bias,
      d1.closes, d1.highs, d1.lows,
      d1.highs, d1.lows, d1.closes, d1.volumes
    );

    if (skipConds.shouldSkip) {
      return {
        status: "skip_conditions",
        message: `Zona ditemukan tapi ada kondisi yang tidak mendukung untuk ${symbol}`,
        symbol,
        currentPrice,
        timestamp,
        bias,
        h4: { bias: structD1.bias, strength: structD1.strength }, // D1 trend utama
      h4Actual: { bias: structH4.bias, strength: structH4.strength }, // H4 info tambahan
        zoneType: selectedZone.zoneType,
        rsi: skipConds.rsi,
        rsiDivergence: skipConds.rsiDivergence,
        chochDetected: skipConds.chochDetected,
        oiChange: skipConds.oiChange,
        fundingRate: skipConds.fundingRate,
        skipReasons: skipConds.reasons,
      };
    }

    // STEP 3: Refine zona H4 → H1 → 15M → 5M
    // Cari konfluens terkuat: OB > FVG > S&R > Fib > UFO per TF
    // Step 3a: H4 zona → cari yang terkuat di H1
    const zoneH1 = findBestZoneInRange(
      h1.opens, h1.highs, h1.lows, h1.closes, h1.volumes,
      bias, selectedZone.low, selectedZone.high, "H1", selectedZone.zoneType, currentPrice
    );
    const zoneForRefine = zoneH1 ?? { ...selectedZone, refined: false };

    // Step 3b: H1 zona → refine ke 15M → 5M
    const refinedZone = refineZoneMultiTF(
      zoneForRefine,
      m15.opens, m15.highs, m15.lows, m15.closes, m15.volumes,
      m5.opens, m5.highs, m5.lows, m5.closes, m5.volumes,
      bias, currentPrice
    );

    // STEP 4a: Multi-TF Confluence — H4 approaching H1 zone
    const h4Confluence = detectH4Confluence(
      d1.highs, d1.lows, d1.closes, d1.volumes,
      selectedZone.low, selectedZone.high, bias
    );

    // STEP 4b: CHoCH 15M (scoring, bukan hard filter)
    const choch15M = detectCHoCH15M(m15.highs, m15.lows, m15.closes, bias);

    // STEP 4b: Rejection candle 15M (scoring, bukan hard filter)
    const rejection15M = checkRejection15M(
      refinedZone, m15.opens, m15.highs, m15.lows, m15.closes, bias, m15.volumes
    );

    // STEP 4c: Pattern konfirmasi 15M/5M (scoring, bukan hard filter)
    const validPatterns = bias === "bullish"
      ? ["Bull Flag", "Ascending Triangle", "Double Bottom", "Inverse H&S", "Falling Wedge", "Pennant"]
      : ["Bear Flag", "Descending Triangle", "Double Top", "Head & Shoulders", "Rising Wedge", "Pennant"];

    const allPatterns = [
      detectBullFlag(m15.highs, m15.lows, m15.closes, m15.volumes),
      detectBearFlag(m15.highs, m15.lows, m15.closes, m15.volumes),
      detectAscendingTriangle(m15.highs, m15.lows, m15.closes),
      detectDescendingTriangle(m15.highs, m15.lows, m15.closes),
      detectDoubleBottom(m15.highs, m15.lows, m15.closes),
      detectDoubleTop(m15.highs, m15.lows, m15.closes),
      detectInverseHS(m15.highs, m15.lows, m15.closes),
      detectHeadAndShoulders(m15.highs, m15.lows, m15.closes),
      detectFallingWedge(m15.highs, m15.lows, m15.closes),
      detectRisingWedge(m15.highs, m15.lows, m15.closes),
      detectPennant(m15.highs, m15.lows, m15.closes, m15.volumes),
      detectBullFlag(m5.highs, m5.lows, m5.closes, m5.volumes),
      detectBearFlag(m5.highs, m5.lows, m5.closes, m5.volumes),
      detectAscendingTriangle(m5.highs, m5.lows, m5.closes),
      detectDescendingTriangle(m5.highs, m5.lows, m5.closes),
      detectDoubleBottom(m5.highs, m5.lows, m5.closes),
      detectDoubleTop(m5.highs, m5.lows, m5.closes),
    ].filter(p => p !== null && validPatterns.includes(p!.name));
    const confirmedPattern = allPatterns.length > 0 ? allPatterns[0] : null;



    // STEP 4e: Konfirmasi 5M
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

    // Jam sesi dihapus — crypto 24 jam, jam tidak relevan

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

    // Premium/Discount (konsep ICT) — equilibrium dari dealing range D1 (higher timeframe,
    // bukan range entry M30/H1 yang sama dipakai buat zona, biar gak circular).
    // Bullish idealnya entry di DISCOUNT (bawah 50%), bearish di PREMIUM (atas 50%) —
    // biar gak "beli mahal / jual murah" relatif ke range besar.
    if (fibLevels) {
      const equilibrium = fibLevels.levels["0.5"]!;
      const inDiscount = currentPrice < equilibrium;
      const inPremium = currentPrice > equilibrium;
      if (bias === "bullish" && inDiscount) {
        profitProbability += 8;
        probabilityFactors.push(`✅ Entry di Discount zone D1 (+8%) — di bawah equilibrium ${equilibrium.toFixed(4)}`);
      } else if (bias === "bearish" && inPremium) {
        profitProbability += 8;
        probabilityFactors.push(`✅ Entry di Premium zone D1 (+8%) — di atas equilibrium ${equilibrium.toFixed(4)}`);
      } else {
        probabilityFactors.push(`⚠️ Entry di sisi range yang kurang ideal (${bias === "bullish" ? "premium, seharusnya discount" : "discount, seharusnya premium"})`);
      }
    }

    // Multi-TF Confluence: H4 approaching H1 zone
    if (h4Confluence.confirmed) {
      if (h4Confluence.strength === "strong") {
        profitProbability += 15;
        probabilityFactors.push(`✅ H4 Confluence KUAT (+15%) — ${h4Confluence.description}`);
      } else if (h4Confluence.strength === "moderate") {
        profitProbability += 10;
        probabilityFactors.push(`✅ H4 Confluence SEDANG (+10%) — ${h4Confluence.description}`);
      } else {
        profitProbability += 5;
        probabilityFactors.push(`✅ H4 Confluence LEMAH (+5%) — ${h4Confluence.description}`);
      }
    } else {
      probabilityFactors.push(`⚠️ Tidak ada H4 confluence — ${h4Confluence.description}`);
    }

    // BTC Correlation Filter — sinyal searah BTC lebih aman dari efek "ke-tarik"
    // gerakan makro (cascading liquidation, panic sell/FOMO). Bukan hard-skip,
    // cuma penyesuaian confidence + warning.
    const btcCheck = await checkBtcAlignment(bias, symbol);
    if (btcCheck.message) {
      probabilityFactors.push(btcCheck.message);
      if (btcCheck.aligned && btcCheck.btcBias !== 'ranging') profitProbability += 5;
      else if (!btcCheck.aligned) profitProbability = Math.max(0, profitProbability - 10);
    }

    // Entry price: pakai rejection 15M kalau ada, fallback ke zona entry
    const finalEntryPrice = rejection15M.confirmed
      ? rejection15M.entryPrice
      : refinedZone.entryPrice;

    // STEP 6: Calculate SL/TP
    const atrH1 = calcATR(h1.highs, h1.lows, h1.closes);
    const atrD1 = calcATR(d1.highs, d1.lows, d1.closes); // ATR D1 untuk SL
    const atrH4 = calcATR(h4.highs, h4.lows, h4.closes); // ATR H4 untuk estimasi waktu

    const sniperLevels = calcSniperLevels(
      finalEntryPrice, refinedZone, atrD1, atrD1, bias,
      d1.highs, d1.lows, atrD1, // swing D1 untuk SL
      d1.highs, d1.lows
    );

    // Estimate time to hit entry (pakai atrH4 untuk estimasi jam)
    const distanceToEntry = Math.abs(currentPrice - sniperLevels.entryPrice);
    const estimatedHitHours = Math.max(1, Math.round(distanceToEntry / atrH4));

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
      h4: { bias: structD1.bias, strength: structD1.strength }, // D1 trend utama
      h4Actual: { bias: structH4.bias, strength: structH4.strength }, // H4 zona info
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
      h4ConfluenceConfirmed: h4Confluence.confirmed,
      h4ConfluenceStrength: h4Confluence.strength,
      h4ConfluenceDesc: h4Confluence.description,
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

// ─── Menu 6: Scalping Scanner (SMC Micro 15M) ────────────────────────────────

export interface ScalpingResult {
  status: 'waiting' | 'approaching' | 'in_zone' | 'expired' | 'no_setup' | 'no_structure' | 'skip' | 'error';
  symbol: string;
  bias?: 'bullish' | 'bearish';
  currentPrice: number;
  timestamp: string;
  message?: string;
  score?: number;
  maxScore: number;
  // Struktur 15M
  structure15M?: string;
  choch15M?: boolean;
  // OB 5M
  ob5M?: { low: number; high: number; mid: number; fresh: boolean };
  // Levels
  entryPrice?: number;
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  rr1?: number;
  rr2?: number;
  // Info
  atr15MPct?: number;
  spreadEstPct?: number;
  filterResults?: string[];
  bbSqueezing?: boolean; // BB Squeeze M30 aktif
}

export async function analyzeScalpingEntry(symbol: string): Promise<ScalpingResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';
  const maxScore = 8; // 7 filter asli + 1 BTC correlation check

  // Helper: hitung EMA dari array closes
  function calcEMA(closes: number[], period: number): number {
    if (closes.length < period) return closes[closes.length - 1] ?? 0;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) {
      ema = closes[i]! * k + ema * (1 - k);
    }
    return ema;
  }

  try {
    const [h4, h1, m30, m5, tickerRes] = await Promise.all([
      fetchKlines(symbol, '4h', 100),   // H4 — trend utama, EMA34, SL
      fetchKlines(symbol, '1h', 50),    // H1 — RSI divergence
      fetchKlines(symbol, '30m', 100),  // M30 — zona entry & pattern
      fetchKlines(symbol, '5m', 200),   // M5 — refine zona
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);
    const currentPrice = tickerRes.ok
      ? parseFloat((await tickerRes.json() as { price: string }).price)
      : m30.closes[m30.closes.length - 1];

    const filterResults: string[] = [];
    let score = 0;
    let trendWarning = '';

    // ── Filter 1: Struktur H4 + konfirmasi EMA 34 H4 ─────────────────────
    const structH4 = analyzePriceActionStructure(h4.highs, h4.lows, h4.closes);
    if (structH4.bias === 'ranging') {
      return { status: 'skip', symbol, currentPrice, timestamp, message: 'H4 ranging — tidak ada trend utama yang jelas', score, maxScore, filterResults };
    }

    const bias = structH4.bias as 'bullish' | 'bearish';

    // HARD FILTER: konfirmasi ZigZag H4 (threshold 3%) — filter noise, wajib searah sama structure biasa
    const zzH4 = zigzagBias(h4.highs, h4.lows, 3);
    if (zzH4.bias === 'ranging' || zzH4.bias !== bias) {
      return { status: 'skip', symbol, currentPrice, timestamp, message: `ZigZag H4 tidak konfirmasi trend (structure: ${bias}, zigzag: ${zzH4.bias}) — kemungkinan trend palsu/noise`, score, maxScore, filterResults };
    }

    // EMA 34 H4 — opsional, bukan hard filter. Konfirmasi tambahan saja.
    const ema34H4 = calcEMA(h4.closes, 34);
    const lastCloseH4 = h4.closes[h4.closes.length - 1] ?? currentPrice;
    const emaConfirmed =
      (bias === 'bullish' && lastCloseH4 > ema34H4) ||
      (bias === 'bearish' && lastCloseH4 < ema34H4);

    score++;
    filterResults.push(
      `✅ Trend H4: ${bias === 'bullish' ? 'Bullish' : 'Bearish'} (${structH4.strength}) | EMA34 H4: ${ema34H4.toFixed(4)} ${emaConfirmed ? '✅ konfirmasi' : '⚠️ belum konfirmasi EMA'}`
    );

    // ── Filter 2: ATR D1 >= 0.5% (volatilitas cukup) ─────────────────────
    // Gunakan ATR H4 sebagai proxy volatilitas (gak fetch D1 lagi)
    const atrH4 = calcATR(h4.highs, h4.lows, h4.closes);
    const atrH4Pct = (atrH4 / currentPrice) * 100;
    if (atrH4Pct < 0.5) {
      return { status: 'skip', symbol, currentPrice, timestamp, message: `ATR H4 terlalu rendah (${atrH4Pct.toFixed(2)}%) — volatilitas tidak cukup untuk scalping`, score, maxScore, filterResults };
    }
    score++;
    filterResults.push(`✅ ATR H4 ${atrH4Pct.toFixed(2)}%`);

    // ── BB Squeeze M30 — scoring bonus (bukan hard filter) ───────────────
    const bbSqueeze = detectBBSqueeze(m30.closes, 20, 20);
    if (bbSqueeze.isSqueezing) {
      score++;
      filterResults.push(`⚡ BB Squeeze M30 aktif (BW: ${(bbSqueeze.currentBW * 100).toFixed(2)}% = ${(bbSqueeze.ratio * 100).toFixed(0)}% dari avg) — energy terakumulasi, potensi gerak eksplosif`);
    } else {
      filterResults.push(`ℹ️ Tidak ada BB Squeeze M30 (BW: ${(bbSqueeze.currentBW * 100).toFixed(2)}% vs avg ${(bbSqueeze.avgBW * 100).toFixed(2)}%)`);
    }

    // ── Cek M30 vs H4 — koreksi atau searah ──────────────────────────────
    const structM30 = analyzePriceActionStructure(m30.highs, m30.lows, m30.closes);
    const m30Correction = structM30.bias !== bias; // M30 berlawanan H4 = koreksi valid
    const m30Ranging = structM30.bias === 'ranging';
    if (!m30Correction && !m30Ranging) {
      trendWarning = `⚠️ M30 masih searah H4 (${structM30.bias}) — tunggu koreksi M30 sebelum entry`;
      filterResults.push(trendWarning);
    } else {
      score++;
      filterResults.push(`✅ M30 ${m30Ranging ? 'konsolidasi' : 'koreksi'} (${structM30.bias}) — setup scalping valid`);
    }

    // ── Filter 3: Zona retest terkuat M30 ────────────────────────────────
    // Gunakan selectBestZoneH1 yang sudah punya hierarki OB>FVG>S&R>Fib>UFO
    const obs30       = detectOrderBlocksH1(m30.opens, m30.highs, m30.lows, m30.closes, bias);
    const fvgs30      = detectFVGH1(m30.highs, m30.lows, bias);
    const sr30        = detectSRLevels(m30.highs, m30.lows, m30.closes);
    const snd30       = detectSnDZones(m30.highs, m30.lows, m30.closes, m30.volumes);
    const fib30       = calcFibonacci(m30.highs, m30.lows, bias);
    const ufo30       = await detectUnfilledOrdersH1(symbol, currentPrice, bias);

    const maxDist = atrH4 * 3;

    // Filter zona approaching (dalam 3x ATR H4)
    const obsFiltered = obs30.filter(ob => {
      if ((ob.touches ?? 0) > 1) return false;
      const dist = bias === 'bullish' ? currentPrice - ob.high : ob.low - currentPrice;
      return dist >= 0 && dist <= maxDist;
    });
    const fvgsFiltered = fvgs30.filter(fvg => {
      const dist = bias === 'bullish' ? currentPrice - fvg.high : fvg.low - currentPrice;
      return dist >= 0 && dist <= maxDist;
    });
    const srFiltered = sr30.filter(sr => Math.abs(currentPrice - sr.price) <= maxDist * 0.5);
    const ufoFiltered = ufo30.filter(uo => {
      const dist = bias === 'bullish' ? currentPrice - uo.high : uo.low - currentPrice;
      return dist >= 0 && dist <= maxDist;
    });

    // Pilih zona terkuat pakai hierarki selectBestZoneH1
    const bestZone30 = selectBestZoneH1(
      obsFiltered, fvgsFiltered, ufoFiltered, srFiltered, snd30, fib30, bias, currentPrice
    );

    if (!bestZone30) {
      filterResults.push(`❌ Tidak ada zona retest M30 approaching (dalam 3x ATR H4)`);
      return { status: 'no_setup', symbol, bias, currentPrice, timestamp, message: 'Tidak ada zona retest M30 yang valid', score, maxScore, filterResults };
    }
    score++;
    filterResults.push(`✅ Zona M30: ${bestZone30.zoneType} ${bestZone30.low.toFixed(4)}–${bestZone30.high.toFixed(4)}`);

    // ── Filter 4: Konfirmasi reversal — Pattern M30 ATAU RSI divergence H1 ──
    const bullPatterns = ['Double Bottom', 'Inverse H&S', 'Falling Wedge', 'Bull Flag', 'Ascending Triangle', 'Cup and Handle'];
    const bearPatterns = ['Double Top', 'Head & Shoulders', 'Rising Wedge', 'Bear Flag', 'Descending Triangle'];
    const validPatterns = bias === 'bullish' ? bullPatterns : bearPatterns;

    const pats30 = [
      detectBullFlag(m30.highs, m30.lows, m30.closes, m30.volumes),
      detectBearFlag(m30.highs, m30.lows, m30.closes, m30.volumes),
      detectDoubleBottom(m30.highs, m30.lows, m30.closes, m30.volumes),
      detectDoubleTop(m30.highs, m30.lows, m30.closes, m30.volumes),
      detectInverseHS(m30.highs, m30.lows, m30.closes, m30.volumes),
      detectHeadAndShoulders(m30.highs, m30.lows, m30.closes, m30.volumes),
      detectFallingWedge(m30.highs, m30.lows, m30.closes, m30.volumes),
      detectRisingWedge(m30.highs, m30.lows, m30.closes, m30.volumes),
      detectAscendingTriangle(m30.highs, m30.lows, m30.closes, m30.volumes),
      detectDescendingTriangle(m30.highs, m30.lows, m30.closes, m30.volumes),
      detectCupAndHandle(m30.highs, m30.lows, m30.closes, m30.volumes),
    ].filter(p => p && validPatterns.includes(p!.name));

    // RSI divergence H1 — presisi, anchor ke titik swing high/low beneran (bukan cuma perbandingan kasar)
    const rsiH1 = calcRSI(h1.closes);
    const rsiSeriesH1 = calcRSISeries(h1.closes);
    const swingHighsH1 = findSwingPointsIdx(h1.highs, 'high', 2);
    const swingLowsH1 = findSwingPointsIdx(h1.lows, 'low', 2);
    let rsiDivergence = false;
    if (bias === 'bullish') {
      // Bullish divergence: harga lower low tapi RSI di titik itu higher low
      if (swingLowsH1.length >= 2) {
        const l1 = swingLowsH1[swingLowsH1.length - 2]!;
        const l2 = swingLowsH1[swingLowsH1.length - 1]!;
        const priceLL = l2.value < l1.value;
        const rsiAtL1 = rsiSeriesH1[l1.idx] ?? 50;
        const rsiAtL2 = rsiSeriesH1[l2.idx] ?? 50;
        rsiDivergence = priceLL && rsiAtL2 > rsiAtL1 + 2 && rsiAtL2 < 45; // wajib dari zona jenuh jelas
      }
    } else {
      // Bearish divergence: harga higher high tapi RSI di titik itu lower high
      if (swingHighsH1.length >= 2) {
        const h1s = swingHighsH1[swingHighsH1.length - 2]!;
        const h2s = swingHighsH1[swingHighsH1.length - 1]!;
        const priceHH = h2s.value > h1s.value;
        const rsiAtH1 = rsiSeriesH1[h1s.idx] ?? 50;
        const rsiAtH2 = rsiSeriesH1[h2s.idx] ?? 50;
        rsiDivergence = priceHH && rsiAtH2 < rsiAtH1 - 2 && rsiAtH2 > 55; // wajib dari zona jenuh jelas
      }
    }

    const hasConfirmation = pats30.length > 0 || rsiDivergence;
    if (!hasConfirmation) {
      filterResults.push(`❌ Tidak ada konfirmasi reversal (pattern M30 atau RSI divergence H1)`);
      return { status: 'no_setup', symbol, bias, currentPrice, timestamp,
        message: 'Tidak ada konfirmasi reversal — tunggu pattern M30 atau RSI divergence H1',
        score, maxScore, filterResults };
    }
    score++;
    const confDesc = pats30.length > 0
      ? `Pattern M30: ${pats30[0]!.name}`
      : `RSI Divergence H1 (${rsiH1.toFixed(0)})`;
    filterResults.push(`✅ Konfirmasi reversal: ${confDesc}`);

    // ── Refine zona M30 → M5 ─────────────────────────────────────────────
    const refinedZone = findBestZoneInRange(
      m5.opens, m5.highs, m5.lows, m5.closes, m5.volumes,
      bias, bestZone30.low, bestZone30.high, 'M5', bestZone30.zoneType, currentPrice
    );
    const finalZone = refinedZone ?? {
      low: bestZone30.low,
      high: bestZone30.high,
      mid: bestZone30.mid,
      entryPrice: bestZone30.entryPrice ?? bestZone30.mid,
      zoneType: bestZone30.zoneType,
      refined: false,
    };

    if (refinedZone) {
      score++;
      filterResults.push(`✅ Refine ke M5: ${refinedZone.zoneType}`);
    } else {
      filterResults.push(`ℹ️ Tidak ada zona M5 lebih presisi, pakai M30`);
    }

    // BTC Correlation Filter — sinyal searah BTC lebih aman dari efek "ke-tarik"
    // gerakan makro (cascading liquidation, panic sell/FOMO). Bukan hard-skip,
    // cuma penyesuaian score + warning.
    const btcCheck = await checkBtcAlignment(bias, symbol);
    if (btcCheck.message) {
      filterResults.push(btcCheck.message);
      if (btcCheck.aligned && btcCheck.btcBias !== 'ranging') score++;
    }

    // ── Entry, SL, TP ─────────────────────────────────────────────────────
    const entryPrice = finalZone.entryPrice ?? finalZone.mid;
    const swingH4H = findSwingHighs(h4.highs, 10);
    const swingH4L = findSwingLows(h4.lows, 10);
    const bufferH4 = atrH4 * 0.2;
    let stopLoss: number;
    if (bias === 'bullish') {
      const relevantLows = swingH4L.filter(l => l < entryPrice);
      const nearestLow = relevantLows.length > 0 ? Math.max(...relevantLows) : Math.min(...h4.lows.slice(-10));
      stopLoss = Math.min(nearestLow - bufferH4, entryPrice - atrH4);
    } else {
      const relevantHighs = swingH4H.filter(h => h > entryPrice);
      const nearestHigh = relevantHighs.length > 0 ? Math.min(...relevantHighs) : Math.max(...h4.highs.slice(-10));
      stopLoss = Math.max(nearestHigh + bufferH4, entryPrice + atrH4);
    }
    const risk = Math.abs(entryPrice - stopLoss);
    if (risk <= 0) return { status: 'no_setup', symbol, bias, currentPrice, timestamp, message: 'Risk tidak valid', score, maxScore, filterResults };

    const dir = bias === 'bullish' ? 1 : -1;
    const takeProfit1 = entryPrice + risk * 1.5 * dir;
    const takeProfit2 = entryPrice + risk * 3.0 * dir;

    // ── Status ────────────────────────────────────────────────────────────
    let status: ScalpingResult['status'] = 'waiting';
    const atrH1 = calcATR(h1.highs, h1.lows, h1.closes);

    if (bias === 'bullish') {
      if (currentPrice < stopLoss) status = 'expired';
      else if (currentPrice >= finalZone.low && currentPrice <= finalZone.high) status = 'in_zone';
      else if (currentPrice > finalZone.high && currentPrice <= finalZone.high + atrH1) status = 'approaching';
    } else {
      if (currentPrice > stopLoss) status = 'expired';
      else if (currentPrice >= finalZone.low && currentPrice <= finalZone.high) status = 'in_zone';
      else if (currentPrice < finalZone.low && currentPrice >= finalZone.low - atrH1) status = 'approaching';
    }

    const atrM5Pct = (calcATR(m5.highs, m5.lows, m5.closes) / currentPrice) * 100;

    const statusMsg =
      status === 'in_zone'
        ? `BAGUS — Harga di zona ${finalZone.zoneType}, pasang limit sekarang`
        : status === 'approaching'
        ? `MENDEKATI — Harga dalam 1x ATR H1 dari zona, siap pasang limit`
        : `WAITING — Harga belum mendekati zona, setup valid`;

    return {
      status, symbol, bias, currentPrice, timestamp, score, maxScore,
      structure15M: `H4 ${bias} → M30 ${structM30.bias}`,
      choch15M: hasConfirmation,
      ob5M: { low: finalZone.low, high: finalZone.high, mid: finalZone.mid, fresh: true },
      entryPrice, stopLoss, takeProfit1, takeProfit2, rr1: 1.5, rr2: 3.0,
      atr15MPct: atrM5Pct, filterResults, bbSqueezing: bbSqueeze.isSqueezing,
      message: trendWarning ? `${statusMsg} | ${trendWarning}` : statusMsg,
    };

  } catch (err) {
    return { status: 'error', symbol, currentPrice: 0, timestamp, message: err instanceof Error ? err.message : 'Unknown error', maxScore };
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

/**
 * Swing point dengan index candle-nya (bukan cuma nilai).
 * Perlu buat cek urutan waktu, jarak antar swing, dan fit trendline.
 */
function findSwingPointsIdx(values: number[], mode: 'high' | 'low', leftRight = 2): { idx: number; value: number }[] {
  const swings: { idx: number; value: number }[] = [];
  for (let i = leftRight; i < values.length - leftRight; i++) {
    let isSwing = true;
    for (let j = 1; j <= leftRight; j++) {
      if (mode === 'high') {
        if (values[i]! <= values[i - j]! || values[i]! <= values[i + j]!) { isSwing = false; break; }
      } else {
        if (values[i]! >= values[i - j]! || values[i]! >= values[i + j]!) { isSwing = false; break; }
      }
    }
    if (isSwing) swings.push({ idx: i, value: values[i]! });
  }
  return swings;
}

/**
 * Regresi linear sederhana untuk fit trendline dari kumpulan swing point.
 * Dipakai untuk cek slope & konvergensi wedge/triangle secara presisi
 * (bukan cuma bandingin titik pertama-terakhir).
 */
function linRegSlope(points: { idx: number; value: number }[]): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.value ?? 0 };
  const sumX = points.reduce((a, p) => a + p.idx, 0);
  const sumY = points.reduce((a, p) => a + p.value, 0);
  const sumXY = points.reduce((a, p) => a + p.idx * p.value, 0);
  const sumXX = points.reduce((a, p) => a + p.idx * p.idx, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
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

function detectAscendingTriangle(highs: number[], lows: number[], closes: number[], volumes: number[] = []): PatternResult | null {
  const n = closes.length;
  const window = 30;
  if (n < window) return null;
  const sliceH = highs.slice(n - window);
  const sliceL = lows.slice(n - window);
  const swingH = findSwingPointsIdx(sliceH, 'high', 2);
  const swingL = findSwingPointsIdx(sliceL, 'low', 2);
  // Bulkowski: minimal 3 sentuh resistance + 2 higher low (5 titik total)
  if (swingH.length < 3 || swingL.length < 2) return null;
  const rh = swingH.slice(-3);
  const maxH = Math.max(...rh.map(s => s.value));
  const minH = Math.min(...rh.map(s => s.value));
  // Resistance wajib benar-benar flat (<1%) — beda dari rising wedge yang miring
  if ((maxH - minH) / minH * 100 > 1) return null;
  const rl = swingL.slice(-Math.min(3, swingL.length));
  const regL = linRegSlope(rl);
  if (regL.slope <= 0) return null;
  if (rl[rl.length - 1]!.value <= rl[0]!.value) return null; // higher low harus valid
  // Breakout udah lewat 2% dari resistance = momentum exhausted, bukan entry ideal lagi
  const lastClose = closes[n - 1]!;
  if (lastClose > maxH * 1.02) return null;
  let volDeclining = false;
  if (volumes.length >= window) {
    const avgVolEarly = volumes.slice(n - window, n - window + 10).reduce((a, b) => a + b, 0) / 10;
    const avgVolRecent = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    volDeclining = avgVolRecent < avgVolEarly;
  }
  return {
    name: 'Ascending Triangle', category: 'continuation', direction: 'bullish',
    confidence: volDeclining ? 'high' : 'medium',
    description: `Resistance flat ${maxH.toFixed(4)} (${rh.length}x touch), support naik (${rl.length}x touch)${volDeclining ? ', volume mengecil' : ''}`,
  };
}

function detectDescendingTriangle(highs: number[], lows: number[], closes: number[], volumes: number[] = []): PatternResult | null {
  const n = closes.length;
  const window = 30;
  if (n < window) return null;
  const sliceH = highs.slice(n - window);
  const sliceL = lows.slice(n - window);
  const swingH = findSwingPointsIdx(sliceH, 'high', 2);
  const swingL = findSwingPointsIdx(sliceL, 'low', 2);
  if (swingH.length < 2 || swingL.length < 3) return null;
  const rl = swingL.slice(-3);
  const maxL = Math.max(...rl.map(s => s.value));
  const minL = Math.min(...rl.map(s => s.value));
  if ((maxL - minL) / minL * 100 > 1) return null;
  const rh = swingH.slice(-Math.min(3, swingH.length));
  const regH = linRegSlope(rh);
  if (regH.slope >= 0) return null;
  if (rh[rh.length - 1]!.value >= rh[0]!.value) return null; // lower high harus valid
  const lastClose = closes[n - 1]!;
  // PENTING: riset Bulkowski (1.300+ trade) — descending triangle breakout ke ATAS
  // 53% dari waktu dengan 78% success rate, breakout ke bawah cuma 50% capai target.
  // Jangan hardcode bearish — tentukan arah dari CLOSE breakout aktual.
  let direction: 'bullish' | 'bearish' | null = null;
  if (lastClose < minL * 0.98) direction = 'bearish'; // breakout bawah, tembus support flat
  // Ekstrapolasi resistance line ke index candle terakhir (window - 1) buat cek breakout atas
  const resistAtEnd = regH.slope * (window - 1) + regH.intercept;
  if (!direction && lastClose > resistAtEnd * 1.005) direction = 'bullish';
  if (!direction) return null;

  let volDeclining = false;
  if (volumes.length >= window) {
    const avgVolEarly = volumes.slice(n - window, n - window + 10).reduce((a, b) => a + b, 0) / 10;
    const avgVolRecent = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    volDeclining = avgVolRecent < avgVolEarly;
  }
  // Confidence: breakout atas historisnya lebih andal (78% success) drpd breakout bawah (50% target)
  const confidence: 'high' | 'medium' | 'low' =
    direction === 'bullish' ? (volDeclining ? 'high' : 'medium') : (volDeclining ? 'medium' : 'low');
  return {
    name: 'Descending Triangle', category: 'continuation', direction,
    confidence,
    description: `Support flat ${minL.toFixed(4)} (${rl.length}x touch), resistance turun (${rh.length}x touch), breakout ${direction === 'bullish' ? 'ke atas' : 'ke bawah'}${volDeclining ? ', volume mengecil' : ''}`,
  };
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
  // Riset Bulkowski: pennant failure ~54% di kedua arah, cuma ~30% berfungsi sebagai
  // penanda tengah move — jangan kasih confidence medium/high walau flagpole+volume oke.
  return { name: 'Pennant', category: 'continuation', direction: dir as 'bullish' | 'bearish', confidence: 'low', description: `Pole ${dir === 'bullish' ? '+' : '-'}${poleMove.toFixed(1)}%, pennant konsolidasi volume turun` };
}

function detectDoubleTop(highs: number[], lows: number[], closes: number[], volumes: number[] = []): PatternResult | null {
  const n = closes.length;
  const window = 30;
  if (n < window) return null;
  const sliceH = highs.slice(n - window);
  const sliceL = lows.slice(n - window);
  const swingH = findSwingPointsIdx(sliceH, 'high', 2);
  if (swingH.length < 2) return null;
  const p1 = swingH[swingH.length - 2]!;
  const p2 = swingH[swingH.length - 1]!;
  // Jarak minimal antar 2 puncak — puncak terlalu dekat bukan double top valid
  if (p2.idx - p1.idx < 5) return null;
  // Bulkowski asli: toleransi jarak harga 2 puncak sampai 6%. Crypto lebih volatile dari
  // saham tapi kita gak selonggar itu — kompromi di 3.5% (riset: 2% kelewat ketat).
  const diffPct = Math.abs(p2.value - p1.value) / p1.value * 100;
  if (diffPct > 3.5) return null;
  // Preceding uptrend wajib — tanpa uptrend sebelumnya bukan reversal pattern
  const preStart = Math.max(0, p1.idx - 10);
  const preMove = (p1.value - sliceH[preStart]!) / sliceH[preStart]! * 100;
  if (preMove < 5) return null;
  // Bulkowski: lembah DI ANTARA dua puncak wajib turun minimal 10% dari puncak pertama —
  // syarat ini terpisah dari "preceding trend" di atas, sering ketuker di implementasi lain.
  const valleyBetween = Math.min(...sliceL.slice(p1.idx, p2.idx + 1));
  const interPeakDeclinePct = (p1.value - valleyBetween) / p1.value * 100;
  if (interPeakDeclinePct < 10) return null;
  // Neckline = low terendah DI ANTARA dua puncak (bukan seluruh window)
  const neckline = Math.min(...sliceL.slice(p1.idx, p2.idx + 1));
  // Konfirmasi wajib: candle CLOSE di bawah neckline, bukan cuma wick nyentuh
  const lastClose = closes[n - 1]!;
  if (lastClose >= neckline) return null;
  let volConfirmed = false;
  if (volumes.length >= 20) {
    const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    volConfirmed = volumes[volumes.length - 1]! > avgVol;
  }
  const confidence: 'high' | 'medium' | 'low' = diffPct < 1.5 && volConfirmed ? 'high' : diffPct < 2.5 ? 'medium' : 'low';
  return {
    name: 'Double Top', category: 'reversal', direction: 'bearish', confidence,
    description: `2 puncak ~${((p1.value + p2.value) / 2).toFixed(4)} (beda ${diffPct.toFixed(1)}%), neckline ${neckline.toFixed(4)} tertembus close${volConfirmed ? ' + volume konfirmasi' : ''}`,
  };
}

function detectDoubleBottom(highs: number[], lows: number[], closes: number[], volumes: number[] = []): PatternResult | null {
  const n = closes.length;
  const window = 30;
  if (n < window) return null;
  const sliceH = highs.slice(n - window);
  const sliceL = lows.slice(n - window);
  const swingL = findSwingPointsIdx(sliceL, 'low', 2);
  if (swingL.length < 2) return null;
  const p1 = swingL[swingL.length - 2]!;
  const p2 = swingL[swingL.length - 1]!;
  if (p2.idx - p1.idx < 5) return null;
  // Bulkowski asli: toleransi sampai 6%, kompromi crypto di 3.5%
  const diffPct = Math.abs(p2.value - p1.value) / p1.value * 100;
  if (diffPct > 3.5) return null;
  // Preceding downtrend wajib
  const preStart = Math.max(0, p1.idx - 10);
  const preMove = (sliceL[preStart]! - p1.value) / sliceL[preStart]! * 100;
  if (preMove < 5) return null;
  // Bulkowski: puncak DI ANTARA dua lembah wajib naik minimal 10% dari lembah pertama
  const peakBetween = Math.max(...sliceH.slice(p1.idx, p2.idx + 1));
  const interValleyRisePct = (peakBetween - p1.value) / p1.value * 100;
  if (interValleyRisePct < 10) return null;
  // Neckline = high tertinggi DI ANTARA dua lembah
  const neckline = Math.max(...sliceH.slice(p1.idx, p2.idx + 1));
  const lastClose = closes[n - 1]!;
  if (lastClose <= neckline) return null;
  let volConfirmed = false;
  if (volumes.length >= 20) {
    const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    volConfirmed = volumes[volumes.length - 1]! > avgVol;
  }
  const confidence: 'high' | 'medium' | 'low' = diffPct < 1.5 && volConfirmed ? 'high' : diffPct < 2.5 ? 'medium' : 'low';
  return {
    name: 'Double Bottom', category: 'reversal', direction: 'bullish', confidence,
    description: `2 lembah ~${((p1.value + p2.value) / 2).toFixed(4)} (beda ${diffPct.toFixed(1)}%), neckline ${neckline.toFixed(4)} tertembus close${volConfirmed ? ' + volume konfirmasi' : ''}`,
  };
}

function detectHeadAndShoulders(highs: number[], lows: number[], closes: number[], volumes: number[] = []): PatternResult | null {
  const n = closes.length;
  const window = 45;
  if (n < window) return null;
  const sliceH = highs.slice(n - window);
  const sliceL = lows.slice(n - window);
  const swingH = findSwingPointsIdx(sliceH, 'high', 2);
  if (swingH.length < 3) return null;
  const [ls, head, rs] = swingH.slice(-3) as [{ idx: number; value: number }, { idx: number; value: number }, { idx: number; value: number }];
  if (!(head.value > ls.value && head.value > rs.value)) return null;
  if (head.value < Math.max(ls.value, rs.value) * 1.01) return null;
  // Symmetry harga shoulder (toleransi 3%)
  const priceDiffPct = Math.abs(ls.value - rs.value) / ls.value * 100;
  if (priceDiffPct > 3) return null;
  // Symmetry jarak waktu — buang yang ekstrem asimetris
  const distLS = head.idx - ls.idx;
  const distRS = rs.idx - head.idx;
  if (distLS <= 0 || distRS <= 0) return null;
  const distRatio = distLS / distRS;
  if (distRatio < 0.4 || distRatio > 2.5) return null;
  // Neckline Bulkowski = GARIS penghubung 2 armpit (boleh miring), bukan rata-rata datar.
  // Cari index armpit (low terendah) di tiap segmen, lalu interpolasi linear ke index terakhir.
  const seg1 = sliceL.slice(ls.idx, head.idx + 1);
  const seg2 = sliceL.slice(head.idx, rs.idx + 1);
  const armpit1Val = Math.min(...seg1);
  const armpit1Idx = ls.idx + seg1.indexOf(armpit1Val);
  const armpit2Val = Math.min(...seg2);
  const armpit2Idx = head.idx + seg2.indexOf(armpit2Val);
  const necklineSlope = armpit2Idx !== armpit1Idx ? (armpit2Val - armpit1Val) / (armpit2Idx - armpit1Idx) : 0;
  const necklineAtEnd = armpit1Val + necklineSlope * ((window - 1) - armpit1Idx);
  // Kalau neckline turun (armpit2 < armpit1), konfirmasi pakai right-armpit sesuai aturan Bulkowski
  const necklineForConfirm = necklineSlope < 0 ? armpit2Val : necklineAtEnd;
  // Konfirmasi wajib: close di bawah neckline
  if (closes[n - 1]! >= necklineForConfirm) return null;
  let volConfirmed = false;
  if (volumes.length >= 20) {
    const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    volConfirmed = volumes[volumes.length - 1]! > avgVol;
  }
  // Riset Bulkowski: H&S yang TERLALU simetris justru sedikit lebih lemah (rise 22.8% vs
  // 23.8% pada yang asimetris) — jadi confidence gak dinaikin cuma karena simetris ketat,
  // volume confirmation jadi faktor utama.
  const confidence: 'high' | 'medium' | 'low' = volConfirmed ? 'high' : 'medium';
  return {
    name: 'Head & Shoulders', category: 'reversal', direction: 'bearish', confidence,
    description: `LS ${ls.value.toFixed(4)}, Head ${head.value.toFixed(4)}, RS ${rs.value.toFixed(4)}, neckline ${necklineForConfirm.toFixed(4)} tertembus close${volConfirmed ? ' + volume konfirmasi' : ''}`,
  };
}

function detectInverseHS(highs: number[], lows: number[], closes: number[], volumes: number[] = []): PatternResult | null {
  const n = closes.length;
  const window = 45;
  if (n < window) return null;
  const sliceH = highs.slice(n - window);
  const sliceL = lows.slice(n - window);
  const swingL = findSwingPointsIdx(sliceL, 'low', 2);
  if (swingL.length < 3) return null;
  const [ls, head, rs] = swingL.slice(-3) as [{ idx: number; value: number }, { idx: number; value: number }, { idx: number; value: number }];
  if (!(head.value < ls.value && head.value < rs.value)) return null;
  if (head.value > Math.min(ls.value, rs.value) * 0.99) return null;
  const priceDiffPct = Math.abs(ls.value - rs.value) / ls.value * 100;
  if (priceDiffPct > 3) return null;
  const distLS = head.idx - ls.idx;
  const distRS = rs.idx - head.idx;
  if (distLS <= 0 || distRS <= 0) return null;
  const distRatio = distLS / distRS;
  if (distRatio < 0.4 || distRatio > 2.5) return null;
  // Neckline Bulkowski = GARIS penghubung 2 armpit (boleh miring), bukan rata-rata datar.
  const seg1 = sliceH.slice(ls.idx, head.idx + 1);
  const seg2 = sliceH.slice(head.idx, rs.idx + 1);
  const armpit1Val = Math.max(...seg1);
  const armpit1Idx = ls.idx + seg1.indexOf(armpit1Val);
  const armpit2Val = Math.max(...seg2);
  const armpit2Idx = head.idx + seg2.indexOf(armpit2Val);
  const necklineSlope = armpit2Idx !== armpit1Idx ? (armpit2Val - armpit1Val) / (armpit2Idx - armpit1Idx) : 0;
  const necklineAtEnd = armpit1Val + necklineSlope * ((window - 1) - armpit1Idx);
  // Kalau neckline naik (armpit2 > armpit1), konfirmasi pakai right-armpit sesuai aturan Bulkowski
  const necklineForConfirm = necklineSlope > 0 ? armpit2Val : necklineAtEnd;
  if (closes[n - 1]! <= necklineForConfirm) return null;
  let volConfirmed = false;
  if (volumes.length >= 20) {
    const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    volConfirmed = volumes[volumes.length - 1]! > avgVol;
  }
  // Riset Bulkowski: H&S yang TERLALU simetris justru sedikit lebih lemah — confidence
  // gak dinaikin cuma karena simetris ketat, volume confirmation jadi faktor utama.
  const confidence: 'high' | 'medium' | 'low' = volConfirmed ? 'high' : 'medium';
  return {
    name: 'Inverse H&S', category: 'reversal', direction: 'bullish', confidence,
    description: `LS ${ls.value.toFixed(4)}, Head ${head.value.toFixed(4)}, RS ${rs.value.toFixed(4)}, neckline ${necklineForConfirm.toFixed(4)} tertembus close${volConfirmed ? ' + volume konfirmasi' : ''}`,
  };
}

function detectRisingWedge(highs: number[], lows: number[], closes: number[], volumes: number[] = []): PatternResult | null {
  const n = closes.length;
  const window = 30;
  if (n < window) return null;
  const sliceH = highs.slice(n - window);
  const sliceL = lows.slice(n - window);
  const swingH = findSwingPointsIdx(sliceH, 'high', 2);
  const swingL = findSwingPointsIdx(sliceL, 'low', 2);
  // Bulkowski: minimal 5 titik sentuh total (3 di satu garis, 2 di garis lain)
  if (swingH.length < 3 || swingL.length < 2) return null;
  const rh = swingH.slice(-3);
  const rl = swingL.slice(-Math.min(3, swingL.length));
  const regH = linRegSlope(rh);
  const regL = linRegSlope(rl);
  // Kedua garis wajib naik (ciri wedge, beda dari triangle yang salah satunya flat)
  if (regH.slope <= 0 || regL.slope <= 0) return null;
  // Support wajib naik lebih curam dari resistance → garis konvergen ke apex
  if (Math.abs(regL.slope) <= Math.abs(regH.slope) * 1.05) return null;
  // Verifikasi konvergensi nyata: lebar wedge harus mengecil dari awal ke akhir window
  const widthAt = (idx: number) => (regH.slope * idx + regH.intercept) - (regL.slope * idx + regL.intercept);
  const widthStart = widthAt(0);
  const widthEnd = widthAt(window - 1);
  if (widthStart <= 0 || widthEnd >= widthStart) return null;
  // Volume mengecil selama pembentukan — ciri wedge valid (7 dari 10 kasus per riset Bulkowski)
  let volDeclining = false;
  if (volumes.length >= window) {
    const avgVolEarly = volumes.slice(n - window, n - window + 10).reduce((a, b) => a + b, 0) / 10;
    const avgVolRecent = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    volDeclining = avgVolRecent < avgVolEarly;
  }
  return {
    // Riset Bulkowski: rising wedge rank 32/39 (up) & 36/36 (paling buncit, down) —
    // failure downward breakout sampai 51% (lebih buruk dari lempar koin). Cap medium max,
    // jangan pernah 'high' walau volume declining sempurna.
    name: 'Rising Wedge', category: 'reversal', direction: 'bearish',
    confidence: volDeclining ? 'medium' : 'low',
    description: `${rh.length}x touch resistance, ${rl.length}x touch support, konvergen ke apex${volDeclining ? ', volume mengecil' : ''} — bearish reversal (riset: reliabilitas rendah)`,
  };
}

function detectFallingWedge(highs: number[], lows: number[], closes: number[], volumes: number[] = []): PatternResult | null {
  const n = closes.length;
  const window = 30;
  if (n < window) return null;
  const sliceH = highs.slice(n - window);
  const sliceL = lows.slice(n - window);
  const swingH = findSwingPointsIdx(sliceH, 'high', 2);
  const swingL = findSwingPointsIdx(sliceL, 'low', 2);
  if (swingH.length < 2 || swingL.length < 3) return null;
  const rh = swingH.slice(-Math.min(3, swingH.length));
  const rl = swingL.slice(-3);
  const regH = linRegSlope(rh);
  const regL = linRegSlope(rl);
  // Kedua garis wajib turun
  if (regH.slope >= 0 || regL.slope >= 0) return null;
  // Resistance wajib turun lebih curam dari support → garis konvergen ke apex
  if (Math.abs(regH.slope) <= Math.abs(regL.slope) * 1.05) return null;
  const widthAt = (idx: number) => (regH.slope * idx + regH.intercept) - (regL.slope * idx + regL.intercept);
  const widthStart = widthAt(0);
  const widthEnd = widthAt(window - 1);
  if (widthStart <= 0 || widthEnd >= widthStart) return null;
  let volDeclining = false;
  if (volumes.length >= window) {
    const avgVolEarly = volumes.slice(n - window, n - window + 10).reduce((a, b) => a + b, 0) / 10;
    const avgVolRecent = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    volDeclining = avgVolRecent < avgVolEarly;
  }
  return {
    // Riset Bulkowski: falling wedge rank 31/39, breakout ke atas cuma 68% (gak pasti),
    // failure 26%. Lebih baik dari rising wedge tapi tetep bukan performer top — cap medium.
    name: 'Falling Wedge', category: 'reversal', direction: 'bullish',
    confidence: volDeclining ? 'medium' : 'low',
    description: `${rh.length}x touch resistance, ${rl.length}x touch support, konvergen ke apex${volDeclining ? ', volume mengecil' : ''} — bullish reversal`,
  };
}

/**
 * Cup and Handle — pattern continuation bullish.
 * PENTING soal atribusi (riset validasi menemukan beberapa angka di versi lama salah label):
 * Bulkowski cuma nentuin bentuk (U-shape, rims setinggi, handle di paruh atas) tanpa angka
 * ketat. Angka-angka persentase (preceding rise, cup depth, volume breakout) itu aturan
 * ORIGINAL O'NEIL/CANSLIM, bukan Bulkowski — meski Bulkowski sendiri di bukunya akhirnya
 * ikut pakai threshold O'Neil karena gak punya angka sendiri yang lebih baik.
 * Kriteria:
 * 1. Preceding uptrend wajib [O'Neil: minimal 30%, di sini dikompromikan ke 20% buat crypto]
 * 2. Cup U-shape (rounding bottom), bukan V-shape tajam [Bulkowski + O'Neil]
 * 3. Cup depth 10-50% retracement dari left rim [O'Neil ideal 12-33%, bukan Bulkowski]
 * 4. Left rim & right rim harus rough sama tinggi (toleransi ~8%, crypto lebih volatile dari saham)
 * 5. Handle wajib terbentuk di ATAS midpoint cup [Bulkowski eksplisit konfirmasi aturan O'Neil ini]
 * 6. Handle depth maks 15% dari right rim [O'Neil: 10-15%]
 * 7. Konfirmasi wajib: candle CLOSE di atas rim (breakout), bukan cuma bentuk doang [Bulkowski]
 * 8. Volume breakout ≥1.4x rata-rata → confidence naik [O'Neil: 40-50% di atas rata-rata]
 *
 * Catatan riset: cup & handle adalah salah satu pattern PALING andal di katalog Bulkowski
 * (rank 3/39, failure cuma 5%, rata-rata rise 54%). Tapi studi lanjutan Bulkowski (300 pola,
 * 1990-2024) nemuin 47% pola ini drop signifikan dalam 2 bulan setelah breakout — jangan lupa
 * partial profit-taking, jangan full-hold sampai 100% measured move.
 */
function detectCupAndHandle(highs: number[], lows: number[], closes: number[], volumes: number[] = []): PatternResult | null {
  const n = closes.length;
  const window = 60;
  if (n < window) return null;
  const sliceH = highs.slice(n - window);
  const sliceL = lows.slice(n - window);
  const sliceC = closes.slice(n - window);

  const cupEnd = Math.floor(window * 0.8); // 80% pertama window = cup, 20% terakhir = handle
  if (cupEnd < 20) return null;

  // Left rim: highest high di 25% pertama zona cup
  const leftZoneEnd = Math.floor(cupEnd * 0.25);
  let leftRimIdx = 0, leftRim = sliceH[0]!;
  for (let i = 0; i < leftZoneEnd; i++) {
    if (sliceH[i]! > leftRim) { leftRim = sliceH[i]!; leftRimIdx = i; }
  }

  // Bottom: lowest low di seluruh zona cup
  let bottomIdx = 0, bottomVal = sliceL[0]!;
  for (let i = 0; i < cupEnd; i++) {
    if (sliceL[i]! < bottomVal) { bottomVal = sliceL[i]!; bottomIdx = i; }
  }

  // Right rim: highest high di 25% terakhir zona cup (sebelum handle)
  const rightZoneStart = Math.floor(cupEnd * 0.75);
  let rightRimIdx = rightZoneStart, rightRim = sliceH[rightZoneStart]!;
  for (let i = rightZoneStart; i < cupEnd; i++) {
    if (sliceH[i]! > rightRim) { rightRim = sliceH[i]!; rightRimIdx = i; }
  }

  // Urutan waktu wajib: left rim → bottom → right rim (bentuk U, bukan acak)
  if (!(leftRimIdx < bottomIdx && bottomIdx < rightRimIdx)) return null;

  // Preceding uptrend wajib — tanpa rally sebelumnya, ini bukan continuation pattern valid.
  // O'Neil asli minta 30%; dikompromikan ke 20% karena crypto M30/H4 jarang dapet ruang
  // 30% rise dalam window candle terbatas dibanding data saham daily/weekly.
  const preStart = Math.max(0, n - window - 15);
  const preRise = (leftRim - closes[preStart]!) / closes[preStart]! * 100;
  if (preRise < 20) return null;

  // Cup depth: 10-50% retracement dari left rim (O'Neil ideal 12-33%, bukan Bulkowski —
  // kasih toleransi lebih lebar buat volatilitas crypto)
  const cupDepthPct = (leftRim - bottomVal) / leftRim * 100;
  if (cupDepthPct < 10 || cupDepthPct > 50) return null;

  // U-shape check: bottom gak boleh cuma 1 candle tajam (V-shape) — minimal 3 candle di sekitar
  // bottom yang masih dalam radius 20% dari cup depth (menandakan rounding, bukan spike tunggal)
  const roundingTolerance = (leftRim - bottomVal) * 0.2;
  let roundingCandles = 0;
  const roundStart = Math.max(0, bottomIdx - 5);
  const roundEnd = Math.min(cupEnd, bottomIdx + 5);
  for (let i = roundStart; i < roundEnd; i++) {
    if (sliceL[i]! <= bottomVal + roundingTolerance) roundingCandles++;
  }
  if (roundingCandles < 3) return null; // terlalu tajam, kemungkinan V-shape

  // Left & right rim harus rough sama tinggi
  const rimDiffPct = Math.abs(leftRim - rightRim) / leftRim * 100;
  if (rimDiffPct > 8) return null;

  // ── Zona handle ──────────────────────────────────────────────────────────
  const handleH = sliceH.slice(cupEnd);
  const handleL = sliceL.slice(cupEnd);
  if (handleH.length < 3) return null;
  const handleLow = Math.min(...handleL);

  // Handle wajib di atas midpoint cup (aturan O'Neil/Bulkowski)
  const cupMidpoint = (leftRim + bottomVal) / 2;
  if (handleLow < cupMidpoint) return null;

  // Handle depth maks 15% dari right rim
  const handleDepthPct = (rightRim - handleLow) / rightRim * 100;
  if (handleDepthPct > 15) return null;

  // ── Konfirmasi breakout wajib: close di atas rim ────────────────────────
  const rimLevel = Math.max(leftRim, rightRim);
  const lastClose = closes[n - 1]!;
  if (lastClose < rimLevel) return null;

  // Volume breakout — O'Neil (bukan Bulkowski): breakout kuat idealnya volume 40-50%
  // di atas rata-rata. Naikin dari 1.2x ke 1.4x biar lebih dekat standar O'Neil asli.
  let volConfirmed = false;
  if (volumes.length >= 20) {
    const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    volConfirmed = volumes[volumes.length - 1]! > avgVol * 1.4;
  }

  const confidence: 'high' | 'medium' | 'low' =
    cupDepthPct <= 33 && handleDepthPct <= 12 && volConfirmed ? 'high' :
    cupDepthPct <= 40 && handleDepthPct <= 15 ? 'medium' : 'low';

  return {
    name: 'Cup and Handle', category: 'continuation', direction: 'bullish', confidence,
    description: `Cup depth ${cupDepthPct.toFixed(1)}%, handle depth ${handleDepthPct.toFixed(1)}%, breakout di atas rim ${rimLevel.toFixed(4)}${volConfirmed ? ' + volume konfirmasi' : ''}`,
  };
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
      detectAscendingTriangle(h, l, c, v),
      detectDescendingTriangle(h, l, c, v),
      detectSymmetricalTriangle(h, l, c),
      detectPennant(h, l, c, v),
      detectDoubleTop(h, l, c, v),
      detectDoubleBottom(h, l, c, v),
      detectHeadAndShoulders(h, l, c, v),
      detectInverseHS(h, l, c, v),
      detectRisingWedge(h, l, c, v),
      detectFallingWedge(h, l, c, v),
      detectCupAndHandle(h, l, c, v),
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
  menu: 'sniper' | 'breakout' | 'scalping';
  entryTime: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  bias: 'bullish' | 'bearish';
  result: 'TP1' | 'TP2' | 'SL' | 'EXPIRED';
  exitPrice: number;
  rr: number; // R:R terealisasi
  // Kondisi saat sinyal (Sniper — Menu 2)
  hasChoch15M: boolean;
  hasRejection15M: boolean;
  hasPattern: boolean;
  patternConfidence: string;
  zoneTier: number;
  breakoutType?: string;
  volumeRatio?: number;
  hour: number; // jam WIB saat sinyal
  // Kondisi saat sinyal (Scalping — Menu 4, alur H4→M30→M5)
  hasBBSqueeze?: boolean;
  hasEMA34Confirm?: boolean;
  hasM30Correction?: boolean;
  zoneType?: string;
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
    // Khusus Scalping (Menu 4)
    withBBSqueeze?: { trades: number; wins: number; winRate: number };
    withoutBBSqueeze?: { trades: number; wins: number; winRate: number };
    withEMA34Confirm?: { trades: number; wins: number; winRate: number };
    withoutEMA34Confirm?: { trades: number; wins: number; winRate: number };
    withM30Correction?: { trades: number; wins: number; winRate: number };
    withoutM30Correction?: { trades: number; wins: number; winRate: number };
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
  scalpingResult?: BacktestAnalysis & { trades: BacktestTrade[] };
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
    withBBSqueeze: trades.filter(t => t.hasBBSqueeze === true),
    withoutBBSqueeze: trades.filter(t => t.hasBBSqueeze === false),
    withEMA34Confirm: trades.filter(t => t.hasEMA34Confirm === true),
    withoutEMA34Confirm: trades.filter(t => t.hasEMA34Confirm === false),
    withM30Correction: trades.filter(t => t.hasM30Correction === true),
    withoutM30Correction: trades.filter(t => t.hasM30Correction === false),
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
    if (t.menu === 'scalping') {
      if (t.hasBBSqueeze === false) {
        causeCounts['Tidak ada BB Squeeze M30 saat entry'] = (causeCounts['Tidak ada BB Squeeze M30 saat entry'] ?? 0) + 1;
      }
      if (t.hasEMA34Confirm === false) {
        causeCounts['Belum konfirmasi EMA34 H4'] = (causeCounts['Belum konfirmasi EMA34 H4'] ?? 0) + 1;
      }
      if (t.hasM30Correction === false) {
        causeCounts['M30 masih searah H4 (belum koreksi)'] = (causeCounts['M30 masih searah H4 (belum koreksi)'] ?? 0) + 1;
      }
      if (!t.hasPattern) {
        causeCounts['Konfirmasi reversal lemah (bukan pattern M30)'] = (causeCounts['Konfirmasi reversal lemah (bukan pattern M30)'] ?? 0) + 1;
      }
    } else {
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
      if (t.volumeRatio !== undefined && t.volumeRatio < 2) {
        causeCounts['Volume breakout rendah (< 2x)'] = (causeCounts['Volume breakout rendah (< 2x)'] ?? 0) + 1;
      }
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
        `Breakdown sesi: London/NY ${bd.londonNY.winRate}% vs Asian ${bd.asian.winRate}%`
      );
    }
    if (bd.highVolume.winRate > bd.lowVolume.winRate + 10 && bd.lowVolume.trades > 3) {
      recommendations.push(
        `Win rate volume breakout tinggi (${bd.highVolume.winRate}%) jauh lebih baik → Skip sinyal dengan volume ratio < 2x`
      );
    }
    if (bd.withBBSqueeze && bd.withoutBBSqueeze && bd.withBBSqueeze.winRate > bd.withoutBBSqueeze.winRate + 10 && bd.withoutBBSqueeze.trades > 3) {
      recommendations.push(
        `Win rate dengan BB Squeeze M30 (${bd.withBBSqueeze.winRate}%) jauh lebih tinggi dari tanpa squeeze (${bd.withoutBBSqueeze.winRate}%) → Prioritaskan sinyal dengan BB Squeeze aktif`
      );
    }
    if (bd.withEMA34Confirm && bd.withoutEMA34Confirm && bd.withEMA34Confirm.winRate > bd.withoutEMA34Confirm.winRate + 10 && bd.withoutEMA34Confirm.trades > 3) {
      recommendations.push(
        `Win rate dengan konfirmasi EMA34 H4 (${bd.withEMA34Confirm.winRate}%) lebih tinggi dari tanpa konfirmasi (${bd.withoutEMA34Confirm.winRate}%) → Pertimbangkan jadikan EMA34 hard filter`
      );
    }
    if (bd.withM30Correction && bd.withoutM30Correction && bd.withM30Correction.winRate > bd.withoutM30Correction.winRate + 10 && bd.withoutM30Correction.trades > 3) {
      recommendations.push(
        `Win rate saat M30 sudah koreksi dari H4 (${bd.withM30Correction.winRate}%) jauh lebih tinggi dari M30 masih searah (${bd.withoutM30Correction.winRate}%) → Pertimbangkan skip kalau M30 belum koreksi`
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
  maxCandles: number = 48, // max 48 candle H1 = 2 hari
  fillWindowCandles: number = 20 // wajib harga touch entryPrice dalam N candle ke depan, kalau tidak = no-fill
): { result: 'TP1' | 'TP2' | 'SL' | 'EXPIRED' | 'NO_FILL'; exitPrice: number; rr: number } {
  const risk = Math.abs(entryPrice - stopLoss);
  const limit = Math.min(futureHighs.length, maxCandles);
  const fillLimit = Math.min(futureHighs.length, fillWindowCandles);

  // Wajib: harga beneran touch entryPrice dulu (limit order kefill), bukan asumsi instant fill.
  // Kalau harga gak pernah nyampe zona dalam window ini, order dianggap gak pernah kefill —
  // ini realistis: banyak limit order di real market gak kefill karena harga keburu jalan.
  let fillIdx = -1;
  for (let i = 0; i < fillLimit; i++) {
    const high = futureHighs[i]!;
    const low = futureLows[i]!;
    if (low <= entryPrice && entryPrice <= high) { fillIdx = i; break; }
  }
  if (fillIdx === -1) return { result: 'NO_FILL', exitPrice: entryPrice, rr: 0 };

  // Simulasi SL/TP mulai dari candle saat fill terjadi (bukan dari candle 0)
  for (let i = fillIdx; i < limit; i++) {
    const high = futureHighs[i]!;
    const low = futureLows[i]!;

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

// ═════════════════════════════════════════════════════════════════════════════
// Menu 1 — Breakout Entry (konsolidasi H4 → breakout tervolume → retest → entry)
// ═════════════════════════════════════════════════════════════════════════════

export interface BreakoutTradingResult {
  status: 'ready' | 'waiting' | 'approaching' | 'in_zone' | 'expired' | 'no_setup' | 'skip' | 'error';
  symbol: string;
  bias?: 'bullish' | 'bearish';
  breakoutType?: 'continuation' | 'reversal';
  currentPrice: number;
  timestamp: string;
  message?: string;
  score?: number;
  maxScore: number;
  consolidationHigh?: number;
  consolidationLow?: number;
  consolidationCandles?: number;
  brokenLevel?: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit1?: number; // measured move (target utama)
  takeProfit2?: number; // extended 1.618x (target bonus)
  rr1?: number;
  volumeRatio?: number;
  filterResults?: string[];
  // Khusus status 'ready' (belum breakout, masih konsolidasi matang) — pasang stop order duluan
  buyStopPrice?: number;
  sellStopPrice?: number;
  rangeHeight?: number;
  leanBias?: 'bullish' | 'bearish' | 'neutral'; // kecenderungan arah dari struktur internal konsolidasi
  // Probabilitas arah — komposit dari 4 sinyal (posisi harga, trend sebelumnya, struktur
  // internal, distribusi volume). SELALU tampilin dua sisi, ini cuma bobot tambahan,
  // bukan sinyal pasti — breakout tetep bisa ke arah manapun.
  directionalProbability?: {
    bullishPct: number;
    bearishPct: number;
    reasoning: string[];
  };
  // Anticipation Entry — entry di dalam konsolidasi sebelum breakout, searah trend besar
  anticipationEntry?: {
    direction: 'bullish' | 'bearish';
    entryPrice: number; // deket support (bullish) / resistance (bearish)
    stopLoss: number; // tight, di luar entry point
    sizeNote: string; // saran position sizing
    trendContext: string; // penjelasan trend besar yang mendasari
  };
}

/**
 * Hitung probabilitas arah breakout — komposit dari 4 sinyal, masing-masing dikasih
 * skor -1 (bearish penuh) sampai +1 (bullish penuh), digabung pakai bobot, lalu
 * dikonversi ke persentase. Dicap max 90/10 — breakout emang inherently gak pasti,
 * jangan pernah kasih kesan 100% yakin ke satu arah.
 *
 * Sinyal & bobot:
 * 1. Posisi harga relatif ke tengah range (bobot 15%) — sinyal paling lemah/naif
 * 2. Trend H4 sebelum konsolidasi mulai (bobot 30%) — underlying trend, biasanya paling kuat
 * 3. Struktur internal konsolidasi: higher-low / lower-high di dalam range (bobot 25%)
 * 4. Distribusi volume: lebih rame di deket support (akumulasi) atau resistance (distribusi) (bobot 30%)
 */
function calcDirectionalProbability(
  h4: KlineData,
  consolStart: number,
  consolEnd: number,
  consolHigh: number,
  consolLow: number,
  leanBias: 'bullish' | 'bearish' | 'neutral',
  trendPreStruct: PriceStructure
): { bullishPct: number; bearishPct: number; reasoning: string[] } {
  const reasoning: string[] = [];
  const range = consolHigh - consolLow;

  // 1. Posisi harga (dari leanBias yang udah dihitung)
  const posScore = leanBias === 'bullish' ? 1 : leanBias === 'bearish' ? -1 : 0;
  if (leanBias !== 'neutral') reasoning.push(`Posisi harga condong ${leanBias === 'bullish' ? 'atas' : 'bawah'} range`);

  // 2. Trend sebelum konsolidasi (sinyal paling kuat — underlying trend)
  const strengthMul = trendPreStruct.strength === 'strong' ? 1 : trendPreStruct.strength === 'moderate' ? 0.6 : 0.3;
  const trendScore = trendPreStruct.bias === 'bullish' ? strengthMul : trendPreStruct.bias === 'bearish' ? -strengthMul : 0;
  if (trendPreStruct.bias !== 'ranging') {
    reasoning.push(`Trend H4 sebelum konsolidasi: ${trendPreStruct.bias} (${trendPreStruct.strength})`);
  }

  // 3. Struktur internal — higher-low (bullish) atau lower-high (bearish) di dalam range
  const wh = h4.highs.slice(consolStart, consolEnd);
  const wl = h4.lows.slice(consolStart, consolEnd);
  const half = Math.floor(wh.length / 2);
  const firstHalfMinLow = Math.min(...wl.slice(0, half));
  const secondHalfMinLow = Math.min(...wl.slice(half));
  const firstHalfMaxHigh = Math.max(...wh.slice(0, half));
  const secondHalfMaxHigh = Math.max(...wh.slice(half));
  const lowRisingPct = (secondHalfMinLow - firstHalfMinLow) / range;
  const highFallingPct = (firstHalfMaxHigh - secondHalfMaxHigh) / range;
  const narrowScore = Math.max(-1, Math.min(1, lowRisingPct - highFallingPct));
  if (Math.abs(narrowScore) > 0.15) {
    reasoning.push(narrowScore > 0 ? 'Higher-low terbentuk di dalam konsolidasi (mirip ascending triangle)' : 'Lower-high terbentuk di dalam konsolidasi (mirip descending triangle)');
  }

  // 4. Distribusi volume — akumulasi (rame di bawah) vs distribusi (rame di atas)
  const wc = h4.closes.slice(consolStart, consolEnd);
  const wv = h4.volumes.slice(consolStart, consolEnd);
  let lowerThirdVol = 0, upperThirdVol = 0;
  const lowerThreshold = consolLow + range / 3;
  const upperThreshold = consolHigh - range / 3;
  for (let i = 0; i < wc.length; i++) {
    if (wc[i]! <= lowerThreshold) lowerThirdVol += wv[i] ?? 0;
    else if (wc[i]! >= upperThreshold) upperThirdVol += wv[i] ?? 0;
  }
  const totalVol = lowerThirdVol + upperThirdVol;
  const volScore = totalVol > 0 ? (lowerThirdVol - upperThirdVol) / totalVol : 0;
  if (Math.abs(volScore) > 0.15 && totalVol > 0) {
    reasoning.push(volScore > 0 ? 'Volume lebih rame di area support (indikasi akumulasi)' : 'Volume lebih rame di area resistance (indikasi distribusi)');
  }

  // Gabung dengan bobot
  const composite = posScore * 0.15 + trendScore * 0.30 + narrowScore * 0.25 + volScore * 0.30;
  // Cap ke rentang 10-90% — jangan pernah kasih kesan pasti 100%
  const bullishPct = Math.round(Math.max(10, Math.min(90, 50 + composite * 40)));
  const bearishPct = 100 - bullishPct;

  if (reasoning.length === 0) reasoning.push('Sinyal campuran — belum ada kecenderungan arah yang jelas');

  return { bullishPct, bearishPct, reasoning };
}

export async function analyzeBreakoutTrading(symbol: string): Promise<BreakoutTradingResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';
  const maxScore = 6; // 5 filter asli + 1 BTC correlation check
  const filterResults: string[] = [];

  try {
    const [h4, tickerRes] = await Promise.all([
      fetchKlines(symbol, '4h', 200), // fokus H4, 200 candle ke belakang (~33 hari)
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);
    const currentPrice = tickerRes.ok
      ? parseFloat((await tickerRes.json() as { price: string }).price)
      : h4.closes[h4.closes.length - 1]!;

    const n = h4.closes.length;
    if (n < 60) {
      return { status: 'error', symbol, currentPrice, timestamp, message: 'Data H4 tidak cukup', maxScore };
    }

    // ── Cari konsolidasi + breakout tervolume ────────────────────────────
    // Coba beberapa breakoutIdx (candle 1-6 terakhir) x beberapa durasi window konsolidasi (40/25/15 candle),
    // pilih yang paling baru & paling valid (tightest range + touches cukup).
    let best: {
      breakoutIdx: number; consolHigh: number; consolLow: number; consolStart: number;
      bias: 'bullish' | 'bearish'; volRatio: number;
    } | null = null;

    const windowSizes = [40, 25, 15];
    outer: for (let bIdx = n - 1; bIdx >= n - 6 && bIdx >= 20; bIdx--) {
      for (const winSize of windowSizes) {
        const consolStart = bIdx - winSize;
        if (consolStart < 5) continue;
        const wh = h4.highs.slice(consolStart, bIdx);
        const wl = h4.lows.slice(consolStart, bIdx);
        const consolHigh = Math.max(...wh);
        const consolLow = Math.min(...wl);
        const widthPct = ((consolHigh - consolLow) / consolLow) * 100;
        if (widthPct > 12) continue; // range harus ketat

        // Hitung touches: candle yang high-nya deket consolHigh atau low-nya deket consolLow (radius 0.5%)
        let resTouches = 0, supTouches = 0;
        for (let i = 0; i < wh.length; i++) {
          if (Math.abs(wh[i]! - consolHigh) / consolHigh <= 0.005) resTouches++;
          if (Math.abs(wl[i]! - consolLow) / consolLow <= 0.005) supTouches++;
        }
        if (resTouches < 2 || supTouches < 2) continue;

        // Cek breakout candle: close tembus level dengan margin, close jadi patokan (bukan wick)
        const breakoutClose = h4.closes[bIdx]!;
        let bias: 'bullish' | 'bearish' | null = null;
        if (breakoutClose > consolHigh * 1.003) bias = 'bullish';
        else if (breakoutClose < consolLow * 0.997) bias = 'bearish';
        if (!bias) continue;

        // Volume breakout candle wajib >= 1.5x rata-rata 20 candle sebelumnya
        const volWindow = h4.volumes.slice(Math.max(0, bIdx - 20), bIdx);
        const avgVol = volWindow.length > 0 ? volWindow.reduce((a, b) => a + b, 0) / volWindow.length : 0;
        const breakoutVol = h4.volumes[bIdx]!;
        const volRatio = avgVol > 0 ? breakoutVol / avgVol : 0;
        if (volRatio < 1.5) continue;

        // Valid — window dicoba dari terpanjang ke terpendek, jadi ini otomatis yang terbaik buat bIdx ini.
        // bIdx dicoba dari yang paling baru, jadi begitu ketemu langsung dipakai & stop cari.
        best = { breakoutIdx: bIdx, consolHigh, consolLow, consolStart, bias, volRatio };
        break outer;
      }
    }

    if (!best) {
      // ── Fallback: cari konsolidasi MATANG yang belum breakout ──────────
      // Kriteria "matang": range ketat + touches cukup + durasi panjang (≥20 candle)
      // Beda dari deteksi breakout: di sini candle TERAKHIR justru harus MASIH di dalam range.
      let ready: {
        consolHigh: number; consolLow: number; consolStart: number; leanBias: 'bullish' | 'bearish' | 'neutral';
      } | null = null;

      for (const winSize of [60, 40, 25, 20]) {
        const consolStart = n - winSize;
        if (consolStart < 5) continue;
        const wh = h4.highs.slice(consolStart, n);
        const wl = h4.lows.slice(consolStart, n);
        const wc = h4.closes.slice(consolStart, n);
        const consolHigh = Math.max(...wh);
        const consolLow = Math.min(...wl);
        const widthPct = ((consolHigh - consolLow) / consolLow) * 100;
        if (widthPct > 12) continue;

        let resTouches = 0, supTouches = 0;
        for (let i = 0; i < wh.length; i++) {
          if (Math.abs(wh[i]! - consolHigh) / consolHigh <= 0.005) resTouches++;
          if (Math.abs(wl[i]! - consolLow) / consolLow <= 0.005) supTouches++;
        }
        if (resTouches < 2 || supTouches < 2) continue;

        // Candle terakhir wajib MASIH di dalam range (belum breakout)
        const lastClose = wc[wc.length - 1]!;
        if (lastClose > consolHigh || lastClose < consolLow) continue;

        // Lean bias: bandingin posisi 5 candle terakhir relatif ke tengah range
        const mid = (consolHigh + consolLow) / 2;
        const recent5 = wc.slice(-5);
        const avgRecent = recent5.reduce((a, b) => a + b, 0) / recent5.length;
        const leanBias: 'bullish' | 'bearish' | 'neutral' =
          avgRecent > mid * 1.01 ? 'bullish' : avgRecent < mid * 0.99 ? 'bearish' : 'neutral';

        ready = { consolHigh, consolLow, consolStart, leanBias };
        break; // window terpanjang yang valid duluan dipakai (konsolidasi paling matang)
      }

      if (!ready) {
        return { status: 'no_setup', symbol, currentPrice, timestamp, message: 'Tidak ada breakout atau konsolidasi matang dalam 200 candle terakhir', maxScore, filterResults };
      }

      const rangeHeight = ready.consolHigh - ready.consolLow;
      const buyStopPrice = ready.consolHigh * 1.003;
      const sellStopPrice = ready.consolLow * 0.997;
      const candles = n - ready.consolStart;
      const leanMsg = ready.leanBias === 'bullish' ? ' (kecenderungan ke atas)' : ready.leanBias === 'bearish' ? ' (kecenderungan ke bawah)' : '';

      // ── Anticipation Entry: entry DI DALAM konsolidasi, searah trend besar ──
      // Cuma muncul kalau ada trend jelas sebelum konsolidasi (bukan ranging).
      // Konsep: beli deket support kalau trend besar naik (atau jual deket resistance kalau turun),
      // posisi kecil dulu, tambah setelah breakout beneran terkonfirmasi.
      const trendPreStart = Math.max(0, ready.consolStart - 20);
      const trendPreStruct = analyzePriceActionStructure(
        h4.highs.slice(trendPreStart, ready.consolStart),
        h4.lows.slice(trendPreStart, ready.consolStart),
        h4.closes.slice(trendPreStart, ready.consolStart)
      );
      const atrH4Ready = calcATR(h4.highs, h4.lows, h4.closes);
      let anticipationEntry: BreakoutTradingResult['anticipationEntry'] = undefined;
      if (trendPreStruct.bias === 'bullish') {
        const entryPrice = ready.consolLow * 1.005; // deket support, sedikit di atasnya
        anticipationEntry = {
          direction: 'bullish',
          entryPrice,
          stopLoss: ready.consolLow - atrH4Ready * 0.3, // tight, di bawah support
          sizeNote: 'Posisi kecil (±40%) di sini, tambah sisanya setelah breakout ke atas terkonfirmasi + volume',
          trendContext: `Trend H4 sebelum konsolidasi: bullish (${trendPreStruct.strength}) — anticipation buy di deket support`,
        };
      } else if (trendPreStruct.bias === 'bearish') {
        const entryPrice = ready.consolHigh * 0.995; // deket resistance, sedikit di bawahnya
        anticipationEntry = {
          direction: 'bearish',
          entryPrice,
          stopLoss: ready.consolHigh + atrH4Ready * 0.3, // tight, di atas resistance
          sizeNote: 'Posisi kecil (±40%) di sini, tambah sisanya setelah breakout ke bawah terkonfirmasi + volume',
          trendContext: `Trend H4 sebelum konsolidasi: bearish (${trendPreStruct.strength}) — anticipation sell di deket resistance`,
        };
      }
      // Kalau trend sebelumnya ranging juga — gak ada anticipation entry, cuma stop order dua sisi
      // (false breakout risk terlalu tinggi tanpa trend besar yang jelas mendukung satu arah)

      // Probabilitas arah komposit — SELALU dua sisi, ini cuma bobot tambahan
      const directionalProbability = calcDirectionalProbability(
        h4, ready.consolStart, n, ready.consolHigh, ready.consolLow, ready.leanBias, trendPreStruct
      );

      const filterResultsReady: string[] = [
        `✅ Konsolidasi matang: ${ready.consolLow.toFixed(4)}–${ready.consolHigh.toFixed(4)} (${candles} candle)`,
        `ℹ️ Belum breakout${leanMsg} — pasang Buy Stop di ${buyStopPrice.toFixed(4)} & Sell Stop di ${sellStopPrice.toFixed(4)}`,
        `📊 Probabilitas: ${directionalProbability.bullishPct}% Bullish / ${directionalProbability.bearishPct}% Bearish — ${directionalProbability.reasoning.join('; ')}`,
      ];
      if (anticipationEntry) {
        filterResultsReady.push(`🎯 ${anticipationEntry.trendContext}`);
        filterResultsReady.push(`⚠️ Anticipation entry tetap berisiko — probabilitas false breakout riset independen 60-70%, wajib posisi kecil + SL ketat`);
      } else {
        filterResultsReady.push(`⚠️ Trend sebelum konsolidasi ranging — gak ada anticipation entry, arah belum pasti. Risiko false breakout lebih tinggi dari entry retest biasa`);
      }

      return {
        status: 'ready', symbol, currentPrice, timestamp, maxScore,
        score: 3,
        consolidationHigh: ready.consolHigh, consolidationLow: ready.consolLow,
        consolidationCandles: candles,
        buyStopPrice, sellStopPrice, rangeHeight, leanBias: ready.leanBias,
        directionalProbability,
        anticipationEntry,
        filterResults: filterResultsReady,
        message: `SIAP BREAKOUT — Konsolidasi matang${leanMsg}${anticipationEntry ? ', ada anticipation entry' : ''}`,
      };
    }

    let score = 0;
    score++;
    filterResults.push(`✅ Konsolidasi H4: ${best.consolLow.toFixed(4)}–${best.consolHigh.toFixed(4)} (${best.breakoutIdx - best.consolStart} candle)`);
    score++;
    filterResults.push(`✅ Breakout ${best.bias === 'bullish' ? 'ke atas' : 'ke bawah'} dengan volume ${best.volRatio.toFixed(1)}x rata-rata`);

    // ── Tentuin continuation vs reversal — bandingin trend sebelum konsolidasi ──
    const preStart = Math.max(0, best.consolStart - 20);
    const preStruct = analyzePriceActionStructure(
      h4.highs.slice(preStart, best.consolStart),
      h4.lows.slice(preStart, best.consolStart),
      h4.closes.slice(preStart, best.consolStart)
    );
    const breakoutType: 'continuation' | 'reversal' =
      preStruct.bias === best.bias ? 'continuation' : preStruct.bias !== 'ranging' ? 'reversal' : 'continuation';
    score++;
    filterResults.push(`✅ Tipe: ${breakoutType === 'continuation' ? 'Continuation (lanjutan trend)' : 'Reversal (perubahan arah trend)'}`);

    // BTC Correlation Filter — sinyal searah BTC lebih aman dari efek "ke-tarik"
    // gerakan makro (cascading liquidation, panic sell/FOMO). Bukan hard-skip,
    // cuma penyesuaian score + warning.
    const btcCheck = await checkBtcAlignment(best.bias, symbol);
    if (btcCheck.message) {
      filterResults.push(btcCheck.message);
      if (btcCheck.aligned && btcCheck.btcBias !== 'ranging') score++;
    }

    // ── Entry, SL, TP ─────────────────────────────────────────────────────
    const atrH4 = calcATR(h4.highs, h4.lows, h4.closes);
    const bufferH4 = atrH4 * 0.3;
    const brokenLevel = best.bias === 'bullish' ? best.consolHigh : best.consolLow;
    const entryPrice = brokenLevel;
    // FIX: sebelumnya SL cuma brokenLevel ± buffer doang, gak ada pengaman minimum —
    // pas ATR H4 lagi kecil (market kalem), SL bisa nempel deket banget ke entry.
    // Sekarang dipaksa minimal 1x ATR H4 dari entry, konsisten sama Menu 2 & 4.
    const stopLoss = best.bias === 'bullish'
      ? Math.min(brokenLevel - bufferH4, entryPrice - atrH4)
      : Math.max(brokenLevel + bufferH4, entryPrice + atrH4);
    const height = best.consolHigh - best.consolLow;
    const dir = best.bias === 'bullish' ? 1 : -1;
    const takeProfit1 = brokenLevel + height * dir; // measured move
    const takeProfit2 = brokenLevel + height * 1.618 * dir; // extended target

    const risk = Math.abs(entryPrice - stopLoss);
    if (risk <= 0) {
      return { status: 'no_setup', symbol, currentPrice, timestamp, message: 'Risk tidak valid', maxScore, filterResults };
    }
    const rr1 = Math.round((Math.abs(takeProfit1 - entryPrice) / risk) * 10) / 10;
    score++;
    filterResults.push(`✅ Entry di level breakout ${brokenLevel.toFixed(4)}, target measured move ${takeProfit1.toFixed(4)} (R:R ${rr1})`);

    // ── Status: WAITING → MENDEKATI → BAGUS (retest) atau EXPIRED (gagal) ──
    let status: BreakoutTradingResult['status'] = 'waiting';
    const retestDistPct = best.bias === 'bullish'
      ? ((currentPrice - brokenLevel) / brokenLevel) * 100
      : ((brokenLevel - currentPrice) / brokenLevel) * 100;

    if (best.bias === 'bullish' ? currentPrice < stopLoss : currentPrice > stopLoss) {
      status = 'expired'; // breakout gagal, harga udah balik ke bawah level + buffer
    } else if (retestDistPct >= -0.3 && retestDistPct <= 0.3) {
      status = 'in_zone'; // harga udah nyentuh level breakout — retest terjadi
      score++;
      filterResults.push(`✅ Harga sudah retest level ${brokenLevel.toFixed(4)}`);
    } else if (retestDistPct > 0.3 && retestDistPct <= (atrH4 / brokenLevel) * 100) {
      status = 'approaching'; // harga mendekati level, dalam radius 1x ATR H4
    } else if (retestDistPct > (atrH4 / brokenLevel) * 100) {
      status = 'waiting'; // masih jauh dari level, belum ada tanda mau retest
    } else {
      status = 'expired'; // retestDistPct negatif signifikan tapi belum kena SL — anggap invalid/whipsaw
    }

    // Time-based expiry: breakout kejadian > 40 candle H4 lalu (~6.7 hari) tanpa retest = basi
    if (n - 1 - best.breakoutIdx > 40 && status !== 'in_zone') {
      status = 'expired';
    }

    const statusMsg =
      status === 'in_zone' ? `BAGUS — Harga sudah tersentuh level breakout, entry sekarang` :
      status === 'approaching' ? `MENDEKATI — Harga menuju level breakout, siap pasang limit` :
      status === 'waiting' ? `WAITING — Breakout terjadi, menunggu harga retest level` :
      `EXPIRED — Breakout gagal atau sudah lewat waktu retest wajar`;

    return {
      status, symbol, bias: best.bias, breakoutType, currentPrice, timestamp, score, maxScore,
      consolidationHigh: best.consolHigh, consolidationLow: best.consolLow,
      consolidationCandles: best.breakoutIdx - best.consolStart,
      brokenLevel, entryPrice, stopLoss, takeProfit1, takeProfit2, rr1,
      volumeRatio: best.volRatio, filterResults, message: statusMsg,
    };
  } catch (err) {
    return { status: 'error', symbol, currentPrice: 0, timestamp, message: err instanceof Error ? err.message : 'Unknown error', maxScore };
  }
}

function getPeriodLimit(period: '1m' | '3m' | '6m' | '1y' | '2y' | '3y'): number {
  // H1 candles needed
  const map: Record<string, number> = { '1m': 720, '3m': 2160, '6m': 4320, '1y': 8640, '2y': 17280, '3y': 25920 };
  return map[period] ?? 8640;
}

export async function runBacktest(
  symbol: string,
  period: '1m' | '3m' | '6m' | '1y' | '2y' | '3y',
  menu: 'sniper' | 'breakout' | 'scalping' | 'both',
  useZigZag: boolean = true
): Promise<BacktestResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';

  const limit = getPeriodLimit(period);
  const periodLabel = { '1m': '1 Bulan', '3m': '3 Bulan', '6m': '6 Bulan', '1y': '1 Tahun', '2y': '2 Tahun', '3y': '3 Tahun' }[period]!;

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
  const [h4Data, h1Data, m15Data, m30Data] = await Promise.all([
    fetchHistorical('4h', Math.ceil(limit / 4)),
    fetchHistorical('1h', limit),
    fetchHistorical('15m', limit * 4),
    fetchHistorical('30m', limit * 2),
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
      // Backtest: pakai H4 slice sebagai proxy D1 (tidak fetch D1 terpisah)
      const structH4 = analyzePriceActionStructure(h4Slice.highs, h4Slice.lows, h4Slice.closes);
      if (structH4.bias === 'ranging') continue;
      const bias = structH4.bias as 'bullish' | 'bearish';

      // HARD FILTER: konfirmasi ZigZag (threshold 3%, proxy D1 dari H4 slice)
      if (useZigZag) {
        const zzD1proxy = zigzagBias(h4Slice.highs, h4Slice.lows, 3);
        if (zzD1proxy.bias === 'ranging' || zzD1proxy.bias !== bias) continue;
      }

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
      if (sim.result === 'NO_FILL') continue; // limit order gak pernah kefill — bukan trade real

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
        zoneTier: selectedZone.tier, // fix: sebelumnya hardcode 1 (selalu "Tier 1-2"), sekarang pakai tier real
        hour,
      });
    }

    result.sniperResult = { ...buildAnalysis(sniperTrades), trades: sniperTrades };
  }

  // ─── BACKTEST MENU 4 (SCALPING) ────────────────────────────────────────────
  if (menu === 'breakout' || menu === 'scalping' || menu === 'both') {
    const scalpingTrades: BacktestTrade[] = [];
    const m30Total = m30Data.closes.length;
    const MIN_M30 = 60;

    for (let j = MIN_M30; j < m30Total - 20; j++) {
      // Slice M30 data sampai titik j
      const h30 = m30Data.highs.slice(0, j);
      const l30 = m30Data.lows.slice(0, j);
      const c30 = m30Data.closes.slice(0, j);
      const o30 = m30Data.opens.slice(0, j);
      const v30 = m30Data.volumes.slice(0, j);
      const currentPrice = c30[c30.length - 1]!;

      // H4 slice ekuivalen (1 candle H4 = 8 candle M30)
      const h4Idx = Math.floor(j / 8);
      if (h4Idx < 15 || h4Idx >= h4Data.closes.length) continue;
      const h4s = {
        highs: h4Data.highs.slice(0, h4Idx), lows: h4Data.lows.slice(0, h4Idx),
        closes: h4Data.closes.slice(0, h4Idx), opens: h4Data.opens.slice(0, h4Idx),
      };
      // H1 slice ekuivalen (1 candle H1 = 2 candle M30)
      const h1Idx = Math.floor(j / 2);
      if (h1Idx < 20 || h1Idx >= h1Data.closes.length) continue;
      const h1s = {
        highs: h1Data.highs.slice(0, h1Idx), lows: h1Data.lows.slice(0, h1Idx), closes: h1Data.closes.slice(0, h1Idx),
      };

      // ── Filter 1: Struktur H4 — ranging skip ─────────────────────────────
      const structH4 = analyzePriceActionStructure(h4s.highs, h4s.lows, h4s.closes);
      if (structH4.bias === 'ranging') continue;
      const bias = structH4.bias as 'bullish' | 'bearish';

      // HARD FILTER: konfirmasi ZigZag H4 (threshold 3%)
      if (useZigZag) {
        const zzH4bt = zigzagBias(h4s.highs, h4s.lows, 3);
        if (zzH4bt.bias === 'ranging' || zzH4bt.bias !== bias) continue;
      }

      // EMA34 H4 — info saja (bukan hard filter, sesuai live)
      const ema34H4 = (() => {
        const period = 34;
        if (h4s.closes.length < period) return h4s.closes[h4s.closes.length - 1]!;
        const k = 2 / (period + 1);
        let ema = h4s.closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let x = period; x < h4s.closes.length; x++) ema = h4s.closes[x]! * k + ema * (1 - k);
        return ema;
      })();
      const lastCloseH4 = h4s.closes[h4s.closes.length - 1]!;
      const ema34Confirm = (bias === 'bullish' && lastCloseH4 > ema34H4) || (bias === 'bearish' && lastCloseH4 < ema34H4);

      // ── Filter 2: ATR H4 >= 0.5% ─────────────────────────────────────────
      const atrH4 = calcATR(h4s.highs, h4s.lows, h4s.closes);
      if ((atrH4 / currentPrice) * 100 < 0.5) continue;

      // BB Squeeze M30 — info/scoring saja (bukan hard filter, sesuai live)
      const bbSqueeze = detectBBSqueeze(c30.slice(-40), 20, 20);

      // ── M30 vs H4 — koreksi valid atau masih searah (warning, tetap lanjut) ──
      const structM30 = analyzePriceActionStructure(h30.slice(-30), l30.slice(-30), c30.slice(-30));
      const m30Correction = structM30.bias !== bias;

      // ── Filter 3: Zona retest M30 (OB>FVG>S&R>Fib, UFO diskip di backtest) ──
      const obs30 = detectOrderBlocksH1(o30, h30, l30, c30, bias, 50);
      const fvgs30 = detectFVGH1(h30, l30, bias, 50);
      const sr30 = detectSRLevels(h30, l30, c30);
      const snd30 = detectSnDZones(h30, l30, c30, v30);
      const fib30 = calcFibonacci(h30, l30, c30);
      const maxDist = atrH4 * 3;

      const obsFiltered = obs30.filter(ob => {
        const dist = bias === 'bullish' ? currentPrice - ob.high : ob.low - currentPrice;
        return dist >= 0 && dist <= maxDist;
      });
      const fvgsFiltered = fvgs30.filter(fvg => {
        const dist = bias === 'bullish' ? currentPrice - fvg.high : fvg.low - currentPrice;
        return dist >= 0 && dist <= maxDist;
      });
      const srFiltered = sr30.filter(sr => Math.abs(currentPrice - sr.price) <= maxDist * 0.5);

      const bestZone = selectBestZoneH1(obsFiltered, fvgsFiltered, [], srFiltered, snd30, fib30, bias, currentPrice);
      if (!bestZone) continue;

      // ── Filter 4: Konfirmasi reversal — Pattern M30 ATAU RSI divergence H1 ──
      const bullPatterns = ['Double Bottom', 'Inverse H&S', 'Falling Wedge', 'Bull Flag', 'Ascending Triangle', 'Cup and Handle'];
      const bearPatterns = ['Double Top', 'Head & Shoulders', 'Rising Wedge', 'Bear Flag', 'Descending Triangle'];
      const validPatterns = bias === 'bullish' ? bullPatterns : bearPatterns;
      const pats30 = [
        detectBullFlag(h30, l30, c30, v30), detectBearFlag(h30, l30, c30, v30),
        detectDoubleBottom(h30, l30, c30, v30), detectDoubleTop(h30, l30, c30, v30),
        detectInverseHS(h30, l30, c30, v30), detectHeadAndShoulders(h30, l30, c30, v30),
        detectFallingWedge(h30, l30, c30, v30), detectRisingWedge(h30, l30, c30, v30),
        detectAscendingTriangle(h30, l30, c30, v30), detectDescendingTriangle(h30, l30, c30, v30),
        detectCupAndHandle(h30, l30, c30, v30),
      ].filter(p => p && validPatterns.includes(p!.name));

      const rsiSeriesH1 = calcRSISeries(h1s.closes);
      const swingHighsH1 = findSwingPointsIdx(h1s.highs, 'high', 2);
      const swingLowsH1 = findSwingPointsIdx(h1s.lows, 'low', 2);
      let rsiDivergence = false;
      if (bias === 'bullish' && swingLowsH1.length >= 2) {
        const lA = swingLowsH1[swingLowsH1.length - 2]!, lB = swingLowsH1[swingLowsH1.length - 1]!;
        const rA = rsiSeriesH1[lA.idx] ?? 50, rB = rsiSeriesH1[lB.idx] ?? 50;
        rsiDivergence = lB.value < lA.value && rB > rA + 2 && rB < 45;
      } else if (bias === 'bearish' && swingHighsH1.length >= 2) {
        const hA = swingHighsH1[swingHighsH1.length - 2]!, hB = swingHighsH1[swingHighsH1.length - 1]!;
        const rA = rsiSeriesH1[hA.idx] ?? 50, rB = rsiSeriesH1[hB.idx] ?? 50;
        rsiDivergence = hB.value > hA.value && rB < rA - 2 && rB > 55;
      }
      const hasConfirmation = pats30.length > 0 || rsiDivergence;
      if (!hasConfirmation) continue;

      // ── Refine M5 didekati pakai titik presisi 38.2% dalam zona M30 ──────
      // (fetch M5 historis full-period tidak praktis untuk backtest — lihat catatan di response)
      const entryPrice = bias === 'bullish'
        ? bestZone.low + (bestZone.high - bestZone.low) * 0.382
        : bestZone.high - (bestZone.high - bestZone.low) * 0.382;

      // ── Entry, SL, TP — sama persis dengan live ──────────────────────────
      const swingH4H = findSwingHighs(h4s.highs, 10);
      const swingH4L = findSwingLows(h4s.lows, 10);
      const bufferH4 = atrH4 * 0.2;
      let stopLoss: number;
      if (bias === 'bullish') {
        const relevantLows = swingH4L.filter(l => l < entryPrice);
        const nearestLow = relevantLows.length > 0 ? Math.max(...relevantLows) : Math.min(...h4s.lows.slice(-10));
        stopLoss = Math.min(nearestLow - bufferH4, entryPrice - atrH4);
      } else {
        const relevantHighs = swingH4H.filter(h => h > entryPrice);
        const nearestHigh = relevantHighs.length > 0 ? Math.min(...relevantHighs) : Math.max(...h4s.highs.slice(-10));
        stopLoss = Math.max(nearestHigh + bufferH4, entryPrice + atrH4);
      }
      const risk = Math.abs(entryPrice - stopLoss);
      if (risk <= 0) continue;
      const dir = bias === 'bullish' ? 1 : -1;
      const takeProfit1 = entryPrice + risk * 1.5 * dir;
      const takeProfit2 = entryPrice + risk * 3.0 * dir;

      // Simulate: 96 candle M30 ke depan (= 2 hari, sesuai target TP awal user)
      // Fill window 20 candle (10 jam) — limit order wajib kefill dalam waktu wajar
      const futEnd = Math.min(m30Total, j + 96);
      const futH = m30Data.highs.slice(j, futEnd);
      const futL = m30Data.lows.slice(j, futEnd);
      if (futH.length < 4) continue;
      const sim = simulateTrade(entryPrice, stopLoss, takeProfit1, takeProfit2, bias, futH, futL, 96, 20);
      if (sim.result === 'EXPIRED' || sim.result === 'NO_FILL') continue;

      const entryTime = m30Data.times ? m30Data.times[j]! : Date.now();
      const hour = getWIBHour(entryTime);

      scalpingTrades.push({
        menu: 'scalping', entryTime, entryPrice, stopLoss, takeProfit1, takeProfit2, bias,
        result: sim.result, exitPrice: sim.exitPrice, rr: sim.rr,
        hasChoch15M: true, hasRejection15M: true, // tidak dipakai di alur baru, default true biar gak keitung "gagal"
        hasPattern: pats30.length > 0,
        patternConfidence: pats30.length > 0 ? 'MEDIUM' : (rsiDivergence ? 'LOW' : 'NONE'),
        // FIX BUG: sebelumnya re-derive tier dari zoneType.startsWith('OB'/'FVG') — tapi
        // string zoneType di level H1 pakai kata lengkap "Order Block..." bukan "OB", jadi
        // gak pernah match dan semua Order Block murni salah kejatoh ke Tier 3 (harusnya
        // Tier 1). Sekarang reuse langsung field `.tier` (skala 1-7) yang udah bener dari
        // selectBestZoneH1 — sama kayak yang dipakai scoring live (selectedZone.tier <= 2).
        zoneTier: bestZone.tier,
        hour,
        hasBBSqueeze: bbSqueeze.isSqueezing,
        hasEMA34Confirm: ema34Confirm,
        hasM30Correction: m30Correction,
        zoneType: bestZone.zoneType,
      });
    }

    result.breakoutResult = { ...buildAnalysis(scalpingTrades), trades: scalpingTrades };
    result.scalpingResult = result.breakoutResult;
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