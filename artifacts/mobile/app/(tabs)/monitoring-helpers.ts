import { StyleSheet } from "react-native";
import type { JournalEntry } from "./journal-helpers";
import { journalLoadAll, journalUpdate } from "./journal-helpers";

// ═════════════════════════════════════════════════════════════════════════════
// TYPES
// ═════════════════════════════════════════════════════════════════════════════

// Fix (request user, "investigasi lebih dalam dan sesuaikan biar baca dari
// Journal juga"): dulu monitoring ini baca dari 3 storage Log terpisah
// (Sniper/Scalping/Breakout Entry doang — Extreme Scalping & Momentum Hunter
// GAK PERNAH kecover dari awal). Sekarang satu-satunya sumber data JOURNAL,
// otomatis cover SEMUA 5 menu sekaligus karena JournalEntry.sourceMenu
// (bukan cuma 3 field 'menu' union yang lama).
export type MonitoringSignalLog = JournalEntry;

export type HealthStatus = "aman" | "warning" | "close";

export interface MonitoringMetrics {
  currentPrice: number;
  riskUsedPct: number;         // 0-100, % jarak entry→harga sekarang / jarak entry→SL
  progressToTP1Pct: number;    // 0-100, % jarak entry→harga sekarang / jarak entry→TP1
  oiChangePct: number;         // % change OI current vs baseline saat entry kehit
  fundingRate: number;         // decimal, e.g. 0.0001 = 0.01%
  takerRatio: number;          // taker buy vol / taker sell vol
  cvdDelta: number;            // cumulative volume delta since savedAt
  cvdDivergence: "none" | "bullish" | "bearish";
}

export interface MonitoringResult {
  status: HealthStatus;
  metrics: MonitoringMetrics;
  triggers: string[];          // list active alert reasons
}

interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  takerBuyVolume: number;      // taker buy base volume
}

// ═════════════════════════════════════════════════════════════════════════════
// BINANCE API HELPERS
// ═════════════════════════════════════════════════════════════════════════════

const BINANCE_BASE = "https://fapi.binance.com";

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchKlines(symbol: string, interval: string, limit: number, startTime?: number): Promise<Kline[]> {
  const params = new URLSearchParams({ symbol, interval, limit: String(limit) });
  if (startTime) params.set("startTime", String(startTime));
  const url = `${BINANCE_BASE}/fapi/v1/klines?${params.toString()}`;
  const raw = await fetchJson<number[][]>(url);
  if (!raw) return [];
  return raw.map((k) => ({
    openTime: k[0] as number,
    open: parseFloat(k[1] as unknown as string),
    high: parseFloat(k[2] as unknown as string),
    low: parseFloat(k[3] as unknown as string),
    close: parseFloat(k[4] as unknown as string),
    volume: parseFloat(k[5] as unknown as string),
    takerBuyVolume: parseFloat(k[9] as unknown as string),
  }));
}

async function fetchCurrentPrice(symbol: string): Promise<number | null> {
  const res = await fetchJson<{ price: string }>(`${BINANCE_BASE}/fapi/v1/ticker/price?symbol=${symbol}`);
  return res ? parseFloat(res.price) : null;
}

async function fetchOpenInterest(symbol: string): Promise<number | null> {
  const res = await fetchJson<{ openInterest: string }>(`${BINANCE_BASE}/fapi/v1/openInterest?symbol=${symbol}`);
  return res ? parseFloat(res.openInterest) : null;
}

async function fetchFundingRate(symbol: string): Promise<number | null> {
  const res = await fetchJson<{ lastFundingRate: string }>(`${BINANCE_BASE}/fapi/v1/premiumIndex?symbol=${symbol}`);
  return res ? parseFloat(res.lastFundingRate) : null;
}

async function fetchTakerRatio(symbol: string): Promise<number | null> {
  // Ambil period 15m, latest data point
  const url = `${BINANCE_BASE}/futures/data/takerlongshortRatio?symbol=${symbol}&period=15m&limit=1`;
  const res = await fetchJson<Array<{ buySellRatio: string }>>(url);
  if (!res || res.length === 0) return null;
  return parseFloat(res[0]!.buySellRatio);
}

