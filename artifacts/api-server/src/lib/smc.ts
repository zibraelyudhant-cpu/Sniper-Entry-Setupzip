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

function calcMACD(closes: number[]): MACDResult {
  if (closes.length < 35) return { macd: 0, signal: 0, histogram: 0, histogramExpanding: false };
  const ema12 = calcEMASeries(closes, 12);
  const ema26 = calcEMASeries(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]!);
  const signalLine = calcEMASeries(macdLine, 9);
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
 * Fungsi utama Market Structure V2 — jalanin semua 8 layer + two-pass
 * adaptive candle count (request user). `opens` WAJIB dikasih (dipake Layer
 * 4D wick dominance) — beda dari kebanyakan fungsi lain di file ini yang
 * cuma butuh highs/lows/closes.
 */
export function analyzeMarketStructureV2(
  fullOpens: number[], fullHighs: number[], fullLows: number[], fullCloses: number[],
  tf: TFLabelV2
): MarketStructureV2Result {
  const runPass = (candleCount: number): MarketStructureV2Result => {
    const cc = Math.min(candleCount, fullCloses.length);
    const opens = fullOpens.slice(-cc), highs = fullHighs.slice(-cc), lows = fullLows.slice(-cc), closes = fullCloses.slice(-cc);
    const reasoning: string[] = [];
    const atr = calcATR(highs, lows, closes);
    const fractal = MSV2_FRACTAL_STRENGTH[tf];
    const minDistAtr = MSV2_SWING_MIN_DIST_ATR[tf];

    const swingHighs = msv2FindSwingPoints(highs, true, fractal.left, fractal.right, atr, minDistAtr);
    const swingLows = msv2FindSwingPoints(lows, false, fractal.left, fractal.right, atr, minDistAtr);

    if (swingHighs.length < 3 || swingLows.length < 3) {
      reasoning.push('Data swing gak cukup (butuh minimal 3 swing high & 3 swing low tervalidasi)');
      return {
        classification: 'transition', bias: 'sideways', bullishTotal: 0, bearishTotal: 0, sidewaysTotal: 0,
        structureBullishScore: 0, structureBearishScore: 0, breakQualityLabel: 'data kurang', breakQualityPoints: 0,
        bullishRetraceScore: 0, bearishReboundScore: 0, rangePosition: 0.5, candleCountUsed: cc, passes: 1, reasoning,
      };
    }

    const { bullishScore: structureBullishScore, bearishScore: structureBearishScore } = msv2ScoreStructureDirection(swingHighs, swingLows);
    reasoning.push(`Structure score: bullish=${structureBullishScore}/6, bearish=${structureBearishScore}/6`);

    const followATR = MSV2_BREAK_FOLLOWTHROUGH_ATR[tf];
    const recentBreaks = msv2FindRecentBreaks(closes, swingHighs, swingLows, 5);
    const breakQuality = msv2ScoreBreakQuality(recentBreaks, highs, lows, closes, atr, followATR);
    reasoning.push(`Break quality: ${breakQuality.validCount}/${breakQuality.totalChecked} valid (${breakQuality.label})`);

    const minorBreaks = msv2FindRecentBreaks(closes, swingHighs, swingLows, 10);
    const sideways = msv2ScoreSideways(highs, lows, closes, opens, minorBreaks);
    reasoning.push(`Sideways score: ${sideways.total}/9 (failure=${sideways.failureScore}, overlap=${sideways.overlapScore}, midrange=${sideways.midrangeScore}, wick=${sideways.wickScore})`);

    const currentPrice = closes[closes.length - 1]!;
    const bullishRetraceScore = msv2ScoreImpulseRetrace(swingHighs, swingLows, currentPrice, 'bullish');
    const bearishReboundScore = msv2ScoreImpulseRetrace(swingHighs, swingLows, currentPrice, 'bearish');

    const position = msv2ScorePosition(highs, lows, closes, Math.min(cc, 50));
    const maConfluence = msv2ScoreMaConfluence(closes);

    const bullishTotal = structureBullishScore + breakQuality.points + bullishRetraceScore + position.bullishBonus;
    const bearishTotal = structureBearishScore + breakQuality.points + bearishReboundScore + position.bearishBonus;
    const sidewaysTotal = sideways.total;
    const diff = bullishTotal - bearishTotal;

    let classification: MarketStructureV2Result['classification'];
    let bias: 'bullish' | 'bearish' | 'sideways';

    // FIX (ketemu user, test statistik 358 window): threshold "sidewaysTotal
    // <= 3" itu SECARA PRAKTIS gak pernah tercapai (0.3% window, dari yang
    // seharusnya bisa strong dari harga naik/turun >20%) — dinaikkan ke <=5,
    // konsisten sama threshold "weak" yang udah ada di baris 1381/1383.
    // GATE TAMBAHAN (insight altFINS, request user): "strong" sekarang JUGA
    // wajib MA confluence >=2/4 (price>SMA5>SMA10>SMA20 + RSI>50 searah
    // bias) — cross-validation independen dari swing-based scoring, gak
    // masuk ke bullishTotal/bearishTotal (tervalidasi: kalau masuk score,
    // "transition" ikut naik, efek samping gak diinginkan). Sebagai gate
    // terpisah, distribusi transition/sideways/weak PERSIS SAMA, cuma
    // "strong" jadi sedikit lebih ketat/genuinely terkonfirmasi.
    if (bullishTotal >= 8 && diff >= 3 && sidewaysTotal <= 5 && maConfluence.bullishRaw >= 2) {
      classification = 'bullish_strong'; bias = 'bullish';
    } else if (bearishTotal >= 8 && -diff >= 3 && sidewaysTotal <= 5 && maConfluence.bearishRaw >= 2) {
      classification = 'bearish_strong'; bias = 'bearish';
    } else if ((bullishTotal >= 6 && sidewaysTotal > 5) || (bearishTotal >= 6 && sidewaysTotal > 5)) {
      classification = 'transition'; bias = 'sideways'; // total trend lumayan tapi sideways JUGA tinggi = ambigu
    } else if (sidewaysTotal >= 6 || Math.abs(diff) <= 2 || (bullishTotal < 6 && bearishTotal < 6)) {
      classification = 'sideways'; bias = 'sideways';
    } else if (bullishTotal >= 6 && diff > 0 && sidewaysTotal <= 5) {
      classification = 'bullish_weak'; bias = 'bullish';
    } else if (bearishTotal >= 6 && diff < 0 && sidewaysTotal <= 5) {
      classification = 'bearish_weak'; bias = 'bearish';
    } else {
      classification = 'transition'; bias = 'sideways';
    }

    reasoning.push(`Final: bullish_total=${bullishTotal}, bearish_total=${bearishTotal}, sideways_total=${sidewaysTotal} → ${classification}`);

    return {
      classification, bias, bullishTotal, bearishTotal, sidewaysTotal,
      structureBullishScore, structureBearishScore,
      breakQualityLabel: breakQuality.label, breakQualityPoints: breakQuality.points,
      bullishRetraceScore, bearishReboundScore, rangePosition: position.rangePosition,
      candleCountUsed: cc, passes: 1, reasoning,
    };
  };

  const baseCount = MSV2_BASE_CANDLE_COUNT[tf];
  const pass1 = runPass(baseCount);

  // Two-pass adaptive (request user): kalau hasil pass 1 ekstrem, re-run pakai
  // candle count yang disesuaikan biar lebih presisi.
  let adjustedCount: number | null = null;
  if (pass1.sidewaysTotal >= 8) {
    adjustedCount = Math.round(baseCount * 1.30); // sideways kuat
  } else if (
    (pass1.classification === 'bullish_strong' && pass1.bullishTotal - pass1.bearishTotal >= 5) ||
    (pass1.classification === 'bearish_strong' && pass1.bearishTotal - pass1.bullishTotal >= 5)
  ) {
    adjustedCount = Math.round(baseCount * 0.75); // trend sangat kuat
  }

  if (adjustedCount !== null && adjustedCount !== baseCount && fullCloses.length >= Math.min(adjustedCount, fullCloses.length)) {
    const pass2 = runPass(adjustedCount);
    pass2.passes = 2;
    pass2.reasoning.unshift(`Pass 1 (${baseCount} candle) → ${pass1.classification}, re-run pass 2 pakai ${adjustedCount} candle buat presisi`);
    return pass2;
  }

  return pass1;
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

// ─── BTC Correlation Filter ─────────────────────────────────────────────────
// BTC dump/pump sering nyeret SEMUA altcoin ikut (cascading liquidation cross-margin,
// panic sell/FOMO, market maker re-hedge) — ini efek makro, BUKAN soal analisa
// teknikal koin itu sendiri salah. Sinyal yang SEARAH BTC lebih aman; sinyal yang
// LAWAN ARAH BTC beresiko lebih tinggi ke-tarik gerakan BTC walau setup-nya sendiri
// valid. Ini bukan hard-skip — cuma warning + sedikit penyesuaian confidence,
// karena BTC bisa aja balik korelasi sebelum posisi ditutup.
async function checkBtcAlignment(
  bias: 'bullish' | 'bearish',
  symbol: string,
  tfInterval: string = '2h',
  tfLimit: number = 100
): Promise<{ aligned: boolean; btcBias: 'bullish' | 'bearish' | 'ranging'; btcStrength: string; message: string; nearStrongSR: boolean; srMessage: string; marketStructureV2?: MarketStructureV2Result | null }> {
  // Skip self-check kalau yang dianalisa emang BTC sendiri — gak ada gunanya BTC ngecek dirinya sendiri
  if (symbol === 'BTCUSDT') {
    return { aligned: true, btcBias: bias, btcStrength: 'strong', message: '', nearStrongSR: false, srMessage: '' };
  }
  try {
    // TF & candle count sekarang PARAMETER (request user: BTC Correlation harus
    // nyesuain TF struktur menu yang manggil, bukan fixed H2 lagi). Default
    // H2/100 dipertahanin buat backward-compat kalau ada pemanggil yang belum
    // di-update ngirim parameter ini.
    const btcData = await fetchKlines('BTCUSDT', tfInterval, tfLimit);

    // Fix konsistensi basis (request user): BTC Correlation sekarang pake
    // Market Structure V2 juga — sebelumnya masih pake analyzePriceActionStructure
    // (sistem lama) walau semua 9 skill koin udah pindah ke V2 sebagai primary gate.
    const tfV2 = binanceIntervalToTFLabelV2(tfInterval);
    const structV2 = analyzeMarketStructureV2(btcData.opens, btcData.highs, btcData.lows, btcData.closes, tfV2);
    const btcBias: 'bullish' | 'bearish' | 'ranging' =
      structV2.classification === 'bullish_strong' || structV2.classification === 'bullish_weak' ? 'bullish' :
      structV2.classification === 'bearish_strong' || structV2.classification === 'bearish_weak' ? 'bearish' :
      'ranging'; // sideways ATAU transition = netral, gak ada tekanan makro jelas
    const btcStrength = structV2.classification.endsWith('_strong') ? 'strong' : structV2.classification.endsWith('_weak') ? 'weak' : 'neutral';

    const aligned = btcBias === bias || btcBias === 'ranging';
    const message =
      btcBias === 'ranging'
        ? `BTC netral/${structV2.classification} — gak ada tekanan makro searah/lawan arah`
        : aligned
        ? `✅ Searah BTC (${btcBias}, ${btcStrength}) — risiko ke-tarik gerakan makro lebih rendah`
        : `⚠️ Lawan arah BTC (BTC lagi ${btcBias}) — waspada risiko ke-tarik gerakan makro BTC`;

    // BTC deket S&R kuat (radius 2%) — informasional/scoring doang, gak block.
    // Trend BTC bisa "strong" tapi kalau lagi mepet S&R kuat, risiko reversal makro naik.
    const btcPrice = btcData.closes[btcData.closes.length - 1]!;
    const btcSR = detectSRLevels(btcData.highs, btcData.lows, btcData.closes, 100);
    const strongLevels = btcSR.filter(l => l.touches >= 3);
    const nearLevel = strongLevels.find(l => (Math.abs(l.price - btcPrice) / btcPrice) * 100 <= 2);
    const nearStrongSR = !!nearLevel;
    const srMessage = nearLevel
      ? `⚠️ BTC lagi deket ${nearLevel.type === 'resistance' ? 'resistance' : 'support'} kuat (${nearLevel.touches}x touch) di ${nearLevel.price.toFixed(0)} — waspada rawan reversal makro`
      : '';

    return { aligned, btcBias, btcStrength, message, nearStrongSR, srMessage, marketStructureV2: structV2 };
  } catch {
    // Fail-safe: kalau fetch BTC gagal, jangan ganggu alur analisa koin utama
    return { aligned: true, btcBias: 'ranging', btcStrength: 'neutral', message: '', nearStrongSR: false, srMessage: '' };
  }
}

export interface ScalpingResult {
  status: 'waiting' | 'approaching' | 'in_zone' | 'expired' | 'no_setup' | 'no_structure' | 'skip' | 'error';
  symbol: string;
  bias?: 'bullish' | 'bearish';
  mode?: 'structural' | 'scalping15m'; // skill yang hasilin sinyal ini
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
}

export async function analyzeScalpingEntry(symbol: string): Promise<ScalpingResult> {
  // ─── Skill Structural v2 (REWRITE TOTAL — kebijakan tetap: semua analisa
  // struktur market WAJIB basis Skill 15M, ZigZag TERBUKTI sering salah baca
  // arah & bikin banyak sinyal loss kalau dijadiin hard-gate). Reuse LANGSUNG
  // helper yang sama dipake Extreme Scalping (detectZonesForExtreme
  // + tryZoneBreakoutRetest). FIX (request user): struktur sekarang M30 (100
  // candle, sebelumnya H1/720), eksekusi tetap M5 tapi 120 candle (sebelumnya
  // 288). Semua 11-lapis konfirmasi lama (ZigZag hard-gate, SMA200/RSI2, BB
  // Squeeze, OB/FVG/S&R/Fib/UFO hierarki, VWAP, Volume Profile, 11 pattern
  // candle, RSI divergence H1) DIHAPUS TOTAL, diganti breakout+retest basis
  // Skill 15M yang jauh lebih simpel.
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';
  const maxScore = 4; // pullback volume (wajib) + rejection volume + momentum align + BTC correlation

  try {
    // FIX (request user): filter indikator (RSI+StochRSI+MACD+Volume) sekarang
    // cek di H4 (sebelumnya H1, user liat H1 kurang cocok), BUKAN di M30 (TF
    // struktur) — fetch TAMBAHAN khusus buat filter ini doang, gak dipake
    // buat zona/breakout (itu tetep M30).
    const [m30, m5, h4ForFilter, tickerRes] = await Promise.all([
      fetchKlines(symbol, '30m', 100),
      fetchKlines(symbol, '5m', 120),
      fetchKlines(symbol, '4h', 100),
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);
    const currentPrice = tickerRes.ok
      ? parseFloat((await tickerRes.json() as { price: string }).price)
      : m30.closes[m30.closes.length - 1]!;

    const n30 = m30.closes.length;
    if (n30 < 100) {
      return { status: 'error', symbol, currentPrice, timestamp, mode: 'structural', message: 'Data M30 gak cukup (butuh 100+ candle)', maxScore };
    }
    const atrM30 = calcATR(m30.highs, m30.lows, m30.closes);
    const atrM30Pct = (atrM30 / currentPrice) * 100;
    if (atrM30Pct < 0.5) {
      return { status: 'skip', symbol, currentPrice, timestamp, mode: 'structural', message: `ATR M30 terlalu rendah (${atrM30Pct.toFixed(2)}%) — volatilitas gak cukup buat scalping`, maxScore };
    }

    const zones = detectZonesForExtreme(m30, atrM30);
    // FIX (request user): zona WAJIB numpuk sama Fibonacci retracement, sama
    // pola kayak Skill 15M — dipisah dari detectZonesForExtreme (fungsi
    // shared, sengaja gak diubah) biar Multi-TF Scanner+Counter Structural
    // tetep apa adanya.
    const resistanceLevels = filterZonesNumpukFib(zones.resistanceLevels, m30.highs, m30.lows, m30.closes);
    const supportLevels = filterZonesNumpukFib(zones.supportLevels, m30.highs, m30.lows, m30.closes);
    const zoneWidth = zones.zoneWidth;
    if (resistanceLevels.length === 0 && supportLevels.length === 0) {
      return { status: 'no_setup', symbol, currentPrice, timestamp, mode: 'structural', message: 'Gak ada zona S/R yang numpuk sama Fibonacci retracement', maxScore, atr15MPct: atrM30Pct };
    }

    const picked = await tryZoneBreakoutRetest(m30, m5, currentPrice, resistanceLevels, supportLevels, zoneWidth, atrM30, 'M30', symbol);
    if (!picked.ok) {
      // 'waiting'/'expired' dipertahanin apa adanya (BUKAN di-remap ke no_setup)
      // biar konsisten sama Scalping15M — route scan Menu 4 include ketiga status
      // ini (in_zone/approaching/waiting) buat kedua skill yang share endpoint sama.
      return { status: picked.status, symbol, currentPrice, timestamp, mode: 'structural', message: picked.reason, maxScore, atr15MPct: atrM30Pct, marketStructureV2: picked.marketStructureV2 };
    }

    // FIX (request user, kedua skill Menu Scalping): cek RSI+StochRSI+MACD+
    // Volume SEBELUM sinyal dikasih — cegah BUY pas overbought / SELL pas
    // oversold (kejadian nyata: sinyal SELL keluar pas oversold, market malah
    // rebound naik, jadi LOSE). Block kalau minimal 3/4 indikator konsisten
    // nunjukin kondisi ekstrem lawan arah.
    const exhaustionCheck = checkIndicatorExhaustion(h4ForFilter.highs, h4ForFilter.lows, h4ForFilter.closes, h4ForFilter.volumes, picked.bias);
    if (exhaustionCheck.blocked) {
      return { status: 'no_setup', symbol, bias: picked.bias, currentPrice, timestamp, mode: 'structural', message: exhaustionCheck.reason!, maxScore, atr15MPct: atrM30Pct };
    }

    const filterResults = [
      `✅ Zona S&R terdeteksi (${resistanceLevels.length} resistance, ${supportLevels.length} support), ATR M30 ${atrM30Pct.toFixed(2)}%`,
      `✅ ${picked.note}`,
      `✅ Indikator H4 gak overbought/oversold/hollow — RSI ${exhaustionCheck.rsi.toFixed(1)}, StochRSI ${exhaustionCheck.stochRsi.toFixed(1)}, CCI ${exhaustionCheck.cci.toFixed(0)}, MFI ${exhaustionCheck.mfi.toFixed(1)}`,
    ];

    const btcCheck = await checkBtcAlignment(picked.bias, symbol, '30m', 100); // TF struktur (M30)
    // FIX (request user): BTC Correlation SEKARANG SOFT FILTER doang —
    // GAK NGE-BLOCK sinyal lagi walaupun BTC lawan arah. Cuma nempel WARNING
    // di filterResults biar user TETEP TAU kondisi BTC pas ambil keputusan
    // sendiri, tapi keputusan FINAL diserahin ke user.
    if (btcCheck.btcBias !== 'ranging' && !btcCheck.aligned) {
      filterResults.push(`⚠️ ${btcCheck.message} (soft warning — sinyal tetep lolos, pertimbangin sendiri)`);
    } else {
      filterResults.push(btcCheck.message || '✅ BTC lagi ranging — netral');
    }

    // FIX (request user): filter S&R+overbought BERTINGKAT (H1->H4->D1) —
    // SOFT WARNING (bukan block), cek apakah harga lagi deket zona S&R KUAT
    // DIPERKUAT overbought/oversold di TF manapun.
    const srConfluence = await checkMultiTFSRConfluence(symbol, picked.bias);
    if (srConfluence.danger && srConfluence.detail) {
      filterResults.push(`⚠️ Harga deket zona S&R KUAT (${srConfluence.detail.zoneTouches}x touches) di ${srConfluence.dangerTf}, DIPERKUAT RSI ${srConfluence.detail.rsi.toFixed(1)} (${picked.bias === 'bullish' ? 'overbought' : 'oversold'}) — jarak ${srConfluence.detail.distanceAtrRatio?.toFixed(2)}x ATR, potensi resiko reversal (soft warning — sinyal tetep lolos)`);
    }

    const status: ScalpingResult['status'] = picked.status === 'approaching' ? 'approaching' : 'in_zone';
    // score: gak ada lagi sistem "nambah 1 per faktor" kayak versi lama (basis
    // Skill 15M rule-engine, bukan weighted score), jadi dipakein proxy: in_zone
    // (semua wajib lolos: pullback+volume+min1konfirmasi) = 3, approaching = 1.
    const score = status === 'in_zone' ? 3 : 1;
    const tfBreakdown: TFBreakdownItem[] = [
      { timeframe: 'M30', label: 'Struktur', detail: picked.note, status: 'confirm' },
      { timeframe: 'M5', label: 'Eksekusi', detail: `Zona edge ${picked.zoneEdgeLower.toFixed(4)}–${picked.zoneEdgeUpper.toFixed(4)}`, status: 'confirm' },
    ];

    const technicalSnapshot = await buildTechnicalSnapshot(m30, m5, symbol);
    return {
      status, symbol, bias: picked.bias, mode: 'structural', currentPrice, timestamp,
      score, maxScore, filterResults, tfBreakdown,
      zoneEdgeUpper: picked.zoneEdgeUpper, zoneEdgeLower: picked.zoneEdgeLower, candlesSinceBreakout: picked.candlesSinceBreakout,
      entryPrice: picked.entryPrice, stopLoss: picked.stopLoss, takeProfit1: picked.takeProfit1, rr1: picked.rr1,
      atr15MPct: atrM30Pct,
      technicalSnapshot,
      marketStructureV2: picked.marketStructureV2,
      btcAligned: btcCheck.aligned, btcBias: btcCheck.btcBias,
      message: `${status === 'in_zone' ? 'SIAP ENTRY' : 'SIAP BREAKOUT'} — ${picked.note}`,
    };
  } catch (err) {
    return { status: 'error', symbol, currentPrice: 0, timestamp, mode: 'structural', message: err instanceof Error ? err.message : 'Unknown error', maxScore };
  }
}
// ─── Scalping Mode Classifier (Structural vs Scalping 15M) ─────────────────
// Classifier MURAH — cuma ngecek apakah ada breakout+retest M15 valid dalam
// beberapa candle terakhir (murah karena udah pake data yang emang di-fetch).
export interface ScalpingModeClassification {
  recommendedMode: 'structural' | 'scalping15m';
  reason: string;
}

/**
 * Skill "Scalping 15M" — beda total dari skill Structural (H1→M5 SMC-based).
 * Basis: deteksi zona S/R M15 pakai Fibonacci retracement confluence (swing
 * high/low + merge, TAPI WAJIB numpuk sama level Fib — zona lebar ATR×0.35),
 * validasi breakout+volume, tunggu retest ke zona dengan pullback volume
 * rendah (wajib) + minimal 1 dari 2 konfirmasi tambahan (rejection volume,
 * momentum align).
 * FIX (request user): sekarang 1 TF doang (M15) — sebelumnya struktur M15 +
 * eksekusi M1 terpisah, sekarang momentum align & technicalSnapshot eksekusi
 * dihitung dari M15 juga (bukan M1 lagi).
 * Pin bar/engulfing detector & order management otomatis SENGAJA di-skip sesuai
 * request — order book health check diganti proxy volume MA20 (data real-time
 * orderbook gak reliable buat sistem scan periodik kayak gini).
 */
export async function analyzeScalping15M(symbol: string): Promise<ScalpingResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';
  const maxScore = 4; // pullback volume (wajib) + rejection volume + momentum align + BTC correlation

  try {
    // FIX (request user): filter indikator (RSI+StochRSI+MACD+Volume) sekarang
    // cek di H4 (sebelumnya H1, user liat H1 kurang cocok), BUKAN di M15 (TF
    // struktur) — fetch TAMBAHAN khusus buat filter ini doang, gak dipake
    // buat zona/breakout (itu tetep M15).
    const [m15, h4ForFilter, tickerRes] = await Promise.all([
      fetchKlines(symbol, '15m', 100),
      fetchKlines(symbol, '4h', 100),
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);
    const currentPrice = tickerRes.ok
      ? parseFloat((await tickerRes.json() as { price: string }).price)
      : m15.closes[m15.closes.length - 1]!;

    const filterResults: string[] = [];
    let score = 0;

    const n15 = m15.closes.length;
    if (n15 < 100) {
      return { status: 'no_setup', symbol, currentPrice, timestamp, mode: 'scalping15m', message: 'Data M15 gak cukup (butuh 100+ candle)', maxScore };
    }

    const atr15 = calcATR(m15.highs, m15.lows, m15.closes);
    const atr15MPct = (atr15 / currentPrice) * 100; // request user: ATR% biar keliatan di UI, sekarang cuma dipake internal
    const zoneWidth = atr15 * 0.35;
    const mergeDistance = atr15 * 0.5;

    // FIX (request user, fetch diturunkan dari 480 ke 100 candle): lookback
    // disesuaikan jadi 100 juga (dari 120) — konsisten sama jumlah candle yang
    // di-fetch, gak mungkin ambil 120 dari data yang cuma ada 100.
    const lookbackSlice = 100;
    const h = m15.highs.slice(-lookbackSlice);
    const l = m15.lows.slice(-lookbackSlice);
    const swingH = findSwingHighs(h, 30);
    const swingL = findSwingLows(l, 30);

    const mergeLevels = (levels: number[]): number[] => {
      if (levels.length === 0) return [];
      const sorted = [...levels].sort((a, b) => a - b);
      const merged: number[] = [sorted[0]!];
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i]! - merged[merged.length - 1]! > mergeDistance) merged.push(sorted[i]!);
      }
      return merged;
    };
    const mergedResistance = mergeLevels(swingH);
    const mergedSupport = mergeLevels(swingL);

    // FIX (request user): zona WAJIB numpuk sama level Fibonacci retracement
    // (basis Skill 15M, sama persis pola confluence yang dipake di
    // detectStrongestZonePerTF/Multi-TF Scanner) — bukan sekadar swing+merge
    // doang. Toleransi numpuk 0.5% (konsisten sama fungsi lain yang udah ada).
    const fib15 = calcFibonacci(m15.highs, m15.lows, m15.closes);
    const filterNumpukFib = (levels: number[]): number[] => {
      if (!fib15) return []; // gak ada range Fib valid (30 candle terakhir flat) — gak ada zona yang bisa dikonfirmasi
      const fibValues = Object.values(fib15.levels);
      return levels.filter(lvl => fibValues.some(fv => (Math.abs(lvl - fv) / lvl) * 100 < 0.5));
    };
    const resistanceLevels = filterNumpukFib(mergedResistance);
    const supportLevels = filterNumpukFib(mergedSupport);

    if (resistanceLevels.length === 0 && supportLevels.length === 0) {
      return { status: 'no_setup', symbol, currentPrice, timestamp, mode: 'scalping15m', message: 'Gak ada zona S/R yang numpuk sama Fibonacci retracement', maxScore, atr15MPct };
    }

    const volMA20At = (idx: number) => {
      const start = Math.max(0, idx - 20);
      const win = m15.volumes.slice(start, idx);
      return win.length > 0 ? win.reduce((a, b) => a + b, 0) / win.length : 0;
    };

    // FIX (request user): threshold volume breakout NAIK dari 1.4x jadi 1.5x
    // (base, high-cap) — crypto sekarang volatilitas tinggi + banyak
    // manipulasi (wash trading, fake breakout), butuh konfirmasi volume
    // lebih kuat. Koin likuiditas rendah (<500jt USDT/24h) otomatis dinaikin
    // ke ~2.5x (lebih gampang "digoreng" volume-nya).
    const volumeThreshold15M = await getVolumeBreakoutThreshold(symbol, 1.5);

    // Cari breakout dalam retest window (24 candle terakhir = ~6 jam)
    const retestWindowMax = 24;
    let foundBreakout: { direction: 'bullish' | 'bearish'; zoneLevel: number; edgeUpper: number; edgeLower: number; breakoutPrice: number; breakoutIdx: number } | null = null;

    // FIX (request user, "tunggu close candle sebelum entry"): sama kayak
    // Structural, window scan BERHENTI di 'n15 - 1' — breakout cuma
    // terdeteksi dari candle yang PASTI udah closed.
    for (let idx = Math.max(1, n15 - retestWindowMax); idx < n15 - 1; idx++) {
      const closeAt = m15.closes[idx]!;
      const volAt = m15.volumes[idx]!;
      const volMA = volMA20At(idx);
      if (volMA <= 0) continue;
      for (const level of resistanceLevels) {
        const edgeUpper = level + zoneWidth / 2;
        const edgeLower = level - zoneWidth / 2;
        if (closeAt > edgeUpper && volAt > volumeThreshold15M * volMA) {
          foundBreakout = { direction: 'bullish', zoneLevel: level, edgeUpper, edgeLower, breakoutPrice: closeAt, breakoutIdx: idx };
        }
      }
      for (const level of supportLevels) {
        const edgeUpper = level + zoneWidth / 2;
        const edgeLower = level - zoneWidth / 2;
        if (closeAt < edgeLower && volAt > volumeThreshold15M * volMA) {
          foundBreakout = { direction: 'bearish', zoneLevel: level, edgeUpper, edgeLower, breakoutPrice: closeAt, breakoutIdx: idx };
        }
      }
    }

    if (!foundBreakout) {
      return { status: 'waiting', symbol, currentPrice, timestamp, mode: 'scalping15m', message: `Belum ada breakout valid dalam retest window (24 candle terakhir, threshold volume ${volumeThreshold15M.toFixed(2)}x MA20)`, maxScore, atr15MPct };
    }
    const bias = foundBreakout.direction;
    const candlesSinceBreakout = n15 - 1 - foundBreakout.breakoutIdx;

    // FIX (request user, kedua skill Menu Scalping): cek RSI+StochRSI+MACD+
    // Volume SEBELUM sinyal dikasih — cegah BUY pas overbought / SELL pas
    // oversold (kejadian nyata: sinyal SELL keluar pas oversold, market malah
    // rebound naik, jadi LOSE). Block kalau minimal 3/4 indikator konsisten
    // nunjukin kondisi ekstrem lawan arah.
    const exhaustionCheck15M = checkIndicatorExhaustion(h4ForFilter.highs, h4ForFilter.lows, h4ForFilter.closes, h4ForFilter.volumes, bias);
    if (exhaustionCheck15M.blocked) {
      return { status: 'no_setup', symbol, bias, currentPrice, timestamp, mode: 'scalping15m', message: exhaustionCheck15M.reason!, maxScore, atr15MPct };
    }

    // ═══ Market Structure V2 — primary gate (request user) ════════════════
    const structGate15M = checkStructureV2Gate(m15, bias, 'M15');
    if (structGate15M.blocked) {
      return { status: 'waiting', symbol, currentPrice, timestamp, mode: 'scalping15m', message: structGate15M.reason, maxScore, atr15MPct, marketStructureV2: structGate15M.structV2 };
    }
    if (structGate15M.structureNote) filterResults.push(structGate15M.structureNote);

    filterResults.push(`✅ Breakout ${bias === 'bullish' ? 'bullish' : 'bearish'} dari zona ${foundBreakout.zoneLevel.toFixed(4)}, ${candlesSinceBreakout} candle lalu`);
    filterResults.push(`✅ Indikator H4 gak overbought/oversold/hollow — RSI ${exhaustionCheck15M.rsi.toFixed(1)}, StochRSI ${exhaustionCheck15M.stochRsi.toFixed(1)}, CCI ${exhaustionCheck15M.cci.toFixed(0)}, MFI ${exhaustionCheck15M.mfi.toFixed(1)}`);

    // ── Entry, SL, TP — dihitung dari sini karena zona (edgeUpper/edgeLower)
    // udah FIXED begitu breakout kedeteksi. Dipake buat status 'approaching'
    // (proyeksi limit order yang bakal dipasang begitu retest kejadian) MAUPUN
    // 'in_zone' (limit order final). BUG SEBELUMNYA: kalkulasi ini cuma jalan
    // buat 'in_zone', jadi status 'approaching' gak pernah nampilin entry/SL/TP.
    const entryBuffer = atr15 * 0.20;
    const slBuffer = atr15 * 1;
    let entryPrice: number, stopLoss: number;
    if (bias === 'bullish') {
      entryPrice = foundBreakout.edgeUpper - entryBuffer;
      stopLoss = foundBreakout.edgeLower - slBuffer;
    } else {
      entryPrice = foundBreakout.edgeLower + entryBuffer;
      stopLoss = foundBreakout.edgeUpper + slBuffer;
    }
    const risk = Math.abs(entryPrice - stopLoss);
    const dir = bias === 'bullish' ? 1 : -1;
    const takeProfit1 = risk > 0 ? entryPrice + risk * 2 * dir : undefined; // RR target 2 (minimal RR 1:2)

    const inZone = currentPrice <= foundBreakout.edgeUpper && currentPrice >= foundBreakout.edgeLower;

    if (!inZone) {
      if (candlesSinceBreakout > retestWindowMax) {
        return {
          status: 'expired', symbol, bias, currentPrice, timestamp, mode: 'scalping15m',
          zoneEdgeUpper: foundBreakout.edgeUpper, zoneEdgeLower: foundBreakout.edgeLower, candlesSinceBreakout,
          message: `Breakout ${bias} udah lewat retest window (${candlesSinceBreakout} candle, max ${retestWindowMax})`,
          score, maxScore, filterResults, atr15MPct,
        };
      }
      const technicalSnapshotApproaching = await buildTechnicalSnapshot(m15, m15, symbol);
      return {
        status: 'approaching', symbol, bias, currentPrice, timestamp, mode: 'scalping15m',
        zoneEdgeUpper: foundBreakout.edgeUpper, zoneEdgeLower: foundBreakout.edgeLower, candlesSinceBreakout,
        entryPrice, stopLoss, takeProfit1, rr1: 2,
        message: `SIAP BREAKOUT — breakout ${bias} udah terjadi ${candlesSinceBreakout} candle lalu, nunggu harga retest ke zona ${foundBreakout.zoneLevel.toFixed(4)} (entry di bawah proyeksi limit order)`,
        score, maxScore, filterResults, atr15MPct,
        technicalSnapshot: technicalSnapshotApproaching,
      };
    }

    // ── Udah masuk zona retest — cek pullback depth & volume ─────────────
    const pullbackDepth = Math.abs(foundBreakout.breakoutPrice - currentPrice);
    const maxPullback = atr15 * 1.5;
    if (pullbackDepth > maxPullback) {
      return {
        status: 'expired', symbol, bias, currentPrice, timestamp, mode: 'scalping15m',
        zoneEdgeUpper: foundBreakout.edgeUpper, zoneEdgeLower: foundBreakout.edgeLower, candlesSinceBreakout,
        message: `Pullback udah kelewat dalam (${pullbackDepth.toFixed(4)} > max ${maxPullback.toFixed(4)})`,
        score, maxScore, filterResults, atr15MPct,
      };
    }

    const lastVol = m15.volumes[n15 - 1]!;
    const lastVolMA = volMA20At(n15 - 1);
    // FIX (request user): retest volume MENURUN LALU STABIL, bukan cuma cek
    // 1 candle terakhir doang — lihat comment checkVolumeDecliningStable.
    const breakoutVolume15M = m15.volumes[foundBreakout.breakoutIdx]!;
    const declineCheck15M = checkVolumeDecliningStable(m15.volumes, foundBreakout.breakoutIdx, n15 - 1, breakoutVolume15M);
    if (!declineCheck15M.ok) {
      return {
        status: 'no_setup', symbol, bias, currentPrice, timestamp, mode: 'scalping15m',
        zoneEdgeUpper: foundBreakout.edgeUpper, zoneEdgeLower: foundBreakout.edgeLower, candlesSinceBreakout,
        message: declineCheck15M.reason ?? 'Pullback volume masih tinggi (belum nunjukin koreksi lemah) — syarat wajib belum lolos',
        score, maxScore, filterResults, atr15MPct,
      };
    }
    score++;
    filterResults.push('✅ Pullback volume rendah — koreksi lemah, sehat (syarat wajib lolos)');

    // ── Konfirmasi tambahan (pin bar/engulfing SENGAJA di-skip): minimal 1 dari 2 ──
    let confirmCount = 0;
    const rejectionVolumeOk = lastVolMA > 0 && lastVol >= 1.2 * lastVolMA;
    if (rejectionVolumeOk) {
      confirmCount++; score++;
      filterResults.push('✅ Rejection volume spike (≥1.2x MA20)');
    } else {
      filterResults.push('⚠️ Rejection volume belum spike');
    }

    // FIX (request user): Skill 15M sekarang pake 1 TF doang (M15) — momentum
    // align yang SEBELUMNYA cek M1 (eksekusi presisi) sekarang cek M15 juga
    // (TF struktur DAN eksekusi disatuin).
    const rsi15Momentum = calcRSI(m15.closes, 14);
    const macd15 = calcMACD(m15.closes);
    const momentumAlign = bias === 'bullish' ? (rsi15Momentum > 50 && macd15.histogram > 0) : (rsi15Momentum < 50 && macd15.histogram < 0);
    if (momentumAlign) {
      confirmCount++; score++;
      filterResults.push(`✅ Momentum align M15 — RSI ${rsi15Momentum.toFixed(1)}, MACD histogram ${macd15.histogram > 0 ? 'positif' : 'negatif'} searah bias`);
    } else {
      filterResults.push(`⚠️ Momentum M15 belum align — RSI ${rsi15Momentum.toFixed(1)}`);
    }

    if (confirmCount < 1) {
      return {
        status: 'no_setup', symbol, bias, currentPrice, timestamp, mode: 'scalping15m',
        zoneEdgeUpper: foundBreakout.edgeUpper, zoneEdgeLower: foundBreakout.edgeLower, candlesSinceBreakout,
        message: 'Belum ada konfirmasi tambahan (rejection volume / momentum align) yang lolos',
        score, maxScore, filterResults, atr15MPct,
      };
    }

    // FIX (request user): BTC Correlation SEKARANG SOFT FILTER doang — GAK
    // NGE-BLOCK sinyal lagi walaupun BTC lawan arah. Cuma nempel WARNING di
    // filterResults biar user TETEP TAU kondisi BTC pas ambil keputusan
    // sendiri, tapi keputusan FINAL diserahin ke user.
    const btcCheck = await checkBtcAlignment(bias, symbol, '15m', 100); // TF struktur (M15), konsisten sama fetch utama
    if (btcCheck.btcBias !== 'ranging' && !btcCheck.aligned) {
      filterResults.push(`⚠️ ${btcCheck.message} (soft warning — sinyal tetep lolos, pertimbangin sendiri)`);
    } else if (btcCheck.message) {
      filterResults.push(btcCheck.message);
      score++;
    }

    // FIX (request user): filter S&R+overbought BERTINGKAT (H1->H4->D1) —
    // SOFT WARNING (bukan block).
    const srConfluence15M = await checkMultiTFSRConfluence(symbol, bias);
    if (srConfluence15M.danger && srConfluence15M.detail) {
      filterResults.push(`⚠️ Harga deket zona S&R KUAT (${srConfluence15M.detail.zoneTouches}x touches) di ${srConfluence15M.dangerTf}, DIPERKUAT RSI ${srConfluence15M.detail.rsi.toFixed(1)} (${bias === 'bullish' ? 'overbought' : 'oversold'}) — jarak ${srConfluence15M.detail.distanceAtrRatio?.toFixed(2)}x ATR, potensi resiko reversal (soft warning — sinyal tetep lolos)`);
    }

    // Validasi risk final — entry/SL/TP udah dihitung di atas (dipake juga buat
    // status 'approaching'), di sini cuma cek validitasnya buat sinyal FINAL (in_zone)
    if (risk <= 0 || takeProfit1 === undefined) {
      return { status: 'no_setup', symbol, bias, currentPrice, timestamp, mode: 'scalping15m', message: 'Risk tidak valid', score, maxScore, filterResults, atr15MPct };
    }

    const tfBreakdown: TFBreakdownItem[] = [
      { timeframe: 'M15', label: 'Breakout Zona', detail: `${bias === 'bullish' ? 'Bullish' : 'Bearish'} dari ${foundBreakout.zoneLevel.toFixed(4)}, ${candlesSinceBreakout} candle lalu`, status: 'confirm' },
      { timeframe: 'M15', label: 'Pullback Volume', detail: 'Rendah (koreksi lemah)', status: 'confirm' },
      { timeframe: 'M15', label: 'Rejection Volume', detail: rejectionVolumeOk ? 'Spike ≥1.2x' : 'Belum spike', status: rejectionVolumeOk ? 'confirm' : 'neutral' },
      { timeframe: 'M15', label: 'Momentum Align', detail: momentumAlign ? 'RSI+MACD searah' : 'Belum align', status: momentumAlign ? 'confirm' : 'neutral' },
    ];

    // Momentum check (request user): retest yang sehat = DESELERASI pas mendekati zona
    const momentumTrend = detectMomentumTrend(m15, 3);
    filterResults.push(momentumTrend.decelerating
      ? `✅ Momentum deselerasi mendekati retest (range ${(momentumTrend.rangeRatio * 100).toFixed(0)}%, vol ${(momentumTrend.volRatio * 100).toFixed(0)}% dari 3 candle sebelumnya) — pullback sehat`
      : momentumTrend.accelerating
      ? `⚠️ Momentum masih akselerasi pas retest (range ${(momentumTrend.rangeRatio * 100).toFixed(0)}%, vol ${(momentumTrend.volRatio * 100).toFixed(0)}%) — pullback masih kenceng, waspada`
      : `ℹ️ Momentum netral pas retest`);

    const technicalSnapshotInZone = await buildTechnicalSnapshot(m15, m15, symbol);
    return {
      status: 'in_zone', symbol, bias, mode: 'scalping15m', currentPrice, timestamp, score, maxScore,
      zoneEdgeUpper: foundBreakout.edgeUpper, zoneEdgeLower: foundBreakout.edgeLower, candlesSinceBreakout,
      entryPrice, stopLoss, takeProfit1, rr1: 2,
      filterResults, tfBreakdown, atr15MPct,
      technicalSnapshot: technicalSnapshotInZone,
      marketStructureV2: structGate15M.structV2,
      btcAligned: btcCheck.aligned, btcBias: btcCheck.btcBias,
      message: `SIAP RETEST — zona ${foundBreakout.zoneLevel.toFixed(4)}, confirmations ${confirmCount}/2 lolos (pullback volume wajib + minimal 1 tambahan)`,
    };
  } catch (err) {
    return {
      status: 'error', symbol, currentPrice: 0, timestamp, mode: 'scalping15m',
      message: err instanceof Error ? err.message : 'Unknown error',
      maxScore: 4,
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


// ─── Menu 5 — Extreme Scalping (H1 → M15 → M5) ─────────────────────────────
// Beda dari Menu 4 (H4→M30→M5): 1 level lebih cepat, dan DIDESAIN KHUSUS buat
// nangkep REVERSAL — bukan cuma trend-following. Kalau CHoCH H1 kedeteksi
// (break swing lawan arah trend utama), sinyal ngikutin arah CHoCH (arah
// reversal), bukan arah trend H1 yang lama. Contoh: H1 bearish tapi CHoCH ke
// atas kedeteksi → sistem cari LONG, bukan SHORT.

// ═══════════════════════════════════════════════════════════════════════════

function detectMomentumTrend(ltf: KlineData, lookback = 3): { decelerating: boolean; accelerating: boolean; rangeRatio: number; volRatio: number } {
  const n = ltf.closes.length;
  if (n < lookback * 2) return { decelerating: false, accelerating: false, rangeRatio: 1, volRatio: 1 };

  let recentRangeSum = 0, olderRangeSum = 0, recentVolSum = 0, olderVolSum = 0;
  for (let i = 0; i < lookback; i++) {
    const idxRecent = n - 1 - i;
    const idxOlder = n - 1 - lookback - i;
    recentRangeSum += ltf.highs[idxRecent]! - ltf.lows[idxRecent]!;
    olderRangeSum += ltf.highs[idxOlder]! - ltf.lows[idxOlder]!;
    recentVolSum += ltf.volumes[idxRecent]!;
    olderVolSum += ltf.volumes[idxOlder]!;
  }
  const rangeRatio = olderRangeSum > 0 ? recentRangeSum / olderRangeSum : 1;
  const volRatio = olderVolSum > 0 ? recentVolSum / olderVolSum : 1;

  return {
    decelerating: rangeRatio < 0.8 && volRatio < 0.8,
    accelerating: rangeRatio > 1.2 && volRatio > 1.2,
    rangeRatio, volRatio,
  };
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
function detectZonesForExtreme(htf: KlineData, atrHtf: number, minTouches = 2): { resistanceLevels: number[]; supportLevels: number[]; zoneWidth: number } {
  const zoneWidth = atrHtf * 0.35;
  const mergeDistance = atrHtf * 0.5;
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
function filterZonesNumpukFib(levels: number[], highs: number[], lows: number[], closes: number[]): number[] {
  const fib = calcFibonacci(highs, lows, closes);
  if (!fib) return []; // gak ada range Fib valid (30 candle terakhir flat) — gak ada zona yang bisa dikonfirmasi
  const fibValues = Object.values(fib.levels);
  return levels.filter(lvl => fibValues.some(fv => (Math.abs(lvl - fv) / lvl) * 100 < 0.5));
}

/**
 * FIX (request user, kedua skill Menu Scalping — Structural & Skill 15M):
 * cegah kasih sinyal BUY pas market udah overbought, atau SELL pas udah
 * oversold — kejadian nyata yang dialami user: sinyal SELL keluar pas market
 * lagi oversold, ternyata malah rebound naik, jadi LOSE.
 *
 * Cek 4 indikator: RSI, Stochastic RSI, MACD histogram, Volume. Block SIGNAL
 * (bukan cuma warning) kalau MAYORITAS (3 dari 4) indikator nunjukin kondisi
 * "melawan arah" — biar gak terlalu ketat cuma karena 1 indikator kebetulan
 * ekstrem, tapi tetep block kalau memang udah konsisten di banyak indikator.
 *
 * CATATAN JUJUR: backtest 128 trade (38 koin H1) yang saya jalanin sebelum
 * implementasi ini justru nunjukin KEBALIKAN — sinyal yang "melawan" RSI
 * ekstrem itu WR-nya LEBIH TINGGI (55.6% vs 38.7%), bukan lebih rendah. Sample
 * kecil (9 trade) jadi belum konklusif, tapi user tetep minta diimplementasikan
 * buat ditest sendiri di live — bukan karena udah terbukti bagus di backtest.
 */
interface IndicatorExhaustionCheck {
  blocked: boolean;
  reason?: string;
  rsi: number;
  stochRsi: number;
  macdHistogram: number;
  volRatio: number;
  cci: number;
  mfi: number;
  roc: number;
}

/**
 * FIX (request user, berdasarkan DATA LIVE Journal 175 sinyal — BUKAN
 * backtest simulasi lagi): analisa Journal nunjukin pola KONSISTEN di
 * SEMUA skill:
 * - CCI ekstrem (|CCI|≥100) muncul di 50-62% kasus LOSE (Skill 15M 50%,
 *   Structural 62%, Counter Scalping 54%)
 * - MFI pas LOSE jauh lebih tinggi dari WIN (53.9 vs 44.5 struktur, 51.8
 *   vs 45.5 eksekusi) — indikasi "hollow move" (harga gerak, volume gak dukung)
 * - MACD histogram pas WIN jelas lebih kuat dari LOSE (0.2 vs ~0)
 * - ROC pas WIN jelas lebih tajam dari LOSE (4.2%/3.8% vs 3.5%/2.9%)
 * Threshold CCI/MFI/ROC di bawah diambil dari pola data live ini (bukan
 * dugaan/riset backtest historis).
 */
function checkIndicatorExhaustion(highs: number[], lows: number[], closes: number[], volumes: number[], bias: 'bullish' | 'bearish'): IndicatorExhaustionCheck {
  const rsi = calcRSI(closes, 14);
  const stochRsi = calcStochRSI(closes);
  const macd = calcMACD(closes);
  const volMA20 = volumes.length >= 21 ? volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20 : 0;
  const lastVol = volumes[volumes.length - 1] ?? 0;
  const volRatio = volMA20 > 0 ? lastVol / volMA20 : 1;
  const cci = calcCCI(highs, lows, closes);
  const mfi = calcMFI(highs, lows, closes, volumes);
  const roc = calcROC(closes);

  let exhaustionCount = 0;
  if (bias === 'bullish') {
    // BUY tapi overbought — dicek searah "overbought"
    if (rsi >= 70) exhaustionCount++;
    if (stochRsi >= 80) exhaustionCount++;
    if (macd.histogram < 0) exhaustionCount++; // momentum udah mulai melemah
    if (volRatio < 0.8) exhaustionCount++; // volume ngedrop, kurang dukungan buat lanjut naik
    if (cci >= 100) exhaustionCount++; // CCI ekstrem — data live: 50-62% korelasi ke LOSE
    if (mfi >= 60) exhaustionCount++; // MFI tinggi — data live: indikasi hollow move
    if (roc < 1.0) exhaustionCount++; // momentum harga lemah — data live: WIN rata2 ROC 3.8-4.2%, LOSE 2.9-3.5%
  } else {
    // SELL tapi oversold — dicek searah "oversold"
    if (rsi <= 30) exhaustionCount++;
    if (stochRsi <= 20) exhaustionCount++;
    if (macd.histogram > 0) exhaustionCount++;
    if (volRatio < 0.8) exhaustionCount++;
    if (cci <= -100) exhaustionCount++;
    if (mfi <= 40) exhaustionCount++;
    if (roc > -1.0) exhaustionCount++;
  }

  // Threshold block naik dari 3/4 jadi 4/7 (mayoritas, konsisten proporsinya
  // sama basis lama ~75% dari total indikator) — sekarang 7 indikator dicek.
  const blocked = exhaustionCount >= 4;
  const reason = blocked
    ? `Market udah ${bias === 'bullish' ? 'overbought/hollow' : 'oversold/hollow'} (${exhaustionCount}/7 indikator: RSI ${rsi.toFixed(1)}, StochRSI ${stochRsi.toFixed(1)}, MACD hist ${macd.histogram.toFixed(4)}, vol ${(volRatio*100).toFixed(0)}% MA20, CCI ${cci.toFixed(0)}, MFI ${mfi.toFixed(1)}, ROC ${roc.toFixed(2)}%) — resiko rebound/hollow move lawan arah`
    : undefined;

  return { blocked, reason, rsi, stochRsi, macdHistogram: macd.histogram, volRatio, cci, mfi, roc };
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

  const structV2 = analyzeMarketStructureV2(htf.opens, htf.highs, htf.lows, htf.closes, tf);
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

  const structV2 = analyzeMarketStructureV2(htf.opens, htf.highs, htf.lows, htf.closes, tf);
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

/**
 * Konversi label TF Momentum Hunter ('15M'/'5M'/'1M', angka-dulu) ke
 * TFLabelV2 ('M15'/'M5'/'M1', huruf-dulu) — 2 konvensi penamaan beda yang
 * kepake di bagian kode yang beda, H1/H4/M30 udah konsisten jadi gak perlu diubah.
 */
function momentumHunterLabelToTFLabelV2(label: string): TFLabelV2 {
  switch (label) {
    case '1M': return 'M1';
    case '5M': return 'M5';
    case '15M': return 'M15';
    case 'M30': return 'M30';
    case 'H1': return 'H1';
    case 'H4': return 'H4';
    default: return 'M15'; // fallback aman
  }
}

/**
 * Konversi Binance interval string ('1m'/'5m'/'15m'/'30m'/'1h'/'2h'/'4h'/'1d')
 * ke TFLabelV2 ('M1'/'M5'/.../'D1') — dipake checkBtcAlignment yang terima TF
 * dinamis dari pemanggil (format Binance), beda konvensi lagi dari 2 fungsi di atas.
 */
function binanceIntervalToTFLabelV2(interval: string): TFLabelV2 {
  switch (interval) {
    case '1m': return 'M1';
    case '5m': return 'M5';
    case '15m': return 'M15';
    case '30m': return 'M30';
    case '1h': return 'H1';
    case '2h': return 'H2';
    case '4h': return 'H4';
    case '1d': return 'D1';
    default: return 'H2'; // fallback aman (default lama checkBtcAlignment)
  }
}


/**
 * Reversal-Ekstrem (Menu 8 Momentum Hunter) — mean-reversion di S&R TERKUAT
 * (bukan sepasang S&R yang ngapit harga kayak tryZoneRejectionRetest, tapi 1
 * level PALING KUAT terlepas dari sisi). Threshold hasil diskusi:
 * - S&R kuat: minimal 3x touches
 * - Radius approach: 0.35x ATR (zoneWidth, konsisten basis)
 * - Wajib ada rejection candle (price action) dalam 24 candle terakhir
 * - Momentum support: minimal 1 dari 3 (RSI ekstrem 20/80, RSI divergence,
 *   Volume divergence) — kombinasi divergence sendiri udah "min 1 dari 2"
 *   sesuai request, digabung sama RSI ekstrem jadi total 3 kandidat OR
 */
function tryReversalExtreme(
  htf: KlineData, ltf: KlineData, currentPrice: number,
  resistanceLevels: { price: number; hits: number }[], supportLevels: { price: number; hits: number }[],
  zoneWidth: number, atrHtf: number, tf: TFLabelV2
): ZoneEventOk | ZoneEventFail {
  const strongRes = resistanceLevels.filter(l => l.hits >= 3);
  const strongSup = supportLevels.filter(l => l.hits >= 3);
  if (strongRes.length === 0 && strongSup.length === 0) {
    return { ok: false, status: 'waiting', reason: 'Gak ada S&R kuat (≥3x touch) yang ketemu' };
  }

  const candidates = [
    ...strongRes.map(l => ({ ...l, type: 'resistance' as const })),
    ...strongSup.map(l => ({ ...l, type: 'support' as const })),
  ];
  const nearest = candidates.reduce((closest, c) =>
    Math.abs(c.price - currentPrice) < Math.abs(closest.price - currentPrice) ? c : closest
  );
  const radius = zoneWidth;
  const dist = Math.abs(nearest.price - currentPrice);
  if (dist > radius) {
    return { ok: false, status: 'waiting', reason: `Harga belum deket S&R kuat manapun (jarak terdekat ${(dist / atrHtf).toFixed(2)}x ATR, radius wajib ≤${(radius / atrHtf).toFixed(2)}x) — level terkuat di ${nearest.price.toFixed(4)} (${nearest.hits}x touch)` };
  }

  const bias: 'bullish' | 'bearish' = nearest.type === 'resistance' ? 'bearish' : 'bullish';
  const edgeUpper = nearest.price + zoneWidth / 2;
  const edgeLower = nearest.price - zoneWidth / 2;

  // ═══ Market Structure V2 — primary gate versi reversal (request user) ════
  const structGateRev = checkStructureV2GateForReversal(htf, bias, tf);
  if (structGateRev.blocked) {
    return { ok: false, status: 'waiting', reason: structGateRev.reason, marketStructureV2: structGateRev.structV2 };
  }
  const structureNote = structGateRev.structureNote;
  const marketStructureV2 = structGateRev.structV2;

  // Cari rejection candle (price action) dalam 24 candle terakhir — WAJIB,
  // bukan bonus. Ini "konfirmasi valid" yang diminta, terpisah dari momentum support.
  const n = htf.closes.length;
  const window = 24;
  let rejectionIdx = -1;
  let wickRatio = 0;
  for (let idx = Math.max(1, n - window); idx < n; idx++) {
    const o = htf.opens[idx]!, h = htf.highs[idx]!, l = htf.lows[idx]!, c = htf.closes[idx]!;
    const body = Math.abs(c - o);
    if (bias === 'bearish') {
      const upperWick = h - Math.max(o, c);
      if (h >= edgeLower && upperWick > body * 1.5 && c < edgeUpper) { rejectionIdx = idx; wickRatio = upperWick / (body || 0.0001); }
    } else {
      const lowerWick = Math.min(o, c) - l;
      if (l <= edgeUpper && lowerWick > body * 1.5 && c > edgeLower) { rejectionIdx = idx; wickRatio = lowerWick / (body || 0.0001); }
    }
  }
  if (rejectionIdx === -1) {
    return { ok: false, status: 'waiting', reason: `Harga udah deket S&R kuat ${nearest.price.toFixed(4)} (${nearest.hits}x touch) TAPI belum ada rejection candle valid di ${window} candle terakhir` };
  }
  const candlesSinceBreakout = n - 1 - rejectionIdx;

  // Momentum support: min 1 dari 3 (RSI ekstrem 20/80 ATAU RSI divergence ATAU Volume divergence)
  const rsi = calcRSI(ltf.closes, 14);
  const rsiExtreme = bias === 'bullish' ? rsi < 20 : rsi > 80;
  const rsiDiv = detectRSIDivergenceGeneric(htf.highs, htf.lows, htf.closes);
  const volDiv = detectVolumeDivergence(htf.highs, htf.lows, htf.closes, htf.volumes);
  const rsiDivSupport = bias === 'bullish' ? rsiDiv.bullish : rsiDiv.bearish;
  const volDivSupport = bias === 'bullish' ? volDiv.bullish : volDiv.bearish;
  const supportNotes: string[] = [];
  if (rsiExtreme) supportNotes.push(`RSI(14) ${rsi.toFixed(1)} ${bias === 'bullish' ? 'oversold (<20)' : 'overbought (>80)'}`);
  if (rsiDivSupport) supportNotes.push('RSI divergence mendukung');
  if (volDivSupport) supportNotes.push('Volume divergence mendukung');
  if (supportNotes.length === 0) {
    return { ok: false, status: 'waiting', reason: `Rejection candle udah ada (${candlesSinceBreakout} candle lalu) di S&R ${nearest.price.toFixed(4)} TAPI belum ada momentum support (RSI ekstrem/divergence)` };
  }

  const entryBuffer = atrHtf * 0.2;
  const slBuffer = atrHtf * 1;
  const dir = bias === 'bullish' ? 1 : -1;
  const entryPrice = bias === 'bullish' ? edgeUpper + entryBuffer : edgeLower - entryBuffer;
  const stopLoss = bias === 'bullish' ? edgeLower - slBuffer : edgeUpper + slBuffer;
  const risk = Math.abs(entryPrice - stopLoss);
  if (risk <= 0) return { ok: false, status: 'waiting', reason: 'Risk tidak valid' };
  const takeProfit1 = entryPrice + risk * 2 * dir; // RR floor 1:2, basis Skill 15M

  const distFromEdge = bias === 'bullish' ? currentPrice - edgeUpper : edgeLower - currentPrice;
  const maxPullback = atrHtf * 1.5;
  if (distFromEdge < 0 || distFromEdge > maxPullback) {
    return {
      ok: true, status: 'approaching', bias, entryPrice, stopLoss, takeProfit1, rr1: 2,
      zoneEdgeUpper: edgeUpper, zoneEdgeLower: edgeLower, candlesSinceBreakout,
      note: `Reversal-ekstrem di S&R terkuat ${nearest.price.toFixed(4)} (${nearest.hits}x touch, wick ${wickRatio.toFixed(1)}x body) — momentum: ${supportNotes.join(', ')}. Nunggu harga balik ke zona entry`,
      structureNote, marketStructureV2,
    };
  }

  return {
    ok: true, status: 'in_zone', bias, entryPrice, stopLoss, takeProfit1, rr1: 2,
    zoneEdgeUpper: edgeUpper, zoneEdgeLower: edgeLower, candlesSinceBreakout,
    note: `Reversal-ekstrem di S&R terkuat ${nearest.price.toFixed(4)} (${nearest.hits}x touch, rejection ${candlesSinceBreakout} candle lalu, wick ${wickRatio.toFixed(1)}x body) — momentum: ${supportNotes.join(', ')}`,
    structureNote, marketStructureV2,
  };
}

/**
 * Breakout-Antisipasi (Menu 8 Momentum Hunter) — basis anticipatory breakout:
 * entry SEBELUM breakout kejadian (STOP order), momentum yang BAGUS itu
 * AKSELERASI (kebalikan dari retest/reversal yang butuh deselerasi).
 * Standalone, gak reuse dari fungsi manapun di Menu 1 (basis Menu 1 sekarang
 * OI Surge Breakout & Funding Rate Kontrarian, konsepnya beda total).
 */
function tryBreakoutAnticipation(
  htf: KlineData, currentPrice: number,
  resistanceLevels: number[], supportLevels: number[], zoneWidth: number, atrHtf: number, tf: TFLabelV2
): ZoneEventOk | ZoneEventFail {
  if (resistanceLevels.length === 0 && supportLevels.length === 0) {
    return { ok: false, status: 'waiting', reason: 'Gak ada zona S/R yang valid' };
  }
  // Coba dua arah (bullish nempel resistance, bearish nempel support) — ambil
  // level TERDEKAT ke currentPrice dari GABUNGAN keduanya
  const resCandidates = resistanceLevels.map(price => ({ price, bias: 'bullish' as const }));
  const supCandidates = supportLevels.map(price => ({ price, bias: 'bearish' as const }));
  const all = [...resCandidates, ...supCandidates];
  const nearest = all.reduce((closest, c) =>
    Math.abs(c.price - currentPrice) < Math.abs(closest.price - currentPrice) ? c : closest
  );
  const bias = nearest.bias;
  const level = nearest.price;
  const edgeUpper = level + zoneWidth / 2;
  const edgeLower = level - zoneWidth / 2;

  // ═══ Market Structure V2 — primary gate (request user) ════════════════
  const structGateAnt = checkStructureV2Gate(htf, bias, tf, `Zona anticipatory (belum breakout) searah bias ${bias} ketemu`);
  if (structGateAnt.blocked) {
    return { ok: false, status: 'waiting', reason: structGateAnt.reason, marketStructureV2: structGateAnt.structV2 };
  }
  const structureNote = structGateAnt.structureNote;
  const marketStructureV2 = structGateAnt.structV2;

  const alreadyBroken = bias === 'bullish' ? currentPrice > edgeUpper : currentPrice < edgeLower;
  if (alreadyBroken) {
    return { ok: false, status: 'waiting', reason: 'Harga udah breakout dari zona terdekat — bukan lagi anticipatory (coba tipe retest)' };
  }

  const approachRadius = zoneWidth;
  const distToEdge = bias === 'bullish' ? edgeUpper - currentPrice : currentPrice - edgeLower;
  if (distToEdge > approachRadius) {
    return { ok: false, status: 'waiting', reason: `Harga masih ${(distToEdge / atrHtf).toFixed(2)}x ATR dari edge terdekat (radius wajib ≤${(approachRadius / atrHtf).toFixed(2)}x)` };
  }

  const n = htf.closes.length;
  let candlesNearEdge = 0;
  for (let i = n - 1; i >= 0; i--) {
    const c = htf.closes[i]!;
    const d = bias === 'bullish' ? edgeUpper - c : c - edgeLower;
    if (d >= 0 && d <= approachRadius) candlesNearEdge++;
    else break;
  }
  if (candlesNearEdge > 12) {
    return { ok: false, status: 'expired', reason: `Harga udah nongkrong ${candlesNearEdge} candle deket edge tanpa breakout — momentum melemah (max 12 candle)` };
  }

  const momentum = detectMomentumTrend(htf, 3);
  const entryBuffer = atrHtf * 0.2;
  const slBuffer = atrHtf * 1;
  const dir = bias === 'bullish' ? 1 : -1;
  const entryPrice = bias === 'bullish' ? edgeUpper + entryBuffer : edgeLower - entryBuffer;
  const stopLoss = bias === 'bullish' ? edgeLower - slBuffer : edgeUpper + slBuffer;
  const risk = Math.abs(entryPrice - stopLoss);
  if (risk <= 0) return { ok: false, status: 'waiting', reason: 'Risk tidak valid' };
  const takeProfit1 = entryPrice + risk * 2 * dir;

  const momentumNote = momentum.accelerating
    ? ` Momentum akselerasi mendekati edge — tanda breakout mendekat.`
    : momentum.decelerating
    ? ` ⚠️ Momentum deselerasi mendekati edge — mungkin kehabisan tenaga.`
    : '';

  return {
    ok: true, status: 'approaching', bias, entryPrice, stopLoss, takeProfit1, rr1: 2,
    zoneEdgeUpper: edgeUpper, zoneEdgeLower: edgeLower, candlesSinceBreakout: candlesNearEdge,
    note: `Breakout-antisipasi di zona ${level.toFixed(4)}, ${candlesNearEdge} candle deket edge.${momentumNote}`,
    momentumFavorable: momentum.accelerating,
    structureNote, marketStructureV2,
  };
}

/**
 * Trend-following: breakout+retest — REPLIKA PERSIS basis Skill 15M (request
 * user: "ubah total pakai basis 15M"). Bias ditentuin dari arah breakout yang
 * KETEMU (bukan pre-determined dari ZigZag) — sama persis kayak Skill 15M asli.
 */
/**
 * FIX (request user): "gunakan retest: entry pada pullback ke level breakout
 * dengan volume yang MENURUN LALU STABIL" — BEDA dari cek sebelumnya yang
 * cuma liat 1 candle terakhir (lastVol < lastVolMA). Sekarang cek POLA dari
 * beberapa candle SEJAK breakout: (1) volume rata-rata pullback HARUS lebih
 * rendah dari volume breakout candle itu sendiri (trending turun), (2)
 * volume candle-candle pullback GAK BOLEH fluktuasi liar (coefficient of
 * variation rendah) — "stabil", bukan naik-turun brutal yang nunjukin
 * ketidakpastian/manipulasi.
 */
function checkVolumeDecliningStable(volumes: number[], breakoutIdx: number, currentIdx: number, breakoutVolume: number): { ok: boolean; reason?: string } {
  const pullbackVols = volumes.slice(breakoutIdx + 1, currentIdx + 1);
  if (pullbackVols.length === 0) return { ok: false, reason: 'Belum ada candle pullback buat dicek' };

  const avgPullbackVol = pullbackVols.reduce((a, b) => a + b, 0) / pullbackVols.length;
  const declining = avgPullbackVol < breakoutVolume;
  if (!declining) return { ok: false, reason: 'Volume pullback rata-rata masih >= volume breakout (belum nunjukin koreksi mereda)' };

  if (pullbackVols.length >= 2) {
    const mean = avgPullbackVol;
    const variance = pullbackVols.reduce((a, b) => a + (b - mean) ** 2, 0) / pullbackVols.length;
    const stdev = Math.sqrt(variance);
    const coefficientOfVariation = mean > 0 ? stdev / mean : 1;
    // CoV > 0.6 dianggap fluktuasi liar (gak stabil) — threshold longgar
    // sengaja (retest 2-3 candle doang, wajar ada variasi dikit)
    if (coefficientOfVariation > 0.6) {
      return { ok: false, reason: `Volume pullback fluktuasi liar (CoV ${coefficientOfVariation.toFixed(2)}) — belum stabil` };
    }
  }
  return { ok: true };
}

async function tryZoneBreakoutRetest(
  htf: KlineData, ltf: KlineData, currentPrice: number,
  resistanceLevels: number[], supportLevels: number[], zoneWidth: number, atrHtf: number,
  tf: TFLabelV2, symbol: string
): Promise<ZoneEventOk | ZoneEventFail> {
  const n = htf.closes.length;
  const volMA20At = (idx: number) => {
    const start = Math.max(0, idx - 20);
    const win = htf.volumes.slice(start, idx);
    return win.length > 0 ? win.reduce((a, b) => a + b, 0) / win.length : 0;
  };

  // FIX (request user): threshold volume breakout NAIK dari 1.4x jadi 1.8x
  // (base, high-cap) — crypto sekarang volatilitas tinggi + banyak manipulasi
  // (wash trading, fake breakout), butuh konfirmasi volume lebih kuat.
  // Koin likuiditas rendah (<500jt USDT/24h) otomatis dinaikin ke ~3.0x.
  const volumeThreshold = await getVolumeBreakoutThreshold(symbol, 1.8);

  // FIX (request user, "tunggu close candle sebelum entry"): candle PALING
  // TERAKHIR dari Binance API bisa aja MASIH BERJALAN (belum closed) — window
  // scan breakout BERHENTI di 'n - 1' (bukan 'n'), jadi breakout CUMA
  // terdeteksi dari candle yang PASTI udah closed. currentPrice/entry-trigger
  // (in_zone check di bawah) TETAP pakai harga live — itu emang perlu
  // real-time buat tau harga SEKARANG udah retest ke zona apa belum.
  const retestWindowMax = 24;
  let found: { direction: 'bullish' | 'bearish'; level: number; edgeUpper: number; edgeLower: number; breakoutPrice: number; breakoutIdx: number } | null = null;

  for (let idx = Math.max(1, n - retestWindowMax); idx < n - 1; idx++) {
    const closeAt = htf.closes[idx]!;
    const volAt = htf.volumes[idx]!;
    const volMA = volMA20At(idx);
    if (volMA <= 0) continue;
    for (const level of resistanceLevels) {
      const edgeUpper = level + zoneWidth / 2;
      const edgeLower = level - zoneWidth / 2;
      if (closeAt > edgeUpper && volAt > volumeThreshold * volMA) found = { direction: 'bullish', level, edgeUpper, edgeLower, breakoutPrice: closeAt, breakoutIdx: idx };
    }
    for (const level of supportLevels) {
      const edgeUpper = level + zoneWidth / 2;
      const edgeLower = level - zoneWidth / 2;
      if (closeAt < edgeLower && volAt > volumeThreshold * volMA) found = { direction: 'bearish', level, edgeUpper, edgeLower, breakoutPrice: closeAt, breakoutIdx: idx };
    }
  }

  if (!found) return { ok: false, status: 'waiting', reason: `Belum ada breakout valid dalam ${retestWindowMax} candle terakhir (threshold volume ${volumeThreshold.toFixed(2)}x MA20)` };

  const bias = found.direction;

  // ═══ Market Structure V2 — primary gate (request user) ═══════════════════
  const structGate = checkStructureV2Gate(htf, bias, tf);
  if (structGate.blocked) {
    return { ok: false, status: 'waiting', reason: structGate.reason, marketStructureV2: structGate.structV2 };
  }
  const structureNote = structGate.structureNote;
  const marketStructureV2 = structGate.structV2;

  const candlesSinceBreakout = n - 1 - found.breakoutIdx;
  const entryBuffer = atrHtf * 0.2;
  const slBuffer = atrHtf * 1;
  const dir = bias === 'bullish' ? 1 : -1;
  const entryPrice = bias === 'bullish' ? found.edgeUpper - entryBuffer : found.edgeLower + entryBuffer;
  const stopLoss = bias === 'bullish' ? found.edgeLower - slBuffer : found.edgeUpper + slBuffer;
  const risk = Math.abs(entryPrice - stopLoss);
  const takeProfit1 = entryPrice + risk * 2 * dir; // RR 1:2, basis Skill 15M

  const inZone = currentPrice <= found.edgeUpper && currentPrice >= found.edgeLower;

  if (!inZone) {
    if (candlesSinceBreakout > retestWindowMax) {
      return { ok: false, status: 'expired', reason: `Breakout ${bias} udah lewat retest window (${candlesSinceBreakout} candle, max ${retestWindowMax})` };
    }
    return {
      ok: true, status: 'approaching', bias, entryPrice, stopLoss, takeProfit1, rr1: 2,
      zoneEdgeUpper: found.edgeUpper, zoneEdgeLower: found.edgeLower, candlesSinceBreakout,
      note: `Breakout ${bias} dari ${found.level.toFixed(4)}, ${candlesSinceBreakout} candle lalu — nunggu retest`,
      structureNote, marketStructureV2,
    };
  }

  const pullbackDepth = Math.abs(found.breakoutPrice - currentPrice);
  if (pullbackDepth > atrHtf * 1.5) {
    return { ok: false, status: 'expired', reason: `Pullback udah kelewat dalam (${pullbackDepth.toFixed(4)} > max ${(atrHtf * 1.5).toFixed(4)})` };
  }

  const lastVol = htf.volumes[n - 1]!;
  const lastVolMA = volMA20At(n - 1);
  // FIX (request user): retest volume MENURUN LALU STABIL, bukan cuma cek
  // 1 candle terakhir doang — lihat comment checkVolumeDecliningStable.
  const breakoutVolume = htf.volumes[found.breakoutIdx]!;
  const declineCheck = checkVolumeDecliningStable(htf.volumes, found.breakoutIdx, n - 1, breakoutVolume);
  if (!declineCheck.ok) return { ok: false, status: 'expired', reason: declineCheck.reason ?? 'Pullback volume masih tinggi (belum nunjukin koreksi lemah)' };

  let confirmCount = 0;
  const rejectionVolumeOk = lastVolMA > 0 && lastVol >= 1.2 * lastVolMA;
  if (rejectionVolumeOk) confirmCount++;
  const nLtf = ltf.closes.length;
  const rsiLtf = calcRSI(ltf.closes, 14);
  const macdLtf = calcMACD(ltf.closes);
  const momentumAlign = bias === 'bullish' ? (rsiLtf > 50 && macdLtf.histogram > 0) : (rsiLtf < 50 && macdLtf.histogram < 0);
  if (momentumAlign) confirmCount++;
  if (confirmCount < 1) return { ok: false, status: 'expired', reason: 'Belum ada konfirmasi tambahan (rejection volume / momentum align) yang lolos' };

  // Momentum check (request user): buat RETEST, momentum yang BAGUS itu
  // DESELERASI (pullback ngempos = sehat, bukan reversal beneran). Akselerasi
  // pas retest itu warning (pullback masih kenceng, rawan gak balik lagi).
  const momentum = detectMomentumTrend(ltf, 3);
  const momentumNote = momentum.decelerating
    ? ` Momentum deselerasi mendekati retest (range ${(momentum.rangeRatio * 100).toFixed(0)}%, vol ${(momentum.volRatio * 100).toFixed(0)}% dari 3 candle sebelumnya) — pullback sehat, bonus konfluensi.`
    : momentum.accelerating
    ? ` ⚠️ Momentum masih akselerasi pas retest (range ${(momentum.rangeRatio * 100).toFixed(0)}%, vol ${(momentum.volRatio * 100).toFixed(0)}%) — pullback masih kenceng, waspada.`
    : '';

  return {
    ok: true, status: 'in_zone', bias, entryPrice, stopLoss, takeProfit1, rr1: 2,
    zoneEdgeUpper: found.edgeUpper, zoneEdgeLower: found.edgeLower, candlesSinceBreakout,
    note: `Breakout ${bias} + retest ke ${found.level.toFixed(4)} dikonfirmasi (${confirmCount}/2 konfirmasi tambahan).${momentumNote}`,
    momentumFavorable: momentum.decelerating,
    structureNote, marketStructureV2,
  };
}

/**
 * Range: rejection+retest — ADAPTASI basis Skill 15M buat kondisi ranging
 * (request user, approved). Bedanya dari breakout: "event"-nya REJECTION di
 * salah satu dari 2 zona (S&R sepasang yang ngapit harga), bukan breakout.
 * Bias-nya MEAN-REVERSION (rejection di resistance = short, di support = long).
 */
function tryZoneRejectionRetest(
  htf: KlineData, ltf: KlineData, currentPrice: number,
  resistanceLevels: number[], supportLevels: number[], zoneWidth: number, atrHtf: number,
  tf: TFLabelV2
): ZoneEventOk | ZoneEventFail {
  const n = htf.closes.length;

  // Butuh pasangan S&R yang genuinely ngapit harga sekarang
  const resAbove = resistanceLevels.filter(l => l > currentPrice);
  const supBelow = supportLevels.filter(l => l < currentPrice);
  if (resAbove.length === 0 || supBelow.length === 0) {
    return { ok: false, status: 'waiting', reason: 'Gak ada pasangan S&R yang ngapit harga sekarang' };
  }
  const nearestRes = Math.min(...resAbove);
  const nearestSup = Math.max(...supBelow);
  if (nearestRes - nearestSup < atrHtf * 1) {
    return { ok: false, status: 'waiting', reason: `Range cuma ${((nearestRes - nearestSup) / atrHtf).toFixed(2)}x ATR — kesempitan, butuh ≥1x` };
  }

  const volMA20At = (idx: number) => {
    const start = Math.max(0, idx - 20);
    const win = htf.volumes.slice(start, idx);
    return win.length > 0 ? win.reduce((a, b) => a + b, 0) / win.length : 0;
  };

  const windowMax = 24;
  let found: { direction: 'bullish' | 'bearish'; edge: number; rejectIdx: number } | null = null;

  for (let idx = Math.max(1, n - windowMax); idx < n; idx++) {
    const o = htf.opens[idx]!, h = htf.highs[idx]!, l = htf.lows[idx]!, c = htf.closes[idx]!;
    const body = Math.abs(c - o);
    const edgeUpperRes = nearestRes + zoneWidth / 2;
    const edgeLowerRes = nearestRes - zoneWidth / 2;
    const edgeUpperSup = nearestSup + zoneWidth / 2;
    const edgeLowerSup = nearestSup - zoneWidth / 2;
    // Rejection di resistance: high masuk zona TAPI close nolak balik ke bawah
    const upperWick = h - Math.max(o, c);
    if (h >= edgeLowerRes && upperWick > body * 1.5 && c < edgeUpperRes) {
      found = { direction: 'bearish', edge: nearestRes, rejectIdx: idx };
    }
    // Rejection di support: low masuk zona TAPI close nolak balik ke atas
    const lowerWick = Math.min(o, c) - l;
    if (l <= edgeUpperSup && lowerWick > body * 1.5 && c > edgeLowerSup) {
      found = { direction: 'bullish', edge: nearestSup, rejectIdx: idx };
    }
  }

  if (!found) return { ok: false, status: 'waiting', reason: `Belum ada rejection candle valid di boundary manapun dalam ${windowMax} candle terakhir` };

  const bias = found.direction;

  // ═══ Market Structure V2 — primary gate versi reversal (request user) ════
  const structGate = checkStructureV2GateForReversal(htf, bias, tf);
  if (structGate.blocked) {
    return { ok: false, status: 'waiting', reason: structGate.reason, marketStructureV2: structGate.structV2 };
  }
  const structureNote = structGate.structureNote;
  const marketStructureV2 = structGate.structV2;

  const candlesSinceBreakout = n - 1 - found.rejectIdx;
  const edgeUpper = found.edge + zoneWidth / 2;
  const edgeLower = found.edge - zoneWidth / 2;

  // Invalidate: abis rejection, kalau harga BALIK nembus edge ke arah rejection
  // (bukan mean-revert kayak yang diharepin) → setup gagal.
  for (let idx = found.rejectIdx + 1; idx < n; idx++) {
    const c = htf.closes[idx]!;
    if (bias === 'bearish' && c > edgeUpper) return { ok: false, status: 'expired', reason: 'Harga nembus balik ke atas resistance — rejection invalid' };
    if (bias === 'bullish' && c < edgeLower) return { ok: false, status: 'expired', reason: 'Harga nembus balik ke bawah support — rejection invalid' };
  }
  if (candlesSinceBreakout > windowMax) {
    return { ok: false, status: 'expired', reason: `Rejection udah lewat window (${candlesSinceBreakout} candle, max ${windowMax})` };
  }

  const entryBuffer = atrHtf * 0.2;
  const slBuffer = atrHtf * 1;
  const dir = bias === 'bullish' ? 1 : -1;
  const entryPrice = bias === 'bullish' ? edgeUpper + entryBuffer : edgeLower - entryBuffer; // masuk ke dalam range
  const stopLoss = bias === 'bullish' ? edgeLower - slBuffer : edgeUpper + slBuffer;
  const risk = Math.abs(entryPrice - stopLoss);
  const oppositeLevel = bias === 'bullish' ? nearestRes : nearestSup;
  const targetDist = Math.abs(oppositeLevel - entryPrice);
  const rrToOpposite = risk > 0 ? targetDist / risk : 0;
  const rr1 = Math.max(2, rrToOpposite); // floor RR 1:2, dipake yang lebih gede kalau jarak asli ngasih lebih
  const takeProfit1 = entryPrice + risk * rr1 * dir;

  // "in_zone" kalau harga udah balik deket entry (dalem radius maxPullback dari edge)
  const distFromEdge = bias === 'bullish' ? currentPrice - edgeUpper : edgeLower - currentPrice;
  const maxPullback = atrHtf * 1.5;
  if (distFromEdge < 0 || distFromEdge > maxPullback) {
    return {
      ok: true, status: 'approaching', bias, entryPrice, stopLoss, takeProfit1, rr1,
      zoneEdgeUpper: edgeUpper, zoneEdgeLower: edgeLower, candlesSinceBreakout,
      note: `Rejection ${bias === 'bullish' ? 'bullish di support' : 'bearish di resistance'} ${found.edge.toFixed(4)}, ${candlesSinceBreakout} candle lalu — nunggu harga balik ke zona entry`,
      structureNote, marketStructureV2,
    };
  }

  const lastVol = htf.volumes[n - 1]!;
  const lastVolMA = volMA20At(n - 1);
  let confirmCount = 0;
  const rejectionVolumeOk = lastVolMA > 0 && lastVol >= 1.2 * lastVolMA;
  if (rejectionVolumeOk) confirmCount++;
  const rsiLtf = calcRSI(ltf.closes, 14);
  const rsiExtremeOk = bias === 'bullish' ? rsiLtf < 35 : rsiLtf > 65;
  if (rsiExtremeOk) confirmCount++;
  if (confirmCount < 1) return { ok: false, status: 'expired', reason: 'Belum ada konfirmasi tambahan (rejection volume / RSI ekstrem) yang lolos' };

  // Momentum check: buat REJECTION, deselerasi mendekati boundary itu bagus
  // (harga kehabisan tenaga = rejection lebih mungkin bertahan/mantul).
  const momentum = detectMomentumTrend(ltf, 3);
  const momentumNote = momentum.decelerating
    ? ` Momentum deselerasi di boundary (range ${(momentum.rangeRatio * 100).toFixed(0)}%, vol ${(momentum.volRatio * 100).toFixed(0)}%) — rejection lebih mungkin bertahan, bonus konfluensi.`
    : momentum.accelerating
    ? ` ⚠️ Momentum masih akselerasi di boundary (range ${(momentum.rangeRatio * 100).toFixed(0)}%, vol ${(momentum.volRatio * 100).toFixed(0)}%) — rawan tembus, waspada.`
    : '';

  return {
    ok: true, status: 'in_zone', bias, entryPrice, stopLoss, takeProfit1, rr1,
    zoneEdgeUpper: edgeUpper, zoneEdgeLower: edgeLower, candlesSinceBreakout,
    note: `Rejection ${bias === 'bullish' ? 'bullish di support' : 'bearish di resistance'} ${found.edge.toFixed(4)} + retest dikonfirmasi (${confirmCount}/2 konfirmasi tambahan), target ${oppositeLevel.toFixed(4)}.${momentumNote}`,
    momentumFavorable: momentum.decelerating,
    structureNote, marketStructureV2,
  };
}

/**
 * Extreme Scalping v5 — REWRITE TOTAL (request user: "ubah total pakai basis
 * 15M"). Struktur M15 -> eksekusi M5. Coba trend (breakout+retest) dulu; kalau
 * 'waiting' (belum ada breakout), coba range (rejection+retest). BTC Correlation
 * hard filter di kedua jalur.
 */
// ─── H1 Zone Detection (pivot 3 kiri-kanan, merge jadi zona, hitung touches) —
// basis skill Quant baru, request user setelah backtest ekstensif di luar app.
interface H1Zone { low: number; high: number; mid: number; touches: number; type: 'support' | 'resistance' }

function findH1Pivots(highs: number[], lows: number[], leftRight: number = 3): { ph: number[]; pl: number[] } {
  const ph: number[] = []; const pl: number[] = [];
  for (let i = leftRight; i < highs.length - leftRight; i++) {
    const windowH = highs.slice(i - leftRight, i + leftRight + 1);
    const windowL = lows.slice(i - leftRight, i + leftRight + 1);
    if (highs[i] === Math.max(...windowH)) ph.push(highs[i]!);
    if (lows[i] === Math.min(...windowL)) pl.push(lows[i]!);
  }
  return { ph, pl };
}

function mergeIntoH1Zones(pivots: number[], tolerance: number, type: 'support' | 'resistance'): H1Zone[] {
  if (pivots.length === 0) return [];
  const sorted = [...pivots].sort((a, b) => a - b);
  const zones: H1Zone[] = [];
  let group: number[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! - group[group.length - 1]! <= tolerance) {
      group.push(sorted[i]!);
    } else {
      zones.push({ low: Math.min(...group), high: Math.max(...group), mid: group.reduce((a, b) => a + b, 0) / group.length, touches: group.length, type });
      group = [sorted[i]!];
    }
  }
  zones.push({ low: Math.min(...group), high: Math.max(...group), mid: group.reduce((a, b) => a + b, 0) / group.length, touches: group.length, type });
  return zones;
}

/**
 * Extreme Scalping — Skill Quant REWRITE TOTAL v5 (request user, basis
 * backtest ekstensif di luar app: strategi awal dari saran AI lain gagal
 * total — WR 46.8%, net -0.421R. v1-v3 nunggu M15 rejection+break struktur
 * dulu sebelum entry — WR terbaik yang tervalidasi 46.3% (95 trade).
 *
 * BREAKTHROUGH v4 (ide user): GANTI mekanisme entry — bukan nunggu pola
 * rejection+break M15 (yang jarang terjadi), tapi entry LANGSUNG begitu
 * harga M15 masuk ke zona H1 (kayak limit order), DAN SL pake ATR H1
 * (lebih stabil/lebar dari ATR M15 yang noisy). Efeknya GANDA: sample
 * MELEDAK dari 95 -> 580 trade (7x lipat), DAN winrate NAIK (46.3% ->
 * 53.8%). Ditambah RSI filter (WAJIB searah bias, deviasi dari 50 >=5)
 * -> WR 63.9%, 255 trade.
 *
 * TUNING v5 (request user "kejar WR potensial 87.2%" dari afterlife
 * analysis): SL buffer di-tuning dari 0.3xATR H1 turun ke 0.1xATR H1.
 * Sempat coba 0.05 (WR tertinggi 71.9%, SANGAT konsisten gap 2.6pp),
 * TAPI user pilih 0.1 sebagai titik tengah (SL 0.05 dianggap terlalu
 * sempit, resiko slippage/eksekusi di real trading) — VERSI FINAL:
 * WR 64.7-70.2% (3-way split, gap 5.5pp, KONSISTEN). 5 koin
 * (BTC/ETH/SOL/BNB/XRP), 318 trade.
 *
 * Alur (SEMUA WAJIB):
 * 1. H1 — swing pivot (3 candle) -> merge jadi zona (toleransi 0.5x ATR
 *    H1) -> filter zona (support DAN resistance) yang disentuh >=3x
 * 2. PRIORITAS BUY: cek dulu setup di support (H1 bullish/range). BARU
 *    kalau BUY gak ada, cek SELL di resistance — TAPI SELL CUMA VALID
 *    kalau H1 = range (BUKAN bearish jelas)
 * 3. Entry LANGSUNG kalau candle M15 sekarang overlap sama zona (harga
 *    high/low candle nyentuh range zona) — TANPA nunggu konfirmasi
 *    rejection/break struktur dulu
 * 4. RSI M15 WAJIB searah bias, deviasi dari 50 minimal 5 poin (BUY
 *    butuh RSI>=55, SELL butuh RSI<=45) — momentum udah mulai ke arah
 *    breakout, bukan netral/lawan
 * 5. BTC Correlation
 * 6. Entry di tengah zona (zone.mid), SL luar zona - 0.1xATR H1 (SL
 *    LEBIH SEMPIT dari v4, hasil tuning lanjutan), RR fixed 1:2
 *
 * CATATAN JUJUR: sample masih JAUH lebih kecil dari validasi Menu 8
 * (144+ trade) — di sini 318 trade, TAPI dengan SL yang lebih sempit,
 * eksekusi real-trading BUTUH kehati-hatian ekstra soal slippage/spread
 * dibanding versi v4 (buffer 0.3xATR). Afterlife analysis (WR potensial
 * 87.2%) itu BELUM sepenuhnya "dikejar" — masih ada gap ke potensial,
 * tapi ini versi PALING ROBUST yang pernah ditemukan buat skill ini.
 */
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

  const structV2 = analyzeMarketStructureV2(opens, highs, lows, closes, tf);
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

/**
 * Menu 8 — Momentum Hunter. Scan 4 pasangan TF (15M→1M, 5M→1M, H1→15M, H4→M30)
 * nyari 3 tipe setup basis Skill 15M (retest > reversal-ekstrem >
 * breakout-antisipasi, urutan prioritas ini + urutan TF sesuai request user),
 * fallback single-TF (15M/5M/H1) kalau market sideways di semua TF trend.
 * Fetch cuma 6x (bukan 15x) — tiap TF unique di-fetch sekali, dipake ulang.
 */
/**
 * Momentum Hunter — REWRITE TOTAL (request user, basis backtest ekstensif
 * di luar app pakai Binance MCP langsung: 14+ strategi dicoba, WR 58.3%
 * KONSISTEN di 2 periode berbeda, 7 koin, 144 trade — paling stabil dari
 * semua yang dites). Gantiin Pump/Dump Entry lama.
 *
 * Basis: Taker Buy Ratio Breakout — breakout M30 dikonfirmasi arah
 * tekanan transaksi GENUINE (taker buy ratio, bukan cuma harga+volume
 * biasa yang gak bisa bedain arah), plus struktur H4, MACD, dan ekspansi
 * volatilitas. SL pakai ATR H1 (lebih stabil dari ATR M30 sendiri).
 *
 * Alur (SEMUA WAJIB):
 * 1. M30 — breakout (close tembus resistance/support 10 candle) + volume
 *    ≥1.3x MA20 + taker buy ratio ≥52% (bullish) / ≤48% (bearish)
 * 2. H4 — Market Structure V2, WAJIB gak berlawanan arah breakout
 * 3. M30 — MACD histogram searah bias
 * 4. M30 — Volatility Expansion: ATR(14) sekarang ≥1.1x ATR 10 candle
 *    lalu (breakout genuine = volatilitas MELEBAR)
 * 5. BTC Correlation (skip kalau symbol = BTC sendiri)
 * 6. Entry LANGSUNG harga sekarang, SL window low/high 5 candle M30 +
 *    buffer ATR(14) H1 x 0.5, TP RR 1:1
 *
 * CATATAN JUJUR dari hasil backtest: WR 58.3% itu BELUM 60%, dan makin
 * ketat filter yang dicoba (RSI, ADX, threshold lebih tinggi) makin
 * beresiko overfit ke sample kecil — 7 lapis filter ini adalah titik
 * PALING KONSISTEN yang ketemu, bukan yang PALING TINGGI winrate-nya.
 */
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
  status: 'siap_breakout' | 'siap_retest' | 'no_setup' | 'error' | 'waiting' | 'approaching' | 'expired';
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
}

export async function analyzeCounterStructural(symbol: string): Promise<BreakoutTradingResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';
  const maxScore = 100;
  const THRESHOLD = 0.15; // ASLI dari project GitHub, MultiFactorScoreStrategy default

  try {
    const [h1, tickerRes] = await Promise.all([
      fetchKlines(symbol, '1h', 720),
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);
    const currentPrice = tickerRes.ok
      ? parseFloat((await tickerRes.json() as { price: string }).price)
      : h1.closes[h1.closes.length - 1]!;

    const n1 = h1.closes.length;
    if (n1 < 100) {
      return { status: 'error', symbol, currentPrice, timestamp, message: 'Data H1 gak cukup (butuh 100+ candle)', maxScore };
    }

    const score = computeMultiFactorScore(h1.highs, h1.lows, h1.closes);
    const bias: 'bullish' | 'bearish' | null = score.composite >= THRESHOLD ? 'bullish' : score.composite <= -THRESHOLD ? 'bearish' : null;
    if (!bias) {
      return {
        status: 'no_setup', symbol, currentPrice, timestamp,
        message: `Composite score ${score.composite.toFixed(3)} belum nembus threshold ±${THRESHOLD}`,
        maxScore,
      };
    }

    // FIX (request user, data live Journal — Counter Scalping paling lemah
    // WR 26%, CCI ekstrem muncul di 54% LOSE): filter indikator sekarang
    // dicek juga di sini, pakai data H1 yang udah di-fetch (Counter Scalping
    // cuma 1 TF, beda dari Menu Scalping yang punya H4 terpisah).
    const exhaustionCheck = checkIndicatorExhaustion(h1.highs, h1.lows, h1.closes, h1.volumes, bias);
    if (exhaustionCheck.blocked) {
      return { status: 'no_setup', symbol, bias, currentPrice, timestamp, message: exhaustionCheck.reason!, maxScore };
    }

    // Entry di level breakout genuine (belum retest) — lihat comment
    // findFreshBreakoutLevel di atas buat detail syarat & catatan backtest.
    const freshLevel = findFreshBreakoutLevel(h1, bias);
    if (freshLevel === null) {
      return { status: 'no_setup', symbol, bias, currentPrice, timestamp, message: 'Gak ada level breakout fresh (belum retest) yang lolos struktur', maxScore };
    }
    const pullbackValid = bias === 'bullish' ? freshLevel < currentPrice : freshLevel > currentPrice;
    if (!pullbackValid) {
      return { status: 'no_setup', symbol, bias, currentPrice, timestamp, message: 'Level breakout ada di sisi salah dari harga sekarang', maxScore };
    }

    // SL/TP: ATR Wilder (calcATR, dipake dari basis existing Cryptodantt) —
    // dihitung dari entry BARU (level breakout), bukan dari harga sekarang.
    const atrH1 = calcATR(h1.highs, h1.lows, h1.closes);
    const dirMult = bias === 'bullish' ? 1 : -1;
    const entryPrice = freshLevel;
    const stopLoss = entryPrice - atrH1 * dirMult;
    const takeProfit1 = entryPrice + atrH1 * 2 * dirMult;

    // Status: 'siap_retest' kalau harga UDAH nyentuh level breakout (dalam
    // toleransi kecil), 'approaching' kalau masih nunggu harga turun/naik
    // ke level itu (given ini limit order, bukan entry market langsung).
    const priceGap = Math.abs(currentPrice - freshLevel) / freshLevel;
    const atPullback = priceGap < 0.005; // toleransi 0.5%

    const filterResults = [
      `✅ Composite score: ${score.composite.toFixed(3)} (threshold ±${THRESHOLD})`,
      `SuperTrend: ${score.supertrendScore > 0 ? 'bullish' : 'bearish'}`,
      `RSI(14): ${score.rsiValue.toFixed(1)} (score ${score.rsiScore})`,
      `MACD: ${score.macdScore > 0 ? 'bullish cross' : score.macdScore < 0 ? 'bearish cross' : 'netral'}`,
      `Bollinger: score ${score.bollingerScore}`,
      `✅ Indikator gak overbought/oversold/hollow — CCI ${exhaustionCheck.cci.toFixed(0)}, MFI ${exhaustionCheck.mfi.toFixed(1)}`,
      `✅ Level breakout fresh terdeteksi (belum pernah retest): ${entryPrice.toFixed(6)}`,
      atPullback
        ? `✅ Harga udah di level breakout (${entryPrice.toFixed(6)})`
        : `⏳ Nunggu retrace ke level breakout ${entryPrice.toFixed(6)} (harga sekarang ${currentPrice.toFixed(6)}, gap ${(priceGap*100).toFixed(2)}%)`,
    ];

    // FIX (request user): BTC Correlation SEKARANG SOFT FILTER doang — GAK
    // NGE-BLOCK sinyal lagi walaupun BTC lawan arah. Cuma nempel WARNING di
    // filterResults biar user TETEP TAU kondisi BTC pas ambil keputusan
    // sendiri, tapi keputusan FINAL diserahin ke user.
    const btcCheck = await checkBtcAlignment(bias, symbol, '1h', 720);
    if (btcCheck.btcBias !== 'ranging' && !btcCheck.aligned) {
      filterResults.push(`⚠️ ${btcCheck.message} (soft warning — sinyal tetep lolos, pertimbangin sendiri)`);
    } else {
      filterResults.push(btcCheck.message || '✅ BTC lagi ranging — netral');
    }

    // FIX (request user): filter S&R+overbought BERTINGKAT (H1->H4->D1) —
    // SOFT WARNING (bukan block).
    const srConfluenceCounter = await checkMultiTFSRConfluence(symbol, bias);
    if (srConfluenceCounter.danger && srConfluenceCounter.detail) {
      filterResults.push(`⚠️ Harga deket zona S&R KUAT (${srConfluenceCounter.detail.zoneTouches}x touches) di ${srConfluenceCounter.dangerTf}, DIPERKUAT RSI ${srConfluenceCounter.detail.rsi.toFixed(1)} (${bias === 'bullish' ? 'overbought' : 'oversold'}) — jarak ${srConfluenceCounter.detail.distanceAtrRatio?.toFixed(2)}x ATR, potensi resiko reversal (soft warning — sinyal tetep lolos)`);
    }

    const technicalSnapshotCounter = await buildTechnicalSnapshot(h1, h1, symbol);
    return {
      status: atPullback ? 'siap_retest' : 'approaching', symbol, bias, currentPrice, timestamp,
      maxScore, filterResults,
      entryPrice, orderType: 'limit', stopLoss, takeProfit1, rr1: 2,
      technicalSnapshot: technicalSnapshotCounter,
      btcAligned: btcCheck.aligned, btcBias: btcCheck.btcBias,
      message: `${atPullback ? 'SIAP ENTRY' : 'MENDEKATI'} (${bias === 'bullish' ? 'BUY' : 'SELL'}) — Multi-Factor Score ${score.composite.toFixed(3)}, entry di level breakout fresh`,
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
// ALL-MENUS ANALYSIS — menu baru, analisa 1 koin di SEMUA menu sekaligus
// (Breakout Entry x2 skill, Sniper x2 skill, Scalping x2 skill, Extreme
// Scalping x2 skill, + Multi-TF breakdown). Search-only, gak ada tab Scan
// sendiri — user cari 1 symbol, langsung liat semua hasil.
// ═══════════════════════════════════════════════════════════════════════════

export interface AllMenusResult {
  symbol: string;
  timestamp: string;
  breakoutCounterStructural: BreakoutTradingResult | null; // Menu Counter Scalping (dulu Breakout Entry)
  scalpingStructural: ScalpingResult | null;
  scalpingM15: ScalpingResult | null;
  multiTf: MultiTFDetailResult | null;
}

/**
 * Analisa 1 koin di SEMUA menu sekaligus — 4 fungsi dipanggil paralel
 * (request user, Sniper/Momentum Hunter/Extreme Scalping DIHAPUS, fokus
 * cuma Counter Scalping + Scalping). Tiap fungsi dibungkus try-catch
 * individual (Promise.allSettled) biar 1 menu gagal gak bikin SEMUA
 * hasil ilang — yang gagal cukup jadi null, bagian lain tetep tampil.
 */
export async function analyzeAllMenus(symbol: string): Promise<AllMenusResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';

  const [
    breakoutCounterStructural,
    scalpingStructural, scalpingM15,
    multiTf,
  ] = await Promise.allSettled([
    analyzeCounterStructural(symbol),
    analyzeScalpingEntry(symbol),
    analyzeScalping15M(symbol),
    analyzeMultiTFDetail(symbol),
  ]);

  const pick = <T,>(r: PromiseSettledResult<T>): T | null => r.status === 'fulfilled' ? r.value : null;

  return {
    symbol, timestamp,
    breakoutCounterStructural: pick(breakoutCounterStructural),
    scalpingStructural: pick(scalpingStructural),
    scalpingM15: pick(scalpingM15),
    multiTf: pick(multiTf),
  };
}
