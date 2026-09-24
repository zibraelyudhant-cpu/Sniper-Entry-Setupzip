// SMC (Smart Money Concepts) Analysis Library
// Implements top-down analysis: H4 → H1 → 15M → 5M

import { spawn } from 'child_process';
import nodePath from 'path';
import nodeFs from 'fs';

const BINANCE_FUTURES_BASE = "https://fapi.binance.com";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KlineData {
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  volumes: number[];
  times: number[];
  takerBuyVolumes: number[]; // volume taker BELI (agresif market buy) — dipake buat taker buy ratio (Momentum Hunter)
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

/**
 * Breakdown per-timeframe — sebelumnya info ini ke-selip di dalam teks
 * filterResults/probabilityFactors (harus baca satu-satu buat tau TF mana yang
 * kuat/lemah). Sekarang terstruktur, biar UI bisa nampilin tabel "TF apa →
 * ngecek apa → hasilnya gimana" dengan jelas.
 */
export interface TFBreakdownItem {
  timeframe: string; // "H4", "H1", "M15", "M5", "H2", dst
  label: string;      // deskripsi singkat: "Trend Utama", "Zona Entry", "Trigger", dst
  detail: string;      // hasil dalam bahasa manusia
  status: 'confirm' | 'warning' | 'neutral'; // buat pewarnaan UI (hijau/kuning/abu)
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

  // FIX (ketemu user, kena rate limit Binance setelah universe naik ke 150
  // koin x 2 skill): retry dinaikkan dari 2x ke 3x, delay awal diperpanjang
  // dari 3 detik ke 5 detik (exponential: 5s, 10s, 15s)
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    if (res.status === 418 || res.status === 429) {
      // Rate limited — tunggu sebentar lalu retry
      await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
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
      takerBuyVolumes: data.map((k) => parseFloat(k[9] as string)), // field ke-10 Binance kline: taker buy base asset volume
    };
    klinesCache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  }
  throw new Error(`Klines fetch failed after retries: rate limited`);
}

// ─── Fetch Open Interest & CVD Spot (BARU — basis skill "CVD Spot + OI
// Futures Confluence", gantiin RSI-2, request user) ─────────────────────────

// ─── Utility Calculations ─────────────────────────────────────────────────────

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
  // BUG FIX: DX udah dalam skala persen (0-100), butuh SMOOTHING AVERAGE (Wilder's
  // moving average) buat jadi ADX — BUKAN smooth() biasa yang itu SUM-based
  // (dipake buat TR/+DM/-DM yang emang gitu formulanya). Pakai smooth() lagi di
  // sini bikin ADX numpuk jadi ratusan/ribuan (nge-SUM 14 nilai yang masing2
  // udah 0-100), bukan dibatasi 0-100 kayak seharusnya.
  const smoothAvg = (arr: number[]): number[] => {
    if (arr.length === 0) return [];
    let val = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const result = [val];
    for (let i = period; i < arr.length; i++) {
      val = (val * (period - 1) + arr[i]) / period;
      result.push(val);
    }
    return result;
  };
  const adxSeries = smoothAvg(dx);
  return adxSeries[adxSeries.length - 1] ?? 0;
}

/**
 * ADX + DI terpisah (buat Anticipation Breakout Strategy, request user) --
 * calcADX() di atas cuma return angka ADX doang, di sini butuh +DI/-DI juga
 * (dipakai buat tentuin arah tekanan: +DI>-DI = bullish pressure).
 * Logic PERSIS calcADX, cuma expose plusDI/minusDI juga di return.
 */
function calcADXWithDI(
  highs: number[], lows: number[], closes: number[], period = 14,
): { adx: number; plusDI: number; minusDI: number } {
  const n = closes.length;
  if (n < period * 2) return { adx: 0, plusDI: 0, minusDI: 0 };
  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  for (let i = 1; i < n; i++) {
    const hl = highs[i]! - lows[i]!;
    const hc = Math.abs(highs[i]! - closes[i - 1]!);
    const lc = Math.abs(lows[i]! - closes[i - 1]!);
    trs.push(Math.max(hl, hc, lc));
    const upMove = highs[i]! - highs[i - 1]!;
    const downMove = lows[i - 1]! - lows[i]!;
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const smooth = (arr: number[]): number[] => {
    let val = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const result = [val];
    for (let i = period; i < arr.length; i++) {
      val = val - val / period + arr[i]!;
      result.push(val);
    }
    return result;
  };
  const atr14 = smooth(trs);
  const plusDISeries = smooth(plusDMs).map((v, i) => (v / atr14[i]!) * 100);
  const minusDISeries = smooth(minusDMs).map((v, i) => (v / atr14[i]!) * 100);
  const dx = plusDISeries.map((p, i) => {
    const sum = p + minusDISeries[i]!;
    return sum === 0 ? 0 : (Math.abs(p - minusDISeries[i]!) / sum) * 100;
  });
  const smoothAvg = (arr: number[]): number[] => {
    if (arr.length === 0) return [];
    let val = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const result = [val];
    for (let i = period; i < arr.length; i++) {
      val = (val * (period - 1) + arr[i]!) / period;
      result.push(val);
    }
    return result;
  };
  const adxSeries = smoothAvg(dx);
  return {
    adx: adxSeries[adxSeries.length - 1] ?? 0,
    plusDI: plusDISeries[plusDISeries.length - 1] ?? 0,
    minusDI: minusDISeries[minusDISeries.length - 1] ?? 0,
  };
}

interface PivotPointsResult { pp: number; r1: number; r2: number; s1: number; s2: number; }

/**
 * Pivot Points klasik, basis N-period (request user: "5-period" buat M15) --
 * ambil High tertinggi/Low terendah dari N candle terakhir (candle yang
 * PASTI closed, bukan candle berjalan), Close dari candle terakhir itu.
 * Formula standar: PP=(H+L+C)/3, R1=2PP-L, S1=2PP-H, R2=PP+(H-L), S2=PP-(H-L).
 */
function calcPivotPoints(highs: number[], lows: number[], closes: number[], period = 5): PivotPointsResult {
  const n = closes.length;
  const lastIdx = n - 2; // candle terakhir yang PASTI closed
  const start = Math.max(0, lastIdx - period + 1);
  const h = Math.max(...highs.slice(start, lastIdx + 1));
  const l = Math.min(...lows.slice(start, lastIdx + 1));
  const c = closes[lastIdx]!;
  const pp = (h + l + c) / 3;
  return { pp, r1: 2 * pp - l, r2: pp + (h - l), s1: 2 * pp - h, s2: pp - (h - l) };
}

/** EMA dalam bentuk SERIES penuh (bukan cuma nilai terakhir) — dibutuhin buat MACD. */
function calcEMASeries(values: number[], period: number): number[] {
  const n = values.length;
  const result: number[] = new Array(n);
  if (n === 0) return result;
  const k = 2 / (period + 1);

  if (n < period) {
    // Data kurang dari period — fallback seed pakai value pertama (approksimasi lama)
    let ema = values[0]!;
    result[0] = ema;
    for (let i = 1; i < n; i++) {
      ema = values[i]! * k + ema * (1 - k);
      result[i] = ema;
    }
    return result;
  }

  // FIX: sebelumnya seed EMA pakai values[0] doang (candle pertama) — TradingView
  // standar seed EMA pakai SMA(period) dari N data pertama. Buat EMA pendek
  // (12/21/50) dampaknya kecil, tapi EMA200 butuh banyak candle buat "pulih" dari
  // seed yang kurang akurat. Index sebelum seed penuh diisi cumulative average
  // (approksimasi wajar, jarang diakses langsung — yang penting nilai akhir akurat).
  let cumSum = 0;
  for (let i = 0; i < period; i++) {
    cumSum += values[i]!;
    result[i] = cumSum / (i + 1);
  }
  let ema = cumSum / period; // seed asli: SMA(period)
  result[period - 1] = ema;
  for (let i = period; i < n; i++) {
    ema = values[i]! * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

/**
 * MACD Histogram — beda dari ADX (yang ngukur KEKUATAN trend), MACD histogram
 * ngukur PERCEPATAN momentum. Histogram yang makin lebar (magnitude naik)
 * artinya dorongan trend lagi NAMBAH kenceng, bukan cuma "udah kenceng doang".
 */
interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
  histogramExpanding: boolean; // |histogram sekarang| > |histogram 3 candle lalu|
}

function calcMACD(closes: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): MACDResult {
  if (closes.length < slowPeriod + signalPeriod) return { macd: 0, signal: 0, histogram: 0, histogramExpanding: false };
  const emaFast = calcEMASeries(closes, fastPeriod);
  const emaSlow = calcEMASeries(closes, slowPeriod);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]!);
  const signalLine = calcEMASeries(macdLine, signalPeriod);
  const histogram = macdLine.map((v, i) => v - signalLine[i]!);

  const last = histogram[histogram.length - 1] ?? 0;
  const prev = histogram[histogram.length - 4] ?? last; // 3 candle sebelumnya
  const histogramExpanding = Math.abs(last) > Math.abs(prev);

  return {
    macd: macdLine[macdLine.length - 1] ?? 0,
    signal: signalLine[signalLine.length - 1] ?? 0,
    histogram: last,
    histogramExpanding,
  };
}

export function calcATR(
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
  // FIX: sebelumnya Simple Average dari 14 TR terakhir doang — TradingView default
  // ATR pakai RMA (Wilder's Smoothing), yang "mengingat" histori lebih jauh, gak
  // cuma window 14 candle terakhir. Sekarang disamain.
  if (trs.length === 0) return 0;
  if (trs.length < period) {
    return trs.reduce((a, b) => a + b, 0) / trs.length; // fallback data kurang
  }
  let rma = trs.slice(0, period).reduce((a, b) => a + b, 0) / period; // seed: SMA(period)
  for (let i = period; i < trs.length; i++) {
    rma = (rma * (period - 1) + trs[i]!) / period;
  }
  return rma;
}

/**
 * Session VWAP + Standard Deviation Bands — beda dari EMA/SMA biasa, VWAP
 * dibobotin VOLUME, jadi levelnya nunjukin "di harga mana transaksi paling
 * banyak kejadian" (fair value versi institusional), bukan cuma rata-rata
 * harga doang. Data institusional: 72%+ trader institusi pake VWAP sebagai
 * benchmark eksekusi utama.
 *
 * Session reset tiap hari jam 00:00 UTC (standar buat crypto 24 jam, gak ada
 * "jam buka bursa" kayak saham). SD bands (1x dan 2x) dari typical price
 * (H+L+C)/3, dibobotin volume juga.
 */
interface VWAPBands {
  vwap: number;
  upperBand1: number;
  lowerBand1: number;
  upperBand2: number;
  lowerBand2: number;
}

function calcSessionVWAP(
  highs: number[], lows: number[], closes: number[], volumes: number[], times: number[]
): VWAPBands | null {
  const n = closes.length;
  if (n < 5 || times.length !== n) return null;

  // Cari awal sesi hari ini (UTC midnight terakhir)
  const lastTime = times[n - 1]!;
  const dayStart = Math.floor(lastTime / 86400000) * 86400000;
  let sessionStart = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (times[i]! < dayStart) { sessionStart = i + 1; break; }
  }

  const sh = highs.slice(sessionStart);
  const sl = lows.slice(sessionStart);
  const sc = closes.slice(sessionStart);
  const sv = volumes.slice(sessionStart);
  if (sh.length < 3) return null; // sesi baru mulai, data belum cukup buat VWAP berarti

  let cumTPV = 0, cumV = 0;
  const typicalPrices: number[] = [];
  for (let i = 0; i < sh.length; i++) {
    const tp = (sh[i]! + sl[i]! + sc[i]!) / 3;
    typicalPrices.push(tp);
    cumTPV += tp * sv[i]!;
    cumV += sv[i]!;
  }
  if (cumV === 0) return null;
  const vwap = cumTPV / cumV;

  // Standard deviation dibobotin volume juga (bukan SD biasa)
  let cumVarV = 0;
  for (let i = 0; i < sh.length; i++) {
    cumVarV += sv[i]! * Math.pow(typicalPrices[i]! - vwap, 2);
  }
  const sd = Math.sqrt(cumVarV / cumV);

  return {
    vwap,
    upperBand1: vwap + sd,
    lowerBand1: vwap - sd,
    upperBand2: vwap + sd * 2,
    lowerBand2: vwap - sd * 2,
  };
}

/**
 * Volume Profile — histogram volume-per-harga. Beda dari VWAP (1 garis rata-rata),
 * ini nunjukin DI HARGA BERAPA transaksi paling numpuk sepanjang window candle.
 * Konsep dari Market Profile (CBOT, Steidlmayer 1984) — dipakai institusional
 * puluhan tahun.
 *
 * - POC (Point of Control) = harga dengan volume tertinggi — magnet harga terkuat
 * - Value Area (VAH/VAL) = range yang nyakup 70% volume — "zona wajar" konsensus pasar
 * - HVN (High Volume Node) = level volume tinggi — sering berimpit sama Order Block
 *   (institusi udah "puas" transaksi di situ, jadi support/resistance kuat)
 * - LVN (Low Volume Node) = level volume rendah — sering berimpit sama Fair Value Gap
 *   (harga dulu ngelewatin cepat, jadi kurang reliable buat S/R, gampang ditembus)
 */
interface VolumeProfileResult {
  poc: number;
  vah: number;
  val: number;
  hvnLevels: number[];
  lvnLevels: number[];
}

function calcVolumeProfile(
  highs: number[], lows: number[], closes: number[], volumes: number[], numBuckets = 24
): VolumeProfileResult | null {
  const n = closes.length;
  if (n < 15) return null;

  const maxPrice = Math.max(...highs);
  const minPrice = Math.min(...lows);
  if (maxPrice <= minPrice) return null;
  const bucketSize = (maxPrice - minPrice) / numBuckets;

  const volumeByBucket = new Array(numBuckets).fill(0);
  for (let i = 0; i < n; i++) {
    const h = highs[i]!, l = lows[i]!, v = volumes[i]!;
    // Distribusi volume candle ke SEMUA bucket yang di-cover range high-low candle itu
    // (bukan cuma 1 titik close) — lebih akurat buat ngerepresentasiin di mana transaksi kejadian
    const startBucket = Math.max(0, Math.min(numBuckets - 1, Math.floor((l - minPrice) / bucketSize)));
    const endBucket = Math.max(0, Math.min(numBuckets - 1, Math.floor((h - minPrice) / bucketSize)));
    const bucketsSpanned = endBucket - startBucket + 1;
    const volPerBucket = v / bucketsSpanned;
    for (let b = startBucket; b <= endBucket; b++) volumeByBucket[b] += volPerBucket;
  }

  const totalVolume = volumeByBucket.reduce((a: number, b: number) => a + b, 0);
  if (totalVolume === 0) return null;

  // POC = bucket volume tertinggi
  let pocIdx = 0;
  for (let b = 1; b < numBuckets; b++) if (volumeByBucket[b] > volumeByBucket[pocIdx]) pocIdx = b;
  const poc = minPrice + (pocIdx + 0.5) * bucketSize;

  // Value Area: expand dari POC ke kiri/kanan sampe 70% volume total ke-cover
  // (algoritma standar Market Profile: tiap step ambil sisi dengan volume lebih besar)
  let vaVolume = volumeByBucket[pocIdx];
  let vaLowIdx = pocIdx, vaHighIdx = pocIdx;
  const targetVolume = totalVolume * 0.7;
  while (vaVolume < targetVolume && (vaLowIdx > 0 || vaHighIdx < numBuckets - 1)) {
    const volBelow = vaLowIdx > 0 ? volumeByBucket[vaLowIdx - 1] : -1;
    const volAbove = vaHighIdx < numBuckets - 1 ? volumeByBucket[vaHighIdx + 1] : -1;
    if (volBelow >= volAbove) { vaLowIdx--; vaVolume += volumeByBucket[vaLowIdx]; }
    else { vaHighIdx++; vaVolume += volumeByBucket[vaHighIdx]; }
  }
  const val = minPrice + vaLowIdx * bucketSize;
  const vah = minPrice + (vaHighIdx + 1) * bucketSize;

  // HVN/LVN: bucket dengan volume jauh di atas/bawah rata-rata
  const avgVol = totalVolume / numBuckets;
  const hvnLevels: number[] = [];
  const lvnLevels: number[] = [];
  for (let b = 0; b < numBuckets; b++) {
    const price = minPrice + (b + 0.5) * bucketSize;
    if (volumeByBucket[b] > avgVol * 1.5) hvnLevels.push(price);
    else if (volumeByBucket[b] < avgVol * 0.5) lvnLevels.push(price);
  }

  return { poc, vah, val, hvnLevels, lvnLevels };
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
 * Simple Moving Average — dipakai khusus buat Connors RSI-2 (MA5 exit reference,
 * MA200 trend filter). Sengaja SMA, bukan EMA — Connors & Alvarez (Short Term
 * Trading Strategies That Work, 2008) desain aslinya pakai SMA, jadi dipertahanin
 * biar fidelity ke metodologi yang udah di-backtest 1000+ sinyal.
 */
function calcSMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] ?? 0;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Stochastic Oscillator Slow (%K=14, %D=3, smoothing=3 — parameter paling
 * umum dipake trader, request user). BARU dipake mulai Menu Journal Trading —
 * PURE INFORMASIONAL, gak pernah jadi hard/soft filter di menu manapun (request
 * user eksplisit: indikator yang belum dipake tiap menu ditambahin buat catetan
 * doang di Journal, gak boleh ngubah keputusan sinyal).
 */
function calcStochastic(
  highs: number[], lows: number[], closes: number[],
  kPeriod = 14, dPeriod = 3, smooth = 3
): { k: number; d: number } {
  const n = closes.length;
  if (n < kPeriod + smooth + dPeriod) return { k: 50, d: 50 };

  // %K mentah per candle (raw stochastic), terus di-smooth (jadi "Slow" %K)
  const rawK: number[] = [];
  for (let i = kPeriod - 1; i < n; i++) {
    const windowHigh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const windowLow = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    const range = windowHigh - windowLow;
    rawK.push(range === 0 ? 50 : ((closes[i]! - windowLow) / range) * 100);
  }
  if (rawK.length < smooth) return { k: 50, d: 50 };

  // Slow %K = SMA(raw %K, smooth)
  const slowK: number[] = [];
  for (let i = smooth - 1; i < rawK.length; i++) {
    const slice = rawK.slice(i - smooth + 1, i + 1);
    slowK.push(slice.reduce((a, b) => a + b, 0) / smooth);
  }
  if (slowK.length < dPeriod) return { k: slowK[slowK.length - 1] ?? 50, d: slowK[slowK.length - 1] ?? 50 };

  // %D = SMA(Slow %K, dPeriod)
  const dSlice = slowK.slice(-dPeriod);
  const d = dSlice.reduce((a, b) => a + b, 0) / dPeriod;

  return { k: slowK[slowK.length - 1]!, d };
}

/**
 * MFI (Money Flow Index) — "RSI yang mempertimbangin volume". Beda dari RSI
 * biasa yang cuma baca harga, MFI ngecek apakah pergerakan harga itu
 * DIDUKUNG volume beneran atau enggak (momentum "hollow" vs "genuine").
 * PURE INFORMASIONAL di menu lain (request user awal) — dipake buat riset
 * Journal, gak pernah jadi hard/soft filter. PENGECUALIAN (request user):
 * dipake AKTIF sebagai bagian exhaustion check di Funding Rate Kontrarian
 * doang — di skill lain tetep informasional aja.
 */
function calcMFI(highs: number[], lows: number[], closes: number[], volumes: number[], period = 14): number {
  const n = closes.length;
  if (n < period + 1) return 50;
  const typicalPrices = closes.map((c, i) => (highs[i]! + lows[i]! + c) / 3);
  let posFlow = 0, negFlow = 0;
  for (let i = n - period; i < n; i++) {
    const rawFlow = typicalPrices[i]! * (volumes[i] ?? 0);
    if (typicalPrices[i]! > typicalPrices[i - 1]!) posFlow += rawFlow;
    else if (typicalPrices[i]! < typicalPrices[i - 1]!) negFlow += rawFlow;
  }
  if (negFlow === 0) return 100;
  const moneyRatio = posFlow / negFlow;
  return 100 - (100 / (1 + moneyRatio));
}

/**
 * CCI (Commodity Channel Index) — basis hitungannya beda total dari RSI
 * (deviasi statistik harga dari rata-rata), sering nangkep kondisi
 * ekstrem/divergensi yang RSI kadang telat baca. PURE INFORMASIONAL di menu
 * lain. PENGECUALIAN (request user): dipake AKTIF sebagai bagian exhaustion
 * check di Funding Rate Kontrarian doang.
 */
function calcCCI(highs: number[], lows: number[], closes: number[], period = 20): number {
  const n = closes.length;
  if (n < period) return 0;
  const typicalPrices = closes.map((c, i) => (highs[i]! + lows[i]! + c) / 3);
  const window = typicalPrices.slice(-period);
  const sma = window.reduce((a, b) => a + b, 0) / period;
  const meanDeviation = window.reduce((a, b) => a + Math.abs(b - sma), 0) / period;
  if (meanDeviation === 0) return 0;
  const lastTypical = typicalPrices[typicalPrices.length - 1]!;
  return (lastTypical - sma) / (0.015 * meanDeviation);
}

/**
 * ROC (Rate of Change) — kecepatan gerak harga mentah dalam persen, N
 * candle terakhir. Beda dari oscillator lain (RSI/Stochastic/MFI/CCI, yang
 * semuanya bounded/relatif), ROC ngasih angka mentah "berapa cepat harga
 * gerak" — gampang dibaca buat riset ("pas WIN rata-rata ROC 1.8%, pas LOSE
 * cuma 0.3%" dst). PURE INFORMASIONAL.
 */
function calcROC(closes: number[], period = 12): number {
  const n = closes.length;
  if (n < period + 1) return 0;
  const current = closes[n - 1]!;
  const past = closes[n - 1 - period]!;
  if (past === 0) return 0;
  return ((current - past) / past) * 100;
}

// ─── 12 indikator tambahan buat Journal Trading (request user) ────────────────

/** Williams %R — mirip Stochastic tapi skalanya -100 sampai 0. */
function calcWilliamsR(highs: number[], lows: number[], closes: number[], period = 14): number {
  const n = closes.length;
  if (n < period) return -50;
  const win = n - period;
  const highest = Math.max(...highs.slice(win));
  const lowest = Math.min(...lows.slice(win));
  if (highest === lowest) return -50;
  return ((highest - closes[n - 1]!) / (highest - lowest)) * -100;
}

/** Momentum Indicator — selisih harga sekarang vs N candle lalu (mentah, bukan %). */
function calcMomentum(closes: number[], period = 10): number {
  const n = closes.length;
  if (n < period + 1) return 0;
  return closes[n - 1]! - closes[n - 1 - period]!;
}

/** Awesome Oscillator (Bill Williams) — SMA(5) - SMA(34) dari midpoint (H+L)/2. */
function calcAwesomeOscillator(highs: number[], lows: number[]): number {
  const n = highs.length;
  if (n < 34) return 0;
  const midpoints = highs.map((h, i) => (h + lows[i]!) / 2);
  const sma5 = midpoints.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const sma34 = midpoints.slice(-34).reduce((a, b) => a + b, 0) / 34;
  return sma5 - sma34;
}

/** Chaikin Money Flow — rata-rata Money Flow Volume selama period, dinormalisasi volume. */
function calcChaikinMoneyFlow(highs: number[], lows: number[], closes: number[], volumes: number[], period = 20): number {
  const n = closes.length;
  if (n < period) return 0;
  let mfVolSum = 0, volSum = 0;
  for (let i = n - period; i < n; i++) {
    const range = highs[i]! - lows[i]!;
    const mfMultiplier = range > 0 ? ((closes[i]! - lows[i]!) - (highs[i]! - closes[i]!)) / range : 0;
    mfVolSum += mfMultiplier * volumes[i]!;
    volSum += volumes[i]!;
  }
  return volSum > 0 ? mfVolSum / volSum : 0;
}

/** OBV (On Balance Volume) — akumulasi volume searah pergerakan harga. Return nilai kumulatif mentah. */
function calcOBV(closes: number[], volumes: number[]): number {
  let obv = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i]! > closes[i - 1]!) obv += volumes[i]!;
    else if (closes[i]! < closes[i - 1]!) obv -= volumes[i]!;
  }
  return obv;
}

/** ATR Squeeze — rasio ATR sekarang vs rata-rata ATR N candle lalu. <1 = volatilitas menyempit (squeeze), >1 = melebar. */
function calcATRSqueeze(highs: number[], lows: number[], closes: number[], period = 14, lookback = 20): number {
  const n = closes.length;
  if (n < period + lookback) return 1;
  const atrSeries: number[] = [];
  for (let end = period + 1; end <= n; end++) {
    atrSeries.push(calcATR(highs.slice(0, end), lows.slice(0, end), closes.slice(0, end)));
  }
  const currentATR = atrSeries[atrSeries.length - 1]!;
  const avgATR = atrSeries.slice(-lookback).reduce((a, b) => a + b, 0) / Math.min(lookback, atrSeries.length);
  return avgATR > 0 ? currentATR / avgATR : 1;
}

interface KeltnerChannels { upper: number; middle: number; lower: number; }
/** Keltner Channels — EMA(20) tengah, ± ATR×multiplier. */
function calcKeltnerChannels(highs: number[], lows: number[], closes: number[], period = 20, multiplier = 2): KeltnerChannels {
  const middle = calcEMASeries(closes, period)[closes.length - 1] ?? closes[closes.length - 1] ?? 0;
  const atr = calcATR(highs, lows, closes);
  return { upper: middle + atr * multiplier, middle, lower: middle - atr * multiplier };
}

interface BollingerBandsResult { upper: number; middle: number; lower: number; bandwidth: number; }
/** Bollinger Bands — SMA(20) ± 2×stdev. bandwidth = lebar band relatif ke middle (%), buat baca squeeze/expansion. */
function calcBollingerBands(closes: number[], period = 20, stdMult = 2): BollingerBandsResult {
  const n = closes.length;
  if (n < period) {
    const last = closes[n - 1] ?? 0;
    return { upper: last, middle: last, lower: last, bandwidth: 0 };
  }
  const win = closes.slice(-period);
  const mean = win.reduce((a, b) => a + b, 0) / period;
  const variance = win.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = mean + stdMult * std;
  const lower = mean - stdMult * std;
  return { upper, middle: mean, lower, bandwidth: mean > 0 ? ((upper - lower) / mean) * 100 : 0 };
}

/** Trix — rate of change dari triple-smoothed EMA. Filter noise, baca momentum jangka menengah. */
function calcTrix(closes: number[], period = 15): number {
  if (closes.length < period * 3 + 1) return 0;
  const ema1 = calcEMASeries(closes, period);
  const ema2 = calcEMASeries(ema1, period);
  const ema3 = calcEMASeries(ema2, period);
  const n = ema3.length;
  if (n < 2 || ema3[n - 2] === 0) return 0;
  return ((ema3[n - 1]! - ema3[n - 2]!) / ema3[n - 2]!) * 100;
}

interface ElderRayResult { bullPower: number; bearPower: number; }
/** Elder Ray Index — bull/bear power relatif ke EMA(13). */
function calcElderRay(highs: number[], lows: number[], closes: number[], period = 13): ElderRayResult {
  const ema = calcEMASeries(closes, period);
  const emaLast = ema[ema.length - 1] ?? closes[closes.length - 1] ?? 0;
  const n = highs.length;
  return { bullPower: highs[n - 1]! - emaLast, bearPower: lows[n - 1]! - emaLast };
}

/** VWAP — anchor dari awal hari UTC (00:00), sesuai standar VWAP harian. */
function calcVWAP(highs: number[], lows: number[], closes: number[], volumes: number[], times: number[]): number {
  const n = closes.length;
  if (n === 0) return 0;
  const lastTime = times[n - 1]!;
  const dayStart = Math.floor(lastTime / 86400000) * 86400000; // UTC 00:00 hari yang sama
  let pvSum = 0, volSum = 0;
  for (let i = 0; i < n; i++) {
    if (times[i]! < dayStart) continue;
    const typical = (highs[i]! + lows[i]! + closes[i]!) / 3;
    pvSum += typical * volumes[i]!;
    volSum += volumes[i]!;
  }
  if (volSum === 0) return closes[n - 1]!; // belum ada candle di hari ini (baru mulai) — fallback harga sekarang
  return pvSum / volSum;
}

/** CVD (Cumulative Volume Delta) — akumulasi taker buy - taker sell, dari takerBuyVolumes yang udah ada di KlineData. */
function calcCVD(volumes: number[], takerBuyVolumes: number[]): number {
  let cvd = 0;
  for (let i = 0; i < volumes.length; i++) {
    const takerBuy = takerBuyVolumes[i] ?? 0;
    const takerSell = volumes[i]! - takerBuy;
    cvd += takerBuy - takerSell;
  }
  return cvd;
}

/** Open Interest — BEDA dari indikator lain (butuh fetch API terpisah, bukan dari OHLCV candle). */
async function fetchOpenInterest(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`${BINANCE_FUTURES_BASE}/fapi/v1/openInterest?symbol=${symbol}`);
    if (!res.ok) return null;
    const data = await res.json() as { openInterest: string };
    return parseFloat(data.openInterest);
  } catch {
    return null;
  }
}

/** Histori Open Interest -- dipake buat Fitur 5 TA PRO (OI trend vs harga). Urutan lama->baru sama kayak kline. */
async function fetchOpenInterestHist(symbol: string, period: '1h' | '4h' | '1d', limit: number): Promise<number[] | null> {
  try {
    const res = await fetch(`${BINANCE_FUTURES_BASE}/futures/data/openInterestHist?symbol=${symbol}&period=${period}&limit=${limit}`);
    if (!res.ok) return null;
    const data = await res.json() as { sumOpenInterest: string }[];
    if (!Array.isArray(data) || data.length === 0) return null;
    return data.map((d) => parseFloat(d.sumOpenInterest));
  } catch {
    return null;
  }
}

/** Funding rate terkini (persen, misal 0.0003 = 0.03%). Dipake buat Fitur 5 TA PRO. */
async function fetchFundingRate(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`${BINANCE_FUTURES_BASE}/fapi/v1/premiumIndex?symbol=${symbol}`);
    if (!res.ok) return null;
    const data = await res.json() as { lastFundingRate: string };
    return parseFloat(data.lastFundingRate) * 100; // ke persen
  } catch {
    return null;
  }
}

export interface TFIndicatorSnapshot {
  rsi: number;
  atr: number;
  atrPct: number;
  adx: number;
  stochK: number;
  stochD: number;
  macd: number; // histogram value — momentum lewat convergence/divergence MA
  mfi: number; // Money Flow Index — RSI yang mempertimbangin volume
  cci: number; // Commodity Channel Index — deviasi statistik dari rata-rata
  roc: number; // Rate of Change (%) — kecepatan gerak harga mentah
  // FIX (request user, 12 indikator tambahan buat Journal Trading):
  williamsR: number; // -100 sampai 0, mirip Stochastic
  momentum: number; // selisih harga mentah vs N candle lalu
  awesomeOscillator: number; // SMA(5)-SMA(34) dari midpoint
  chaikinMoneyFlow: number; // -1 sampai 1, versi lain dari money flow
  obv: number; // On Balance Volume — kumulatif mentah, TREN yang penting (bukan angka absolut)
  atrSqueeze: number; // rasio ATR sekarang vs rata2 — <1 squeeze, >1 expansion
  keltnerUpper: number; keltnerMiddle: number; keltnerLower: number;
  bbUpper: number; bbMiddle: number; bbLower: number; bbBandwidth: number; // Bollinger Bands + bandwidth%
  trix: number; // rate of change triple-smoothed EMA
  elderBullPower: number; elderBearPower: number; // Elder Ray Index
  vwap: number; // anchor UTC 00:00 (VWAP harian standar)
  cvd: number; // Cumulative Volume Delta — kumulatif mentah dari data candle yang di-fetch
  openInterest: number | null; // BEDA dari yang lain — fetch API terpisah, bisa null kalau gagal
}

export interface TechnicalSnapshot {
  struktur: TFIndicatorSnapshot;
  eksekusi: TFIndicatorSnapshot;
}

/**
 * Snapshot RSI+ATR+ADX+Stochastic+dst di TF struktur DAN eksekusi — buat Menu
 * Journal Trading (request user, DIPERLUAS dari 10 jadi 22 indikator: +Williams
 * %R, Momentum, Awesome Oscillator, Chaikin Money Flow, OBV, ATR Squeeze,
 * Keltner Channels, Bollinger Bands, Trix, Elder Ray, VWAP, CVD, Open
 * Interest). PURE INFORMASIONAL: dipanggil di titik return sinyal SUKSES
 * (siap_entry/ready/in_zone/dll) di semua menu, TAPI hasil hitungannya CUMA
 * ditempel ke response, GAK PERNAH dipake buat nge-gate/nge-block sinyal —
 * logic entry asli tiap menu sama sekali gak berubah.
 * FIX: sekarang ASYNC (Open Interest butuh 1 fetch API terpisah, request
 * user "tetap tambahin walau nambah 1 API call") — semua caller WAJIB pakai
 * await.
 */
async function buildTechnicalSnapshot(struktur: KlineData, eksekusi: KlineData, symbol: string): Promise<TechnicalSnapshot> {
  const openInterest = await fetchOpenInterest(symbol); // 1x doang, dipake struktur+eksekusi (OI gak ada per-TF, itu 1 angka buat symbol)
  const build = (k: KlineData): TFIndicatorSnapshot => {
    const atr = calcATR(k.highs, k.lows, k.closes);
    const price = k.closes[k.closes.length - 1] ?? 0;
    const { k: stochK, d: stochD } = calcStochastic(k.highs, k.lows, k.closes);
    const macdResult = calcMACD(k.closes);
    const keltner = calcKeltnerChannels(k.highs, k.lows, k.closes);
    const bb = calcBollingerBands(k.closes);
    const elder = calcElderRay(k.highs, k.lows, k.closes);
    return {
      rsi: calcRSI(k.closes, 14),
      atr,
      atrPct: price > 0 ? (atr / price) * 100 : 0,
      adx: calcADX(k.highs, k.lows, k.closes),
      stochK, stochD,
      macd: macdResult.histogram,
      mfi: calcMFI(k.highs, k.lows, k.closes, k.volumes),
      cci: calcCCI(k.highs, k.lows, k.closes),
      roc: calcROC(k.closes),
      williamsR: calcWilliamsR(k.highs, k.lows, k.closes),
      momentum: calcMomentum(k.closes),
      awesomeOscillator: calcAwesomeOscillator(k.highs, k.lows),
      chaikinMoneyFlow: calcChaikinMoneyFlow(k.highs, k.lows, k.closes, k.volumes),
      obv: calcOBV(k.closes, k.volumes),
      atrSqueeze: calcATRSqueeze(k.highs, k.lows, k.closes),
      keltnerUpper: keltner.upper, keltnerMiddle: keltner.middle, keltnerLower: keltner.lower,
      bbUpper: bb.upper, bbMiddle: bb.middle, bbLower: bb.lower, bbBandwidth: bb.bandwidth,
      trix: calcTrix(k.closes),
      elderBullPower: elder.bullPower, elderBearPower: elder.bearPower,
      vwap: calcVWAP(k.highs, k.lows, k.closes, k.volumes, k.times),
      cvd: calcCVD(k.volumes, k.takerBuyVolumes),
      openInterest,
    };
  };
  return { struktur: build(struktur), eksekusi: build(eksekusi) };
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
 * Stochastic RSI — Stochastic Oscillator yang diterapkan ke SERIES RSI (bukan
 * ke harga langsung kayak Stochastic biasa). Lebih sensitif buat baca
 * overbought/oversold dibanding RSI polos, given itu "stochastic dari
 * stochastic momentum". Basis filter indikator entry Menu Scalping (request
 * user, kedua skill — Structural & Skill 15M).
 */