// ═════════════════════════════════════════════════════════════════════════════
// ENTRY HIT DETECTION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Cek apakah harga pernah touch entryPrice sejak savedAt.
 * Return timestamp candle saat entry kehit, null kalau belum.
 *
 * Fix (bug ketemu pas investigasi, konsisten sama checkResolve): sebelumnya
 * cuma 1x fetch limit=200 candle 15m (~50 jam cakupan dari savedAt). Karena
 * fungsi ini dipanggil BERULANG (tiap scan) TAPI window fetch-nya SELALU
 * sama (fixed dari savedAt), kalau entry belum kesentuh dalam 50 jam
 * pertama, fungsi ini GAK PERNAH BISA detect entry hit yang kejadian
 * belakangan — window-nya gak pernah maju sama sekali. Sekarang pagination.
 *
 * Fix TAMBAHAN (ketemu user, "sinyal baru disimpen langsung kebaca expired"):
 * pagination sebelumnya berhenti berdasar 'klines.length < limit' — SALAH,
 * karena batch dikit bisa aja gara-gara RENTANG WAKTUNYA emang pendek
 * (sinyal baru disimpen), bukan karena data abis. Sekarang patokan yang
 * bener: cursor (titik fetch berikutnya) udah >= now atau belum.
 */
export async function checkEntryHit(log: JournalEntry): Promise<number | null> {
  const now = Date.now();
  let cursor = log.savedAt;
  const maxIterations = 20;

  for (let iter = 0; iter < maxIterations && cursor < now; iter++) {
    const klines = await fetchKlines(log.symbol, "15m", 1500, cursor);
    if (klines.length === 0) break;

    for (const k of klines) {
      if (k.low <= log.entryPrice && log.entryPrice <= k.high) {
        return k.openTime;
      }
    }

    cursor = klines[klines.length - 1]!.openTime + 15 * 60 * 1000;
    if (cursor >= now) break;
    if (iter < maxIterations - 1) await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

/**
 * Cek apakah log udah kena SL/TP1/TP2 setelah entry kehit.
 * Return status akhir + exitPrice + rr, atau null kalau masih monitoring.
 *
 * Fix (konsisten sama journalEvaluate — "jangan sampe bilang win padahal
 * lose"): sebelumnya cuma 1x fetch limit=500 candle 15m (~5.2 hari cakupan
 * dari entryHitAt). Kalau posisi dipantau lebih lama dari itu tanpa resolve,
 * fetch gak akan pernah nyampe candle terbaru. Sekarang pagination — fetch
 * berulang majuin cursor sampe beneran nyampe sekarang atau ketemu SL/TP.
 */
export async function checkResolve(log: MonitoringSignalLog): Promise<Partial<JournalEntry> | null> {
  if (!log.entryHitAt) return null;
  const risk = Math.abs(log.entryPrice - log.stopLoss);
  const evalTime = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";
  const now = Date.now();
  let cursor = log.entryHitAt;
  const maxIterations = 20; // ≈20 hari cakupan (1500 candle 15m/batch), cukup buat posisi monitoring manapun

  for (let iter = 0; iter < maxIterations && cursor < now; iter++) {
    const klines = await fetchKlines(log.symbol, "15m", 1500, cursor);
    if (klines.length === 0) break;

    for (const k of klines) {
      const openTime = k.openTime;
      if (log.bias === "bullish") {
        if (k.low <= log.stopLoss) {
          return { status: "lose", exitPrice: log.stopLoss, rr: -1, evaluatedAt: evalTime, resolvedAt: openTime };
        }
        if (log.takeProfit2 && k.high >= log.takeProfit2) {
          return {
            status: "win_tp2",
            exitPrice: log.takeProfit2,
            rr: Math.round(((log.takeProfit2 - log.entryPrice) / risk) * 10) / 10,
            evaluatedAt: evalTime, resolvedAt: openTime,
          };
        }
        if (k.high >= log.takeProfit1) {
          return {
            status: "win_tp1",
            exitPrice: log.takeProfit1,
            rr: Math.round(((log.takeProfit1 - log.entryPrice) / risk) * 10) / 10,
            evaluatedAt: evalTime, resolvedAt: openTime,
          };
        }
      } else {
        if (k.high >= log.stopLoss) {
          return { status: "lose", exitPrice: log.stopLoss, rr: -1, evaluatedAt: evalTime, resolvedAt: openTime };
        }
        if (log.takeProfit2 && k.low <= log.takeProfit2) {
          return {
            status: "win_tp2",
            exitPrice: log.takeProfit2,
            rr: Math.round(((log.entryPrice - log.takeProfit2) / risk) * 10) / 10,
            evaluatedAt: evalTime, resolvedAt: openTime,
          };
        }
        if (k.low <= log.takeProfit1) {
          return {
            status: "win_tp1",
            exitPrice: log.takeProfit1,
            rr: Math.round(((log.entryPrice - log.takeProfit1) / risk) * 10) / 10,
            evaluatedAt: evalTime, resolvedAt: openTime,
          };
        }
      }
    }

    // Fix bug (ketemu user, "sinyal baru disimpen langsung kebaca expired"):
    // patokan "udah nyampe ujung data" itu cursor vs now, BUKAN "klines.length
    // < limit" (dulu, salah — batch bisa dikit gara-gara rentang waktu emang
    // pendek, bukan karena data abis).
    cursor = klines[klines.length - 1]!.openTime + 15 * 60 * 1000; // +1 candle 15m biar gak fetch ulang candle yang sama
    if (cursor >= now) break;
    if (iter < maxIterations - 1) await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// HEALTH EVALUATION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Hitung CVD (Cumulative Volume Delta) dari klines H1.
 * Delta per candle = takerBuy - takerSell = 2*takerBuy - totalVolume
 * Return CVD kumulatif dari candle pertama.
 */
function calculateCVD(klines: Kline[]): number {
  let cvd = 0;
  for (const k of klines) {
    const takerSell = k.volume - k.takerBuyVolume;
    cvd += k.takerBuyVolume - takerSell;
  }
  return cvd;
}

/**
 * Deteksi CVD divergence:
 * - Bullish divergence: harga makin turun tapi CVD naik (buyer accumulating)
 * - Bearish divergence: harga makin naik tapi CVD turun (seller distributing)
 * Bandingin 3 candle H1 terakhir: price direction vs CVD direction.
 */
function detectCVDDivergence(klines: Kline[]): "none" | "bullish" | "bearish" {
  if (klines.length < 4) return "none";
  const recent = klines.slice(-4);
  const priceChange = recent[recent.length - 1]!.close - recent[0]!.close;

  // CVD per-candle cumulative dalam window ini
  let cvdCurve = 0;
  const cvdSeries: number[] = [];
  for (const k of recent) {
    const takerSell = k.volume - k.takerBuyVolume;
    cvdCurve += k.takerBuyVolume - takerSell;
    cvdSeries.push(cvdCurve);
  }
  const cvdChange = cvdSeries[cvdSeries.length - 1]! - cvdSeries[0]!;

  // Divergence: arah beda
  if (priceChange > 0 && cvdChange < 0) return "bearish";
  if (priceChange < 0 && cvdChange > 0) return "bullish";
  return "none";
}

/**
 * Deteksi wick rejection di candle H1 terakhir.
 * Long: wick atas panjang = seller reject = warning
 * Short: wick bawah panjang = buyer reject = warning
 */
function hasWickRejection(klines: Kline[], bias: "bullish" | "bearish"): boolean {
  if (klines.length === 0) return false;
  const last = klines[klines.length - 1]!;
  const body = Math.abs(last.close - last.open);
  if (body === 0) return false;
  if (bias === "bullish") {
    const upperWick = last.high - Math.max(last.open, last.close);
    return upperWick / body > 0.6;
  } else {
    const lowerWick = Math.min(last.open, last.close) - last.low;
    return lowerWick / body > 0.6;
  }
}

/**
 * Hitung berapa candle H1 terakhir yang close lawan bias.
 */
function countAgainstBias(klines: Kline[], bias: "bullish" | "bearish"): number {
  let count = 0;
  for (let i = klines.length - 1; i >= 0; i--) {
    const k = klines[i]!;
    const isAgainst = bias === "bullish" ? k.close < k.open : k.close > k.open;
    if (isAgainst) count++;
    else break;
  }
  return count;
}

/**
 * Cek volume turun 2 candle terakhir (dibanding candle sebelumnya).
 */
function isVolumeDecreasing(klines: Kline[]): boolean {
  if (klines.length < 3) return false;
  const [a, b, c] = klines.slice(-3);
  return b!.volume < a!.volume && c!.volume < b!.volume;
}

/**
 * Main evaluator. Terima log + market data, return status + triggers.
 */
export async function evaluateHealth(log: MonitoringSignalLog): Promise<MonitoringResult | null> {
  // Fetch semua data paralel biar cepet
  const [currentPrice, klinesH1, oiCurrent, funding, takerRatio] = await Promise.all([
    fetchCurrentPrice(log.symbol),
    fetchKlines(log.symbol, "1h", 10),
    fetchOpenInterest(log.symbol),
    fetchFundingRate(log.symbol),
    fetchTakerRatio(log.symbol),
  ]);

  if (currentPrice === null || klinesH1.length === 0) return null;

  // ─── METRICS ──────────────────────────────────────────────────────────────
  const risk = Math.abs(log.entryPrice - log.stopLoss);
  const reward = Math.abs(log.takeProfit1 - log.entryPrice);

  let riskUsedPct = 0;
  let progressToTP1Pct = 0;

  if (log.bias === "bullish") {
    // Untuk long: harga turun ke SL = risk used naik
    const distFromEntry = log.entryPrice - currentPrice;
    riskUsedPct = risk > 0 ? Math.max(0, (distFromEntry / risk) * 100) : 0;
    // Progress ke TP1: harga naik dari entry
    const distToTP = currentPrice - log.entryPrice;
    progressToTP1Pct = reward > 0 ? Math.max(0, (distToTP / reward) * 100) : 0;
  } else {
    // Untuk short: harga naik ke SL = risk used naik
    const distFromEntry = currentPrice - log.entryPrice;
    riskUsedPct = risk > 0 ? Math.max(0, (distFromEntry / risk) * 100) : 0;
    const distToTP = log.entryPrice - currentPrice;
    progressToTP1Pct = reward > 0 ? Math.max(0, (distToTP / reward) * 100) : 0;
  }

  const oiChangePct =
    log.oiAtEntryHit && log.oiAtEntryHit > 0 && oiCurrent !== null
      ? ((oiCurrent - log.oiAtEntryHit) / log.oiAtEntryHit) * 100
      : 0;

  const cvdDelta = calculateCVD(klinesH1);
  const cvdDivergence = detectCVDDivergence(klinesH1);

  const metrics: MonitoringMetrics = {
    currentPrice,
    riskUsedPct: Math.round(riskUsedPct * 10) / 10,
    progressToTP1Pct: Math.round(progressToTP1Pct * 10) / 10,
    oiChangePct: Math.round(oiChangePct * 10) / 10,
    fundingRate: funding ?? 0,
    takerRatio: takerRatio ?? 1,
    cvdDelta,
    cvdDivergence,
  };

  // ─── TRIGGERS ─────────────────────────────────────────────────────────────
  const triggers: string[] = [];
  const closeTriggers: string[] = [];
  const warnTriggers: string[] = [];

  // 🔴 CLOSE POSISI triggers
  if (riskUsedPct > 80) {
    closeTriggers.push(`Harga sudah ${riskUsedPct.toFixed(0)}% menuju SL`);
  }
  const againstCount = countAgainstBias(klinesH1, log.bias);
  if (againstCount >= 2) {
    closeTriggers.push(`${againstCount} candle H1 berturut lawan bias`);
  }
  if (log.oiAtEntryHit && oiChangePct < -10) {
    closeTriggers.push(`OI turun ${Math.abs(oiChangePct).toFixed(1)}% (posisi ditutup pasar)`);
  }
  if (cvdDivergence !== "none") {
    const opposite = log.bias === "bullish" ? "bearish" : "bullish";
    if (cvdDivergence === opposite) {
      closeTriggers.push(`Divergence CVD ${cvdDivergence} (smart money lawan arah)`);
    }
  }

  // 🟡 WARNING triggers
  if (riskUsedPct >= 50 && riskUsedPct <= 80) {
    warnTriggers.push(`Risk used ${riskUsedPct.toFixed(0)}%`);
  }
  if (againstCount === 1) {
    warnTriggers.push(`1 candle H1 close lawan bias`);
  }
  if (isVolumeDecreasing(klinesH1)) {
    warnTriggers.push(`Volume H1 turun 2 candle terakhir`);
  }
  const fundingAgainst =
    (log.bias === "bullish" && (funding ?? 0) > 0.0008) ||
    (log.bias === "bearish" && (funding ?? 0) < -0.0008);
  if (fundingAgainst) {
    warnTriggers.push(`Funding ${((funding ?? 0) * 100).toFixed(3)}% ekstrem lawan bias`);
  }
  const takerAgainst =
    (log.bias === "bullish" && (takerRatio ?? 1) < 1 / 1.3) ||
    (log.bias === "bearish" && (takerRatio ?? 1) > 1.3);
  if (takerAgainst) {
    warnTriggers.push(`Taker ratio ${(takerRatio ?? 1).toFixed(2)} (agresor lawan bias)`);
  }
  if (hasWickRejection(klinesH1, log.bias)) {
    warnTriggers.push(`Wick rejection H1 candle terakhir`);
  }

  // ─── STATUS DECISION ──────────────────────────────────────────────────────
  let status: HealthStatus;
  if (closeTriggers.length > 0) {
    status = "close";
    triggers.push(...closeTriggers, ...warnTriggers);
  } else if (warnTriggers.length > 0) {
    status = "warning";
    triggers.push(...warnTriggers);
  } else {
    status = "aman";
  }

  return { status, metrics, triggers };
}

// ═════════════════════════════════════════════════════════════════════════════
// JOURNAL STORAGE HELPERS (untuk update entryHitAt & oiAtEntryHit)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Update entri Journal by id (entryHitAt, oiAtEntryHit, atau status resolve).
 * Fix (request user): dulu ada param `menu` buat milih 1 dari 3 storage key
 * Log lama — sekarang cuma 1 storage (Journal), gak perlu lagi.
 */
export async function updateMonitoringLog(id: string, patch: Partial<JournalEntry>): Promise<void> {
  await journalUpdate(id, patch);
}

/**
 * Load semua entri Journal yang: status pending DAN entryHitAt sudah ada
 * (udah kehit entry) — dari SEMUA 5 menu sekaligus (sourceMenu udah built-in
 * di JournalEntry, gak perlu auto-tag manual lagi kayak versi Log lama).
 */
export async function loadActiveMonitoringLogs(): Promise<MonitoringSignalLog[]> {
  const all = await journalLoadAll();
  return all.filter((l) => l.status === "pending" && l.entryHitAt);
}

/**
 * Load semua entri Journal pending yang BELUM ada entryHitAt — buat di-check
 * apakah udah kehit.
 */
export async function loadPendingUncheckedLogs(): Promise<MonitoringSignalLog[]> {
  const all = await journalLoadAll();
  return all.filter((l) => l.status === "pending" && !l.entryHitAt);
}

/**
 * Batch scan: cek semua entri pending untuk detect entry hit.
 * Kalau kehit, update entryHitAt + oiAtEntryHit.
 */
export async function scanEntryHits(): Promise<number> {
  const unchecked = await loadPendingUncheckedLogs();
  let newHits = 0;
  for (const log of unchecked) {
    const hitTime = await checkEntryHit(log);
    if (hitTime) {
      const oi = await fetchOpenInterest(log.symbol);
      await updateMonitoringLog(log.id, {
        entryHitAt: hitTime,
        oiAtEntryHit: oi ?? undefined,
      });
      newHits++;
      // rate limit ringan
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return newHits;
}

/**
 * Batch check resolve untuk semua entri monitoring (yang entry udah kehit).
 * Kalau kena SL/TP1/TP2, update status.
 */
export async function scanResolves(): Promise<number> {
  const active = await loadActiveMonitoringLogs();
  let resolved = 0;
  for (const log of active) {
    const result = await checkResolve(log);
    if (result) {
      await updateMonitoringLog(log.id, result);
      resolved++;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return resolved;
}

// ═════════════════════════════════════════════════════════════════════════════
// STYLES (dipake di MonitoringView)
// ═════════════════════════════════════════════════════════════════════════════

export const monitoringStyles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 12,
    marginVertical: 6,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    padding: 12,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cardHeaderLeft: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  symbol: { fontSize: 16, fontFamily: "Inter_700Bold" },
  menuBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  menuBadgeText: { fontSize: 9, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  statusBadge: {
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  metricsRow: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  metric: { flex: 1, alignItems: "center", gap: 2 },
  metricLabel: { fontSize: 9, fontFamily: "Inter_500Medium" },
  metricValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  progressWrap: {
    marginHorizontal: 12,
    marginVertical: 8,
    gap: 6,
  },
  progressLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressLabel: { fontSize: 10, fontFamily: "Inter_500Medium" },
  progressValue: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  progressBar: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 3 },
  priceRow: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  priceItem: { flex: 1, alignItems: "center", gap: 2 },
  priceLabel: { fontSize: 9, fontFamily: "Inter_500Medium" },
  priceValue: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  triggersWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 10,
    gap: 5,
  },
  triggerRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  triggerText: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 15 },
  emptyBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    gap: 10,
    minHeight: 300,
  },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  summary: {
    flexDirection: "row",
    margin: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    justifyContent: "space-around",
  },
  summaryItem: { alignItems: "center", gap: 4 },
  summaryVal: { fontSize: 18, fontFamily: "Inter_700Bold" },
  summaryLbl: { fontSize: 10, fontFamily: "Inter_400Regular" },
  refreshInfo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  refreshText: { fontSize: 10, fontFamily: "Inter_400Regular" },
});