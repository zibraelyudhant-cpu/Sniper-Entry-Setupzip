import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Tipe data ──────────────────────────────────────────────────────────────

export interface JournalTFIndicator {
  rsi: number;
  atr: number;
  atrPct: number;
  adx: number;
  stochK: number;
  stochD: number;
}

export interface JournalTechnicalSnapshot {
  struktur: JournalTFIndicator;
  eksekusi: JournalTFIndicator;
}

export type JournalStatus = 'pending' | 'win_tp1' | 'win_tp2' | 'lose' | 'expired';

export const SOURCE_MENUS = [
  'Breakout Entry', 'Sniper Entry', 'Scalping', 'Extreme Scalping', 'Momentum Hunter',
] as const;
export type SourceMenu = typeof SOURCE_MENUS[number];

/**
 * 1 record Journal — REQUEST USER: lengkap & detail, biar bisa dianalisa
 * sinyal mana yang sering lose/win pada kondisi apa. Field teknikal
 * (technicalSnapshot) MURNI INFORMASIONAL, gak pernah dipake buat ngubah
 * keputusan sinyal — cuma buat evaluasi manual lo di sini.
 */
export interface JournalEntry {
  id: string;
  symbol: string;
  bias: 'bullish' | 'bearish';

  // Dari menu/skill mana
  sourceMenu: SourceMenu;
  sourceSkill: string; // e.g. 'Confidence Score', 'Sniper', 'RSI-2', 'Structural', 'Skill 15M', 'Quant', 'Momentum Hunter (Retest)'

  // Harga & level
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
  currentPriceAtSignal: number; // harga pas sinyal diberikan
  rr1?: number;

  // TF
  tfStruktur: string;
  tfEksekusi?: string; // kosong kalau single-TF (mode sideways Momentum Hunter)

  // Indikator — informasional
  technicalSnapshot?: JournalTechnicalSnapshot;

  // Waktu
  timestamp: string; // human-readable, waktu sinyal diberikan
  savedAt: number; // unix ms, dipake buat evaluasi range candle

  // Evaluasi
  status: JournalStatus;
  evaluatedAt?: string;
  exitPrice?: number;
  rr?: number;

  // Catatan bebas (opsional, user bisa isi manual alasan/observasi)
  note?: string;
}

const JOURNAL_KEY = 'trading_journal_v1';