function calcStochRSI(closes: number[], rsiPeriod = 14, stochPeriod = 14): number {
  const rsiSeries = calcRSISeries(closes, rsiPeriod);
  if (rsiSeries.length < stochPeriod) return 50;
  const recentRsi = rsiSeries.slice(-stochPeriod);
  const lo = Math.min(...recentRsi);
  const hi = Math.max(...recentRsi);
  if (hi === lo) return 50;
  const currentRsi = rsiSeries[rsiSeries.length - 1]!;
  return ((currentRsi - lo) / (hi - lo)) * 100;
}

/**
 * FORCE INDEX (Alexander Elder), "2 method EMA" (request user, Money Magnet
 * Concept) -- raw FI = (close - close[t-1]) * volume, di-smooth pakai EMA
 * 2-period (bukan EMA13 standar Elder -- literally "method: EMA, period: 2"
 * sesuai penamaan di konsep user). Return SERIES penuh (bukan cuma nilai
 * terakhir) biar bisa dicek "positif/negatif" di titik manapun.
 */
function calcForceIndexSeries(closes: number[], volumes: number[]): number[] {
  const n = closes.length;
  if (n < 2) return [];
  const rawFI: number[] = [];
  for (let i = 1; i < n; i++) {
    rawFI.push((closes[i]! - closes[i - 1]!) * volumes[i]!);
  }
  return calcEMASeries(rawFI, 2); // index 0 di sini = candle index 1 di closes
}

/**
 * STOCHASTIC SLOW (5,3,3) klasik (request user, Money Magnet Concept) --
 * %K raw dari 5-period lookback, %K slow = SMA(%Kraw, 3), %D = SMA(%Kslow, 3).
 * Return {k, d} buat candle terakhir.
 */
