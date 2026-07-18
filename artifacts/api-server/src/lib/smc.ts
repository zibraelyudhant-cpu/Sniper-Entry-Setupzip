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
    highVolume: trades.filter(t => (t.volumeRatio ?? 0) >= 2),
    lowVolume: trades.filter(t => (t.volumeRatio ?? 0) < 2),
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
    if ((t.volumeRatio ?? 0) < 2) {
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

      // Step 2: H1 zona
      const zones = findZones(h1Slice.highs, h1Slice.lows, h1Slice.closes, h1Slice.opens, h1Slice.volumes, bias);
      if (zones.length === 0) continue;

      // Skip kalau CHoCH H1 terbentuk (konflik)
      const chochH1 = detectCHoCH(h1Slice.highs, h1Slice.lows, h1Slice.closes, bias);
      if (chochH1) continue;

      const selectedZone = zones[0];
      const currentPrice = h1Slice.closes[h1Slice.closes.length - 1];

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
        m15Slice.opens, m15Slice.highs, m15Slice.lows, m15Slice.closes, bias
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

// Helper: detectCHoCH15M perlu diekspos
function detectCHoCH15M(
  highs: number[], lows: number[], closes: number[],
  bias: 'bullish' | 'bearish'
): { detected: boolean; description: string } {
  const n = closes.length;
  if (n < 10) return { detected: false, description: '' };
  const sliceH = highs.slice(Math.max(0, n - 20));
  const sliceL = lows.slice(Math.max(0, n - 20));
  const sliceC = closes.slice(Math.max(0, n - 20));
  const swingHighs = findSwingHighs(sliceH, 3);
  const swingLows = findSwingLows(sliceL, 3);
  const lastClose = sliceC[sliceC.length - 1];
  if (bias === 'bullish') {
    if (swingHighs.length < 2 || swingLows.length < 2) return { detected: false, description: '' };
    const prevHH = swingHighs[swingHighs.length - 2];
    const lastLL = swingLows[swingLows.length - 1];
    const prevLL = swingLows[swingLows.length - 2];
    if (lastLL < prevLL && lastClose > prevHH) return { detected: true, description: 'CHoCH Bullish 15M' };
  } else {
    if (swingHighs.length < 2 || swingLows.length < 2) return { detected: false, description: '' };
    const prevLL = swingLows[swingLows.length - 2];
    const lastHH = swingHighs[swingHighs.length - 1];
    const prevHH = swingHighs[swingHighs.length - 2];
    if (lastHH > prevHH && lastClose < prevLL) return { detected: true, description: 'CHoCH Bearish 15M' };
  }
  return { detected: false, description: '' };
}

// Extend KlineData dengan times
declare module './smc' {
  interface KlineData {
    times?: number[];
  }
}