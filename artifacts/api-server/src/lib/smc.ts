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

export interface SniperResult {
  status: "ready" | "no_trend" | "no_zone" | "skip_conditions" | "not_extreme" | "error";
  message: string;
  symbol: string;
  currentPrice: number;
  timestamp: string;
  bias?: "bullish" | "bearish";
  mode?: "sniper" | "rsi2"; // skill yang dipakai buat hasilin sinyal ini
  recommendedMode?: "sniper" | "rsi2"; // rekomendasi classifier (ADX+RSI2), independen dari mode yang dipilih
  rsi2Value?: number; // nilai RSI(2) H4 pas analisa
  ma200Relation?: "above" | "below"; // posisi harga H4 relatif ke MA200 (trend filter Connors)
  adxH4?: number; // buat transparansi kenapa classifier milih mode ini
  ma5ExitTarget?: number; // level MA5 H4 — patokan exit dinamis versi asli Connors
  recentPerformance?: RecentPerformance; // mini-backtest instan, cuma diisi di endpoint single-symbol
  tfBreakdown?: TFBreakdownItem[]; // breakdown per-timeframe
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
  // NOTE: rejection15M/choch15M dipertahanin di tipe (optional) buat backward-compat,
  // tapi backend GAK PERNAH ngirim ini lagi sejak diganti RSI Divergence H1.
  rejection15M?: boolean;
  rejection15MCandle?: string;
  choch15M?: boolean;
  choch15MDescription?: string;
  rsiDivergenceH1?: boolean;
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

// ─── altFINS Comparison (validasi silang) ───────────────────────────────────
// Bandingin bias/indikator dari sistem kita sama data altFINS (150+ indikator,
// 130 trading signal siap pakai). BUKAN buat nentuin sinyal — cuma referensi
// sekunder biar kita bisa cek apakah bias kita align sama platform lain yang
// udah established. Field displayType di bawah baru yang KONFIRMASI ada
// (RSI14, MARKET_CAP) — altFINS punya 150+ indikator total, field lain bisa
// ditambah belakangan setelah cek katalog lengkap di dokumentasi mereka.
export interface AltfinsComparisonData {
  symbol: string;
  marketCap?: number;
  rsi14?: number;
  raw: Record<string, unknown>;
}

export async function fetchAltfinsComparison(symbol: string): Promise<AltfinsComparisonData | null> {
  const apiKey = process.env['ALTFINS_API_KEY'];
  if (!apiKey) return null; // fail-safe: kalau API key belum di-set, skip diem-diem

  try {
    // altFINS pakai simbol tanpa suffix USDT (contoh "BTC" bukan "BTCUSDT")
    const baseSymbol = symbol.toUpperCase().replace(/USDT$/, '');
    const res = await fetch('https://altfins.com/api/v2/public/screener-data/search-requests', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        symbols: [baseSymbol],
        displayType: ['RSI14', 'MARKET_CAP'],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { content?: Record<string, unknown>[] };
    const row = data.content?.[0];
    if (!row) return null;

    return {
      symbol: baseSymbol,
      marketCap: typeof row['MARKET_CAP'] === 'number' ? row['MARKET_CAP'] as number : undefined,
      rsi14: typeof row['RSI14'] === 'number' ? row['RSI14'] as number : undefined,
      raw: row,
    };
  } catch {
    return null; // fail-safe: gak boleh ganggu alur analisa utama
  }
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
    // Fetch all data in parallel — D1 udah gak dipake lagi, H4 sekarang jadi trend utama SEKALIGUS zona entry
    const [h4, h1, m15, m5, currentTickerRes] = await Promise.all([
      fetchKlines(symbol, "4h", 100),  // H4 — trend utama + zona entry
      fetchKlines(symbol, "1h", 50),   // H1 — refine zona + RSI divergence
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

    // STEP 1: Confirm trend H4 (trend utama — D1 udah gak dipake)
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

    // HARD FILTER: konfirmasi ZigZag H4 (threshold 3%) — filter noise, wajib searah sama structure biasa
    const zzH4 = zigzagBias(h4.highs, h4.lows, 3);
    if (zzH4.bias === "ranging" || zzH4.bias !== structH4.bias) {
      return {
        status: "no_trend",
        message: `ZigZag H4 tidak konfirmasi trend (structure: ${structH4.bias}, zigzag: ${zzH4.bias}) — kemungkinan trend palsu/noise`,
        symbol,
        currentPrice,
        timestamp,
        h4: { bias: structH4.bias, strength: structH4.strength },
      };
    }

    const bias = structH4.bias as "bullish" | "bearish";

    // STEP 2: Detect zones at H4 (zona entry utama, lebih besar dari H1)
    const [obs, fvgs, unfilledOrders] = await Promise.all([
      Promise.resolve(detectOrderBlocksH1(h4.opens, h4.highs, h4.lows, h4.closes, bias)),
      Promise.resolve(detectFVGH1(h4.highs, h4.lows, bias)),
      detectUnfilledOrdersH1(symbol, currentPrice, bias),
    ]);

    const srLevels = detectSRLevels(h4.highs, h4.lows, h4.closes);
    const sndZones = detectSnDZones(h4.opens, h4.highs, h4.lows, h4.closes);
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
    // Confluence check pakai H4 (bukan D1 lagi, D1 udah dihapus dari alur). Sempet
    // dicoba pakai H1 tapi window internal fungsi ini (5 candle momentum, 20 candle
    // avg volume) dikalibrasi buat granularitas H4 — kalau dikasih H1, window efektifnya
    // jadi 4x lebih pendek (5 jam vs 20 jam) tanpa disadari. H4-ke-H4 BUKAN circular,
    // ini legitimate: ngecek apakah price action H4 sendiri nunjukin approach + pullback
    // volume sehat menuju zona (zona-nya dari touch high/low, beda logic dari ini).
    const h4Confluence = detectH4Confluence(
      h4.highs, h4.lows, h4.closes, h4.volumes,
      selectedZone.low, selectedZone.high, bias
    );

    // STEP 4b: RSI Divergence H1 (scoring, bukan hard filter) — ganti CHoCH15M+Rejection15M
    // Presisi: anchor ke titik swing high/low beneran (bukan cuma perbandingan RSI kasar),
    // pola sama persis kayak yang dipakai Menu 4 buat konsistensi.
    const rsiSeriesH1 = calcRSISeries(h1.closes);
    const swingHighsH1 = findSwingPointsIdx(h1.highs, 'high', 2);
    const swingLowsH1 = findSwingPointsIdx(h1.lows, 'low', 2);
    let rsiDivergenceH1 = false;
    if (bias === 'bullish' && swingLowsH1.length >= 2) {
      const l1 = swingLowsH1[swingLowsH1.length - 2]!;
      const l2 = swingLowsH1[swingLowsH1.length - 1]!;
      const priceLL = l2.value < l1.value;
      const rsiAtL1 = rsiSeriesH1[l1.idx] ?? 50;
      const rsiAtL2 = rsiSeriesH1[l2.idx] ?? 50;
      rsiDivergenceH1 = priceLL && rsiAtL2 > rsiAtL1 + 2 && rsiAtL2 < 45; // wajib dari zona jenuh jelas
    } else if (bias === 'bearish' && swingHighsH1.length >= 2) {
      const h1s = swingHighsH1[swingHighsH1.length - 2]!;
      const h2s = swingHighsH1[swingHighsH1.length - 1]!;
      const priceHH = h2s.value > h1s.value;
      const rsiAtH1 = rsiSeriesH1[h1s.idx] ?? 50;
      const rsiAtH2 = rsiSeriesH1[h2s.idx] ?? 50;
      rsiDivergenceH1 = priceHH && rsiAtH2 < rsiAtH1 - 2 && rsiAtH2 > 55; // wajib dari zona jenuh jelas
    }

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

    if (rsiDivergenceH1) {
      profitProbability += 25;
      probabilityFactors.push("✅ RSI Divergence H1 terkonfirmasi (+25%)");
    } else {
      probabilityFactors.push("⚠️ Tidak ada RSI Divergence H1 di swing terakhir");
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
      profitProbability = Math.max(0, profitProbability - 8);
      probabilityFactors.push(`🚫 Zona sudah disentuh ${zoneTouches}x — kekuatan berkurang (-8%)`);
    }

    // VWAP + SD Bands — cek posisi zona relatif ke fair value institusional (H1 session VWAP).
    // Bonus kalau zona overlap VWAP±1SD (konsensus institusional), bonus lebih besar
    // kalau zona di luar 2SD DAN searah reversion ke VWAP (bukan makin jauh/chasing).
    const vwapH1 = calcSessionVWAP(h1.highs, h1.lows, h1.closes, h1.volumes, h1.times);
    if (vwapH1) {
      const zonePrice = selectedZone.entryPrice;
      if (zonePrice >= vwapH1.lowerBand1 && zonePrice <= vwapH1.upperBand1) {
        profitProbability += 6;
        probabilityFactors.push(`✅ Zona dekat VWAP (konsensus fair value institusional) (+6%)`);
      } else if (bias === 'bullish' && zonePrice < vwapH1.lowerBand2) {
        profitProbability += 10;
        probabilityFactors.push(`✅ Entry di luar VWAP -2SD, searah reversion ke atas (+10%)`);
      } else if (bias === 'bearish' && zonePrice > vwapH1.upperBand2) {
        profitProbability += 10;
        probabilityFactors.push(`✅ Entry di luar VWAP +2SD, searah reversion ke bawah (+10%)`);
      } else if ((bias === 'bullish' && zonePrice > vwapH1.upperBand2) || (bias === 'bearish' && zonePrice < vwapH1.lowerBand2)) {
        probabilityFactors.push(`⚠️ Entry udah jauh dari VWAP ke arah yang SAMA (bukan reversion) — waspada chasing`);
      }
    }

    // Volume Profile — cek konfluensi zona sama POC/HVN/LVN (H1, 100 candle terakhir).
    // HVN sering berimpit sama Order Block (institusi udah "puas" transaksi di situ),
    // LVN sering berimpit sama FVG (harga dulu lewat cepat, kurang reliable jadi S/R).
    const vpH1 = calcVolumeProfile(h1.highs, h1.lows, h1.closes, h1.volumes);
    if (vpH1) {
      const zonePrice = selectedZone.entryPrice;
      const pocDistPct = Math.abs(zonePrice - vpH1.poc) / vpH1.poc * 100;
      const nearHVN = vpH1.hvnLevels.some(lv => Math.abs(zonePrice - lv) / lv * 100 < 0.3);
      const nearLVN = vpH1.lvnLevels.some(lv => Math.abs(zonePrice - lv) / lv * 100 < 0.3);
      const inValueArea = zonePrice >= vpH1.val && zonePrice <= vpH1.vah;
      if (pocDistPct < 0.3) {
        profitProbability += 10;
        probabilityFactors.push(`✅ Entry deket POC (${vpH1.poc.toFixed(4)}) — magnet harga terkuat (+10%)`);
      } else if (nearHVN) {
        profitProbability += 6;
        probabilityFactors.push(`✅ Entry di High Volume Node — support/resistance kuat (+6%)`);
      } else if (nearLVN) {
        profitProbability = Math.max(0, profitProbability - 6);
        probabilityFactors.push(`⚠️ Entry di Low Volume Node — zona kurang reliable, harga cenderung cepat lewat (-6%)`);
      } else if (inValueArea) {
        profitProbability += 4;
        probabilityFactors.push(`✅ Entry di dalam Value Area (konsensus 70% volume) (+4%)`);
      }
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

    // Economic Calendar Warning (FOMC/CPI/NFP) — bukan hard-skip, cuma peringatan.
    const econCheck = await checkEconomicCalendarWarning(24);
    if (econCheck.hasWarning) probabilityFactors.push(econCheck.message);

    // Momentum Info (ROC + ATR Expansion) — info kecepatan gerak harga, bukan filter.
    const momentumInfo = calcMomentumInfo(h4.highs, h4.lows, h4.closes);
    if (momentumInfo.message) probabilityFactors.push(momentumInfo.message);

    // Entry price: pakai entry point hasil refine zona (rejection15M udah dihapus)
    const finalEntryPrice = refinedZone.entryPrice;

    // STEP 6: Calculate SL/TP
    const atrH1 = calcATR(h1.highs, h1.lows, h1.closes);
    const atrH4 = calcATR(h4.highs, h4.lows, h4.closes); // ATR H4 untuk SL (ganti D1, udah dihapus)

    // FIX: sebelumnya param ke-4 (buat rasio setupValidHours) dikirim atrH4 juga
    // (sama kayak atrSl di param ke-3) — bikin rasio-nya selalu 1, jadi setupValidHours
    // KONSTAN 2 jam apapun kondisinya. Sekarang param ke-4 diisi atrH1 (ATR lebih halus)
    // biar rasionya berarti lagi. Param h1Highs/h1Lows (posisi 6-7, fallback doang)
    // sekarang diisi H1 asli (bukan H4 dobel), dan param d1Highs/d1Lows (posisi 9-10,
    // sumber utama swing search — nama lama "d1" tapi sekarang perannya diambil alih H4
    // karena D1 udah dihapus) diisi data H4.
    const sniperLevels = calcSniperLevels(
      finalEntryPrice, refinedZone, atrH4, atrH1, bias,
      h1.highs, h1.lows, atrH1,
      h4.highs, h4.lows
    );

    // Estimate time to hit entry (pakai atrH4 untuk estimasi jam)
    const distanceToEntry = Math.abs(currentPrice - sniperLevels.entryPrice);
    const estimatedHitHours = Math.max(1, Math.round(distanceToEntry / atrH4));

    // Breakdown per-timeframe — terstruktur biar UI bisa nampilin tabel jelas
    const tfBreakdown: TFBreakdownItem[] = [
      {
        timeframe: 'H4',
        label: 'Trend Utama',
        detail: `${bias === 'bullish' ? 'Bullish' : 'Bearish'} (${structH4.strength}), ZigZag konfirmasi`,
        status: 'confirm',
      },
      {
        timeframe: 'H1',
        label: 'RSI Divergence',
        detail: rsiDivergenceH1 ? 'Terkonfirmasi — sinyal reversal tambahan' : 'Belum ada divergence di swing terakhir',
        status: rsiDivergenceH1 ? 'confirm' : 'neutral',
      },
      {
        timeframe: 'H1',
        label: 'Zona Entry',
        detail: `${selectedZone.zoneType} — Tier ${selectedZone.tier}${(selectedZone.touches ?? 0) <= 1 ? ' (fresh)' : ` (disentuh ${selectedZone.touches}x)`}`,
        status: selectedZone.tier <= 2 ? 'confirm' : 'neutral',
      },
      {
        timeframe: '15M',
        label: 'Pattern Konfirmasi',
        detail: confirmedPattern ? `${confirmedPattern.name} terdeteksi` : 'Belum ada pattern searah bias',
        status: confirmedPattern ? 'confirm' : 'neutral',
      },
      {
        timeframe: '5M',
        label: 'Konfirmasi Entry',
        detail: confirmation.confirmed ? `${confirmation.candleType} — siap entry` : 'Belum ada candle konfirmasi, entry limit di tengah zona',
        status: confirmation.confirmed ? 'confirm' : 'warning',
      },
    ];

    // Build reasoning
    const reasoning = [
      `Entry di ${selectedZone.zoneType} (${selectedZone.low.toFixed(4)}-${selectedZone.high.toFixed(4)}).`,
      refinedZone.refined ? `Direfine menggunakan ${refinedZone.zoneType}.` : "Zona H1 digunakan langsung.",
      rsiDivergenceH1 ? "✅ RSI Divergence H1 terkonfirmasi." : "⏳ Tidak ada RSI Divergence H1.",
      confirmedPattern ? `✅ Pattern: ${confirmedPattern.name}.` : "⏳ Tidak ada pattern konfirmasi.",
      confirmation.confirmed ? `Konfirmasi 5M: ${confirmation.candleType}.` : "",
      `SL di ${bias === "bullish" ? "bawah" : "atas"} swing H4 terdekat.`,
      `TP1 R:R 1:1.5, TP2 R:R 1:3.`,
    ].filter(Boolean).join(" ");

    return {
      status: "ready",
      message: `Setup sniper tersedia untuk ${symbol}`,
      symbol,
      currentPrice,
      timestamp,
      bias,
      tfBreakdown,
      entryPrice: sniperLevels.entryPrice,
      stopLoss: sniperLevels.stopLoss,
      takeProfit1: sniperLevels.takeProfit1,
      takeProfit2: sniperLevels.takeProfit2,
      h4: { bias: structH4.bias, strength: structH4.strength },
      zoneType: selectedZone.zoneType,
      zoneRange: { low: selectedZone.low, high: selectedZone.high },
      refinedZoneType: refinedZone.zoneType,
      entryConfirmed: rsiDivergenceH1 || confirmation.confirmed,
      rsiDivergenceH1,
      confirmationCandle: confirmation.confirmed ? confirmation.candleType : undefined,
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

// ─── Sniper Mode Classifier (Structural vs RSI-2) ──────────────────────────
// Classifier MURAH — cuma butuh ADX H4 + RSI(2) H4 (data yang emang udah
// ke-fetch buat analisa Structural), BUKAN jalanin analisa penuh dua-duanya.
// Tujuannya: Scan bisa nentuin mode yang cocok per-koin TANPA nge-double
// beban komputasi (tetep 1x analisa penuh per koin, bukan 2x).
export interface ModeClassification {
  recommendedMode: 'sniper' | 'rsi2';
  adxH4: number;
  rsi2H4: number;
  reason: string;
}

export function classifyEntryMode(highs: number[], lows: number[], closes: number[]): ModeClassification {
  const adxH4 = calcADX(highs, lows, closes);
  const rsi2H4 = calcRSI(closes, 2);
  const isExtreme = rsi2H4 < 10 || rsi2H4 > 90;

  if (adxH4 >= 25 && isExtreme) {
    return {
      recommendedMode: 'rsi2', adxH4, rsi2H4,
      reason: `Trend kuat (ADX ${adxH4.toFixed(0)}) + RSI(2) ekstrem (${rsi2H4.toFixed(0)}) — kondisi pullback sehat`,
    };
  }
  return {
    recommendedMode: 'sniper', adxH4, rsi2H4,
    reason: adxH4 < 25
      ? `Trend lemah/choppy (ADX ${adxH4.toFixed(0)}) — butuh baca struktur, bukan momentum`
      : `RSI(2) belum ekstrem (${rsi2H4.toFixed(0)}) — belum ada pullback jelas`,
  };
}

// ─── Sniper "RSI" Mode (Connors RSI-2) ──────────────────────────────────────
// Mean-reversion system dari Larry Connors & Cesar Alvarez (Short Term Trading
// Strategies That Work, 2008) — di-backtest 1000+ sinyal di ETF/saham large-cap.
// BEDA FILOSOFI dari mode "Sniper" (structural SMC): ini nyari PULLBACK SEHAT
// dalam trend yang UDAH JELAS arahnya, bukan nyari breakout/reversal struktural.
//
// Basis timeframe: H4 (setara "harian versi crypto" — project ini gak pake D1
// lagi sejak dihapus dari mode Structural).
export async function analyzeRSI2Entry(symbol: string): Promise<SniperResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';
  const maxScore = 4; // trend filter + RSI ekstrem (base 2) + BTC correlation + VWAP

  try {
    const [h4, tickerRes] = await Promise.all([
      fetchKlines(symbol, '4h', 250), // butuh minimal 200 candle buat MA200 valid + buffer
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);
    const currentPrice = tickerRes.ok
      ? parseFloat((await tickerRes.json() as { price: string }).price)
      : h4.closes[h4.closes.length - 1]!;

    const n = h4.closes.length;
    if (n < 200) {
      return { status: 'error', symbol, currentPrice, timestamp, mode: 'rsi2', message: 'Data H4 gak cukup buat MA200 (butuh minimal 200 candle)' };
    }

    const ma200 = calcSMA(h4.closes, 200);
    const ma5 = calcSMA(h4.closes, 5);
    const adxH4 = calcADX(h4.highs, h4.lows, h4.closes);
    const rsi2 = calcRSI(h4.closes, 2);
    const ma200Relation: 'above' | 'below' = currentPrice >= ma200 ? 'above' : 'below';

    // HARD FILTER 1: ADX minimal 20 — Connors RSI-2 didesain buat "pullback DALAM
    // trend kuat", bukan buat market choppy/sideways (beda dari mode Sniper yang
    // masih bisa baca struktur di kondisi apapun)
    if (adxH4 < 20) {
      return {
        status: 'no_trend', symbol, currentPrice, timestamp, mode: 'rsi2',
        adxH4, rsi2Value: rsi2, ma200Relation, ma5ExitTarget: ma5,
        message: `ADX H4 cuma ${adxH4.toFixed(1)} — trend belum cukup kuat buat RSI-2 (butuh ≥20)`,
      };
    }

    const bias: 'bullish' | 'bearish' = ma200Relation === 'above' ? 'bullish' : 'bearish';

    // HARD FILTER 2: RSI(2) wajib ekstrem SEARAH bias (bukan cuma ekstrem doang)
    const isExtreme = bias === 'bullish' ? rsi2 < 10 : rsi2 > 90;
    if (!isExtreme) {
      return {
        status: 'not_extreme', symbol, currentPrice, timestamp, bias, mode: 'rsi2',
        adxH4, rsi2Value: rsi2, ma200Relation, ma5ExitTarget: ma5,
        message: `RSI(2) H4 = ${rsi2.toFixed(1)} — belum cukup ekstrem (butuh ${bias === 'bullish' ? '< 10' : '> 90'})`,
      };
    }

    const filterResults: string[] = [
      `✅ Trend H4: ${bias === 'bullish' ? 'di atas MA200' : 'di bawah MA200'} (ADX ${adxH4.toFixed(1)})`,
      `✅ RSI(2) H4 ekstrem: ${rsi2.toFixed(1)} ${bias === 'bullish' ? '(oversold, cari LONG)' : '(overbought, cari SHORT)'}`,
    ];
    let score = 2;

    // Entry di harga sekarang — beda dari mode Sniper yang nunggu retest zona,
    // RSI-2 emang didesain entry LANGSUNG pas kondisi ekstrem kedeteksi (momentum
    // reversion biasanya cepat, nunggu retest malah ketinggalan)
    const entryPrice = currentPrice;

    // SL: swing H4 terdekat + buffer ATR, floor minimal 1x ATR H4 (konsisten
    // sama semua menu lain di project ini)
    const atrH4 = calcATR(h4.highs, h4.lows, h4.closes);
    const bufferH4 = atrH4 * 0.2;
    const swingH4H = findSwingHighs(h4.highs, 10);
    const swingH4L = findSwingLows(h4.lows, 10);
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
    if (risk <= 0) {
      return { status: 'error', symbol, currentPrice, timestamp, mode: 'rsi2', message: 'Risk tidak valid' };
    }
    const dir = bias === 'bullish' ? 1 : -1;
    const takeProfit1 = entryPrice + risk * 1.5 * dir;
    const takeProfit2 = entryPrice + risk * 2 * dir;

    // BTC Correlation Filter — konsisten sama menu lain
    const btcCheck = await checkBtcAlignment(bias, symbol);
    if (btcCheck.message) {
      filterResults.push(btcCheck.message);
      if (btcCheck.aligned && btcCheck.btcBias !== 'ranging') score++;
    }

    // VWAP — reuse fungsi yang sama kayak menu lain
    const vwapH4 = calcSessionVWAP(h4.highs, h4.lows, h4.closes, h4.volumes, h4.times);
    if (vwapH4) {
      if (entryPrice >= vwapH4.lowerBand1 && entryPrice <= vwapH4.upperBand1) {
        score++;
        filterResults.push(`✅ Entry dekat VWAP (konsensus fair value institusional)`);
      } else if ((bias === 'bullish' && entryPrice < vwapH4.lowerBand2) || (bias === 'bearish' && entryPrice > vwapH4.upperBand2)) {
        score++;
        filterResults.push(`✅ Entry di luar VWAP 2SD, searah reversion — pullback ekstrem terkonfirmasi`);
      }
    }

    return {
      status: 'ready', symbol, currentPrice, timestamp, bias, mode: 'rsi2',
      rsi2Value: rsi2, ma200Relation, adxH4, ma5ExitTarget: ma5,
      entryPrice, stopLoss, takeProfit1, takeProfit2,
      score, maxScore, filterResults,
      message: `RSI-2 ${bias === 'bullish' ? 'LONG' : 'SHORT'} — RSI(2) H4 ${rsi2.toFixed(1)}, exit dinamis di MA5 (${ma5.toFixed(4)})`,
    };
  } catch (err) {
    return {
      status: 'error',
      message: `Gagal menganalisa ${symbol}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      symbol,
      currentPrice: 0,
      timestamp,
      mode: 'rsi2',
    };
  }
}

// ─── Menu 4: Breakout Detection ───────────────────────────────────────────────

// ─── Menu 6: Scalping Scanner (SMC Micro 15M) ────────────────────────────────

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
}

export async function analyzeScalpingEntry(symbol: string): Promise<ScalpingResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';
  const maxScore = 12; // 7 filter asli + SMA200 (soft) + RSI(2) (soft) + BTC correlation + zone freshness + VWAP + Volume Profile

  try {
    const [h4, h1, m30, m5, tickerRes] = await Promise.all([
      fetchKlines(symbol, '4h', 250),   // H4 — trend utama, SMA200/SMA13, RSI(2), SL (naik dari 100, butuh 200+ buat SMA200)
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

    // SMA200 H4 trend confirmation + RSI(2) H4 ekstrem — BALIK jadi soft/bonus
    // (bukan hard filter lagi). RSI(2) ekstrem itu kondisi statistically jarang,
    // kalau diwajibin buat SEMUA 50 koin di Scan, sinyal jadi kelewat jarang muncul.
    // Sekarang: nambah confidence kalau match, TAPI TETEP LOLOS walau gak match.
    const sma200H4 = calcSMA(h4.closes, 200);
    const sma13H4 = calcSMA(h4.closes, 13);
    const lastCloseH4 = h4.closes[h4.closes.length - 1] ?? currentPrice;
    const smaConfirmed =
      (bias === 'bullish' && lastCloseH4 > sma200H4) ||
      (bias === 'bearish' && lastCloseH4 < sma200H4);
    const rsi2H4 = calcRSI(h4.closes, 2);
    const rsi2Extreme = bias === 'bullish' ? rsi2H4 < 10 : rsi2H4 > 90;

    if (smaConfirmed) score++;
    if (rsi2Extreme) score++;

    filterResults.push(
      `${smaConfirmed ? '✅' : '⚠️'} Trend H4: ${bias === 'bullish' ? 'Bullish' : 'Bearish'} (${structH4.strength}) | SMA200 ${smaConfirmed ? 'konfirmasi' : 'belum konfirmasi'} | RSI(2): ${rsi2H4.toFixed(1)} ${rsi2Extreme ? '(ekstrem)' : '(belum ekstrem)'} | SMA13: ${sma13H4.toFixed(4)}`
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

    // Zone Freshness — zona yang belum pernah/jarang disentuh lebih kuat.
    const zoneTouches30 = bestZone30.touches ?? 0;
    if (zoneTouches30 <= 1) {
      score++;
      filterResults.push(`✅ Zona fresh (disentuh ${zoneTouches30}x)`);
    } else {
      filterResults.push(`⚠️ Zona udah disentuh ${zoneTouches30}x — kekuatan berkurang`);
    }

    // VWAP + SD Bands — cek posisi zona relatif ke fair value institusional (M30 session VWAP).
    const vwapM30 = calcSessionVWAP(m30.highs, m30.lows, m30.closes, m30.volumes, m30.times);
    if (vwapM30) {
      const zonePrice = bestZone30.entryPrice;
      if (zonePrice >= vwapM30.lowerBand1 && zonePrice <= vwapM30.upperBand1) {
        score++;
        filterResults.push(`✅ Zona dekat VWAP (konsensus fair value institusional)`);
      } else if (bias === 'bullish' && zonePrice < vwapM30.lowerBand2) {
        score++;
        filterResults.push(`✅ Entry di luar VWAP -2SD, searah reversion ke atas`);
      } else if (bias === 'bearish' && zonePrice > vwapM30.upperBand2) {
        score++;
        filterResults.push(`✅ Entry di luar VWAP +2SD, searah reversion ke bawah`);
      } else if ((bias === 'bullish' && zonePrice > vwapM30.upperBand2) || (bias === 'bearish' && zonePrice < vwapM30.lowerBand2)) {
        filterResults.push(`⚠️ Entry udah jauh dari VWAP ke arah yang SAMA — waspada chasing`);
      }
    }

    // Volume Profile — cek konfluensi zona sama POC/HVN/LVN (M30, 100 candle terakhir).
    const vpM30 = calcVolumeProfile(m30.highs, m30.lows, m30.closes, m30.volumes);
    if (vpM30) {
      const zonePrice = bestZone30.entryPrice;
      const pocDistPct = Math.abs(zonePrice - vpM30.poc) / vpM30.poc * 100;
      const nearHVN = vpM30.hvnLevels.some(lv => Math.abs(zonePrice - lv) / lv * 100 < 0.3);
      const nearLVN = vpM30.lvnLevels.some(lv => Math.abs(zonePrice - lv) / lv * 100 < 0.3);
      const inValueArea = zonePrice >= vpM30.val && zonePrice <= vpM30.vah;
      if (pocDistPct < 0.3) {
        score++;
        filterResults.push(`✅ Entry deket POC (${vpM30.poc.toFixed(4)}) — magnet harga terkuat`);
      } else if (nearHVN) {
        score++;
        filterResults.push(`✅ Entry di High Volume Node — support/resistance kuat`);
      } else if (nearLVN) {
        filterResults.push(`⚠️ Entry di Low Volume Node — zona kurang reliable, harga cenderung cepat lewat`);
      } else if (inValueArea) {
        filterResults.push(`✅ Entry di dalam Value Area (konsensus 70% volume)`);
      }
    }

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

    // Economic Calendar Warning (FOMC/CPI/NFP) — bukan hard-skip, cuma peringatan.
    const econCheck = await checkEconomicCalendarWarning(24);
    if (econCheck.hasWarning) filterResults.push(econCheck.message);

    // Momentum Info (ROC + ATR Expansion) — info kecepatan gerak harga, bukan filter.
    const momentumInfo = calcMomentumInfo(h4.highs, h4.lows, h4.closes);
    if (momentumInfo.message) filterResults.push(momentumInfo.message);

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

    // Breakdown per-timeframe
    const tfBreakdown: TFBreakdownItem[] = [
      {
        timeframe: 'H4',
        label: 'Trend Utama',
        detail: `${bias === 'bullish' ? 'Bullish' : 'Bearish'} (${structH4.strength}) — SMA200 konfirmasi, RSI(2): ${rsi2H4.toFixed(1)}`,
        status: 'confirm',
      },
      {
        timeframe: 'M30',
        label: 'Koreksi vs H4',
        detail: m30Correction ? 'M30 koreksi/berlawanan H4 — retest valid' : 'M30 masih searah H4 — waspada, belum koreksi jelas',
        status: m30Correction ? 'confirm' : 'warning',
      },
      {
        timeframe: 'M30',
        label: 'Zona Entry',
        detail: `${bestZone30?.zoneType ?? finalZone.zoneType} — Tier ${bestZone30?.tier ?? '-'}`,
        status: (bestZone30?.tier ?? 3) <= 2 ? 'confirm' : 'neutral',
      },
      {
        timeframe: 'M30',
        label: 'BB Squeeze',
        detail: bbSqueeze.isSqueezing ? 'Aktif — energy terakumulasi, potensi gerak eksplosif' : 'Tidak aktif',
        status: bbSqueeze.isSqueezing ? 'confirm' : 'neutral',
      },
      {
        timeframe: 'H1/M30',
        label: 'Trigger Reversal',
        detail: pats30.length > 0 ? `Pattern: ${pats30[0]!.name}` : rsiDivergence ? 'RSI Divergence H1' : 'Belum ada trigger',
        status: (pats30.length > 0 || rsiDivergence) ? 'confirm' : 'warning',
      },
    ];

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
      status, symbol, bias, mode: 'structural', tfBreakdown, currentPrice, timestamp, score, maxScore,
      structure15M: `H4 ${bias} → M30 ${structM30.bias}`,
      choch15M: hasConfirmation,
      ob5M: { low: finalZone.low, high: finalZone.high, mid: finalZone.mid, fresh: true },
      entryPrice, stopLoss, takeProfit1, takeProfit2, rr1: 1.5, rr2: 3.0,
      atr15MPct: atrM5Pct, filterResults, bbSqueezing: bbSqueeze.isSqueezing,
      message: trendWarning ? `${statusMsg} | ${trendWarning}` : statusMsg,
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
 * Skill "Scalping 15M" — beda total dari skill Structural (H4→M30→M5 SMC-based).
 * Basis: deteksi zona S/R M15 (bukan garis, tapi ZONA lebar ATR×0.35), validasi
 * breakout+volume, tunggu retest ke zona dengan pullback volume rendah (wajib)
 * + minimal 1 dari 2 konfirmasi tambahan (rejection volume, momentum align).
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
    const [m15, tickerRes] = await Promise.all([
      fetchKlines(symbol, '15m', 250),
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);
    const currentPrice = tickerRes.ok
      ? parseFloat((await tickerRes.json() as { price: string }).price)
      : m15.closes[m15.closes.length - 1]!;

    const filterResults: string[] = [];
    let score = 0;

    const n15 = m15.closes.length;
    if (n15 < 130) {
      return { status: 'no_setup', symbol, currentPrice, timestamp, mode: 'scalping15m', message: 'Data M15 gak cukup (butuh 120+ candle)', maxScore };
    }

    const atr15 = calcATR(m15.highs, m15.lows, m15.closes);
    const zoneWidth = atr15 * 0.35;
    const mergeDistance = atr15 * 0.5;

    // Deteksi swing points dalam lookback 120 candle — ambil BANYAK titik (30,
    // bukan 5) biar merge level genuinely nemuin zona yang valid (pelajaran dari
    // bug clustering Menu 1 kemarin: dikit titik = clustering hampir gak pernah nemu match).
    const lookbackSlice = 120;
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
    const resistanceLevels = mergeLevels(swingH);
    const supportLevels = mergeLevels(swingL);

    if (resistanceLevels.length === 0 && supportLevels.length === 0) {
      return { status: 'no_setup', symbol, currentPrice, timestamp, mode: 'scalping15m', message: 'Gak ada zona S/R yang valid', maxScore };
    }

    const volMA20At = (idx: number) => {
      const start = Math.max(0, idx - 20);
      const win = m15.volumes.slice(start, idx);
      return win.length > 0 ? win.reduce((a, b) => a + b, 0) / win.length : 0;
    };

    // Cari breakout dalam retest window (24 candle terakhir = ~6 jam)
    const retestWindowMax = 24;
    let foundBreakout: { direction: 'bullish' | 'bearish'; zoneLevel: number; edgeUpper: number; edgeLower: number; breakoutPrice: number; breakoutIdx: number } | null = null;

    for (let idx = Math.max(1, n15 - retestWindowMax); idx < n15; idx++) {
      const closeAt = m15.closes[idx]!;
      const volAt = m15.volumes[idx]!;
      const volMA = volMA20At(idx);
      if (volMA <= 0) continue;
      for (const level of resistanceLevels) {
        const edgeUpper = level + zoneWidth / 2;
        const edgeLower = level - zoneWidth / 2;
        if (closeAt > edgeUpper && volAt > 1.4 * volMA) {
          foundBreakout = { direction: 'bullish', zoneLevel: level, edgeUpper, edgeLower, breakoutPrice: closeAt, breakoutIdx: idx };
        }
      }
      for (const level of supportLevels) {
        const edgeUpper = level + zoneWidth / 2;
        const edgeLower = level - zoneWidth / 2;
        if (closeAt < edgeLower && volAt > 1.4 * volMA) {
          foundBreakout = { direction: 'bearish', zoneLevel: level, edgeUpper, edgeLower, breakoutPrice: closeAt, breakoutIdx: idx };
        }
      }
    }

    if (!foundBreakout) {
      return { status: 'waiting', symbol, currentPrice, timestamp, mode: 'scalping15m', message: 'Belum ada breakout valid dalam retest window (24 candle terakhir)', maxScore };
    }
    const bias = foundBreakout.direction;
    const candlesSinceBreakout = n15 - 1 - foundBreakout.breakoutIdx;
    filterResults.push(`✅ Breakout ${bias === 'bullish' ? 'bullish' : 'bearish'} dari zona ${foundBreakout.zoneLevel.toFixed(4)}, ${candlesSinceBreakout} candle lalu`);

    // ── Entry, SL, TP — dihitung dari sini karena zona (edgeUpper/edgeLower)
    // udah FIXED begitu breakout kedeteksi. Dipake buat status 'approaching'
    // (proyeksi limit order yang bakal dipasang begitu retest kejadian) MAUPUN
    // 'in_zone' (limit order final). BUG SEBELUMNYA: kalkulasi ini cuma jalan
    // buat 'in_zone', jadi status 'approaching' gak pernah nampilin entry/SL/TP.
    const entryBuffer = atr15 * 0.20;
    const slBuffer = atr15 * 0.8;
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
    const takeProfit1 = risk > 0 ? entryPrice + risk * 1.5 * dir : undefined; // RR target 1.5 sesuai spec

    const inZone = currentPrice <= foundBreakout.edgeUpper && currentPrice >= foundBreakout.edgeLower;

    if (!inZone) {
      if (candlesSinceBreakout > retestWindowMax) {
        return {
          status: 'expired', symbol, bias, currentPrice, timestamp, mode: 'scalping15m',
          zoneEdgeUpper: foundBreakout.edgeUpper, zoneEdgeLower: foundBreakout.edgeLower, candlesSinceBreakout,
          message: `Breakout ${bias} udah lewat retest window (${candlesSinceBreakout} candle, max ${retestWindowMax})`,
          score, maxScore, filterResults,
        };
      }
      return {
        status: 'approaching', symbol, bias, currentPrice, timestamp, mode: 'scalping15m',
        zoneEdgeUpper: foundBreakout.edgeUpper, zoneEdgeLower: foundBreakout.edgeLower, candlesSinceBreakout,
        entryPrice, stopLoss, takeProfit1, rr1: 1.5,
        message: `SIAP BREAKOUT — breakout ${bias} udah terjadi ${candlesSinceBreakout} candle lalu, nunggu harga retest ke zona ${foundBreakout.zoneLevel.toFixed(4)} (entry di bawah proyeksi limit order)`,
        score, maxScore, filterResults,
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
        score, maxScore, filterResults,
      };
    }

    const lastVol = m15.volumes[n15 - 1]!;
    const lastVolMA = volMA20At(n15 - 1);
    const pullbackVolumeOk = lastVolMA > 0 ? lastVol < lastVolMA : false;
    if (!pullbackVolumeOk) {
      return {
        status: 'no_setup', symbol, bias, currentPrice, timestamp, mode: 'scalping15m',
        zoneEdgeUpper: foundBreakout.edgeUpper, zoneEdgeLower: foundBreakout.edgeLower, candlesSinceBreakout,
        message: 'Pullback volume masih tinggi (belum nunjukin koreksi lemah) — syarat wajib belum lolos',
        score, maxScore, filterResults,
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

    const rsi15 = calcRSI(m15.closes, 14);
    const macd15 = calcMACD(m15.closes);
    const momentumAlign = bias === 'bullish' ? (rsi15 > 50 && macd15.histogram > 0) : (rsi15 < 50 && macd15.histogram < 0);
    if (momentumAlign) {
      confirmCount++; score++;
      filterResults.push(`✅ Momentum align — RSI ${rsi15.toFixed(1)}, MACD histogram ${macd15.histogram > 0 ? 'positif' : 'negatif'} searah bias`);
    } else {
      filterResults.push(`⚠️ Momentum belum align — RSI ${rsi15.toFixed(1)}`);
    }

    if (confirmCount < 1) {
      return {
        status: 'no_setup', symbol, bias, currentPrice, timestamp, mode: 'scalping15m',
        zoneEdgeUpper: foundBreakout.edgeUpper, zoneEdgeLower: foundBreakout.edgeLower, candlesSinceBreakout,
        message: 'Belum ada konfirmasi tambahan (rejection volume / momentum align) yang lolos',
        score, maxScore, filterResults,
      };
    }

    // BTC Correlation — konsisten sama menu lain
    const btcCheck = await checkBtcAlignment(bias, symbol);
    if (btcCheck.message) {
      filterResults.push(btcCheck.message);
      if (btcCheck.aligned && btcCheck.btcBias !== 'ranging') score++;
    }

    // Validasi risk final — entry/SL/TP udah dihitung di atas (dipake juga buat
    // status 'approaching'), di sini cuma cek validitasnya buat sinyal FINAL (in_zone)
    if (risk <= 0 || takeProfit1 === undefined) {
      return { status: 'no_setup', symbol, bias, currentPrice, timestamp, mode: 'scalping15m', message: 'Risk tidak valid', score, maxScore, filterResults };
    }

    const tfBreakdown: TFBreakdownItem[] = [
      { timeframe: 'M15', label: 'Breakout Zona', detail: `${bias === 'bullish' ? 'Bullish' : 'Bearish'} dari ${foundBreakout.zoneLevel.toFixed(4)}, ${candlesSinceBreakout} candle lalu`, status: 'confirm' },
      { timeframe: 'M15', label: 'Pullback Volume', detail: 'Rendah (koreksi lemah)', status: 'confirm' },
      { timeframe: 'M15', label: 'Rejection Volume', detail: rejectionVolumeOk ? 'Spike ≥1.2x' : 'Belum spike', status: rejectionVolumeOk ? 'confirm' : 'neutral' },
      { timeframe: 'M15', label: 'Momentum Align', detail: momentumAlign ? 'RSI+MACD searah' : 'Belum align', status: momentumAlign ? 'confirm' : 'neutral' },
    ];

    return {
      status: 'in_zone', symbol, bias, mode: 'scalping15m', currentPrice, timestamp, score, maxScore,
      zoneEdgeUpper: foundBreakout.edgeUpper, zoneEdgeLower: foundBreakout.edgeLower, candlesSinceBreakout,
      entryPrice, stopLoss, takeProfit1, rr1: 1.5,
      filterResults, tfBreakdown,
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

export interface ExtremeScalpingResult {
  status: 'siap_entry' | 'no_setup' | 'error';
  symbol: string;
  bias?: 'bullish' | 'bearish';
  currentPrice: number;
  timestamp: string;
  message?: string;
  confidence?: number; // 0-100, INFORMASIONAL doang (bukan gating — semua syarat di bawah WAJIB lolos dulu)
  maxScore: number;
  volume24h?: number;
  atrPct?: number;
  entryType?: 'aggressive' | 'conservative';
  ob15M?: { low: number; high: number; mid: number; fresh: boolean };
  fvg15M?: { low: number; high: number; mid: number };
  liquidityPoolLevel?: number;
  rsi5M?: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit1?: number;
  rr1?: number;
  filterResults?: string[];
  tfBreakdown?: TFBreakdownItem[];
  recentPerformance?: RecentPerformance;
}

/**
 * Extreme Scalping v4 — TF15M struktur SMC (bias) -> TF5M eksekusi (retest +
 * momentum). REWRITE TOTAL dari v3 (Quant SMC scoring). Basis: rule engine —
 * SEMUA syarat WAJIB lolos berurutan (bukan weighted score kayak v3), sesuai
 * spec dokumen: "Signal engine: rule engine yang memerlukan semua kondisi
 * terpenuhi". Confidence di output itu informasional doang, BUKAN threshold
 * lolos/gagal. ZigZag + Fractal ditambahin di Langkah 2 (request tambahan,
 * bukan dari dokumen asli). Pin bar/Engulfing SENGAJA di-skip — rejection
 * cukup via micro-structure HH/HL. Spread (orderbook) juga di-skip — data
 * real-time gak reliable buat sistem scan periodik (alasan sama kayak
 * keputusan-keputusan skip orderbook sebelumnya).
 */
export async function analyzeExtremeScalpingEntry(symbol: string): Promise<ExtremeScalpingResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';
  const maxScore = 100;

  try {
    const [m15, m5, ticker24hRes, tickerRes] = await Promise.all([
      fetchKlines(symbol, '15m', 350), // naik dari 250 - butuh 300+ minimum, plus buffer
      fetchKlines(symbol, '5m', 200), // naik dari 100
      fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`),
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);
    const currentPrice = tickerRes.ok
      ? parseFloat((await tickerRes.json() as { price: string }).price)
      : m5.closes[m5.closes.length - 1]!;

    const filterResults: string[] = [];

    // ── Langkah 1: Pre-filter ──────────────────────────────────────────────
    let volume24h = 0;
    if (ticker24hRes.ok) {
      const t = (await ticker24hRes.json()) as { quoteVolume: string };
      volume24h = parseFloat(t.quoteVolume);
    }
    if (volume24h < 10_000_000) {
      return { status: 'no_setup', symbol, currentPrice, timestamp, message: `Volume 24h cuma $${(volume24h / 1e6).toFixed(1)}jt — butuh >$10jt`, maxScore, volume24h };
    }

    const atr15 = calcATR(m15.highs, m15.lows, m15.closes);
    const atrPct = (atr15 / currentPrice) * 100;
    // ATR gak lagi hard filter — sekarang jadi bonus scoring doang (masuk confluenceFactors di bawah)
    // Catatan: syarat "spread" dari dokumen SENGAJA di-skip — data orderbook
    // real-time gak reliable buat sistem scan periodik (basi begitu ditampilin).
    filterResults.push(`✅ Pre-filter: Volume 24h $${(volume24h / 1e6).toFixed(1)}jt, ATR ${atrPct.toFixed(2)}%${atrPct < 0.3 ? ' (rendah, tapi gak nge-block)' : ''}`);

    // ── Langkah 2: Struktur SMC TF15M (nentuin bias) ──────────────────────
    const n15 = m15.closes.length;
    if (n15 < 300) {
      return { status: 'no_setup', symbol, currentPrice, timestamp, message: 'Data 15M gak cukup buat EMA200', maxScore, volume24h, atrPct, filterResults };
    }

    // ZigZag (request tambahan, bukan dari dokumen asli)
    const zz15 = zigzagBias(m15.highs, m15.lows, 3);
    if (zz15.bias === 'ranging') {
      return { status: 'no_setup', symbol, currentPrice, timestamp, message: 'ZigZag 15M masih ranging, belum ada trend jelas', maxScore, volume24h, atrPct, filterResults };
    }
    const bias = zz15.bias;

    // Fractal — 5-candle swing (2 kiri + 2 kanan) — DILONGGARIN jadi bonus scoring
    const fractalHighs = findSwingHighs(m15.highs, 20);
    const fractalLows = findSwingLows(m15.lows, 20);
    const fractalOk = bias === 'bullish' ? fractalLows.length >= 2 : fractalHighs.length >= 2;
    filterResults.push(fractalOk
      ? `✅ Fractal swing points cukup buat validasi struktur`
      : `⚠️ Fractal swing points kurang — gak wajib, tetep lanjut`);

    // Struktur HH/HL atau LL/LH — DILONGGARIN: sebelumnya validasi silang WAJIB
    // match ZigZag (2 algoritma independen dipaksa "setuju"), sekarang jadi
    // konfirmasi bonus doang (bukan hard block). ZigZag tetep jadi satu-satunya
    // sumber kebenaran buat nentuin bias, Structure cuma nambah confidence.
    const struct15 = analyzePriceActionStructure(m15.highs, m15.lows, m15.closes);
    const structAligned = struct15.bias === bias;
    filterResults.push(structAligned
      ? `✅ Struktur 15M konfirmasi ZigZag (${bias})`
      : `⚠️ Struktur 15M (${struct15.bias}) beda dari ZigZag (${bias}) — gak wajib, tetep lanjut`);

    // Bias final: struktur + EMA200(15M) — DILONGGARIN jadi bonus scoring
    const ema200_15 = calcEMASeries(m15.closes, 200);
    const lastEma200_15 = ema200_15[ema200_15.length - 1]!;
    const lastClose15 = m15.closes[n15 - 1]!;
    const emaAligned = bias === 'bullish' ? lastClose15 > lastEma200_15 : lastClose15 < lastEma200_15;
    filterResults.push(emaAligned
      ? `✅ Harga 15M ${bias === 'bullish' ? 'di atas' : 'di bawah'} EMA200 — bias konfirmasi`
      : `⚠️ Harga 15M belum ${bias === 'bullish' ? 'di atas' : 'di bawah'} EMA200 — gak wajib, tetep lanjut`);
    filterResults.push(`✅ ZigZag: ${bias === 'bullish' ? 'Bullish (HH/HL)' : 'Bearish (LL/LH)'} — EMA200 konfirmasi`);

    // Order Block 15M — HARD FILTER lagi (zona referensi wajib ada), TAPI:
    // - Freshness (belum retest) TETEP boleh enggak — OB udah di-retest pun
    //   masih dipake, cuma turun ke scoring/bonus doang.
    // - Kalau OB gak ada SAMA SEKALI, coba fallback: cari S&R terkuat yang
    //   numpuk sama level Fibonacci (confluence), sebelum beneran diblok.
    const obs15 = detectOrderBlocksH1(m15.opens, m15.highs, m15.lows, m15.closes, bias, 30);
    type ZoneRef = { low: number; high: number; mid: number; touches: number };
    let ob: ZoneRef;
    let obFresh: boolean;
    let obSource: 'order_block' | 'sr_fib';

    if (obs15.length > 0) {
      const freshOb = obs15.filter(o => o.touches === 0);
      const picked = freshOb.length > 0 ? freshOb[freshOb.length - 1]! : obs15[obs15.length - 1]!;
      ob = { low: picked.low, high: picked.high, mid: picked.mid, touches: picked.touches };
      obFresh = freshOb.length > 0;
      obSource = 'order_block';
      filterResults.push(obFresh
        ? `✅ Order Block 15M fresh: ${ob.low.toFixed(4)} - ${ob.high.toFixed(4)}`
        : `⚠️ Order Block 15M udah pernah di-retest (bukan fresh): ${ob.low.toFixed(4)} - ${ob.high.toFixed(4)} — gak wajib, tetep lanjut`);
    } else {
      // Fallback: S&R terkuat yang numpuk sama Fibonacci
      const srLevels = detectSRLevels(m15.highs, m15.lows, m15.closes, 100);
      const fib = calcFibonacci(m15.highs, m15.lows, m15.closes);
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

      if (!bestSr) {
        return { status: 'no_setup', symbol, bias, currentPrice, timestamp, message: 'Gak ada Order Block DAN gak ada S&R+Fibonacci confluence buat referensi zona entry', maxScore, volume24h, atrPct, filterResults };
      }
      const zoneWidth = atr15 * 0.15;
      ob = { low: bestSr.price - zoneWidth, high: bestSr.price + zoneWidth, mid: bestSr.price, touches: bestSr.touches };
      obFresh = false;
      obSource = 'sr_fib';
      filterResults.push(`✅ Gak ada OB, pakai fallback S&R+Fibonacci confluence: ${ob.low.toFixed(4)} - ${ob.high.toFixed(4)} (${bestSr.touches}x hits)`);
    }

    // FVG 15M — opsional (bonus konfluensi buat RR, bukan hard filter)
    const fvgs15 = detectFVGH1(m15.highs, m15.lows, bias, 30);
    const freshFvgList = fvgs15.filter(f => f.touches === 0);
    const fvg = freshFvgList.length > 0 ? freshFvgList[freshFvgList.length - 1] : undefined;
    if (fvg) filterResults.push(`✅ FVG 15M belum keisi: ${fvg.low.toFixed(4)} - ${fvg.high.toFixed(4)}`);

    // Liquidity pool — swing high/low terdekat, target stop-hunt (informasional)
    const liquidityLevel = bias === 'bullish'
      ? (fractalHighs.length > 0 ? Math.max(...fractalHighs.slice(-3)) : undefined)
      : (fractalLows.length > 0 ? Math.min(...fractalLows.slice(-3)) : undefined);

    // ── Langkah 3: Konfirmasi Momentum TF5M (eksekusi) ────────────────────
    const n5 = m5.closes.length;
    const lastClose5 = m5.closes[n5 - 1]!;

    // 1. Retest OB — DILONGGARIN: sebelumnya hard filter (harga WAJIB ada di
    // dalam OB PERSIS SEKARANG), sekarang jadi info doang (gak block sinyal).
    // Alasan: window "harga di dalam OB PERSIS SEKARANG" itu momen yang sangat
    // sempit, kombinasi sama 13 syarat wajib lain bikin peluang lolos hampir 0.
    const inOb = lastClose5 >= ob.low && lastClose5 <= ob.high;
    filterResults.push(inOb
      ? `✅ Harga 5M lagi di dalam OB 15M (${ob.low.toFixed(4)} - ${ob.high.toFixed(4)})`
      : `⚠️ Harga 5M belum PERSIS di OB 15M (${ob.low.toFixed(4)} - ${ob.high.toFixed(4)}) — gak wajib, tetep lanjut`);
    // Rejection via micro-structure HH/HL (Pin bar/Engulfing SENGAJA di-skip)
    const struct5 = analyzePriceActionStructure(m5.highs, m5.lows, m5.closes);
    if (struct5.bias !== bias) {
      return {
        status: 'no_setup', symbol, bias, currentPrice, timestamp,
        message: 'Micro-structure 5M belum konfirmasi rejection sesuai bias',
        maxScore, volume24h, atrPct, filterResults, ob15M: { low: ob.low, high: ob.high, mid: ob.mid, fresh: true },
      };
    }
    filterResults.push(`✅ Retest OB 15M + rejection micro-structure 5M valid`);

    // 2. EMA Ribbon (EMA21 & EMA50) — DILONGGARIN jadi bonus scoring, gak block
    const ema21_5 = calcEMASeries(m5.closes, 21);
    const ema50_5 = calcEMASeries(m5.closes, 50);
    const lastEma21 = ema21_5[ema21_5.length - 1]!;
    const lastEma50 = ema50_5[ema50_5.length - 1]!;
    const emaRibbonOk = bias === 'bullish' ? (lastClose5 > lastEma21 && lastClose5 > lastEma50) : (lastClose5 < lastEma21 && lastClose5 < lastEma50);
    filterResults.push(emaRibbonOk
      ? `✅ EMA Ribbon 5M searah bias (EMA21/EMA50)`
      : `⚠️ EMA Ribbon 5M belum searah bias — gak wajib, tetep lanjut`);

    // 3. RSI(14) cross 50 searah bias
    const rsi5 = calcRSI(m5.closes, 14);
    const rsiOk = bias === 'bullish' ? rsi5 > 50 : rsi5 < 50;
    if (!rsiOk) {
      return { status: 'no_setup', symbol, bias, currentPrice, timestamp, message: `RSI(14) 5M = ${rsi5.toFixed(1)} belum cross 50 searah bias`, maxScore, volume24h, atrPct, filterResults, rsi5M: rsi5 };
    }
    filterResults.push(`✅ RSI(14) 5M = ${rsi5.toFixed(1)}, searah bias`);

    // 4. ROC — DILONGGARIN jadi bonus scoring, gak block
    const rocLookback = 5;
    const rocRef = m5.closes[n5 - 1 - rocLookback] ?? m5.closes[0]!;
    const roc = rocRef > 0 ? ((lastClose5 - rocRef) / rocRef) * 100 : 0;
    const rocOk = bias === 'bullish' ? roc > 0 : roc < 0;
    const momentum5 = calcMomentumInfo(m5.highs, m5.lows, m5.closes);
    filterResults.push(rocOk
      ? `✅ ROC 5M ${roc.toFixed(2)}% searah bias${momentum5.message ? ` — ${momentum5.message}` : ''}`
      : `⚠️ ROC 5M (${roc.toFixed(2)}%) belum searah bias — gak wajib, tetep lanjut`);

    // 5. Volume spike (candle konfirmasi > MA(volume,20)) — DILONGGARIN jadi bonus scoring
    const volWindow5 = m5.volumes.slice(-21, -1);
    const avgVol5 = volWindow5.length > 0 ? volWindow5.reduce((a, b) => a + b, 0) / volWindow5.length : 0;
    const lastVol5 = m5.volumes[n5 - 1]!;
    const volRatio5 = avgVol5 > 0 ? lastVol5 / avgVol5 : 0;
    const volSpikeOk = volRatio5 > 1;
    filterResults.push(volSpikeOk
      ? `✅ Volume candle 5M spike (${(volRatio5 * 100).toFixed(0)}% dari MA20)`
      : `⚠️ Volume candle 5M cuma ${(volRatio5 * 100).toFixed(0)}% avg — belum spike, gak wajib, tetep lanjut`);

    // BTC Correlation — HARD FILTER, TAPI DILONGGARIN: kalau BTC lagi ranging
    // (netral, gak ada bias jelas), tetep lolos. Wajib searah CUMA kalau BTC
    // punya bias jelas (bullish/bearish) dan itu LAWAN arah — baru diblok.
    const btcCheck = await checkBtcAlignment(bias, symbol);
    if (btcCheck.btcBias !== 'ranging' && !btcCheck.aligned) {
      return { status: 'no_setup', symbol, bias, currentPrice, timestamp, message: `BTC lawan arah (${btcCheck.btcBias}) — wajib searah kalau BTC punya bias jelas`, maxScore, volume24h, atrPct, filterResults };
    }
    filterResults.push(`✅ ${btcCheck.message || `BTC ${btcCheck.btcBias === 'ranging' ? 'lagi ranging — netral, tetep lolos' : 'searah'}`}`);

    // ── Entry, SL, TP ──────────────────────────────────────────────────────
    const swingRef5 = bias === 'bullish' ? Math.min(...m5.lows.slice(-5)) : Math.max(...m5.highs.slice(-5));
    const atr5 = calcATR(m5.highs, m5.lows, m5.closes);
    const buffer = atr5 * 0.75; // tengah rentang 0.5-1x ATR(5m)
    const dir = bias === 'bullish' ? 1 : -1;
    const stopLoss = swingRef5 - buffer * dir;
    const entryPrice = currentPrice; // aggressive: market di close candle konfirmasi
    const risk = Math.abs(entryPrice - stopLoss);
    if (risk <= 0) {
      return { status: 'no_setup', symbol, bias, currentPrice, timestamp, message: 'Risk tidak valid', maxScore, volume24h, atrPct, filterResults };
    }
    // RR 1.8-3x: makin kuat konfluensi 15M (ada FVG jadi target tambahan) makin ke atas rentangnya
    const rr = fvg ? 3 : 1.8;
    const takeProfit1 = entryPrice + risk * rr * dir;

    // Confidence — INFORMASIONAL doang (semua syarat di atas udah WAJIB lolos semua)
    const confluenceFactors = [!!fvg, inOb, structAligned, obFresh, fractalOk, emaAligned, emaRibbonOk, rsiOk, rocOk, volRatio5 > 1.5, btcCheck.btcBias === 'ranging' || btcCheck.aligned, atrPct >= 0.3];
    const confidence = Math.round((confluenceFactors.filter(Boolean).length / confluenceFactors.length) * 100);

    const tfBreakdown: TFBreakdownItem[] = [
      { timeframe: '15M', label: 'Struktur + ZigZag + Fractal', detail: `${bias === 'bullish' ? 'Bullish' : 'Bearish'}, EMA200 konfirmasi`, status: 'confirm' },
      { timeframe: '15M', label: 'Order Block', detail: `Fresh: ${ob.low.toFixed(4)} - ${ob.high.toFixed(4)}`, status: 'confirm' },
      { timeframe: '15M', label: 'FVG', detail: fvg ? 'Belum keisi (RR ditingkatkan)' : 'Gak ada FVG fresh', status: fvg ? 'confirm' : 'neutral' },
      { timeframe: '5M', label: 'Retest + Rejection', detail: 'Micro-structure valid (HH/HL)', status: 'confirm' },
      { timeframe: '5M', label: 'EMA21/50 Ribbon', detail: 'Searah bias', status: 'confirm' },
      { timeframe: '5M', label: 'RSI(14)', detail: `${rsi5.toFixed(1)}`, status: 'confirm' },
      { timeframe: '5M', label: 'ROC + Volume', detail: `ROC ${roc.toFixed(2)}%, Volume ${(volRatio5 * 100).toFixed(0)}%`, status: 'confirm' },
      { timeframe: 'BTC', label: 'BTC Correlation', detail: btcCheck.message || 'Searah', status: 'confirm' },
    ];

    return {
      status: 'siap_entry', symbol, bias, currentPrice, timestamp,
      confidence, maxScore, volume24h, atrPct, entryType: 'aggressive',
      ob15M: { low: ob.low, high: ob.high, mid: ob.mid, fresh: true },
      fvg15M: fvg ? { low: fvg.low, high: fvg.high, mid: fvg.mid } : undefined,
      liquidityPoolLevel: liquidityLevel, rsi5M: rsi5,
      entryPrice, stopLoss, takeProfit1, rr1: rr,
      filterResults, tfBreakdown,
      message: `SIAP ENTRY — semua syarat wajib lolos, konfluensi bonus ${confluenceFactors.filter(Boolean).length}/${confluenceFactors.length}, RR 1:${rr}`,
    };
  } catch (err) {
    return {
      status: 'error', symbol, currentPrice: 0, timestamp,
      message: err instanceof Error ? err.message : 'Unknown error',
      maxScore: 100,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-TF TREND SCANNER — menu baru, SCAN-ONLY (gak ada tab Analisa manual,
// gak ada Log — ini dashboard informasi, bukan generator sinyal trading).
// Kriteria Scan: D1 ADX>=25 DAN H4 ADX>=25 (independen, gak perlu searah).
// Detail per koin: breakdown 6 TF (D1/H4/H1/M30/M15/M5) buat koin ITU SENDIRI
// + 6 TF yang SAMA buat BTC (selalu ada, gak conditional) — biar user bisa
// bandingin manual. Plus info tambahan per TF (opsional): zona S&R+Fib/OB
// terkuat, RSI divergence, Volume divergence — buat referensi entry manual,
// SENGAJA gak ada SL/TP otomatis.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Klasifikasi trend 1 timeframe — MULTI-KONFIRMASI biar gak salah baca struktur
 * (paling fatal kalau salah). ADX<25 = Sideways langsung (gak peduli sinyal
 * lain). ADX>=25: cek 3 sinyal independen (ZigZag, EMA50 vs EMA200+harga,
 * MACD histogram) — butuh MAYORITAS (>=2 dari 3) sepakat, kalau enggak ada
 * mayoritas jelas (bertentangan) → fallback ke Sideways (lebih aman daripada
 * maksa nebak arah yang gak jelas).
 */
interface TFClassification {
  bias: 'bullish' | 'bearish' | 'sideways';
  adx: number;
  confirmations: string[];
}

function classifyTFTrend(highs: number[], lows: number[], closes: number[]): TFClassification {
  const adx = calcADX(highs, lows, closes);
  if (adx < 25) {
    return { bias: 'sideways', adx, confirmations: [`ADX ${adx.toFixed(1)} < 25 — trend lemah/choppy`] };
  }

  const confirmations: string[] = [];
  let bullVotes = 0, bearVotes = 0;

  const zz = zigzagBias(highs, lows, 3);
  if (zz.bias === 'bullish') { bullVotes++; confirmations.push('✅ ZigZag: Bullish'); }
  else if (zz.bias === 'bearish') { bearVotes++; confirmations.push('✅ ZigZag: Bearish'); }
  else confirmations.push('⚠️ ZigZag: Ranging');

  const ema50Series = calcEMASeries(closes, 50);
  const ema200Series = calcEMASeries(closes, 200);
  const lastClose = closes[closes.length - 1]!;
  const ema50 = ema50Series[ema50Series.length - 1]!;
  const ema200 = ema200Series[ema200Series.length - 1]!;
  if (ema50 > ema200 && lastClose > ema50) { bullVotes++; confirmations.push('✅ EMA: Bullish (harga>EMA50>EMA200)'); }
  else if (ema50 < ema200 && lastClose < ema50) { bearVotes++; confirmations.push('✅ EMA: Bearish (harga<EMA50<EMA200)'); }
  else confirmations.push('⚠️ EMA: Gak searah jelas');

  const macd = calcMACD(closes);
  if (macd.histogram > 0) { bullVotes++; confirmations.push('✅ MACD: Histogram positif'); }
  else if (macd.histogram < 0) { bearVotes++; confirmations.push('✅ MACD: Histogram negatif'); }

  if (bullVotes >= 2) return { bias: 'bullish', adx, confirmations };
  if (bearVotes >= 2) return { bias: 'bearish', adx, confirmations };
  return { bias: 'sideways', adx, confirmations: [...confirmations, '⚠️ Sinyal saling bertentangan — fallback Sideways (aman)'] };
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

async function buildTFDetail(timeframe: TFDetail['timeframe'], interval: string, symbol: string): Promise<TFDetail> {
  const limit = timeframe === 'D1' ? 250 : 250; // semua 250, cukup buat EMA200 + ATR + swing
  const data = await fetchKlines(symbol, interval, limit);
  const classification = classifyTFTrend(data.highs, data.lows, data.closes);
  const zone = detectStrongestZonePerTF(data.opens, data.highs, data.lows, data.closes, classification.bias);
  const rsiDivergence = detectRSIDivergenceGeneric(data.highs, data.lows, data.closes);
  const volumeDivergence = detectVolumeDivergence(data.highs, data.lows, data.closes, data.volumes);
  return {
    timeframe, bias: classification.bias, adx: classification.adx, confirmations: classification.confirmations,
    zone: zone ?? undefined, rsiDivergence, volumeDivergence,
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
      fetchKlines(symbol, '1d', 250),
      fetchKlines(symbol, '4h', 250),
    ]);
    const d1Class = classifyTFTrend(d1.highs, d1.lows, d1.closes);
    const h4Class = classifyTFTrend(h4.highs, h4.lows, h4.closes);
    if (d1Class.adx < 25 || h4Class.adx < 25) return null;
    return { symbol, d1Bias: d1Class.bias, d1Adx: d1Class.adx, h4Bias: h4Class.bias, h4Adx: h4Class.adx };
  } catch {
    return null;
  }
}

/** Detail — breakdown 6 TF buat koin ITU SENDIRI + 6 TF buat BTC (selalu ada). */
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
  menu: 'sniper' | 'breakout' | 'scalping' | 'extreme_scalping' | 'breakout_entry';
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
  // Skor kekuatan sinyal (0-100) — pakai faktor yang sama kayak scoring live
  // (RSI Div/Pattern/Zona Tier/dst), TAPI cuma faktor yang emang udah dihitung
  // di backtest. BTC Correlation & Economic Calendar SENGAJA dikecualikan
  // (butuh fetch data historis terpisah, terlalu berat buat loop 1 tahun+).
  // Bukan 100% identik sama scoring live, tapi cukup buat liat pola korelasi
  // "makin kuat skornya, makin bagus win rate-nya apa engga".
  strengthScore: number;
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
    // Breakdown per level kekuatan sinyal (mirip High/Moderate/Low di live scan)
    strengthLow: { trades: number; wins: number; winRate: number };    // < 40%
    strengthModerate: { trades: number; wins: number; winRate: number }; // 40-70%
    strengthHigh: { trades: number; wins: number; winRate: number };   // > 70%
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
  extremeScalpingResult?: BacktestAnalysis & { trades: BacktestTrade[] };
  breakoutEntryResult?: BacktestAnalysis & { trades: BacktestTrade[] };
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
    strengthLow: trades.filter(t => t.strengthScore < 40),
    strengthModerate: trades.filter(t => t.strengthScore >= 40 && t.strengthScore <= 70),
    strengthHigh: trades.filter(t => t.strengthScore > 70),
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
    } else if (t.menu === 'extreme_scalping') {
      if (!t.hasChoch15M) {
        causeCounts['Bukan Reversal Setup (ikut trend biasa)'] = (causeCounts['Bukan Reversal Setup (ikut trend biasa)'] ?? 0) + 1;
      }
      if (!t.hasPattern) {
        causeCounts['Trigger M5 dari RSI Divergence (bukan pattern)'] = (causeCounts['Trigger M5 dari RSI Divergence (bukan pattern)'] ?? 0) + 1;
      }
      if (t.zoneTier > 2) {
        causeCounts['Entry di zona Tier 3+ (kualitas rendah)'] = (causeCounts['Entry di zona Tier 3+ (kualitas rendah)'] ?? 0) + 1;
      }
    } else if (t.menu === 'breakout_entry') {
      if (!t.hasChoch15M) {
        causeCounts['Breakout tipe Reversal (bukan Continuation)'] = (causeCounts['Breakout tipe Reversal (bukan Continuation)'] ?? 0) + 1;
      }
      if (t.volumeRatio !== undefined && t.volumeRatio < 2) {
        causeCounts['Volume breakout rendah (< 2x rata-rata)'] = (causeCounts['Volume breakout rendah (< 2x rata-rata)'] ?? 0) + 1;
      }
    } else {
      if (!t.hasChoch15M) {
        causeCounts['RSI Divergence H1 tidak terkonfirmasi'] = (causeCounts['RSI Divergence H1 tidak terkonfirmasi'] ?? 0) + 1;
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
  status: 'siap_breakout' | 'siap_retest' | 'no_setup' | 'error';
  symbol: string;
  bias?: 'bullish' | 'bearish';
  mode?: 'confidence' | 'crossover'; // skill yang dipakai buat hasilin sinyal ini
  recommendedMode?: 'confidence' | 'crossover'; // rekomendasi classifier (independen dari mode yang dipilih)
  recentPerformance?: RecentPerformance; // mini-backtest instan, cuma diisi di endpoint single-symbol
  tfBreakdown?: TFBreakdownItem[]; // breakdown faktor (beda isi tergantung mode)
  currentPrice: number;
  timestamp: string;
  message?: string;
  confidenceScore?: number; // 0-100, khusus mode 'confidence'
  confidenceTier?: 'high' | 'medium'; // khusus mode 'confidence'
  score?: number; // integer, khusus mode 'crossover'
  maxScore: number; // 100 (confidence) atau 8 (crossover)
  brokenLevel?: number; // level S&R yang jadi acuan
  levelHits?: number; // berapa kali level itu disentuh sebelumnya (khusus mode 'confidence')
  entryPrice?: number; // harga buat pasang order (STOP kalau siap_breakout, LIMIT kalau siap_retest)
  orderType?: 'stop' | 'limit';
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number; // khusus mode 'crossover' (R:R 1:3)
  rr1?: number;
  volumeRatio?: number;
  filterResults?: string[];
  // Bonus konfirmasi khusus mode 'crossover'
  adxRising?: boolean;
  macdHistogramExpanding?: boolean;
  vwapBreakout?: boolean;
  momentumClassification?: 'very_fast' | 'fast' | 'normal' | 'slow';
}

/**
 * Menu 1 v4 — Weighted Confidence Score. Beda total dari versi sebelumnya (hard
 * filter pass/fail): sekarang SEMUA faktor (volume, trend, RSI, MACD, ATR
 * expansion, hits count) nyumbang proporsional ke 1 angka confidence 0-100,
 * bukan bikin sinyal ke-skip total kalau 1 faktor gagal. Ini nyelesain masalah
 * "kelewat ketat" vs "kelewat longgar" yang bolak-balik kejadian di versi lama.
 */

interface ClusteredSRLevel {
  price: number;
  hits: number;
  type: 'resistance' | 'support';
}

/**
 * Deteksi level S/R dari swing high/low, di-cluster (level yang jaraknya <0.3%
 * digabung jadi 1) biar gak ada level "kembar" yang keitung terpisah. Cuma level
 * dengan minimal 2 hits yang dianggap valid.
 */
function detectClusteredSRLevels(highs: number[], lows: number[], lookback = 100): ClusteredSRLevel[] {
  const h = highs.slice(-lookback);
  const l = lows.slice(-lookback);
  // BUG FIX: parameter kedua findSwingHighs/Lows itu artinya "ambil N TITIK SWING
  // TERAKHIR", BUKAN "cari dalam N candle". Sebelumnya cuma 5 — dengan cuma 5 titik
  // buat di-cluster, statistically HAMPIR MUSTAHIL nemuin 2 yang jaraknya <0.3%
  // (butuh minimal hits=2 biar level dianggap valid). Naikin ke 30 biar clustering
  // punya cukup data points buat genuinely nemuin level yang emang sering disentuh.
  const swingH = findSwingHighs(h, 30);
  const swingL = findSwingLows(l, 30);

  const cluster = (levels: number[]): { price: number; hits: number }[] => {
    if (levels.length === 0) return [];
    const sorted = [...levels].sort((a, b) => a - b);
    const clusters: number[][] = [[sorted[0]!]];
    for (let i = 1; i < sorted.length; i++) {
      const last = clusters[clusters.length - 1]!;
      const avgLast = last.reduce((a, b) => a + b, 0) / last.length;
      // Radius clustering dilonggarin dari 0.3% ke 0.5% — 0.3% kelewat sempit,
      // ditambah cuma 5 titik (bug di atas) bikin scan hampir selalu kosong
      if (Math.abs(sorted[i]! - avgLast) / avgLast <= 0.005) {
        last.push(sorted[i]!);
      } else {
        clusters.push([sorted[i]!]);
      }
    }
    return clusters.map(c => ({ price: c.reduce((a, b) => a + b, 0) / c.length, hits: c.length }));
  };

  const resLevels: ClusteredSRLevel[] = cluster(swingH)
    .filter(c => c.hits >= 2)
    .map(c => ({ price: c.price, hits: c.hits, type: 'resistance' as const }));
  const supLevels: ClusteredSRLevel[] = cluster(swingL)
    .filter(c => c.hits >= 2)
    .map(c => ({ price: c.price, hits: c.hits, type: 'support' as const }));

  return [...resLevels, ...supLevels];
}

interface ConfidenceFactor {
  name: string;
  contribution: number;
  maxContribution: number;
  detail: string;
}

interface ConfidenceResult {
  score: number; // 0-100
  factors: ConfidenceFactor[];
}

/**
 * Weighted confidence score — 6 faktor:
 * Volume 30% | Trend MA50/200 20% | RSI(14) 15% | MACD 15% | ATR Expansion 10% | Hits Count 10%
 */
function calcBreakoutConfidenceScore(
  bias: 'bullish' | 'bearish',
  volumeRatio: number,
  ma50: number, ma200: number,
  rsi: number,
  macdHistogram: number,
  atrNow: number, atrPrev: number,
  hits: number,
  btcAligned: boolean, btcBias: 'bullish' | 'bearish' | 'ranging'
): ConfidenceResult {
  const factors: ConfidenceFactor[] = [];
  let total = 0;

  // Volume — 25% (dikurangin dari 30, kasih ruang buat BTC Correlation)
  const volScore = Math.min(25, (volumeRatio / 1.5) * 25);
  total += volScore;
  factors.push({ name: 'Volume', contribution: Math.round(volScore), maxContribution: 25, detail: `${(volumeRatio * 100).toFixed(0)}% dari rata-rata` });

  // Trend MA50/200 — 20%
  const trendAligned = bias === 'bullish' ? ma50 > ma200 : ma50 < ma200;
  const trendScore = trendAligned ? 20 : 0;
  total += trendScore;
  factors.push({ name: 'Trend MA50/200', contribution: trendScore, maxContribution: 20, detail: trendAligned ? 'Searah bias' : 'Lawan arah bias' });

  // RSI(14) — 15%
  let rsiScore = 0;
  let rsiDetail = '';
  if (bias === 'bullish') {
    if (rsi > 50 && rsi < 70) { rsiScore = 15; rsiDetail = 'Momentum bullish sehat'; }
    else if (rsi >= 70) { rsiScore = 7; rsiDetail = 'Overbought, momentum masih ada tapi beresiko'; }
    else { rsiDetail = 'Belum mendukung bullish'; }
  } else {
    if (rsi < 50 && rsi > 30) { rsiScore = 15; rsiDetail = 'Momentum bearish sehat'; }
    else if (rsi <= 30) { rsiScore = 7; rsiDetail = 'Oversold, momentum masih ada tapi beresiko'; }
    else { rsiDetail = 'Belum mendukung bearish'; }
  }
  total += rsiScore;
  factors.push({ name: 'RSI(14)', contribution: rsiScore, maxContribution: 15, detail: `${rsi.toFixed(1)} — ${rsiDetail}` });

  // MACD Histogram — 15%
  const macdAligned = bias === 'bullish' ? macdHistogram > 0 : macdHistogram < 0;
  const macdScore = macdAligned ? 15 : 0;
  total += macdScore;
  factors.push({ name: 'MACD Histogram', contribution: macdScore, maxContribution: 15, detail: macdAligned ? 'Searah bias' : 'Lawan arah bias' });

  // ATR Expansion — 10%
  const atrExpanding = atrNow > atrPrev;
  const atrScore = atrExpanding ? 10 : 0;
  total += atrScore;
  factors.push({ name: 'ATR Expansion', contribution: atrScore, maxContribution: 10, detail: atrExpanding ? 'Volatilitas ekspansi' : 'Volatilitas normal/menyempit' });

  // Hits Count — 5% (dikurangin dari 10, kasih ruang buat BTC Correlation)
  const hitsScore = Math.min(5, (hits / 5) * 5);
  total += hitsScore;
  factors.push({ name: 'Hits Count', contribution: Math.round(hitsScore), maxContribution: 5, detail: `Level disentuh ${hits}x sebelumnya` });

  // BTC Correlation — 10% (baru). Aligned & searah = full, ranging = netral (gak ada
  // sinyal jelas dari BTC, kasih separuh), lawan arah BTC = 0.
  let btcScore = 0;
  let btcDetail = '';
  if (btcBias === 'ranging') {
    btcScore = 5;
    btcDetail = 'BTC lagi ranging — gak ada sinyal jelas, netral';
  } else if (btcAligned) {
    btcScore = 10;
    btcDetail = `Searah BTC (${btcBias})`;
  } else {
    btcDetail = `Lawan arah BTC (${btcBias}) — waspada`;
  }
  total += btcScore;
  factors.push({ name: 'BTC Correlation', contribution: btcScore, maxContribution: 10, detail: btcDetail });

  return { score: Math.round(total), factors };
}

export async function analyzeBreakoutTrading(symbol: string): Promise<BreakoutTradingResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';
  const maxScore = 100; // skala confidence score

  try {
    const [m30, tickerRes] = await Promise.all([
      fetchKlines(symbol, '30m', 250),
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);
    const currentPrice = tickerRes.ok
      ? parseFloat((await tickerRes.json() as { price: string }).price)
      : m30.closes[m30.closes.length - 1]!;

    // ── Deteksi level S/R (clustered + hits count) ────────────────────────
    const srLevels = detectClusteredSRLevels(m30.highs, m30.lows, 100);
    if (srLevels.length === 0) {
      return { status: 'no_setup', symbol, currentPrice, timestamp, message: 'Gak ada level S/R yang valid (minimal 2x hits)', maxScore };
    }

    // ── Bias dari trend MA50/200, cari level relevan terdekat ─────────────
    const ma50 = calcSMA(m30.closes, 50);
    const ma200 = calcSMA(m30.closes, 200);
    const bias: 'bullish' | 'bearish' = ma50 > ma200 ? 'bullish' : 'bearish';

    const relevantType = bias === 'bullish' ? 'resistance' : 'support';
    let relevantLevels = srLevels.filter(l => l.type === relevantType);
    if (relevantLevels.length === 0) relevantLevels = srLevels; // fallback kalau gak ada tipe yang cocok

    const nearest = relevantLevels.reduce((closest, l) =>
      Math.abs(l.price - currentPrice) < Math.abs(closest.price - currentPrice) ? l : closest
    );
    const level = nearest.price;
    const hits = nearest.hits;

    // ── Hitung semua faktor confidence score ──────────────────────────────
    const atr = calcATR(m30.highs, m30.lows, m30.closes);
    const atrPrevSlice = m30.highs.length > 20
      ? calcATR(m30.highs.slice(0, -10), m30.lows.slice(0, -10), m30.closes.slice(0, -10))
      : atr;
    const rsi = calcRSI(m30.closes, 14);
    const macdResult = calcMACD(m30.closes);

    const volWindow = m30.volumes.slice(-21, -1);
    const avgVol = volWindow.length > 0 ? volWindow.reduce((a, b) => a + b, 0) / volWindow.length : 0;
    const lastVol = m30.volumes[m30.volumes.length - 1]!;
    const volumeRatio = avgVol > 0 ? lastVol / avgVol : 0;

    const btcCheck = await checkBtcAlignment(bias, symbol);
    const confidence = calcBreakoutConfidenceScore(bias, volumeRatio, ma50, ma200, rsi, macdResult.histogram, atr, atrPrevSlice, hits, btcCheck.aligned, btcCheck.btcBias);

    if (confidence.score < 50) {
      return {
        status: 'no_setup', symbol, currentPrice, timestamp, bias,
        confidenceScore: confidence.score, maxScore,
        message: `Confidence score cuma ${confidence.score}/100 — di bawah threshold minimal 50`,
      };
    }
    const confidenceTier: 'high' | 'medium' = confidence.score >= 70 ? 'high' : 'medium';

    // ── Proximity & status: SIAP BREAKOUT (stop) vs SIAP RETEST (limit) ───
    const proximityPct = (Math.abs(currentPrice - level) / level) * 100;
    const alreadyBroken = bias === 'bullish' ? currentPrice > level : currentPrice < level;
    const bufferATR = atr * 0.3; // buffer stop order
    const retestBufferATR = atr * 0.5; // radius zona retest

    let status: 'siap_breakout' | 'siap_retest';
    let orderType: 'stop' | 'limit';
    let entryPrice: number;

    if (!alreadyBroken) {
      // Belum breakout — proximity tetep wajib, tapi confidence Medium TETEP MUNCUL
      // (cuma beda pesan/label, bukan disembunyikan total). Sesuai spec asli: Medium =
      // "tunggu konfirmasi candle close + volume", BUKAN "hilang dari hasil".
      if (proximityPct > 1) {
        return {
          status: 'no_setup', symbol, currentPrice, timestamp, bias,
          confidenceScore: confidence.score, maxScore,
          message: `Harga masih ${proximityPct.toFixed(2)}% dari level ${level.toFixed(4)} — di luar radius proximity (1%)`,
        };
      }
      status = 'siap_breakout';
      orderType = 'stop';
      entryPrice = bias === 'bullish' ? level + bufferATR : level - bufferATR;
    } else {
      // Udah breakout — cek harga balik ke zona retest (confidence Medium udah cukup di sini)
      const distFromLevel = Math.abs(currentPrice - level);
      if (distFromLevel > retestBufferATR) {
        return {
          status: 'no_setup', symbol, currentPrice, timestamp, bias,
          confidenceScore: confidence.score, maxScore, brokenLevel: level, levelHits: hits,
          message: 'Breakout udah terjadi tapi harga udah jauh dari zona retest',
        };
      }
      status = 'siap_retest';
      orderType = 'limit';
      entryPrice = level;
    }

    // ── SL/TP ──────────────────────────────────────────────────────────────
    // FIX: sebelumnya SL = min(1xATR, jarak-ke-level x 0.6) — tapi buat status
    // SIAP RETEST (limit order), entryPrice = level PERSIS, jadi "jarak ke level"
    // SELALU 0, bikin SL cuma 6% dari ATR (jauh di bawah floor 1x ATR standar di
    // SEMUA menu lain). Disederhanain: floor 1x ATR konsisten, gak peduli status.
    const riskDistance = atr;
    const dir = bias === 'bullish' ? 1 : -1;
    const stopLoss = entryPrice - riskDistance * dir;
    const takeProfit1 = entryPrice + riskDistance * 1.8 * dir; // TP = SL x 1.8 sesuai spec

    const orderLabel = bias === 'bullish' ? (orderType === 'stop' ? 'BUY STOP' : 'BUY LIMIT') : (orderType === 'stop' ? 'SELL STOP' : 'SELL LIMIT');
    const tierLabel = confidenceTier === 'high' ? 'High' : 'Medium';
    const mediumCaveat = confidenceTier === 'medium' ? ' — pertimbangkan tunggu konfirmasi candle close + volume tambahan dulu sebelum eksekusi.' : '';
    const statusMsg = status === 'siap_retest'
      ? `SIAP RETEST — breakout dari ${level.toFixed(4)} udah terjadi, harga balik ke zona retest. Pasang ${orderLabel}. Confidence ${confidence.score}/100 (${tierLabel}).${mediumCaveat}`
      : `SIAP BREAKOUT — harga deket level ${level.toFixed(4)}, confidence ${confidence.score}/100 (${tierLabel}). Pasang ${orderLabel} buat nangkep breakout otomatis.${mediumCaveat}`;

    const filterResults = confidence.factors.map(f => `${f.contribution > 0 ? '✅' : '⚠️'} ${f.name}: ${f.detail} (+${f.contribution}/${f.maxContribution})`);

    const tfBreakdown: TFBreakdownItem[] = confidence.factors.map(f => ({
      timeframe: 'M30',
      label: f.name,
      detail: `${f.detail} (+${f.contribution}/${f.maxContribution})`,
      status: f.contribution >= f.maxContribution * 0.7 ? 'confirm' : f.contribution > 0 ? 'neutral' : 'warning',
    }));

    return {
      status, symbol, bias, mode: 'confidence', currentPrice, timestamp,
      confidenceScore: confidence.score, confidenceTier, maxScore,
      brokenLevel: level, levelHits: hits,
      entryPrice, orderType, stopLoss, takeProfit1, rr1: 1.8,
      volumeRatio, filterResults, tfBreakdown,
      message: statusMsg,
    };
  } catch (err) {
    return {
      status: 'error', symbol, currentPrice: 0, timestamp,
      message: err instanceof Error ? err.message : 'Unknown error',
      maxScore: 100,
    };
  }
}

// ─── Breakout Mode Classifier (Confidence Score vs Crossover) ──────────────
// Classifier MURAH — cuma ADX H1, gak jalanin analisa penuh dua-duanya.
export interface BreakoutModeClassification {
  recommendedMode: 'confidence' | 'crossover';
  adx: number;
  reason: string;
}

export function classifyBreakoutMode(highs: number[], lows: number[], closes: number[], volumes?: number[]): BreakoutModeClassification {
  // FIX v2: classifier lama pake ADX (buat syarat "H1 akumulasi" yang sekarang
  // UDAH GAK ADA di Crossover v2 — basisnya beda total: fresh breakout candle
  // + stop order anticipation, bukan nunggu harga deket SMA200). Sekarang cek
  // volume spike candle M30 terakhir — kalau lagi tinggi, itu indikasi breakout
  // BARU AJA kejadian, cocok buat Crossover (yang emang didesain nangkep momen
  // breakout candle spesifik). Kalau volume normal, lebih cocok Confidence Score
  // (yang lebih fleksibel, mantau zona secara umum tanpa butuh breakout fresh).
  if (!volumes || volumes.length < 21) {
    return { recommendedMode: 'confidence', adx: 0, reason: 'Data volume gak cukup buat classifier' };
  }
  const volWindow = volumes.slice(-21, -1);
  const avgVol = volWindow.length > 0 ? volWindow.reduce((a, b) => a + b, 0) / volWindow.length : 0;
  const lastVol = volumes[volumes.length - 1]!;
  const volRatio = avgVol > 0 ? lastVol / avgVol : 0;
  if (volRatio >= 1.4) {
    return { recommendedMode: 'crossover', adx: volRatio * 25, reason: `Volume M30 candle terakhir lagi tinggi (${(volRatio * 100).toFixed(0)}% avg) — indikasi breakout baru, cocok Crossover` };
  }
  return { recommendedMode: 'confidence', adx: volRatio * 25, reason: `Volume M30 normal (${(volRatio * 100).toFixed(0)}% avg) — gak ada breakout fresh, lebih cocok Confidence Score` };
}

interface CrossoverConfidenceFactor {
  name: string;
  contribution: number;
  maxContribution: number;
  detail: string;
}
interface CrossoverConfidenceResult {
  score: number;
  factors: CrossoverConfidenceFactor[];
}

/**
 * Weighted confidence score Crossover v2 — 6 faktor:
 * Volume 30% | Trend MA50 20% | ATR Expansion 15% | Hits Count 15% |
 * Candle Close Strength 10% | BTC Correlation 10%
 * (bobot asli dari spec: Volume 35/Trend 20/ATR 15/Hits 15/Close 15 — Volume
 * & Close Strength dikurangin dikit buat kasih ruang BTC Correlation 10%,
 * konsisten sama aturan "tiap menu analisa wajib BTC Correlation")
 */
function calcCrossoverConfidenceScore(
  volumeRatio: number,
  trendAligned: boolean,
  atrExpanding: boolean,
  hits: number,
  closeStrength: number,
  btcAligned: boolean, btcBias: 'bullish' | 'bearish' | 'ranging'
): CrossoverConfidenceResult {
  const factors: CrossoverConfidenceFactor[] = [];
  let total = 0;

  const volScore = Math.min(30, (volumeRatio / 1.4) * 30);
  total += volScore;
  factors.push({ name: 'Volume', contribution: Math.round(volScore), maxContribution: 30, detail: `${(volumeRatio * 100).toFixed(0)}% dari rata-rata` });

  const trendScore = trendAligned ? 20 : 0;
  total += trendScore;
  factors.push({ name: 'Trend MA50', contribution: trendScore, maxContribution: 20, detail: trendAligned ? 'Searah breakout' : 'Lawan arah breakout' });

  const atrScore = atrExpanding ? 15 : 0;
  total += atrScore;
  factors.push({ name: 'ATR Expansion', contribution: atrScore, maxContribution: 15, detail: atrExpanding ? 'Volatilitas naik' : 'Normal/menyempit' });

  const hitsScore = Math.min(15, (hits / 5) * 15);
  total += hitsScore;
  factors.push({ name: 'Hits Count', contribution: Math.round(hitsScore), maxContribution: 15, detail: `Zona disentuh ${hits}x sebelumnya` });

  const closeScore = Math.min(10, closeStrength * 10);
  total += closeScore;
  factors.push({ name: 'Candle Close Strength', contribution: Math.round(closeScore), maxContribution: 10, detail: `${(closeStrength * 100).toFixed(0)}% dari lebar zona` });

  let btcScore = 0;
  let btcDetail = '';
  if (btcBias === 'ranging') {
    btcScore = 5;
    btcDetail = 'BTC lagi ranging — netral';
  } else if (btcAligned) {
    btcScore = 10;
    btcDetail = `Searah BTC (${btcBias})`;
  } else {
    btcDetail = `Lawan arah BTC (${btcBias}) — waspada`;
  }
  total += btcScore;
  factors.push({ name: 'BTC Correlation', contribution: btcScore, maxContribution: 10, detail: btcDetail });

  return { score: Math.round(total), factors };
}

/**
 * Skill "Breakout Crossover" v2 — REWRITE TOTAL, ganti basis dari multi-TF SMA
 * (H1 akumulasi -> M30 momentum -> M15 breakout) jadi single-TF M30 S/R zone +
 * weighted confidence score, murni fokus nangkep BREAKOUT CANDLE TERBARU dan
 * pasang STOP ORDER anticipation (bukan retest-based kayak dulu). Orderbook
 * health check & order management (expiry/partial TP) SENGAJA di-skip — sama
 * alasan kayak Scalping 15M (orderbook basi buat sistem scan periodik, app ini
 * screener bukan bot eksekusi).
 */
export async function analyzeBreakoutCrossover(symbol: string): Promise<BreakoutTradingResult> {
  const timestamp = new Date().toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: 'long', year: 'numeric',
  }) + ' WIB';
  const maxScore = 100;

  try {
    const [m30, tickerRes] = await Promise.all([
      fetchKlines(symbol, '30m', 250),
      fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);
    const currentPrice = tickerRes.ok
      ? parseFloat((await tickerRes.json() as { price: string }).price)
      : m30.closes[m30.closes.length - 1]!;

    const n30 = m30.closes.length;
    if (n30 < 60) {
      return { status: 'no_setup', symbol, currentPrice, timestamp, mode: 'crossover', message: 'Data M30 gak cukup', maxScore };
    }

    const atr30 = calcATR(m30.highs, m30.lows, m30.closes);
    const zoneWidth = atr30 * 0.35;
    const clusterDist = atr30 * 0.6;

    // Lookback 200 candle (dalam rentang spec 120-240), ambil BANYAK titik swing
    // (30, bukan dikit) biar clustering genuinely nemuin zona valid — pelajaran
    // dari bug clustering Menu 1 sebelumnya.
    const lookback = Math.min(200, n30);
    const h = m30.highs.slice(-lookback);
    const l = m30.lows.slice(-lookback);
    const swingH = findSwingHighs(h, 30);
    const swingL = findSwingLows(l, 30);

    const clusterLevels = (levels: number[]): { price: number; hits: number }[] => {
      if (levels.length === 0) return [];
      const sorted = [...levels].sort((a, b) => a - b);
      const clusters: number[][] = [[sorted[0]!]];
      for (let i = 1; i < sorted.length; i++) {
        const last = clusters[clusters.length - 1]!;
        const avgLast = last.reduce((a, b) => a + b, 0) / last.length;
        if (Math.abs(sorted[i]! - avgLast) <= clusterDist) last.push(sorted[i]!);
        else clusters.push([sorted[i]!]);
      }
      return clusters.map(c => ({ price: c.reduce((a, b) => a + b, 0) / c.length, hits: c.length }));
    };
    const resistanceLevels = clusterLevels(swingH);
    const supportLevels = clusterLevels(swingL);

    if (resistanceLevels.length === 0 && supportLevels.length === 0) {
      return { status: 'no_setup', symbol, currentPrice, timestamp, mode: 'crossover', message: 'Gak ada zona S/R yang valid buat dianalisa', maxScore };
    }

    // ── Cari breakout di CANDLE TERAKHIR doang (fokus momen fresh, bukan histori) ──
    const lastClose = m30.closes[n30 - 1]!;
    const lastVol = m30.volumes[n30 - 1]!;
    const volWindow = m30.volumes.slice(-21, -1);
    const avgVol = volWindow.length > 0 ? volWindow.reduce((a, b) => a + b, 0) / volWindow.length : 0;
    const volumeRatio = avgVol > 0 ? lastVol / avgVol : 0;

    let breakout: { direction: 'bullish' | 'bearish'; level: number; hits: number; edgeUpper: number; edgeLower: number } | null = null;
    for (const lvl of resistanceLevels) {
      const edgeUpper = lvl.price + zoneWidth / 2;
      const edgeLower = lvl.price - zoneWidth / 2;
      if (lastClose > edgeUpper) breakout = { direction: 'bullish', level: lvl.price, hits: lvl.hits, edgeUpper, edgeLower };
    }
    for (const lvl of supportLevels) {
      const edgeUpper = lvl.price + zoneWidth / 2;
      const edgeLower = lvl.price - zoneWidth / 2;
      if (lastClose < edgeLower) breakout = { direction: 'bearish', level: lvl.price, hits: lvl.hits, edgeUpper, edgeLower };
    }

    if (!breakout) {
      return { status: 'no_setup', symbol, currentPrice, timestamp, mode: 'crossover', message: 'Belum ada candle M30 terakhir yang close di luar zona S/R', maxScore };
    }
    const bias = breakout.direction;

    if (volumeRatio < 1.4) {
      return {
        status: 'no_setup', symbol, bias, currentPrice, timestamp, mode: 'crossover',
        message: `Volume breakout cuma ${(volumeRatio * 100).toFixed(0)}% dari rata-rata — kurang dari 140%`,
        maxScore,
      };
    }

    const ma50 = calcSMA(m30.closes, 50);
    const trendAligned = bias === 'bullish' ? lastClose > ma50 : lastClose < ma50;

    const atrPrev = n30 > 30 ? calcATR(m30.highs.slice(0, -15), m30.lows.slice(0, -15), m30.closes.slice(0, -15)) : atr30;
    const atrExpanding = atr30 > atrPrev;

    const closeStrength = bias === 'bullish'
      ? Math.max(0, (lastClose - breakout.edgeUpper) / zoneWidth)
      : Math.max(0, (breakout.edgeLower - lastClose) / zoneWidth);

    const btcCheck = await checkBtcAlignment(bias, symbol);
    const confidence = calcCrossoverConfidenceScore(volumeRatio, trendAligned, atrExpanding, breakout.hits, closeStrength, btcCheck.aligned, btcCheck.btcBias);

    if (confidence.score < 50) {
      return {
        status: 'no_setup', symbol, bias, currentPrice, timestamp, mode: 'crossover',
        confidenceScore: confidence.score, maxScore,
        message: `Confidence score cuma ${confidence.score}/100 — di bawah threshold minimal 50`,
      };
    }
    const confidenceTier: 'high' | 'medium' = confidence.score >= 70 ? 'high' : 'medium';

    // ── Entry (STOP ORDER), SL, TP ────────────────────────────────────────
    const buffer = Math.max(atr30 * 0.25, currentPrice * 0.0008);
    const entryPrice = bias === 'bullish' ? breakout.edgeUpper + buffer : breakout.edgeLower - buffer;
    const slBuffer = atr30 * 0.8;
    const stopLoss = bias === 'bullish' ? breakout.edgeLower - slBuffer : breakout.edgeUpper + slBuffer;
    const risk = Math.abs(entryPrice - stopLoss);
    if (risk <= 0) {
      return { status: 'no_setup', symbol, bias, currentPrice, timestamp, mode: 'crossover', message: 'Risk tidak valid', maxScore };
    }
    const dir = bias === 'bullish' ? 1 : -1;
    const takeProfit1 = entryPrice + risk * 2 * dir; // R:R 1:2 sesuai spec

    const orderLabel = bias === 'bullish' ? 'BUY STOP' : 'SELL STOP';
    const tierMsg = confidenceTier === 'high'
      ? `Confidence High (${confidence.score}/100) — siap pasang stop order sekarang`
      : `Confidence Medium (${confidence.score}/100) — pertimbangkan tunggu 1 candle M30 konfirmasi tambahan dulu`;
    const statusMsg = `SIAP BREAKOUT — candle M30 close ${bias === 'bullish' ? 'bullish' : 'bearish'} dari zona ${breakout.level.toFixed(4)}, volume ${(volumeRatio * 100).toFixed(0)}%. Pasang ${orderLabel}. ${tierMsg}`;

    const filterResults = confidence.factors.map(f => `${f.contribution > 0 ? '✅' : '⚠️'} ${f.name}: ${f.detail} (+${f.contribution}/${f.maxContribution})`);
    const tfBreakdown: TFBreakdownItem[] = confidence.factors.map(f => ({
      timeframe: 'M30', label: f.name, detail: `${f.detail} (+${f.contribution}/${f.maxContribution})`,
      status: f.contribution >= f.maxContribution * 0.7 ? 'confirm' : f.contribution > 0 ? 'neutral' : 'warning',
    }));

    return {
      status: 'siap_breakout', symbol, bias, mode: 'crossover', currentPrice, timestamp,
      confidenceScore: confidence.score, confidenceTier, maxScore,
      brokenLevel: breakout.level, levelHits: breakout.hits,
      entryPrice, orderType: 'stop', stopLoss, takeProfit1, rr1: 2,
      volumeRatio, filterResults, tfBreakdown,
      message: statusMsg,
    };
  } catch (err) {
    return {
      status: 'error', symbol, currentPrice: 0, timestamp, mode: 'crossover',
      message: err instanceof Error ? err.message : 'Unknown error',
      maxScore: 100,
    };
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
  menu: 'sniper' | 'breakout' | 'scalping' | 'extreme_scalping' | 'breakout_entry' | 'both',
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
  // H2 cuma di-fetch kalau emang dibutuhin (Breakout Entry) — biar gak nambah beban
  // request buat backtest Sniper/Scalping/Extreme yang gak butuh data ini sama sekali.
  const h2Data = (menu === 'breakout_entry' || menu === 'both')
    ? await fetchHistorical('2h', Math.ceil(limit / 2))
    : null;

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

      // Kondisi konfirmasi — RSI Divergence H1 (ganti CHoCH15M+Rejection15M, samain sama live logic)
      const rsiSeriesH1bt = calcRSISeries(h1Slice.closes);
      const swingHighsH1bt = findSwingPointsIdx(h1Slice.highs, 'high', 2);
      const swingLowsH1bt = findSwingPointsIdx(h1Slice.lows, 'low', 2);
      let rsiDivergenceH1bt = false;
      if (bias === 'bullish' && swingLowsH1bt.length >= 2) {
        const l1 = swingLowsH1bt[swingLowsH1bt.length - 2]!;
        const l2 = swingLowsH1bt[swingLowsH1bt.length - 1]!;
        const priceLL = l2.value < l1.value;
        const rsiAtL1 = rsiSeriesH1bt[l1.idx] ?? 50;
        const rsiAtL2 = rsiSeriesH1bt[l2.idx] ?? 50;
        rsiDivergenceH1bt = priceLL && rsiAtL2 > rsiAtL1 + 2 && rsiAtL2 < 45;
      } else if (bias === 'bearish' && swingHighsH1bt.length >= 2) {
        const h1s = swingHighsH1bt[swingHighsH1bt.length - 2]!;
        const h2s = swingHighsH1bt[swingHighsH1bt.length - 1]!;
        const priceHH = h2s.value > h1s.value;
        const rsiAtH1 = rsiSeriesH1bt[h1s.idx] ?? 50;
        const rsiAtH2 = rsiSeriesH1bt[h2s.idx] ?? 50;
        rsiDivergenceH1bt = priceHH && rsiAtH2 < rsiAtH1 - 2 && rsiAtH2 > 55;
      }

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
      const entryPrice = selectedZone.entryPrice;
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

      // Strength score (0-100) — cuma pakai faktor yang udah dihitung di backtest ini.
      // BTC Correlation, Economic Calendar, Dow Phase, Premium/Discount, H4 Confluence
      // SENGAJA dikecualikan (butuh data/komputasi tambahan yang berat buat loop panjang).
      const strengthScore =
        (rsiDivergenceH1bt ? 45 : 0) +
        (hasPattern ? 35 : 0) +
        (selectedZone.tier <= 2 ? 20 : 0);

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
        // CATATAN: field ini namanya masih "choch15M"/"rejection15M" (nama lama) tapi ISI-nya
        // sekarang RSI Divergence H1 — sengaja gak di-rename biar gak breaking change ke tipe
        // BacktestTrade, breakdown stats, openapi.yaml, dan UI mobile (semua rujuk nama ini).
        // Kalau mau di-rename proper jadi "hasRsiDivergenceH1" ke depannya, itu kerjaan terpisah
        // yang nyentuh banyak file sekaligus.
        hasChoch15M: rsiDivergenceH1bt,
        hasRejection15M: rsiDivergenceH1bt,
        hasPattern,
        strengthScore,
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

      // Strength score (0-100) — pakai faktor bonus yang udah dihitung di backtest ini.
      const strengthScoreScalp =
        (bbSqueeze.isSqueezing ? 30 : 0) +
        (ema34Confirm ? 25 : 0) +
        (bestZone.tier <= 2 ? 25 : 0) +
        (m30Correction ? 20 : 0);

      scalpingTrades.push({
        menu: 'scalping', entryTime, entryPrice, stopLoss, takeProfit1, takeProfit2, bias,
        result: sim.result, exitPrice: sim.exitPrice, rr: sim.rr,
        hasChoch15M: true, hasRejection15M: true, // tidak dipakai di alur baru, default true biar gak keitung "gagal"
        hasPattern: pats30.length > 0,
        strengthScore: strengthScoreScalp,
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

  // ─── BACKTEST EXTREME SCALPING (H1 → M15, approx M5 pakai 38.2% retracement — ──
  // fetch M5 historis full-period gak praktis, sama kayak pendekatan Scalping) ──
  if (menu === 'extreme_scalping' || menu === 'both') {
    const extremeTrades: BacktestTrade[] = [];
    const h1Total = h1Data.closes.length;
    const MIN_H1 = 60;
    const STEP_EXT = 2; // cek tiap 2 jam

    for (let i = MIN_H1; i < h1Total - 10; i += STEP_EXT) {
      const h1h = h1Data.highs.slice(0, i);
      const h1l = h1Data.lows.slice(0, i);
      const h1c = h1Data.closes.slice(0, i);
      const currentPrice = h1c[h1c.length - 1]!;

      // M15 slice ekuivalen (1 candle H1 = 4 candle M15)
      const m15Idx = i * 4;
      if (m15Idx < 40 || m15Idx >= m15Data.closes.length) continue;
      const h15 = m15Data.highs.slice(0, m15Idx);
      const l15 = m15Data.lows.slice(0, m15Idx);
      const c15 = m15Data.closes.slice(0, m15Idx);
      const o15 = m15Data.opens.slice(0, m15Idx);
      const v15 = m15Data.volumes.slice(0, m15Idx);

      // ── Filter 1: Trend H1 + deteksi reversal CHoCH (sama persis logic live) ──
      const structH1 = analyzePriceActionStructure(h1h, h1l, h1c);
      const zzH1bt = zigzagBias(h1h, h1l, 3);
      if (structH1.bias === 'ranging' && zzH1bt.bias === 'ranging') continue;
      const baseBias = (structH1.bias !== 'ranging' ? structH1.bias : zzH1bt.bias) as 'bullish' | 'bearish';

      if (useZigZag && structH1.bias !== 'ranging' && zzH1bt.bias !== 'ranging' && zzH1bt.bias !== structH1.bias) continue;

      const chochH1bt = detectCHoCH(h1h, h1l, h1c, baseBias);
      const bias: 'bullish' | 'bearish' = chochH1bt ? (baseBias === 'bullish' ? 'bearish' : 'bullish') : baseBias;

      // ── Filter 2: ATR H1 >= 0.3% ──────────────────────────────────────────
      const atrH1 = calcATR(h1h, h1l, h1c);
      if ((atrH1 / currentPrice) * 100 < 0.3) continue;

      // ── Filter 3: Zona retest M15 (radius 2x ATR H1) ──────────────────────
      const obs15 = detectOrderBlocksH1(o15, h15, l15, c15, bias, 50);
      const fvgs15 = detectFVGH1(h15, l15, bias, 50);
      const sr15 = detectSRLevels(h15, l15, c15);
      const snd15 = detectSnDZones(h15, l15, c15, v15);
      const fib15 = calcFibonacci(h15, l15, c15);
      const maxDist = atrH1 * 2;

      const obsFiltered = obs15.filter(ob => {
        const dist = bias === 'bullish' ? currentPrice - ob.high : ob.low - currentPrice;
        return dist >= 0 && dist <= maxDist;
      });
      const fvgsFiltered = fvgs15.filter(fvg => {
        const dist = bias === 'bullish' ? currentPrice - fvg.high : fvg.low - currentPrice;
        return dist >= 0 && dist <= maxDist;
      });
      const srFiltered = sr15.filter(sr => Math.abs(currentPrice - sr.price) <= maxDist * 0.5);

      const bestZone = selectBestZoneH1(obsFiltered, fvgsFiltered, [], srFiltered, snd15, fib15, bias, currentPrice);
      if (!bestZone) continue;

      // ── Filter 4: Trigger — pattern reversal M15 (approx M5) atau RSI divergence M15 ──
      const bullPatterns = ['Double Bottom', 'Inverse H&S'];
      const bearPatterns = ['Double Top', 'Head & Shoulders'];
      const validPatterns = bias === 'bullish' ? bullPatterns : bearPatterns;
      const pats15 = [
        detectDoubleBottom(h15, l15, c15, v15), detectDoubleTop(h15, l15, c15, v15),
        detectInverseHS(h15, l15, c15, v15), detectHeadAndShoulders(h15, l15, c15, v15),
      ].filter(p => p && validPatterns.includes(p!.name));

      const rsiSeries15 = calcRSISeries(c15);
      const swingHighs15 = findSwingPointsIdx(h15, 'high', 2);
      const swingLows15 = findSwingPointsIdx(l15, 'low', 2);
      let rsiDiv15 = false;
      if (bias === 'bullish' && swingLows15.length >= 2) {
        const lA = swingLows15[swingLows15.length - 2]!, lB = swingLows15[swingLows15.length - 1]!;
        const rA = rsiSeries15[lA.idx] ?? 50, rB = rsiSeries15[lB.idx] ?? 50;
        rsiDiv15 = lB.value < lA.value && rB > rA + 2 && rB < 45;
      } else if (bias === 'bearish' && swingHighs15.length >= 2) {
        const hA = swingHighs15[swingHighs15.length - 2]!, hB = swingHighs15[swingHighs15.length - 1]!;
        const rA = rsiSeries15[hA.idx] ?? 50, rB = rsiSeries15[hB.idx] ?? 50;
        rsiDiv15 = hB.value > hA.value && rB < rA - 2 && rB > 55;
      }
      const hasTrigger = pats15.length > 0 || rsiDiv15;
      if (!hasTrigger) continue;

      // Entry approx (38.2% dalam zona M15 — pengganti presisi M5 yang gak di-fetch)
      const entryPrice = bias === 'bullish'
        ? bestZone.low + (bestZone.high - bestZone.low) * 0.382
        : bestZone.high - (bestZone.high - bestZone.low) * 0.382;

      // ── Entry, SL, TP — sama persis dengan live ──────────────────────────
      const swingM15H = findSwingHighs(h15, 10);
      const swingM15L = findSwingLows(l15, 10);
      const bufferH1 = atrH1 * 0.2;
      let stopLoss: number;
      if (bias === 'bullish') {
        const relevantLows = swingM15L.filter(l => l < entryPrice);
        const nearestLow = relevantLows.length > 0 ? Math.max(...relevantLows) : Math.min(...l15.slice(-10));
        stopLoss = Math.min(nearestLow - bufferH1, entryPrice - atrH1);
      } else {
        const relevantHighs = swingM15H.filter(h => h > entryPrice);
        const nearestHigh = relevantHighs.length > 0 ? Math.min(...relevantHighs) : Math.max(...h15.slice(-10));
        stopLoss = Math.max(nearestHigh + bufferH1, entryPrice + atrH1);
      }
      const risk = Math.abs(entryPrice - stopLoss);
      if (risk <= 0) continue;
      const dir = bias === 'bullish' ? 1 : -1;
      const takeProfit1 = entryPrice + risk * 2 * dir; // R:R 1:2
      const takeProfit2 = entryPrice + risk * 4 * dir; // R:R 1:4

      // Simulate: 96 candle M15 ke depan (= 1 hari), window fill 16 candle (4 jam)
      const futEnd = Math.min(m15Data.closes.length, m15Idx + 96);
      const futH = m15Data.highs.slice(m15Idx, futEnd);
      const futL = m15Data.lows.slice(m15Idx, futEnd);
      if (futH.length < 4) continue;
      const sim = simulateTrade(entryPrice, stopLoss, takeProfit1, takeProfit2, bias, futH, futL, 96, 16);
      if (sim.result === 'EXPIRED' || sim.result === 'NO_FILL') continue;

      const entryTime = h1Data.times ? h1Data.times[i]! : Date.now();
      const hour = getWIBHour(entryTime);

      // Strength score (0-100) — pakai faktor yang udah dihitung di backtest ini.
      const strengthScoreExt =
        (pats15.length > 0 ? 35 : 0) + // pattern lebih kuat dari RSI divergence doang
        (bestZone.tier <= 2 ? 35 : 0) +
        (chochH1bt ? 30 : 0); // reversal setup (confluence tambahan dari CHoCH)

      extremeTrades.push({
        menu: 'extreme_scalping', entryTime, entryPrice, stopLoss, takeProfit1, takeProfit2, bias,
        result: sim.result, exitPrice: sim.exitPrice, rr: sim.rr,
        // Reuse field lama buat nampung info reversal (nama field gak diubah biar gak
        // breaking change ke tipe/UI, sama pola kayak yang dipakai buat RSI Div H1 di Sniper)
        hasChoch15M: chochH1bt, hasRejection15M: hasTrigger,
        hasPattern: pats15.length > 0,
        strengthScore: strengthScoreExt,
        patternConfidence: pats15.length > 0 ? 'MEDIUM' : (rsiDiv15 ? 'LOW' : 'NONE'),
        zoneTier: bestZone.tier,
        hour,
        hasBBSqueeze: false, // gak relevan buat Extreme Scalping
        hasEMA34Confirm: false, // gak relevan
        hasM30Correction: false, // gak relevan
        zoneType: bestZone.zoneType,
      });
    }

    result.extremeScalpingResult = { ...buildAnalysis(extremeTrades), trades: extremeTrades };
  }

  // ─── BACKTEST BREAKOUT ENTRY (Menu 1 — H2 konsolidasi + breakout) ──────────
  // Beda total dari 3 menu lain: bukan retest zona OB/FVG/S&R, tapi nyari
  // breakout dari konsolidasi (sama persis logic live). Cuma nyimulasiin
  // breakout yang UDAH CONFIRMED (bukan status "SIAP BREAKOUT"/anticipation,
  // karena itu speculative dan gak ada arah pasti buat disimulasiin).
  if ((menu === 'breakout_entry' || menu === 'both') && h2Data) {
    const beTrades: BacktestTrade[] = [];
    const h2Total = h2Data.closes.length;
    const MIN_H2 = 60;
    const windowSizes = [40, 25, 15];

    for (let bIdx = MIN_H2; bIdx < h2Total - 6; bIdx++) {
      let found: { consolHigh: number; consolLow: number; consolStart: number; bias: 'bullish' | 'bearish'; volRatio: number } | null = null;

      for (const winSize of windowSizes) {
        const consolStart = bIdx - winSize;
        if (consolStart < 5) continue;
        const wh = h2Data.highs.slice(consolStart, bIdx);
        const wl = h2Data.lows.slice(consolStart, bIdx);
        const consolHigh = Math.max(...wh);
        const consolLow = Math.min(...wl);
        const widthPct = ((consolHigh - consolLow) / consolLow) * 100;
        if (widthPct > 12) continue;

        let resTouches = 0, supTouches = 0;
        for (let k = 0; k < wh.length; k++) {
          if (Math.abs(wh[k]! - consolHigh) / consolHigh <= 0.005) resTouches++;
          if (Math.abs(wl[k]! - consolLow) / consolLow <= 0.005) supTouches++;
        }
        if (resTouches < 2 || supTouches < 2) continue;

        const breakoutClose = h2Data.closes[bIdx]!;
        let bias: 'bullish' | 'bearish' | null = null;
        if (breakoutClose > consolHigh * 1.003) bias = 'bullish';
        else if (breakoutClose < consolLow * 0.997) bias = 'bearish';
        if (!bias) continue;

        // HARD FILTER: ZigZag H2 3% (sama persis logic live)
        const zzH2bt = zigzagBias(h2Data.highs.slice(0, bIdx + 1), h2Data.lows.slice(0, bIdx + 1), 3);
        if (zzH2bt.bias === 'ranging' || zzH2bt.bias !== bias) continue;

        const volWindow = h2Data.volumes.slice(Math.max(0, bIdx - 20), bIdx);
        const avgVol = volWindow.length > 0 ? volWindow.reduce((a, b) => a + b, 0) / volWindow.length : 0;
        const breakoutVol = h2Data.volumes[bIdx]!;
        const volRatio = avgVol > 0 ? breakoutVol / avgVol : 0;
        if (volRatio < 1.5) continue;

        found = { consolHigh, consolLow, consolStart, bias, volRatio };
        break; // window terpanjang yang valid duluan dipakai, sama kayak live
      }

      if (!found) continue;

      // Tipe: continuation vs reversal (bandingin trend sebelum konsolidasi)
      const preStart = Math.max(0, found.consolStart - 20);
      const preStruct = analyzePriceActionStructure(
        h2Data.highs.slice(preStart, found.consolStart),
        h2Data.lows.slice(preStart, found.consolStart),
        h2Data.closes.slice(preStart, found.consolStart)
      );
      const breakoutType: 'continuation' | 'reversal' =
        preStruct.bias === found.bias ? 'continuation' : preStruct.bias !== 'ranging' ? 'reversal' : 'continuation';

      // Entry, SL, TP — sama persis dengan live
      const atrH2bt = calcATR(
        h2Data.highs.slice(0, bIdx + 1), h2Data.lows.slice(0, bIdx + 1), h2Data.closes.slice(0, bIdx + 1)
      );
      const bufferH2 = atrH2bt * 0.3;
      const brokenLevel = found.bias === 'bullish' ? found.consolHigh : found.consolLow;
      const entryPrice = brokenLevel;
      const stopLoss = found.bias === 'bullish'
        ? Math.min(brokenLevel - bufferH2, entryPrice - atrH2bt)
        : Math.max(brokenLevel + bufferH2, entryPrice + atrH2bt);
      const height = found.consolHigh - found.consolLow;
      const dir = found.bias === 'bullish' ? 1 : -1;
      const takeProfit1 = brokenLevel + height * dir; // measured move
      const takeProfit2 = brokenLevel + height * 1.618 * dir; // extended target

      const risk = Math.abs(entryPrice - stopLoss);
      if (risk <= 0) continue;
      // Sama kayak fix di live: skip kalau R:R measured-move di bawah 1:1.2
      const potentialRR = Math.abs(takeProfit1 - entryPrice) / risk;
      if (potentialRR < 1.2) continue;

      // Simulate: 40 candle H2 ke depan (~3.3 hari, sama kayak window expiry live)
      const futEnd = Math.min(h2Total, bIdx + 40);
      const futH = h2Data.highs.slice(bIdx, futEnd);
      const futL = h2Data.lows.slice(bIdx, futEnd);
      if (futH.length < 2) continue;
      const sim = simulateTrade(entryPrice, stopLoss, takeProfit1, takeProfit2, found.bias, futH, futL, 40, 8);
      if (sim.result === 'EXPIRED' || sim.result === 'NO_FILL') continue;

      const entryTime = h2Data.times ? h2Data.times[bIdx]! : Date.now();
      const hour = getWIBHour(entryTime);

      // Strength score (0-100) — pakai faktor yang udah dihitung di sini.
      const strengthScoreBE =
        (breakoutType === 'continuation' ? 40 : 20) + // continuation historis dianggap lebih reliable dari reversal
        (found.volRatio >= 2 ? 35 : found.volRatio >= 1.5 ? 20 : 0) +
        25; // baseline (ZigZag 3% udah wajib lolos duluan buat semua trade)

      beTrades.push({
        menu: 'breakout_entry', entryTime, entryPrice, stopLoss, takeProfit1, takeProfit2, bias: found.bias,
        result: sim.result, exitPrice: sim.exitPrice, rr: sim.rr,
        // Reuse field lama (nama gak diubah biar konsisten sama tipe/UI yang udah ada)
        hasChoch15M: breakoutType === 'continuation',
        hasRejection15M: true,
        hasPattern: true, // breakout candle ITU SENDIRI adalah "pattern"/trigger-nya di sini
        strengthScore: strengthScoreBE,
        patternConfidence: breakoutType === 'continuation' ? 'MEDIUM' : 'LOW',
        zoneTier: 1, // Breakout Entry gak pakai sistem tier OB/FVG/S&R
        breakoutType,
        volumeRatio: found.volRatio,
        hour,
      });
    }

    result.breakoutEntryResult = { ...buildAnalysis(beTrades), trades: beTrades };
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
  menu: 'sniper' | 'breakout_entry' | 'scalping' | 'extreme_scalping'
): Promise<RecentPerformance | null> {
  try {
    const result = await runBacktest(symbol, '1m', menu);
    const analysis =
      menu === 'sniper' ? result.sniperResult :
      menu === 'scalping' ? result.scalpingResult :
      menu === 'extreme_scalping' ? result.extremeScalpingResult :
      result.breakoutEntryResult;
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