function calcStochasticSlow(
  highs: number[], lows: number[], closes: number[],
  lookback = 5, smoothK = 3, smoothD = 3,
): { k: number; d: number } {
  const n = closes.length;
  if (n < lookback + smoothK + smoothD) return { k: 50, d: 50 };
  const rawK: number[] = [];
  for (let i = lookback - 1; i < n; i++) {
    const windowHigh = Math.max(...highs.slice(i - lookback + 1, i + 1));
    const windowLow = Math.min(...lows.slice(i - lookback + 1, i + 1));
    const range = windowHigh - windowLow;
    rawK.push(range > 0 ? ((closes[i]! - windowLow) / range) * 100 : 50);
  }
  const slowK: number[] = [];
  for (let i = smoothK - 1; i < rawK.length; i++) {
    const win = rawK.slice(i - smoothK + 1, i + 1);
    slowK.push(win.reduce((a, b) => a + b, 0) / win.length);
  }
  const slowD: number[] = [];
  for (let i = smoothD - 1; i < slowK.length; i++) {
    const win = slowK.slice(i - smoothD + 1, i + 1);
    slowD.push(win.reduce((a, b) => a + b, 0) / win.length);
  }
  return {
    k: slowK[slowK.length - 1] ?? 50,
    d: slowD[slowD.length - 1] ?? 50,
  };
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

/**
 * Sama kayak findSwingHighs/Lows (fractal 2-2), TAPI return INDEX-nya juga
 * (bukan cuma harga) -- dibutuhin Money Magnet buat cek "level ini beneran
 * FRESH, belum pernah disentuh ulang sejak kebentuk" (request user).
 */
function findLastSwingHighWithIndex(highs: number[]): { price: number; index: number } | null {
  for (let i = highs.length - 3; i >= 2; i--) {
    if (highs[i]! > highs[i - 1]! && highs[i]! > highs[i - 2]! && highs[i]! > highs[i + 1]! && highs[i]! > highs[i + 2]!) {
      return { price: highs[i]!, index: i };
    }
  }
  return null;
}
function findLastSwingLowWithIndex(lows: number[]): { price: number; index: number } | null {
  for (let i = lows.length - 3; i >= 2; i--) {
    if (lows[i]! < lows[i - 1]! && lows[i]! < lows[i - 2]! && lows[i]! < lows[i + 1]! && lows[i]! < lows[i + 2]!) {
      return { price: lows[i]!, index: i };
    }
  }
  return null;
}

/**
 * Sama kayak findLastSwingHighWithIndex/LowWithIndex, TAPI cari swing point
 * KEDUA (yang terbentuk SEBELUM swing paling fresh) -- dibutuhin Money
 * Magnet buat skenario "1 candle dump/pump nembus 2 level sekaligus"
 * (request user, contoh CCUSDT).
 */
function findSecondLastSwingHighWithIndex(highs: number[], excludeIndex: number): { price: number; index: number } | null {
  for (let i = excludeIndex - 1; i >= 2; i--) {
    if (highs[i]! > highs[i - 1]! && highs[i]! > highs[i - 2]! && highs[i]! > highs[i + 1]! && highs[i]! > highs[i + 2]!) {
      return { price: highs[i]!, index: i };
    }
  }
  return null;
}
function findSecondLastSwingLowWithIndex(lows: number[], excludeIndex: number): { price: number; index: number } | null {
  for (let i = excludeIndex - 1; i >= 2; i--) {
    if (lows[i]! < lows[i - 1]! && lows[i]! < lows[i - 2]! && lows[i]! < lows[i + 1]! && lows[i]! < lows[i + 2]!) {
      return { price: lows[i]!, index: i };
    }
  }
  return null;
}

/**
 * Cari SEMUA swing high/low (fractal 2-2), sorted PALING BARU DULUAN,
 * maksimal `maxCount` -- dibutuhin Money Magnet 2 buat cascading breakout
 * (SNR1, SNR2, SNR3, SNR4, dst) yang bisa lanjut berapapun dalamnya selama
 * breakout terus jebol tanpa konsolidasi.
 */
function findRecentSwingHighsWithIndex(highs: number[], maxCount = 6): { price: number; index: number }[] {
  const result: { price: number; index: number }[] = [];
  for (let i = highs.length - 3; i >= 2 && result.length < maxCount; i--) {
    if (highs[i]! > highs[i - 1]! && highs[i]! > highs[i - 2]! && highs[i]! > highs[i + 1]! && highs[i]! > highs[i + 2]!) {
      result.push({ price: highs[i]!, index: i });
    }
  }
  return result;
}
function findRecentSwingLowsWithIndex(lows: number[], maxCount = 6): { price: number; index: number }[] {
  const result: { price: number; index: number }[] = [];
  for (let i = lows.length - 3; i >= 2 && result.length < maxCount; i--) {
    if (lows[i]! < lows[i - 1]! && lows[i]! < lows[i - 2]! && lows[i]! < lows[i + 1]! && lows[i]! < lows[i + 2]!) {
      result.push({ price: lows[i]!, index: i });
    }
  }
  return result;
}

export type TFLabelV2 = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H2' | 'H4' | 'D1';

const MSV2_BASE_CANDLE_COUNT: Record<TFLabelV2, number> = {
  M1: 150, M5: 120, M15: 100, M30: 96, H1: 96, H2: 84, H4: 72, D1: 60,
};

const MSV2_FRACTAL_STRENGTH: Record<TFLabelV2, { left: number; right: number }> = {
  M1: { left: 2, right: 2 }, M5: { left: 2, right: 2 }, M15: { left: 2, right: 2 },
  M30: { left: 2, right: 2 }, H1: { left: 2, right: 2 }, H2: { left: 2, right: 2 },
  H4: { left: 3, right: 3 }, D1: { left: 3, right: 3 },
};

// FIX v2 (ketemu user via kasus real SUPERUSDT — tetap "transition" meski
// harga +34.4%): threshold 0.7 (fix v1) itu optimal buat BTC/ETH (koin besar,
// relatif stabil) TAPI masih terlalu ketat buat altcoin kecil yang jauh lebih
// volatile (ATR SUPERUSDT 5.54% dari harga, vs BTC/ETH yang biasanya <2%).
// Diturunkan lagi ke rasio x0.364 dari nilai ASLI (H4: 1.1->0.4) — tervalidasi
// ulang statistik: BUKAN cuma memperbaiki SUPERUSDT (transition->bullish_weak),
// TAPI JUGA lebih baik di BTC/ETH sendiri (strong 17.3%->19.3%, transition
// 38.3%->32.1%) — win-win, gak ada trade-off. Section 12A dokumen — jarak
// minimal swing ke swing sebelumnya (x ATR), biar swing kecil/noise gak
// kebaca sebagai struktur utama.
const MSV2_SWING_MIN_DIST_ATR: Record<TFLabelV2, number> = {
  M1: 0.2, M5: 0.25, M15: 0.3, M30: 0.35, H1: 0.35, H2: 0.55, H4: 0.4, D1: 0.45,
};

// Section 12B dokumen — follow-through minimal biar break dianggap valid.
const MSV2_BREAK_FOLLOWTHROUGH_ATR: Record<TFLabelV2, number> = {
  M1: 0.4, M5: 0.4, M15: 0.4, M30: 0.55, H1: 0.55, H2: 0.55, H4: 0.6, D1: 0.6,
};

interface MSV2SwingPoint { price: number; index: number; }
interface MSV2BreakEvent { index: number; direction: 'up' | 'down'; level: number; }

/** Layer 1 — swing detection fractal per-TF + filter jarak minimal x ATR (noise filter). */
function msv2FindSwingPoints(
  values: number[], isHigh: boolean, left: number, right: number, atr: number, minDistanceATR: number
): MSV2SwingPoint[] {
  const raw: MSV2SwingPoint[] = [];
  for (let i = left; i < values.length - right; i++) {
    let isSwing = true;
    for (let j = 1; j <= left; j++) {
      if (isHigh ? values[i]! <= values[i - j]! : values[i]! >= values[i - j]!) { isSwing = false; break; }
    }
    if (isSwing) {
      for (let j = 1; j <= right; j++) {
        if (isHigh ? values[i]! <= values[i + j]! : values[i]! >= values[i + j]!) { isSwing = false; break; }
      }
    }
    if (isSwing) raw.push({ price: values[i]!, index: i });
  }
  const minDist = atr * minDistanceATR;
  const filtered: MSV2SwingPoint[] = [];
  for (const sw of raw) {
    const last = filtered[filtered.length - 1];
    if (!last || Math.abs(sw.price - last.price) >= minDist) {
      filtered.push(sw);
    } else if (isHigh ? sw.price > last.price : sw.price < last.price) {
      filtered[filtered.length - 1] = sw; // swing lebih ekstrem gantiin yang deket
    }
  }
  return filtered;
}

/** Layer 2 — structure direction score, max 6 per arah, dari 3 swing terakhir. */
function msv2ScoreStructureDirection(swingHighs: MSV2SwingPoint[], swingLows: MSV2SwingPoint[]): { bullishScore: number; bearishScore: number } {
  if (swingHighs.length < 3 || swingLows.length < 3) return { bullishScore: 0, bearishScore: 0 };
  const h = swingHighs.slice(-3), l = swingLows.slice(-3);
  const [hPrev2, hPrev, hLast] = [h[0]!.price, h[1]!.price, h[2]!.price];
  const [lPrev2, lPrev, lLast] = [l[0]!.price, l[1]!.price, l[2]!.price];

  let bullishScore = 0, bearishScore = 0;
  if (hLast > hPrev) bullishScore += 2;
  if (lLast > lPrev) bullishScore += 2;
  if (hPrev > hPrev2) bullishScore += 1;
  if (lPrev > lPrev2) bullishScore += 1;
  if (hLast < hPrev) bearishScore += 2;
  if (lLast < lPrev) bearishScore += 2;
  if (hPrev < hPrev2) bearishScore += 1;
  if (lPrev < lPrev2) bearishScore += 1;
  return { bullishScore, bearishScore };
}

/** Cari histori break struktur (candle close nembus level swing), dari yang terlama ke terbaru. */
function msv2FindRecentBreaks(closes: number[], swingHighs: MSV2SwingPoint[], swingLows: MSV2SwingPoint[], maxBreaks: number): MSV2BreakEvent[] {
  const breaks: MSV2BreakEvent[] = [];
  const allSwings = [
    ...swingHighs.map(s => ({ ...s, type: 'high' as const })),
    ...swingLows.map(s => ({ ...s, type: 'low' as const })),
  ].sort((a, b) => a.index - b.index);

  for (const sw of allSwings) {
    for (let i = sw.index + 1; i < closes.length; i++) {
      if (sw.type === 'high' && closes[i]! > sw.price) { breaks.push({ index: i, direction: 'up', level: sw.price }); break; }
      if (sw.type === 'low' && closes[i]! < sw.price) { breaks.push({ index: i, direction: 'down', level: sw.price }); break; }
    }
  }
  breaks.sort((a, b) => a.index - b.index);
  return breaks.slice(-maxBreaks);
}

/** Layer 3 — break quality score dari histori break terakhir (follow-through + gak balik ke range). */
function msv2ScoreBreakQuality(
  breaks: MSV2BreakEvent[], highs: number[], lows: number[], closes: number[], atr: number, followThroughATR: number
): { validCount: number; totalChecked: number; points: number; label: string } {
  if (breaks.length === 0) return { validCount: 0, totalChecked: 0, points: 0, label: 'data kurang' };
  let valid = 0;
  for (const b of breaks) {
    let maxFollow = 0;
    const endIdx = Math.min(b.index + 5, closes.length);
    for (let i = b.index; i < endIdx; i++) {
      const dist = b.direction === 'up' ? highs[i]! - b.level : b.level - lows[i]!;
      if (dist > maxFollow) maxFollow = dist;
    }
    const followOk = maxFollow >= atr * followThroughATR;
    let backInRange = false;
    for (let i = b.index + 1; i <= Math.min(b.index + 3, closes.length - 1); i++) {
      if (b.direction === 'up' && closes[i]! < b.level) { backInRange = true; break; }
      if (b.direction === 'down' && closes[i]! > b.level) { backInRange = true; break; }
    }
    if (followOk && !backInRange) valid++;
  }
  const points = valid >= 4 ? 2 : valid >= 2 ? 1 : 0;
  const label = valid >= 4 ? 'kuat' : valid >= 2 ? 'sedang' : 'lemah';
  return { validCount: valid, totalChecked: breaks.length, points, label };
}

/** Layer 4 — sideways score, 4 komponen (0-9 total). */
function msv2ScoreSideways(
  highs: number[], lows: number[], closes: number[], opens: number[],
  minorBreaks: MSV2BreakEvent[]
): { failureScore: number; overlapScore: number; midrangeScore: number; wickScore: number; total: number } {
  // A. Breakout failure rate (10 break minor terakhir)
  let failedCount = 0;
  for (const b of minorBreaks) {
    let backInRange = false;
    for (let i = b.index + 1; i <= Math.min(b.index + 3, closes.length - 1); i++) {
      if (b.direction === 'up' && closes[i]! < b.level) { backInRange = true; break; }
      if (b.direction === 'down' && closes[i]! > b.level) { backInRange = true; break; }
    }
    if (backInRange) failedCount++;
  }
  const failureRate = minorBreaks.length > 0 ? failedCount / minorBreaks.length : 0;
  const failureScore = failureRate > 0.6 ? 3 : failureRate > 0.4 ? 2 : failureRate > 0.25 ? 1 : 0;

  const n = closes.length;
  const window = Math.min(20, n - 1);

  // B. Candle overlap rate
  let overlapCount = 0;
  for (let i = Math.max(1, n - window); i < n; i++) {
    const overlap = Math.min(highs[i]!, highs[i - 1]!) - Math.max(lows[i]!, lows[i - 1]!);
    if (overlap > 0) overlapCount++;
  }
  const overlapRate = window > 0 ? overlapCount / window : 0;
  const overlapScore = overlapRate > 0.6 ? 2 : overlapRate > 0.45 ? 1 : 0;

  // C. Mid-range magnet (close di 40-60% area range)
  const windowSlice = Math.max(1, n - window);
  const rangeHigh = Math.max(...highs.slice(windowSlice));
  const rangeLow = Math.min(...lows.slice(windowSlice));
  const range = rangeHigh - rangeLow;
  let midCount = 0;
  for (let i = windowSlice; i < n; i++) {
    if (range === 0) continue;
    const pos = (closes[i]! - rangeLow) / range;
    if (pos >= 0.4 && pos <= 0.6) midCount++;
  }
  const midRate = window > 0 ? midCount / window : 0;
  const midrangeScore = midRate > 0.5 ? 2 : midRate > 0.35 ? 1 : 0;

  // D. Wick dominance (wick > 50% dari total range candle)
  let wickDomCount = 0;
  for (let i = windowSlice; i < n; i++) {
    const body = Math.abs(closes[i]! - opens[i]!);
    const totalRange = highs[i]! - lows[i]!;
    const wick = totalRange - body;
    if (totalRange > 0 && wick / totalRange > 0.5) wickDomCount++;
  }
  const wickRate = window > 0 ? wickDomCount / window : 0;
  const wickScore = wickRate > 0.45 ? 2 : wickRate > 0.3 ? 1 : 0;

  return { failureScore, overlapScore, midrangeScore, wickScore, total: failureScore + overlapScore + midrangeScore + wickScore };
}

/** Layer 5 — impulse vs retrace/rebound score dari swing pair terakhir. */
function msv2ScoreImpulseRetrace(swingHighs: MSV2SwingPoint[], swingLows: MSV2SwingPoint[], currentPrice: number, bias: 'bullish' | 'bearish'): number {
  if (swingHighs.length === 0 || swingLows.length === 0) return 0;
  if (bias === 'bullish') {
    const lastLow = swingLows[swingLows.length - 1]!;
    const lastHigh = swingHighs[swingHighs.length - 1]!;
    if (lastHigh.index <= lastLow.index) return 0;
    const impulse = lastHigh.price - lastLow.price;
    if (impulse <= 0) return 0;
    const retrace = (lastHigh.price - currentPrice) / impulse;
    if (retrace < 0.35) return 2;
    if (retrace <= 0.50) return 1;
    if (retrace <= 0.65) return 0;
    return -1;
  } else {
    const lastHigh = swingHighs[swingHighs.length - 1]!;
    const lastLow = swingLows[swingLows.length - 1]!;
    if (lastLow.index <= lastHigh.index) return 0;
    const impulse = lastHigh.price - lastLow.price;
    if (impulse <= 0) return 0;
    const rebound = (currentPrice - lastLow.price) / impulse;
    if (rebound < 0.35) return 2;
    if (rebound <= 0.50) return 1;
    if (rebound <= 0.65) return 0;
    return -1;
  }
}

/** Layer 6 — positional bias score dari posisi harga di range window aktif. */
function msv2ScorePosition(highs: number[], lows: number[], closes: number[], window: number): { bullishBonus: number; bearishBonus: number; rangePosition: number } {
  const slice = Math.max(0, highs.length - window);
  const h = Math.max(...highs.slice(slice));
  const l = Math.min(...lows.slice(slice));
  const c = closes[closes.length - 1]!;
  const rangePosition = h > l ? (c - l) / (h - l) : 0.5;
  return { bullishBonus: rangePosition > 0.65 ? 1 : 0, bearishBonus: rangePosition < 0.35 ? 1 : 0, rangePosition };
}

/**
 * Layer 8 (BARU, request user, insight dari riset metodologi altFINS) — MA
 * Alignment + RSI Confluence. altFINS pakai SMA crossover consensus (10 vs
 * 20/30/50/100/200 dst) buat rating "Strong Up (9/10)", jauh LEBIH ROBUST
 * terhadap wick/overlap candle individual dibanding swing-point detection
 * kita (yang kena bug "1 candle ekstrem meracuni ATR" — sudah difix
 * terpisah). SMA dipendekkan ke (5,10,20) — candle count kita jauh lebih
 * terbatas per-TF (60-150) dibanding altFINS yang biasanya pakai data
 * harian dengan history panjang.
 *
 * DIPAKE SEBAGAI GATE TAMBAHAN buat "strong" classification doang (BUKAN
 * masuk ke bullishTotal/bearishTotal) — tervalidasi statistik: kalau
 * dimasukkan ke total score, "transition" ikut naik (efek samping gak
 * diinginkan, given itu yang justru mau dikurangi dari fix sebelumnya).
 * Sebagai gate terpisah, "strong" jadi SEDIKIT LEBIH KETAT (nyaring case
 * yang MA-nya belum genuinely selaras) TANPA ganggu distribusi kategori
 * lain sama sekali (transition/sideways/weak persis sama).
 */
function msv2ScoreMaConfluence(closes: number[]): { bullishRaw: number; bearishRaw: number } {
  if (closes.length < 20) return { bullishRaw: 0, bearishRaw: 0 };
  const sma5 = calcSMA(closes, 5);
  const sma10 = calcSMA(closes, 10);
  const sma20 = calcSMA(closes, 20);
  const price = closes[closes.length - 1]!;
  let bullishRaw = 0, bearishRaw = 0;
  if (price > sma5) bullishRaw++; else bearishRaw++;
  if (sma5 > sma10) bullishRaw++; else bearishRaw++;
  if (sma10 > sma20) bullishRaw++; else bearishRaw++;
  const rsi = calcRSI(closes, 14);
  if (rsi > 50) bullishRaw++; else bearishRaw++;
  return { bullishRaw, bearishRaw }; // masing-masing 0-4
}

export interface MarketStructureV2Result {
  classification: 'bullish_strong' | 'bullish_weak' | 'bearish_strong' | 'bearish_weak' | 'sideways' | 'transition';
  bias: 'bullish' | 'bearish' | 'sideways';
  bullishTotal: number;
  bearishTotal: number;
  sidewaysTotal: number;
  structureBullishScore: number;
  structureBearishScore: number;
  breakQualityLabel: string;
  breakQualityPoints: number;
  bullishRetraceScore: number;
  bearishReboundScore: number;
  rangePosition: number;
  candleCountUsed: number;
  passes: number;
  reasoning: string[];
}

/**
 * Market Structure V2 v2 (REWRITE TOTAL, request user) -- ganti dari 8-layer
 * scoring system jadi swing-sequence based (Dow Theory klasik):
 *
 * FASE 1 -- Identifikasi Tren:
 *   BULLISH: swing H,L,HH,HL,HH (2x higher-high + 1x higher-low) + ADX>25 +
 *            Force Index (EMA2) positif -- SEMUA 3 wajib
 *   BEARISH: swing H,L,LH,LL,LH (2x lower-high + 1x lower-low) + ADX>25 +
 *            Force Index (EMA2) negatif -- SEMUA 3 wajib
 *
 * FASE 2 -- Identifikasi Transisi:
 *   BULLISH->BEARISH: struktur sebelumnya HL/HH (uptrend), lalu breakdown
 *     bikin LL (lower low baru di bawah HL sebelumnya) DENGAN volume
 *     candle breakdown >=2x MA20 -- transisi TERKONFIRMASI
 *   BEARISH->BULLISH: struktur sebelumnya LH/LL (downtrend), lalu breakout
 *     bikin HH (higher high baru di atas LH sebelumnya) DENGAN volume
 *     candle breakout >=2x MA20 -- transisi TERKONFIRMASI
 *
 * REVISI: parameter fullVolumes DITAMBAHIN (dulu gak ada) -- FASE 2 butuh
 * data volume beneran buat validasi ">=2x MA20", bukan sekadar catatan.
 *
 * Field lama (bullishTotal dkk) DIPERTAHANKAN buat backward-compat sama
 * consuming code lain (Menu 1/Funding Kontrarian, Menu 8/Momentum Hunter,
 * checkStructureV2Gate dkk) -- isinya sekarang count kondisi (0-3), bukan
 * skor 8-layer. classification 'bullish'/'bearish' di-map ke '_strong'
 * (SEMUA 3 syarat wajib nyala, gak ada tingkatan '_weak' lagi di desain ini).
 */
export function analyzeMarketStructureV2(
  fullOpens: number[], fullHighs: number[], fullLows: number[], fullCloses: number[],
  tf: TFLabelV2, fullVolumes?: number[], requireADX: boolean = true
): MarketStructureV2Result {
  const cc = fullCloses.length;
  const opens = fullOpens, highs = fullHighs, lows = fullLows, closes = fullCloses;
  const volumes = fullVolumes ?? closes.map(() => 0); // fallback kalau caller lama belum kirim volume
  const reasoning: string[] = [];
  const atr = calcATR(highs, lows, closes);
  const fractal = MSV2_FRACTAL_STRENGTH[tf];
  const minDistAtr = MSV2_SWING_MIN_DIST_ATR[tf];

  const swingHighs = msv2FindSwingPoints(highs, true, fractal.left, fractal.right, atr, minDistAtr);
  const swingLows = msv2FindSwingPoints(lows, false, fractal.left, fractal.right, atr, minDistAtr);

  if (swingHighs.length < 3 || swingLows.length < 3) {
    reasoning.push('Data swing gak cukup (butuh minimal 3 swing high & 3 swing low tervalidasi)');
    return {
      classification: 'sideways', bias: 'sideways', bullishTotal: 0, bearishTotal: 0, sidewaysTotal: 9,
      structureBullishScore: 0, structureBearishScore: 0, breakQualityLabel: 'data kurang', breakQualityPoints: 0,
      bullishRetraceScore: 0, bearishReboundScore: 0, rangePosition: 0.5, candleCountUsed: cc, passes: 1, reasoning,
    };
  }

  // ═══ FASE 1: IDENTIFIKASI TREN ═══════════════════════════════════════════
  const h = swingHighs.slice(-3).map(s => s.price); // [H1, H2, H3] kronologis
  const l = swingLows.slice(-2).map(s => s.price);  // [L1, L2] kronologis

  const bullishPattern = h[2]! > h[1]! && h[1]! > h[0]! && l[1]! > l[0]!; // HH,HH + HL
  const bearishPattern = h[2]! < h[1]! && h[1]! < h[0]! && l[1]! < l[0]!; // LH,LH + LL

  const adx = calcADXWithDI(highs, lows, closes, 14);
  const adxOk = adx.adx > 25;

  const forceIndexSeries = calcForceIndexSeries(closes, volumes);
  const forceIndexNow = forceIndexSeries[forceIndexSeries.length - 1] ?? 0;
  const forceIndexBullish = forceIndexNow > 0;
  const forceIndexBearish = forceIndexNow < 0;

  // REVISI (request user, Money Magnet Scalping gak pake ADX): requireADX
  // opsional -- kalau false, ADX DIKELUARIN dari syarat wajib (cuma pattern
  // + Force Index yang dicek, requiredCount jadi 2 bukan 3).
  const bullishConds = requireADX ? [bullishPattern, adxOk, forceIndexBullish] : [bullishPattern, forceIndexBullish];
  const bearishConds = requireADX ? [bearishPattern, adxOk, forceIndexBearish] : [bearishPattern, forceIndexBearish];
  const requiredCount = bullishConds.length; // 3 kalau requireADX, 2 kalau enggak

  const bullishCount = bullishConds.filter(Boolean).length;
  const bearishCount = bearishConds.filter(Boolean).length;

  reasoning.push(`FASE 1 -- Swing: H=[${h.map(v => v.toFixed(4)).join(',')}] L=[${l.map(v => v.toFixed(4)).join(',')}], pattern bullish=${bullishPattern}, bearish=${bearishPattern}`);
  reasoning.push(requireADX
    ? `FASE 1 -- ADX=${adx.adx.toFixed(1)} (${adxOk ? '>25 OK' : '<=25 gagal'}), Force Index(EMA2)=${forceIndexNow.toFixed(2)} (bullish=${forceIndexBullish}, bearish=${forceIndexBearish})`
    : `FASE 1 -- ADX DILEWATIN (requireADX=false), Force Index(EMA2)=${forceIndexNow.toFixed(2)} (bullish=${forceIndexBullish}, bearish=${forceIndexBearish})`);

  if (bullishCount === requiredCount) {
    reasoning.push(`FASE 1 -- SEMUA ${requiredCount} syarat BULLISH nyala (pattern${requireADX ? '+ADX' : ''}+ForceIndex) -> bullish TERKONFIRMASI`);
    return {
      classification: 'bullish_strong', bias: 'bullish', bullishTotal: requiredCount, bearishTotal: bearishCount, sidewaysTotal: 0,
      structureBullishScore: requiredCount, structureBearishScore: bearishCount, breakQualityLabel: 'n/a', breakQualityPoints: 0,
      bullishRetraceScore: 0, bearishReboundScore: 0, rangePosition: 0.5, candleCountUsed: cc, passes: 1, reasoning,
    };
  }
  if (bearishCount === requiredCount) {
    reasoning.push(`FASE 1 -- SEMUA ${requiredCount} syarat BEARISH nyala (pattern${requireADX ? '+ADX' : ''}+ForceIndex) -> bearish TERKONFIRMASI`);
    return {
      classification: 'bearish_strong', bias: 'bearish', bullishTotal: bullishCount, bearishTotal: requiredCount, sidewaysTotal: 0,
      structureBullishScore: bullishCount, structureBearishScore: requiredCount, breakQualityLabel: 'n/a', breakQualityPoints: 0,
      bullishRetraceScore: 0, bearishReboundScore: 0, rangePosition: 0.5, candleCountUsed: cc, passes: 1, reasoning,
    };
  }

  // ═══ FASE 2: IDENTIFIKASI TRANSISI (dengan validasi volume beneran) ══════
  const h5 = swingHighs.slice(-3);
  const l5 = swingLows.slice(-3);

  const volMa20AtIdx = (idx: number): number => {
    const start = Math.max(0, idx - 19);
    const window = volumes.slice(start, idx + 1);
    return window.length > 0 ? window.reduce((a, b) => a + b, 0) / window.length : 0;
  };

  // BULLISH->BEARISH: struktur sebelumnya HL (l5[0]<l5[1], higher low),
  // SEKARANG breakdown bikin LL (l5[2]<l5[1]) DENGAN volume candle
  // breakdown >=2x MA20 di sekitar titik swing low terbaru itu
  const wasBullishStructure = l5.length >= 3 && l5[1]!.price > l5[0]!.price;
  const nowBreaksDownToLL = l5.length >= 3 && l5[2]!.price < l5[1]!.price;
  let bullToBearVolOk = false, bullToBearVolRatio = 0;
  if (wasBullishStructure && nowBreaksDownToLL) {
    const idx = l5[2]!.index;
    const ma20 = volMa20AtIdx(idx);
    bullToBearVolRatio = ma20 > 0 ? volumes[idx]! / ma20 : 0;
    bullToBearVolOk = bullToBearVolRatio >= 2.0;
  }
  const bullToBear = wasBullishStructure && nowBreaksDownToLL && bullToBearVolOk;

  // BEARISH->BULLISH: struktur sebelumnya LH (h5[0]>h5[1], lower high),
  // SEKARANG breakout bikin HH (h5[2]>h5[1]) DENGAN volume candle
  // breakout >=2x MA20
  const wasBearishStructure = h5.length >= 3 && h5[1]!.price < h5[0]!.price;
  const nowBreaksUpToHH = h5.length >= 3 && h5[2]!.price > h5[1]!.price;
  let bearToBullVolOk = false, bearToBullVolRatio = 0;
  if (wasBearishStructure && nowBreaksUpToHH) {
    const idx = h5[2]!.index;
    const ma20 = volMa20AtIdx(idx);
    bearToBullVolRatio = ma20 > 0 ? volumes[idx]! / ma20 : 0;
    bearToBullVolOk = bearToBullVolRatio >= 2.0;
  }
  const bearToBull = wasBearishStructure && nowBreaksUpToHH && bearToBullVolOk;

  if (bullToBear) {
    reasoning.push(`FASE 2 -- Struktur sebelumnya HL (${l5[0]!.price.toFixed(4)}->${l5[1]!.price.toFixed(4)}), SEKARANG breakdown ke LL (${l5[2]!.price.toFixed(4)}), volume candle breakdown ${bullToBearVolRatio.toFixed(2)}x MA20 (>=2.0x) -> transisi BULLISH->BEARISH TERKONFIRMASI`);
    return {
      classification: 'transition', bias: 'bearish', bullishTotal: bullishCount, bearishTotal: bearishCount, sidewaysTotal: 0,
      structureBullishScore: bullishCount, structureBearishScore: bearishCount, breakQualityLabel: 'transisi bullish->bearish (LL breakdown, vol confirmed)', breakQualityPoints: 1,
      bullishRetraceScore: 0, bearishReboundScore: 0, rangePosition: 0.5, candleCountUsed: cc, passes: 1, reasoning,
    };
  }
  if (bearToBull) {
    reasoning.push(`FASE 2 -- Struktur sebelumnya LH (${h5[0]!.price.toFixed(4)}->${h5[1]!.price.toFixed(4)}), SEKARANG breakout ke HH (${h5[2]!.price.toFixed(4)}), volume candle breakout ${bearToBullVolRatio.toFixed(2)}x MA20 (>=2.0x) -> transisi BEARISH->BULLISH TERKONFIRMASI`);
    return {
      classification: 'transition', bias: 'bullish', bullishTotal: bullishCount, bearishTotal: bearishCount, sidewaysTotal: 0,
      structureBullishScore: bullishCount, structureBearishScore: bearishCount, breakQualityLabel: 'transisi bearish->bullish (HH breakout, vol confirmed)', breakQualityPoints: 1,
      bullishRetraceScore: 0, bearishReboundScore: 0, rangePosition: 0.5, candleCountUsed: cc, passes: 1, reasoning,
    };
  }

  reasoning.push(`Gak ada trend/transisi yang TERKONFIRMASI penuh (bullish=${bullishCount}/${requiredCount}, bearish=${bearishCount}/${requiredCount}) -> sideways`);
  return {
    classification: 'sideways', bias: 'sideways', bullishTotal: bullishCount, bearishTotal: bearishCount, sidewaysTotal: 9,
    structureBullishScore: bullishCount, structureBearishScore: bearishCount, breakQualityLabel: 'n/a', breakQualityPoints: 0,
    bullishRetraceScore: 0, bearishReboundScore: 0, rangePosition: 0.5, candleCountUsed: cc, passes: 1, reasoning,
  };
}


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

export function detectSRLevels(
  highs: number[],
  lows: number[],
  closes: number[],
  lookback = 100,
  minTouches = 2
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

  return levels.filter((l) => l.touches >= minTouches).sort((a, b) => b.touches - a.touches).slice(0, 8);
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

// ─── Step 6: Skip Conditions ──────────────────────────────────────────────────

// CHoCH: detects if H1 has broken structure against the bias (change of character)
// Bullish: close breaks below most recent swing low → CHoCH formed → skip
// Bearish: close breaks above most recent swing high → CHoCH formed → skip
function detectCHoCH(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  bias: "bullish" | "bearish"
): boolean {
  // Fix bug KRITIS (ketemu user, "Scalping Sniper gak pernah keluar sinyal
  // sama sekali"): kedua branch di bawah TERTUKAR TOTAL — buat bias bullish,
  // kode SEBELUMNYA malah ngecek kondisi BEARISH (harga TURUN di bawah swing
  // low), dan sebaliknya. CHoCH bullish yang BENER itu: harga BREAKOUT ke
  // ATAS swing high terbaru (struktur mulai naik). CHoCH bearish: harga
  // BREAKDOWN ke BAWAH swing low terbaru (struktur mulai turun).
  //
  // Tambahan (request user): syarat VOLUME — semangat sama kayak basis Skill
  // 15M ("breakout wajib dikonfirmasi volume"), TAPI TANPA tahap retest.
  // CHoCH ini SENGAJA didesain cepat (beda konsep dari Skill 15M yang sabar
  // nunggu retest) — nambah volume confirm doang, biar gak asal close
  // nembus TANPA momentum beneran, tapi tetep gak nunggu retest (yang bakal
  // bikin entry telat, ngerusak tujuan "sniper"-nya).
  const lastClose = closes[closes.length - 1];
  const lastVolume = volumes[volumes.length - 1] ?? 0;
  const volWindow = volumes.slice(-21, -1); // 20 candle SEBELUM candle terakhir
  const avgVol = volWindow.length > 0 ? volWindow.reduce((a, b) => a + b, 0) / volWindow.length : 0;
  const volConfirmed = avgVol > 0 ? lastVolume >= avgVol * 1.4 : true; // data kurang -> jangan block gara-gara ini

  if (bias === "bullish") {
    const swingHighs = findSwingHighs(highs, 5);
    if (swingHighs.length < 1) return false;
    const recentHH = swingHighs[swingHighs.length - 1];
    return lastClose > recentHH && volConfirmed;
  } else {
    const swingLows = findSwingLows(lows, 5);
    if (swingLows.length < 1) return false;
    const recentLL = swingLows[swingLows.length - 1];
    return lastClose < recentLL && volConfirmed;
  }
}

/**
 * Liquidity Sweep — validasi reversal lebih ketat dari CHoCH biasa. CHoCH cuma
 * cek "close udah lewatin swing" (bisa jadi breakout beneran, bukan reversal).
 * Sweep spesifik nyari pola: harga NEMBUS DULU (wick) di luar swing — "nyapu"
 * stop-loss/liquidity di situ — TAPI closenya balik lagi ke dalam range. Ini
 * pola ICT/SMC klasik yang nandain exhaustion, sinyal reversal lebih valid.
 */
function detectLiquiditySweep(
  highs: number[],
  lows: number[],
  closes: number[],
  bias: "bullish" | "bearish",
  lookback = 5
): { swept: boolean; sweepLevel?: number; candlesAgo?: number } {
  const n = closes.length;
  if (bias === "bullish") {
    const swingLows = findSwingLows(lows, 5);
    if (swingLows.length < 1) return { swept: false };
    const recentLow = swingLows[swingLows.length - 1];
    for (let i = n - 1; i >= Math.max(0, n - lookback); i--) {
      if (lows[i]! < recentLow && closes[i]! > recentLow) {
        return { swept: true, sweepLevel: lows[i], candlesAgo: n - 1 - i };
      }
    }
    return { swept: false };
  } else {
    const swingHighs = findSwingHighs(highs, 5);
    if (swingHighs.length < 1) return { swept: false };
    const recentHigh = swingHighs[swingHighs.length - 1];
    for (let i = n - 1; i >= Math.max(0, n - lookback); i--) {
      if (highs[i]! > recentHigh && closes[i]! < recentHigh) {
        return { swept: true, sweepLevel: highs[i], candlesAgo: n - 1 - i };
      }
    }
    return { swept: false };
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

// ─── Economic Calendar Warning (FOMC/CPI/NFP) ───────────────────────────────
// Rilis data makro AS (FOMC, CPI, NFP) sering bikin SEMUA market termasuk crypto
// bergerak liar/whipsaw beberapa jam di sekitar jam rilis — bukan soal analisa
// teknikal koin-nya salah, ini risiko event eksternal yang gak bisa dibaca dari
// chart. Data diambil dari FRED (Federal Reserve St. Louis), sumber resmi &
// gratis (perlu API key gratis: https://fred.stlouisfed.org/docs/api/api_key.html).
export interface EconomicEvent {
  name: string;
  date: string; // YYYY-MM-DD
  hoursUntil: number;
}

const FRED_RELEASE_IDS: { id: number; name: string }[] = [
  { id: 101, name: 'FOMC (Keputusan Suku Bunga The Fed)' },
  { id: 10, name: 'CPI (Data Inflasi AS)' },
  { id: 50, name: 'NFP (Non-Farm Payroll / Employment Situation)' },
];

let economicCalendarCache: { events: EconomicEvent[]; fetchedAt: number } | null = null;
const ECONOMIC_CALENDAR_CACHE_MS = 6 * 60 * 60 * 1000; // 6 jam — jadwal rilis gak berubah tiap menit

export async function fetchUpcomingEconomicEvents(): Promise<EconomicEvent[]> {
  const apiKey = process.env['FRED_API_KEY'];
  if (!apiKey) return []; // fail-safe: kalau API key belum di-set, skip diem-diem, jangan crash alur utama

  if (economicCalendarCache && Date.now() - economicCalendarCache.fetchedAt < ECONOMIC_CALENDAR_CACHE_MS) {
    return economicCalendarCache.events;
  }

  try {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const futureStr = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const results = await Promise.all(
      FRED_RELEASE_IDS.map(async ({ id, name }) => {
        const url = `https://api.stlouisfed.org/fred/releases/dates?release_id=${id}&realtime_start=${todayStr}&realtime_end=${futureStr}&include_release_dates_with_no_data=true&sort_order=asc&file_type=json&api_key=${apiKey}`;
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json() as { release_dates?: { date: string }[] };
        return (data.release_dates ?? []).map(d => ({ name, date: d.date }));
      })
    );

    const now = Date.now();
    const events: EconomicEvent[] = results.flat()
      .map(e => ({
        name: e.name,
        date: e.date,
        hoursUntil: Math.round((new Date(e.date + 'T13:30:00Z').getTime() - now) / (60 * 60 * 1000)),
        // Rilis data AS mayoritas jam 08:30 ET / 13:30 UTC (CPI, NFP); FOMC beda jam
        // (~14:00 ET) tapi selisihnya gak signifikan buat kebutuhan warning ini.
      }))
      .filter(e => e.hoursUntil >= -6 && e.hoursUntil <= 14 * 24) // dari 6 jam lalu s/d 14 hari ke depan
      .sort((a, b) => a.hoursUntil - b.hoursUntil);

    economicCalendarCache = { events, fetchedAt: Date.now() };
    return events;
  } catch {
    return []; // fail-safe: gak boleh ganggu alur analisa utama
  }
}

/**
 * Cek apakah ada event makro high-impact dalam window waktu tertentu (default 24 jam).
 * Dipakai sebagai warning tambahan di Menu 1/2/4 — BUKAN hard-skip, karena setup
 * yang valid tetap valid, cuma risikonya naik di sekitar jam rilis.
 */
async function checkEconomicCalendarWarning(windowHours = 24): Promise<{ hasWarning: boolean; message: string }> {
  const events = await fetchUpcomingEconomicEvents();
  const upcoming = events.filter(e => e.hoursUntil >= 0 && e.hoursUntil <= windowHours);
  if (upcoming.length === 0) return { hasWarning: false, message: '' };

  const nearest = upcoming[0]!;
  const whenText = nearest.hoursUntil < 1 ? 'kurang dari 1 jam lagi' : `~${nearest.hoursUntil} jam lagi`;
  return {
    hasWarning: true,
    message: `⚠️ ${nearest.name} rilis ${whenText} (${nearest.date}) — market bisa whipsaw liar di sekitar jam rilis, pertimbangkan hold/kurangi size`,
  };
}

// ─── Momentum Info: ROC + ATR Expansion ─────────────────────────────────────
// Info tambahan (BUKAN hard filter/gak ngubah score) — ngukur seberapa CEPAT
// harga bergerak dibanding kondisi normalnya, bukan cuma ARAH-nya. Berguna buat
// bedain sinyal yang "bertenaga" vs yang lemah, dan warning kalau harga udah
// gerak jauh duluan (resiko chasing/FOMO).
interface MomentumInfo {
  velocityRatio: number; // seberapa besar pergerakan aktual vs pergerakan "normal" (ATR × lookback)
  atrExpansion: number;  // ATR sekarang vs ATR window sebelumnya
  direction: 'up' | 'down' | 'flat';
  classification: 'very_fast' | 'fast' | 'normal' | 'slow';
  message: string; // kosong kalau kondisinya normal-normal aja (gak perlu ditampilin)
}

function calcMomentumInfo(highs: number[], lows: number[], closes: number[], lookback = 5): MomentumInfo {
  const n = closes.length;
  const empty: MomentumInfo = { velocityRatio: 1, atrExpansion: 1, direction: 'flat', classification: 'normal', message: '' };
  if (n < lookback + 30) return empty;

  const atrCurrent = calcATR(highs, lows, closes, 14);
  // ATR expansion: bandingin ATR "sekarang" (14 candle terakhir) vs ATR 14 candle SEBELUM itu
  const priorEnd = n - 14;
  const atrPrior = calcATR(highs.slice(0, priorEnd), lows.slice(0, priorEnd), closes.slice(0, priorEnd), 14);
  const atrExpansion = atrPrior > 0 ? atrCurrent / atrPrior : 1;

  const priceChange = closes[n - 1]! - closes[n - 1 - lookback]!;
  const expectedMove = atrCurrent * lookback; // pergerakan "wajar" kalau tiap candle gerak 1x ATR
  const velocityRatio = expectedMove > 0 ? Math.abs(priceChange) / expectedMove : 0;
  const direction: MomentumInfo['direction'] = priceChange > 0 ? 'up' : priceChange < 0 ? 'down' : 'flat';
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';

  let classification: MomentumInfo['classification'] = 'normal';
  let message = '';
  if (velocityRatio >= 2.0) {
    classification = 'very_fast';
    message = `⚡ Harga gerak SANGAT CEPAT (${velocityRatio.toFixed(1)}x lebih cepat dari normal) ${arrow} — waspada chasing/FOMO, entry mungkin udah kejauhan`;
  } else if (velocityRatio >= 1.3) {
    classification = 'fast';
    message = `⚡ Momentum cepat (${velocityRatio.toFixed(1)}x dari normal) ${arrow}`;
  } else if (velocityRatio < 0.4) {
    classification = 'slow';
    message = `🐢 Momentum lemah — harga kurang bertenaga (${velocityRatio.toFixed(1)}x dari normal)`;
  }

  if (atrExpansion >= 1.5) {
    message += message ? ' · ' : '';
    message += `📊 Volatilitas melonjak ${atrExpansion.toFixed(1)}x dari beberapa candle sebelumnya`;
  }

  return { velocityRatio, atrExpansion, direction, classification, message };
}

// ─── Volume Breakout Threshold — adaptif per likuiditas (request user) ─────
// Crypto sekarang volatilitas tinggi + banyak manipulasi (wash trading, fake
// breakout) — butuh rasio volume LEBIH TINGGI dari basis lama (1.4x) buat
// validasi breakout genuine, TERUTAMA di koin likuiditas rendah (lebih gampang
// "digoreng" volume-nya). Proxy likuiditas pakai VOLUME 24H (quoteVolume) —
// Binance gak nyediain market cap langsung (dibahas & disepakati skip
// sebelumnya), volume 24h itu proxy paling praktis yang UDAH ADA datanya.
const volume24hCache = new Map<string, { value: number; ts: number }>();
const VOLUME_24H_CACHE_MS = 5 * 60 * 1000;
const HIGH_LIQUIDITY_THRESHOLD_USDT = 500_000_000; // >500 Juta USDT/24h = "high-cap-like" (BTC/ETH dkk)

async function fetch24hVolume(symbol: string): Promise<number> {
  const cached = volume24hCache.get(symbol);
  if (cached && Date.now() - cached.ts < VOLUME_24H_CACHE_MS) return cached.value;
  try {
    const res = await fetch(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/24hr?symbol=${symbol}`);
    if (!res.ok) return cached?.value ?? 0;
    const data = await res.json() as { quoteVolume: string };
    const value = parseFloat(data.quoteVolume);
    volume24hCache.set(symbol, { value, ts: Date.now() });
    return value;
  } catch {
    return cached?.value ?? 0; // fail-safe — kalau gagal fetch, treat sebagai "belum tau" (caller pakai default konservatif)
  }
}

/**
 * FIX (request user): threshold volume breakout ADAPTIF per likuiditas.
 * baseHighCap = threshold buat koin likuid (>500jt USDT/24h volume) —
 * Skill 15M 1.5x, Structural 1.8x. Koin likuiditas rendah butuh rasio LEBIH
 * TINGGI (dinaikin ~1.6x dari base, taruh di tengah rentang 2-4x yang diminta:
 * 1.5*1.67=2.5x, 1.8*1.67=3.0x) — lebih gampang "digoreng" volume-nya, butuh
 * konfirmasi lebih kuat biar bukan fake breakout/manipulasi.
 */
async function getVolumeBreakoutThreshold(symbol: string, baseHighCap: number): Promise<number> {
  const volume24h = await fetch24hVolume(symbol);
  if (volume24h >= HIGH_LIQUIDITY_THRESHOLD_USDT) return baseHighCap;
  return baseHighCap * 1.67; // 1.5->2.505, 1.8->3.006, sesuai rentang 2-4x yang diminta user
}

export interface ScalpingResult {
  status: 'waiting' | 'approaching' | 'in_zone' | 'expired' | 'no_setup' | 'no_structure' | 'skip' | 'error';
  symbol: string;
  bias?: 'bullish' | 'bearish';
  mode?: 'structural' | 'scalping15m' | 'moneymagnet3' | 'moneymagnet1' | 'moneymagnetscalping'; // skill yang hasilin sinyal ini
  recommendedMode?: 'structural' | 'scalping15m';
  currentPrice: number;
  timestamp: string;
  message?: string;
  recentPerformance?: RecentPerformance; // mini-backtest instan, cuma diisi di endpoint single-symbol
  tfBreakdown?: TFBreakdownItem[]; // breakdown per-timeframe
  score?: number;
  maxScore: number;
  // Struktur 15M (khusus skill 'structural')
  structure15M?: string;
  choch15M?: boolean;
  // OB 5M (khusus skill 'structural')
  ob5M?: { low: number; high: number; mid: number; fresh: boolean };
  // Zona breakout-retest (khusus skill 'scalping15m')
  zoneEdgeUpper?: number;
  zoneEdgeLower?: number;
  candlesSinceBreakout?: number;
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
  bbSqueezing?: boolean; // BB Squeeze M30 aktif (khusus skill 'structural')
  technicalSnapshot?: TechnicalSnapshot; // RSI/ATR/ADX/Stochastic struktur+eksekusi — informasional, buat Journal Trading
  marketStructureV2?: MarketStructureV2Result | null; // detail Market Structure V2 (klasifikasi, skor 3 arah, breakdown layer) — primary gate, buat transparansi kenapa sinyal ini lolos/di-block
  btcAligned?: boolean; // BTC Correlation — informasional buat Journal (request user, biar riset bisa liat kombinasi bias+BTC pas WIN/LOSE)
  btcBias?: 'bullish' | 'bearish' | 'ranging';
  // ═══ Breakout Retest Strategy M15 (request user, REVISI TOTAL skill 15M) ══
  takeProfit3?: number; // TP3 (4.4% dari entry)
  pullbackRatio?: number; // kedalaman pullback / breakout move (harus 0.25-0.618)
  entryLimitLevel?: 'aggressive' | 'moderate' | 'conservative'; // level mana yang dipakai (selalu 'moderate')
  validUntilCandles?: number; // order valid berapa candle (4)
  // ═══ Money Magnet Concept (request user, REVISI TOTAL skill Structural) ═══
  h4CrossCount?: number; // berapa kali H4 crossing EMA26 dalam 20 candle terakhir (>3 = exhausted)
  forceIndexValue?: number; // Force Index (EMA2) di candle retest
  stochSlowAtRetest?: { k: number; d: number }; // Stochastic Slow (5,3,3) di candle retest -- BONUS doang, gak block
  magnetLevelUsed?: 'broken_level' | 'ema26'; // level mana yang dipilih jadi entry (paling deket ke harga)
  magnetConfluencePct?: number; // jarak % antara broken level vs EMA26 M30
  moneyMagnetVariant?: 'standard' | 'dual_level'; // 'dual_level' = 1 candle nembus 2 SNR sekaligus (entry di SNR2, SL di SNR1) -- ditampilkan Journal sebagai "Money Magnet 2"
  // ═══ Bonus cross-menu (request user): cek sinyal ini SEARAH sama Fitur 5
  // Technical Analysis PRO (Skor Long vs Short) apa enggak. Gak nge-block,
  // cuma info/badge tambahan buat UI.
  taProBonusConfirmed?: boolean;
  taProBonusClassification?: string | null;
  taProBonusScore?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// MONEY MAGNET CONCEPT (request user, GANTI TOTAL skill Structural dari
// zone breakout+retest lama). Konsep: EMA26 = "magnet" yang harga selalu
// balik ke situ. FASE 1 (H4): trend + filter "3x magnet penetration"
// (exhausted trend). FASE 2 (M30): breakout level FRESH (bukan yang udah
// lama teruji). FASE 3: retest ke confluence broken-level+EMA26, Force
// Index HARD filter, Stochastic Slow BONUS doang. FASE 4: entry di level
// terdekat, SL pure ATR M30, TP RR 1:2.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// MONEY MAGNET v3 (REWRITE TOTAL, request user):
// FASE 1: Trend H4 = EMA26+EMA34 H4 (harus searah) + ADX>=35
// FASE 2: Breakout M30 -- swing S/R fresh ATAU EMA26 M30 (salah satu),
//         volume>=2x MA20, retest ke S/R (BUKAN EMA26) dengan Force Index
//         searah TANPA divergence
// FASE 3: Entry di S/R, SL di swing SEBELUM S/R itu kebentuk, TP RR1:2/1:3
// ═══════════════════════════════════════════════════════════════════════════

// BARU (request user, samain di 3 menu: Menu Scalping, Sniper Breakout Skill 1,
// Money Magnet Scalping): pastiin level S/R yang mau ditembus BENERAN
// SIGNIFIKAN di TF BESAR (H4) -- minimal 2x disentuh, ADA REAKSI JELAS tiap
// sentuhan (wick masuk zona toleransi TAPI close balik/menjauh dari zona,
// bukan cuma nempel/doji di situ). Toleransi = ATR(H4) x 0.15, scan mundur
// 26 candle H4. GANTI dari cek lama (hitung approach di TF eksekusi yang
// sama) -- sekarang selalu ngecek di H4 terlepas dari TF eksekusi menu.
function checkLevelSignificantH4(
  h4Highs: number[], h4Lows: number[], h4Closes: number[],
  level: number, bias: 'bullish' | 'bearish', atrH4: number,
  window = 26, minTouch = 2,
): { significant: boolean; touches: number } {
  const tol = atrH4 * 0.15;
  const lastIdx = h4Closes.length - 1; // caller kirim array yang udah dipotong sampe candle H4 closed terakhir
  const start = Math.max(0, lastIdx - window + 1);
  let touches = 0;
  for (let i = start; i <= lastIdx; i++) {
    if (bias === 'bullish') { // level = resistance -- wick nyampe zona dari bawah, close balik ke BAWAH zona
      const h = h4Highs[i]!, c = h4Closes[i]!;
      if (h >= level - tol && c < level - tol) touches++;
    } else { // level = support -- wick nyampe zona dari atas, close balik ke ATAS zona
      const l = h4Lows[i]!, c = h4Closes[i]!;
      if (l <= level + tol && c > level + tol) touches++;
    }
  }
  return { significant: touches >= minTouch, touches };
}

export async function analyzeScalpingEntry(symbol: string): Promise<ScalpingResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';
  const maxScore = 100;

  try {
    // REVISI (request user): trend gate H4 (EMA26+ADX) DIHAPUS -- arah
    // sinyal sekarang murni dari breakout-nya sendiri (gak perlu searah H4
    // lagi), diganti filter RSI(14) D1 (samain pola Sniper Breakout Skill
    // 1). TF eksekusi naik M30 -> H1.
    const [h1, d1, tickerRes] = await Promise.all([
      fetchKlines(symbol, '1h', 100),
      fetchKlines(symbol, '1d', 30),
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);
    const currentPrice = tickerRes.ok
      ? parseFloat((await tickerRes.json() as { price: string }).price)
      : h1.closes[h1.closes.length - 1]!;

    if (h1.closes.length < 100) {
      return { status: 'error', symbol, currentPrice, timestamp, mode: 'structural', message: 'Data candle gak cukup (butuh H1 100+)', maxScore };
    }
    if (d1.closes.length < 15) {
      return { status: 'error', symbol, currentPrice, timestamp, mode: 'structural', message: 'Data candle gak cukup (butuh D1 15+)', maxScore };
    }

    const filterResults: string[] = [];

    // ═══ FASE 1: BREAKOUT H1 (swing S/R fresh ATAU EMA26 H1) ═════════════
    const atrM30 = calcATR(h1.highs, h1.lows, h1.closes);
    if (atrM30 <= 0) {
      return { status: 'error', symbol, currentPrice, timestamp, mode: 'structural', message: 'ATR H1 gak valid', maxScore };
    }
    const lastClosedIdx = h1.closes.length - 2;
    const emaSeries26M30 = calcEMASeries(h1.closes, 26);
    const volMa20Series = h1.volumes.map((_, i) => {
      const start = Math.max(0, i - 19);
      const w = h1.volumes.slice(start, i + 1);
      return w.reduce((a, b) => a + b, 0) / w.length;
    });

    const swingWindow = 60;
    const swingSlice = Math.max(0, lastClosedIdx - swingWindow);
    const swingHighsList = findRecentSwingHighsWithIndex(h1.highs.slice(swingSlice, lastClosedIdx + 1), 8)
      .map(s => ({ price: s.price, index: swingSlice + s.index }));
    const swingLowsList = findRecentSwingLowsWithIndex(h1.lows.slice(swingSlice, lastClosedIdx + 1), 8)
      .map(s => ({ price: s.price, index: swingSlice + s.index }));

    if (swingHighsList.length < 2 || swingLowsList.length < 2) {
      return { status: 'no_structure', symbol, currentPrice, timestamp, mode: 'structural', message: 'Belum cukup swing high/low H1 buat cari level S/R', maxScore };
    }

    const touchTolFresh = atrM30 * 0.1;
    const isFreshUntouched = (swingIdxAbs: number, level: number, checkUntilIdx: number): boolean => {
      for (let i = swingIdxAbs + 1; i < checkUntilIdx; i++) {
        const hh = h1.highs[i]!, ll = h1.lows[i]!;
        if (Math.abs(hh - level) <= touchTolFresh || Math.abs(ll - level) <= touchTolFresh || (ll <= level && hh >= level)) return false;
      }
      return true;
    };

    // BARU (request user, samain di 3 menu): level S/R yang mau ditembus
    // harus signifikan di H4 -- minimal 2x disentuh dengan reaksi jelas
    // (lihat checkLevelSignificantH4 di atas).
    const h4 = await fetchKlines(symbol, '4h', 40);
    if (h4.closes.length < 30) {
      return { status: 'error', symbol, currentPrice, timestamp, mode: 'structural', message: 'Data candle gak cukup (butuh H4 30+)', maxScore };
    }
    const h4LastClosedIdx = h4.closes.length - 2;
    const h4ClosedHighs = h4.highs.slice(0, h4LastClosedIdx + 1);
    const h4ClosedLows = h4.lows.slice(0, h4LastClosedIdx + 1);
    const h4ClosedCloses = h4.closes.slice(0, h4LastClosedIdx + 1);
    const atrH4 = calcATR(h4ClosedHighs, h4ClosedLows, h4ClosedCloses);
    const isSignificantLevel = (level: number, bias: 'bullish' | 'bearish'): boolean =>
      checkLevelSignificantH4(h4ClosedHighs, h4ClosedLows, h4ClosedCloses, level, bias, atrH4).significant;

    const forceIndexSeries = calcForceIndexSeries(h1.closes, h1.volumes);

    type MoneyMagnetV3Found = {
      breakoutIdx: number; retestIdx: number; levelPrice: number; levelIdxAbs: number;
      slBasisPrice: number; entryLevel: number; forceIndexValue: number; bias: 'bullish' | 'bearish';
    };
    let found: MoneyMagnetV3Found | null = null;

    for (let breakoutIdx = lastClosedIdx - 1; breakoutIdx >= Math.max(swingSlice + 5, lastClosedIdx - 24); breakoutIdx--) {
      const closeB = h1.closes[breakoutIdx]!;
      const volRatio = volMa20Series[breakoutIdx]! > 0 ? h1.volumes[breakoutIdx]! / volMa20Series[breakoutIdx]! : 0;
      if (volRatio < 2.0) continue;

      const resistance = swingHighsList.find(s => s.index < breakoutIdx) ?? swingHighsList[0]!;
      const support = swingLowsList.find(s => s.index < breakoutIdx) ?? swingLowsList[0]!;

      // REVISI (request user): arah sinyal murni dari breakout-nya sendiri,
      // gak perlu searah "trend H4" lagi.
      const emaCrossUp = h1.closes[breakoutIdx - 1]! <= emaSeries26M30[breakoutIdx - 1]! && closeB > emaSeries26M30[breakoutIdx]!;
      const bullishBreakout = breakoutIdx > resistance.index &&
        ((closeB > resistance.price && isFreshUntouched(resistance.index, resistance.price, breakoutIdx)) || emaCrossUp) &&
        closeB > resistance.price &&
        isSignificantLevel(resistance.price, 'bullish');

      const emaCrossDown = h1.closes[breakoutIdx - 1]! >= emaSeries26M30[breakoutIdx - 1]! && closeB < emaSeries26M30[breakoutIdx]!;
      const bearishBreakout = breakoutIdx > support.index &&
        ((closeB < support.price && isFreshUntouched(support.index, support.price, breakoutIdx)) || emaCrossDown) &&
        closeB < support.price &&
        isSignificantLevel(support.price, 'bearish');

      if (!bullishBreakout && !bearishBreakout) continue;

      const bias = bullishBreakout ? 'bullish' : 'bearish';
      const levelPrice = bullishBreakout ? resistance.price : support.price;
      const levelIdxAbs = bullishBreakout ? resistance.index : support.index;

      // Cari SL basis: swing SEBELUM level ini kebentuk (kronologis lebih awal)
      const slBasisList = bullishBreakout
        ? swingLowsList.filter(s => s.index < levelIdxAbs)
        : swingHighsList.filter(s => s.index < levelIdxAbs);
      if (slBasisList.length === 0) continue; // gak ada swing sebelum level ini, skip
      const slBasisPrice = slBasisList[0]!.price; // paling BARU di antara yang sebelum level (list udah sorted recent-first)

      const nextIdx = breakoutIdx + 1;
      if (nextIdx > lastClosedIdx) continue;

      // Scan retest ke level (S/R, BUKAN EMA26)
      for (let retestIdx = nextIdx + 1; retestIdx <= lastClosedIdx; retestIdx++) {
        const c = h1.closes[retestIdx]!;
        const nearLevel = Math.abs(c - levelPrice) / levelPrice * 100 <= 0.3;
        if (!nearLevel) continue;

        const fiIdx = retestIdx - 1;
        const fiVal = forceIndexSeries[fiIdx];
        const fiPrev = forceIndexSeries[fiIdx - 1];
        if (fiVal === undefined || fiPrev === undefined) continue;
        const forceIndexOk = bias === 'bullish' ? fiVal < 0 : fiVal > 0;
        if (!forceIndexOk) continue;

        // Cek divergence: harga bikin low/high baru (retest) tapi Force Index
        // malah GAK ikut bikin low/high baru searah -- kalau kejadian, TOLAK.
        const fiWindow = forceIndexSeries.slice(nextIdx, fiIdx);
        const priceWindow = h1.closes.slice(nextIdx, retestIdx);
        let divergence = false;
        if (bias === 'bullish' && fiWindow.length > 0 && priceWindow.length > 0) {
          const priceMinBefore = Math.min(...priceWindow);
          const fiMinBefore = Math.min(...fiWindow.filter(v => v !== undefined) as number[]);
          if (c <= priceMinBefore && fiVal > fiMinBefore) divergence = true;
        } else if (bias === 'bearish' && fiWindow.length > 0 && priceWindow.length > 0) {
          const priceMaxBefore = Math.max(...priceWindow);
          const fiMaxBefore = Math.max(...fiWindow.filter(v => v !== undefined) as number[]);
          if (c >= priceMaxBefore && fiVal < fiMaxBefore) divergence = true;
        }
        if (divergence) continue;

        found = { breakoutIdx, retestIdx, levelPrice, levelIdxAbs, slBasisPrice, entryLevel: levelPrice, forceIndexValue: fiVal, bias };
        break;
      }
      if (found) break;
    }

    if (!found) {
      return {
        status: 'waiting', symbol, currentPrice, timestamp, mode: 'structural',
        message: 'Belum ada breakout+retest H1 valid (level signifikan (>=2x reaksi jelas di H4), volume>=2x MA20, retest ke S/R dengan Force Index searah tanpa divergence) dalam 24 candle terakhir',
        maxScore, filterResults,
      };
    }

    // BARU (request user): RSI(14) D1 HARD FILTER -- gantiin trend gate H4
    // (EMA26+ADX) yang dihapus. Sama persis pola Sniper Breakout Skill 1:
    // >=65 overbought tolak BUY, <=35 oversold tolak SELL, 55-65/35-45 cuma
    // label info.
    const bias = found.bias;
    const rsiD1 = calcRSI(d1.closes, 14);
    if (bias === 'bullish' && rsiD1 >= 65) {
      return {
        status: 'waiting', symbol, bias, currentPrice, timestamp, mode: 'structural',
        message: `Breakout+retest H1 valid TAPI RSI D1 (${rsiD1.toFixed(1)}) udah OVERBOUGHT (>=65) — rawan pembalikan arah, sinyal BUY ditolak`,
        maxScore, filterResults: [`🚫 RSI D1 (BLOCK) — ${rsiD1.toFixed(1)} overbought (>=65), BUY ditolak`],
      };
    }
    if (bias === 'bearish' && rsiD1 <= 35) {
      return {
        status: 'waiting', symbol, bias, currentPrice, timestamp, mode: 'structural',
        message: `Breakout+retest H1 valid TAPI RSI D1 (${rsiD1.toFixed(1)}) udah OVERSOLD (<=35) — rawan pembalikan arah, sinyal SELL ditolak`,
        maxScore, filterResults: [`🚫 RSI D1 (BLOCK) — ${rsiD1.toFixed(1)} oversold (<=35), SELL ditolak`],
      };
    }
    const rsiD1Label = bias === 'bullish'
      ? (rsiD1 >= 55 ? 'trend bullish sehat' : rsiD1 <= 45 ? 'lemah, hati-hati' : 'netral')
      : (rsiD1 <= 45 ? 'trend bearish sehat' : rsiD1 >= 55 ? 'lemah, hati-hati' : 'netral');

    filterResults.push(`✅ FASE 1 — Breakout+retest H1 valid @ ${found.levelPrice.toFixed(6)} (level signifikan (>=2x reaksi jelas di H4), volume>=2x MA20), retest ke S/R, Force Index ${found.forceIndexValue.toFixed(2)} searah ${bias}, TANPA divergence`);
    filterResults.push(`✅ RSI(14) D1 — ${rsiD1.toFixed(1)} (${rsiD1Label}), belum overbought/oversold`);

    // ═══ FASE 2: ENTRY SETUP ═════════════════════════════════════════════
    const dirMult = bias === 'bullish' ? 1 : -1;
    const entryPrice = found.entryLevel;

    const entryStillValid = bias === 'bullish' ? entryPrice <= currentPrice : entryPrice >= currentPrice;
    if (!entryStillValid) {
      return {
        status: 'waiting', symbol, currentPrice, timestamp, mode: 'structural',
        message: `Breakout+retest udah basi — harga sekarang (${currentPrice.toFixed(6)}) udah ${bias === 'bullish' ? 'di bawah' : 'di atas'} level entry (${entryPrice.toFixed(6)})`,
        maxScore, filterResults,
      };
    }

    const stopLoss = found.slBasisPrice;
    const risk = Math.abs(entryPrice - stopLoss);
    if (risk <= 0) {
      return { status: 'no_setup', symbol, bias, currentPrice, timestamp, mode: 'structural', message: 'Risk gak valid (entry & SL kelewat dekat)', maxScore, filterResults };
    }
    const takeProfit1 = entryPrice + risk * 2 * dirMult;
    const takeProfit2 = entryPrice + risk * 3 * dirMult;
    const rr1 = 2;

    filterResults.push(`✅ FASE 2 — Entry LIMIT @ ${entryPrice.toFixed(6)}, SL (swing sebelum level) @ ${stopLoss.toFixed(6)}, TP1 RR1:2 @ ${takeProfit1.toFixed(6)}, TP2 RR1:3 @ ${takeProfit2.toFixed(6)}`);

    const taProBonus = await checkTaProBonus(symbol, bias);

    return {
      status: 'in_zone', symbol, bias, currentPrice, timestamp, mode: 'structural',
      maxScore, filterResults,
      entryPrice, stopLoss, takeProfit1, takeProfit2, rr1,
      moneyMagnetVariant: 'standard',
      forceIndexValue: found.forceIndexValue,
      magnetLevelUsed: 'broken_level',
      atr15MPct: (atrM30 / currentPrice) * 100,
      taProBonusConfirmed: taProBonus.confirmed, taProBonusClassification: taProBonus.classification, taProBonusScore: taProBonus.score,
      message: `SIAP PASANG ${bias === 'bullish' ? 'BUY' : 'SELL'} LIMIT di ${entryPrice.toFixed(6)} — breakout+retest H1 confirmed, RSI D1 ${rsiD1.toFixed(1)} (belum jenuh), Force Index ${found.forceIndexValue.toFixed(2)} tanpa divergence, RR 1:2/1:3.`,
    };
  } catch (err) {
    return {
      status: 'error', symbol, currentPrice: 0, timestamp, mode: 'structural',
      message: err instanceof Error ? err.message : 'Unknown error',
      maxScore,
    };
  }
}
// ─── Scalping Mode Classifier (Structural vs Scalping 15M) ─────────────────
// Classifier MURAH — cuma ngecek apakah ada breakout+retest M15 valid dalam
// beberapa candle terakhir (murah karena udah pake data yang emang di-fetch).
export interface ScalpingModeClassification {
  recommendedMode: 'structural' | 'scalping15m';
  reason: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MONEY MAGNET 2 (request user, GANTI TOTAL Skill 15M — sebelumnya Breakout
// Retest Strategy M15, sekarang jadi varian Money Magnet dengan CASCADING
// multi-level breakout, tetap di M30 sesuai konsep asal). Bedanya dari Money
// Magnet biasa: breakout WAJIB nembus MINIMAL 2 level SNR sekaligus (SNR1
// fresh + SNR2), TANPA konsolidasi di antaranya. Kalau breakout terus lanjut
// jebol SNR3, SNR4, dst tanpa jeda, entry/SL ikut geser ke level terdalam.
// Entry = level TERDALAM yang ketembus, SL = 1 level SEBELUM yang terdalam.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// MONEY MAGNET 2 v3 (Scalping, H4/M30, CASCADING dipertahankan, request user):
// FASE 1: sama persis Money Magnet 1 -- Market Structure V2 H4 (requireADX=
//         false) + EMA26 H4 searah
// FASE 2: breakout M30 (swing S/R fresh ATAU EMA26 M30), volume>=2x MA20,
//         CASCADE ke level lebih dalam (SNR2, SNR3, dst) selama harga
//         terus lanjut tanpa konsolidasi -- entry di level TERDALAM
// FASE 3: retest ke level terdalam, Force Index searah TANPA divergence
// FASE 4: SL di swing SEBELUM level terdalam itu, TP RR1:2/1:3
// ═══════════════════════════════════════════════════════════════════════════

export async function analyzeMoneyMagnet1(symbol: string): Promise<ScalpingResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';
  const maxScore = 100;

  try {
    const [h1, m15, tickerRes] = await Promise.all([
      fetchKlines(symbol, '1h', 50),
      fetchKlines(symbol, '15m', 50),
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);
    const currentPrice = tickerRes.ok
      ? parseFloat((await tickerRes.json() as { price: string }).price)
      : m15.closes[m15.closes.length - 1]!;

    if (h1.closes.length < 50 || m15.closes.length < 50) {
      return { status: 'error', symbol, currentPrice, timestamp, mode: 'moneymagnet1', message: 'Data candle gak cukup (butuh H1 50+, M15 50+)', maxScore };
    }

    // ═══ FASE 1: H1 TREND IDENTIFICATION ═══════════════════════════════════
    const emaSeries26H1 = calcEMASeries(h1.closes, 26);
    const lastH1Idx = h1.closes.length - 2;
    const ema26H1 = emaSeries26H1[lastH1Idx]!;
    const closeH1 = h1.closes[lastH1Idx]!;
    const biasH1: 'bullish' | 'bearish' = closeH1 > ema26H1 ? 'bullish' : 'bearish';

    const c1 = h1.closes[lastH1Idx]!, o1 = h1.opens[lastH1Idx]!;
    const c2 = h1.closes[lastH1Idx - 1]!, o2 = h1.opens[lastH1Idx - 1]!;
    const momentumOk = biasH1 === 'bullish' ? (c1 > o1 && c2 > o2) : (c1 < o1 && c2 < o2);
    if (!momentumOk) {
      return { status: 'no_setup', symbol, currentPrice, timestamp, mode: 'moneymagnet1', message: `Momentum H1 belum konfirmasi (butuh 2 candle berturut ${biasH1 === 'bullish' ? 'hijau' : 'merah'})`, maxScore };
    }

    let h1CrossCount = 0;
    const crossWindowStart = Math.max(1, lastH1Idx - 19);
    for (let i = crossWindowStart; i <= lastH1Idx; i++) {
      const prevAbove = h1.closes[i - 1]! > emaSeries26H1[i - 1]!;
      const nowAbove = h1.closes[i]! > emaSeries26H1[i]!;
      if (prevAbove !== nowAbove) h1CrossCount++;
    }
    if (h1CrossCount > 3) {
      return { status: 'no_setup', symbol, currentPrice, timestamp, mode: 'moneymagnet1', message: `H1 udah crossing EMA26 ${h1CrossCount}x dalam 20 candle terakhir (>3x) — trend dianggap exhausted/chop, bukan "fresh magnet"`, maxScore };
    }

    const filterResults: string[] = [
      `✅ H1 Trend ${biasH1.toUpperCase()} — Close ${closeH1.toFixed(6)} vs EMA26 ${ema26H1.toFixed(6)}, momentum 2 candle konfirmasi, crossing ${h1CrossCount}x/20candle (fresh, ≤3x)`,
    ];

    // ═══ FASE 2: M15 BREAKOUT CONFIRMATION (level FRESH, tanpa syarat touch) ═
    const atrM15 = calcATR(m15.highs, m15.lows, m15.closes);
    if (atrM15 <= 0) {
      return { status: 'error', symbol, currentPrice, timestamp, mode: 'moneymagnet1', message: 'ATR M15 gak valid', maxScore };
    }
    const lastClosedIdx = m15.closes.length - 2;

    const swingLookbackWindow = 40;
    const swingSlice = Math.max(0, lastClosedIdx - swingLookbackWindow);
    const highsSliced = m15.highs.slice(swingSlice, lastClosedIdx + 1);
    const lowsSliced = m15.lows.slice(swingSlice, lastClosedIdx + 1);
    const freshHighFound = findLastSwingHighWithIndex(highsSliced);
    const freshLowFound = findLastSwingLowWithIndex(lowsSliced);

    if (!freshHighFound || !freshLowFound) {
      return { status: 'no_structure', symbol, currentPrice, timestamp, mode: 'moneymagnet1', message: 'Belum ada swing high/low M15 yang kedeteksi', maxScore };
    }
    const freshSwingHigh = freshHighFound.price;
    const freshSwingLow = freshLowFound.price;
    const swingHighIdxAbs = swingSlice + freshHighFound.index;
    const swingLowIdxAbs = swingSlice + freshLowFound.index;
    const touchTolFresh = atrM15 * 0.1;

    const isFreshUntouched = (swingIdxAbs: number, level: number, checkUntilIdx: number): boolean => {
      for (let i = swingIdxAbs + 1; i < checkUntilIdx; i++) {
        const h = m15.highs[i]!, l = m15.lows[i]!;
        if (Math.abs(h - level) <= touchTolFresh || Math.abs(l - level) <= touchTolFresh || (l <= level && h >= level)) return false;
      }
      return true;
    };

    const emaSeries26M15 = calcEMASeries(m15.closes, 26);

    type MoneyMagnet1Found = {
      breakoutIdx: number; retestIdx: number; brokenLevel: number;
      magnetLevelUsed: 'broken_level' | 'ema26'; entryLevel: number;
      confluencePct: number; forceIndexValue: number; stochSlow: { k: number; d: number };
    };
    let found: MoneyMagnet1Found | null = null;

    const forceIndexSeries = calcForceIndexSeries(m15.closes, m15.volumes);

    for (let breakoutIdx = lastClosedIdx - 1; breakoutIdx >= Math.max(swingSlice + 5, lastClosedIdx - 24); breakoutIdx--) {
      const closeB = m15.closes[breakoutIdx]!;

      // FIX BUG (audit user): breakoutIdx WAJIB setelah swing SENDIRI kebentuk
      const bearishBreakout = biasH1 === 'bearish' && breakoutIdx > swingLowIdxAbs && closeB < freshSwingLow && isFreshUntouched(swingLowIdxAbs, freshSwingLow, breakoutIdx);
      const bullishBreakout = biasH1 === 'bullish' && breakoutIdx > swingHighIdxAbs && closeB > freshSwingHigh && isFreshUntouched(swingHighIdxAbs, freshSwingHigh, breakoutIdx);
      if (!bearishBreakout && !bullishBreakout) continue;

      const bias = bearishBreakout ? 'bearish' : 'bullish';
      const brokenLevel = bearishBreakout ? freshSwingLow : freshSwingHigh;

      const nextIdx = breakoutIdx + 1;
      if (nextIdx > lastClosedIdx) continue;
      const continuedOk = bias === 'bearish' ? m15.closes[nextIdx]! <= closeB : m15.closes[nextIdx]! >= closeB;
      if (!continuedOk) continue;

      for (let retestIdx = nextIdx + 1; retestIdx <= lastClosedIdx; retestIdx++) {
        const ema26AtRetest = emaSeries26M15[retestIdx]!;
        const c = m15.closes[retestIdx]!;

        const confluencePct = (Math.abs(brokenLevel - ema26AtRetest) / brokenLevel) * 100;
        if (confluencePct > 1) continue;

        const nearBroken = Math.abs(c - brokenLevel) / brokenLevel * 100 <= 0.3;
        const nearEma = Math.abs(c - ema26AtRetest) / ema26AtRetest * 100 <= 0.3;
        if (!nearBroken && !nearEma) continue;

        const fiIdx = retestIdx - 1;
        const fiVal = forceIndexSeries[fiIdx];
        if (fiVal === undefined) continue;
        const forceIndexOk = bias === 'bearish' ? fiVal > 0 : fiVal < 0;
        if (!forceIndexOk) continue;

        const stochSlow = calcStochasticSlow(
          m15.highs.slice(0, retestIdx + 1), m15.lows.slice(0, retestIdx + 1), m15.closes.slice(0, retestIdx + 1),
          5, 3, 3,
        );

        const distBroken = Math.abs(currentPrice - brokenLevel);
        const distEma = Math.abs(currentPrice - ema26AtRetest);
        const magnetLevelUsed: 'broken_level' | 'ema26' = distBroken <= distEma ? 'broken_level' : 'ema26';
        const entryLevel = magnetLevelUsed === 'broken_level' ? brokenLevel : ema26AtRetest;

        found = { breakoutIdx, retestIdx, brokenLevel, magnetLevelUsed, entryLevel, confluencePct, forceIndexValue: fiVal, stochSlow };
        break;
      }
      if (found) break;
    }

    if (!found) {
      return {
        status: 'waiting', symbol, currentPrice, timestamp, mode: 'moneymagnet1',
        message: `Belum ada breakout+retest ke magnet zone yang valid dalam 24 candle M15 terakhir (breakout M15 harus searah H1 ${biasH1}, retest butuh confluence broken-level+EMA26 ±1% dan Force Index ${biasH1 === 'bearish' ? 'positif' : 'negatif'})`,
        maxScore, filterResults, h4CrossCount: h1CrossCount,
      };
    }

    const bias = biasH1;
    filterResults.push(`✅ Breakout M15 valid — level fresh ${found.brokenLevel.toFixed(6)} tembus searah H1 (belum pernah disentuh ulang sejak kebentuk), harga lanjut ${bias}`);
    filterResults.push(`✅ Retest ke magnet zone — broken level & EMA26 confluence ${found.confluencePct.toFixed(2)}% (≤1%), Force Index ${found.forceIndexValue > 0 ? 'positif' : 'negatif'} (${found.forceIndexValue.toFixed(2)})`);
    filterResults.push(`ℹ️ Stochastic Slow (bonus, gak block): %K=${found.stochSlow.k.toFixed(1)}, %D=${found.stochSlow.d.toFixed(1)}`);
    filterResults.push(`✅ Entry level dipilih: ${found.magnetLevelUsed === 'broken_level' ? 'broken level' : 'EMA26'} (paling deket ke harga sekarang)`);

    // ═══ FASE 4: ENTRY SETUP ════════════════════════════════════════════════
    const dirMult = bias === 'bullish' ? 1 : -1;
    const entryPrice = found.entryLevel;

    const entryStillValid = bias === 'bullish' ? entryPrice <= currentPrice : entryPrice >= currentPrice;
    if (!entryStillValid) {
      return {
        status: 'waiting', symbol, currentPrice, timestamp, mode: 'moneymagnet1',
        message: `Breakout+retest udah basi — harga sekarang (${currentPrice.toFixed(6)}) udah ${bias === 'bullish' ? 'di bawah' : 'di atas'} level entry (${entryPrice.toFixed(6)})`,
        maxScore, filterResults,
      };
    }

    const atrM15Fresh = atrM15; // alias biar jelas basis SL
    const stopLoss = entryPrice - atrM15Fresh * 1.0 * dirMult;
    const risk = Math.abs(entryPrice - stopLoss);
    const takeProfit1 = entryPrice + risk * 2 * dirMult;
    const rr1 = 2;

    filterResults.push(`✅ SL pure ATR M15 (1.0x) @ ${stopLoss.toFixed(6)}, TP RR 1:${rr1} @ ${takeProfit1.toFixed(6)}`);

    return {
      status: 'in_zone', symbol, bias, currentPrice, timestamp, mode: 'moneymagnet1',
      maxScore, filterResults,
      entryPrice, stopLoss, takeProfit1, rr1,
      moneyMagnetVariant: 'standard',
      h4CrossCount: h1CrossCount, forceIndexValue: found.forceIndexValue, stochSlowAtRetest: found.stochSlow,
      magnetLevelUsed: found.magnetLevelUsed, magnetConfluencePct: Math.round(found.confluencePct * 1000) / 1000,
      atr15MPct: (atrM15 / currentPrice) * 100,
      message: `SIAP PASANG ${bias === 'bullish' ? 'BUY' : 'SELL'} LIMIT di ${entryPrice.toFixed(6)} (${found.magnetLevelUsed === 'broken_level' ? 'broken level' : 'EMA26'}) — H1 ${bias} fresh (${h1CrossCount}x crossing), Force Index ${found.forceIndexValue > 0 ? 'positif' : 'negatif'}, RR 1:${rr1}.`,
    };
  } catch (err) {
    return {
      status: 'error', symbol, currentPrice: 0, timestamp, mode: 'moneymagnet1',
      message: err instanceof Error ? err.message : 'Unknown error',
      maxScore,
    };
  }
}



/**
 * Classifier murah — deteksi cepat apakah ada breakout M15 dalam retest window
 * (tanpa jalanin analisa penuh dua-duanya). Kalau ada breakout terdeteksi via
 * ZigZag M15 sederhana, arahin ke Scalping 15M; kalau enggak, arahin ke Structural.
 */
export function classifyScalpingMode(closes: number[], volumes: number[]): ScalpingModeClassification {
  const n = closes.length;
  if (n < 25) return { recommendedMode: 'structural', reason: 'Data M15 gak cukup buat classifier' };
  const volWindow = volumes.slice(-21, -1);
  const avgVol = volWindow.length > 0 ? volWindow.reduce((a, b) => a + b, 0) / volWindow.length : 0;
  const lastVol = volumes[n - 1]!;
  const volRatio = avgVol > 0 ? lastVol / avgVol : 0;
  if (volRatio > 1.4) {
    return { recommendedMode: 'scalping15m', reason: `Volume M15 lagi tinggi (${(volRatio * 100).toFixed(0)}% avg) — indikasi breakout, cocok Scalping 15M` };
  }
  return { recommendedMode: 'structural', reason: `Volume M15 normal (${(volRatio * 100).toFixed(0)}% avg) — lebih cocok baca struktur H4→M30→M5` };
}


// FIX (request user, "wajib pilih yang kuat" — dampak ke SEMUA 4 caller:
// Menu 4 Structural, Counter Structural, CVD-OI Confluence, Extreme
// Scalping Sniper): zona S&R sekarang WAJIB punya minimal 2 touches
// (berapa titik swing yang ke-merge jadi 1 level) sebelum dianggap valid
// — bukan lagi "semua zona diperlakukan setara". Tervalidasi eksperimen
// sebelumnya (Menu 4, 38 koin H1): min_touches=2 kasih WR 47.6% (n=21)
// vs baseline tanpa filter 42.3% (n=104) — CATATAN JUJUR: sample jauh
// lebih kecil dan breakdown per-touches-count sempat kelihatan noisy,
// jadi ini BUKAN peningkatan yang benar-benar solid secara statistik,
// diimplementasikan sesuai request eksplisit user.
function detectZonesForExtreme(htf: KlineData, atrHtf: number, minTouches = 2, mergeMult = 0.5): { resistanceLevels: number[]; supportLevels: number[]; zoneWidth: number } {
  const zoneWidth = atrHtf * 0.35;
  const mergeDistance = atrHtf * mergeMult;
  const lookbackSlice = 120;
  const h = htf.highs.slice(-lookbackSlice);
  const l = htf.lows.slice(-lookbackSlice);
  const swingH = findSwingHighs(h, 30);
  const swingL = findSwingLows(l, 30);
  const mergeLevelsWithTouches = (levels: number[]): number[] => {
    if (levels.length === 0) return [];
    const sorted = [...levels].sort((a, b) => a - b);
    const groups: number[][] = [[sorted[0]!]];
    for (let i = 1; i < sorted.length; i++) {
      const lastGroup = groups[groups.length - 1]!;
      if (sorted[i]! - lastGroup[lastGroup.length - 1]! <= mergeDistance) {
        lastGroup.push(sorted[i]!);
      } else {
        groups.push([sorted[i]!]);
      }
    }
    return groups
      .filter(g => g.length >= minTouches)
      .map(g => g.reduce((a, b) => a + b, 0) / g.length); // level = rata-rata titik dalam grup
  };
  return { resistanceLevels: mergeLevelsWithTouches(swingH), supportLevels: mergeLevelsWithTouches(swingL), zoneWidth };
}

/**
 * FIX (request user): filter zona S&R WAJIB numpuk sama level Fibonacci
 * retracement (30 candle terakhir) — dipake TERPISAH dari detectZonesForExtreme
 * (fungsi shared itu SENGAJA gak diubah, biar Multi-TF Scanner + Counter
 * Structural TETAP apa adanya, cuma Structural yang kena filter ini). Pola
 * confluence sama persis Skill 15M & detectStrongestZonePerTF, toleransi
 * numpuk 0.5%. Dipanggil manual setelah detectZonesForExtreme, gantiin hasil
 * resistanceLevels/supportLevels-nya sebelum lanjut ke tryZoneBreakoutRetest.
 */
interface FibZoneMatch {
  price: number;
  fibLevel: string;
}

function filterZonesNumpukFib(levels: number[], highs: number[], lows: number[], closes: number[]): FibZoneMatch[] {
  const fib = calcFibonacci(highs, lows, closes);
  if (!fib) return []; // gak ada range Fib valid (30 candle terakhir flat) — gak ada zona yang bisa dikonfirmasi
  const result: FibZoneMatch[] = [];
  for (const lvl of levels) {
    for (const [fibName, fibValue] of Object.entries(fib.levels)) {
      if ((Math.abs(lvl - fibValue) / lvl) * 100 < 0.5) {
        result.push({ price: lvl, fibLevel: fibName });
        break; // satu match Fib cukup per level
      }
    }
  }
  return result;
}

/**
 * REVISI (request user, berdasarkan riset 630 sample breakout+retest):
 * PRIORITASKAN level Fibonacci tertentu buat retest entry, bukan terima
 * semua level numpuk Fib secara sama rata.
 *
 * Structural (M30): data nunjukin Fib 0.5 paling reliable (WR 42.3%,
 * n=26) di antara sample yang cukup besar. User minta prioritas ke
 * 0.786-1.0 (atau minimal 0.5) di atas zona dangkal (0.0-0.236).
 *
 * Skill 15M (M15): Fib 0.236 JELAS paling reliable (WR 48.0%, n=75 --
 * sample besar). Zona dalam (0.618-0.786) PALING LEMAH (WR 25.8-29.8%),
 * WAJIB dihindari.
 */
function scoreFibPriorityStructural(fibLevel: string): number {
  if (fibLevel === '1.0' || fibLevel === '0.786') return 3;
  if (fibLevel === '0.5') return 2;
  if (fibLevel === '0.0' || fibLevel === '0.236') return 0; // zona dangkal, dihindari
  return 1; // 0.382, 0.618, 0.705 -- netral
}

function scoreFibPrioritySkill15M(fibLevel: string): number {
  if (fibLevel === '0.236') return 3; // paling reliable, sample besar
  if (fibLevel === '0.618' || fibLevel === '0.786') return 0; // paling lemah, dihindari
  return 1; // sisanya netral
}

/**
 * Sama persis basis detectZonesForExtreme, tapi TRACK jumlah swing point yang
 * ke-merge jadi 1 level (touches/hits) — dibutuhin buat nentuin "S&R terkuat"
 * di Menu 8 Momentum Hunter (reversal-ekstrem butuh level yang genuinely sering
 * disentuh, bukan sembarang swing point).
 */
function detectZonesWithHits(htf: KlineData, atrHtf: number): { resistanceLevels: { price: number; hits: number }[]; supportLevels: { price: number; hits: number }[]; zoneWidth: number } {
  const zoneWidth = atrHtf * 0.35;
  const mergeDistance = atrHtf * 0.5;
  const lookbackSlice = 120;
  const h = htf.highs.slice(-lookbackSlice);
  const l = htf.lows.slice(-lookbackSlice);
  const swingH = findSwingHighs(h, 30);
  const swingL = findSwingLows(l, 30);
  const mergeWithHits = (levels: number[]): { price: number; hits: number }[] => {
    if (levels.length === 0) return [];
    const sorted = [...levels].sort((a, b) => a - b);
    const clusters: number[][] = [[sorted[0]!]];
    for (let i = 1; i < sorted.length; i++) {
      const last = clusters[clusters.length - 1]!;
      const avgLast = last.reduce((a, b) => a + b, 0) / last.length;
      if (Math.abs(sorted[i]! - avgLast) <= mergeDistance) last.push(sorted[i]!);
      else clusters.push([sorted[i]!]);
    }
    return clusters.map(c => ({ price: c.reduce((a, b) => a + b, 0) / c.length, hits: c.length }));
  };
  return { resistanceLevels: mergeWithHits(swingH), supportLevels: mergeWithHits(swingL), zoneWidth };
}

/**
 * FIX (request user): cek apakah harga SEKARANG lagi di AREA S&R KUAT
 * (touches>=2, reuse detectZonesWithHits) DAN DIPERKUAT sama kondisi
 * overbought/oversold di TF YANG SAMA — BEDA dari checkIndicatorExhaustion
 * (yang cuma cek indikator doang, TANPA peduli posisi harga relatif ke S&R).
 * Logikanya: 'zona S&R kuat + indikator ekstrem BARENGAN' itu kombinasi
 * yang lebih SPESIFIK nunjukin resiko reversal — bukan cuma RSI tinggi
 * doang (yang backtest kita buktikan SERING kali malah nunjukin momentum
 * masih kuat, bukan bahaya).
 * minTouches=2 (konsisten basis detectZonesForExtreme/detectZonesWithHits).
 */
interface SRExtremeConfluenceResult {
  danger: boolean;
  nearZonePrice?: number;
  zoneTouches?: number;
  distanceAtrRatio?: number; // seberapa deket harga ke zona, dalam satuan ATR
  rsi: number;
}
function checkSRExtremeConfluence(htf: KlineData, bias: 'bullish' | 'bearish', proximityAtrRatio = 0.5): SRExtremeConfluenceResult {
  const atr = calcATR(htf.highs, htf.lows, htf.closes);
  const currentPrice = htf.closes[htf.closes.length - 1] ?? 0;
  const rsi = calcRSI(htf.closes, 14);
  if (atr <= 0 || currentPrice <= 0) return { danger: false, rsi };

  const { resistanceLevels, supportLevels } = detectZonesWithHits(htf, atr);
  // Buat BUY: bahaya kalau harga DEKET RESISTANCE KUAT + RSI overbought
  // (mau breakout tapi nabrak dinding kuat pas momentum udah jenuh).
  // Buat SELL: bahaya kalau harga DEKET SUPPORT KUAT + RSI oversold.
  const relevantZones = bias === 'bullish' ? resistanceLevels : supportLevels;
  const isExtreme = bias === 'bullish' ? rsi >= 70 : rsi <= 30;

  if (!isExtreme) return { danger: false, rsi };

  for (const zone of relevantZones) {
    if (zone.hits < 2) continue; // zona LEMAH (cuma numpuk 1x) — bukan target confluence ini
    const distance = Math.abs(currentPrice - zone.price);
    const distanceAtrRatio = distance / atr;
    if (distanceAtrRatio <= proximityAtrRatio) {
      return { danger: true, nearZonePrice: zone.price, zoneTouches: zone.hits, distanceAtrRatio, rsi };
    }
  }
  return { danger: false, rsi };
}

/**
 * FIX (request user): filter BERTINGKAT — cek H1 dulu, kalau AMAN lanjut
 * H4, kalau AMAN lagi lanjut D1. SALAH SATU level nunjukin 'danger'
 * (S&R kuat + overbought/oversold bareng) itu udah cukup buat WARNING
 * (BUKAN hard block — konsisten sama filosofi "kasih tau, keputusan akhir
 * di user" yang sekarang dipake juga di BTC Correlation).
 */
interface MultiTFConfluenceResult {
  danger: boolean;
  dangerTf?: 'H1' | 'H4' | 'D1';
  detail?: SRExtremeConfluenceResult;
}
async function checkMultiTFSRConfluence(symbol: string, bias: 'bullish' | 'bearish'): Promise<MultiTFConfluenceResult> {
  const tfConfigs: { tf: 'H1' | 'H4' | 'D1'; interval: string; limit: number }[] = [
    { tf: 'H1', interval: '1h', limit: 150 },
    { tf: 'H4', interval: '4h', limit: 150 },
    { tf: 'D1', interval: '1d', limit: 150 },
  ];
  for (const cfg of tfConfigs) {
    try {
      const klines = await fetchKlines(symbol, cfg.interval, cfg.limit);
      const result = checkSRExtremeConfluence(klines, bias);
      if (result.danger) return { danger: true, dangerTf: cfg.tf, detail: result };
    } catch {
      continue; // fail-safe — 1 TF gagal fetch, lanjut cek TF berikutnya, jangan gagalin seluruh check
    }
  }
  return { danger: false };
}

type ZoneEventOk = {
  ok: true;
  status: 'approaching' | 'in_zone';
  bias: 'bullish' | 'bearish';
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  rr1: number;
  zoneEdgeUpper: number;
  zoneEdgeLower: number;
  candlesSinceBreakout: number;
  note: string;
  momentumFavorable?: boolean; // true kalau momentum deselerasi (bagus buat retest/rejection)
  structureNote?: string; // soft-warning kalau sistem lama (analyzePriceActionStructure) beda pendapat sama Market Structure V2 (primary)
  marketStructureV2?: MarketStructureV2Result | null; // detail lengkap V2 (klasifikasi, skor 3 arah, breakdown layer) — informasional, buat transparansi UI
};
type ZoneEventFail = { ok: false; status: 'waiting' | 'expired'; reason: string; marketStructureV2?: MarketStructureV2Result | null };

/**
 * TOGGLE — Market Structure V2 sebagai penentu utama arah struktur di basis
 * Skill 15M (request user). Set `false` buat MATIIN total gate V2 dan balik
 * ke perilaku lama (murni swing+merge zone detection, gak ada cek
 * bullish/bearish/sideways sama sekali) — satu baris ini doang yang perlu
 * diubah, gak perlu sentuh logic lain.
 */
const STRUCTURE_V2_ENABLED = true;

/**
 * Helper — cek struktur V2 (primary gate) + sistem lama (soft warning),
 * dipake bareng di tryZoneBreakoutRetest & tryZoneRejectionRetest biar gak
 * duplikasi logic. Return null kalau V2 gak sejalan sama bias (=block sinyal),
 * atau string structureNote (bisa undefined) kalau lolos.
 */
type StructureV2GateResult =
  | { blocked: true; reason: string; structV2: MarketStructureV2Result }
  | { blocked: false; structureNote?: string; structV2: MarketStructureV2Result | null };

function checkStructureV2Gate(htf: KlineData, bias: 'bullish' | 'bearish', tf: TFLabelV2, eventDescription?: string): StructureV2GateResult {
  if (!STRUCTURE_V2_ENABLED) return { blocked: false, structV2: null };

  const structV2 = analyzeMarketStructureV2(htf.opens, htf.highs, htf.lows, htf.closes, tf, htf.volumes);
  const v2Compatible =
    (bias === 'bullish' && (structV2.classification === 'bullish_strong' || structV2.classification === 'bullish_weak')) ||
    (bias === 'bearish' && (structV2.classification === 'bearish_strong' || structV2.classification === 'bearish_weak'));

  if (!v2Compatible) {
    const desc = eventDescription ?? `Breakout ${bias} ketemu`;
    return {
      blocked: true, structV2,
      reason: `${desc}, TAPI Market Structure V2 baca struktur "${structV2.classification}" (bull=${structV2.bullishTotal}, bear=${structV2.bearishTotal}, sideways=${structV2.sidewaysTotal}/9) — gak sejalan, sinyal di-block`,
    };
  }

  // Soft warning dari sistem LAMA — dibandingin doang, GAK nge-block apapun
  const oldStruct = analyzePriceActionStructure(htf.highs, htf.lows, htf.closes);
  const oldMappedBias = oldStruct.bias === 'ranging' ? null : oldStruct.bias;
  const structureNote = oldMappedBias !== null && oldMappedBias !== bias
    ? `⚠️ Sistem lama baca beda arah (${oldStruct.bias}, ${oldStruct.strength}) — V2 (primary) bilang ${structV2.classification}`
    : undefined;

  return { blocked: false, structureNote, structV2 };
}

/**
 * Versi gate buat REJECTION/mean-reversion (beda logic dari breakout). Sideways
 * itu KONTEKS BAGUS buat mean-reversion (bukan alasan block) — yang di-block
 * cuma kalau V2 baca ada trend KUAT yang BERLAWANAN arah reversal (misal mau
 * short di resistance tapi V2 bilang bullish_strong — ngelawan trend kuat).
 */
function checkStructureV2GateForReversal(htf: KlineData, bias: 'bullish' | 'bearish', tf: TFLabelV2): StructureV2GateResult {
  if (!STRUCTURE_V2_ENABLED) return { blocked: false, structV2: null };

  const structV2 = analyzeMarketStructureV2(htf.opens, htf.highs, htf.lows, htf.closes, tf, htf.volumes);
  const fightsStrongTrend =
    (bias === 'bullish' && structV2.classification === 'bearish_strong') ||
    (bias === 'bearish' && structV2.classification === 'bullish_strong');

  if (fightsStrongTrend) {
    return {
      blocked: true, structV2,
      reason: `Rejection ${bias} ketemu TAPI Market Structure V2 baca trend KUAT berlawanan (${structV2.classification}, bull=${structV2.bullishTotal}, bear=${structV2.bearishTotal}) — ngelawan trend kuat, sinyal di-block`,
    };
  }

  const oldStruct = analyzePriceActionStructure(htf.highs, htf.lows, htf.closes);
  const oldMappedBias = oldStruct.bias === 'ranging' ? null : oldStruct.bias;
  const structureNote = oldMappedBias !== null && oldMappedBias === (bias === 'bullish' ? 'bearish' : 'bullish')
    ? `⚠️ Sistem lama baca trend ${oldStruct.bias} (${oldStruct.strength}) — lawan arah reversal ini, V2 (primary) bilang ${structV2.classification}`
    : undefined;

  return { blocked: false, structureNote, structV2 };
}

interface TFClassification {
  bias: 'bullish' | 'bearish' | 'sideways';
  adx: number;
  confirmations: string[];
  marketStructureV2?: MarketStructureV2Result | null;
}

/**
 * Fix konsistensi basis (request user): dulu logic breakout event-based
 * STANDALONE (kloningan mini basis Skill 15M lama), sekarang pake mesin
 * scoring yang SAMA persis kayak semua 9 skill entry — Market Structure V2.
 */
function classifyTFTrend(opens: number[], highs: number[], lows: number[], closes: number[], volumes: number[], tf: TFLabelV2): TFClassification {
  const adx = calcADX(highs, lows, closes);
  if (adx < 25) {
    return { bias: 'sideways', adx, confirmations: [`ADX ${adx.toFixed(1)} < 25 — trend lemah/choppy`] };
  }

  const structV2 = analyzeMarketStructureV2(opens, highs, lows, closes, tf, volumes);
  const confirmations: string[] = [
    `Market Structure V2: ${structV2.classification} (bull=${structV2.bullishTotal}, bear=${structV2.bearishTotal}, sideways=${structV2.sidewaysTotal}/9)`,
    ...structV2.reasoning,
  ];
  return { bias: structV2.bias, adx, confirmations, marketStructureV2: structV2 };
}

/**
 * Zona referensi terkuat per TF — OPSIONAL, buat gambaran entry manual doang
 * (SENGAJA gak ada SL/TP otomatis). Prioritas: Order Block dulu (kalau ada),
 * fallback S&R terkuat yang numpuk sama Fibonacci (reuse logic yang sama
 * kayak Extreme Scalping). Null kalau bias sideways (gak ada arah jelas).
 */
interface ZoneInfo {
  type: 'order_block' | 'sr_fib';
  low: number;
  high: number;
  mid: number;
  touches: number;
}

function detectStrongestZonePerTF(opens: number[], highs: number[], lows: number[], closes: number[], bias: 'bullish' | 'bearish' | 'sideways'): ZoneInfo | null {
  if (bias === 'sideways') return null;

  const obs = detectOrderBlocksH1(opens, highs, lows, closes, bias, 30);
  if (obs.length > 0) {
    const strongest = obs.reduce((a, b) => (b.strength ?? 0) > (a.strength ?? 0) ? b : a);
    return { type: 'order_block', low: strongest.low, high: strongest.high, mid: strongest.mid, touches: strongest.touches };
  }

  const atr = calcATR(highs, lows, closes);
  const srLevels = detectSRLevels(highs, lows, closes, 100);
  const fib = calcFibonacci(highs, lows, closes);
  const relevantType = bias === 'bullish' ? 'support' : 'resistance';
  const candidates = srLevels.filter(s => s.type === relevantType);

  let bestSr: SRLevel | null = null;
  if (fib && candidates.length > 0) {
    const fibValues = Object.values(fib.levels);
    for (const sr of candidates) {
      const numpukFib = fibValues.some(fv => (Math.abs(sr.price - fv) / sr.price) * 100 < 0.5);
      if (numpukFib && (!bestSr || sr.touches > bestSr.touches)) bestSr = sr;
    }
  }
  if (!bestSr) return null;
  const zoneWidth = atr * 0.15;
  return { type: 'sr_fib', low: bestSr.price - zoneWidth, high: bestSr.price + zoneWidth, mid: bestSr.price, touches: bestSr.touches };
}

/**
 * RSI Divergence generic — di-extract dari logic yang sebelumnya nempel di
 * Sniper (STEP 4b), dibikin reusable buat timeframe manapun. Beda dari versi
 * Sniper: di sini cek DUA ARAH sekaligus (bullish & bearish independen),
 * bukan cuma 1 arah sesuai bias — karena ini fitur informasional, bukan filter.
 */
interface DivergenceResult {
  bullish: boolean;
  bearish: boolean;
}

function detectRSIDivergenceGeneric(highs: number[], lows: number[], closes: number[]): DivergenceResult {
  const rsiSeries = calcRSISeries(closes);
  const swingHighs = findSwingPointsIdx(highs, 'high', 2);
  const swingLows = findSwingPointsIdx(lows, 'low', 2);

  let bullish = false;
  if (swingLows.length >= 2) {
    const l1 = swingLows[swingLows.length - 2]!;
    const l2 = swingLows[swingLows.length - 1]!;
    const priceLL = l2.value < l1.value;
    const rsiAtL1 = rsiSeries[l1.idx] ?? 50;
    const rsiAtL2 = rsiSeries[l2.idx] ?? 50;
    bullish = priceLL && rsiAtL2 > rsiAtL1 + 2 && rsiAtL2 < 45;
  }

  let bearish = false;
  if (swingHighs.length >= 2) {
    const h1s = swingHighs[swingHighs.length - 2]!;
    const h2s = swingHighs[swingHighs.length - 1]!;
    const priceHH = h2s.value > h1s.value;
    const rsiAtH1 = rsiSeries[h1s.idx] ?? 50;
    const rsiAtH2 = rsiSeries[h2s.idx] ?? 50;
    bearish = priceHH && rsiAtH2 < rsiAtH1 - 2 && rsiAtH2 > 55;
  }

  return { bullish, bearish };
}

/**
 * Volume Divergence — BARU, belum pernah ada di project. Konsep: harga bikin
 * level baru (HH/LL) tapi volume di titik itu malah lebih rendah dari titik
 * sebelumnya = momentum gak dikonfirmasi volume, warning potensi lemah/reversal.
 */
function detectVolumeDivergence(highs: number[], lows: number[], closes: number[], volumes: number[]): DivergenceResult {
  const swingHighs = findSwingPointsIdx(highs, 'high', 2);
  const swingLows = findSwingPointsIdx(lows, 'low', 2);

  // Bearish volume divergence: price HH tapi volume di HH kedua < HH pertama (uptrend melemah)
  let bearish = false;
  if (swingHighs.length >= 2) {
    const h1s = swingHighs[swingHighs.length - 2]!;
    const h2s = swingHighs[swingHighs.length - 1]!;
    const priceHH = h2s.value > h1s.value;
    const volAtH1 = volumes[h1s.idx] ?? 0;
    const volAtH2 = volumes[h2s.idx] ?? 0;
    bearish = priceHH && volAtH2 < volAtH1;
  }

  // Bullish volume divergence: price LL tapi volume di LL kedua < LL pertama (downtrend melemah)
  let bullish = false;
  if (swingLows.length >= 2) {
    const l1 = swingLows[swingLows.length - 2]!;
    const l2 = swingLows[swingLows.length - 1]!;
    const priceLL = l2.value < l1.value;
    const volAtL1 = volumes[l1.idx] ?? 0;
    const volAtL2 = volumes[l2.idx] ?? 0;
    bullish = priceLL && volAtL2 < volAtL1;
  }

  return { bullish, bearish };
}

// ═══════════════════════════════════════════════════════════════════════════
// FITUR 6 TA PRO — DIVERGENCE & KEKUATAN TREND (request user)
// MACD Divergence & Stochastic(5,3,3) Divergence -- BARU, pola generic sama
// kayak detectRSIDivergenceGeneric/detectVolumeDivergence di atas (bandingin
// 2 swing price terakhir vs nilai indikator di titik yang sama).
// ═══════════════════════════════════════════════════════════════════════════

function detectMACDDivergenceGeneric(highs: number[], lows: number[], closes: number[]): DivergenceResult {
  const emaFast = calcEMASeries(closes, 12);
  const emaSlow = calcEMASeries(closes, 26);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]!);
  const signalLine = calcEMASeries(macdLine, 9);
  const histSeries = macdLine.map((v, i) => v - signalLine[i]!);
  const swingHighs = findSwingPointsIdx(highs, 'high', 2);
  const swingLows = findSwingPointsIdx(lows, 'low', 2);

  let bearish = false;
  if (swingHighs.length >= 2) {
    const h1s = swingHighs[swingHighs.length - 2]!;
    const h2s = swingHighs[swingHighs.length - 1]!;
    const priceHH = h2s.value > h1s.value;
    const histAtH1 = histSeries[h1s.idx] ?? 0;
    const histAtH2 = histSeries[h2s.idx] ?? 0;
    bearish = priceHH && histAtH2 < histAtH1 && histAtH1 > 0; // histogram masih positif tapi mengecil = momentum melemah
  }

  let bullish = false;
  if (swingLows.length >= 2) {
    const l1 = swingLows[swingLows.length - 2]!;
    const l2 = swingLows[swingLows.length - 1]!;
    const priceLL = l2.value < l1.value;
    const histAtL1 = histSeries[l1.idx] ?? 0;
    const histAtL2 = histSeries[l2.idx] ?? 0;
    bullish = priceLL && histAtL2 > histAtL1 && histAtL1 < 0;
  }

  return { bullish, bearish };
}

// Stochastic 5,3,3 (lookback=5, smoothK=3, smoothD=3) -- settingan yang sama
// kayak calcStochasticSlow, tapi di sini butuh SERI %K (bukan cuma nilai
// terakhir) buat dibandingin di titik-titik swing.
function detectStochasticDivergenceGeneric(highs: number[], lows: number[], closes: number[]): DivergenceResult {
  const lookback = 5, smoothK = 3;
  const n = closes.length;
  if (n < lookback + smoothK + 5) return { bullish: false, bearish: false };

  const rawK: number[] = [];
  for (let i = lookback - 1; i < n; i++) {
    const windowHigh = Math.max(...highs.slice(i - lookback + 1, i + 1));
    const windowLow = Math.min(...lows.slice(i - lookback + 1, i + 1));
    const range = windowHigh - windowLow;
    rawK.push(range > 0 ? ((closes[i]! - windowLow) / range) * 100 : 50);
  }
  const kSeries: number[] = new Array(n).fill(50);
  for (let i = smoothK - 1; i < rawK.length; i++) {
    const win = rawK.slice(i - smoothK + 1, i + 1);
    const slowKVal = win.reduce((a, b) => a + b, 0) / win.length;
    kSeries[i + lookback - 1] = slowKVal; // offset balik ke index closes asli
  }

  const swingHighs = findSwingPointsIdx(highs, 'high', 2);
  const swingLows = findSwingPointsIdx(lows, 'low', 2);

  let bearish = false;
  if (swingHighs.length >= 2) {
    const h1s = swingHighs[swingHighs.length - 2]!;
    const h2s = swingHighs[swingHighs.length - 1]!;
    const priceHH = h2s.value > h1s.value;
    const kAtH1 = kSeries[h1s.idx] ?? 50;
    const kAtH2 = kSeries[h2s.idx] ?? 50;
    bearish = priceHH && kAtH2 < kAtH1 - 2 && kAtH2 > 70; // masih di area jenuh beli tapi %K-nya nurun
  }

  let bullish = false;
  if (swingLows.length >= 2) {
    const l1 = swingLows[swingLows.length - 2]!;
    const l2 = swingLows[swingLows.length - 1]!;
    const priceLL = l2.value < l1.value;
    const kAtL1 = kSeries[l1.idx] ?? 50;
    const kAtL2 = kSeries[l2.idx] ?? 50;
    bullish = priceLL && kAtL2 > kAtL1 + 2 && kAtL2 < 30; // masih di area jenuh jual tapi %K-nya naik
  }

  return { bullish, bearish };
}

export interface OIPriceVolumeSnapshot {
  timeframe: 'D1' | 'H4';
  priceChangePct: number;
  oiChangePct: number;
  volumeTrend: 'expanding' | 'contracting';
  scenario: 'long_baru_masuk' | 'short_covering' | 'short_baru_masuk' | 'long_nutup_posisi' | 'netral';
  interpretation: string;
}

// Open Interest + Price + Volume + Funding Rate -- klasifikasi 4-skenario
// standar (BUKAN divergence swing-comparison kayak 4 di atas, tapi baca
// KONFLUENSI price-move vs OI-move). Selalu D1 + H4 (request user), gak
// ngikut TF selector fitur ini -- OI histori Binance emang cuma granularitas
// 1h/4h/1d, dan D1+H4 dianggap paling relevan buat baca posisi "besar".
async function analyzeOIPriceVolumeFunding(symbol: string): Promise<{
  d1: OIPriceVolumeSnapshot | null;
  h4: OIPriceVolumeSnapshot | null;
  fundingRate: number | null;
  fundingInterpretation: string;
}> {
  const [d1k, h4k, oiD1, oiH4, funding] = await Promise.all([
    fetchKlines(symbol, '1d', 10),
    fetchKlines(symbol, '4h', 10),
    fetchOpenInterestHist(symbol, '1d', 10),
    fetchOpenInterestHist(symbol, '4h', 10),
    fetchFundingRate(symbol),
  ]);

  const buildSnapshot = (tf: 'D1' | 'H4', k: KlineData, oi: number[] | null): OIPriceVolumeSnapshot | null => {
    if (!oi || oi.length < 4 || k.closes.length < 5) return null;
    const lastClosedIdx = k.closes.length - 2;
    const priceNow = k.closes[lastClosedIdx]!;
    const priceBaseIdx = Math.max(0, lastClosedIdx - 3);
    const pricePrev = k.closes[priceBaseIdx]!;
    const priceChangePct = pricePrev !== 0 ? ((priceNow - pricePrev) / pricePrev) * 100 : 0;

    const oiNow = oi[oi.length - 1]!;
    const oiPrevIdx = Math.max(0, oi.length - 4);
    const oiPrev = oi[oiPrevIdx]!;
    const oiChangePct = oiPrev > 0 ? ((oiNow - oiPrev) / oiPrev) * 100 : 0;

    const volMa = calcSMA(k.volumes.slice(0, lastClosedIdx + 1), Math.min(20, lastClosedIdx + 1));
    const volumeTrend: 'expanding' | 'contracting' = (k.volumes[lastClosedIdx] ?? 0) > volMa ? 'expanding' : 'contracting';

    let scenario: OIPriceVolumeSnapshot['scenario'];
    let interpretation: string;
    if (priceChangePct > 0.1 && oiChangePct > 1) {
      scenario = 'long_baru_masuk';
      interpretation = 'Harga naik + OI naik — posisi LONG baru masuk, momentum bullish didukung fresh money (kuat)';
    } else if (priceChangePct > 0.1) {
      scenario = 'short_covering';
      interpretation = 'Harga naik tapi OI turun/flat — kemungkinan short covering, kenaikan kurang solid (rawan reversal)';
    } else if (priceChangePct < -0.1 && oiChangePct > 1) {
      scenario = 'short_baru_masuk';
      interpretation = 'Harga turun + OI naik — posisi SHORT baru masuk, momentum bearish didukung fresh money (kuat)';
    } else if (priceChangePct < -0.1) {
      scenario = 'long_nutup_posisi';
      interpretation = 'Harga turun tapi OI turun/flat — kemungkinan long liquidation/closing, penurunan kurang solid (rawan bounce)';
    } else {
      scenario = 'netral';
      interpretation = 'Harga & OI relatif flat — belum ada sinyal jelas';
    }
    return { timeframe: tf, priceChangePct, oiChangePct, volumeTrend, scenario, interpretation };
  };

  const d1Snap = buildSnapshot('D1', d1k, oiD1);
  const h4Snap = buildSnapshot('H4', h4k, oiH4);

  let fundingInterpretation = 'Data funding gak tersedia';
  if (funding !== null) {
    if (funding > 0.05) fundingInterpretation = `Funding rate ${funding.toFixed(4)}% — positif tinggi, crowd condong LONG (long bayar ke short), waspada potensi long squeeze kalau makin ekstrem`;
    else if (funding < -0.05) fundingInterpretation = `Funding rate ${funding.toFixed(4)}% — negatif tinggi, crowd condong SHORT (short bayar ke long), waspada potensi short squeeze kalau makin ekstrem`;
    else fundingInterpretation = `Funding rate ${funding.toFixed(4)}% — netral, gak ada bias crowd signifikan`;
  }

  return { d1: d1Snap, h4: h4Snap, fundingRate: funding, fundingInterpretation };
}

export interface TrendStrengthPanel {
  adx: number;
  adxClassification: 'lemah/ranging' | 'developing' | 'kuat' | 'sangat kuat';
  forceIndex: number;
  forceIndexDirection: 'bullish' | 'bearish';
  volumeRatio: number; // current vs MA20
  volumeTrend: 'expanding' | 'contracting';
  atrRatio: number; // current vs ATR 10 candle lalu
  volatilityTrend: 'naik' | 'turun';
}

// Kekuatan Trend -- panel multi-indikator (request user: "pokoknya indikator
// pembaca kekuatan trend"): ADX, Force Index, Volume vs MA20, ATR vs 10
// candle lalu. Dihitung di TF yang sama kayak 4 divergence check di atas.
function analyzeTrendStrength(highs: number[], lows: number[], closes: number[], volumes: number[]): TrendStrengthPanel {
  const adxResult = calcADXWithDI(highs, lows, closes, 14);
  let adxClassification: TrendStrengthPanel['adxClassification'];
  if (adxResult.adx < 20) adxClassification = 'lemah/ranging';
  else if (adxResult.adx < 25) adxClassification = 'developing';
  else if (adxResult.adx < 35) adxClassification = 'kuat';
  else adxClassification = 'sangat kuat';

  const fiSeries = calcForceIndexSeries(closes, volumes);
  const forceIndex = fiSeries[fiSeries.length - 1] ?? 0;
  const forceIndexDirection: 'bullish' | 'bearish' = forceIndex > 0 ? 'bullish' : 'bearish';

  const lastIdx = closes.length - 2;
  const volMa20 = calcSMA(volumes.slice(0, lastIdx + 1), Math.min(20, lastIdx + 1));
  const volumeRatio = volMa20 > 0 ? (volumes[lastIdx] ?? 0) / volMa20 : 1;
  const volumeTrend: 'expanding' | 'contracting' = volumeRatio > 1 ? 'expanding' : 'contracting';

  const atrNow = calcATR(highs.slice(0, lastIdx + 2), lows.slice(0, lastIdx + 2), closes.slice(0, lastIdx + 2));
  const pastEndIdx = Math.max(15, lastIdx - 10);
  const atrPast = calcATR(highs.slice(0, pastEndIdx + 2), lows.slice(0, pastEndIdx + 2), closes.slice(0, pastEndIdx + 2));
  const atrRatio = atrPast > 0 ? atrNow / atrPast : 1;
  const volatilityTrend: 'naik' | 'turun' = atrRatio > 1 ? 'naik' : 'turun';

  return { adx: adxResult.adx, adxClassification, forceIndex, forceIndexDirection, volumeRatio, volumeTrend, atrRatio, volatilityTrend };
}

export interface DivergenceTrendResult {
  symbol: string;
  tf: TFLabelV2;
  timestamp: string;
  rsiDivergence: DivergenceResult;
  macdDivergence: DivergenceResult;
  volumeDivergence: DivergenceResult;
  stochasticDivergence: DivergenceResult;
  trendStrength: TrendStrengthPanel;
  oiPriceVolumeFunding: Awaited<ReturnType<typeof analyzeOIPriceVolumeFunding>>;
  filterResults: string[];
}

// FITUR 6 TA PRO -- gabungan semua di atas. Divergence + kekuatan trend
// dihitung di TF yang dipilih user (kayak fitur lain); OI+Funding SELALU
// D1+H4 (request user), gak ngikut TF selector.
export async function analyzeDivergenceTrend(
  opens: number[], highs: number[], lows: number[], closes: number[], volumes: number[],
  tf: TFLabelV2, symbol: string,
): Promise<DivergenceTrendResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';

  const rsiDivergence = detectRSIDivergenceGeneric(highs, lows, closes);
  const macdDivergence = detectMACDDivergenceGeneric(highs, lows, closes);
  const volumeDivergence = detectVolumeDivergence(highs, lows, closes, volumes);
  const stochasticDivergence = detectStochasticDivergenceGeneric(highs, lows, closes);
  const trendStrength = analyzeTrendStrength(highs, lows, closes, volumes);
  const oiPriceVolumeFunding = await analyzeOIPriceVolumeFunding(symbol);

  const divLabel = (d: DivergenceResult, name: string): string => {
    if (d.bullish) return `⚠️ ${name} — BULLISH divergence (harga bikin low baru, indikator enggak)`;
    if (d.bearish) return `⚠️ ${name} — BEARISH divergence (harga bikin high baru, indikator enggak)`;
    return `ℹ️ ${name} — gak ada divergence`;
  };

  const filterResults: string[] = [
    divLabel(rsiDivergence, `RSI Divergence (${tf})`),
    divLabel(macdDivergence, `MACD Divergence (${tf})`),
    divLabel(volumeDivergence, `Volume Divergence (${tf})`),
    divLabel(stochasticDivergence, `Stochastic 5,3,3 Divergence (${tf})`),
    `ℹ️ Kekuatan Trend (${tf}) — ADX ${trendStrength.adx.toFixed(1)} (${trendStrength.adxClassification}), Force Index ${trendStrength.forceIndex.toFixed(2)} (${trendStrength.forceIndexDirection}), Volume ${trendStrength.volumeRatio.toFixed(2)}x MA20 (${trendStrength.volumeTrend}), ATR ${trendStrength.atrRatio.toFixed(2)}x vs 10 candle lalu (volatilitas ${trendStrength.volatilityTrend})`,
    oiPriceVolumeFunding.d1
      ? `ℹ️ OI+Price+Volume D1 — ${oiPriceVolumeFunding.d1.interpretation}`
      : 'ℹ️ OI+Price+Volume D1 — data gak cukup',
    oiPriceVolumeFunding.h4
      ? `ℹ️ OI+Price+Volume H4 — ${oiPriceVolumeFunding.h4.interpretation}`
      : 'ℹ️ OI+Price+Volume H4 — data gak cukup',
    `ℹ️ Funding Rate — ${oiPriceVolumeFunding.fundingInterpretation}`,
  ];

  return {
    symbol, tf, timestamp,
    rsiDivergence, macdDivergence, volumeDivergence, stochasticDivergence,
    trendStrength, oiPriceVolumeFunding, filterResults,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FITUR 7 TA PRO — BTC CORRELATION (request user): "sebelum analisa koin
// wajib liat outlook BTC dulu". BTC-only (bukan symbol pilihan), gabungan:
// kekuatan trend (semua indikator project + EMA13/26/50/100/200) H4+D1,
// fase/kondisi (koreksi sehat vs momentum lemah vs downtrend, dari kombinasi
// bias D1 besar vs kondisi H4 jangka pendek), divergence (RSI/MACD/Volume/
// Stochastic + BARU: OI Divergence & ADX/DI Divergence) H4+D1, key level D1,
// dan rasio BTC/Gold (proxy PAXGUSDT, karena Binance gak ada pair asli).
// ═══════════════════════════════════════════════════════════════════════════

// ADX+DI dalam bentuk SERIES penuh (bukan cuma nilai terakhir kayak
// calcADXWithDI) -- dibutuhin buat ADX/DI Divergence. Replikasi PERSIS
// logic calcADXWithDI, cuma nyimpen tiap langkah smoothing-nya, di-align
// balik ke index candle asli (bukan index array trs/dm yang lebih pendek).
function calcADXSeries(
  highs: number[], lows: number[], closes: number[], period = 14,
): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  const n = closes.length;
  const adxArr = new Array(n).fill(0);
  const plusDIArr = new Array(n).fill(0);
  const minusDIArr = new Array(n).fill(0);
  if (n < period * 2) return { adx: adxArr, plusDI: plusDIArr, minusDI: minusDIArr };

  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  for (let i = 1; i < n; i++) {
    const hl = highs[i]! - lows[i]!;
    const hc = Math.abs(highs[i]! - closes[i - 1]!);
    const lc = Math.abs(lows[i]! - closes[i - 1]!);
    trs.push(Math.max(hl, hc, lc));
    const upMove = highs[i]! - highs[i - 1]!;
    const downMove = lows[i - 1]! - lows[i]!;
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const smooth = (arr: number[]): number[] => {
    let val = arr.slice(0, period).reduce((a, b) => a + b, 0);
    const result = [val];
    for (let i = period; i < arr.length; i++) { val = val - val / period + arr[i]!; result.push(val); }
    return result;
  };
  const atr14 = smooth(trs);
  const plusDIRaw = smooth(plusDMs).map((v, i) => (v / atr14[i]!) * 100);
  const minusDIRaw = smooth(minusDMs).map((v, i) => (v / atr14[i]!) * 100);
  // plusDIRaw[j]/minusDIRaw[j] -> index candle asli = period + j
  for (let j = 0; j < plusDIRaw.length; j++) {
    const origIdx = period + j;
    if (origIdx < n) { plusDIArr[origIdx] = plusDIRaw[j]!; minusDIArr[origIdx] = minusDIRaw[j]!; }
  }
  const dx = plusDIRaw.map((p, i) => {
    const sum = p + minusDIRaw[i]!;
    return sum === 0 ? 0 : (Math.abs(p - minusDIRaw[i]!) / sum) * 100;
  });
  const smoothAvg = (arr: number[]): number[] => {
    if (arr.length === 0) return [];
    let val = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const result = [val];
    for (let i = period; i < arr.length; i++) { val = (val * (period - 1) + arr[i]!) / period; result.push(val); }
    return result;
  };
  const adxRaw = smoothAvg(dx);
  // adxRaw[m] -> index candle asli = 2*period-1+m
  for (let m = 0; m < adxRaw.length; m++) {
    const origIdx = 2 * period - 1 + m;
    if (origIdx < n) adxArr[origIdx] = adxRaw[m]!;
  }
  return { adx: adxArr, plusDI: plusDIArr, minusDI: minusDIArr };
}

// BARU (request user): ADX/DI Divergence -- harga bikin high/low baru tapi
// ADX (kekuatan trend) atau spread +DI/-DI malah melemah = momentum
// trend-strength-nya gak sinkron sama harga.
function detectADXDivergenceGeneric(highs: number[], lows: number[], closes: number[]): DivergenceResult {
  const series = calcADXSeries(highs, lows, closes);
  const swingHighs = findSwingPointsIdx(highs, 'high', 2);
  const swingLows = findSwingPointsIdx(lows, 'low', 2);

  let bearish = false;
  if (swingHighs.length >= 2) {
    const h1 = swingHighs[swingHighs.length - 2]!, h2 = swingHighs[swingHighs.length - 1]!;
    if (h2.value > h1.value) {
      const adx1 = series.adx[h1.idx] ?? 0, adx2 = series.adx[h2.idx] ?? 0;
      const spread1 = (series.plusDI[h1.idx] ?? 0) - (series.minusDI[h1.idx] ?? 0);
      const spread2 = (series.plusDI[h2.idx] ?? 0) - (series.minusDI[h2.idx] ?? 0);
      bearish = adx2 < adx1 || spread2 < spread1;
    }
  }
  let bullish = false;
  if (swingLows.length >= 2) {
    const l1 = swingLows[swingLows.length - 2]!, l2 = swingLows[swingLows.length - 1]!;
    if (l2.value < l1.value) {
      const adx1 = series.adx[l1.idx] ?? 0, adx2 = series.adx[l2.idx] ?? 0;
      const spread1 = (series.plusDI[l1.idx] ?? 0) - (series.minusDI[l1.idx] ?? 0);
      const spread2 = (series.plusDI[l2.idx] ?? 0) - (series.minusDI[l2.idx] ?? 0);
      bullish = adx2 < adx1 || spread2 > spread1; // spread makin gak-negatif = tekanan bearish mengendur
    }
  }
  return { bullish, bearish };
}

// BARU (request user): OI Divergence -- harga bikin high/low baru tapi Open
// Interest malah turun = kenaikan/penurunan harga gak didukung posisi baru
// (rawan gampang kebalik). oiHist diasumsiin sejajar sama candle terakhir
// (index sama = waktu kira-kira sama -- simplifikasi yang sama kayak Fitur
// 6 OI+Price+Volume, gak presisi per-timestamp).
function detectOIDivergence(highs: number[], lows: number[], oiHist: number[]): DivergenceResult {
  const n = Math.min(highs.length, oiHist.length);
  const h = highs.slice(-n), l = lows.slice(-n), oi = oiHist.slice(-n);
  const swingHighs = findSwingPointsIdx(h, 'high', 2);
  const swingLows = findSwingPointsIdx(l, 'low', 2);

  let bearish = false;
  if (swingHighs.length >= 2) {
    const h1 = swingHighs[swingHighs.length - 2]!, h2 = swingHighs[swingHighs.length - 1]!;
    if (h2.value > h1.value) bearish = (oi[h2.idx] ?? 0) < (oi[h1.idx] ?? 0);
  }
  let bullish = false;
  if (swingLows.length >= 2) {
    const l1 = swingLows[swingLows.length - 2]!, l2 = swingLows[swingLows.length - 1]!;
    if (l2.value < l1.value) bullish = (oi[l2.idx] ?? 0) < (oi[l1.idx] ?? 0);
  }
  return { bullish, bearish };
}

export interface BtcTrendStrengthSnapshot {
  timeframe: 'H4' | 'D1';
  rsi: number;
  macdHistogram: number;
  adx: number; plusDI: number; minusDI: number;
  forceIndex: number;
  volumeRatio: number;
  atrRatio: number;
  stochK: number; stochD: number;
  ema13: number; ema26: number; ema50: number; ema100: number; ema200: number;
  emaAlignment: 'bullish' | 'bearish' | 'mixed';
  bias: 'bullish' | 'bearish' | 'neutral';
}

function buildTrendStrengthSnapshot(
  tf: 'H4' | 'D1', highs: number[], lows: number[], closes: number[], volumes: number[],
): BtcTrendStrengthSnapshot {
  const i = closes.length - 2;
  const rsi = calcRSI(closes.slice(0, i + 2), 14);
  const macd = calcMACD(closes.slice(0, i + 2));
  const adxRes = calcADXWithDI(highs.slice(0, i + 2), lows.slice(0, i + 2), closes.slice(0, i + 2), 14);
  const fiSeries = calcForceIndexSeries(closes.slice(0, i + 2), volumes.slice(0, i + 2));
  const forceIndex = fiSeries[fiSeries.length - 1] ?? 0;
  const volMa20 = calcSMA(volumes.slice(0, i + 1), Math.min(20, i + 1));
  const volumeRatio = volMa20 > 0 ? (volumes[i] ?? 0) / volMa20 : 1;
  const atrNow = calcATR(highs.slice(0, i + 2), lows.slice(0, i + 2), closes.slice(0, i + 2));
  const pastEndIdx = Math.max(15, i - 10);
  const atrPast = calcATR(highs.slice(0, pastEndIdx + 2), lows.slice(0, pastEndIdx + 2), closes.slice(0, pastEndIdx + 2));
  const atrRatio = atrPast > 0 ? atrNow / atrPast : 1;
  const sto = calcStochasticSlow(highs.slice(0, i + 2), lows.slice(0, i + 2), closes.slice(0, i + 2), 5, 3, 3);

  const ema13 = calcEMASeries(closes, 13)[i]!;
  const ema26 = calcEMASeries(closes, 26)[i]!;
  const ema50 = calcEMASeries(closes, 50)[i]!;
  const ema100 = calcEMASeries(closes, 100)[i]!;
  const ema200 = calcEMASeries(closes, 200)[i]!;
  const price = closes[i]!;

  const bullStack = ema13 > ema26 && ema26 > ema50 && ema50 > ema100 && ema100 > ema200;
  const bearStack = ema13 < ema26 && ema26 < ema50 && ema50 < ema100 && ema100 < ema200;
  const emaAlignment: 'bullish' | 'bearish' | 'mixed' = bullStack ? 'bullish' : bearStack ? 'bearish' : 'mixed';

  // Bias struktural (buat penentuan fase): EMA26 vs EMA50 + posisi harga --
  // dipilih EMA26/50 (bukan EMA13/26 yang kecepetan, atau EMA100/200 yang
  // kelamaan) biar cukup responsif tapi gak gampang whipsaw.
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (ema26 > ema50 && price > ema50) bias = 'bullish';
  else if (ema26 < ema50 && price < ema50) bias = 'bearish';

  return {
    timeframe: tf, rsi, macdHistogram: macd.histogram,
    adx: adxRes.adx, plusDI: adxRes.plusDI, minusDI: adxRes.minusDI,
    forceIndex, volumeRatio, atrRatio, stochK: sto.k, stochD: sto.d,
    ema13, ema26, ema50, ema100, ema200, emaAlignment, bias,
  };
}

export interface BtcDivergenceSnapshot {
  timeframe: 'H4' | 'D1';
  rsi: DivergenceResult;
  macd: DivergenceResult;
  volume: DivergenceResult;
  stochastic: DivergenceResult;
  adxDi: DivergenceResult;
  openInterest: DivergenceResult;
}

function buildDivergenceSnapshot(
  tf: 'H4' | 'D1', highs: number[], lows: number[], closes: number[], volumes: number[], oiHist: number[] | null,
): BtcDivergenceSnapshot {
  return {
    timeframe: tf,
    rsi: detectRSIDivergenceGeneric(highs, lows, closes),
    macd: detectMACDDivergenceGeneric(highs, lows, closes),
    volume: detectVolumeDivergence(highs, lows, closes, volumes),
    stochastic: detectStochasticDivergenceGeneric(highs, lows, closes),
    adxDi: detectADXDivergenceGeneric(highs, lows, closes),
    openInterest: oiHist ? detectOIDivergence(highs, lows, oiHist) : { bullish: false, bearish: false },
  };
}

function countDivergenceDirection(d: BtcDivergenceSnapshot, direction: 'bullish' | 'bearish'): number {
  return [d.rsi, d.macd, d.volume, d.stochastic, d.adxDi, d.openInterest].filter(x => x[direction]).length;
}

// Fase/kondisi BTC saat ini -- kombinasi bias D1 (gambaran besar) vs kondisi
// H4 (momentum jangka pendek + divergence count). Request user: bedain
// "koreksi sehat dalam uptrend" vs "momentum beneran lemah".
function determineBtcPhase(
  d1Bias: 'bullish' | 'bearish' | 'neutral', h4Bias: 'bullish' | 'bearish' | 'neutral',
  h4BearDivCount: number, h4BullDivCount: number,
  nearestSupportD1: SRLevel | null, nearestResistanceD1: SRLevel | null,
): { phase: string; detail: string } {
  // BARU (request user, "bukan snr doang, tapi kaya 'selagi bertahan di
  // harga sekian maka bullish masih lanjut'"): tiap verdict fase dikasih
  // kondisi harga KONKRET yang bisa dipantau -- diambil dari level D1
  // signifikan terdekat (support buat konteks bullish, resistance buat
  // konteks bearish), bukan cuma narasi indikator abstrak.
  if (d1Bias === 'bullish') {
    const holdCondition = nearestSupportD1
      ? `Selama harga bertahan DI ATAS ${nearestSupportD1.price.toFixed(0)} (support D1, udah ${nearestSupportD1.touches}x teruji), struktur bullish besar masih valid — breakdown ke bawah situ baru jadi tanda serius trend mulai berbalik.`
      : 'Belum ada level support D1 signifikan yang kedeteksi buat jadi acuan invalidasi.';
    if (h4BearDivCount >= 3) {
      return {
        phase: 'WASPADA — momentum H4 melemah signifikan',
        detail: `D1 masih bullish (struktur besar intact), TAPI H4 nunjukin ${h4BearDivCount} dari 6 sinyal divergence bearish sekaligus — momentum jangka pendek udah keteteran cukup parah. ${holdCondition}`,
      };
    }
    if (h4Bias !== 'bullish' || h4BearDivCount > 0) {
      return {
        phase: 'KOREKSI SEHAT dalam uptrend besar',
        detail: `BTC lagi koreksi${h4BearDivCount > 0 ? ` (${h4BearDivCount} sinyal divergence bearish di H4)` : ''} — ini wajar terjadi dalam trend naik, BUKAN tanda reversal. ${holdCondition}`,
      };
    }
    return { phase: 'MOMENTUM BULLISH LANJUT', detail: `D1 & H4 selaras bullish, gak ada tanda divergence — trend lanjut normal. ${holdCondition}` };
  }
  if (d1Bias === 'bearish') {
    const holdCondition = nearestResistanceD1
      ? `Selama harga tertahan DI BAWAH ${nearestResistanceD1.price.toFixed(0)} (resistance D1, udah ${nearestResistanceD1.touches}x teruji), struktur bearish besar masih valid — breakout ke atas situ baru jadi tanda serius trend mulai berbalik naik.`
      : 'Belum ada level resistance D1 signifikan yang kedeteksi buat jadi acuan invalidasi.';
    if (h4BullDivCount >= 3) {
      return {
        phase: 'WASPADA — momentum bearish H4 melemah',
        detail: `D1 masih bearish, TAPI H4 nunjukin ${h4BullDivCount} dari 6 sinyal divergence bullish sekaligus — bisa jadi awal rebound. ${holdCondition}`,
      };
    }
    if (h4Bias === 'bearish' && h4BullDivCount === 0) {
      return { phase: 'DOWNTREND', detail: `D1 & H4 sama-sama bearish, gak ada tanda pembalikan. ${holdCondition}` };
    }
    return {
      phase: 'REBOUND dalam downtrend besar',
      detail: `BTC lagi rebound${h4BullDivCount > 0 ? ` (${h4BullDivCount} sinyal divergence bullish di H4)` : ''} — waspada ini kemungkinan masih bagian downtrend, BUKAN reversal pasti. ${holdCondition}`,
    };
  }
  return { phase: 'SIDEWAYS/NETRAL', detail: 'D1 belum nunjukin arah jelas (EMA26 & EMA50 berdempetan, harga di tengah).' };
}

async function analyzeBtcGoldRatio(): Promise<{
  ratio: number; ratioEma26: number; trend: 'bullish' | 'bearish'; interpretation: string;
}> {
  // Binance gak ada pair BTC/GOLD asli -- proxy pake PAXGUSDT (token
  // di-backing 1:1 emas fisik). Rasio BTCUSDT/PAXGUSDT ini setara sama
  // chart rasio "BTCUSDT/PAXGUSDT" yang muncul di mode Trading View Binance
  // (request user).
  const [btcD1, paxgD1] = await Promise.all([
    fetchKlines('BTCUSDT', '1d', 60),
    fetchKlines('PAXGUSDT', '1d', 60),
  ]);
  const n = Math.min(btcD1.closes.length, paxgD1.closes.length);
  const btcSlice = btcD1.closes.slice(-n);
  const paxgSlice = paxgD1.closes.slice(-n);
  const ratioSeries = btcSlice.map((v, idx) => v / paxgSlice[idx]!);
  const ratioEmaSeries = calcEMASeries(ratioSeries, 26);
  const idx = ratioSeries.length - 2;
  const ratio = ratioSeries[idx]!;
  const ratioEma26 = ratioEmaSeries[idx]!;
  const trend: 'bullish' | 'bearish' = ratio > ratioEma26 ? 'bullish' : 'bearish';
  const interpretation = trend === 'bullish'
    ? `BTC lagi OUTPERFORM emas (rasio ${ratio.toFixed(2)} di atas EMA26-nya ${ratioEma26.toFixed(2)}) — capital lebih milih BTC dibanding safe-haven, biasanya tanda risk-on.`
    : `BTC lagi UNDERPERFORM emas (rasio ${ratio.toFixed(2)} di bawah EMA26-nya ${ratioEma26.toFixed(2)}) — capital condong ke safe-haven, biasanya tanda risk-off/waspada.`;
  return { ratio, ratioEma26, trend, interpretation };
}

export interface BtcCorrelationResult {
  symbol: 'BTCUSDT';
  timestamp: string;
  currentPrice: number;
  phase: string;
  phaseDetail: string;
  trendStrength: { h4: BtcTrendStrengthSnapshot; d1: BtcTrendStrengthSnapshot };
  divergence: { h4: BtcDivergenceSnapshot; d1: BtcDivergenceSnapshot };
  keyLevelsD1: SRLevel[];
  nearestLevelsD1: { resistance: SRLevel | null; support: SRLevel | null };
  btcGold: Awaited<ReturnType<typeof analyzeBtcGoldRatio>>;
  filterResults: string[];
}

// FITUR 7 TA PRO -- "sebelum analisa koin wajib liat outlook BTC dulu".
// Fixed BTCUSDT, gak nerima symbol lain (request user).
export async function analyzeBtcCorrelation(): Promise<BtcCorrelationResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';

  // 500 candle H4 (~83 hari) & D1 (~500 hari) -- cukup buat EMA200 stabil
  // (butuh minimal ~400 buat 2x period).
  const [h4, d1, oiH4, oiD1, btcGold, tickerRes] = await Promise.all([
    fetchKlines('BTCUSDT', '4h', 500),
    fetchKlines('BTCUSDT', '1d', 500),
    fetchOpenInterestHist('BTCUSDT', '4h', 500),
    fetchOpenInterestHist('BTCUSDT', '1d', 500),
    analyzeBtcGoldRatio(),
    fetch(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/price?symbol=BTCUSDT`),
  ]);
  const currentPrice = tickerRes.ok
    ? parseFloat((await tickerRes.json() as { price: string }).price)
    : h4.closes[h4.closes.length - 1]!;

  const h4Strength = buildTrendStrengthSnapshot('H4', h4.highs, h4.lows, h4.closes, h4.volumes);
  const d1Strength = buildTrendStrengthSnapshot('D1', d1.highs, d1.lows, d1.closes, d1.volumes);
  const h4Div = buildDivergenceSnapshot('H4', h4.highs, h4.lows, h4.closes, h4.volumes, oiH4);
  const d1Div = buildDivergenceSnapshot('D1', d1.highs, d1.lows, d1.closes, d1.volumes, oiD1);

  const h4BearDivCount = countDivergenceDirection(h4Div, 'bearish');
  const h4BullDivCount = countDivergenceDirection(h4Div, 'bullish');

  const d1LastClosedIdx = d1.closes.length - 2;
  const d1HighsClosed = d1.highs.slice(0, d1LastClosedIdx + 1);
  const d1LowsClosed = d1.lows.slice(0, d1LastClosedIdx + 1);
  const d1ClosesClosed = d1.closes.slice(0, d1LastClosedIdx + 1);

  // FIX (request user): dulu top-5 diranking cuma dari JUMLAH SENTUHAN,
  // jadi level lama yang jauh dari harga sekarang bisa ngalahin level baru
  // yang lebih relevan. Sekarang diranking dari JARAK ke harga sekarang.
  const keyLevelsD1Raw = detectSRLevels(d1HighsClosed, d1LowsClosed, d1ClosesClosed, 90, 2);
  const keyLevelsD1 = [...keyLevelsD1Raw]
    .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))
    .slice(0, 6);

  // BARU (request user): level FRESH terdekat (minTouches=1) di atas/bawah
  // harga sekarang -- biar breakout baru yang BELUM "teruji" 2x tetep
  // kelihatan (kayak kasus 87385 yang gagal breakout, sebelum fix ini gak
  // muncul sama sekali karena cuma 1x sentuh).
  const allLevelsD1 = detectSRLevels(d1HighsClosed, d1LowsClosed, d1ClosesClosed, 90, 1);
  const nearestResistanceD1 = allLevelsD1
    .filter(l => l.type === 'resistance' && l.price > currentPrice)
    .sort((a, b) => a.price - b.price)[0] ?? null;
  const nearestSupportD1 = allLevelsD1
    .filter(l => l.type === 'support' && l.price < currentPrice)
    .sort((a, b) => b.price - a.price)[0] ?? null;

  // Buat acuan invalidasi di narasi fase, prioritasin level yang udah
  // "signifikan" (>=2x teruji); fallback ke level fresh kalau belum ada
  // yang signifikan di sisi yang relevan.
  const anchorSupportD1 = keyLevelsD1Raw.filter(l => l.type === 'support' && l.price < currentPrice).sort((a, b) => b.price - a.price)[0] ?? nearestSupportD1;
  const anchorResistanceD1 = keyLevelsD1Raw.filter(l => l.type === 'resistance' && l.price > currentPrice).sort((a, b) => a.price - b.price)[0] ?? nearestResistanceD1;

  const { phase, detail } = determineBtcPhase(d1Strength.bias, h4Strength.bias, h4BearDivCount, h4BullDivCount, anchorSupportD1, anchorResistanceD1);

  const divLabel = (d: DivergenceResult, name: string): string => {
    if (d.bullish) return `⚠️ ${name} — BULLISH divergence`;
    if (d.bearish) return `⚠️ ${name} — BEARISH divergence`;
    return `ℹ️ ${name} — gak ada divergence`;
  };

  const filterResults: string[] = [
    `🎯 FASE: ${phase} — ${detail}`,
    `ℹ️ Kekuatan Trend D1 — RSI ${d1Strength.rsi.toFixed(1)}, MACD hist ${d1Strength.macdHistogram.toFixed(1)}, ADX ${d1Strength.adx.toFixed(1)} (+DI ${d1Strength.plusDI.toFixed(1)}/-DI ${d1Strength.minusDI.toFixed(1)}), EMA13/26/50/100/200 ${d1Strength.emaAlignment} (bias ${d1Strength.bias})`,
    `ℹ️ Kekuatan Trend H4 — RSI ${h4Strength.rsi.toFixed(1)}, MACD hist ${h4Strength.macdHistogram.toFixed(1)}, ADX ${h4Strength.adx.toFixed(1)} (+DI ${h4Strength.plusDI.toFixed(1)}/-DI ${h4Strength.minusDI.toFixed(1)}), EMA13/26/50/100/200 ${h4Strength.emaAlignment} (bias ${h4Strength.bias}), Stoch %K ${h4Strength.stochK.toFixed(1)}`,
    divLabel(d1Div.rsi, 'RSI Div D1'), divLabel(d1Div.macd, 'MACD Div D1'), divLabel(d1Div.volume, 'Volume Div D1'),
    divLabel(d1Div.stochastic, 'Stochastic Div D1'), divLabel(d1Div.adxDi, 'ADX/DI Div D1'), divLabel(d1Div.openInterest, 'OI Div D1'),
    divLabel(h4Div.rsi, 'RSI Div H4'), divLabel(h4Div.macd, 'MACD Div H4'), divLabel(h4Div.volume, 'Volume Div H4'),
    divLabel(h4Div.stochastic, 'Stochastic Div H4'), divLabel(h4Div.adxDi, 'ADX/DI Div H4'), divLabel(h4Div.openInterest, 'OI Div H4'),
    `ℹ️ Key Level D1 (terdekat dari harga sekarang) — ${keyLevelsD1.map(l => `${l.type === 'resistance' ? 'R' : 'S'} ${l.price.toFixed(0)} (${l.touches}x)`).join(', ')}`,
    `ℹ️ Level Fresh Terdekat (belum teruji 2x, hati-hati) — Resistance: ${nearestResistanceD1 ? `${nearestResistanceD1.price.toFixed(0)} (${nearestResistanceD1.touches}x)` : 'gak ada'}, Support: ${nearestSupportD1 ? `${nearestSupportD1.price.toFixed(0)} (${nearestSupportD1.touches}x)` : 'gak ada'}`,
    `ℹ️ BTC/Gold — ${btcGold.interpretation}`,
  ];

  return {
    symbol: 'BTCUSDT', timestamp, currentPrice, phase, phaseDetail: detail,
    trendStrength: { h4: h4Strength, d1: d1Strength },
    divergence: { h4: h4Div, d1: d1Div },
    keyLevelsD1, nearestLevelsD1: { resistance: nearestResistanceD1, support: nearestSupportD1 }, btcGold, filterResults,
  };
}

export interface TFDetail {
  timeframe: 'D1' | 'H4' | 'H1' | 'M30' | 'M15' | 'M5';
  bias: 'bullish' | 'bearish' | 'sideways';
  adx: number;
  confirmations: string[];
  zone?: ZoneInfo;
  rsiDivergence?: DivergenceResult;
  volumeDivergence?: DivergenceResult;
  marketStructureV2?: MarketStructureV2Result | null;
  breakout?: FreshBreakoutInfo; // request user: breakout candle udah kejadian+valid (TANPA nunggu retest)
}

export interface MultiTFScanCoin {
  symbol: string;
  d1Bias: 'bullish' | 'bearish' | 'sideways';
  d1Adx: number;
  h4Bias: 'bullish' | 'bearish' | 'sideways';
  h4Adx: number;
}

export interface MultiTFDetailResult {
  status: 'ok' | 'error';
  symbol: string;
  timestamp: string;
  message?: string;
  coinTFs?: TFDetail[]; // 6 TF punya koin ini
  btcTFs?: TFDetail[]; // 6 TF punya BTC, SELALU ada
}

/**
 * FIX (request user, revisi dari versi awal): "ADA BREAKOUT" itu breakout
 * candle-nya UDAH KEJADIAN + VALID (nembus edge zona + volume >1.4x MA20 +
 * lolos MSV2 gate) — TANPA NUNGGU RETEST. Beda dari tryZoneBreakoutRetest
 * (yang basisnya Menu Scalping, WAJIB nunggu harga balik retest ke zona dulu
 * baru dianggap "in_zone"/siap entry). Di sini breakout aja udah cukup buat
 * ditandain "ada breakout" — bukan sinyal entry siap pakai, cuma info bahwa
 * breakout barusan kejadian dan bukan fakeout (given volume+MSV2 udah dicek).
 */
export interface FreshBreakoutInfo {
  bias: 'bullish' | 'bearish';
  level: number;
  breakoutPrice: number;
  candlesSinceBreakout: number;
}

function detectFreshBreakout(
  htf: KlineData, resistanceLevels: number[], supportLevels: number[], zoneWidth: number, tf: TFLabelV2
): FreshBreakoutInfo | null {
  const n = htf.closes.length;
  const volMA20At = (idx: number) => {
    const start = Math.max(0, idx - 20);
    const win = htf.volumes.slice(start, idx);
    return win.length > 0 ? win.reduce((a, b) => a + b, 0) / win.length : 0;
  };

  const lookbackMax = 24; // sama window kayak Menu Scalping, biar konsisten "baru aja"
  let found: { direction: 'bullish' | 'bearish'; level: number; breakoutPrice: number; breakoutIdx: number } | null = null;

  for (let idx = Math.max(1, n - lookbackMax); idx < n; idx++) {
    const closeAt = htf.closes[idx]!;
    const volAt = htf.volumes[idx]!;
    const volMA = volMA20At(idx);
    if (volMA <= 0) continue;
    for (const level of resistanceLevels) {
      const edgeUpper = level + zoneWidth / 2;
      if (closeAt > edgeUpper && volAt > 1.4 * volMA) found = { direction: 'bullish', level, breakoutPrice: closeAt, breakoutIdx: idx };
    }
    for (const level of supportLevels) {
      const edgeLower = level - zoneWidth / 2;
      if (closeAt < edgeLower && volAt > 1.4 * volMA) found = { direction: 'bearish', level, breakoutPrice: closeAt, breakoutIdx: idx };
    }
  }
  if (!found) return null;

  // MSV2 gate tetep dicek — biar breakout yang ditandain itu genuinely
  // searah struktur, bukan breakout liar yang bakal langsung dibantah balik
  const structGate = checkStructureV2Gate(htf, found.direction, tf);
  if (structGate.blocked) return null;

  return {
    bias: found.direction, level: found.level, breakoutPrice: found.breakoutPrice,
    candlesSinceBreakout: n - 1 - found.breakoutIdx,
  };
}

async function buildTFDetail(timeframe: TFDetail['timeframe'], interval: string, symbol: string): Promise<TFDetail> {
  const limitMap: Record<TFDetail['timeframe'], number> = {
    D1: 100, H4: 360, H1: 720, M30: 336, M15: 480, M5: 288,
  };
  const limit = limitMap[timeframe];
  const data = await fetchKlines(symbol, interval, limit);
  const classification = classifyTFTrend(data.opens, data.highs, data.lows, data.closes, data.volumes, timeframe);
  const zone = detectStrongestZonePerTF(data.opens, data.highs, data.lows, data.closes, classification.bias);
  const rsiDivergence = detectRSIDivergenceGeneric(data.highs, data.lows, data.closes);
  const volumeDivergence = detectVolumeDivergence(data.highs, data.lows, data.closes, data.volumes);

  // FIX (revisi, request user): "ADA BREAKOUT" itu breakout candle-nya UDAH
  // KEJADIAN+VALID (nembus edge zona + volume 1.4x + lolos MSV2 gate) — TANPA
  // NUNGGU RETEST (beda dari versi awal yang reuse tryZoneBreakoutRetest, yang
  // basisnya Menu Scalping WAJIB nunggu harga balik ke zona dulu).
  let breakout: FreshBreakoutInfo | null = null;
  try {
    const atr = calcATR(data.highs, data.lows, data.closes);
    if (atr > 0) {
      const { resistanceLevels, supportLevels, zoneWidth } = detectZonesForExtreme(data, atr);
      if (resistanceLevels.length > 0 || supportLevels.length > 0) {
        breakout = detectFreshBreakout(data, resistanceLevels, supportLevels, zoneWidth, timeframe);
      }
    }
  } catch {
    // breakout check gagal (data kurang dsb) — biarin null, gak perlu gagalin seluruh TFDetail
  }

  return {
    timeframe, bias: classification.bias, adx: classification.adx, confirmations: classification.confirmations,
    zone: zone ?? undefined, rsiDivergence, volumeDivergence,
    marketStructureV2: classification.marketStructureV2,
    breakout: breakout ?? undefined,
  };
}

const TF_MAP: { tf: TFDetail['timeframe']; interval: string }[] = [
  { tf: 'D1', interval: '1d' },
  { tf: 'H4', interval: '4h' },
  { tf: 'H1', interval: '1h' },
  { tf: 'M30', interval: '30m' },
  { tf: 'M15', interval: '15m' },
  { tf: 'M5', interval: '5m' },
];

/** Scan — cuma cek D1 ADX>=25 DAN H4 ADX>=25 (independen, gak perlu searah). */
export async function scanMultiTFTrendCoin(symbol: string): Promise<MultiTFScanCoin | null> {
  try {
    const [d1, h4] = await Promise.all([
      fetchKlines(symbol, '1d', 100),
      fetchKlines(symbol, '4h', 360),
    ]);
    const d1Class = classifyTFTrend(d1.opens, d1.highs, d1.lows, d1.closes, d1.volumes, 'D1');
    const h4Class = classifyTFTrend(h4.opens, h4.highs, h4.lows, h4.closes, h4.volumes, 'H4');
    if (d1Class.adx < 25 || h4Class.adx < 25) return null;
    return { symbol, d1Bias: d1Class.bias, d1Adx: d1Class.adx, h4Bias: h4Class.bias, h4Adx: h4Class.adx };
  } catch {
    return null;
  }
}

export async function analyzeMultiTFDetail(symbol: string): Promise<MultiTFDetailResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';

  try {
    const coinTFs = await Promise.all(TF_MAP.map(({ tf, interval }) => buildTFDetail(tf, interval, symbol)));
    const btcTFs = symbol === 'BTCUSDT'
      ? coinTFs // gak perlu fetch dobel kalau yang dianalisa emang BTC sendiri
      : await Promise.all(TF_MAP.map(({ tf, interval }) => buildTFDetail(tf, interval, 'BTCUSDT')));

    return { status: 'ok', symbol, timestamp, coinTFs, btcTFs };
  } catch (err) {
    return { status: 'error', symbol, timestamp, message: err instanceof Error ? err.message : 'Unknown error' };
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
    fetchKlines(symbol, '4h', 360),
    fetchKlines(symbol, '1h', 720),
    fetchKlines(symbol, '30m', 336),
    fetchKlines(symbol, '15m', 480),
    fetchKlines(symbol, '5m', 288),
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

/**
 * OI Surge Breakout (REWRITE TOTAL, request user — gantiin skill "Confidence
 * Score"). Konsep: breakout yang DIBARENGI lonjakan Open Interest itu beda
 * karakter dari breakout biasa — OI naik pas breakout artinya ada POSISI
 * BARU dibuka (bukan cuma existing trader jual-beli), indikasi modal baru
 * genuinely masuk, bukan cuma harga mantul doang.
 *
 * Alur:
 * 1. M15 — deteksi zona S&R (swing+merge, basis sama kayak skill lain)
 * 2. Breakout CONFIRMED — dicari dalam window 8 candle M15 terakhir (~2 jam),
 *    BUKAN cuma candle paling akhir doang (fix bug "gada sinyal sama sekali"
 *    — window 1 candle/15 menit itu extremely sempit)
 * 3. Market Structure V2 gate — versi BREAKOUT (continuation, wajib trend
 *    besar mendukung arahnya, beda dari versi reversal)
 * 4. OI naik >=5% dalam 2 jam terakhir, bertepatan sama breakout — kalau OI
 *    GAK naik, breakout dianggap gak didukung modal baru, SKIP
 * 5. Entry STOP (chasing momentum, gak nunggu retest — OI surge nunjukin
 *    momentum lagi panas SEKARANG, nunggu retest resiko ketinggalan)
 *    SL: sisi berlawanan level yang baru ditembus + buffer ATR
 *    TP: RR fixed 1:2
 */
// ─── Multi-Factor Score Matrix (adaptasi PERSIS dari project riset GitHub
// "binance-strategy" — SuperTrend + RSI + MACD + Bollinger Bands, bobot &
// threshold ASLI dari mereka: 0.30/0.20/0.30/0.20, threshold 0.15). Reuse
// indikator YANG UDAH ADA (calcRSI, calcMACD) tapi ATR versi INI beda dari
// calcATR (RMA/Wilder) yang dipake Menu 4 — project asli pakai SIMPLE ROLLING
// MEAN, jadi dibikin fungsi terpisah biar match persis "original".
function averageTrueRangeSimple(highs: number[], lows: number[], closes: number[], window: number): number[] {
  const n = closes.length;
  const tr: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(highs[i]! - lows[i]!, Math.abs(highs[i]! - closes[i - 1]!), Math.abs(lows[i]! - closes[i - 1]!));
  }
  const atr: (number | null)[] = new Array(n).fill(null);
  for (let i = window; i < n; i++) {
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) sum += tr[j]!;
    atr[i] = sum / window;
  }
  return atr.map(v => v ?? 0);
}

