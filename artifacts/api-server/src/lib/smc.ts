// SMC (Smart Money Concepts) Analysis Library
// Implements top-down analysis: H4 → H1 → 15M → 5M

import { spawn } from 'child_process';
import nodePath from 'path';
import nodeFs from 'fs';
import { CRT_PARAMS } from './crt-engine';

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


export interface SRLevel {
  price: number;
  touches: number;
  type: "support" | "resistance";
}


export interface FibLevels {
  swingHigh: number;
  swingLow: number;
  levels: Record<string, number>;
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


// ─── Data Fetching ────────────────────────────────────────────────────────────

// Cache klines untuk kurangi request ke Binance
const klinesCache = new Map<string, { data: KlineData; ts: number }>();
const KLINES_CACHE_MS = 5 * 60 * 1000; // 5 menit

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number,
  fresh = false // true = lewati cache 5 menit (dipakai Scalping CRT: status limit & candle close harus akurat)
): Promise<KlineData> {
  const cacheKey = `${symbol}_${interval}_${limit}`;
  const cached = klinesCache.get(cacheKey);
  if (!fresh && cached && Date.now() - cached.ts < KLINES_CACHE_MS) return cached.data;

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
    const data = (await res.json()) as unknown[][];
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


// ─── 12 indikator tambahan buat Journal Trading (request user) ────────────────


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


// ═══ TECHNICAL ANALYSIS PRO — DEFAULT FETCH CANDLE (request user,
// standardisasi Fitur 1-7 biar konsisten semua). Scope TA PRO DOANG --
// Menu Scalping & Money Magnet Scalping TETEP pakai window candle masing-
// masing (udah di-tuning khusus buat logic structural-nya, gak disentuh).
// M30 dinaikin ke 30 (bukan 24 sesuai angka asli) -- ADX butuh minimal 2x
// period (=28 candle) buat valid, di bawah itu ADX otomatis balik 0/invalid
// (request user, biar M30 tetep kepake di Fitur 2 Multi TF Reading).
export const TA_PRO_CANDLE_LIMIT: Record<'D1' | 'H4' | 'H1' | 'M30' | 'M15' | 'M5' | 'M1', number> = {
  D1: 100, H4: 100, H1: 200, M30: 50, M15: 100, M5: 100, M1: 100,
};

// BTC Correlation (Fitur 7) pakai budget candle sendiri (spec user): H4 200,
// D1 100 (OI histori jumlahnya sama). Rasio BTC/Gold: 100 candle D1.
const BTC_CORR_CANDLES = { H4: 200, D1: 100 } as const;

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


interface MSV2SwingPoint { price: number; index: number; }

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
  const highs = fullHighs, lows = fullLows, closes = fullCloses;
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


// ─── Step 6: Skip Conditions ──────────────────────────────────────────────────


// ─── Teori Dow: Deteksi Fase Trend ───────────────────────────────────────────


// ─── Teori Dow: Volume Konfirmasi Trend ──────────────────────────────────────


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
  mmCrtVersion?: string;            // Money Magnet CRT: versi filter ('mm2' = + cek Fib 0,705 leg H1, 'mm3' = + SL Fib 0,71 dan TP2 RR 1:3)
  mmH1Struct?: 'ok' | 'unknown';   // hasil cek struktur H1 (patah = sinyal ditolak, tidak sampai ke sini)
  mmH1Fib705?: number;             // level Fib 0,705 leg H1 (harga asli), kalau leg terbentuk
  mmSlMode?: 'fib' | 'atr';        // mm3: 'fib' = SL di Fib 0,71 leg sweep->displacement, 'atr' = fallback SL 2 x ATR M5 (leg tidak terbentuk)
  mmFib0?: number;                 // harga Fib 0 (ujung leg searah sinyal), mode fib
  mmFib1?: number;                 // harga Fib 1 (awal leg), mode fib
  btcBias?: 'bullish' | 'bearish' | 'ranging';
  // ═══ Breakout Retest Strategy M15 (request user, REVISI TOTAL skill 15M) ══
  takeProfit3?: number; // TP3 (4.4% dari entry)
  pullbackRatio?: number; // kedalaman pullback / breakout move (harus 0.25-0.618)
  entryLimitLevel?: 'aggressive' | 'moderate' | 'conservative'; // level mana yang dipakai (selalu 'moderate')
  validUntilCandles?: number; // order valid berapa candle (4)
  setupType?: 'reversal' | 'failure_to_manipulate';
  // ═══ Money Magnet Concept (request user, REVISI TOTAL skill Structural) ═══
  h4CrossCount?: number; // berapa kali H4 crossing EMA26 dalam 20 candle terakhir (>3 = exhausted)
  forceIndexValue?: number; // Force Index (EMA2) di candle retest
  stochSlowAtRetest?: { k: number; d: number }; // Stochastic Slow (5,3,3) di candle retest -- BONUS doang, gak block
  magnetLevelUsed?: 'broken_level' | 'ema26'; // level mana yang dipilih jadi entry (paling deket ke harga)
  magnetConfluencePct?: number; // jarak % antara broken level vs EMA26 M30
  // ═══ Scalping CRT D1→M15 (2026-10-22) ═══
  crtVersion?: string;
  crtOrderNo?: number;       // order ke-berapa di hari+arah itu (urutan waktu MSS)
  crtD1RangeAtr?: number;    // range D1 kemarin / ATR14 D1
  crtD1High?: number;
  crtD1Low?: number;
  crtD1Mid?: number;
  crtDepthPct?: number;      // kedalaman sweep, persen
  crtPosPct?: number;        // posisi entry di range D1, persen (0 = ekstrem sweep)
  crtRoomR?: number;         // ruang ke High/Low D1 dalam R
  crtRiskAtr?: number;       // risk / ATR14 M15
  crtSweepExtreme?: number;
  crtMssTime?: number;       // open time candle MSS (ms)
  // ═══ Scalping Retest Fib (2026-10-26; TF H1→M5 sejak 2026-10-27) ═══
  rpVersion?: string;
  rpAdxD1?: number;          // ADX(14) D1 saat sinyal (aturan > 25)
  rpRsiD1?: number;          // LEGACY (rp1/rp2): RSI(14) TF struktur saat sinyal
  rpFiH1?: number;           // rp3: Force Index EMA2 H1 saat sinyal (LONG > 0, SHORT < 0)
  rpSwingHigh?: number;      // ujung leg Fibonacci (harga asli)
  rpSwingLow?: number;
  rpRangeAtr?: number;       // range leg / ATR H1
  rpLegAgeBars?: number;     // umur swing akhir leg, candle H1
  rpZoneLo?: number;         // zona retrace 0,5-0,618
  rpZoneHi?: number;
  rpBasis?: 'fvg' | 'ob' | 'snr' | 'mid'; // dasar level limit
  rpConfluence?: string;     // mis. 'FVG+SNR' ('' = tidak ada)
  rpRetracePct?: number;     // posisi limit dalam retrace (0,5-0,618)
  validUntilMs?: number;     // limit batal setelah ini (ms epoch)
  moneyMagnetVariant?: 'standard' | 'dual_level'; // 'dual_level' = 1 candle nembus 2 SNR sekaligus (entry di SNR2, SL di SNR1) -- ditampilkan Journal sebagai "Money Magnet 2"
  // ═══ Bonus cross-menu (request user): cek sinyal ini SEARAH sama Fitur 5
  // Technical Analysis PRO (Skor Long vs Short) apa enggak. Gak nge-block,
  // cuma info/badge tambahan buat UI.
  taProBonusConfirmed?: boolean;
  taProBonusClassification?: string | null;
  taProBonusScore?: number;
  // ═══ Turtle Soup (deep entry) -- ALTERNATIF ke entry utama (shallow/PO3-
  // style), request user setelah cross-check vs CRT PO3 Micro Model. Entry
  // ditarik lebih dalam (78,6% retrace candle konfirmasi, menuju arah sweep
  // extreme) dengan SL yang SAMA PERSIS (sweepExtreme). Informasional/opsional
  // doang -- skor 16 poin & status in_zone/waiting tetep dari entry utama,
  // gak ngerubah logic yang udah ada. User pilih sendiri mau pake yang mana.
  entryPriceDeep?: number;
  riskDeep?: number;
  takeProfit1Deep?: number;
  takeProfit2Deep?: number;
  rr1Deep?: number;
  rr2Deep?: number;
  deepEntryNote?: string; // alasan kalau deep entry gak tersedia (misal kelewat deket SL)
  // ═══ BTC Correlation FILTER (request user, beda dari btcAligned/btcBias di
  // atas yang cuma informasional) -- cek apa koin ini SAAT INI ngikut kuat
  // arah BTC yang BERLAWANAN sama arah sinyal. Korelasi return M15 20 candle
  // >=0.75 + BTC berlawanan arah -> sinyal di-BLOCK (status jadi no_setup).
  // 0,50-0,75 -> sinyal tetep keluar tapi dikasih peringatan keras. Dipake di
  // Menu Scalping & Money Magnet Scalping (request user).
  btcCorrAction?: 'none' | 'warn' | 'block';
  btcCorrValue?: number; // Pearson correlation coefficient, -1..1
  btcCorrBtcDirection?: 'bullish' | 'bearish' | 'ranging';
  btcCorrWarningMsg?: string; // cuma keisi kalau btcCorrAction === 'warn'
  // ═══ Scalping Money Magnet H4->M30 (request user 2026-10-21, ganti total Scalping Fakeout): metrik disimpan ke Journal ═══
  mmVersion?: string;               // versi logic ('mm1')
  mmAdxH4?: number;                 // ADX(14) H4 closed saat sinyal (aturan > 25)
  entryDistAtr?: number;            // |harga sekarang - entry| / ATR M30
}

// ═══════════════════════════════════════════════════════════════════════════
// BTC CORRELATION FILTER (request user): sebelum sinyal entry (Menu Scalping
// & Money Magnet Scalping) keluar, cek apa koin ini SAAT INI lagi ngikut
// kuat arah BTC yang BERLAWANAN sama arah sinyal -- kalau iya, rawan ketarik
// balik meskipun struktur market koin sendiri secara teknikal valid. Kalau
// koin lagi independen/decouple dari BTC (termasuk kasus BTC dump tapi koin
// malah pump sendiri), sinyal tetap boleh keluar normal.
//
// Metodologi (request user, threshold didelegasiin ke gua): Pearson
// correlation dari return M15 20 candle terakhir (coin vs BTC) + arah BTC
// sendiri dari net % change over window yang sama (>+0,15% = bullish,
// <-0,15% = bearish, selain itu = ranging/netral, dianggap gak ada tarikan).
//   - korelasi >= 0.75 DAN BTC berlawanan arah sinyal -> BLOCK (status jadi
//     no_setup, sinyal gak ditampilin sama sekali -- korelasi emang jelas
//     kuat, minim risiko false-block ke sinyal yang sebenernya independen)
//   - korelasi 0.50-0.75 DAN BTC berlawanan arah sinyal -> WARNING (sinyal
//     tetap keluar lengkap, tapi dikasih peringatan keras: rawan ketarik
//     kalau BTC gerak kuat, jangan hold kelamaan)
//   - selain itu (korelasi <0.50, ATAU BTC ranging, ATAU BTC malah searah
//     sinyal) -> gak ada efek, sinyal normal
// BTC sendiri (symbol === 'BTCUSDT') di-skip -- gak mungkin "ngikut dirinya
// sendiri". Fail-safe: kalau fetch data BTC gagal, gak nge-block (gak mau
// 1 gangguan network nge-block semua sinyal).
// ═══════════════════════════════════════════════════════════════════════════

export interface BtcCorrelationFilterResult {
  action: 'none' | 'warn' | 'block';
  correlation: number;
  btcDirection: 'bullish' | 'bearish' | 'ranging';
  message?: string;
}

const BTC_CORR_WINDOW = 20; // candle M15 (request user: "M15, 20 candle")
const BTC_CORR_BLOCK_THRESHOLD = 0.75;
const BTC_CORR_WARN_THRESHOLD = 0.50;
const BTC_CORR_DIRECTION_NEUTRAL_PCT = 0.15; // net change < ini dianggap BTC ranging/netral

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const aa = a.slice(-n), bb = b.slice(-n);
  const meanA = aa.reduce((s, v) => s + v, 0) / n;
  const meanB = bb.reduce((s, v) => s + v, 0) / n;
  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const da = aa[i]! - meanA, db = bb[i]! - meanB;
    cov += da * db; varA += da * da; varB += db * db;
  }
  if (varA === 0 || varB === 0) return 0;
  return cov / Math.sqrt(varA * varB);
}

