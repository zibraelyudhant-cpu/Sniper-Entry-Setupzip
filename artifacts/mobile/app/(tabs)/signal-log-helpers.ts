import AsyncStorage from "@react-native-async-storage/async-storage";
import { StyleSheet } from "react-native";

export interface SignalLog {
  id: string;
  menu: "sniper" | "scalping" | "breakout_entry";
  mode?: string; // skill yang hasilin sinyal ini (misal 'confidence'/'crossover' buat Breakout Entry, 'sniper'/'rsi2' buat Sniper)
  symbol: string;
  bias: "bullish" | "bearish";
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
  currentPriceAtSignal: number;
  timestamp: string;
  savedAt: number;
  probabilityOrScore?: number;
  probabilityFactors?: string[];
  zoneType?: string;
  status: "pending" | "win_tp1" | "win_tp2" | "lose" | "expired";
  evaluatedAt?: string;
  exitPrice?: number;
  rr?: number;
}

export const STORAGE_KEY_SNIPER = "signal_logs_sniper";
export const STORAGE_KEY_SCALPING = "signal_logs_scalping";
export const STORAGE_KEY_BREAKOUT_ENTRY = "signal_logs_breakout_entry";

export async function loadLogs(key: string): Promise<SignalLog[]> {
  try { const raw = await AsyncStorage.getItem(key); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}

export async function saveLogs(key: string, logs: SignalLog[]): Promise<void> {
  try { await AsyncStorage.setItem(key, JSON.stringify(logs)); } catch {}
}

export async function addLog(key: string, log: SignalLog): Promise<SignalLog[]> {
  const existing = await loadLogs(key);
  const updated = [log, ...existing].slice(0, 100);
  await saveLogs(key, updated);
  return updated;
}

export async function updateLog(key: string, id: string, patch: Partial<SignalLog>): Promise<SignalLog[]> {
  const existing = await loadLogs(key);
  const updated = existing.map(l => l.id === id ? { ...l, ...patch } : l);
  await saveLogs(key, updated);
  return updated;
}

export async function deleteLog(key: string, id: string): Promise<SignalLog[]> {
  const existing = await loadLogs(key);
  const updated = existing.filter(l => l.id !== id);
  await saveLogs(key, updated);
  return updated;
}

export async function evaluateLog(log: SignalLog): Promise<Partial<SignalLog>> {
  try {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${log.symbol}&interval=15m&startTime=${log.savedAt}&endTime=${Date.now()}&limit=200`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Fetch failed");
    const klines: number[][] = await res.json();
    const risk = Math.abs(log.entryPrice - log.stopLoss);
    const evalTime = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";
    for (const k of klines) {
      const high = k[2] as number, low = k[3] as number;
      if (log.bias === "bullish") {
        if (low <= log.stopLoss) return { status: "lose", exitPrice: log.stopLoss, rr: -1, evaluatedAt: evalTime };
        if (log.takeProfit2 && high >= log.takeProfit2) return { status: "win_tp2", exitPrice: log.takeProfit2, rr: Math.round(((log.takeProfit2 - log.entryPrice) / risk) * 10) / 10, evaluatedAt: evalTime };
        if (high >= log.takeProfit1) return { status: "win_tp1", exitPrice: log.takeProfit1, rr: Math.round(((log.takeProfit1 - log.entryPrice) / risk) * 10) / 10, evaluatedAt: evalTime };
      } else {
        if (high >= log.stopLoss) return { status: "lose", exitPrice: log.stopLoss, rr: -1, evaluatedAt: evalTime };
        if (log.takeProfit2 && low <= log.takeProfit2) return { status: "win_tp2", exitPrice: log.takeProfit2, rr: Math.round(((log.entryPrice - log.takeProfit2) / risk) * 10) / 10, evaluatedAt: evalTime };
        if (low <= log.takeProfit1) return { status: "win_tp1", exitPrice: log.takeProfit1, rr: Math.round(((log.entryPrice - log.takeProfit1) / risk) * 10) / 10, evaluatedAt: evalTime };
      }
    }
    return { status: "pending" };
  } catch { return { status: "pending" }; }
}

export const logStyles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10, minHeight: 300 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  summary: { flexDirection: "row", margin: 12, borderRadius: 12, borderWidth: 1, padding: 14, justifyContent: "space-around" },
  summaryItem: { alignItems: "center", gap: 4 },
  summaryVal: { fontSize: 18, fontFamily: "Inter_700Bold" },
  summaryLbl: { fontSize: 10, fontFamily: "Inter_400Regular" },
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  cardHeader: { flexDirection: "row", padding: 12, alignItems: "flex-start" },
  cardPair: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  cardTime: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  statusText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  biasBadge: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  priceRow: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8, paddingHorizontal: 12, gap: 4 },
  priceItem: { flex: 1, alignItems: "center" },
  priceLabel: { fontSize: 9, fontFamily: "Inter_500Medium" },
  priceVal: { fontSize: 10, fontFamily: "Inter_600SemiBold", marginTop: 2 },
  prob: { fontSize: 11, fontFamily: "Inter_400Regular", paddingHorizontal: 12, paddingBottom: 4 },
  evalTime: { fontSize: 10, fontFamily: "Inter_400Regular", paddingHorizontal: 12, paddingBottom: 6 },
  actions: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, padding: 8, gap: 8, alignItems: "center" },
  evalBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  evalBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  delBtn: { padding: 8 },
});