function emaSeries(values: number[], span: number): number[] {
  const k = 2 / (span + 1);
  const e: number[] = new Array(values.length);
  e[0] = values[0]!;
  for (let i = 1; i < values.length; i++) e[i] = values[i]! * k + e[i - 1]! * (1 - k);
  return e;
}

function supertrendDirectionSeries(highs: number[], lows: number[], closes: number[], atrWindow = 10, multiplier = 3.0): number[] {
  const n = closes.length;
  const hl2 = closes.map((_, i) => (highs[i]! + lows[i]!) / 2);
  const atr = averageTrueRangeSimple(highs, lows, closes, atrWindow);
  const upper = hl2.map((v, i) => v + multiplier * atr[i]!);
  const lower = hl2.map((v, i) => v - multiplier * atr[i]!);
  const finalUpper = [...upper];
  const finalLower = [...lower];
  const trend: number[] = new Array(n).fill(1);
  for (let i = 1; i < n; i++) {
    if (closes[i - 1]! <= finalUpper[i - 1]!) finalUpper[i] = Math.min(upper[i]!, finalUpper[i - 1]!);
    if (closes[i - 1]! >= finalLower[i - 1]!) finalLower[i] = Math.max(lower[i]!, finalLower[i - 1]!);
    if (closes[i]! > finalUpper[i - 1]!) trend[i] = 1;
    else if (closes[i]! < finalLower[i - 1]!) trend[i] = -1;
    else trend[i] = trend[i - 1]!;
  }
  return trend;
}