export async function journalLoadAll(): Promise<JournalEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(JOURNAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function journalSave(entry: JournalEntry): Promise<JournalEntry[]> {
  const all = await journalLoadAll();
  // Max 300 entri (jauh lebih besar dari log per-menu yang 100, karena ini
  // agregat SEMUA menu dan tujuannya emang buat analisa jangka panjang).
  const updated = [entry, ...all].slice(0, 300);
  try { await AsyncStorage.setItem(JOURNAL_KEY, JSON.stringify(updated)); } catch {}
  return updated;
}

export async function journalUpdate(id: string, patch: Partial<JournalEntry>): Promise<JournalEntry[]> {
  const all = await journalLoadAll();
  const updated = all.map(e => e.id === id ? { ...e, ...patch } : e);
  try { await AsyncStorage.setItem(JOURNAL_KEY, JSON.stringify(updated)); } catch {}
  return updated;
}

export async function journalDelete(id: string): Promise<JournalEntry[]> {
  const all = await journalLoadAll();
  const updated = all.filter(e => e.id !== id);
  try { await AsyncStorage.setItem(JOURNAL_KEY, JSON.stringify(updated)); } catch {}
  return updated;
}

// ─── Evaluasi win/lose ──────────────────────────────────────────────────────

// Peta label TF -> interval Binance + limit candle (fix Temuan #4 audit
// sebelumnya — evaluasi WAJIB pake TF sesuai eksekusi ASLI sinyal, bukan
// candle kasar 15M fixed).
function evalIntervalFor(entry: JournalEntry): { interval: string; limit: number } {
  const tf = entry.tfEksekusi ?? entry.tfStruktur;
  switch (tf) {
    case '1M': return { interval: '1m', limit: 1500 };
    case '5M': return { interval: '5m', limit: 1000 };
    case 'M30': return { interval: '30m', limit: 200 };
    case 'H1': return { interval: '1h', limit: 200 };
    case 'H4': return { interval: '4h', limit: 200 };
    default: return { interval: '15m', limit: 200 }; // '15M' atau fallback
  }
}

export async function journalEvaluate(entry: JournalEntry): Promise<Partial<JournalEntry>> {
  try {
    const { interval, limit } = evalIntervalFor(entry);
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${entry.symbol}&interval=${interval}&startTime=${entry.savedAt}&endTime=${Date.now()}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return { status: 'pending' };
    const klines: number[][] = await res.json();
    const risk = Math.abs(entry.entryPrice - entry.stopLoss);
    const evalAt = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
    for (const k of klines) {
      const high = k[2] as number, low = k[3] as number;
      if (entry.bias === 'bullish') {
        if (low <= entry.stopLoss) return { status: 'lose', exitPrice: entry.stopLoss, rr: -1, evaluatedAt: evalAt };
        if (entry.takeProfit2 && high >= entry.takeProfit2) return { status: 'win_tp2', exitPrice: entry.takeProfit2, rr: Math.round(((entry.takeProfit2 - entry.entryPrice) / risk) * 10) / 10, evaluatedAt: evalAt };
        if (high >= entry.takeProfit1) return { status: 'win_tp1', exitPrice: entry.takeProfit1, rr: Math.round(((entry.takeProfit1 - entry.entryPrice) / risk) * 10) / 10, evaluatedAt: evalAt };
      } else {
        if (high >= entry.stopLoss) return { status: 'lose', exitPrice: entry.stopLoss, rr: -1, evaluatedAt: evalAt };
        if (entry.takeProfit2 && low <= entry.takeProfit2) return { status: 'win_tp2', exitPrice: entry.takeProfit2, rr: Math.round(((entry.entryPrice - entry.takeProfit2) / risk) * 10) / 10, evaluatedAt: evalAt };
        if (low <= entry.takeProfit1) return { status: 'win_tp1', exitPrice: entry.takeProfit1, rr: Math.round(((entry.entryPrice - entry.takeProfit1) / risk) * 10) / 10, evaluatedAt: evalAt };
      }
    }
    return { status: 'pending' };
  } catch {
    return { status: 'pending' };
  }
}

// ─── Analisa pola (win rate per kondisi) ───────────────────────────────────

export interface JournalBreakdown {
  label: string;
  total: number;
  win: number;
  lose: number;
  pending: number;
  winRate: number; // dari yang udah win+lose aja, exclude pending
}

function buildBreakdown(entries: JournalEntry[], keyFn: (e: JournalEntry) => string): JournalBreakdown[] {
  const groups = new Map<string, JournalEntry[]>();
  for (const e of entries) {
    const key = keyFn(e);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  const result: JournalBreakdown[] = [];
  for (const [label, group] of groups) {
    const win = group.filter(e => e.status === 'win_tp1' || e.status === 'win_tp2').length;
    const lose = group.filter(e => e.status === 'lose').length;
    const pending = group.filter(e => e.status === 'pending').length;
    const decided = win + lose;
    result.push({ label, total: group.length, win, lose, pending, winRate: decided > 0 ? Math.round((win / decided) * 100) : 0 });
  }
  return result.sort((a, b) => b.total - a.total);
}

/** Breakdown win-rate per menu asal — "sinyal dari menu mana yang paling sering menang" */
export function breakdownByMenu(entries: JournalEntry[]): JournalBreakdown[] {
  return buildBreakdown(entries, e => e.sourceMenu);
}

/** Breakdown win-rate per skill asal */
export function breakdownBySkill(entries: JournalEntry[]): JournalBreakdown[] {
  return buildBreakdown(entries, e => `${e.sourceMenu} — ${e.sourceSkill}`);
}

/** Breakdown win-rate per TF struktur */
export function breakdownByTF(entries: JournalEntry[]): JournalBreakdown[] {
  return buildBreakdown(entries, e => e.tfStruktur + (e.tfEksekusi ? `→${e.tfEksekusi}` : ''));
}

/** Breakdown win-rate per rentang ADX struktur saat sinyal (kondisi trend strength) */
export function breakdownByAdxRange(entries: JournalEntry[]): JournalBreakdown[] {
  const withAdx = entries.filter(e => e.technicalSnapshot?.struktur.adx !== undefined);
  return buildBreakdown(withAdx, e => {
    const adx = e.technicalSnapshot!.struktur.adx;
    if (adx < 20) return 'ADX <20 (lemah)';
    if (adx < 25) return 'ADX 20-25';
    if (adx < 35) return 'ADX 25-35';
    return 'ADX ≥35 (kuat)';
  });
}

/** Breakdown win-rate per rentang RSI eksekusi saat sinyal */
export function breakdownByRsiRange(entries: JournalEntry[]): JournalBreakdown[] {
  const withRsi = entries.filter(e => e.technicalSnapshot?.eksekusi.rsi !== undefined);
  return buildBreakdown(withRsi, e => {
    const rsi = e.technicalSnapshot!.eksekusi.rsi;
    if (rsi < 30) return 'RSI <30 (oversold)';
    if (rsi < 45) return 'RSI 30-45';
    if (rsi < 55) return 'RSI 45-55 (netral)';
    if (rsi < 70) return 'RSI 55-70';
    return 'RSI ≥70 (overbought)';
  });
}

/** Breakdown win-rate per bias (long vs short) */
export function breakdownByBias(entries: JournalEntry[]): JournalBreakdown[] {
  return buildBreakdown(entries, e => e.bias === 'bullish' ? 'LONG' : 'SHORT');
}