async function checkBtcCorrelationFilter(
  symbol: string, signalBias: 'bullish' | 'bearish', coinM15Closes: number[],
): Promise<BtcCorrelationFilterResult> {
  if (symbol === 'BTCUSDT') return { action: 'none', correlation: 0, btcDirection: 'ranging' };
  try {
    const btcM15 = await fetchKlines('BTCUSDT', '15m', 48); // request user: BTC Correlation Filter limit 48
    const window = BTC_CORR_WINDOW;
    const coinCloses = coinM15Closes.slice(-(window + 1));
    const btcCloses = btcM15.closes.slice(-(window + 1));
    if (coinCloses.length < window + 1 || btcCloses.length < window + 1) {
      return { action: 'none', correlation: 0, btcDirection: 'ranging' };
    }
    const coinReturns: number[] = [];
    const btcReturns: number[] = [];
    for (let i = 1; i < coinCloses.length; i++) {
      coinReturns.push((coinCloses[i]! - coinCloses[i - 1]!) / coinCloses[i - 1]!);
      btcReturns.push((btcCloses[i]! - btcCloses[i - 1]!) / btcCloses[i - 1]!);
    }
    const correlation = Number(pearsonCorrelation(coinReturns, btcReturns).toFixed(2));
    const btcNetChangePct = ((btcCloses[btcCloses.length - 1]! - btcCloses[0]!) / btcCloses[0]!) * 100;
    const btcDirection: 'bullish' | 'bearish' | 'ranging' =
      btcNetChangePct > BTC_CORR_DIRECTION_NEUTRAL_PCT ? 'bullish'
      : btcNetChangePct < -BTC_CORR_DIRECTION_NEUTRAL_PCT ? 'bearish'
      : 'ranging';

    const conflict = btcDirection !== 'ranging' && btcDirection !== signalBias;
    if (conflict && correlation >= BTC_CORR_BLOCK_THRESHOLD) {
      return {
        action: 'block', correlation, btcDirection,
        message: `BTC Correlation Filter -- korelasi ${symbol} vs BTC ${correlation.toFixed(2)} (kuat, M15 ${window} candle) & BTC lagi ${btcDirection} (berlawanan arah sinyal ${signalBias}) -- rawan ketarik arah BTC, sinyal ditahan.`,
      };
    }
    if (conflict && correlation >= BTC_CORR_WARN_THRESHOLD) {
      return {
        action: 'warn', correlation, btcDirection,
        message: `⚠️ PERINGATAN -- ${symbol} berkorelasi ${correlation.toFixed(2)} dengan BTC (M15 ${window} candle), tapi sinyal entry (${signalBias}) berlawanan arah BTC (${btcDirection}). Rawan ketarik kalau BTC bergerak kuat -- jangan hold terlalu lama.`,
      };
    }
    return { action: 'none', correlation, btcDirection };
  } catch {
    return { action: 'none', correlation: 0, btcDirection: 'ranging' }; // fail-safe -- BTC gagal fetch, gak nge-block
  }
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


// ═══════════════════════════════════════════════════════════════════════════
// FIBONACCI RETEST (rp9, 2026-11-08: TF M15 + EMA640; rp7 2026-11-01 H1; sebelumnya "Scalping Retest Fib H1→M5"). SINGLE TF: semua analisis di M15 (nama variabel/komentar 'H1' di bawah = TF analisis, kini M15).
// Dari file "Logic baru menu scalping" + keputusan user. TIDAK di-backtest (jurnal = pembuktian).
//   1. Arah: close M15 tertutup di atas EMA640 = BULLISH, di bawah = BEARISH (rp9; sebelumnya EMA50 dan EMA200 harus sekaligus).
//      Struktur (swing fractal 3 M15): BEARISH swing low terbaru harus LL; BULLISH swing high terbaru harus HH. Kalau swing terbaru sudah HL/LH = telat masuk, ditolak.
//      Leg Fib = swing high terakhir sebelum swing low itu (BULLISH kebalikan). Tolak kalau ada close M15 (body, bukan wick) melewati Fib 0,705 leg.
//      Tolak juga kalau high/low (termasuk candle berjalan) sudah melewati ujung leg (leg belum final).
//   2. ADX(14) M15 > 29,4 (tanpa cek arah DI).   3. Force Index EMA2 M15: LONG > 0, SHORT < 0.
//   4. Zona entry = retrace Fib 0,5-0,618 dari leg M15. Konfluensi (bukan filter wajib, hanya menentukan level LIMIT): FVG belum tertutup, OB belum dimitigasi,
//      SNR (cluster swing fractal 3, toleransi 0,5 ATR, >= 2 sentuhan). Ada -> limit di tepi terdekat ke harga (di dalam zona); tidak ada -> tengah zona (0,559).
//      STOP kalau limit sudah tersentuh sejak swing terbentuk atau harga sudah di limit. Harga sekarang = close candle M15 berjalan.
//   5. SL = entry -/+ 1 x ATR(M15). TP1 = ekstensi Fib 1,272, TP2 = ekstensi Fib 1,618 (RR tidak tetap, tanpa batas minimal range leg). Berlaku 24 jam.
// ═══════════════════════════════════════════════════════════════════════════
export const SCALPING_CRT = CRT_PARAMS; // LEGACY: konstanta CRT lama (tidak dipakai lagi)
export const SCALPING_RP = {
  VERSION: 'rp9', // rp9 (2026-11-08) = TF H1 -> M15 dan EMA50/200 -> satu EMA640 (permintaan user, belum di-backtest); rp8 (2026-11-02) = + leg H1 minimal 2 x ATR(H1) (studi Futures Replay 4 tahun); rp7 (2026-11-01) = Fibonacci Retest, H1 only (struktur LL/HH + Fib 0,705, SL 1 ATR H1); rp6 (2026-10-30) = SL entry -/+ 2 x ATR(M5); rp5 = EMA 50/200, ADX > 29,4; rp3 = Force Index EMA2 H1
  SKILL_LABEL: 'Fibonacci Retest',
  TF: '15m', TF_LABEL: 'M15', TF_MS: 900_000,
  HTF_FETCH: 1500, // EMA640 butuh >= 640 candle + warmup (batas Binance 1500)
  HTF_MIN_BARS: 700,
  EMA: 640,
  ADX_MIN: 29.4,
  FI_EMA: 2, // Force Index = (close - close[-1]) x volume, di-smooth EMA 2 (calcForceIndexSeries); LONG wajib > 0, SHORT wajib < 0
  SWING: 3, // fractal 3 kiri-kanan (swing struktur M15, leg Fib, SNR)
  SCAN_BARS: 100, // jendela candle M15 untuk cluster SNR
  FIB_BREAK: 0.705, // close M15 melewati level ini = struktur patah, sinyal ditolak
  FIB_NEAR: 0.5, FIB_FAR: 0.618,
  TP1_EXT: 0.272, TP2_EXT: 0.618, // ekstensi 1,272 dan 1,618 dari leg
  SL_ATR: 1.0, // SL = entry -/+ 1 x ATR(M15) (rp9; sebelumnya ATR H1)
  MIN_LEG_ATR: 2, // rp8: range leg M15 harus >= 2 x ATR(M15), kalau kecil ditolak
  SNR_TOL_ATR: 0.5, SNR_MIN_TOUCH: 2,
  VALID_MS: 24 * 3_600_000,
} as const;

function pbSwingPrices(h: number[], l: number[], from: number, to: number): number[] {
  const out: number[] = [];
  const a = Math.max(2, from), b = Math.min(h.length - 3, to);
  for (let i = a; i <= b; i++) {
    if (h[i]! > h[i - 1]! && h[i]! > h[i - 2]! && h[i]! > h[i + 1]! && h[i]! > h[i + 2]!) out.push(h[i]!);
    if (l[i]! < l[i - 1]! && l[i]! < l[i - 2]! && l[i]! < l[i + 1]! && l[i]! < l[i + 2]!) out.push(l[i]!);
  }
  return out;
}
function pbClusters(prices: number[], tol: number, minTouch: number): { lo: number; hi: number }[] {
  if (prices.length === 0) return [];
  const p = [...prices].sort((x, y) => x - y);
  const out: { lo: number; hi: number }[] = [];
  let g: number[] = [p[0]!];
  for (let k = 1; k < p.length; k++) {
    if (p[k]! - g[0]! <= tol) g.push(p[k]!);
    else { if (g.length >= minTouch) out.push({ lo: g[0]!, hi: g[g.length - 1]! }); g = [p[k]!]; }
  }
  if (g.length >= minTouch) out.push({ lo: g[0]!, hi: g[g.length - 1]! });
  return out;
}

export interface RpSetup {
  swingHigh: number; swingLow: number;     // harga asli (LONG: leg low->high; SHORT: leg high->low, swingHigh = awal leg)
  zoneLo: number; zoneHi: number;          // zona retrace 0,5-0,618 (harga asli)
  entry: number; sl: number; tp1: number; tp2: number;
  basis: 'fvg' | 'ob' | 'snr' | 'mid';     // dasar level limit
  confluence: string[];                    // semua konfluensi yang overlap zona, mis. ['FVG','SNR']
  retracePct: number;                      // posisi limit dalam retrace (0,5-0,618)
  rangeAtr: number;                        // range leg / ATR M15 (informasional)
  legAgeBars: number;                      // umur swing akhir leg dalam candle M15
  fib705: number;                          // level Fib 0,705 leg M15 (batas struktur, harga asli)
}

/**
 * Fibonacci Retest rp7 (H1 only) dalam "ruang LONG". SHORT dipanggil dengan data dinegasikan (o'=-o, h'=-l, l'=-h, c'=-c)
 * lalu level hasilnya dinegasikan balik oleh pemanggil (rpFindSetup). names = istilah struktur untuk pesan (LONG: HH/LH, SHORT: LL/HL).
 * o/h/l/c = candle M15 TERTUTUP. formL/formH = low/high candle M15 yang sedang berjalan (null kalau tidak ada) di ruang yang sama.
 */
function rpFindLong(
  o: number[], h: number[], l: number[], c: number[], a: number, price: number, formL: number | null, formH: number | null,
  names: { hh: string; lh: string },
): { ok: true; s: { H: number; L: number; zHi: number; zLo: number; entry: number; sl: number; tp1: number; tp2: number; basis: 'fvg' | 'ob' | 'snr' | 'mid'; conf: string[]; ih: number; R: number; fib705: number } } | { ok: false; why: string } {
  const K = SCALPING_RP;
  const n = h.length;
  // 1. struktur M15: swing fractal 3 (butuh 3 candle M15 konfirmasi di kanan)
  const sh: number[] = [], sl: number[] = [];
  for (let i = K.SWING; i <= n - 1 - K.SWING; i++) {
    let isH = true, isL = true;
    for (let q = 1; q <= K.SWING; q++) {
      if (!(h[i]! > h[i - q]! && h[i]! > h[i + q]!)) isH = false;
      if (!(l[i]! < l[i - q]! && l[i]! < l[i + q]!)) isL = false;
    }
    if (isH) sh.push(i);
    if (isL) sl.push(i);
  }
  if (sh.length < 2) return { ok: false, why: 'swing M15 (fractal 3) kurang dari 2' };
  const ih = sh[sh.length - 1]!, ip = sh[sh.length - 2]!;
  const H = h[ih]!;
  if (!(H > h[ip]!)) return { ok: false, why: H < h[ip]! ? `sudah terbentuk ${names.lh} setelah ${names.hh} (struktur sudah berbalik), telat masuk` : `belum ada ${names.hh} baru di M15` };
  let il = -1;
  for (const k of sl) if (k < ih) il = k;
  if (il < 0) return { ok: false, why: 'tidak ada swing M15 berlawanan sebelum swing terbaru' };
  const L = l[il]!, R = H - L;
  if (!(R > 0)) return { ok: false, why: 'range leg tidak valid' };
  if (R < K.MIN_LEG_ATR * a) return { ok: false, why: `leg M15 terlalu kecil: ${(R / a).toFixed(2)} x ATR M15 (minimal ${K.MIN_LEG_ATR})` };
  // impuls masih berlanjut? (ada high lebih tinggi dari swing, termasuk candle berjalan, belum terkonfirmasi sebagai swing)
  let maxAfter = formH ?? -Infinity;
  for (let k = ih + 1; k < n; k++) maxAfter = Math.max(maxAfter, h[k]!);
  if (maxAfter > H) return { ok: false, why: 'M15 masih membuat high/low baru (leg belum final), tunggu swing' };
  // batas struktur: close M15 (body, bukan wick) melewati Fib 0,705 leg
  const fib705 = H - K.FIB_BREAK * R;
  for (let k = ih + 1; k < n; k++) if (c[k]! < fib705) return { ok: false, why: `struktur M15 patah: close M15 melewati Fib ${String(K.FIB_BREAK).replace('.', ',')}` };
  if (price < fib705) return { ok: false, why: 'harga sekarang sudah melewati Fib 0,705 leg M15, struktur patah' };

  // 2. zona Fib 0,5-0,618 + konfluensi
  const zHi = H - K.FIB_NEAR * R, zLo = H - K.FIB_FAR * R;
  const ov: { x: number; y: number; t: 'fvg' | 'ob' | 'snr' }[] = [];
  const clip = (lo: number, hi: number, t: 'fvg' | 'ob' | 'snr') => {
    const x = Math.max(lo, zLo), y = Math.min(hi, zHi);
    if (x <= y) ov.push({ x, y, t });
  };
  // FVG bullish yang terbentuk setelah awal leg dan belum tertutup
  for (let i = il + 1; i <= n - 2; i++) {
    const A = i - 1, B = i + 1;
    if (A < il || !(l[B]! > h[A]!)) continue;
    const gLo = h[A]!;
    let gHi = l[B]!;
    for (let k = B + 1; k < n; k++) gHi = Math.min(gHi, l[k]!);
    if (formL !== null) gHi = Math.min(gHi, formL);
    if (gHi > gLo) clip(gLo, gHi, 'fvg');
  }
  // OB: candle bearish terakhir sebelum impuls (BOS = close pertama di atas swing high sebelumnya), belum dimitigasi
  {
    let bos = ih;
    for (let k = il + 1; k <= ih; k++) if (c[k]! > h[ip]!) { bos = k; break; }
    let ob = -1;
    for (let k = il; k < bos; k++) if (c[k]! < o[k]!) ob = k;
    if (ob >= 0) {
      let mitigated = false;
      for (let k = bos + 1; k < n; k++) if (c[k]! < l[ob]!) { mitigated = true; break; }
      if (price < l[ob]!) mitigated = true;
      if (!mitigated) clip(l[ob]!, h[ob]!, 'ob');
    }
  }
  // SNR: cluster swing fractal 3 (support/resistance, termasuk resistance yang berubah jadi support)
  for (const z of pbClusters(bkSwingPrices(h, l, Math.max(K.SWING, n - K.SCAN_BARS), n - 1 - K.SWING, K.SWING), K.SNR_TOL_ATR * a, K.SNR_MIN_TOUCH)) clip(z.lo, z.hi, 'snr');

  let entry: number, basis: 'fvg' | 'ob' | 'snr' | 'mid';
  if (ov.length > 0) {
    let best = ov[0]!;
    for (const q of ov) if (q.y > best.y) best = q; // tepi atas terdekat ke harga
    entry = best.y; basis = best.t;
  } else { entry = (zHi + zLo) / 2; basis = 'mid'; }

  // limit sudah tersentuh sejak swing high? (low candle tertutup setelah swing high, atau candle berjalan)
  let minAfter = formL ?? Infinity;
  for (let k = ih + 1; k < n; k++) minAfter = Math.min(minAfter, l[k]!);
  if (minAfter <= entry) return { ok: false, why: 'level limit sudah tersentuh sejak swing terakhir terbentuk (setup sudah lewat)' };
  if (!(price > entry)) return { ok: false, why: 'harga sekarang sudah di level limit' };

  const sl2 = entry - K.SL_ATR * a;
  const conf = Array.from(new Set(ov.map(q => q.t.toUpperCase())));
  return { ok: true, s: { H, L, zHi, zLo, entry, sl: sl2, tp1: H + K.TP1_EXT * R, tp2: H + K.TP2_EXT * R, basis, conf, ih, R, fib705 } };
}

/** Wrapper dua arah. d = 1 LONG, -1 SHORT. Semua harga masuk/keluar = harga asli. */
export function rpFindSetup(
  o: number[], h: number[], l: number[], c: number[], d: 1 | -1, a: number, price: number, formL: number | null, formH: number | null,
): { ok: true; s: RpSetup } | { ok: false; why: string } {
  const n = h.length;
  const r = d === 1
    ? rpFindLong(o, h, l, c, a, price, formL, formH, { hh: 'HH', lh: 'LH' })
    : rpFindLong(o.map(v => -v), l.map(v => -v), h.map(v => -v), c.map(v => -v), a, -price, formH === null ? null : -formH, formL === null ? null : -formL, { hh: 'LL', lh: 'HL' });
  if (!r.ok) return r;
  const q = r.s, g = d === 1 ? 1 : -1;
  const px = (v: number) => g * v;
  const zA = px(q.zLo), zB = px(q.zHi);
  const entry = px(q.entry);
  return {
    ok: true,
    s: {
      swingHigh: d === 1 ? q.H : -q.L, swingLow: d === 1 ? q.L : -q.H,
      zoneLo: Math.min(zA, zB), zoneHi: Math.max(zA, zB),
      entry, sl: px(q.sl), tp1: px(q.tp1), tp2: px(q.tp2),
      basis: q.basis, confluence: q.conf,
      retracePct: Number(((q.H - q.entry) / q.R).toFixed(3)),
      rangeAtr: Number((q.R / a).toFixed(2)),
      legAgeBars: n - 1 - q.ih,
      fib705: px(q.fib705),
    },
  };
}

export async function analyzeScalpingEntry(symbol: string): Promise<ScalpingResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';
  const maxScore = 0; // skor TA PRO tampil lewat badge sendiri (snapshot), bukan skor menu
  const K = SCALPING_RP;
  const noSetup = (currentPrice: number, message: string): ScalpingResult =>
    ({ status: 'no_setup', symbol, currentPrice, timestamp, mode: 'structural', message, maxScore });

  try {
    const h1Raw = await fetchKlines(symbol, K.TF, K.HTF_FETCH, true);
    const nowMs = Date.now();
    const lastH = h1Raw.times.length - 1;
    const forming = lastH >= 0 && h1Raw.times[lastH]! + K.TF_MS > nowMs;
    const cH = forming ? lastH : lastH + 1; // jumlah candle M15 yang sudah close
    const currentPrice = lastH >= 0 ? h1Raw.closes[lastH]! : 0;
    if (cH < K.HTF_MIN_BARS) {
      return { status: 'error', symbol, currentPrice, timestamp, mode: 'structural', message: `Data candle gak cukup (butuh M15 ${K.HTF_MIN_BARS}+ candle tertutup)`, maxScore };
    }
    const o = h1Raw.opens.slice(0, cH), h = h1Raw.highs.slice(0, cH), l = h1Raw.lows.slice(0, cH), c = h1Raw.closes.slice(0, cH), v = h1Raw.volumes.slice(0, cH);

    // 1. M15: arah lewat EMA640 (rp9)
    const hClose = c[cH - 1]!;
    const emaV = calcEMASeries(c, K.EMA)[cH - 1]!;
    const fmt = (x: number) => x.toFixed(6);
    let d: 1 | -1;
    if (hClose > emaV) d = 1;
    else if (hClose < emaV) d = -1;
    else return noSetup(currentPrice, `M15: close ${fmt(hClose)} tepat di EMA${K.EMA} (${fmt(emaV)}) — tidak ada bias`);
    const bias: 'bullish' | 'bearish' = d === 1 ? 'bullish' : 'bearish';
    // 2. ADX M15
    const adx = calcADXWithDI(h, l, c, 14);
    if (!(adx.adx > K.ADX_MIN)) return noSetup(currentPrice, `ADX M15 ${adx.adx.toFixed(1)} ≤ ${K.ADX_MIN} — pasar tidak trending (M15 ${bias})`);
    // 3. Force Index (EMA 2) M15 searah bias: LONG wajib positif, SHORT wajib negatif (candle M15 tertutup)
    const fiSeries = calcForceIndexSeries(c, v);
    const fi = fiSeries.length ? fiSeries[fiSeries.length - 1]! : 0;
    const fiTxt = fi.toPrecision(4);
    if (d === 1 ? !(fi > 0) : !(fi < 0)) return noSetup(currentPrice, `Force Index (EMA${K.FI_EMA}) M15 ${fiTxt} tidak searah ${bias} (${d === 1 ? 'wajib > 0' : 'wajib < 0'})`);

    // 4. Struktur M15 (LL/HH, belum HL/LH, Fib 0,705), Fibonacci 0,5-0,618, konfluensi, level limit
    const a = calcATR(h, l, c);
    if (!(a > 0)) return noSetup(currentPrice, 'ATR M15 tidak valid');
    const formL = forming ? h1Raw.lows[lastH]! : null, formH = forming ? h1Raw.highs[lastH]! : null;
    const res = rpFindSetup(o, h, l, c, d, a, currentPrice, formL, formH);
    if (!res.ok) return noSetup(currentPrice, `Belum ada setup Fib M15 (${res.why})`);
    const s = res.s;

    const risk = Math.abs(s.entry - s.sl);
    if (!(risk > 0)) return noSetup(currentPrice, 'Jarak entry-SL tidak valid');
    const rr1 = Math.abs(s.tp1 - s.entry) / risk, rr2 = Math.abs(s.tp2 - s.entry) / risk;
    const basisTxt = s.basis === 'mid' ? 'tengah zona (tanpa konfluensi)' : `tepi ${s.basis.toUpperCase()} dalam zona`;
    const filterResults: string[] = [
      `✅ M15 ${bias === 'bullish' ? 'BULLISH' : 'BEARISH'}: close ${fmt(hClose)} ${d === 1 ? 'di atas' : 'di bawah'} EMA${K.EMA} ${fmt(emaV)}`,
      `✅ ADX M15 ${adx.adx.toFixed(1)} (> ${K.ADX_MIN}); Force Index EMA${K.FI_EMA} M15 ${fiTxt} (${d === 1 ? '> 0' : '< 0'})`,
      `✅ Struktur M15 ${d === 1 ? 'HH (belum LH)' : 'LL (belum HL)'}: Fib 0,705 di ${fmt(s.fib705)} belum ditembus close M15`,
      `✅ Leg Fibonacci M15: swing ${d === 1 ? 'low' : 'high'} ${fmt(d === 1 ? s.swingLow : s.swingHigh)} → swing ${d === 1 ? 'high' : 'low'} ${fmt(d === 1 ? s.swingHigh : s.swingLow)} (range ${s.rangeAtr}x ATR M15, swing ${s.legAgeBars} candle M15 lalu)`,
      `✅ Zona retrace 0,5–0,618: ${fmt(s.zoneLo)} – ${fmt(s.zoneHi)}; konfluensi: ${s.confluence.length ? s.confluence.join(' + ') : 'tidak ada'}`,
      `✅ LIMIT ${d === 1 ? 'BUY' : 'SELL'} ${fmt(s.entry)} = ${basisTxt} (retrace ${(s.retracePct * 100).toFixed(1)}%)`,
      `✅ SL ${fmt(s.sl)} (entry ${d === 1 ? '−' : '+'} ${K.SL_ATR} × ATR M15); TP1 ${fmt(s.tp1)} (Fib 1,272, RR ${rr1.toFixed(2)}); TP2 ${fmt(s.tp2)} (Fib 1,618, RR ${rr2.toFixed(2)})`,
    ];
    return {
      status: 'in_zone', symbol, bias, currentPrice, timestamp, mode: 'structural',
      maxScore, filterResults,
      entryPrice: s.entry, stopLoss: s.sl, takeProfit1: s.tp1, takeProfit2: s.tp2,
      rr1: Number(rr1.toFixed(2)), rr2: Number(rr2.toFixed(2)),
      rpVersion: K.VERSION, rpAdxD1: Number(adx.adx.toFixed(1)), rpFiH1: fi,
      rpSwingHigh: s.swingHigh, rpSwingLow: s.swingLow, rpRangeAtr: s.rangeAtr, rpLegAgeBars: s.legAgeBars,
      rpZoneLo: s.zoneLo, rpZoneHi: s.zoneHi, rpBasis: s.basis, rpConfluence: s.confluence.join('+'),
      rpRetracePct: s.retracePct,
      validUntilMs: nowMs + K.VALID_MS, atr15MPct: undefined,
      message: `SIAP ${d === 1 ? 'BUY LIMIT' : 'SELL LIMIT'} di ${fmt(s.entry)} — Fibonacci Retest M15 (${bias}, ADX ${adx.adx.toFixed(0)}, Force Index ${d === 1 ? 'positif' : 'negatif'}, struktur ${d === 1 ? 'HH' : 'LL'}), limit di ${basisTxt}, SL ${fmt(s.sl)} (1 ATR M15), TP1 ${fmt(s.tp1)} (RR 1:${rr1.toFixed(1)}), TP2 ${fmt(s.tp2)} (RR 1:${rr2.toFixed(1)}). Pasang limit order; batal bila close M15 menembus Fib 0,705 (${fmt(s.fib705)}) sebelum terisi, kedaluwarsa 24 jam.`,
    };
  } catch (err) {
    return {
      status: 'error', symbol, currentPrice: 0, timestamp, mode: 'structural',
      message: err instanceof Error ? err.message : 'Unknown error',
      maxScore,
    };
  }
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

function detectRSIDivergenceGeneric(highs: number[], lows: number[], closes: number[], period = 14): DivergenceResult {
  const rsiSeries = calcRSISeries(closes, period);
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
// kekuatan trend (semua indikator project + EMA26/50/100; bias = struktur swing)
// (catatan lama: EMA200 & EMA100
// DIHAPUS, request user/audit, karena butuh candle lebih banyak dari budget
// fetch TA PRO yang sekarang (H4:84/D1:60) buat stabil/konvergen bener) H4+D1,
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
  // EMA 26/50/100 (spec user). CATATAN: D1 hanya 100 candle -> EMA100 D1 belum
  // punya seed SMA penuh di candle close terakhir (index 98 < 99), nilainya mendekati SMA99.
  ema26: number; ema50: number; ema100: number;
  emaAlignment: 'bullish' | 'bearish' | 'mixed';
  bias: BtcStructureBias;
  transition: 'bull_to_bear' | 'bear_to_bull' | null;
  structureNote: string;
}

/** Format harga adaptif (koin kecil tidak boleh jadi 0). */
function fmtPx(v: number): string {
  return v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v.toPrecision(4);
}

export type BtcStructureBias = 'bullish' | 'bearish' | 'sideways' | 'transition';

/**
 * Bias struktur BTC per TF (spec user): BULLISH = 2 swing high terakhir HH + 2 swing
 * low terakhir HL + close terakhir belum menembus swing low terakhir; BEARISH =
 * cermin (LL + LH + close belum menembus swing high terakhir); TRANSISI = pola
 * HH-HL (atau LL-LH) masih ada tapi close terakhir sudah menembus swing low
 * (atau swing high) penting itu, struktur baru belum terkonfirmasi; selain itu SIDEWAY.
 * Swing: fractal per-TF + filter jarak ATR yang sama dengan Fitur 1/3/4. Hanya candle close.
 */
function btcStructureBias(
  tf: 'H4' | 'D1' | 'H1' | 'M30' | 'M15' | 'M5', highs: number[], lows: number[], closes: number[],
): { bias: BtcStructureBias; transition: 'bull_to_bear' | 'bear_to_bull' | null; note: string } {
  const n = closes.length - 1; // buang candle yang masih berjalan
  const H = highs.slice(0, n), L = lows.slice(0, n), C = closes.slice(0, n);
  const atr = calcATR(H, L, C);
  const fr = MSV2_FRACTAL_STRENGTH[tf];
  const dist = MSV2_SWING_MIN_DIST_ATR[tf];
  const sh = msv2FindSwingPoints(H, true, fr.left, fr.right, atr, dist);
  const sl = msv2FindSwingPoints(L, false, fr.left, fr.right, atr, dist);
  if (sh.length < 2 || sl.length < 2) return { bias: 'sideways', transition: null, note: 'swing belum cukup (butuh 2 high & 2 low)' };
  const h1 = sh[sh.length - 2]!.price, h2 = sh[sh.length - 1]!.price;
  const l1 = sl[sl.length - 2]!.price, l2 = sl[sl.length - 1]!.price;
  const close = C[C.length - 1]!;
  const hh = h2 > h1, hl = l2 > l1, lh = h2 < h1, ll = l2 < l1;
  if (hh && hl) {
    return close > l2
      ? { bias: 'bullish', transition: null, note: `HH ${fmtPx(h1)}→${fmtPx(h2)}, HL ${fmtPx(l1)}→${fmtPx(l2)}, close di atas swing low ${fmtPx(l2)}` }
      : { bias: 'transition', transition: 'bull_to_bear', note: `sebelumnya HH-HL, close ${fmtPx(close)} menembus swing low ${fmtPx(l2)}, struktur bearish belum terkonfirmasi` };
  }
  if (ll && lh) {
    return close < h2
      ? { bias: 'bearish', transition: null, note: `LL ${fmtPx(l1)}→${fmtPx(l2)}, LH ${fmtPx(h1)}→${fmtPx(h2)}, close di bawah swing high ${fmtPx(h2)}` }
      : { bias: 'transition', transition: 'bear_to_bull', note: `sebelumnya LL-LH, close ${fmtPx(close)} menembus swing high ${fmtPx(h2)}, struktur bullish belum terkonfirmasi` };
  }
  return { bias: 'sideways', transition: null, note: 'tidak ada rangkaian HH-HL / LL-LH yang konsisten' };
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

  const ema26 = calcEMASeries(closes, 26)[i]!;
  const ema50 = calcEMASeries(closes, 50)[i]!;
  const ema100 = calcEMASeries(closes, 100)[i]!;

  // Susunan EMA 26/50/100 (spec user): bullish kalau 26>50>100, bearish kalau 26<50<100.
  const bullStack = ema26 > ema50 && ema50 > ema100;
  const bearStack = ema26 < ema50 && ema50 < ema100;
  const emaAlignment: 'bullish' | 'bearish' | 'mixed' = bullStack ? 'bullish' : bearStack ? 'bearish' : 'mixed';

  // Bias = struktur swing (HH/HL, LL/LH, transisi), bukan EMA.
  const st = btcStructureBias(tf, highs, lows, closes);
  const bias = st.bias;

  return {
    timeframe: tf, rsi, macdHistogram: macd.histogram,
    adx: adxRes.adx, plusDI: adxRes.plusDI, minusDI: adxRes.minusDI,
    forceIndex, volumeRatio, atrRatio, stochK: sto.k, stochD: sto.d,
    ema26, ema50, ema100, emaAlignment, bias, transition: st.transition, structureNote: st.note,
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
  d1Bias: BtcStructureBias, h4Bias: BtcStructureBias,
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
  if (d1Bias === 'transition') {
    return {
      phase: 'TRANSISI — struktur D1 sedang berbalik',
      detail: `D1: swing penting sudah ditembus tapi struktur baru belum terkonfirmasi (H4: ${h4Bias}). Tunggu rangkaian swing baru sebelum menganggap tren berbalik.`,
    };
  }
  return { phase: 'SIDEWAYS/NETRAL', detail: 'D1 tidak punya rangkaian HH-HL atau LL-LH yang konsisten, belum ada breakout terkonfirmasi dari range.' };
}

async function analyzeBtcGoldRatio(): Promise<{
  ratio: number; ratioEma50: number; trend: 'bullish' | 'bearish'; interpretation: string;
}> {
  // Binance gak ada pair BTC/GOLD asli -- proxy pake PAXGUSDT (token
  // di-backing 1:1 emas fisik). Rasio BTCUSDT/PAXGUSDT ini setara sama
  // chart rasio "BTCUSDT/PAXGUSDT" yang muncul di mode Trading View Binance
  // (request user).
  const [btcD1, paxgD1] = await Promise.all([
    fetchKlines('BTCUSDT', '1d', BTC_CORR_CANDLES.D1),
    fetchKlines('PAXGUSDT', '1d', BTC_CORR_CANDLES.D1),
  ]);
  const n = Math.min(btcD1.closes.length, paxgD1.closes.length);
  const btcSlice = btcD1.closes.slice(-n);
  const paxgSlice = paxgD1.closes.slice(-n);
  const ratioSeries = btcSlice.map((v, idx) => v / paxgSlice[idx]!);
  const ratioEmaSeries = calcEMASeries(ratioSeries, 50);
  const idx = ratioSeries.length - 2;
  const ratio = ratioSeries[idx]!;
  const ratioEma50 = ratioEmaSeries[idx]!;
  const trend: 'bullish' | 'bearish' = ratio > ratioEma50 ? 'bullish' : 'bearish';
  const interpretation = trend === 'bullish'
    ? `BTC lagi OUTPERFORM emas (rasio ${ratio.toFixed(2)} di atas EMA50-nya ${ratioEma50.toFixed(2)}) — capital lebih milih BTC dibanding safe-haven, biasanya tanda risk-on.`
    : `BTC lagi UNDERPERFORM emas (rasio ${ratio.toFixed(2)} di bawah EMA50-nya ${ratioEma50.toFixed(2)}) — capital condong ke safe-haven, biasanya tanda risk-off/waspada.`;
  return { ratio, ratioEma50, trend, interpretation };
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

  // Default fetch candle TA PRO (request user) -- lihat TA_PRO_CANDLE_LIMIT.
  // DULU 500 candle H4/D1 khusus buat EMA200 (butuh minimal ~400 candle biar
  // stabil) -- SEKARANG EMA200 udah DIHAPUS (request user) karena gak valid
  // lagi dengan budget candle yang lebih kecil ini, jadi aman ikut default.
  const [h4, d1, oiH4, oiD1, btcGold, tickerRes] = await Promise.all([
    fetchKlines('BTCUSDT', '4h', BTC_CORR_CANDLES.H4),
    fetchKlines('BTCUSDT', '1d', BTC_CORR_CANDLES.D1),
    fetchOpenInterestHist('BTCUSDT', '4h', BTC_CORR_CANDLES.H4),
    fetchOpenInterestHist('BTCUSDT', '1d', BTC_CORR_CANDLES.D1),
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
  const keyLevelsD1Raw = detectSRLevels(d1HighsClosed, d1LowsClosed, d1ClosesClosed, 100, 2);
  const keyLevelsD1 = [...keyLevelsD1Raw]
    .sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice))
    .slice(0, 6);

  // BARU (request user): level FRESH terdekat (minTouches=1) di atas/bawah
  // harga sekarang -- biar breakout baru yang BELUM "teruji" 2x tetep
  // kelihatan (kayak kasus 87385 yang gagal breakout, sebelum fix ini gak
  // muncul sama sekali karena cuma 1x sentuh).
  const allLevelsD1 = detectSRLevels(d1HighsClosed, d1LowsClosed, d1ClosesClosed, 100, 1);
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
    `ℹ️ Kekuatan Trend D1 — RSI ${d1Strength.rsi.toFixed(1)}, MACD hist ${d1Strength.macdHistogram.toFixed(1)}, ADX ${d1Strength.adx.toFixed(1)} (+DI ${d1Strength.plusDI.toFixed(1)}/-DI ${d1Strength.minusDI.toFixed(1)}), EMA26/50/100 ${d1Strength.emaAlignment}, struktur ${d1Strength.bias.toUpperCase()} (${d1Strength.structureNote})`,
    `ℹ️ Kekuatan Trend H4 — RSI ${h4Strength.rsi.toFixed(1)}, MACD hist ${h4Strength.macdHistogram.toFixed(1)}, ADX ${h4Strength.adx.toFixed(1)} (+DI ${h4Strength.plusDI.toFixed(1)}/-DI ${h4Strength.minusDI.toFixed(1)}), EMA26/50/100 ${h4Strength.emaAlignment}, struktur ${h4Strength.bias.toUpperCase()} (${h4Strength.structureNote}), Stoch %K ${h4Strength.stochK.toFixed(1)}`,
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
    D1: 60, H4: 84, H1: 72, M30: 50, M15: 100, M5: 288,
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
      fetchKlines(symbol, '1d', 60),
      fetchKlines(symbol, '4h', 84),
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
  rr2?: number; // BARU (request user): RR asli TP2 (CRT, target liquidity) -- JANGAN diturunin dari rr1+1, itu salah
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
  // S-006 (2026-10-19): Filter arah D1 Sniper Breakout (peringatan, bukan block). Perubahan harga 3 candle D1: >=+2% up, <=-2% down.
  d1Action?: 'none' | 'warn';
  d1Trend?: 'up' | 'down' | 'flat';
  d1ChangePct?: number;
  d1Aligned?: boolean; // true = searah D1, false = melawan D1, undefined = D1 datar / data gagal
  d1WarningMsg?: string;
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
  // ═══ Sniper Breakout v6 (Breakout + Fibonacci H1→M5, bk1) — dipakai Journal ═══
  validUntilMs?: number;
  bkVersion?: string;
  bkLevelLo?: number; bkLevelHi?: number; bkVolRatio?: number;
  bkSwingHigh?: number; bkSwingLow?: number; bkZoneLo?: number; bkZoneHi?: number;
  bkBasis?: 'fvg' | 'snr' | 'mid'; bkConfluence?: string; bkRetracePct?: number; bkTp2Fib?: number;
  bkRangeAtr?: number; bkLegAgeBars?: number;
  // bk3: struktur H1 (swing high/low leg H1 + level Fib 0,705 sebagai batas struktur)
  bkH1High?: number; bkH1Low?: number; bkH1Fib705?: number; bkH1Struct?: 'LL' | 'HH';
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

// ═══════════════════════════════════════════════════════════════════════════
// SNIPER BREAKOUT v6 "Breakout + Fibonacci" (request user 2026-10-30, GANTI TOTAL dari CRT D1→H1;
// strategi dari file "Strategi Breakout Plus Fibonacci"). Label Journal: 'Sniper Breakout (H1→M5)', versi 'bk1'.
//   H1 (fetch 300, min 250): close tertutup di atas EMA50 dan EMA200 = BULLISH, di bawah keduanya = BEARISH, selain itu skip.
//   M5 (fetch 300): breakout SnR searah H1. SnR = cluster swing fractal 2-2 (toleransi 0,5 ATR, >= 2 sentuhan).
//     Breakout valid = candle M5 tertutup pertama yang close di luar tepi cluster (candle searah), volume >= 1,6x rata-rata 20 candle sebelumnya.
//     Setelah breakout, tunggu swing high/low fractal baru terbentuk (leg = swing low -> swing high, SHORT kebalikannya).
//     Swing = fractal 3 (bk2, 2026-11-01). Zona konfluensi Fib 0,5-0,618 (bk4; sebelumnya 0,382-0,618). Ada FVG atau SNR kuat di zona -> limit di tepi terdekat ke harga;
//     tidak ada -> BUY dan SELL limit di Fib 0,559 (bk4; bk2-bk3: BUY 0,705 / SELL 0,5).
//   SL = entry -/+ 2 x ATR(M5). TP1 = RR 1:2. TP2 = level Fib terkecil di {1,13; 1,272; 1,414; 1,618} (BUY) yang melewati TP1;
//     SHORT = cermin ({-0,13; -0,272; -0,414; -0,618}). Tidak ada yang melewati TP1 -> sinyal dilewati.
//   Batal: high/low baru melewati ujung leg, close menembus awal leg, limit sudah tersentuh, atau close kembali ke dalam cluster level (breakout gagal).
//   Belum di-backtest (Journal = pembuktian). Interpretasi yang dipilih (file tidak menjelaskan): definisi SnR valid, leg Fib, pemilihan level TP2.
// ═══════════════════════════════════════════════════════════════════════════
//   bk3 (2026-11-01): Step 1 H1 ditambah struktur: swing fractal 3 H1; BEARISH = swing low terbaru harus LL (lebih rendah dari swing low sebelumnya),
//     BULLISH = swing high terbaru harus HH. Leg H1 = swing high terakhir sebelum swing low itu (BULLISH: swing low terakhir sebelum swing high).
//     Fib 0,705 leg H1 = batas struktur: ada close candle H1 melewatinya sejak swing terbentuk -> sinyal ditolak (ekor candle tidak dihitung).
//     Close H1 terakhir sudah melewati swing itu (low/high baru sedang terbentuk) -> tunggu swing.
const SNIPER_BK = {
  VERSION: 'bk5', // bk5 (2026-11-02) = + leg M5 minimal 2 x ATR(M5) (studi Futures Replay 4 tahun); bk4 (2026-11-01) = zona entry Fib 0,5-0,618 dan fallback BUY/SELL sama-sama Fib 0,559 (tengah zona); bk1 = fractal 2-2, fallback Fib 0,5; bk2 = fractal 3, fallback BUY 0,705 / SELL 0,5; bk3 (2026-11-01) = + struktur H1 (LL/HH) & batas Fib 0,705 H1
  H1_SWING: 3, H1_FIB_BREAK: 0.705,
  HTF_FETCH: 300, LTF_FETCH: 300, HTF_MIN_BARS: 250,
  SWING: 3, // fractal 3 kiri-kanan untuk SnR dan leg Fib
  EMA_FAST: 50, EMA_SLOW: 200,
  VOL_MA: 20, VOL_MIN: 1.6,
  SCAN_BARS: 200,
  FIB_NEAR: 0.5, FIB_FAR: 0.618, FIB_FALLBACK_BUY: 0.559, FIB_FALLBACK_SELL: 0.559,
  SL_ATR: 2.0, TP1_RR: 2.0,
  MIN_LEG_ATR: 2, // bk5: range leg M5 harus >= 2 x ATR(M5), kalau kecil ditolak
  TP2_FIBS: [1.13, 1.272, 1.414, 1.618],
  FIB_LEVELS: [1.618, 1.414, 1.272, 1.13, 1, 0.886, 0.786, 0.705, 0.618, 0.5, 0.382, 0.236, 0, -0.13, -0.272, -0.414, -0.618],
  SNR_TOL_ATR: 0.5, SNR_MIN_TOUCH: 2,
  VALID_MS: 24 * 3_600_000,
};

/** Harga swing fractal-k (k candle kiri dan kanan) dalam indeks [from, to]; swing butuh k candle konfirmasi di kanan. */
function bkSwingPrices(h: number[], l: number[], from: number, to: number, k: number): number[] {
  const out: number[] = [];
  const a = Math.max(k, from), b = Math.min(h.length - 1 - k, to);
  for (let i = a; i <= b; i++) {
    let isH = true, isL = true;
    for (let q = 1; q <= k; q++) {
      if (!(h[i]! > h[i - q]! && h[i]! > h[i + q]!)) isH = false;
      if (!(l[i]! < l[i - q]! && l[i]! < l[i + q]!)) isL = false;
    }
    if (isH) out.push(h[i]!);
    if (isL) out.push(l[i]!);
  }
  return out;
}

interface BkSetupLong {
  H: number; L: number; zHi: number; zLo: number; entry: number; sl: number; tp1: number; tp2: number; tp2Fib: number;
  basis: 'fvg' | 'snr' | 'mid'; conf: string[]; ih: number; R: number; k: number; lvLo: number; lvHi: number; vr: number;
}

/** Setup breakout+Fib dalam "ruang LONG". SHORT dipanggil dengan data dinegasikan (o'=-o, h'=-l, l'=-h, c'=-c; volume tetap). */
function bkFindLong(
  o: number[], h: number[], l: number[], c: number[], v: number[], a: number, price: number, formL: number | null, formH: number | null, fallbackFib: number,
): { ok: true; s: BkSetupLong } | { ok: false; why: string } {
  const K = SNIPER_BK;
  const n = h.length;
  const start = Math.max(K.SWING, n - K.SCAN_BARS);
  // 1. cari candle breakout terbaru: close pertama di atas tepi atas cluster SnR, candle bullish, volume >= 1,6x MA20
  let k = -1, lvLo = 0, lvHi = 0, vr = 0;
  let sawVolOk = false;
  for (let i = n - 1; i >= start + K.VOL_MA + 4; i--) {
    if (!(c[i]! > o[i]!)) continue;
    let s = 0;
    for (let j = i - K.VOL_MA; j < i; j++) s += v[j]!;
    const avg = s / K.VOL_MA;
    const r = avg > 0 ? v[i]! / avg : 0;
    if (!(r >= K.VOL_MIN)) continue;
    sawVolOk = true;
    const zones = pbClusters(bkSwingPrices(h, l, start, i - 1 - K.SWING, K.SWING), K.SNR_TOL_ATR * a, K.SNR_MIN_TOUCH);
    let best: { lo: number; hi: number } | null = null;
    for (const z of zones) if (c[i - 1]! <= z.hi && c[i]! > z.hi && (best === null || z.hi > best.hi)) best = z;
    if (best) { k = i; lvLo = best.lo; lvHi = best.hi; vr = r; break; }
  }
  if (k < 0) return { ok: false, why: sawVolOk ? `ada candle volume >= ${K.VOL_MIN}x MA${K.VOL_MA} tapi tidak menembus SnR (cluster swing >= ${K.SNR_MIN_TOUCH} sentuhan)` : `belum ada candle breakout M5 dengan volume >= ${K.VOL_MIN}x MA${K.VOL_MA} yang menembus SnR` };
  // breakout gagal: close kembali ke bawah cluster
  for (let i = k + 1; i < n; i++) if (c[i]! < lvLo) return { ok: false, why: 'breakout gagal: close M5 kembali ke bawah level SnR' };
  // 2. swing high fractal 2-2 yang terbentuk setelah breakout (yang tertinggi)
  const shIdx: number[] = [], slIdx: number[] = [];
  for (let i = start; i <= n - 1 - K.SWING; i++) {
    let isH = true, isL = true;
    for (let q = 1; q <= K.SWING; q++) {
      if (!(h[i]! > h[i - q]! && h[i]! > h[i + q]!)) isH = false;
      if (!(l[i]! < l[i - q]! && l[i]! < l[i + q]!)) isL = false;
    }
    if (isH) shIdx.push(i);
    if (isL) slIdx.push(i);
  }
  let ih = -1;
  for (const i of shIdx) if (i >= k && (ih < 0 || h[i]! >= h[ih]!)) ih = i;
  if (ih < 0) return { ok: false, why: 'breakout sudah terjadi tapi swing high baru belum terbentuk (tunggu)' };
  let il = -1;
  for (const i of slIdx) if (i < ih) il = i;
  if (il < 0) return { ok: false, why: 'tidak ada swing low M5 sebelum swing high pasca-breakout' };
  const H = h[ih]!, L = l[il]!, R = H - L;
  if (!(R > 0)) return { ok: false, why: 'range leg tidak valid' };
  if (R < K.MIN_LEG_ATR * a) return { ok: false, why: `leg M5 terlalu kecil: ${(R / a).toFixed(2)} x ATR M5 (minimal ${K.MIN_LEG_ATR})` };
  let maxAfter = formH ?? -Infinity;
  for (let i = ih + 1; i < n; i++) maxAfter = Math.max(maxAfter, h[i]!);
  if (maxAfter > H) return { ok: false, why: 'high baru sudah melewati swing high (impuls berlanjut, leg belum final)' };
  for (let i = ih + 1; i < n; i++) if (c[i]! < L) return { ok: false, why: 'sudah ada close M5 di bawah awal leg (swing low), setup batal' };
  if (price < L) return { ok: false, why: 'harga sekarang di bawah awal leg (swing low), setup batal' };

  // 3. zona Fib 0,5-0,618 + konfluensi FVG / SNR kuat
  const zHi = H - K.FIB_NEAR * R, zLo = H - K.FIB_FAR * R;
  const ov: { x: number; y: number; t: 'fvg' | 'snr' }[] = [];
  const clip = (lo: number, hi: number, t: 'fvg' | 'snr') => {
    const x = Math.max(lo, zLo), y = Math.min(hi, zHi);
    if (x <= y) ov.push({ x, y, t });
  };
  for (let i = il + 1; i <= n - 2; i++) {
    const A = i - 1, B = i + 1;
    if (A < il || !(l[B]! > h[A]!)) continue;
    const gLo = h[A]!;
    let gHi = l[B]!;
    for (let q = B + 1; q < n; q++) gHi = Math.min(gHi, l[q]!);
    if (formL !== null) gHi = Math.min(gHi, formL);
    if (gHi > gLo) clip(gLo, gHi, 'fvg');
  }
  for (const z of pbClusters(bkSwingPrices(h, l, start, n - 1 - K.SWING, K.SWING), K.SNR_TOL_ATR * a, K.SNR_MIN_TOUCH)) clip(z.lo, z.hi, 'snr');
  let entry: number, basis: 'fvg' | 'snr' | 'mid';
  if (ov.length > 0) {
    let best = ov[0]!;
    for (const q of ov) if (q.y > best.y) best = q;
    entry = best.y; basis = best.t;
  } else { entry = H - fallbackFib * R; basis = 'mid'; }

  let minAfter = formL ?? Infinity;
  for (let i = ih + 1; i < n; i++) minAfter = Math.min(minAfter, l[i]!);
  if (minAfter <= entry) return { ok: false, why: 'level limit sudah tersentuh sejak swing high terbentuk (setup sudah lewat)' };
  if (!(price > entry)) return { ok: false, why: 'harga sekarang sudah di level limit' };

  // 4. SL 2 ATR, TP1 RR 1:2, TP2 Fib 1,13-1,618 yang melewati TP1
  const risk = K.SL_ATR * a;
  const sl = entry - risk, tp1 = entry + K.TP1_RR * risk;
  let tp2 = NaN, tp2Fib = NaN;
  for (const f of K.TP2_FIBS) {
    const p = L + f * R;
    if (p > tp1) { tp2 = p; tp2Fib = f; break; }
  }
  if (!(tp2 > tp1)) return { ok: false, why: `TP2 Fib ${K.TP2_FIBS[0]}-${K.TP2_FIBS[K.TP2_FIBS.length - 1]} tidak melewati TP1 (RR 1:${K.TP1_RR}) — leg terlalu kecil dibanding SL 2 ATR` };
  const conf = Array.from(new Set(ov.map(q => q.t.toUpperCase())));
  return { ok: true, s: { H, L, zHi, zLo, entry, sl, tp1, tp2, tp2Fib, basis, conf, ih, R, k, lvLo, lvHi, vr } };
}

/**
 * Struktur H1 (bk3) dalam "ruang BULLISH". BEARISH dipanggil dengan data dinegasikan (h'=-l, l'=-h, c'=-c).
 * Syarat: swing high fractal-3 terbaru lebih tinggi dari swing high sebelumnya (HH); leg = swing low terakhir sebelum swing high itu;
 * close terakhir belum melewati swing high itu; tidak ada close H1 (setelah swing high) di bawah Fib 0,705 leg.
 */
function bkH1StructLong(
  h: number[], l: number[], c: number[],
): { ok: true; H: number; L: number; fib: number; prevH: number } | { ok: false; why: string } {
  const K = SNIPER_BK;
  const n = h.length;
  const shIdx: number[] = [], slIdx: number[] = [];
  for (let i = K.H1_SWING; i <= n - 1 - K.H1_SWING; i++) {
    let isH = true, isL = true;
    for (let q = 1; q <= K.H1_SWING; q++) {
      if (!(h[i]! > h[i - q]! && h[i]! > h[i + q]!)) isH = false;
      if (!(l[i]! < l[i - q]! && l[i]! < l[i + q]!)) isL = false;
    }
    if (isH) shIdx.push(i);
    if (isL) slIdx.push(i);
  }
  if (shIdx.length < 2) return { ok: false, why: 'swing H1 belum cukup untuk menilai struktur' };
  const ih = shIdx[shIdx.length - 1]!, ip = shIdx[shIdx.length - 2]!;
  const H = h[ih]!, prevH = h[ip]!;
  if (!(H > prevH)) return { ok: false, why: 'belum ada swing baru searah di H1 (swing terbaru bukan HH/LL)' };
  let il = -1;
  for (const i of slIdx) if (i < ih) il = i;
  if (il < 0) return { ok: false, why: 'tidak ada swing H1 berlawanan sebelum swing terbaru' };
  const L = l[il]!, R = H - L;
  if (!(R > 0)) return { ok: false, why: 'range leg H1 tidak valid' };
  if (c[n - 1]! > H) return { ok: false, why: 'H1 masih membuat low/high baru, tunggu swing' };
  const fib = H - K.H1_FIB_BREAK * R;
  for (let i = ih + 1; i < n; i++) if (c[i]! < fib) return { ok: false, why: `struktur H1 patah: close H1 melewati Fib ${String(K.H1_FIB_BREAK).replace('.', ',')}` };
  return { ok: true, H, L, fib, prevH };
}

interface BkSetup {
  swingHigh: number; swingLow: number; zoneLo: number; zoneHi: number;
  entry: number; sl: number; tp1: number; tp2: number; tp2Fib: number;
  basis: 'fvg' | 'snr' | 'mid'; confluence: string[]; retracePct: number; rangeAtr: number; legAgeBars: number;
  breakoutAgeBars: number; levelLo: number; levelHi: number; volRatio: number;
}

function bkFindSetup(
  o: number[], h: number[], l: number[], c: number[], v: number[], d: 1 | -1, a: number, price: number, formL: number | null, formH: number | null,
): { ok: true; s: BkSetup } | { ok: false; why: string } {
  const n = h.length;
  const r = d === 1
    ? bkFindLong(o, h, l, c, v, a, price, formL, formH, SNIPER_BK.FIB_FALLBACK_BUY)
    : bkFindLong(o.map(x => -x), l.map(x => -x), h.map(x => -x), c.map(x => -x), v, a, -price, formH === null ? null : -formH, formL === null ? null : -formL, SNIPER_BK.FIB_FALLBACK_SELL);
  if (!r.ok) return r;
  const q = r.s, g = d;
  const zA = g * q.zLo, zB = g * q.zHi;
  const lvA = g * q.lvLo, lvB = g * q.lvHi;
  return {
    ok: true,
    s: {
      swingHigh: d === 1 ? q.H : -q.L, swingLow: d === 1 ? q.L : -q.H,
      zoneLo: Math.min(zA, zB), zoneHi: Math.max(zA, zB),
      entry: g * q.entry, sl: g * q.sl, tp1: g * q.tp1, tp2: g * q.tp2, tp2Fib: q.tp2Fib,
      basis: q.basis, confluence: q.conf,
      retracePct: Number(((q.H - q.entry) / q.R).toFixed(3)),
      rangeAtr: Number((q.R / a).toFixed(2)),
      legAgeBars: n - 1 - q.ih, breakoutAgeBars: n - 1 - q.k,
      levelLo: Math.min(lvA, lvB), levelHi: Math.max(lvA, lvB), volRatio: Number(q.vr.toFixed(2)),
    },
  };
}

export async function analyzeCounterStructural(symbol: string): Promise<BreakoutTradingResult> {
  const K = SNIPER_BK;
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';
  const maxScore = 0; // strategi baru tanpa sistem skor
  try {
    const [h1Raw, m5Raw] = await Promise.all([
      fetchKlines(symbol, '1h', K.HTF_FETCH),
      fetchKlines(symbol, '5m', K.LTF_FETCH),
    ]);
    const nowMs = Date.now();
    const lastH = h1Raw.times.length - 1, lastM = m5Raw.times.length - 1;
    const currentPrice = lastM >= 0 ? m5Raw.closes[lastM]! : 0;
    const noSetup = (message: string, extra: Partial<BreakoutTradingResult> = {}): BreakoutTradingResult =>
      ({ status: 'no_setup', symbol, currentPrice, timestamp, maxScore, message, ...extra });
    const formingH = lastH >= 0 && h1Raw.times[lastH]! + 3_600_000 > nowMs;
    const formingM = lastM >= 0 && m5Raw.times[lastM]! + 300_000 > nowMs;
    const cH = h1Raw.closes.length - (formingH ? 1 : 0);
    const cM = m5Raw.closes.length - (formingM ? 1 : 0);
    if (cH < K.HTF_MIN_BARS) return { status: 'error', symbol, currentPrice, timestamp, message: `Data H1 kurang (butuh ${K.HTF_MIN_BARS} candle tertutup)`, maxScore };
    if (cM < 60) return { status: 'error', symbol, currentPrice, timestamp, message: 'Data M5 kurang (butuh 60+ candle tertutup)', maxScore };

    // 1. H1: struktur market via EMA50 / EMA200
    const hc = h1Raw.closes.slice(0, cH);
    const hClose = hc[cH - 1]!;
    const e50 = calcEMASeries(hc, K.EMA_FAST)[cH - 1]!, e200 = calcEMASeries(hc, K.EMA_SLOW)[cH - 1]!;
    const fmt = (x: number) => x.toFixed(x >= 1 ? 4 : x >= 0.01 ? 5 : 6);
    let d: 1 | -1;
    let bias: 'bullish' | 'bearish';
    if (hClose > e50 && hClose > e200) { d = 1; bias = 'bullish'; }
    else if (hClose < e50 && hClose < e200) { d = -1; bias = 'bearish'; }
    else return noSetup(`H1 tidak punya arah: close ${fmt(hClose)} tidak di luar EMA${K.EMA_FAST} ${fmt(e50)} dan EMA${K.EMA_SLOW} ${fmt(e200)} sekaligus`);

    // 1b. H1 (bk3): struktur LL/HH + batas Fib 0,705 leg H1
    const hh = h1Raw.highs.slice(0, cH), hl = h1Raw.lows.slice(0, cH);
    const st = d === 1
      ? bkH1StructLong(hh, hl, hc)
      : bkH1StructLong(hl.map(x => -x), hh.map(x => -x), hc.map(x => -x));
    if (!st.ok) return noSetup(`Struktur H1 tidak lolos (${st.why})`, { bias });
    const h1High = d === 1 ? st.H : -st.L, h1Low = d === 1 ? st.L : -st.H, h1Fib = d === 1 ? st.fib : -st.fib;
    const h1Struct: 'LL' | 'HH' = d === 1 ? 'HH' : 'LL';

    // 2. M5: breakout SnR searah H1 + retest Fib
    const o =m5Raw.opens.slice(0, cM), h = m5Raw.highs.slice(0, cM), l = m5Raw.lows.slice(0, cM), c = m5Raw.closes.slice(0, cM), v = m5Raw.volumes.slice(0, cM);
    const a = calcATR(h, l, c);
    if (!(a > 0)) return noSetup('ATR M5 tidak valid', { bias });
    const formL = formingM ? m5Raw.lows[lastM]! : null, formH = formingM ? m5Raw.highs[lastM]! : null;
    const res = bkFindSetup(o, h, l, c, v, d, a, currentPrice, formL, formH);
    if (!res.ok) return noSetup(`Belum ada setup Breakout+Fib M5 (${res.why})`, { bias });
    const s = res.s;

    const risk = Math.abs(s.entry - s.sl);
    const rr1 = Math.abs(s.tp1 - s.entry) / risk, rr2 = Math.abs(s.tp2 - s.entry) / risk;
    const basisTxt = s.basis === 'mid' ? `Fib ${s.retracePct.toFixed(3).replace('.', ',')} (tanpa FVG/SNR)` : `tepi ${s.basis.toUpperCase()} dalam zona`;
    const fibTp2 = Number((d === 1 ? s.tp2Fib : -(s.tp2Fib - 1)).toFixed(3));
    const filterResults: string[] = [
      `✅ H1 ${bias === 'bullish' ? 'BULLISH' : 'BEARISH'}: close ${fmt(hClose)} ${d === 1 ? 'di atas' : 'di bawah'} EMA${K.EMA_FAST} ${fmt(e50)} & EMA${K.EMA_SLOW} ${fmt(e200)}`,
      `✅ Struktur H1 ${h1Struct}: leg ${fmt(h1High)} ↔ ${fmt(h1Low)}, Fib 0,705 di ${fmt(h1Fib)} belum ditembus close H1`,
      `✅ Breakout SnR M5 ${s.breakoutAgeBars} candle lalu: level ${fmt(s.levelLo)} – ${fmt(s.levelHi)}, volume ${s.volRatio.toFixed(2)}x MA${K.VOL_MA} (>= ${K.VOL_MIN}x)`,
      `✅ Leg Fib M5: ${d === 1 ? 'swing low' : 'swing high'} ${fmt(d === 1 ? s.swingLow : s.swingHigh)} → ${d === 1 ? 'swing high' : 'swing low'} ${fmt(d === 1 ? s.swingHigh : s.swingLow)} (range ${s.rangeAtr}x ATR M5, swing ${s.legAgeBars} candle lalu)`,
      `✅ Zona retrace 0,5–0,618: ${fmt(s.zoneLo)} – ${fmt(s.zoneHi)}; konfluensi: ${s.confluence.length ? s.confluence.join(' + ') : 'tidak ada'}`,
      `✅ LIMIT ${d === 1 ? 'BUY' : 'SELL'} ${fmt(s.entry)} = ${basisTxt} (retrace ${(s.retracePct * 100).toFixed(1)}%)`,
      `✅ SL ${fmt(s.sl)} (entry ${d === 1 ? '−' : '+'} ${K.SL_ATR} × ATR M5); TP1 ${fmt(s.tp1)} (RR 1:${rr1.toFixed(1)}); TP2 ${fmt(s.tp2)} (Fib ${fibTp2}, RR 1:${rr2.toFixed(2)})`,
    ];
    return {
      status: 'siap_retest', symbol, bias, currentPrice, timestamp, maxScore,
      filterResults, volumeRatio: s.volRatio,
      entryPrice: s.entry, orderType: 'limit', stopLoss: s.sl, takeProfit1: s.tp1, takeProfit2: s.tp2,
      rr1: Number(rr1.toFixed(2)), rr2: Number(rr2.toFixed(2)),
      bkVersion: K.VERSION, bkLevelLo: s.levelLo, bkLevelHi: s.levelHi, bkVolRatio: s.volRatio,
      bkSwingHigh: s.swingHigh, bkSwingLow: s.swingLow, bkZoneLo: s.zoneLo, bkZoneHi: s.zoneHi,
      bkBasis: s.basis, bkConfluence: s.confluence.join('+'), bkRetracePct: s.retracePct, bkTp2Fib: fibTp2,
      bkRangeAtr: s.rangeAtr, bkLegAgeBars: s.legAgeBars,
      bkH1High: h1High, bkH1Low: h1Low, bkH1Fib705: h1Fib, bkH1Struct: h1Struct,
      validUntilMs: nowMs + K.VALID_MS, validUntilHours: 24,
      message: `SIAP ${d === 1 ? 'BUY LIMIT' : 'SELL LIMIT'} di ${fmt(s.entry)} — Breakout+Fib H1→M5 (H1 ${bias}, struktur ${h1Struct}), breakout SnR M5 volume ${s.volRatio.toFixed(1)}x, limit di ${basisTxt}, SL ${fmt(s.sl)} (2 ATR M5), TP1 ${fmt(s.tp1)} (RR 1:2), TP2 ${fmt(s.tp2)} (Fib ${fibTp2}). Batal bila close M5 menembus ${fmt(d === 1 ? s.swingLow : s.swingHigh)} sebelum terisi, kedaluwarsa 24 jam.`,
    };
  } catch (err) {
    return {
      status: 'error', symbol, currentPrice: 0, timestamp,
      message: err instanceof Error ? err.message : 'Unknown error',
      maxScore: 0,
    };
  }
}

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
      data = (await res.json()) as number[][];
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


// Money Magnet mm2 (2026-11-02): FILTER struktur H1 (request user). Cuma menolak kalau ada close H1 (body) yang melewati Fib 0,705 leg H1 terakhir.
// Tidak mensyaratkan HH/LL dan tidak mengubah logic CRT lain. Leg tidak terbentuk -> 'unknown' (sinyal TIDAK diblokir).
const MM_H1_SWING = 3, MM_H1_FIB_BREAK = 0.705, MM_H1_FETCH = 150;
function mmH1FibLong(h: number[], l: number[], c: number[]): { state: 'ok' | 'broken' | 'unknown'; fib?: number } {
  const n = h.length - 1; // candle H1 TERTUTUP saja (index terakhir = candle berjalan, dibuang)
  let ih = -1, il = -1;
  const lows: number[] = [];
  for (let i = MM_H1_SWING; i <= n - 1 - MM_H1_SWING; i++) {
    let isH = true, isL = true;
    for (let q = 1; q <= MM_H1_SWING; q++) {
      if (!(h[i]! > h[i - q]! && h[i]! > h[i + q]!)) isH = false;
      if (!(l[i]! < l[i - q]! && l[i]! < l[i + q]!)) isL = false;
    }
    if (isH) ih = i;
    if (isL) lows.push(i);
  }
  if (ih < 0) return { state: 'unknown' };
  for (const k of lows) if (k < ih) il = k;
  if (il < 0) return { state: 'unknown' };
  const H = h[ih]!, R = H - l[il]!;
  if (!(R > 0)) return { state: 'unknown' };
  const fib = H - MM_H1_FIB_BREAK * R;
  for (let k = ih + 1; k < n; k++) if (c[k]! < fib) return { state: 'broken', fib };
  return { state: 'ok', fib };
}

// Money Magnet mm3 (2026-11-02, request user): SL di Fib 0,71 (sedikit di luar 0,705 = batas CHoCH). Tidak ada jarak SL minimal (mau diuji di Jurnal).
// Leg BUY: Fib 1 = awal leg, Fib 0 = high tertinggi sejak sweep sampai candle tertutup terakhir. SELL kebalikannya.
//   reversal: Fib 1 = ekstrem sweep (low terendah sweepIdx..displacementIdx). failure-to-manipulate: Fib 1 = swing berlawanan terakhir sebelum sweep.
// Leg tidak terbentuk -> null (pemanggil fallback ke SL 2 x ATR M5).
const MM_SL_FIB = 0.71;
function mmFibSlLeg(
  type: 'reversal' | 'failure_to_manipulate', direction: 'bullish' | 'bearish', sweepIdx: number, displacementIdx: number, lastClosedIdx: number,
  highs: number[], lows: number[], swingHighs: { price: number; index: number }[], swingLows: { price: number; index: number }[],
): { f0: number; f1: number; sl: number } | null {
  const bull = direction === 'bullish';
  let f1: number;
  if (type === 'reversal') {
    const to = Math.max(sweepIdx, Math.min(displacementIdx, lastClosedIdx));
    f1 = bull ? Infinity : -Infinity;
    for (let i = sweepIdx; i <= to; i++) f1 = bull ? Math.min(f1, lows[i]!) : Math.max(f1, highs[i]!);
  } else {
    const prev = (bull ? swingLows : swingHighs).filter(x => x.index < sweepIdx);
    if (prev.length === 0) return null;
    f1 = prev[prev.length - 1]!.price;
  }
  let f0 = bull ? -Infinity : Infinity;
  for (let i = sweepIdx; i <= lastClosedIdx; i++) f0 = bull ? Math.max(f0, highs[i]!) : Math.min(f0, lows[i]!);
  if (!Number.isFinite(f0) || !Number.isFinite(f1)) return null;
  const R = bull ? f0 - f1 : f1 - f0;
  if (!(R > 0)) return null;
  return { f0, f1, sl: bull ? f0 - MM_SL_FIB * R : f0 + MM_SL_FIB * R };
}

export async function analyzeMoneyMagnetScalping(symbol: string): Promise<ScalpingResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';
  const maxScore = 16; // REVISI TOTAL (request user): Money Magnet Scalping ganti dari RCT ke CRT
  // (sama persis Menu Scalping/Sniper Breakout) -- TF TETEP H1->M5, cuma logic-nya diseragamkan.
  // Candle fetch & semua window internal di-rescale ikut budget baru (request
  // user): H1:72/M5:36, lihat komentar FASE 2/3 di bawah buat detail per-window.

  try {
    // Fetch candle H1:72/M5:36 (request user) -- guard & window internal
    // di-rescale ikut budget baru ini, lihat komentar FASE 2 di bawah.
    const [h1, m5, tickerRes] = await Promise.all([
      fetchKlines(symbol, '1h', MM_H1_FETCH),
      fetchKlines(symbol, '5m', 36),
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);
    const currentPrice = tickerRes.ok
      ? parseFloat((await tickerRes.json() as { price: string }).price)
      : m5.closes[m5.closes.length - 1]!;

    if (h1.closes.length < 20) {
      return { status: 'error', symbol, currentPrice, timestamp, mode: 'moneymagnetscalping', message: 'Data candle gak cukup (butuh H1 20+)', maxScore };
    }
    if (m5.closes.length < 30) {
      return { status: 'error', symbol, currentPrice, timestamp, mode: 'moneymagnetscalping', message: 'Data candle gak cukup (butuh M5 30+)', maxScore };
    }

    // ═══ FASE 1: H1 BIAS (CRT -- Discount/Premium dari posisi harga dalam
    // range H1 candle yang lagi jalan, Range/ATR14 nentuin validitas) ═══════
    // FIX (request user, tervalidasi tes BTC/ETH/SOL/WLFI/XRP real: candle
    // H1 yang lagi JALAN cuma punya maks 1 jam buat ngebentuk range -- hampir
    // selalu kekecilan dibanding ATR14 (14 candle H1), beda sama D1/H4 yang
    // punya waktu jauh lebih lama buat ngebentuk range candle berjalannya.
    // 0/5 koin lolos pake forming candle, jadi 2/5 pake candle CLOSED.
    const h1LastIdx = h1.closes.length - 2; // candle H1 closed terakhir (BUKAN forming)
    const h1High = h1.highs[h1LastIdx]!, h1Low = h1.lows[h1LastIdx]!, h1Close = h1.closes[h1LastIdx]!;
    const h1Range = h1High - h1Low;
    const atr14H1 = calcATR(
      h1.highs.slice(Math.max(0, h1LastIdx - 14), h1LastIdx), h1.lows.slice(Math.max(0, h1LastIdx - 14), h1LastIdx), h1.closes.slice(Math.max(0, h1LastIdx - 14), h1LastIdx),
    );
    const rangeAtrRatio = atr14H1 > 0 ? h1Range / atr14H1 : 0;
    const h1Pos = h1Range > 0 ? (h1Close - h1Low) / h1Range : 0.5;
    const h1Location: 'discount' | 'premium' = h1Pos < 0.5 ? 'discount' : 'premium';
    let h1Validity: 'skip_kurang' | 'valid' | 'hati-hati' | 'skip_exhausted';
    if (rangeAtrRatio < 0.70) h1Validity = 'skip_kurang';
    else if (rangeAtrRatio <= 1.50) h1Validity = 'valid';
    else if (rangeAtrRatio <= 2.00) h1Validity = 'hati-hati';
    else h1Validity = 'skip_exhausted';

    if (h1Validity === 'skip_kurang' || h1Validity === 'skip_exhausted') {
      return {
        status: 'no_setup', symbol, currentPrice, timestamp, mode: 'moneymagnetscalping', maxScore,
        message: `H1 Range/ATR14 ${rangeAtrRatio.toFixed(2)} (${h1Validity === 'skip_kurang' ? 'range H1 belum cukup gerak' : 'range H1 udah exhausted'}) -- skip, tunggu candle H1 baru`,
        filterResults: [`🚫 H1 Range/ATR14 ${rangeAtrRatio.toFixed(2)} -- ${h1Validity}`],
      };
    }

    // ═══ FASE 2: LIQUIDITY (swing high/low M5, window 28 candle ~2,3 jam --
    // re-scale request user ngikut fetch M5:36. Fractal strength 10->3,
    // konsekuensi: swing jadi lebih sensitif ke noise, BELUM divalidasi
    // backtest -- request user, "lanjut apa adanya") ═══════════════════════
    const lastClosedIdx = m5.closes.length - 2;
    const atrM5 = calcATR(m5.highs.slice(0, lastClosedIdx + 1), m5.lows.slice(0, lastClosedIdx + 1), m5.closes.slice(0, lastClosedIdx + 1));
    if (atrM5 <= 0) {
      return { status: 'error', symbol, currentPrice, timestamp, mode: 'moneymagnetscalping', message: 'ATR M5 gak valid', maxScore };
    }
    const liqWindow = 28;
    const liqStart = Math.max(0, lastClosedIdx - liqWindow);
    const swingHighs = findRecentSwingHighsWithIndex(m5.highs.slice(liqStart, lastClosedIdx), 3)
      .map(s => ({ price: s.price, index: liqStart + s.index }));
    const swingLows = findRecentSwingLowsWithIndex(m5.lows.slice(liqStart, lastClosedIdx), 3)
      .map(s => ({ price: s.price, index: liqStart + s.index }));
    if (swingHighs.length < 2 || swingLows.length < 2) {
      return { status: 'no_setup', symbol, currentPrice, timestamp, mode: 'moneymagnetscalping', message: 'Belum cukup swing high/low M5 buat cari liquidity', maxScore };
    }

    const findDisplacementFVG = (startIdx: number, endIdx: number, dir: 'bullish' | 'bearish'): {
      displacementIdx: number; fvgIdx: number; bodyAtr: number; bodyRangeRatio: number; fvgAtr: number; ce: number; fvgTop: number; fvgBot: number;
    } | null => {
      for (let j = startIdx; j <= Math.min(endIdx, lastClosedIdx); j++) {
        if (j < 1 || j + 1 > lastClosedIdx) continue;
        const body = Math.abs(m5.closes[j]! - m5.opens[j]!);
        const range = m5.highs[j]! - m5.lows[j]!;
        const bodyAtr = atrM5 > 0 ? body / atrM5 : 0;
        const bodyRangeRatio = range > 0 ? body / range : 0;
        const dirOk = dir === 'bearish' ? m5.closes[j]! < m5.opens[j]! : m5.closes[j]! > m5.opens[j]!;
        if (!dirOk || bodyAtr < 0.8 || bodyRangeRatio < 0.60) continue;
        let fvgTop: number, fvgBot: number;
        if (dir === 'bearish') {
          if (!(m5.lows[j - 1]! > m5.highs[j + 1]!)) continue;
          fvgTop = m5.lows[j - 1]!; fvgBot = m5.highs[j + 1]!;
        } else {
          if (!(m5.highs[j - 1]! < m5.lows[j + 1]!)) continue;
          fvgTop = m5.lows[j + 1]!; fvgBot = m5.highs[j - 1]!;
        }
        const fvgSize = fvgTop - fvgBot;
        const fvgAtr = atrM5 > 0 ? fvgSize / atrM5 : 0;
        if (fvgAtr < 0.10) continue;
        return { displacementIdx: j, fvgIdx: j + 1, bodyAtr, bodyRangeRatio, fvgAtr, ce: (fvgTop + fvgBot) / 2, fvgTop, fvgBot };
      }
      return null;
    };

    // ═══ FASE 3: SWEEP -> REVERSAL (CISD) atau FAILURE TO MANIPULATE ═══════
    // Re-scale (request user) ngikut budget M5:36 baru: reclaim window 8
    // candle, displacement reversal 5 candle, continuation 10 candle.
    type SetupResult = {
      type: 'reversal' | 'failure_to_manipulate'; direction: 'bullish' | 'bearish'; sweepIdx: number; sweepLevel: number;
      penRatio: number; displacementIdx: number; fvgIdx: number; bodyAtr: number; bodyRangeRatio: number; fvgAtr: number;
      ce: number; fvgTop: number; fvgBot: number;
    };
    const detectAtSweep = (sweepIdx: number, level: number, sweptSide: 'high' | 'low'): SetupResult | null => {
      const penetration = sweptSide === 'high' ? m5.highs[sweepIdx]! - level : level - m5.lows[sweepIdx]!;
      const penRatio = atrM5 > 0 ? penetration / atrM5 : 0;
      if (penRatio < 0.10) return null;
      const reversalDir: 'bullish' | 'bearish' = sweptSide === 'high' ? 'bearish' : 'bullish';
      const continuationDir: 'bullish' | 'bearish' = sweptSide === 'high' ? 'bullish' : 'bearish';

      // FIX (request user, kasus asli NEARUSDT: SL kebalik posisi sama
      // entry -- SL di BAWAH entry buat sinyal SELL, padahal harusnya di
      // ATAS). Akar masalahnya: reclaim dicek sekali (candle i), tapi
      // displacement+FVG BENERAN dicari sampe 36-72 candle setelahnya --
      // kalau harga whipsaw (reclaim duluan, tapi baru displacement JAUH
      // belakangan, udah balik lewatin level sweep lagi), CE bisa kehitung
      // di SISI YANG SALAH dari sweepExtreme. SL (dihitung dari sweepExtreme)
      // jadi ketuker posisi sama entry (CE). Sekarang CE WAJIB di sisi yang
      // bener dari sweepExtreme (searah sinyal), kalau enggak, setup ditolak.
      const sweepExtremeCheck = sweptSide === 'high' ? m5.highs[sweepIdx]! : m5.lows[sweepIdx]!;
      for (let i = sweepIdx; i <= Math.min(sweepIdx + 8, lastClosedIdx); i++) {
        const reclaimed = reversalDir === 'bearish' ? m5.closes[i]! < level : m5.closes[i]! > level;
        if (!reclaimed) continue;
        const disp = findDisplacementFVG(i, i + 5, reversalDir);
        if (!disp) continue;
        const ceOnCorrectSide = reversalDir === 'bullish' ? disp.ce > sweepExtremeCheck : disp.ce < sweepExtremeCheck;
        if (!ceOnCorrectSide) continue;
        return { type: 'reversal', direction: reversalDir, sweepIdx, sweepLevel: level, penRatio, ...disp };
      }
      const disp2 = findDisplacementFVG(sweepIdx, sweepIdx + 10, continuationDir);
      if (disp2) {
        const ceOnCorrectSide2 = continuationDir === 'bullish' ? disp2.ce > sweepExtremeCheck : disp2.ce < sweepExtremeCheck;
        if (ceOnCorrectSide2) return { type: 'failure_to_manipulate', direction: continuationDir, sweepIdx, sweepLevel: level, penRatio, ...disp2 };
      }
      return null;
    };

    // Scan sweep TERBARU doang (fresh window 14 candle M5 ~70 menit -- re-scale request user)
    const freshWindow = 14;
    let found: SetupResult | null = null;
    for (const sh of swingHighs.slice(0, 5)) {
      for (let i = Math.max(sh.index + 1, lastClosedIdx - freshWindow); i <= lastClosedIdx; i++) {
        if (m5.highs[i]! > sh.price) {
          const r = detectAtSweep(i, sh.price, 'high');
          if (r) { found = r; }
          break;
        }
      }
      if (found) break;
    }
    if (!found) {
      for (const sl of swingLows.slice(0, 5)) {
        for (let i = Math.max(sl.index + 1, lastClosedIdx - freshWindow); i <= lastClosedIdx; i++) {
          if (m5.lows[i]! < sl.price) {
            const r = detectAtSweep(i, sl.price, 'low');
            if (r) { found = r; }
            break;
          }
        }
        if (found) break;
      }
    }

    if (!found) {
      return {
        status: 'waiting', symbol, currentPrice, timestamp, mode: 'moneymagnetscalping', maxScore,
        message: `H1 ${h1Location} (Range/ATR14 ${rangeAtrRatio.toFixed(2)}), tapi belum ada sweep+reversal atau sweep+failure-to-manipulate M5 yang valid dalam ${freshWindow} candle terakhir`,
        filterResults: [`ℹ️ H1 ${h1Location}, Range/ATR14 ${rangeAtrRatio.toFixed(2)} (${h1Validity})`],
      };
    }

    // ═══ FILTER mm2: struktur H1 (cuma menolak kalau close H1 sudah melewati Fib 0,705 leg H1 terakhir) ═══
    const h1Fib = found.direction === 'bullish'
      ? mmH1FibLong(h1.highs, h1.lows, h1.closes)
      : mmH1FibLong(h1.lows.map(x => -x), h1.highs.map(x => -x), h1.closes.map(x => -x));
    const mmH1Fib705 = h1Fib.fib === undefined ? undefined : (found.direction === 'bullish' ? h1Fib.fib : -h1Fib.fib);
    if (h1Fib.state === 'broken') {
      return {
        status: 'no_setup', symbol, bias: found.direction, currentPrice, timestamp, mode: 'moneymagnetscalping', maxScore,
        message: `Setup CRT ketemu (${found.direction}) tapi struktur H1 patah: ada close H1 yang melewati Fib 0,705 leg H1 (${mmH1Fib705!.toFixed(6)}) -- ditolak`,
        filterResults: [`🚫 Struktur H1 patah: close H1 melewati Fib 0,705 (${mmH1Fib705!.toFixed(6)})`],
        mmCrtVersion: 'mm3', mmH1Struct: 'ok', mmH1Fib705,
      };
    }

    // ═══ FASE 4: SCORING 16 POIN (sama persis Menu Scalping/Sniper Breakout) ═
    const dirMatchesH1 = (h1Location === 'discount' && found.direction === 'bullish') || (h1Location === 'premium' && found.direction === 'bearish');
    let h1Score = 0; let m5Score = 0;
    const filterResults: string[] = [];
    filterResults.push(h1Fib.state === 'ok' ? `✅ Struktur H1 aman: belum ada close H1 melewati Fib 0,705 (${mmH1Fib705!.toFixed(6)}) (filter, +0)` : 'ℹ️ Struktur H1 belum bisa dinilai (leg H1 belum terbentuk), tidak diblokir (filter, +0)');
    if (dirMatchesH1) { h1Score += 2; filterResults.push('✅ H1 Discount/Premium SEARAH sinyal (+2)'); }
    else filterResults.push(`⚠️ H1 ${h1Location.toUpperCase()} TAPI sinyal ${found.direction} -- berlawanan arah H1 (+0)`);
    h1Score += 2; filterResults.push('✅ Liquidity jelas, swing valid (+2)');
    if (h1Validity === 'valid') { h1Score += 1; filterResults.push(`✅ H1 Range/ATR14 ${rangeAtrRatio.toFixed(2)} (+1)`); }
    else filterResults.push(`⚠️ H1 Range/ATR14 ${rangeAtrRatio.toFixed(2)} (hati-hati) (+0)`);

    m5Score += 2; filterResults.push(`✅ Sweep penetrasi ${found.penRatio.toFixed(2)}x ATR M5 (+2)`);
    if (found.type === 'reversal') { m5Score += 2; filterResults.push('✅ Reclaim & close balik, CISD konfirmed (+2)'); }
    else { m5Score += 2; filterResults.push('✅ Gak ada reclaim lawan arah -- Failure to Manipulate valid (+2)'); }
    m5Score += 2; filterResults.push(`✅ Displacement body ${found.bodyAtr.toFixed(2)}x ATR M5 (+2)`);
    m5Score += 1; filterResults.push(`✅ Body/range candle displacement ${(found.bodyRangeRatio * 100).toFixed(0)}% (+1)`);
    m5Score += 1; filterResults.push(`✅ FVG size ${found.fvgAtr.toFixed(2)}x ATR M5 (+1)`);
    m5Score += 1; filterResults.push('✅ Entry di 50% FVG / CE (+1)');

    // ═══ FASE 5: ENTRY/SL/TP ═══════════════════════════════════════════════
    const dirMult = found.direction === 'bullish' ? 1 : -1;
    const entryPrice = found.ce;
    // SL = entry -/+ 2 x ATR(M5) (request user 2026-10-30; sebelumnya ekstrem sweep -/+ 0,15 ATR + filter min 0,8 ATR)
    // mm3: SL di Fib 0,71 leg sweep->displacement (fallback SL 2 x ATR M5 kalau leg gak kebentuk). Tanpa jarak SL minimal.
    const fibLeg = mmFibSlLeg(found.type, found.direction, found.sweepIdx, found.displacementIdx, lastClosedIdx, m5.highs, m5.lows, swingHighs, swingLows);
    const mmSlMode: 'fib' | 'atr' = fibLeg ? 'fib' : 'atr';
    const stopLoss = fibLeg ? fibLeg.sl : entryPrice - 2.0 * atrM5 * dirMult;
    if (fibLeg && !(found.direction === 'bullish' ? stopLoss < entryPrice : stopLoss > entryPrice)) {
      return {
        status: 'no_setup', symbol, bias: found.direction, currentPrice, timestamp, mode: 'moneymagnetscalping', maxScore,
        message: `Setup CRT ketemu (${found.direction}) tapi CE (${entryPrice.toFixed(6)}) sudah melewati Fib 0,71 leg (${stopLoss.toFixed(6)}) -- struktur leg sudah patah, ditolak`,
        filterResults: [`🚫 CE sudah melewati Fib 0,71 leg sweep (${stopLoss.toFixed(6)})`],
        mmCrtVersion: 'mm3', mmSlMode,
      };
    }
    const risk = Math.abs(entryPrice - stopLoss);
    if (risk <= 0) {
      return { status: 'no_setup', symbol, currentPrice, timestamp, mode: 'moneymagnetscalping', message: 'Risk gak valid (entry & SL kelewat dekat)', maxScore, filterResults };
    }
    // FIX (request user, kasus asli TRBUSDT: TP2 kebukti lebih DEKET dari
    // TP1). FIX LAGI (request user): TP2 minimal RR 1:3, bukan cuma "di luar
    // TP1" (RR>=2.0) -- sekarang target WAJIB RR>=3.0 dulu.
    const minTargetRR = entryPrice + risk * 3.0 * dirMult;
    const liqPool = found.direction === 'bullish' ? swingHighs : swingLows;
    // mm3: TP2 = RR 1:3 tetap (sebelumnya liquidity berlawanan dengan RR >= 3). liqPool/minTargetRR tidak dipakai lagi.
    void liqPool; void minTargetRR;
    const target = entryPrice + risk * 3.0 * dirMult;
    const reward = Math.abs(target - entryPrice);
    const rr = reward / risk;
    if (rr >= 3.5) { m5Score += 2; filterResults.push(`✅ RR ${rr.toFixed(1)} (>=3.5) (+2)`); }
    else if (rr >= 3.0 - 1e-9) { m5Score += 1; filterResults.push(`⚠️ RR ${rr.toFixed(1)} (3.0-3.5) (+1)`); }
    else filterResults.push(`🚫 RR ${rr.toFixed(1)} (<3.0) (+0)`);

    const totalScore = h1Score + m5Score;
    const bias = found.direction;

    if (totalScore < 12) {
      return {
        status: 'no_setup', symbol, bias, currentPrice, timestamp, mode: 'moneymagnetscalping', maxScore, score: totalScore,
        message: `Setup CRT ketemu (${found.type === 'reversal' ? 'reversal' : 'failure to manipulate'}, ${bias}) tapi skor ${totalScore}/16 di bawah minimum 12`,
        filterResults,
      };
    }

    // ═══ BTC CORRELATION FILTER (request user) -- lihat komentar di definisi
    // checkBtcCorrelationFilter buat detail logic & threshold. Filter ini
    // selalu pakai M15 20 candle (bukan M5 eksekusi menu ini) biar konsisten
    // sama Menu Scalping, jadi fetch M15 koin terpisah khusus buat ini. ═════
    const m15ForBtcFilter = await fetchKlines(symbol, '15m', 48); // request user: BTC Correlation Filter limit 48
    const btcFilter = await checkBtcCorrelationFilter(symbol, bias, m15ForBtcFilter.closes);
    // FIX (audit, sama kayak Menu Scalping): btcAligned/btcBias di-isi dari
    // btcFilter yang udah dihitung -- sebelumnya selalu undefined, Journal
    // gak pernah punya data buat statistik "BTC Searah %".
    const btcAligned = btcFilter.btcDirection === 'ranging' ? undefined : btcFilter.btcDirection === bias;
    const btcBias = btcFilter.btcDirection;
    if (btcFilter.action === 'block') {
      return {
        status: 'no_setup', symbol, bias, currentPrice, timestamp, mode: 'moneymagnetscalping', maxScore, score: totalScore,
        message: `Setup CRT valid (skor ${totalScore}/16) TAPI ${btcFilter.message}`,
        filterResults,
        btcCorrAction: btcFilter.action, btcCorrValue: btcFilter.correlation, btcCorrBtcDirection: btcFilter.btcDirection,
        btcAligned, btcBias,
      };
    }

    const grade = totalScore >= 14 ? 'A+' : 'A';
    // FIX (sama kayak fix ENAUSDT di Sniper Breakout/Menu Scalping): entry
    // harus BENERAN di sisi yang bener dari harga sekarang, bukan cuma "gak
    // kejauhan" -- kalau enggak, bisa muncul BUY LIMIT di ATAS harga sekarang.
    const entryStillValid = bias === 'bullish' ? (entryPrice <= currentPrice && entryPrice >= currentPrice * 0.98) : (entryPrice >= currentPrice && entryPrice <= currentPrice * 1.02);
    if (!entryStillValid) {
      return {
        status: 'waiting', symbol, bias, currentPrice, timestamp, mode: 'moneymagnetscalping', maxScore, score: totalScore,
        message: `Setup CRT valid (skor ${totalScore}/16, grade ${grade}) tapi harga udah kejauhan dari entry/CE (${entryPrice.toFixed(6)})${btcFilter.action === 'warn' ? ` ${btcFilter.message}` : ''}`,
        filterResults,
        btcCorrAction: btcFilter.action, btcCorrValue: btcFilter.correlation, btcCorrBtcDirection: btcFilter.btcDirection,
        btcCorrWarningMsg: btcFilter.action === 'warn' ? btcFilter.message : undefined,
        btcAligned, btcBias,
        mmCrtVersion: 'mm3', mmH1Struct: h1Fib.state === 'ok' ? 'ok' : 'unknown', mmH1Fib705,
      };
    }

    const takeProfit1 = entryPrice + risk * 2.0 * dirMult;
    const takeProfit2 = target;
    const btcWarnMsgMM = btcFilter.action === 'warn' ? ` ${btcFilter.message}` : '';

    return {
      status: 'in_zone', symbol, bias, currentPrice, timestamp, mode: 'moneymagnetscalping', maxScore, score: totalScore,
      filterResults,
      entryPrice, stopLoss, takeProfit1, takeProfit2, rr1: 2.0, rr2: Number(rr.toFixed(2)),
      atr15MPct: (atrM5 / currentPrice) * 100,
      btcCorrAction: btcFilter.action, btcCorrValue: btcFilter.correlation, btcCorrBtcDirection: btcFilter.btcDirection,
      btcCorrWarningMsg: btcFilter.action === 'warn' ? btcFilter.message : undefined,
      btcAligned, btcBias,
      mmCrtVersion: 'mm3', mmH1Struct: h1Fib.state === 'ok' ? 'ok' : 'unknown', mmH1Fib705,
      mmSlMode, mmFib0: fibLeg?.f0, mmFib1: fibLeg?.f1,
      validUntilMs: Date.now() + 36 * 5 * 60_000, // limit batal 36 candle M5 (~3 jam), sama dgn teks di message/Alur Logic
      message: `SIAP PASANG ${bias === 'bullish' ? 'BUY' : 'SELL'} LIMIT di ${entryPrice.toFixed(6)} (CE/50% FVG) -- H1 ${h1Location}, M5 ${found.type === 'reversal' ? 'sweep+reversal (CISD)' : 'sweep+failure to manipulate (continuation)'}, skor ${totalScore}/16 (${grade}). SL ${stopLoss.toFixed(6)} (${mmSlMode === 'fib' ? 'Fib 0,71 leg sweep' : '2 ATR M5, leg Fib belum terbentuk'}), TP1 RR1:2, TP2 RR1:3. Limit expired 36 candle M5 (~3 jam) kalau belum fill.${btcWarnMsgMM}`,
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
  // Default fetch candle TA PRO (request user) -- lihat TA_PRO_CANDLE_LIMIT.
  const [d1, h4, h1, m30, m15, m5] = await Promise.all([
    fetchKlines(symbol, '1d', TA_PRO_CANDLE_LIMIT.D1),
    fetchKlines(symbol, '4h', TA_PRO_CANDLE_LIMIT.H4),
    fetchKlines(symbol, '1h', TA_PRO_CANDLE_LIMIT.H1),
    fetchKlines(symbol, '30m', TA_PRO_CANDLE_LIMIT.M30),
    fetchKlines(symbol, '15m', TA_PRO_CANDLE_LIMIT.M15),
    fetchKlines(symbol, '5m', TA_PRO_CANDLE_LIMIT.M5),
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
// TECHNICAL ANALYSIS PRO -- FITUR 4: Struktur H4 + SNR kuat + OB / SND / Imbalance
// (request user, mengganti Breakout & Bounce SNR). TF H4 / H1 / M15 / M5 (pilihan), 200 candle,
// hanya candle yang sudah close. Isi:
//  1. Struktur market H4 (bias + urutan swing HH/HL/LH/LL terakhir).
//  2. Support/Resistance kuat: cluster swing high+low (fractal 2-2), lebar zona
//     maks 0.5 x ATR14, minimal 2 sentuhan (titik swing), resistance di atas harga,
//     support di bawah harga.
//  3. Order Block: reuse detectOrderBlocksH1 (candle lawan sebelum impuls >1.5x
//     range + FVG + BOS, belum termitigasi) untuk kedua arah, lookback 200.
//  4. Supply/Demand: base 1-3 candle kecil (body <= 0.5 ATR, range <= 0.8 ATR)
//     diikuti candle impuls (body >= 1.5 ATR); zona belum ditutup menembus
//     batas jauhnya (distal).
//  5. Imbalance (FVG): celah 3 candle >= 0.15 ATR, status unfilled / partial
//     (belum filled penuh oleh close).
// ═══════════════════════════════════════════════════════════════════════════

export const SNR_ZONES_CANDLES = 200;
export type SnrTf = 'H4' | 'H1' | 'M15' | 'M5';
const SNR_TF_INTERVAL: Record<SnrTf, string> = { H4: '4h', H1: '1h', M15: '15m', M5: '5m' };

export interface SnrLevel { price: number; zoneLow: number; zoneHigh: number; touches: number; type: 'support' | 'resistance'; distancePct: number; }
export interface SnrZone { kind: 'OB' | 'SND'; side: 'demand' | 'supply'; high: number; low: number; candlesAgo: number; touches: number; fresh: boolean; distancePct: number; inside: boolean; note: string; }
export interface SnrImbalance { side: 'bullish' | 'bearish'; high: number; low: number; candlesAgo: number; filledPct: number; distancePct: number; inside: boolean; }

export interface SnrZonesResult {
  symbol: string; tf: SnrTf; candlesUsed: number; currentPrice: number; atr: number;
  structure: { bias: BtcStructureBias; transition: 'bull_to_bear' | 'bear_to_bull' | null; note: string; swingSequence: string[] };
  resistances: SnrLevel[]; supports: SnrLevel[];
  orderBlocks: SnrZone[]; supplyDemand: SnrZone[]; imbalances: SnrImbalance[];
  narrative: SnrNarrative;
  reasoning: string[];
}

export interface SnrNarrative {
  headline: string;
  kejadian: string[];
  strukturSekarang: string[];
  levelTerbaru: { resistance: string[]; support: string[] };
  skenario: { nama: string; trigger: string; target: string; utama: boolean }[];
  entry: { arah: 'SHORT' | 'LONG'; tipe: string; kondisi: string; entry: string; sl: string; tp: string; searahStruktur: boolean }[];
  catatan: string[];
}

export async function analyzeSnrZones(symbol: string, tf: SnrTf = 'H4'): Promise<SnrZonesResult> {
  const k = await fetchKlines(symbol, SNR_TF_INTERVAL[tf], SNR_ZONES_CANDLES);
  const n = k.closes.length - 1; // buang candle H4 yang masih berjalan
  const O = k.opens.slice(0, n), H = k.highs.slice(0, n), L = k.lows.slice(0, n), C = k.closes.slice(0, n);
  const reasoning: string[] = [];
  const price = C[n - 1]!;
  const atr = calcATR(H, L, C);
  const dist = (lo: number, hi: number): { distancePct: number; inside: boolean } => {
    if (price >= lo && price <= hi) return { distancePct: 0, inside: true };
    const d = price > hi ? price - hi : lo - price;
    return { distancePct: (d / price) * 100, inside: false };
  };

  // 1) Struktur
  const st = btcStructureBias(tf, k.highs, k.lows, k.closes);
  const fr = MSV2_FRACTAL_STRENGTH[tf], md = MSV2_SWING_MIN_DIST_ATR[tf];
  const sh = msv2FindSwingPoints(H, true, fr.left, fr.right, atr, md);
  const sl = msv2FindSwingPoints(L, false, fr.left, fr.right, atr, md);
  const merged = [
    ...sh.map(s => ({ idx: s.index, price: s.price, t: 'H' as const })),
    ...sl.map(s => ({ idx: s.index, price: s.price, t: 'L' as const })),
  ].sort((a, b) => a.idx - b.idx).slice(-8);
  const swingSequence: string[] = [];
  for (const s of merged) {
    const arr = s.t === 'H' ? sh : sl;
    const pos = arr.findIndex(x => x.index === s.idx);
    const prev = pos > 0 ? arr[pos - 1]!.price : null;
    const lab = prev === null ? (s.t === 'H' ? 'H' : 'L') : s.t === 'H' ? (s.price > prev ? 'HH' : 'LH') : (s.price > prev ? 'HL' : 'LL');
    swingSequence.push(`${lab} ${s.price}`);
  }

  // 2) SNR kuat (cluster swing fractal 2-2 dari high & low, toleransi 0.5 ATR)
  const pts: number[] = [];
  for (let i = 2; i < n - 2; i++) {
    if (H[i]! > H[i - 1]! && H[i]! > H[i - 2]! && H[i]! > H[i + 1]! && H[i]! > H[i + 2]!) pts.push(H[i]!);
    if (L[i]! < L[i - 1]! && L[i]! < L[i - 2]! && L[i]! < L[i + 1]! && L[i]! < L[i + 2]!) pts.push(L[i]!);
  }
  pts.sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const p of pts) {
    const g = clusters[clusters.length - 1];
    if (g && p - g[0]! <= atr * 0.5) g.push(p); else clusters.push([p]); // lebar zona maks 0.5 ATR (anchor dari titik pertama, bukan chain)
  }
  const levels: SnrLevel[] = clusters.filter(g => g.length >= 2).map(g => {
    const lo = Math.min(...g), hi = Math.max(...g), mid = g.reduce((a, b) => a + b, 0) / g.length;
    return { price: mid, zoneLow: lo, zoneHigh: hi, touches: g.length, type: mid >= price ? 'resistance' as const : 'support' as const, distancePct: Math.abs(mid - price) / price * 100 };
  });
  const byDist = (a: { distancePct: number }, b: { distancePct: number }) => a.distancePct - b.distancePct;
  const resistances = levels.filter(l => l.type === 'resistance').sort(byDist).slice(0, 4);
  const supports = levels.filter(l => l.type === 'support').sort(byDist).slice(0, 4);

  // 3) Order Block (reuse)
  const zoneFrom = (kind: 'OB' | 'SND', side: 'demand' | 'supply', lo: number, hi: number, idx: number, touches: number, note: string): SnrZone => ({
    kind, side, high: hi, low: lo, candlesAgo: n - 1 - idx, touches, fresh: touches === 0, ...dist(lo, hi), note,
  });
  const obs: SnrZone[] = [
    ...detectOrderBlocksH1(O, H, L, C, 'bullish', SNR_ZONES_CANDLES).map(o => zoneFrom('OB', 'demand', o.low, o.high, o.index, o.touches, `kekuatan impuls ${o.strength.toFixed(1)}x range`)),
    ...detectOrderBlocksH1(O, H, L, C, 'bearish', SNR_ZONES_CANDLES).map(o => zoneFrom('OB', 'supply', o.low, o.high, o.index, o.touches, `kekuatan impuls ${o.strength.toFixed(1)}x range`)),
  ].sort(byDist).slice(0, 6);

  // 4) Supply / Demand (base + impuls)
  const snd: SnrZone[] = [];
  for (let i = 4; i < n; i++) {
    const body = Math.abs(C[i]! - O[i]!);
    if (body < 1.5 * atr) continue;
    const up = C[i]! > O[i]!;
    let b = i - 1; let baseHi = -Infinity, baseLo = Infinity; let cnt = 0;
    while (b >= 1 && cnt < 3 && Math.abs(C[b]! - O[b]!) <= 0.5 * atr && (H[b]! - L[b]!) <= 0.8 * atr) {
      baseHi = Math.max(baseHi, H[b]!); baseLo = Math.min(baseLo, L[b]!); cnt++; b--;
    }
    if (cnt === 0) continue;
    // mitigasi: close di luar batas jauh (distal) setelah impuls
    let broken = false, touches = 0;
    for (let j = i + 1; j < n; j++) {
      if (up ? C[j]! < baseLo : C[j]! > baseHi) { broken = true; break; }
      if (L[j]! <= baseHi && H[j]! >= baseLo) touches++;
    }
    if (broken) continue;
    snd.push(zoneFrom('SND', up ? 'demand' : 'supply', baseLo, baseHi, b + 1, touches, `${cnt} candle base, impuls ${(body / atr).toFixed(1)} ATR`));
  }
  const supplyDemand = snd.sort(byDist).slice(0, 6);

  // 5) Imbalance / FVG
  const fvg: SnrImbalance[] = [];
  for (let i = 1; i < n - 1; i++) {
    let side: 'bullish' | 'bearish' | null = null, lo = 0, hi = 0;
    if (H[i - 1]! < L[i + 1]!) { side = 'bullish'; lo = H[i - 1]!; hi = L[i + 1]!; }
    else if (L[i - 1]! > H[i + 1]!) { side = 'bearish'; lo = H[i + 1]!; hi = L[i - 1]!; }
    if (!side || hi - lo < 0.15 * atr) continue;
    let filled = 0, full = false;
    for (let j = i + 2; j < n; j++) {
      if (side === 'bullish') { filled = Math.max(filled, Math.min(1, Math.max(0, (hi - L[j]!) / (hi - lo)))); if (C[j]! <= lo) { full = true; break; } }
      else { filled = Math.max(filled, Math.min(1, Math.max(0, (H[j]! - lo) / (hi - lo)))); if (C[j]! >= hi) { full = true; break; } }
    }
    if (full) continue;
    fvg.push({ side, high: hi, low: lo, candlesAgo: n - 1 - i, filledPct: Math.round(filled * 100), ...dist(lo, hi) });
  }
  const imbalances = fvg.sort(byDist).slice(0, 6);

  // ── Narasi (murni dihitung dari candle & level di atas; TIDAK ada berita/data eksternal) ──
  const fp = (v: number): string => (v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v.toPrecision(4));
  const tfMin = { H4: 240, H1: 60, M15: 15, M5: 5 }[tf];
  const agoStr = (c: number): string => { if (c === 0) return 'candle terakhir'; const m = c * tfMin; return m < 120 ? `${m} menit lalu` : `${Math.round(m / 60)} jam lalu`; };
  const zr = (l: { zoneLow: number; zoneHigh: number }): string => `${fp(l.zoneLow)}–${fp(l.zoneHigh)}`;
  const win = Math.min(Math.round(1440 / tfMin), n - 2);
  const winHours = Math.round((win * tfMin) / 60);
  const w0 = n - win;
  const winHigh = Math.max(...H.slice(w0)), winLow = Math.min(...L.slice(w0));
  const chg = ((price - O[w0]!) / O[w0]!) * 100;
  const kejadian: string[] = [
    `Range ${winHours} jam terakhir: ${fp(winLow)}–${fp(winHigh)}; harga ${chg >= 0 ? 'naik' : 'turun'} ${Math.abs(chg).toFixed(2)}% dari open window ke ${fp(price)}.`,
  ];
  const ev: { j: number; text: string }[] = [];
  for (const lv of levels) {
    for (let j = Math.max(1, w0); j < n; j++) {
      const ago = n - 1 - j;
      if (L[j]! < lv.zoneLow && C[j]! >= lv.zoneLow) ev.push({ j, text: `Sweep support ${zr(lv)} (${lv.touches}x): wick ke ${fp(L[j]!)} lalu close kembali di atas (${agoStr(ago)}). Wick/sweep, bukan breakdown.` });
      else if (H[j]! > lv.zoneHigh && C[j]! <= lv.zoneHigh) ev.push({ j, text: `Rejection resistance ${zr(lv)} (${lv.touches}x): wick ke ${fp(H[j]!)} lalu close kembali di bawah (${agoStr(ago)}).` });
      if (C[j - 1]! >= lv.zoneLow && C[j]! < lv.zoneLow) ev.push({ j, text: `Close ${tf} menembus ke bawah ${zr(lv)} (${agoStr(ago)}).` });
      if (C[j - 1]! <= lv.zoneHigh && C[j]! > lv.zoneHigh) ev.push({ j, text: `Close ${tf} menembus ke atas ${zr(lv)} (${agoStr(ago)}).` });
    }
  }
  ev.sort((a, b) => b.j - a.j);
  const seen = new Set<string>();
  for (const e of ev) { if (!seen.has(e.text) && seen.size < 3) { seen.add(e.text); kejadian.push(e.text); } }
  if (seen.size === 0) kejadian.push('Tidak ada sweep atau penembusan level SNR kuat dalam window ini.');

  const lastSH = sh[sh.length - 1], lastSL = sl[sl.length - 1];
  const biasTxt = { bullish: 'BULLISH', bearish: 'BEARISH', sideways: 'SIDEWAY', transition: 'TRANSISI' }[st.bias];
  const R = [...resistances]; // terdekat → terjauh
  const S = [...supports];
  const R1 = R[0], R2 = R[1], R3 = R[2], S1 = S[0], S2 = S[1], S3 = S[2];
  const strukturSekarang: string[] = [
    `${biasTxt} — ${st.note}.`,
    `Swing high terakhir ${lastSH ? fp(lastSH.price) : '—'}, swing low terakhir ${lastSL ? fp(lastSL.price) : '—'}.`,
  ];
  if (st.bias === 'bearish' && R1) strukturSekarang.push(`Perlu reclaim ${fp(R1.zoneHigh)} (batas atas resistance terdekat) untuk menandakan pemulihan; selama di bawahnya tekanan masih ke bawah.`);
  else if (st.bias === 'bullish' && S1) strukturSekarang.push(`Struktur bullish valid selama harga bertahan di atas ${fp(S1.zoneLow)} (batas bawah support terdekat).`);
  else if (st.bias === 'transition') strukturSekarang.push(st.transition === 'bull_to_bear' ? 'Swing low penting sudah ditembus, struktur bearish baru belum terkonfirmasi.' : 'Swing high penting sudah ditembus, struktur bullish baru belum terkonfirmasi.');

  const levelTerbaru = { resistance: R.map(l => `${zr(l)} (${l.touches}x)`), support: S.map(l => `${zr(l)} (${l.touches}x)`) };

  const utamaBear = st.bias === 'bearish' || st.transition === 'bull_to_bear';
  const utamaBull = st.bias === 'bullish' || st.transition === 'bear_to_bull';
  const tg = (...ls: (SnrLevel | undefined)[]): string => { const a = ls.filter((x): x is SnrLevel => !!x).map(l => zr(l)); return a.length ? a.join(' → ') : 'belum ada level target (SNR kuat berikutnya tidak ditemukan)'; };
  const skenario: SnrNarrative['skenario'] = [
    { nama: 'Bearish', utama: utamaBear, trigger: S1 ? `Close ${tf} di bawah ${fp(S1.zoneLow)}, lalu retest gagal` : 'Belum ada support kuat sebagai acuan breakdown', target: tg(S2, S3) },
    { nama: 'Sideways', utama: !utamaBear && !utamaBull, trigger: S1 && R1 ? `Tertahan di ${fp(S1.zoneHigh)}–${fp(R1.zoneLow)}` : 'Harga di antara level terdekat', target: 'Range kecil' },
    { nama: 'Bullish', utama: utamaBull, trigger: R1 ? `Close ${tf} di atas ${fp(R1.zoneHigh)}, lalu retest bertahan` : 'Belum ada resistance kuat di atas harga', target: tg(R2, R3) },
  ];

  const entry: SnrNarrative['entry'] = [];
  if (S1) entry.push({ arah: 'SHORT', tipe: 'Konfirmasi breakdown', searahStruktur: utamaBear, kondisi: `Tunggu close ${tf} di bawah ${fp(S1.zoneLow)}`, entry: `retest ${zr(S1)}`, sl: `di atas ${fp(S1.zoneHigh + 0.5 * atr)}`, tp: tg(S2, S3) });
  if (R1) entry.push({ arah: 'SHORT', tipe: 'Agresif (rejection)', searahStruktur: utamaBear, kondisi: `Penolakan di resistance ${zr(R1)}`, entry: zr(R1), sl: `di atas ${fp(R1.zoneHigh + 0.2 * atr)}`, tp: tg(S1, S2) });
  if (R1) entry.push({ arah: 'LONG', tipe: 'Konfirmasi reclaim', searahStruktur: utamaBull, kondisi: `Reclaim ${fp(R1.zoneHigh)} dan bertahan di retest`, entry: `retest ${zr(R1)}`, sl: `di bawah ${fp(R1.zoneLow - 0.5 * atr)}`, tp: tg(R2, R3) });
  if (S1) entry.push({ arah: 'LONG', tipe: 'Agresif (bounce)', searahStruktur: utamaBull, kondisi: `Pantulan di support ${zr(S1)}`, entry: zr(S1), sl: `di bawah ${fp(S1.zoneLow - 0.2 * atr)}`, tp: tg(R1, R2) });

  const catatan: string[] = [];
  if (S1 && R1 && S1.zoneHigh < R1.zoneLow) {
    const pos = (price - S1.zoneHigh) / (R1.zoneLow - S1.zoneHigh);
    if (pos > 0.33 && pos < 0.67) catatan.push(`Harga di tengah range ${fp(S1.zoneHigh)}–${fp(R1.zoneLow)}: jarak ke level invalidasi tidak jelas dan rawan sweep dua arah, hindari entry di sini.`);
  }
  if (st.bias === 'bearish' && entry.some(e => e.arah === 'LONG')) catatan.push('Long melawan struktur bearish: hanya valid kalau reclaim terkonfirmasi.');
  if (st.bias === 'bullish' && entry.some(e => e.arah === 'SHORT')) catatan.push('Short melawan struktur bullish: hanya valid kalau breakdown terkonfirmasi.');
  catatan.push('Narasi ini dihitung otomatis dari candle & level di atas. Tidak memuat berita, ETF, likuidasi, atau data makro.');

  const headline = `${tf}: struktur ${biasTxt}${utamaBear && !skenario[0]!.trigger.startsWith('Belum') ? `, belum ada konfirmasi breakdown (butuh ${skenario[0]!.trigger.split(',')[0]!.toLowerCase()})` : utamaBull && R1 ? `, belum ada konfirmasi reclaim ${fp(R1.zoneHigh)}` : ''}.`;
  const narrative: SnrNarrative = { headline, kejadian, strukturSekarang, levelTerbaru, skenario, entry, catatan };

  reasoning.push(`${tf} ${n} candle close, ATR14 ${atr}, harga ${price}`);
  reasoning.push(`SNR: ${levels.length} level dengan >=2 sentuhan dari ${pts.length} titik swing (toleransi 0.5 ATR)`);
  return {
    symbol, tf, candlesUsed: n, currentPrice: price, atr,
    structure: { bias: st.bias, transition: st.transition, note: st.note, swingSequence },
    resistances, supports, orderBlocks: obs, supplyDemand, imbalances, narrative, reasoning,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TECHNICAL ANALYSIS PRO -- FITUR 5: Long-Short Score v3 (2026-10-24: pasangan TF struktur H4+M30 diganti D1+H1, request user).
// Skor LONG dari 6 komponen, maks 11 (SHORT = cermin, semua "searah" dibalik):
//   Struktur D1 (200 candle, searah sinyal): +2 / netral (sideway, transisi) 0 / berlawanan -2
//   Struktur H1 (200 candle): searah sinyal +1; tidak searah 0;
//       MSS/CHoCH terkonfirmasi KE arah sinyal (dalam 100 candle H1 terakhir) +1;
//       MSS/CHoCH terkonfirmasi MENJAUHI arah sinyal (dalam 100 candle H1 terakhir) -1 (rentang -1..+2)
//   Lokasi H4: terlalu dekat S/R H4 yang menghalangi atau sudah extended -1;
//       jauh dari S/R H4 yang menghalangi dan belum extended +1; selain itu 0
//   Open Interest (H4, 6 candle = 24 jam): harga naik & OI > +3% = +2;
//       harga naik & OI turun = 0; harga turun & OI > +5% = -2; selain itu 0
//   Long/Short Ratio (akun global, 4h): 1.00-1.80 +2 | 1.80-2.50 +1 | >2.50 -2 | 0.70-1.00 +1 | <0.70 0
//   Funding (persen): 0.0001-0.0100 +2 | 0.0100-0.0300 0 | >0.0300 -2 | <0.0001 0
// Grade: A+ >= 8, B 6-7, Tidak layak <= 5. SHORT = kebalikan LONG (lihat analyzeLongShortScore).
// Versi skor lama (v1: H4 + H1, A+ 7-9; v2: H4 + M30 + lokasi H4, A+ >= 8) tetap terbaca di Jurnal lewat field taScoreVer.
// ═══════════════════════════════════════════════════════════════════════════

export interface LongShortComponent { key: string; label: string; detail: string; points: number; max: number; available: boolean; }
export interface LongShortSide { score: number; grade: 'A+' | 'B' | 'Tidak layak'; components: LongShortComponent[]; }
export interface LongShortScoreResult {
  status: 'ok';
  symbol: string;
  maxScore: number;
  long: LongShortSide;
  short: LongShortSide;
  notes: string[];
}

async function fetchGlobalLongShortRatio(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(`${BINANCE_FUTURES_BASE}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=4h&limit=1`);
    if (!res.ok) return null;
    const d = await res.json() as { longShortRatio: string }[];
    if (!Array.isArray(d) || d.length === 0) return null;
    const v = parseFloat(d[d.length - 1]!.longShortRatio);
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

export const TA_SCORE_VERSION = 3;
export const TA_SCORE_MAX = 11;
export function gradeLongShort(score: number): 'A+' | 'B' | 'Tidak layak' {
  return score >= 8 ? 'A+' : score >= 6 ? 'B' : 'Tidak layak';
}

// ── Parameter skor v3 ──
const TA_H1_FLIP_WINDOW = 100;    // spec user: MSS/CHoCH TF rendah (sekarang H1) dihitung hanya kalau terjadi dalam 100 candle TF itu terakhir
// Ambang lokasi dikalibrasi dari SEBARAN jarak (bukan dari hasil menang/kalah) di 100 koin futures teratas, 2026-10-24:
// jarak ke S/R H4 penghalang median 0.4 ATR (kuartil 25% = 0.1, 75% = 0.95), jarak ke EMA20 H4 persentil 90 = 1.0-2.0 ATR.
// Angka ini bergantung kondisi pasar saat itu; perlu dikalibrasi ulang kalau persentase -1 / +1 melenceng jauh dari ~25%.
const TA_LOC_NEAR_ATR = 0.25;     // S/R H4 penghalang <= 0.25 ATR H4 = terlalu dekat (sekitar 25% koin)
const TA_LOC_FAR_ATR = 1.0;       // S/R H4 penghalang >= 1.0 ATR H4 (atau tidak ada) = jauh (sekitar 25% koin)
const TA_LOC_EXT_ATR = 2.0;       // jarak harga ke EMA20 H4 >= 2.0 ATR H4 searah sinyal = extended (sekitar 10% koin)

/** Struktur TF rendah (H1 di skor v3) sekarang + MSS/CHoCH terkonfirmasi terakhir dalam jendela 100 candle. "Terkonfirmasi" = struktur BERUBAH
 *  dari bullish ke bearish (atau sebaliknya) menurut btcStructureBias (butuh rangkaian swing baru + close belum menembus balik),
 *  bukan sekadar close menembus satu swing. Array masukan: elemen terakhir = candle yang masih berjalan. */
function lowTfStructureFlip(tf: 'H1' | 'M30', h: number[], l: number[], c: number[]): { flip: { to: 'bullish' | 'bearish'; candlesAgo: number } | null } {
  const len = c.length;
  const first = Math.max(60, len - 1 - TA_H1_FLIP_WINDOW);
  const states: BtcStructureBias[] = [];
  for (let e = first; e <= len - 1; e++) {
    states.push(btcStructureBias(tf, h.slice(0, e + 1), l.slice(0, e + 1), c.slice(0, e + 1)).bias);
  }
  let last: 'bullish' | 'bearish' | null = null;
  let flip: { to: 'bullish' | 'bearish'; candlesAgo: number } | null = null;
  for (let j = 0; j < states.length; j++) {
    const st = states[j]!;
    if (st !== 'bullish' && st !== 'bearish') continue;
    if (last !== null && st !== last) flip = { to: st, candlesAgo: states.length - 1 - j };
    last = st;
  }
  return { flip };
}

/** Lokasi harga terhadap S/R H4 (cluster swing fractal 2-2, toleransi 0.5 ATR, min 2 sentuhan, sama dengan Fitur 4). */
function h4LocationInfo(h: number[], l: number[], c: number[]): {
  price: number; atr: number; extUp: number; nearestResistDist: number | null; nearestSupportDist: number | null;
} {
  const n = c.length - 1; // buang candle berjalan
  const H = h.slice(0, n), L = l.slice(0, n), C = c.slice(0, n);
  const price = C[n - 1]!;
  const atr = calcATR(H, L, C);
  const ema = calcEMASeries(C, 20);
  const extUp = atr > 0 ? (price - ema[n - 1]!) / atr : 0; // positif = harga di atas EMA20 H4
  const pts: number[] = [];
  for (let i = 2; i < n - 2; i++) {
    if (H[i]! > H[i - 1]! && H[i]! > H[i - 2]! && H[i]! > H[i + 1]! && H[i]! > H[i + 2]!) pts.push(H[i]!);
    if (L[i]! < L[i - 1]! && L[i]! < L[i - 2]! && L[i]! < L[i + 1]! && L[i]! < L[i + 2]!) pts.push(L[i]!);
  }
  pts.sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const p of pts) {
    const g = clusters[clusters.length - 1];
    if (g && p - g[0]! <= atr * 0.5) g.push(p); else clusters.push([p]);
  }
  let nearestResistDist: number | null = null, nearestSupportDist: number | null = null;
  for (const g of clusters) {
    if (g.length < 2) continue;
    const lo = Math.min(...g), hi = Math.max(...g), mid = g.reduce((a, b) => a + b, 0) / g.length;
    if (mid >= price) { const d = Math.max(0, lo - price); if (nearestResistDist === null || d < nearestResistDist) nearestResistDist = d; }
    else { const d = Math.max(0, price - hi); if (nearestSupportDist === null || d < nearestSupportDist) nearestSupportDist = d; }
  }
  return { price, atr, extUp, nearestResistDist, nearestSupportDist };
}

export async function analyzeLongShortScore(symbol: string): Promise<LongShortScoreResult> {
  const [h4, d1, h1, oiH4, lsr, funding] = await Promise.all([
    fetchKlines(symbol, '4h', 200),   // dipakai Lokasi H4 + Open Interest
    fetchKlines(symbol, '1d', 200),
    fetchKlines(symbol, '1h', 200),
    fetchOpenInterestHist(symbol, '4h', 10),
    fetchGlobalLongShortRatio(symbol),
    fetchFundingRate(symbol),
  ]);
  const lbl: Record<BtcStructureBias, string> = { bullish: 'BULLISH', bearish: 'BEARISH', sideways: 'SIDEWAY', transition: 'TRANSISI' };
  const stD1 = btcStructureBias('D1', d1.highs, d1.lows, d1.closes);
  const stH1 = btcStructureBias('H1', h1.highs, h1.lows, h1.closes);
  const { flip: flipH1 } = lowTfStructureFlip('H1', h1.highs, h1.lows, h1.closes);
  const loc = h4LocationInfo(h4.highs, h4.lows, h4.closes);

  // Open Interest: perubahan harga & OI selama 6 candle H4 (24 jam)
  const n4 = h4.closes.length - 1;
  const pChg = ((h4.closes[n4 - 1]! - h4.closes[n4 - 1 - 6]!) / h4.closes[n4 - 1 - 6]!) * 100;
  const oiOk = !!oiH4 && oiH4.length >= 7 && oiH4[oiH4.length - 7]! > 0;
  const oiChg = oiOk ? ((oiH4![oiH4!.length - 1]! - oiH4![oiH4!.length - 7]!) / oiH4![oiH4!.length - 7]!) * 100 : 0;
  const sg = (v: number, d = 2): string => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;

  // Sisi LONG memakai tabel spec langsung. Sisi SHORT = KEBALIKANNYA:
  //  struktur bearish/bullish dibalik, harga naik/turun dibalik, L/S ratio dibalik (1/ratio),
  //  funding dibalik tanda (-funding).
  const build = (side: 'long' | 'short'): LongShortSide => {
    const L = side === 'long';
    const comps: LongShortComponent[] = [];
    // Struktur D1 (maks +-2): searah sinyal +2, berlawanan -2, netral/transisi/sideway 0
    {
      const pts = stD1.bias === (L ? 'bullish' : 'bearish') ? 2 : stD1.bias === (L ? 'bearish' : 'bullish') ? -2 : 0;
      comps.push({ key: 'structD1', label: 'Struktur D1', detail: `${lbl[stD1.bias]} — ${stD1.note}`, points: pts, max: 2, available: d1.closes.length >= 30 });
    }
    // Struktur H1: searah sinyal +1; MSS/CHoCH terkonfirmasi ke arah sinyal +1; menjauhi arah sinyal -1 (dalam 100 candle H1)
    {
      const dir = L ? 'bullish' : 'bearish';
      let pts = 0; const info: string[] = [];
      if (stH1.bias === dir) { pts += 1; info.push('searah sinyal +1'); }
      if (flipH1) {
        if (flipH1.to === dir) { pts += 1; info.push(`MSS/CHoCH ke arah sinyal ${flipH1.candlesAgo} candle lalu +1`); }
        else { pts -= 1; info.push(`MSS/CHoCH menjauhi arah sinyal ${flipH1.candlesAgo} candle lalu -1`); }
      }
      comps.push({ key: 'structH1f', label: 'Struktur H1', detail: `${lbl[stH1.bias]} — ${stH1.note}${info.length ? ` [${info.join('; ')}]` : ''}`, points: pts, max: 2, available: true });
    }
    // Lokasi H4: terlalu dekat S/R penghalang atau extended = -1; jauh dari S/R penghalang dan belum extended = +1
    {
      const opp = L ? loc.nearestResistDist : loc.nearestSupportDist;
      const oppAtr = opp === null || loc.atr <= 0 ? null : opp / loc.atr;
      const ext = (L ? loc.extUp : -loc.extUp);
      const near = oppAtr !== null && oppAtr <= TA_LOC_NEAR_ATR;
      const extended = ext >= TA_LOC_EXT_ATR;
      const far = (oppAtr === null || oppAtr >= TA_LOC_FAR_ATR) && !extended;
      const pts = near || extended ? -1 : far ? 1 : 0;
      const sr = L ? 'resistance' : 'support';
      const parts = [
        oppAtr === null ? `tidak ada ${sr} H4 kuat di arah target` : `${sr} H4 terdekat ${oppAtr.toFixed(1)} ATR`,
        `jarak ke EMA20 H4 ${ext >= 0 ? '+' : ''}${ext.toFixed(1)} ATR searah sinyal`,
      ];
      const lab = near && extended ? 'Dekat penghalang & extended' : near ? 'Terlalu dekat penghalang H4' : extended ? 'Sudah extended' : far ? 'Jauh dari penghalang H4' : 'Netral';
      comps.push({ key: 'locH4', label: 'Lokasi H4', detail: `${lab} — ${parts.join(', ')}`, points: pts, max: 1, available: loc.atr > 0 });
    }
    if (oiOk) {
      const move = L ? pChg : -pChg; // positif = harga bergerak searah posisi
      let pts = 0, lab = 'Netral (tidak masuk kategori)';
      if (move > 0 && oiChg > 3) { pts = 2; lab = L ? 'Bullish sehat' : 'Bearish sehat'; }
      else if (move > 0 && oiChg < 0) { pts = 0; lab = L ? 'Bullish lemah' : 'Bearish lemah'; }
      else if (move < 0 && oiChg > 5) { pts = -2; lab = 'Waspada'; }
      comps.push({ key: 'oi', label: 'Open Interest', detail: `${lab} — harga ${sg(pChg)}%, OI ${sg(oiChg)}% (24 jam, H4)`, points: pts, max: 2, available: true });
    } else comps.push({ key: 'oi', label: 'Open Interest', detail: 'Data OI tidak tersedia (dihitung 0)', points: 0, max: 2, available: false });

    if (lsr !== null && lsr > 0) {
      let pts = 0, lab = 'Di luar rentang';
      if (L) {
        if (lsr > 2.5) { pts = -2; lab = 'Terlalu banyak long'; }
        else if (lsr >= 1.8) { pts = 1; lab = 'Masih aman'; }
        else if (lsr >= 1.0) { pts = 2; lab = 'Ideal long'; }
        else if (lsr >= 0.7) { pts = 1; lab = 'Contrarian long'; }
      } else {
        // Tabel SHORT (spec user): >1.2 +1 | 0.7-1.2 +2 | 0.4-0.7 +1 | <0.4 -2
        if (lsr > 1.2) { pts = 1; lab = 'Banyak trader long (bagus buat cari short)'; }
        else if (lsr >= 0.7) { pts = 2; lab = 'Ideal short'; }
        else if (lsr >= 0.4) { pts = 1; lab = 'Masih aman'; }
        else { pts = -2; lab = 'Terlalu ramai short'; }
      }
      comps.push({ key: 'lsr', label: 'Long/Short Ratio', detail: `${lab} — rasio ${lsr.toFixed(2)}`, points: pts, max: 2, available: true });
    } else comps.push({ key: 'lsr', label: 'Long/Short Ratio', detail: 'Data rasio tidak tersedia (dihitung 0)', points: 0, max: 2, available: false });

    if (funding !== null) {
      const f = L ? funding : -funding; // short: tanda funding dibalik
      let pts = 0, lab = 'Di bawah 0.0001 (netral)';
      if (f > 0.03) { pts = -2; lab = 'Overcrowded'; }
      else if (f > 0.01) { pts = 0; lab = 'Mulai panas'; }
      else if (f >= 0.0001) { pts = 2; lab = 'Ideal'; }
      comps.push({ key: 'funding', label: 'Funding Rate', detail: `${lab} — ${funding.toFixed(4)}%${L ? '' : ` (dibalik: ${f.toFixed(4)}%)`}`, points: pts, max: 2, available: true });
    } else comps.push({ key: 'funding', label: 'Funding Rate', detail: 'Data funding tidak tersedia (dihitung 0)', points: 0, max: 2, available: false });

    const score = comps.reduce((a, c) => a + c.points, 0);
    return { score, grade: gradeLongShort(score), components: comps };
  };

  const long = build('long'), short = build('short');
  const notes: string[] = ['Sisi SHORT adalah kebalikan sisi LONG: struktur dibalik, arah harga dibalik, tabel L/S ratio sendiri (spec user), tanda funding dibalik.'];
  if (long.components.some(c => !c.available)) notes.push('Ada komponen yang datanya tidak tersedia: dihitung 0, jadi skor bisa lebih rendah dari seharusnya.');
  return { status: 'ok', symbol, maxScore: TA_SCORE_MAX, long, short, notes };
}

// ═══════════════════════════════════════════════════════════════════════════
// BONUS CROSS-MENU (request user): cek apa bias sinyal itu SEARAH sama
// Fitur 5 (Skor Long vs Short) Technical Analysis PRO. Gak pernah nge-block
// sinyal (murni info/badge tambahan). Kalau gagal fetch/analisa, atau Fitur
// 5 lagi 'no_breakout' (gak applicable), fail-safe ke "gak ada bonus".
//
// FIX (audit): fungsi ini sebelumnya gak pernah dipanggil dari mana pun --
// UI (TaProBonusBanner) udah lengkap di 3 menu (Scalping/Sniper Breakout/
// Money Magnet) nungguin field taProBonusConfirmed/Classification/Score,
// tapi field itu selalu undefined karena fungsi ini orphan. Sekarang di-
// export dan dipanggil dari ROUTE layer (breakout.ts/breakout-entry.ts/
// money-magnet-scalping.ts) -- CUMA di endpoint detail analisa 1 koin
// (request user: biar gak 2x-in beban fetch pas scan ratusan koin), bukan
// di dalam fungsi analyze*Entry/analyzeCounterStructural/
// analyzeMoneyMagnetScalping itu sendiri (supaya scan tetep gak kena).
// ═══════════════════════════════════════════════════════════════════════════
/** Skor TA PRO yang DIBEKUKAN saat sinyal dibuat (server). Dipakai kartu Skor + Journal supaya
 *  angkanya SAMA dengan kondisi pas sinyal muncul (bukan dihitung ulang pas disimpan). */
export interface TaProScoreSnapshot {
  v: number; // versi skor (1 = H4+H1, 2 = H4+M30+lokasi H4, 3 = D1+H1+lokasi H4; grade A+ >= 8 untuk v2/v3)
  maxScore: number;
  at: number; // ms epoch saat skor dihitung
  long: { score: number; grade: 'A+' | 'B' | 'Tidak layak'; pts: string; components: LongShortComponent[] };
  short: { score: number; grade: 'A+' | 'B' | 'Tidak layak'; pts: string; components: LongShortComponent[] };
}
const TA_SNAP_KEYS = ['structD1', 'structH1f', 'locH4', 'oi', 'lsr', 'funding'];
function ptsString(side: LongShortSide): string {
  return TA_SNAP_KEYS.map(k => {
    const c = side.components.find(x => x.key === k);
    return !c || !c.available ? `${k}:x` : `${k}:${c.points > 0 ? '+' : ''}${c.points}`;
  }).join('|');
}
// Cache pendek per simbol: satu sinyal yang dipanggil beberapa kali dalam hitungan detik (scan + detail)
// dapat snapshot yang sama persis.
const taSnapCache = new Map<string, { t: number; v: TaProScoreSnapshot | null }>();
const TA_SNAP_TTL_MS = 90_000;
export async function getTaProScoreSnapshot(symbol: string): Promise<TaProScoreSnapshot | null> {
  const hit = taSnapCache.get(symbol);
  if (hit && Date.now() - hit.t < TA_SNAP_TTL_MS) return hit.v;
  let v: TaProScoreSnapshot | null = null;
  try {
    const ls = await analyzeLongShortScore(symbol);
    v = {
      v: TA_SCORE_VERSION, maxScore: TA_SCORE_MAX,
      at: Date.now(),
      long: { score: ls.long.score, grade: ls.long.grade, pts: ptsString(ls.long), components: ls.long.components },
      short: { score: ls.short.score, grade: ls.short.grade, pts: ptsString(ls.short), components: ls.short.components },
    };
  } catch { v = null; }
  if (v) taSnapCache.set(symbol, { t: Date.now(), v });
  return v;
}

export async function checkTaProBonus(
  symbol: string, bias: 'bullish' | 'bearish'
): Promise<{ confirmed: boolean; classification: string | null; score: number }> {
  const snap = await getTaProScoreSnapshot(symbol);
  if (!snap) return { confirmed: false, classification: null, score: 0 };
  const side = bias === 'bullish' ? snap.long : snap.short;
  const confirmed = side.grade !== 'Tidak layak';
  return { confirmed, classification: confirmed ? `${bias === 'bullish' ? 'Long' : 'Short'} Grade ${side.grade}` : null, score: confirmed ? side.score : 0 };
}