function bollingerBandsAt(closes: number[], idx: number, window = 20, stdMult = 2.0): { lower: number; middle: number; upper: number } | null {
  if (idx < window - 1) return null;
  const win = closes.slice(idx - window + 1, idx + 1);
  const mean = win.reduce((a, b) => a + b, 0) / window;
  const variance = win.reduce((a, b) => a + (b - mean) ** 2, 0) / window;
  const std = Math.sqrt(variance);
  return { lower: mean - stdMult * std, middle: mean, upper: mean + stdMult * std };
}

interface MultiFactorScoreResult {
  composite: number;
  supertrendScore: number;
  rsiScore: number;
  macdScore: number;
  bollingerScore: number;
  rsiValue: number;
}

function computeMultiFactorScore(
  highs: number[], lows: number[], closes: number[],
  supertrendWeight = 0.30, rsiWeight = 0.20, macdWeight = 0.30, bollingerWeight = 0.20
): MultiFactorScoreResult {
  const idx = closes.length - 1;
  const supertrendScore = supertrendDirectionSeries(highs, lows, closes)[idx]!;
  const rsiValue = calcRSI(closes, 14);
  const rsiScore = rsiValue < 35 ? 1 : rsiValue > 65 ? -1 : 0;
  const macdResult = calcMACD(closes);
  const macdScore = (macdResult.macd > macdResult.signal && macdResult.histogram > 0) ? 1
    : (macdResult.macd < macdResult.signal && macdResult.histogram < 0) ? -1 : 0;
  const bb = bollingerBandsAt(closes, idx);
  let bollingerScore = 0;
  if (bb) {
    const price = closes[idx]!;
    bollingerScore = price < bb.lower ? 1 : price > bb.upper ? -1 : price >= bb.middle ? 0.25 : -0.25;
  }
  const totalWeight = supertrendWeight + rsiWeight + macdWeight + bollingerWeight;
  const composite = (supertrendScore * supertrendWeight + rsiScore * rsiWeight + macdScore * macdWeight + bollingerScore * bollingerWeight) / totalWeight;
  return { composite: Math.max(-1, Math.min(1, composite)), supertrendScore, rsiScore, macdScore, bollingerScore, rsiValue };
}

/**
 * Menu "Counter Scalping" — DIGANTI TOTAL (request user) dari counter-signal
 * Structural jadi Multi-Factor Score Matrix, adaptasi PERSIS dari project
 * riset GitHub open-source "binance-strategy" (SuperTrend+RSI+MACD+Bollinger,
 * bobot & threshold 0.15 APA ADANYA dari project asli — user minta "sesuai
 * dengan original", BUKAN dioptimasi ulang).
 *
 * CATATAN JUJUR (backtest 4178 trade, 38 koin H1, SEBELUM implementasi ini):
 * threshold 0.15 itu didesain buat PORTFOLIO CONTINUOUS REBALANCING (posisi
 * size kontinu -1..+1, direbalance TIAP CANDLE) — bukan sinyal diskrit
 * BUY/SELL/SL/TP kayak sistem Cryptodantt. Dipaksa jadi sinyal diskrit,
 * threshold longgar ini bikin sinyal MUNCUL TERUS-MENERUS (WR cuma 31.3%,
 * jauh di bawah random 33.3% breakeven RR 1:2) — BUKAN karena logic-nya
 * salah implementasi, tapi karena 2 paradigma (portfolio vs sinyal diskrit)
 * emang gak apple-to-apple. Diimplementasikan APA ADANYA sesuai request user.
 */
/**
 * FIX (request user, revisi dari versi "pullback swing generic"): entry di
 * level RESISTANCE/SUPPORT yang UDAH DITEMBUS (breakout genuine — volume
 * 1.4x + lolos MSV2 gate), DAN BELUM PERNAH DI-RETEST sejak breakout —
 * bukan sembarang swing low/high. Reuse detectZonesForExtreme +
 * checkStructureV2Gate (fungsi shared, logic-nya sendiri gak diubah).
 *
 * CATATAN JUJUR dari backtest (216 sinyal BUY yang punya fresh breakout
 * level dari 2198 total sinyal, 38 koin H1): cuma 9.8% sinyal yang
 * genuinely lolos syarat ini (jauh lebih selektif dari versi swing generic
 * sebelumnya), dan WR-nya 29.5% — SEDIKIT LEBIH RENDAH dari versi harga-
 * sekarang (31.4%), bukan lebih baik. Diimplementasikan sesuai request
 * user buat ditest live.
 */
function findFreshBreakoutLevel(h1: KlineData, bias: 'bullish' | 'bearish', lookback = 24): number | null {
  const atr = calcATR(h1.highs, h1.lows, h1.closes);
  if (atr <= 0) return null;
  const { resistanceLevels, supportLevels, zoneWidth } = detectZonesForExtreme(h1, atr);
  const n = h1.closes.length;
  let found: { level: number; breakoutIdx: number } | null = null;

  const volMA20At = (idx: number) => {
    const start = Math.max(0, idx - 20);
    const win = h1.volumes.slice(start, idx);
    return win.length > 0 ? win.reduce((a, b) => a + b, 0) / win.length : 0;
  };

  for (let idx = Math.max(1, n - lookback); idx < n; idx++) {
    const closeAt = h1.closes[idx]!;
    const volAt = h1.volumes[idx]!;
    const volMA = volMA20At(idx);
    if (volMA <= 0) continue;
    if (bias === 'bullish') {
      for (const level of resistanceLevels) {
        const edgeUpper = level + zoneWidth / 2;
        if (closeAt > edgeUpper && volAt > 1.4 * volMA) found = { level, breakoutIdx: idx };
      }
    } else {
      for (const level of supportLevels) {
        const edgeLower = level - zoneWidth / 2;
        if (closeAt < edgeLower && volAt > 1.4 * volMA) found = { level, breakoutIdx: idx };
      }
    }
  }
  if (!found) return null;

  const structGate = checkStructureV2Gate(h1, bias, 'H1');
  if (structGate.blocked) return null;

  // BELUM PERNAH DI-RETEST: harga SETELAH breakout candle sampai sekarang
  // gak boleh pernah balik ke level itu
  for (let j = found.breakoutIdx + 1; j < n; j++) {
    if (bias === 'bullish' && h1.lows[j]! <= found.level) return null;
    if (bias === 'bearish' && h1.highs[j]! >= found.level) return null;
  }
  return found.level;
}

// FIX BUG (interface ini sempat tanpa sengaja ikut terhapus pas hapus dead
// code sisa runBacktest lama — dipulihkan dari file terakhir yang valid)
export interface BreakoutTradingResult {
  status: 'siap_breakout' | 'siap_retest' | 'no_setup' | 'error' | 'waiting' | 'approaching' | 'expired' | 'skip';
  symbol: string;
  bias?: 'bullish' | 'bearish';
  recentPerformance?: RecentPerformance; // mini-backtest instan, cuma diisi di endpoint single-symbol
  tfBreakdown?: TFBreakdownItem[];
  currentPrice: number;
  timestamp: string;
  message?: string;
  confidenceScore?: number; // dulu dipake mode 'confidence' (lama) — sekarang gak dipake lagi
  confidenceTier?: 'high' | 'medium'; // dulu dipake mode 'confidence' (lama) — sekarang gak dipake lagi
  score?: number; // dulu dipake mode lama — sekarang gak dipake lagi
  maxScore: number; // 100
  brokenLevel?: number; // dulu dipake skill OI Surge (dihapus) — sekarang gak keisi lagi, dipertahanin biar type compat
  levelHits?: number; // dulu dipake mode 'confidence' (lama) — sekarang gak dipake lagi
  zoneEdgeUpper?: number; // edge zona S&R H1 (dulu basis Counter Scalping, sekarang gak dipake lagi — Multi-Factor Score gak pake konsep zona)
  zoneEdgeLower?: number; // sama seperti di atas
  candlesNearEdge?: number; // dulu dipake mode 'confidence' (lama) — sekarang gak dipake lagi
  candlesSinceBreakout?: number; // udah berapa candle H1 sejak breakout kejadian (basis Structural asli)
  entryPrice?: number; // harga buat pasang order (STOP kalau siap_breakout, LIMIT kalau siap_retest)
  orderType?: 'stop' | 'limit';
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number; // khusus mode lama (RR 1:3) — 'scalping_sniper' TP floating (swing M15), gak pake field ini
  rr1?: number;
  volumeRatio?: number;
  filterResults?: string[];
  // Bonus konfirmasi khusus mode lama
  adxRising?: boolean;
  macdHistogramExpanding?: boolean;
  vwapBreakout?: boolean;
  momentumClassification?: 'very_fast' | 'fast' | 'normal' | 'slow';
  technicalSnapshot?: TechnicalSnapshot; // RSI/ATR/ADX/Stochastic struktur+eksekusi — informasional, buat Journal Trading
  marketStructureV2?: MarketStructureV2Result | null; // detail Market Structure V2 (klasifikasi, skor 3 arah, breakdown layer) — primary gate, buat transparansi kenapa sinyal ini lolos/di-block
  btcAligned?: boolean; // BTC Correlation — informasional buat Journal (request user, biar riset bisa liat kombinasi bias+BTC pas WIN/LOSE)
  btcBias?: 'bullish' | 'bearish' | 'ranging';
  // ═══ Anticipation Breakout Strategy (request user, REVISI TOTAL) ═══════
  h1Score?: number; // skor arah H1, 0-4
  h1MaxScore?: number; // selalu 4
  snrConfluenceCount?: number; // berapa metode (swing/BB/pivot) setuju di level ini, 1-3
  tp1Percent?: number; // porsi exit di TP1 (50)
  tp2Percent?: number; // porsi exit di TP2 (30)
  tp3TrailingPercent?: number; // porsi sisa buat trailing stop (20)
  takeProfit3TrailingBasisPct?: number; // trailing stop = X% dari high/low tertinggi/terendah sejak entry (2%)
  validUntilHours?: number; // pending order valid berapa jam (24)
  // ═══ Bonus cross-menu (request user): cek sinyal ini SEARAH sama Fitur 5
  // Technical Analysis PRO (Skor Long vs Short) apa enggak. Gak nge-block,
  // cuma info/badge tambahan buat UI.
  taProBonusConfirmed?: boolean;
  taProBonusClassification?: string | null;
  taProBonusScore?: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ANTICIPATION BREAKOUT STRATEGY (request user, GANTI TOTAL dari Sniper
// Breakout M1+M5+M15). Konsepnya: pasang pending stop order LEBIH AWAL
// berdasarkan H1 trend + M15 S/R, BUKAN nunggu trigger cross candle-by-candle.
//
// FASE 1 (H1): skor 4 indikator (RSI/EMA/MACD/ADX) tentuin arah & kekuatan
// FASE 2 (M15): 3 metode S/R (swing 20-candle, Bollinger Bands, Pivot Points
//               5-period) — confluence 2+ metode dalam ±0.5% = level valid
// FASE 3: pasang Buy Stop / Sell Stop di level, TP multi-level (50/30/20%
//         dengan trailing stop di porsi terakhir)
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// ANTICIPATION BREAKOUT STRATEGY v3 (request user, REVISI dari versi H1+EMA13/34):
// FASE 1 (H4, bukan H1 lagi): RSI+EMA26 tunggal+MACD+ADX, skor 4
// FASE 2 (M15): S/R confluence 2 metode (Swing+Pivot, Bollinger Bands DIHAPUS)
// FASE 3 (BARU): Force Index (EMA2) — leading indicator, dicek SEBELUM
//                breakout (harga masih menuju level), bukan pas breakout
// FASE 4: entry di level confluence, SL PURE ATR M30 (data baru), TP RR 1:2
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// ANTICIPATION BREAKOUT STRATEGY v4 (request user, REVISI BESAR):
// FASE 1: H4 trend scoring (sama)
// FASE 1.5: Area krusial H4 -- SEKARANG SOFT WARNING ("Rawan Reversal"),
//           bukan hard reject lagi
// FASE 2: M15 S/R confluence -- touches≥2 (revert dari 3), jarak 1-5%
// FASE 3: Force Index M15 leading indicator (sama)
// FASE 4 (BARU): M5 Breakout Confirmation -- swing fresh+untouched, scan
//                mundur 26 candle
// FASE 5 (BARU): Retest ke magnet zone M5 -- confluence+EMA26 M5, Force
//                Index M5 hard, Stochastic Slow M5 soft
// FASE 6 (BARU, ganti FASE 4 lama): Entry LIMIT (bukan STOP lagi) --
//                SL = yang lebih jauh antara swing M15 vs ATR M15
// M30 DIHAPUS TOTAL dari fetch (gak dipake lagi di workflow baru)
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// SNIPER BREAKOUT v5 (request user, GANTI TOTAL): "M15 Fresh Breakout,
// Belum Retest" -- fokus M15, ADX+struktur EMA26/89+momentum, entry LIMIT
// nunggu retest ke level yang breakout.
// FASE 1: M15 breakout fresh, volume>2x MA20, scan-back 26, ADX>25
// FASE 2: belum retest (binary, isFreshUntouched pattern)
// FASE 3: struktur trend EMA26 vs EMA89
// FASE 4: Force Index + RSI(14) momentum
// FASE 5: Entry LIMIT di level breakout, SL 1.4x ATR M15, TP RR 1:2 & 1:3
// ═══════════════════════════════════════════════════════════════════════════

export async function analyzeCounterStructural(symbol: string): Promise<BreakoutTradingResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';
  const maxScore = 100;

  try {
    // REVISI (request user): timeframe eksekusi balik lagi M30 -> M30
    // (breakout detection, swing, EMA26/89, Force Index/RSI, retest,
    // semuanya di M30). 100 candle M30 (~2 hari) cukup buat EMA89 +
    // scan-back 26 + swing lookback + volume MA20.
    // REVISI (request user): balikin fetch H4 -- dipake khusus buat cek
    // "level signifikan" (>=2x reaksi jelas di H4), BUKAN buat trend/filter
    // arah lagi (itu tetep dilepas, sesuai revert sebelumnya). Breakout
    // detection & entry tetep di M30.
    const [m30, h4, d1, tickerRes] = await Promise.all([
      fetchKlines(symbol, '30m', 100),
      fetchKlines(symbol, '4h', 40),
      fetchKlines(symbol, '1d', 30), // BARU (request user): RSI(14) D1 filter overbought/oversold
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);
    const currentPrice = tickerRes.ok
      ? parseFloat((await tickerRes.json() as { price: string }).price)
      : m30.closes[m30.closes.length - 1]!;

    if (m30.closes.length < 100) {
      return { status: 'error', symbol, currentPrice, timestamp, message: 'Data candle gak cukup (butuh M30 100+)', maxScore };
    }
    if (h4.closes.length < 30) {
      return { status: 'error', symbol, currentPrice, timestamp, message: 'Data candle gak cukup (butuh H4 30+)', maxScore };
    }
    if (d1.closes.length < 15) {
      return { status: 'error', symbol, currentPrice, timestamp, message: 'Data candle gak cukup (butuh D1 15+)', maxScore };
    }

    const atrM30 = calcATR(m30.highs, m30.lows, m30.closes);
    if (atrM30 <= 0) {
      return { status: 'error', symbol, currentPrice, timestamp, message: 'ATR M30 gak valid', maxScore };
    }

    // ═══ FASE 1: M30 BREAKOUT DETECTION ════════════════════════════════════
    const lastClosedIdx = m30.closes.length - 2;
    const swingLookback = 30;
    const swingSlice = Math.max(0, lastClosedIdx - swingLookback - 26); // headroom buat scan-back 26 + window swing
    const swingFractal = 2;

    // Cari swing high/low fresh (fractal 2-2) dalam window
    const findFreshSwing = (idx: number): { high: { idx: number; price: number } | null; low: { idx: number; price: number } | null } => {
      let high: { idx: number; price: number } | null = null;
      let low: { idx: number; price: number } | null = null;
      for (let i = idx - swingFractal; i >= Math.max(swingFractal, idx - swingLookback); i--) {
        if (i - swingFractal < 0 || i + swingFractal >= m30.highs.length) continue;
        const isHigh = [1, 2].every(k => m30.highs[i]! > m30.highs[i - k]!) && [1, 2].every(k => m30.highs[i]! > m30.highs[i + k]!);
        const isLow = [1, 2].every(k => m30.lows[i]! < m30.lows[i - k]!) && [1, 2].every(k => m30.lows[i]! < m30.lows[i + k]!);
        if (isHigh && !high) high = { idx: i, price: m30.highs[i]! };
        if (isLow && !low) low = { idx: i, price: m30.lows[i]! };
        if (high && low) break;
      }
      return { high, low };
    };

    const isFreshUntouched = (swingIdx: number, level: number, checkUntilIdx: number, tol: number): boolean => {
      for (let i = swingIdx + 1; i < checkUntilIdx; i++) {
        const h = m30.highs[i]!, l = m30.lows[i]!;
        if (Math.abs(h - level) <= tol || Math.abs(l - level) <= tol || (l <= level && h >= level)) return false;
      }
      return true;
    };

    // BARU (request user): pastiin level S/R yang mau ditembus itu BENERAN
    // SIGNIFIKAN di H4 -- minimal 2x disentuh dengan reaksi jelas (lihat
    // checkLevelSignificantH4 di atas).
    const h4LastClosedIdx = h4.closes.length - 2;
    const h4ClosedHighs = h4.highs.slice(0, h4LastClosedIdx + 1);
    const h4ClosedLows = h4.lows.slice(0, h4LastClosedIdx + 1);
    const h4ClosedCloses = h4.closes.slice(0, h4LastClosedIdx + 1);
    const atrH4 = calcATR(h4ClosedHighs, h4ClosedLows, h4ClosedCloses);
    const isSignificantLevel = (level: number, bias: 'bullish' | 'bearish'): boolean =>
      checkLevelSignificantH4(h4ClosedHighs, h4ClosedLows, h4ClosedCloses, level, bias, atrH4).significant;

    let found: {
      breakoutIdx: number; bias: 'bullish' | 'bearish'; brokenLevel: number; adxValue: number;
    } | null = null;

    for (let breakoutIdx = lastClosedIdx; breakoutIdx >= Math.max(swingSlice + 5, lastClosedIdx - 26); breakoutIdx--) {
      const swings = findFreshSwing(breakoutIdx);
      const volMa20 = calcSMA(m30.volumes.slice(0, breakoutIdx + 1), 20);
      if (volMa20 <= 0) continue;
      const volRatio = m30.volumes[breakoutIdx]! / volMa20;
      // REVISI (request user): volume gate naik dari >=2x jadi >=2.5x MA20.
      if (volRatio < 2.5) continue;

      const tol = atrM30 * 0.1;
      const bullishBreakout = swings.high && breakoutIdx > swings.high.idx &&
        m30.closes[breakoutIdx]! > swings.high.price &&
        isFreshUntouched(swings.high.idx, swings.high.price, breakoutIdx, tol) &&
        isSignificantLevel(swings.high.price, 'bullish');
      const bearishBreakout = swings.low && breakoutIdx > swings.low.idx &&
        m30.closes[breakoutIdx]! < swings.low.price &&
        isFreshUntouched(swings.low.idx, swings.low.price, breakoutIdx, tol) &&
        isSignificantLevel(swings.low.price, 'bearish');

      if (!bullishBreakout && !bearishBreakout) continue;

      const adx = calcADXWithDI(
        m30.highs.slice(0, breakoutIdx + 1), m30.lows.slice(0, breakoutIdx + 1), m30.closes.slice(0, breakoutIdx + 1), 14,
      );
      // REVISI (request user): ADX jadi BONUS/info doang, bukan hard filter
      // lagi -- gak nge-block breakout walau ADX <=25.

      const bias: 'bullish' | 'bearish' = bullishBreakout ? 'bullish' : 'bearish';
      const brokenLevel = bullishBreakout ? swings.high!.price : swings.low!.price;

      // ═══ FASE 2: BELUM RETEST (binary) ═══════════════════════════════════
      // FIX BUG (audit user, "kenapa gak pernah dapet sinyal"): dulu ngecek
      // ulang dari swingIdx+1, range-nya IKUT NYENGGOL candle breakout itu
      // SENDIRI (karena breakoutIdx <= lastClosedIdx). Candle breakout wajar
      // low/high-nya deket/nembus level (baru aja jebol dari situ), jadi
      // HAMPIR SELALU ke-flag "udah disentuh" oleh DIRINYA SENDIRI -- breakout
      // yang baru ketemu di FASE 1 langsung DITOLAK LAGI di FASE 2, hampir
      // tiap kali. FIX: cek cuma dari SETELAH breakoutIdx (candle breakout
      // itu sendiri DIKECUALIKAN, sama kayak FASE 1).
      const stillFresh = isFreshUntouched(breakoutIdx, brokenLevel, lastClosedIdx + 1, tol);
      if (!stillFresh) continue; // udah keretest SETELAH breakout, bukan kandidat "belum retest" lagi

      found = { breakoutIdx, bias, brokenLevel, adxValue: adx.adx };
      break;
    }

    if (!found) {
      return {
        status: 'waiting', symbol, currentPrice, timestamp,
        message: 'Belum ada breakout M30 fresh (level signifikan (>=2x reaksi jelas di H4), volume>2.5x MA20, belum retest) dalam 26 candle terakhir',
        maxScore,
      };
    }

    const { bias, brokenLevel, adxValue } = found;

    // BARU (request user): RSI(14) D1 HARD FILTER -- tolak sinyal kalau D1
    // udah overbought (BUY) atau oversold (SELL), biar gak entry pas harga
    // rawan pembalikan arah (kasus asli: lose kebanyakan kejadian pas entry
    // BUY deket resistance D1 padahal D1 udah jenuh naik). >=65 overbought,
    // <=35 oversold -- di luar itu (55-65 / 35-45) cuma label info "trend
    // sehat", gak nge-block.
    const rsiD1 = calcRSI(d1.closes, 14);
    if (bias === 'bullish' && rsiD1 >= 65) {
      return {
        status: 'waiting', symbol, bias, currentPrice, timestamp,
        message: `Breakout M30 valid TAPI RSI D1 (${rsiD1.toFixed(1)}) udah OVERBOUGHT (>=65) — rawan pembalikan arah, sinyal BUY ditolak`,
        maxScore,
        filterResults: [`🚫 RSI D1 (BLOCK) — ${rsiD1.toFixed(1)} overbought (>=65), BUY ditolak`],
      };
    }
    if (bias === 'bearish' && rsiD1 <= 35) {
      return {
        status: 'waiting', symbol, bias, currentPrice, timestamp,
        message: `Breakout M30 valid TAPI RSI D1 (${rsiD1.toFixed(1)}) udah OVERSOLD (<=35) — rawan pembalikan arah, sinyal SELL ditolak`,
        maxScore,
        filterResults: [`🚫 RSI D1 (BLOCK) — ${rsiD1.toFixed(1)} oversold (<=35), SELL ditolak`],
      };
    }
    const rsiD1Label = bias === 'bullish'
      ? (rsiD1 >= 55 ? 'trend bullish sehat' : rsiD1 <= 45 ? 'lemah, hati-hati' : 'netral')
      : (rsiD1 <= 45 ? 'trend bearish sehat' : rsiD1 >= 55 ? 'lemah, hati-hati' : 'netral');

    const filterResults: string[] = [
      `✅ FASE 1 — Breakout M30 fresh @ ${brokenLevel.toFixed(6)}, volume>2.5x MA20, level udah teruji minimal 2x (signifikan), belum retest sejak breakout`,
      `ℹ️ ADX(14) @ breakout: ${adxValue.toFixed(1)} (bonus/info, gak nge-block)${adxValue > 25 ? ' — trend kuat' : ' — trend lemah/ranging, hati-hati'}`,
      `✅ RSI(14) D1 — ${rsiD1.toFixed(1)} (${rsiD1Label}), belum overbought/oversold`,
    ];

    // ═══ FASE 3: STRUKTUR TREND (EMA26 vs EMA89) -- bonus/info doang, gak
    // nge-block. Cuma FASE 1 & 2 yang wajib. ══════════════════════════════
    const emaSeries26 = calcEMASeries(m30.closes, 26);
    const emaSeries89 = calcEMASeries(m30.closes, 89);
    const ema26Now = emaSeries26[lastClosedIdx]!;
    const ema89Now = emaSeries89[lastClosedIdx]!;
    const structOk = bias === 'bullish' ? ema26Now > ema89Now : ema26Now < ema89Now;
    filterResults.push(`ℹ️ FASE 3 (info) — Struktur EMA26 ${ema26Now.toFixed(6)} ${ema26Now > ema89Now ? '>' : '<'} EMA89 ${ema89Now.toFixed(6)}${structOk ? `, searah ${bias}` : `, BERLAWANAN ${bias} — hati-hati`}`);

    // ═══ FASE 4: MOMENTUM (info doang, gak nge-block) ═══════════════════════
    const forceIndexSeries = calcForceIndexSeries(m30.closes, m30.volumes);
    const forceIndexNow = forceIndexSeries[forceIndexSeries.length - 1];
    const rsi = calcRSI(m30.closes, 14);
    if (forceIndexNow !== undefined) {
      const forceIndexOk = bias === 'bullish' ? forceIndexNow > 0 : forceIndexNow < 0;
      filterResults.push(`ℹ️ FASE 4 (info) — Force Index ${forceIndexNow.toFixed(2)}${forceIndexOk ? ` searah ${bias}` : ' BERLAWANAN — hati-hati'}, RSI(14) ${rsi.toFixed(1)}${(bias === 'bullish' ? (rsi > 50 && rsi < 80) : (rsi > 20 && rsi < 50)) ? ' dalam range normal' : ' di luar range normal — hati-hati'}`);
    }

    // ═══ FASE 5: ENTRY SETUP — LIMIT di level breakout, SL 1.4x ATR M30 ═════
    const dirMult = bias === 'bullish' ? 1 : -1;
    // REVISI (request user, dari riset presisi retest 3 koin/222 sample):
    // entry digeser 0.05% ke arah "lebih gampang ke-fill" dari level persis
    // -- bullish: SEDIKIT DI ATAS brokenLevel, bearish: SEDIKIT DI BAWAH.
    // Data nunjukin ~75% retest overshoot/pas persis ke level, cuma ~25%
    // berhenti sebelum nyampe (maks ~0.15%) -- geser dikit nutupin
    // mayoritas kasus "stop sebelum level" tanpa ngorbanin presisi banyak.
    const entryPrice = brokenLevel + (brokenLevel * 0.0005 * dirMult);

    const entryStillValid = bias === 'bullish' ? entryPrice <= currentPrice : entryPrice >= currentPrice;
    if (!entryStillValid) {
      return {
        status: 'waiting', symbol, bias, currentPrice, timestamp,
        message: `Level breakout udah kelewat jauh dari harga sekarang (${currentPrice.toFixed(6)}) — entry ${entryPrice.toFixed(6)} gak masuk akal lagi buat LIMIT`,
        maxScore, filterResults,
      };
    }

    const stopLoss = entryPrice - atrM30 * 1.4 * dirMult;
    const risk = Math.abs(entryPrice - stopLoss);
    const takeProfit1 = entryPrice + risk * 2 * dirMult;
    const takeProfit2 = entryPrice + risk * 3 * dirMult;
    const rr1 = 2;

    filterResults.push(`✅ FASE 5 — Entry LIMIT @ ${entryPrice.toFixed(6)} (level ${brokenLevel.toFixed(6)}, digeser 0.05% ke arah lebih gampang ke-fill), SL 1.4×ATR M30 @ ${stopLoss.toFixed(6)}, TP1 RR1:2 @ ${takeProfit1.toFixed(6)}, TP2 RR1:3 @ ${takeProfit2.toFixed(6)}`);

    const taProBonus = await checkTaProBonus(symbol, bias);

    return {
      status: 'siap_retest', symbol, bias, currentPrice, timestamp,
      maxScore, filterResults,
      entryPrice, orderType: 'limit', stopLoss,
      takeProfit1, takeProfit2, rr1,
      brokenLevel,
      taProBonusConfirmed: taProBonus.confirmed, taProBonusClassification: taProBonus.classification, taProBonusScore: taProBonus.score,
      message: `SIAP PASANG ${bias === 'bullish' ? 'BUY' : 'SELL'} LIMIT di ${entryPrice.toFixed(6)} — breakout M30 fresh belum retest, struktur EMA26/89 searah, momentum konfirmasi. SL 1.4×ATR, TP1 1:2, TP2 1:3.`,
    };
  } catch (err) {
    return {
      status: 'error', symbol, currentPrice: 0, timestamp,
      message: err instanceof Error ? err.message : 'Unknown error',
      maxScore,
    };
  }
}
// ─── Backtest (request user, "sekalian diperbarui" — GANTI TOTAL ke Python
// vectorized pandas/numpy via subprocess, BUKAN loop TypeScript manual lagi).
// Logic REPLIKASI PERSIS 3 skill live sekarang (Structural, Skill 15M, Counter
// Scalping) — beda dari versi lama yang masih pakai struktur OB/FVG/S&R/
// pattern candle (udah ditinggalkan jauh sebelum sesi ini, "known issue" yang
// FIXED lewat rewrite total ini).
function getPeriodLimitH1(period: '1m' | '3m' | '6m' | '1y' | '2y' | '3y'): number {
  const map: Record<string, number> = { '1m': 720, '3m': 2160, '6m': 4320, '1y': 8640, '2y': 17280, '3y': 25920 };
  return map[period] ?? 8640;
}

// Binance limit MAX 1500 candle per request — backtest period panjang (1y/2y/3y)
// butuh JAUH lebih banyak. Paging mundur pakai endTime, gabungin jadi 1 array.
async function fetchKlinesLong(symbol: string, interval: string, totalNeeded: number): Promise<number[][]> {
  const allCandles: number[][] = [];
  let endTime: number | undefined = undefined;
  const maxPerRequest = 1500;

  while (allCandles.length < totalNeeded) {
    const remaining = totalNeeded - allCandles.length;
    const limit = Math.min(maxPerRequest, remaining);
    let url = `${BINANCE_FUTURES_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (endTime) url += `&endTime=${endTime}`;

    let attempt = 0;
    let data: number[][] | null = null;
    while (attempt < 3) {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (res.status === 418 || res.status === 429) {
        await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
        attempt++;
        continue;
      }
      if (!res.ok) throw new Error(`Klines fetch failed: ${res.status}`);
      data = await res.json();
      break;
    }
    if (!data || data.length === 0) break;

    allCandles.unshift(...data);
    const firstCandleOpenTime = data[0]![0] as number;
    endTime = firstCandleOpenTime - 1;
    if (data.length < limit) break;
  }

  return allCandles.slice(-totalNeeded);
}

function scaleForTFH1Basis(h1Count: number, tf: 'M5' | 'M15' | 'M30' | 'H4'): number {
  const ratio: Record<string, number> = { M5: 12, M15: 4, M30: 2, H4: 0.25 };
  return Math.round(h1Count * ratio[tf]!);
}

export interface PyBacktestSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  trades: Array<{ bias: string; result: 'WIN' | 'LOSE'; entryPrice: number; stopLoss: number; takeProfit1: number; entryTime: number; exitTime: number }>;
}

export interface BacktestResult {
  symbol: string;
  period: string;
  timestamp: string;
  structuralResult: PyBacktestSummary | null;
  scalping15mResult: PyBacktestSummary | null;
  counterScalpingResult: PyBacktestSummary | null;
  elapsedSeconds: number;
}

/**
 * Spawn Python subprocess (request user, opsi B — child_process, BUKAN
 * service HTTP terpisah). Kirim data candle via stdin (JSON), terima hasil
 * backtest via stdout (JSON).
 */
// FIX BUG KRUSIAL (ketemu user — EPIPE gara-gara path SALAH TOTAL): folder
// backtest_py/ itu PYTHON, BUKAN bagian dari bundle esbuild — jadi __dirname
// (yang nunjuk ke folder HASIL BUILD, dist/) itu SALAH basis buat cari
// backtest_py/ (yang lokasinya di src/backtest_py/, BUKAN dist/backtest_py/
// ATAU 1 folder di atas dist/). Cek BEBERAPA kandidat lokasi yang mungkin
// (dev vs production build beda struktur), pakai yang PERTAMA GENUINELY ADA
// — biar gak assumsi struktur folder yang belum tentu benar di semua environment.
function resolveBacktestScriptPath(): string {
  const candidates = [
    nodePath.join(process.cwd(), 'src', 'backtest_py', 'backtest_engine.py'), // dev: cwd = api-server/
    nodePath.join(process.cwd(), 'backtest_py', 'backtest_engine.py'), // fallback kalau cwd udah di src/
    nodePath.join(__dirname, '..', 'backtest_py', 'backtest_engine.py'), // fallback lama (dist/../backtest_py)
    nodePath.join(__dirname, 'backtest_py', 'backtest_engine.py'),
  ];
  for (const candidate of candidates) {
    if (nodeFs.existsSync(candidate)) return candidate;
  }
  throw new Error(`backtest_engine.py gak ketemu di kandidat manapun: ${candidates.join(', ')} (cwd: ${process.cwd()}, __dirname: ${__dirname})`);
}

function runPythonBacktest(payload: object): Promise<{ structuralResult: PyBacktestSummary | null; scalping15mResult: PyBacktestSummary | null; counterScalpingResult: PyBacktestSummary | null; elapsedSeconds: number }> {
  return new Promise((resolve, reject) => {
    let scriptPath: string;
    try {
      scriptPath = resolveBacktestScriptPath();
    } catch (err) {
      reject(err instanceof Error ? err : new Error('Gagal cari backtest_engine.py'));
      return;
    }
    const proc = spawn('python3', [scriptPath]);

    let stdout = '';
    let stderr = '';
    let settled = false;
    const safeResolve = (v: any) => { if (!settled) { settled = true; resolve(v); } };
    const safeReject = (e: Error) => { if (!settled) { settled = true; reject(e); } };

    // FIX BUG KRUSIAL (ketemu user — EPIPE bikin SELURUH SERVER CRASH, 2x
    // kejadian): semua listener error (proc + SEMUA stream stdin/stdout/
    // stderr) WAJIB di-attach SEBELUM proc.stdin.write() dipanggil — kalau
    // proses child mati SANGAT CEPAT (spawn gagal, python3 crash instant,
    // dst), event 'error' bisa ke-emit SEBELUM baris write() sempat jalan.
    // 'error' di level proc TIDAK otomatis nangkep error di child stream
    // (itu EventEmitter TERPISAH) — makanya HARUS dipasang manual di
    // stdin/stdout/stderr juga, bukan cuma proc.
    proc.on('error', (err: Error) => safeReject(new Error(`Gagal spawn python3: ${err.message}`)));
    proc.stdin.on('error', (err: Error) => safeReject(new Error(`stdin error (proses Python kemungkinan mati dini — cek python3 & pandas/numpy terinstall): ${err.message}`)));
    proc.stdout.on('error', (err: Error) => safeReject(new Error(`stdout error: ${err.message}`)));
    proc.stderr.on('error', (err: Error) => safeReject(new Error(`stderr error: ${err.message}`)));

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code: number) => {
      if (code !== 0) {
        safeReject(new Error(`Python backtest exit code ${code}: ${stderr.slice(-2000) || '(stderr kosong)'}`));
        return;
      }
      try {
        safeResolve(JSON.parse(stdout));
      } catch {
        safeReject(new Error(`Gagal parse output Python: ${stdout.slice(-1000)}`));
      }
    });

    // Timeout guard — backtest 3 tahun bisa lama, tapi kalau subprocess
    // hang/gak pernah exit, jangan biarin request nge-gantung selamanya.
    const timeoutMs = 5 * 60 * 1000; // 5 menit
    const timer = setTimeout(() => {
      if (!settled) {
        try { proc.kill(); } catch {}
        safeReject(new Error('Backtest timeout (>5 menit) — coba periode lebih pendek'));
      }
    }, timeoutMs);
    proc.on('close', () => clearTimeout(timer));

    if (!proc.pid) {
      // spawn gagal total, gak ada PID sama sekali — jangan coba write ke stdin
      safeReject(new Error('Gagal spawn subprocess python3 (proc.pid kosong)'));
      return;
    }

    try {
      proc.stdin.write(JSON.stringify(payload));
      proc.stdin.end();
    } catch (err) {
      safeReject(err instanceof Error ? err : new Error('Gagal nulis ke stdin Python subprocess'));
    }
  });
}

export async function runBacktest(
  symbol: string,
  period: '1m' | '3m' | '6m' | '1y' | '2y' | '3y',
  menu: 'structural' | 'scalping15m' | 'counter_scalping' | 'both',
): Promise<BacktestResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';

  const h1Count = getPeriodLimitH1(period);
  const needM30 = menu === 'structural' || menu === 'both';
  const needM5 = menu === 'structural' || menu === 'both';
  const needM15 = menu === 'scalping15m' || menu === 'both';
  const needH4 = menu === 'structural' || menu === 'scalping15m' || menu === 'both';
  const needH1 = menu === 'counter_scalping' || menu === 'both';

  const [m30, m5, m15, h4, h1, btcH1] = await Promise.all([
    needM30 ? fetchKlinesLong(symbol, '30m', scaleForTFH1Basis(h1Count, 'M30')) : Promise.resolve(null),
    needM5 ? fetchKlinesLong(symbol, '5m', scaleForTFH1Basis(h1Count, 'M5')) : Promise.resolve(null),
    needM15 ? fetchKlinesLong(symbol, '15m', scaleForTFH1Basis(h1Count, 'M15')) : Promise.resolve(null),
    needH4 ? fetchKlinesLong(symbol, '4h', scaleForTFH1Basis(h1Count, 'H4')) : Promise.resolve(null),
    needH1 ? fetchKlinesLong(symbol, '1h', h1Count) : Promise.resolve(null),
    fetchKlinesLong('BTCUSDT', '1h', h1Count),
  ]);

  const candles: Record<string, number[][]> = { btc_h1: btcH1! };
  if (m30) candles['m30'] = m30;
  if (m5) candles['m5'] = m5;
  if (m15) candles['m15'] = m15;
  if (h4) candles['h4'] = h4;
  if (h1) candles['h1'] = h1;

  const pyResult = await runPythonBacktest({ menu, candles });

  return {
    symbol, period, timestamp,
    structuralResult: pyResult.structuralResult,
    scalping15mResult: pyResult.scalping15mResult,
    counterScalpingResult: pyResult.counterScalpingResult,
    elapsedSeconds: pyResult.elapsedSeconds,
  };
}

// ─── Mini-Backtest Instan (buat tab Analisa, BUKAN Scan) ───────────────────
// Ide: pas user analisa 1 koin manual, langsung kasih konteks historis
// "N setup terakhir buat koin ini menang/kalah berapa" — tanpa perlu buka tab
// Backtest terpisah dan set periode manual. Sengaja SCOPE KECIL (1 bulan aja,
// bukan periode panjang) biar CEPET — ini dipanggil per-klik user, bukan di
// loop scan 50 koin (kalau ditaro di analyzeXEntry langsung, Scan jadi 50x
// lebih lambat). Dipanggil di level ROUTE, cuma buat endpoint single-symbol.
export interface RecentPerformance {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  periodLabel: string;
}

export async function getRecentPerformance(
  symbol: string,
  menu: 'structural' | 'scalping15m' | 'counter_scalping'
): Promise<RecentPerformance | null> {
  try {
    const result = await runBacktest(symbol, '1m', menu);
    const analysis =
      menu === 'structural' ? result.structuralResult :
      menu === 'scalping15m' ? result.scalping15mResult :
      result.counterScalpingResult;
    if (!analysis || analysis.totalTrades === 0) return null; // gak ada histori — biar UI tau buat sembunyiin section ini, bukan nampilin 0/0
    return {
      totalTrades: analysis.totalTrades,
      wins: analysis.wins,
      losses: analysis.losses,
      winRate: analysis.winRate,
      periodLabel: '30 hari terakhir',
    };
  } catch {
    return null; // fail-safe — kalau mini-backtest gagal, jangan ganggu hasil analisa utama
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// MONEY MAGNET SCALPING (request user, MENU BARU) -- PERSIS logic Money
// Magnet (Scalping, single-level), TF diganti: H4->M30 (trend), M30->M1
// (swing/eksekusi). SL beda: pakai swing high/low terdekat (bukan ATR).
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// MONEY MAGNET SCALPING v2 (request user, REVISI) -- logic Money Magnet
// (Scalping, single-level), TF: H4->M30 (trend), M30->M5 (eksekusi, diganti
// dari M1 karena kelewat noise). SL: swing high/low terdekat. TAMBAHAN:
// Force Index (EMA2) M30 sekarang JUGA dicek di FASE 1 (harus searah trend
// M30) -- terpisah dari Force Index M5 di FASE 3 (retest), boleh beda arah.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// MONEY MAGNET SCALPING v3 (M30/M5, single-level, request user):
// FASE 1: Trend M30 = EMA26+EMA89 M30 (harus searah)
// FASE 2: breakout M5 -- swing S/R fresh ATAU EMA26 M5 (salah satu),
//         volume>=2x MA20, retest ke S/R (BUKAN EMA26) dengan Force Index
//         searah TANPA divergence
// FASE 3: Entry di S/R, SL di swing SEBELUM S/R itu kebentuk, TP RR1:2/1:3
// ═══════════════════════════════════════════════════════════════════════════

export async function analyzeMoneyMagnetScalping(symbol: string): Promise<ScalpingResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';
  const maxScore = 100;

  try {
    // REVISI (request user): trend gate H4 (EMA26) DIHAPUS -- arah sinyal
    // sekarang murni dari breakout-nya sendiri, diganti filter RSI(14) D1
    // (samain pola Sniper Breakout Skill 1 & Menu Scalping). H4 tetep
    // ke-fetch, dipake buat cek "level signifikan" doang. Eksekusi tetep M15.
    const [h4, m15, d1, tickerRes] = await Promise.all([
      fetchKlines(symbol, '4h', 40),
      fetchKlines(symbol, '15m', 150),
      fetchKlines(symbol, '1d', 30),
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);
    const currentPrice = tickerRes.ok
      ? parseFloat((await tickerRes.json() as { price: string }).price)
      : m15.closes[m15.closes.length - 1]!;

    if (h4.closes.length < 30) {
      return { status: 'error', symbol, currentPrice, timestamp, mode: 'moneymagnetscalping', message: 'Data candle gak cukup (butuh H4 30+)', maxScore };
    }
    if (m15.closes.length < 100) {
      return { status: 'error', symbol, currentPrice, timestamp, mode: 'moneymagnetscalping', message: 'Data candle gak cukup (butuh M15 150+)', maxScore };
    }
    if (d1.closes.length < 15) {
      return { status: 'error', symbol, currentPrice, timestamp, mode: 'moneymagnetscalping', message: 'Data candle gak cukup (butuh D1 15+)', maxScore };
    }

    const filterResults: string[] = [];

    // ═══ FASE 1: BREAKOUT M15 (swing S/R fresh ATAU EMA26 M15) ═════════════
    const atrM15 = calcATR(m15.highs, m15.lows, m15.closes);
    if (atrM15 <= 0) {
      return { status: 'error', symbol, currentPrice, timestamp, mode: 'moneymagnetscalping', message: 'ATR M15 gak valid', maxScore };
    }
    const lastClosedIdx = m15.closes.length - 2;
    const emaSeries26M15 = calcEMASeries(m15.closes, 26);
    const volMa20Series = m15.volumes.map((_, i) => {
      const start = Math.max(0, i - 19);
      const w = m15.volumes.slice(start, i + 1);
      return w.reduce((a, b) => a + b, 0) / w.length;
    });

    const swingWindow = 60;
    const swingSlice = Math.max(0, lastClosedIdx - swingWindow);
    const swingHighsList = findRecentSwingHighsWithIndex(m15.highs.slice(swingSlice, lastClosedIdx + 1), 8)
      .map(s => ({ price: s.price, index: swingSlice + s.index }));
    const swingLowsList = findRecentSwingLowsWithIndex(m15.lows.slice(swingSlice, lastClosedIdx + 1), 8)
      .map(s => ({ price: s.price, index: swingSlice + s.index }));

    if (swingHighsList.length < 2 || swingLowsList.length < 2) {
      return { status: 'no_structure', symbol, currentPrice, timestamp, mode: 'moneymagnetscalping', message: 'Belum cukup swing high/low M15 buat cari level S/R', maxScore };
    }

    const touchTolFresh = atrM15 * 0.1;
    const isFreshUntouched = (swingIdxAbs: number, level: number, checkUntilIdx: number): boolean => {
      for (let i = swingIdxAbs + 1; i < checkUntilIdx; i++) {
        const hh = m15.highs[i]!, ll = m15.lows[i]!;
        if (Math.abs(hh - level) <= touchTolFresh || Math.abs(ll - level) <= touchTolFresh || (ll <= level && hh >= level)) return false;
      }
      return true;
    };

    // level S/R yang mau ditembus harus signifikan di H4 -- minimal 2x
    // disentuh dengan reaksi jelas (checkLevelSignificantH4).
    const h4LastClosedIdx = h4.closes.length - 2;
    const h4ClosedHighs = h4.highs.slice(0, h4LastClosedIdx + 1);
    const h4ClosedLows = h4.lows.slice(0, h4LastClosedIdx + 1);
    const h4ClosedCloses = h4.closes.slice(0, h4LastClosedIdx + 1);
    const atrH4 = calcATR(h4ClosedHighs, h4ClosedLows, h4ClosedCloses);
    const isSignificantLevel = (level: number, bias: 'bullish' | 'bearish'): boolean =>
      checkLevelSignificantH4(h4ClosedHighs, h4ClosedLows, h4ClosedCloses, level, bias, atrH4).significant;

    const forceIndexSeries = calcForceIndexSeries(m15.closes, m15.volumes);

    type MoneyMagnetV3Found = {
      breakoutIdx: number; retestIdx: number; levelPrice: number; levelIdxAbs: number;
      slBasisPrice: number; entryLevel: number; forceIndexValue: number; bias: 'bullish' | 'bearish';
    };
    let found: MoneyMagnetV3Found | null = null;

    for (let breakoutIdx = lastClosedIdx - 1; breakoutIdx >= Math.max(swingSlice + 5, lastClosedIdx - 24); breakoutIdx--) {
      const closeB = m15.closes[breakoutIdx]!;
      const volRatio = volMa20Series[breakoutIdx]! > 0 ? m15.volumes[breakoutIdx]! / volMa20Series[breakoutIdx]! : 0;
      if (volRatio < 2.5) continue;

      const resistance = swingHighsList.find(s => s.index < breakoutIdx) ?? swingHighsList[0]!;
      const support = swingLowsList.find(s => s.index < breakoutIdx) ?? swingLowsList[0]!;

      // REVISI (request user): arah sinyal murni dari breakout-nya sendiri,
      // gak perlu searah "trend H4" lagi.
      const emaCrossUp = m15.closes[breakoutIdx - 1]! <= emaSeries26M15[breakoutIdx - 1]! && closeB > emaSeries26M15[breakoutIdx]!;
      const bullishBreakout = breakoutIdx > resistance.index &&
        ((closeB > resistance.price && isFreshUntouched(resistance.index, resistance.price, breakoutIdx)) || emaCrossUp) &&
        closeB > resistance.price &&
        isSignificantLevel(resistance.price, 'bullish');

      const emaCrossDown = m15.closes[breakoutIdx - 1]! >= emaSeries26M15[breakoutIdx - 1]! && closeB < emaSeries26M15[breakoutIdx]!;
      const bearishBreakout = breakoutIdx > support.index &&
        ((closeB < support.price && isFreshUntouched(support.index, support.price, breakoutIdx)) || emaCrossDown) &&
        closeB < support.price &&
        isSignificantLevel(support.price, 'bearish');

      if (!bullishBreakout && !bearishBreakout) continue;

      const bias = bullishBreakout ? 'bullish' : 'bearish';
      const levelPrice = bullishBreakout ? resistance.price : support.price;
      const levelIdxAbs = bullishBreakout ? resistance.index : support.index;

      // Cari SL basis: swing SEBELUM level ini kebentuk (kronologis lebih awal)
      const slBasisList = bullishBreakout
        ? swingLowsList.filter(s => s.index < levelIdxAbs)
        : swingHighsList.filter(s => s.index < levelIdxAbs);
      if (slBasisList.length === 0) continue; // gak ada swing sebelum level ini, skip
      const slBasisPrice = slBasisList[0]!.price; // paling BARU di antara yang sebelum level (list udah sorted recent-first)

      const nextIdx = breakoutIdx + 1;
      if (nextIdx > lastClosedIdx) continue;

      // Scan retest ke level (S/R, BUKAN EMA26)
      for (let retestIdx = nextIdx + 1; retestIdx <= lastClosedIdx; retestIdx++) {
        const c = m15.closes[retestIdx]!;
        const nearLevel = Math.abs(c - levelPrice) / levelPrice * 100 <= 0.3;
        if (!nearLevel) continue;

        const fiIdx = retestIdx - 1;
        const fiVal = forceIndexSeries[fiIdx];
        const fiPrev = forceIndexSeries[fiIdx - 1];
        if (fiVal === undefined || fiPrev === undefined) continue;
        const forceIndexOk = bias === 'bullish' ? fiVal < 0 : fiVal > 0;
        if (!forceIndexOk) continue;

        // Cek divergence: harga bikin low/high baru (retest) tapi Force Index
        // malah GAK ikut bikin low/high baru searah -- kalau kejadian, TOLAK.
        const fiWindow = forceIndexSeries.slice(nextIdx, fiIdx);
        const priceWindow = m15.closes.slice(nextIdx, retestIdx);
        let divergence = false;
        if (bias === 'bullish' && fiWindow.length > 0 && priceWindow.length > 0) {
          const priceMinBefore = Math.min(...priceWindow);
          const fiMinBefore = Math.min(...fiWindow.filter(v => v !== undefined) as number[]);
          if (c <= priceMinBefore && fiVal > fiMinBefore) divergence = true;
        } else if (bias === 'bearish' && fiWindow.length > 0 && priceWindow.length > 0) {
          const priceMaxBefore = Math.max(...priceWindow);
          const fiMaxBefore = Math.max(...fiWindow.filter(v => v !== undefined) as number[]);
          if (c >= priceMaxBefore && fiVal < fiMaxBefore) divergence = true;
        }
        if (divergence) continue;

        found = { breakoutIdx, retestIdx, levelPrice, levelIdxAbs, slBasisPrice, entryLevel: levelPrice, forceIndexValue: fiVal, bias };
        break;
      }
      if (found) break;
    }

    if (!found) {
      return {
        status: 'waiting', symbol, currentPrice, timestamp, mode: 'moneymagnetscalping',
        message: 'Belum ada breakout+retest M15 valid (level signifikan (>=2x reaksi jelas di H4), volume>=2.5x MA20, retest ke S/R dengan Force Index searah tanpa divergence) dalam 24 candle terakhir',
        maxScore, filterResults,
      };
    }

    // BARU (request user): RSI(14) D1 HARD FILTER -- gantiin trend gate H4
    // (EMA26) yang dihapus. Sama persis pola Sniper Breakout Skill 1 & Menu
    // Scalping: >=65 overbought tolak BUY, <=35 oversold tolak SELL,
    // 55-65/35-45 cuma label info.
    const bias = found.bias;
    const rsiD1 = calcRSI(d1.closes, 14);
    if (bias === 'bullish' && rsiD1 >= 65) {
      return {
        status: 'waiting', symbol, bias, currentPrice, timestamp, mode: 'moneymagnetscalping',
        message: `Breakout+retest M15 valid TAPI RSI D1 (${rsiD1.toFixed(1)}) udah OVERBOUGHT (>=65) — rawan pembalikan arah, sinyal BUY ditolak`,
        maxScore, filterResults: [`🚫 RSI D1 (BLOCK) — ${rsiD1.toFixed(1)} overbought (>=65), BUY ditolak`],
      };
    }
    if (bias === 'bearish' && rsiD1 <= 35) {
      return {
        status: 'waiting', symbol, bias, currentPrice, timestamp, mode: 'moneymagnetscalping',
        message: `Breakout+retest M15 valid TAPI RSI D1 (${rsiD1.toFixed(1)}) udah OVERSOLD (<=35) — rawan pembalikan arah, sinyal SELL ditolak`,
        maxScore, filterResults: [`🚫 RSI D1 (BLOCK) — ${rsiD1.toFixed(1)} oversold (<=35), SELL ditolak`],
      };
    }
    const rsiD1Label = bias === 'bullish'
      ? (rsiD1 >= 55 ? 'trend bullish sehat' : rsiD1 <= 45 ? 'lemah, hati-hati' : 'netral')
      : (rsiD1 <= 45 ? 'trend bearish sehat' : rsiD1 >= 55 ? 'lemah, hati-hati' : 'netral');

    filterResults.push(`✅ FASE 1 — Breakout+retest M15 valid @ ${found.levelPrice.toFixed(6)} (level signifikan (>=2x reaksi jelas di H4), volume>=2.5x MA20), retest ke S/R, Force Index ${found.forceIndexValue.toFixed(2)} searah ${bias}, TANPA divergence`);
    filterResults.push(`✅ RSI(14) D1 — ${rsiD1.toFixed(1)} (${rsiD1Label}), belum overbought/oversold`);

    // ═══ FASE 2: ENTRY SETUP ═════════════════════════════════════════════
    const dirMult = bias === 'bullish' ? 1 : -1;
    const entryPrice = found.entryLevel;

    const entryStillValid = bias === 'bullish' ? entryPrice <= currentPrice : entryPrice >= currentPrice;
    if (!entryStillValid) {
      return {
        status: 'waiting', symbol, currentPrice, timestamp, mode: 'moneymagnetscalping',
        message: `Breakout+retest udah basi — harga sekarang (${currentPrice.toFixed(6)}) udah ${bias === 'bullish' ? 'di bawah' : 'di atas'} level entry (${entryPrice.toFixed(6)})`,
        maxScore, filterResults,
      };
    }

    const stopLoss = entryPrice - calcATR(m15.highs, m15.lows, m15.closes) * 1.4 * dirMult; // SL 1.4x ATR M15 (TF eksekusi)
    const risk = Math.abs(entryPrice - stopLoss);
    if (risk <= 0) {
      return { status: 'no_setup', symbol, bias, currentPrice, timestamp, mode: 'moneymagnetscalping', message: 'Risk gak valid (entry & SL kelewat dekat)', maxScore, filterResults };
    }
    const takeProfit1 = entryPrice + risk * 2 * dirMult;
    const takeProfit2 = entryPrice + risk * 3 * dirMult;
    const rr1 = 2;

    filterResults.push(`✅ FASE 2 — Entry LIMIT @ ${entryPrice.toFixed(6)}, SL 1.4×ATR M15 @ ${stopLoss.toFixed(6)}, TP1 RR1:2 @ ${takeProfit1.toFixed(6)}, TP2 RR1:3 @ ${takeProfit2.toFixed(6)}`);

    const taProBonus = await checkTaProBonus(symbol, bias);

    return {
      status: 'in_zone', symbol, bias, currentPrice, timestamp, mode: 'moneymagnetscalping',
      maxScore, filterResults,
      entryPrice, stopLoss, takeProfit1, takeProfit2, rr1,
      moneyMagnetVariant: 'standard',
      forceIndexValue: found.forceIndexValue,
      magnetLevelUsed: 'broken_level',
      atr15MPct: (atrM15 / currentPrice) * 100,
      taProBonusConfirmed: taProBonus.confirmed, taProBonusClassification: taProBonus.classification, taProBonusScore: taProBonus.score,
      message: `SIAP PASANG ${bias === 'bullish' ? 'BUY' : 'SELL'} LIMIT di ${entryPrice.toFixed(6)} — breakout+retest M15 confirmed, RSI D1 ${rsiD1.toFixed(1)} (belum jenuh), Force Index ${found.forceIndexValue.toFixed(2)} tanpa divergence, RR 1:2/1:3.`,
    };
  } catch (err) {
    return {
      status: 'error', symbol, currentPrice: 0, timestamp, mode: 'moneymagnetscalping',
      message: err instanceof Error ? err.message : 'Unknown error',
      maxScore,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TECHNICAL ANALYSIS PRO -- FITUR 1: Identifikasi Tren (request user, fungsi
// BARU, terpisah dari Market Structure V2). Per TF pilihan user.
// BULLISH: swing H,L,HH,HL,HH + ADX 30-45(normal)/>45(strong) + Force Index
//          (EMA2) positif -- SEMUA wajib nyala
// BEARISH: swing H,L,LH,LL,LH + ADX 30-45(normal)/>45(strong) + Force Index
//          (EMA2) negatif -- SEMUA wajib nyala
// ═══════════════════════════════════════════════════════════════════════════

export interface TrendIdentificationResult {
  tf: TFLabelV2;
  classification: 'bullish' | 'bullish_strong' | 'bearish' | 'bearish_strong' | 'none';
  adx: number;
  forceIndexValue: number;
  swingPatternBullish: boolean;
  swingPatternBearish: boolean;
  reasoning: string[];
}

export function analyzeTrendIdentification(
  opens: number[], highs: number[], lows: number[], closes: number[], volumes: number[], tf: TFLabelV2
): TrendIdentificationResult {
  const reasoning: string[] = [];
  const atr = calcATR(highs, lows, closes);
  const fractal = MSV2_FRACTAL_STRENGTH[tf];
  const minDistAtr = MSV2_SWING_MIN_DIST_ATR[tf];

  const swingHighs = msv2FindSwingPoints(highs, true, fractal.left, fractal.right, atr, minDistAtr);
  const swingLows = msv2FindSwingPoints(lows, false, fractal.left, fractal.right, atr, minDistAtr);

  const adx = calcADXWithDI(highs, lows, closes, 14).adx;
  const forceIndexSeries = calcForceIndexSeries(closes, volumes);
  const forceIndexValue = forceIndexSeries[forceIndexSeries.length - 1] ?? 0;

  if (swingHighs.length < 3 || swingLows.length < 3) {
    reasoning.push('Data swing gak cukup (butuh minimal 3 swing high & 3 swing low)');
    return { tf, classification: 'none', adx, forceIndexValue, swingPatternBullish: false, swingPatternBearish: false, reasoning };
  }

  const h = swingHighs.slice(-3).map(s => s.price);
  const l = swingLows.slice(-2).map(s => s.price);
  const swingPatternBullish = h[2]! > h[1]! && h[1]! > h[0]! && l[1]! > l[0]!;
  const swingPatternBearish = h[2]! < h[1]! && h[1]! < h[0]! && l[1]! < l[0]!;

  reasoning.push(`Swing: H=[${h.map(v => v.toFixed(4)).join(',')}] L=[${l.map(v => v.toFixed(4)).join(',')}], pattern bullish=${swingPatternBullish}, bearish=${swingPatternBearish}`);
  reasoning.push(`ADX=${adx.toFixed(1)}, Force Index(EMA2)=${forceIndexValue.toFixed(2)}`);

  const bullishOk = swingPatternBullish && adx >= 30 && forceIndexValue > 0;
  const bearishOk = swingPatternBearish && adx >= 30 && forceIndexValue < 0;

  if (bullishOk) {
    const classification = adx > 45 ? 'bullish_strong' : 'bullish';
    reasoning.push(`Semua syarat BULLISH nyala (pattern+ADX>=30+FI positif) -> ${classification}${adx > 45 ? ' (ADX>45)' : ' (ADX 30-45)'}`);
    return { tf, classification, adx, forceIndexValue, swingPatternBullish, swingPatternBearish, reasoning };
  }
  if (bearishOk) {
    const classification = adx > 45 ? 'bearish_strong' : 'bearish';
    reasoning.push(`Semua syarat BEARISH nyala (pattern+ADX>=30+FI negatif) -> ${classification}${adx > 45 ? ' (ADX>45)' : ' (ADX 30-45)'}`);
    return { tf, classification, adx, forceIndexValue, swingPatternBullish, swingPatternBearish, reasoning };
  }

  reasoning.push('Gak ada trend yang TERKONFIRMASI penuh -> none');
  return { tf, classification: 'none', adx, forceIndexValue, swingPatternBullish, swingPatternBearish, reasoning };
}

// ═══════════════════════════════════════════════════════════════════════════
// TECHNICAL ANALYSIS PRO -- FITUR 2: Pembacaan Kondisi Market Multi TF
// (request user). 5 pair FIXED (gak pilih TF): D1->H4, H4->M30, H1->M15,
// H1->M5, M30->M5. Tiap pair py threshold ADX/FI/RSI(13) sendiri-sendiri
// sesuai spec, buat bullish DAN bearish.
// ═══════════════════════════════════════════════════════════════════════════

export interface MultiTFPairResult {
  pairLabel: string;
  triggered: boolean;
  direction: 'bullish' | 'bearish' | null;
  interpretation: string;
  higherTF: { tf: string; adx: number; forceIndexValue: number; rsi: number };
  lowerTF: { tf: string; adx: number; forceIndexValue: number; rsi: number };
}

interface TFSnapshot { adx: number; forceIndexValue: number; rsi: number; }

function tapSnapshot(opens: number[], highs: number[], lows: number[], closes: number[], volumes: number[]): TFSnapshot {
  const adx = calcADXWithDI(highs, lows, closes, 14).adx;
  const forceIndexSeries = calcForceIndexSeries(closes, volumes);
  const forceIndexValue = forceIndexSeries[forceIndexSeries.length - 1] ?? 0;
  const rsi = calcRSI(closes, 13);
  return { adx, forceIndexValue, rsi };
}

export async function analyzeMultiTFReading(symbol: string): Promise<MultiTFPairResult[]> {
  const [d1, h4, h1, m30, m15, m5] = await Promise.all([
    fetchKlines(symbol, '1d', 100),
    fetchKlines(symbol, '4h', 100),
    fetchKlines(symbol, '1h', 100),
    fetchKlines(symbol, '30m', 100),
    fetchKlines(symbol, '15m', 100),
    fetchKlines(symbol, '5m', 100),
  ]);

  const snap = (k: KlineData) => tapSnapshot(k.opens, k.highs, k.lows, k.closes, k.volumes);
  const sD1 = snap(d1), sH4 = snap(h4), sH1 = snap(h1), sM30 = snap(m30), sM15 = snap(m15), sM5 = snap(m5);

  const results: MultiTFPairResult[] = [];

  // ── D1 -> H4 ──────────────────────────────────────────────────────────
  {
    const bullish = sD1.adx > 45 && sD1.forceIndexValue > 0 && sD1.rsi > 55 &&
      sH4.adx >= 25 && sH4.adx <= 45 && sH4.forceIndexValue < 0 && sH4.rsi < 30;
    const bearish = sD1.adx > 45 && sD1.forceIndexValue < 0 && sD1.rsi < 45 &&
      sH4.adx >= 25 && sH4.adx <= 45 && sH4.forceIndexValue > 0 && sH4.rsi > 70;
    results.push({
      pairLabel: 'D1 → H4', triggered: bullish || bearish, direction: bullish ? 'bullish' : bearish ? 'bearish' : null,
      interpretation: bullish ? 'Tren naik dominan (D1), koreksi sementara di H4 — peluang bounce buy di support'
        : bearish ? 'Tren turun dominan (D1), koreksi sementara di H4 — peluang bounce sell di resistance' : '-',
      higherTF: { tf: 'D1', ...sD1 }, lowerTF: { tf: 'H4', ...sH4 },
    });
  }

  // ── H4 -> M30 ─────────────────────────────────────────────────────────
  {
    const bullish = sH4.adx > 25 && sH4.forceIndexValue > 0 && sH4.rsi > 55 &&
      sM30.adx >= 20 && sM30.adx <= 30 && sM30.forceIndexValue < 0 && sM30.rsi < 30;
    const bearish = sH4.adx > 25 && sH4.forceIndexValue < 0 && sH4.rsi < 45 &&
      sM30.adx >= 20 && sM30.adx <= 30 && sM30.forceIndexValue > 0 && sM30.rsi > 70;
    results.push({
      pairLabel: 'H4 → M30', triggered: bullish || bearish, direction: bullish ? 'bullish' : bearish ? 'bearish' : null,
      interpretation: bullish ? 'Tren naik valid (H4), koreksi intraday di M30 — peluang entry buy di support minor'
        : bearish ? 'Tren turun valid (H4), koreksi intraday di M30 — peluang entry sell di resistance minor' : '-',
      higherTF: { tf: 'H4', ...sH4 }, lowerTF: { tf: 'M30', ...sM30 },
    });
  }

  // ── H1 -> M15 (continuation, bukan koreksi) ──────────────────────────
  {
    const bullish = sH1.adx > 25 && sH1.forceIndexValue > 0 && sH1.rsi > 55 &&
      sM15.adx > 25 && sM15.forceIndexValue > 0 && sM15.rsi > 55;
    const bearish = sH1.adx > 25 && sH1.forceIndexValue < 0 && sH1.rsi < 45 &&
      sM15.adx > 25 && sM15.forceIndexValue < 0 && sM15.rsi < 45;
    results.push({
      pairLabel: 'H1 → M15', triggered: bullish || bearish, direction: bullish ? 'bullish' : bearish ? 'bearish' : null,
      interpretation: bullish ? 'Tren intraday naik (H1), kalau breakout M15 valid bullish — tren intraday kuat'
        : bearish ? 'Tren intraday turun (H1), kalau breakout M15 valid bearish — tren intraday kuat' : '-',
      higherTF: { tf: 'H1', ...sH1 }, lowerTF: { tf: 'M15', ...sM15 },
    });
  }

  // ── H1 -> M5 ──────────────────────────────────────────────────────────
  {
    const bullish = sH1.adx > 30 && sH1.forceIndexValue > 0 && sH1.rsi > 55 &&
      sM5.adx >= 20 && sM5.adx <= 25 && sM5.forceIndexValue < 0 && sM5.rsi < 30;
    const bearish = sH1.adx > 30 && sH1.forceIndexValue < 0 && sH1.rsi < 45 &&
      sM5.adx >= 20 && sM5.adx <= 25 && sM5.forceIndexValue > 0 && sM5.rsi > 70;
    results.push({
      pairLabel: 'H1 → M5', triggered: bullish || bearish, direction: bullish ? 'bullish' : bearish ? 'bearish' : null,
      interpretation: bullish ? 'Tren naik dominan (H1), koreksi kecil di M5 — peluang sniper buy di support dekat'
        : bearish ? 'Tren turun dominan (H1), koreksi kecil di M5 — peluang sniper sell di resistance dekat' : '-',
      higherTF: { tf: 'H1', ...sH1 }, lowerTF: { tf: 'M5', ...sM5 },
    });
  }

  // ── M30 -> M5 (continuation) ─────────────────────────────────────────
  {
    const bullish = sM30.adx > 25 && sM30.forceIndexValue > 0 && sM30.rsi > 55 &&
      sM5.adx > 25 && sM5.forceIndexValue > 0 && sM5.rsi > 55;
    const bearish = sM30.adx > 25 && sM30.forceIndexValue < 0 && sM30.rsi < 45 &&
      sM5.adx > 25 && sM5.forceIndexValue < 0 && sM5.rsi < 45;
    results.push({
      pairLabel: 'M30 → M5', triggered: bullish || bearish, direction: bullish ? 'bullish' : bearish ? 'bearish' : null,
      interpretation: bullish ? 'Tren naik valid (M30), kalau breakout micro M5 bullish — cocok scalping buy'
        : bearish ? 'Tren turun valid (M30), kalau breakout micro M5 bearish — cocok scalping sell' : '-',
      higherTF: { tf: 'M30', ...sM30 }, lowerTF: { tf: 'M5', ...sM5 },
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// TECHNICAL ANALYSIS PRO -- FITUR 4: Filter Breakout & Bounce area SNR
// (request user). Per TF pilihan. 4 kategori: False Breakout, Breakout tren
// kuat, Bounce kuat, Bounce lemah.
// ═══════════════════════════════════════════════════════════════════════════

export interface BreakoutBounceResult {
  tf: TFLabelV2;
  category: 'false_breakout' | 'strong_breakout' | 'strong_bounce' | 'weak_bounce' | 'none';
  interpretation: string;
  adx: number;
  forceIndexValue: number;
  volumeRatio: number;
  rsi: number;
  nearSnr: boolean;
  snrLevel: number | null;
  snrType: 'support' | 'resistance' | null;
  reasoning: string[];
}

export function analyzeBreakoutBounceFilter(
  opens: number[], highs: number[], lows: number[], closes: number[], volumes: number[], tf: TFLabelV2
): BreakoutBounceResult {
  const reasoning: string[] = [];
  const atr = calcATR(highs, lows, closes);
  const fractal = MSV2_FRACTAL_STRENGTH[tf];
  const minDistAtr = MSV2_SWING_MIN_DIST_ATR[tf];

  const swingHighs = msv2FindSwingPoints(highs, true, fractal.left, fractal.right, atr, minDistAtr);
  const swingLows = msv2FindSwingPoints(lows, false, fractal.left, fractal.right, atr, minDistAtr);

  const adx = calcADXWithDI(highs, lows, closes, 14).adx;
  const forceIndexSeries = calcForceIndexSeries(closes, volumes);
  const forceIndexValue = forceIndexSeries[forceIndexSeries.length - 1] ?? 0;
  const rsi = calcRSI(closes, 13);
  const lastIdx = closes.length - 2;
  const volMa20 = calcSMA(volumes.slice(0, lastIdx + 1), 20);
  const volumeRatio = volMa20 > 0 ? volumes[lastIdx]! / volMa20 : 0;
  const currentClose = closes[lastIdx]!;

  if (swingHighs.length === 0 || swingLows.length === 0) {
    reasoning.push('Belum ada swing high/low buat cari level SNR');
    return { tf, category: 'none', interpretation: '-', adx, forceIndexValue, volumeRatio, rsi, nearSnr: false, snrLevel: null, snrType: null, reasoning };
  }

  const resistance = swingHighs[swingHighs.length - 1]!;
  const support = swingLows[swingLows.length - 1]!;
  const distToRes = Math.abs(currentClose - resistance.price) / resistance.price * 100;
  const distToSup = Math.abs(currentClose - support.price) / support.price * 100;
  const nearRes = distToRes <= 0.3;
  const nearSup = distToSup <= 0.3;
  const nearSnr = nearRes || nearSup;
  const snrLevel = nearRes ? resistance.price : nearSup ? support.price : null;
  const snrType: 'support' | 'resistance' | null = nearRes ? 'resistance' : nearSup ? 'support' : null;

  const brokeResistance = currentClose > resistance.price;
  const brokeSupport = currentClose < support.price;
  const brokeAny = brokeResistance || brokeSupport;
  const forceIndexSearahTren = (brokeResistance && forceIndexValue > 0) || (brokeSupport && forceIndexValue < 0);

  reasoning.push(`ADX=${adx.toFixed(1)}, FI=${forceIndexValue.toFixed(2)}, volRatio=${volumeRatio.toFixed(2)}x, RSI(13)=${rsi.toFixed(1)}, dekat SNR=${nearSnr} (${snrType ?? 'n/a'})`);

  // Breakout tren kuat: ADX>25, FI searah, volume>=2x MA20, harga tembus SNR
  if (brokeAny && adx > 25 && forceIndexSearahTren && volumeRatio >= 2.0) {
    reasoning.push('ADX>25 + FI searah + volume>=2x MA20 + tembus SNR -> Breakout tren kuat');
    return { tf, category: 'strong_breakout', interpretation: 'Tren valid, level ditembus', adx, forceIndexValue, volumeRatio, rsi, nearSnr, snrLevel, snrType, reasoning };
  }

  // False Breakout: ADX<25, FI searah tapi volume lemah, tembus tipis
  if (brokeAny && adx < 25 && forceIndexSearahTren && volumeRatio < 2.0) {
    reasoning.push('ADX<25 + FI searah tapi volume lemah + tembus tipis -> False Breakout');
    return { tf, category: 'false_breakout', interpretation: 'Sering gagal, harga balik lagi ke range', adx, forceIndexValue, volumeRatio, rsi, nearSnr, snrLevel, snrType, reasoning };
  }

  // Bounce kuat: ADX 20-30, FI berlawanan arah tren besar, harga TEPAT di SNR,
  // RSI oversold(<40) di support / overbought(>60) di resistance
  if (nearSnr && adx >= 20 && adx <= 30) {
    const bounceAtSupport = snrType === 'support' && forceIndexValue > 0 && rsi < 40;
    const bounceAtResistance = snrType === 'resistance' && forceIndexValue < 0 && rsi > 60;
    if (bounceAtSupport || bounceAtResistance) {
      reasoning.push('ADX 20-30 + FI berlawanan tren besar + tepat di SNR + RSI ekstrem -> Bounce kuat');
      return { tf, category: 'strong_bounce', interpretation: 'Koreksi valid, harga mantul dari level', adx, forceIndexValue, volumeRatio, rsi, nearSnr, snrLevel, snrType, reasoning };
    }
  }

  // Bounce lemah: ADX<20, FI dekat 0, harga mendekati SNR, RSI 45-55 (netral)
  const fiAvgAbs = forceIndexSeries.slice(-20).filter((v): v is number => v !== undefined).reduce((a, b) => a + Math.abs(b), 0) / Math.max(1, forceIndexSeries.slice(-20).length);
  const fiNearZero = Math.abs(forceIndexValue) < fiAvgAbs * 0.2;
  if (nearSnr && adx < 20 && fiNearZero && rsi >= 45 && rsi <= 55) {
    reasoning.push('ADX<20 + FI dekat 0 + mendekati SNR + RSI netral -> Bounce lemah');
    return { tf, category: 'weak_bounce', interpretation: 'Pasar sideways, level cenderung memantul sebentar', adx, forceIndexValue, volumeRatio, rsi, nearSnr, snrLevel, snrType, reasoning };
  }

  reasoning.push('Gak masuk kategori manapun');
  return { tf, category: 'none', interpretation: '-', adx, forceIndexValue, volumeRatio, rsi, nearSnr, snrLevel, snrType, reasoning };
}

// ═══════════════════════════════════════════════════════════════════════════
// TECHNICAL ANALYSIS PRO -- FITUR 5: Skor Long vs Short (REVISI TOTAL request
// user -- sekarang TERHUBUNG ke breakout M15, pakai logic deteksi breakout
// YANG SAMA kayak Sniper Breakout skill 1 FASE 1: swing M15 fresh, volume
// >=2x MA20, scan-back 26 candle. Kalau lagi GAK ADA breakout M15 valid,
// Fitur 5 gak bisa ngasih skor (status 'no_breakout').
//
// FORMULA POIN BARU (request user):
//   ADX H1 >=40         : +2      ADX D1 >=40        : +2
//   ADX H1 26-40        : -1      ADX D1 <40         : 0
//   ADX H1 <26          : 0       ADX H4             : TIDAK dipakai (0 selalu)
//
//   Force Index H4 searah breakout : +2
//   Force Index H1 searah breakout : +1
//   Force Index D1                 : TIDAK dipakai
//   (searah = POSITIF buat breakout resistance/bullish, NEGATIF buat
//    breakout support/bearish)
//
//   RSI H1 searah breakout (>50 bullish, <50 bearish) : +1
//   RSI D1 > 60 (arah breakout TIDAK ngaruh)           : +2
//   RSI H4                                             : TIDAK dipakai
//
//   PENALTI: ADX H1 < 20 DAN ADX H4 < 20 bersamaan     : -1
//
//   BONUS BTC: BTC dicek breakout M15-nya SENDIRI (logic sama). Kalau BTC
//   lagi breakout DAN arahnya SEARAH breakout koin yang dianalisa -> +1.
//   Kalau BTC lagi GAK breakout, atau breakout tapi arahnya beda -> +0
//   (gak ada penalti, cuma gak dapet bonus).
//
//   KLASIFIKASI: skor >=5 -> "Kuat", skor <5 -> "Lemah" (arah ngikut arah
//   breakout: bullish=LONG, bearish=SHORT).
// ═══════════════════════════════════════════════════════════════════════════

export interface LongShortScoreResult {
  status: 'ok' | 'no_breakout';
  breakoutDirection: 'bullish' | 'bearish' | null;
  brokenLevel: number | null;
  score: number;
  classification: 'Long Kuat' | 'Long Lemah' | 'Short Kuat' | 'Short Lemah' | null;
  breakdown: string[];
  btcBreakoutDirection: 'bullish' | 'bearish' | null;
  btcSearah: boolean;
  reasoning: string[];
}

const TAP2_RSI_D1_BONUS_THRESHOLD = 60;
const TAP2_ADX_H1_STRONG = 40;
const TAP2_ADX_H1_MID = 26;
const TAP2_ADX_D1_STRONG = 40;
const TAP2_ADX_WEAK_PENALTY_THRESHOLD = 20;
const TAP2_KUAT_THRESHOLD = 5;

/**
 * Deteksi breakout M15 fresh -- PERSIS logic FASE 1 Sniper Breakout skill 1
 * (analyzeCounterStructural): swing fractal 2-2, volume>=2x MA20, scan-back
 * 26 candle, belum tersentuh lagi sejak breakout. Dipake bareng buat koin
 * yang dianalisa DAN buat BTC (bonus correlation).
 */
function tap2DetectM15Breakout(
  highs: number[], lows: number[], closes: number[], volumes: number[]
): { bias: 'bullish' | 'bearish'; brokenLevel: number } | null {
  const atrM15 = calcATR(highs, lows, closes);
  if (atrM15 <= 0) return null;

  const lastClosedIdx = closes.length - 2;
  const swingLookback = 30;
  const swingSlice = Math.max(0, lastClosedIdx - swingLookback - 26);
  const swingFractal = 2;

  const findFreshSwing = (idx: number): { high: { idx: number; price: number } | null; low: { idx: number; price: number } | null } => {
    let high: { idx: number; price: number } | null = null;
    let low: { idx: number; price: number } | null = null;
    for (let i = idx - swingFractal; i >= Math.max(swingFractal, idx - swingLookback); i--) {
      if (i - swingFractal < 0 || i + swingFractal >= highs.length) continue;
      const isHigh = [1, 2].every(k => highs[i]! > highs[i - k]!) && [1, 2].every(k => highs[i]! > highs[i + k]!);
      const isLow = [1, 2].every(k => lows[i]! < lows[i - k]!) && [1, 2].every(k => lows[i]! < lows[i + k]!);
      if (isHigh && !high) high = { idx: i, price: highs[i]! };
      if (isLow && !low) low = { idx: i, price: lows[i]! };
      if (high && low) break;
    }
    return { high, low };
  };

  const isFreshUntouched = (swingIdx: number, level: number, checkUntilIdx: number, tol: number): boolean => {
    for (let i = swingIdx + 1; i < checkUntilIdx; i++) {
      const h = highs[i]!, l = lows[i]!;
      if (Math.abs(h - level) <= tol || Math.abs(l - level) <= tol || (l <= level && h >= level)) return false;
    }
    return true;
  };

  for (let breakoutIdx = lastClosedIdx; breakoutIdx >= Math.max(swingSlice + 5, lastClosedIdx - 26); breakoutIdx--) {
    const swings = findFreshSwing(breakoutIdx);
    const volMa20 = calcSMA(volumes.slice(0, breakoutIdx + 1), 20);
    if (volMa20 <= 0) continue;
    const volRatio = volumes[breakoutIdx]! / volMa20;
    if (volRatio < 2.0) continue;

    const tol = atrM15 * 0.1;
    const bullishBreakout = swings.high && breakoutIdx > swings.high.idx &&
      closes[breakoutIdx]! > swings.high.price &&
      isFreshUntouched(swings.high.idx, swings.high.price, breakoutIdx, tol);
    const bearishBreakout = swings.low && breakoutIdx > swings.low.idx &&
      closes[breakoutIdx]! < swings.low.price &&
      isFreshUntouched(swings.low.idx, swings.low.price, breakoutIdx, tol);

    if (!bullishBreakout && !bearishBreakout) continue;

    // Belum retest (fresh sejak breakoutIdx sampai sekarang)
    const bias: 'bullish' | 'bearish' = bullishBreakout ? 'bullish' : 'bearish';
    const brokenLevel = bullishBreakout ? swings.high!.price : swings.low!.price;
    const stillFresh = isFreshUntouched(breakoutIdx, brokenLevel, lastClosedIdx + 1, tol);
    if (!stillFresh) continue;

    return { bias, brokenLevel };
  }
  return null;
}

/** Hitung skor Fitur 5 (formula baru) buat 1 koin yang UDAH KETAHUAN arah breakout-nya. */
function tap2ScoreForBreakout(
  breakoutBias: 'bullish' | 'bearish',
  h1: { highs: number[]; lows: number[]; closes: number[]; volumes: number[] },
  h4: { highs: number[]; lows: number[]; closes: number[]; volumes: number[] },
  d1: { highs: number[]; lows: number[]; closes: number[]; volumes: number[] },
): { score: number; breakdown: string[] } {
  const breakdown: string[] = [];
  let score = 0;

  const adxH1 = calcADXWithDI(h1.highs, h1.lows, h1.closes, 14).adx;
  const adxH4 = calcADXWithDI(h4.highs, h4.lows, h4.closes, 14).adx;
  const adxD1 = calcADXWithDI(d1.highs, d1.lows, d1.closes, 14).adx;
  const fiH1Series = calcForceIndexSeries(h1.closes, h1.volumes);
  const fiH1 = fiH1Series[fiH1Series.length - 1] ?? 0;
  const fiH4Series = calcForceIndexSeries(h4.closes, h4.volumes);
  const fiH4 = fiH4Series[fiH4Series.length - 1] ?? 0;
  const rsiH1 = calcRSI(h1.closes, 13);
  const rsiD1 = calcRSI(d1.closes, 13);

  // ADX H1
  let adxH1Pts = 0;
  if (adxH1 >= TAP2_ADX_H1_STRONG) adxH1Pts = 2;
  else if (adxH1 >= TAP2_ADX_H1_MID) adxH1Pts = -1;
  score += adxH1Pts;
  breakdown.push(`ADX H1 ${adxH1.toFixed(1)} -> ${adxH1Pts >= 0 ? '+' : ''}${adxH1Pts} poin`);

  // ADX D1
  const adxD1Pts = adxD1 >= TAP2_ADX_D1_STRONG ? 2 : 0;
  score += adxD1Pts;
  breakdown.push(`ADX D1 ${adxD1.toFixed(1)} -> +${adxD1Pts} poin`);

  breakdown.push(`ADX H4 ${adxH4.toFixed(1)} -> +0 poin (gak dipakai)`);

  // Force Index H4 (searah breakout)
  const fiH4Searah = breakoutBias === 'bullish' ? fiH4 > 0 : fiH4 < 0;
  const fiH4Pts = fiH4Searah ? 2 : 0;
  score += fiH4Pts;
  breakdown.push(`Force Index H4 ${fiH4.toFixed(2)} (${fiH4Searah ? 'searah' : 'gak searah'}) -> +${fiH4Pts} poin`);

  // Force Index H1 (searah breakout)
  const fiH1Searah = breakoutBias === 'bullish' ? fiH1 > 0 : fiH1 < 0;
  const fiH1Pts = fiH1Searah ? 1 : 0;
  score += fiH1Pts;
  breakdown.push(`Force Index H1 ${fiH1.toFixed(2)} (${fiH1Searah ? 'searah' : 'gak searah'}) -> +${fiH1Pts} poin`);

  // RSI H1 (searah breakout: >50 bullish, <50 bearish)
  const rsiH1Searah = breakoutBias === 'bullish' ? rsiH1 > 50 : rsiH1 < 50;
  const rsiH1Pts = rsiH1Searah ? 1 : 0;
  score += rsiH1Pts;
  breakdown.push(`RSI H1 ${rsiH1.toFixed(1)} (${rsiH1Searah ? 'searah' : 'gak searah'}) -> +${rsiH1Pts} poin`);

  // RSI D1 > 60 (arah breakout gak ngaruh)
  const rsiD1Pts = rsiD1 > TAP2_RSI_D1_BONUS_THRESHOLD ? 2 : 0;
  score += rsiD1Pts;
  breakdown.push(`RSI D1 ${rsiD1.toFixed(1)} (>${TAP2_RSI_D1_BONUS_THRESHOLD}? ${rsiD1 > TAP2_RSI_D1_BONUS_THRESHOLD}) -> +${rsiD1Pts} poin`);

  // Penalti: ADX H1 < 20 DAN ADX H4 < 20 bersamaan
  const bothWeak = adxH1 < TAP2_ADX_WEAK_PENALTY_THRESHOLD && adxH4 < TAP2_ADX_WEAK_PENALTY_THRESHOLD;
  const penaltyPts = bothWeak ? -1 : 0;
  score += penaltyPts;
  if (bothWeak) breakdown.push(`PENALTI -- ADX H1 (${adxH1.toFixed(1)}) & ADX H4 (${adxH4.toFixed(1)}) sama-sama <20 -> -1 poin`);

  return { score, breakdown };
}

export async function analyzeLongShortScore(symbol: string): Promise<LongShortScoreResult> {
  const m15 = await fetchKlines(symbol, '15m', 150);
  const breakout = tap2DetectM15Breakout(m15.highs, m15.lows, m15.closes, m15.volumes);

  if (!breakout) {
    return {
      status: 'no_breakout', breakoutDirection: null, brokenLevel: null,
      score: 0, classification: null, breakdown: [],
      btcBreakoutDirection: null, btcSearah: false,
      reasoning: ['Gak ada breakout M15 fresh (swing+volume>=2x MA20) buat koin ini saat ini -- Fitur 5 butuh breakout aktif buat ngitung skor.'],
    };
  }

  const [h1, h4, d1] = await Promise.all([
    fetchKlines(symbol, '1h', 100),
    fetchKlines(symbol, '4h', 100),
    fetchKlines(symbol, '1d', 100),
  ]);

  const { score: baseScore, breakdown } = tap2ScoreForBreakout(breakout.bias, h1, h4, d1);

  // Bonus BTC correlation
  let btcBreakoutDirection: 'bullish' | 'bearish' | null = null;
  let btcSearah = false;
  let btcPts = 0;
  if (symbol !== 'BTCUSDT') {
    try {
      const btcM15 = await fetchKlines('BTCUSDT', '15m', 150);
      const btcBreakout = tap2DetectM15Breakout(btcM15.highs, btcM15.lows, btcM15.closes, btcM15.volumes);
      if (btcBreakout) {
        btcBreakoutDirection = btcBreakout.bias;
        btcSearah = btcBreakout.bias === breakout.bias;
        btcPts = btcSearah ? 1 : 0;
      }
    } catch {
      // fail-safe -- BTC gagal fetch, +0 default, gak nge-block skor utama
    }
  }
  breakdown.push(
    btcBreakoutDirection === null
      ? `BTC -- gak lagi breakout M15 -> +0 poin`
      : `BTC breakout ${btcBreakoutDirection} (${btcSearah ? 'SEARAH' : 'gak searah'}) -> +${btcPts} poin`
  );

  const totalScore = baseScore + btcPts;
  const dirLabel = breakout.bias === 'bullish' ? 'Long' : 'Short';
  const classification: LongShortScoreResult['classification'] =
    totalScore >= TAP2_KUAT_THRESHOLD ? `${dirLabel} Kuat` as const : `${dirLabel} Lemah` as const;

  const reasoning = [
    `Breakout M15 ${breakout.bias} @ ${breakout.brokenLevel.toFixed(6)}`,
    `Skor total: ${totalScore} (${breakdown.join(', ')})`,
    `Klasifikasi: ${classification}`,
  ];

  return {
    status: 'ok', breakoutDirection: breakout.bias, brokenLevel: breakout.brokenLevel,
    score: totalScore, classification, breakdown,
    btcBreakoutDirection, btcSearah, reasoning,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// BONUS CROSS-MENU (request user): dipanggil dari semua fungsi sinyal
// (Sniper Breakout, Money Magnet, dll) SETELAH sinyal ketemu -- cek apa bias
// sinyal itu SEARAH sama Fitur 5 (Skor Long vs Short) Technical Analysis
// PRO. Gak pernah nge-block sinyal (murni info/badge tambahan). Kalau gagal
// fetch/analisa, atau Fitur 5 lagi 'no_breakout' (gak applicable), fail-safe
// ke "gak ada bonus".
// ═══════════════════════════════════════════════════════════════════════════
async function checkTaProBonus(
  symbol: string, bias: 'bullish' | 'bearish'
): Promise<{ confirmed: boolean; classification: string | null; score: number }> {
  try {
    const taPro = await analyzeLongShortScore(symbol);
    if (taPro.status !== 'ok' || taPro.breakoutDirection === null) {
      return { confirmed: false, classification: null, score: 0 };
    }
    const confirmed = taPro.breakoutDirection === bias;
    return {
      confirmed,
      classification: confirmed ? taPro.classification : null,
      score: confirmed ? taPro.score : 0,
    };
  } catch {
    return { confirmed: false, classification: null, score: 0 };
  }
}
