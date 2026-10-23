import type { JournalEntry, JournalBreakdown } from './journal-helpers';
import { taScoreOfEntry } from './journal-helpers';

// ═══ Riset Jurnal: simulator filter + uji data baru (out-of-sample) + analisis komponen skor ═══
// Semua dihitung dari sinyal yang SUDAH selesai (win/lose) di Jurnal. Tanpa fee. R: LOSE = -1, WIN = rr.
// Hasil = KANDIDAT aturan, bukan bukti. Pola dicari di 70% sinyal tertua, lalu diuji di 30% terbaru.

const isWin = (e: JournalEntry) => e.status === 'win_tp1' || e.status === 'win_tp2';
const isResolved = (e: JournalEntry) => isWin(e) || e.status === 'lose';
const rOf = (e: JournalEntry): number => (e.status === 'lose' ? -1 : (typeof e.rr === 'number' && e.rr > 0 ? e.rr : typeof e.rr1 === 'number' && e.rr1 > 0 ? e.rr1 : 2));
const sumR = (a: JournalEntry[]) => a.reduce((s, e) => s + rOf(e), 0);
const r1 = (v: number) => Math.round(v * 10) / 10;

// ─── Poin per komponen skor TA PRO (sisi searah sinyal) ───
export const TA_COMPONENTS = [
  { key: 'structH4', label: 'Struktur H4' },
  { key: 'structH1', label: 'Struktur H1' },
  { key: 'oi', label: 'Open Interest' },
  { key: 'lsr', label: 'Long/Short ratio' },
  { key: 'funding', label: 'Funding' },
] as const;

function taPtsOf(e: JournalEntry): Record<string, number | null> | null {
  const raw = e.bias === 'bullish' ? e.taLongPts : e.taShortPts;
  if (!raw) return null;
  const out: Record<string, number | null> = {};
  for (const part of raw.split('|')) {
    const [k, v] = part.split(':');
    if (!k || v === undefined) continue;
    out[k] = v === 'x' ? null : Number(v);
  }
  return out;
}

// ─── Fitur yang bisa diuji sebagai filter ───
type Feature = { id: string; label: string; get: (e: JournalEntry) => number | undefined };
const num = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined);
const bool = (v: boolean | undefined): number | undefined => (v === undefined ? undefined : v ? 1 : 0);

const FEATURES: Feature[] = [
  { id: 'taScore', label: 'Skor TA PRO', get: e => taScoreOfEntry(e)?.score },
  ...TA_COMPONENTS.map(c => ({ id: 'ta_' + c.key, label: 'Poin ' + c.label, get: (e: JournalEntry) => { const p = taPtsOf(e); const v = p?.[c.key]; return v === null || v === undefined ? undefined : v; } })),
  { id: 'adxS', label: 'ADX struktur', get: e => num(e.technicalSnapshot?.struktur?.adx) },
  { id: 'adxE', label: 'ADX eksekusi', get: e => num(e.technicalSnapshot?.eksekusi?.adx) },
  { id: 'rsiS', label: 'RSI struktur', get: e => num(e.technicalSnapshot?.struktur?.rsi) },
  { id: 'rsiE', label: 'RSI eksekusi', get: e => num(e.technicalSnapshot?.eksekusi?.rsi) },
  { id: 'atrE', label: 'ATR% eksekusi', get: e => num(e.technicalSnapshot?.eksekusi?.atrPct) },
  { id: 'mfiE', label: 'MFI eksekusi', get: e => num(e.technicalSnapshot?.eksekusi?.mfi) },
  { id: 'stochE', label: 'Stoch K eksekusi', get: e => num(e.technicalSnapshot?.eksekusi?.stochK) },
  { id: 'btcAl', label: 'BTC searah (1=ya)', get: e => bool(e.btcAligned) },
  { id: 'd1Al', label: 'D1 searah (1=ya)', get: e => bool(e.d1Aligned) },
  { id: 'long', label: 'Arah LONG (1=long)', get: e => (e.bias === 'bullish' ? 1 : 0) },
  { id: 'entryDist', label: 'Jarak entry/ATR M15', get: e => num(e.entryDistAtr) },
  { id: 'btcRet', label: 'Return BTC 24j (%)', get: e => num(e.gateBtcRet24h) },
  { id: 'd1Chg', label: 'Perubahan D1 3 candle (%)', get: e => num(e.d1ChangePct) },
  { id: 'fkVol', label: 'Fakeout volume x', get: e => num(e.fkVolX) },
  { id: 'fkRisk', label: 'Fakeout risk/ATR', get: e => num(e.fkRiskAtr) },
  { id: 'crtRoom', label: 'CRT ruang ke target (R)', get: e => num(e.crtRoomR) },
  { id: 'crtRisk', label: 'CRT risk/ATR', get: e => num(e.crtRiskAtr) },
  { id: 'crtPos', label: 'CRT posisi entry di range D1 (%)', get: e => num(e.crtPosPct) },
  { id: 'crtDepth', label: 'CRT kedalaman sweep (%)', get: e => num(e.crtDepthPct) },
];

const MIN_FEATURED = 15, MIN_REMOVED = 5, MAX_REMOVED_FRAC = 0.6, MIN_TEST_REMOVED = 3, MIN_RESOLVED = 30;

function fmt(v: number): string {
  const a = Math.abs(v);
  return String(a >= 100 ? Math.round(v) : a >= 10 ? r1(v) : Math.round(v * 100) / 100);
}
function quantiles(vals: number[]): number[] {
  const s = [...vals].sort((a, b) => a - b);
  const set = new Set<number>();
  if (s[0] === 0 && s[s.length - 1] === 1 && s.every(v => v === 0 || v === 1)) return [0.5];
  for (const q of [0.2, 0.35, 0.5, 0.65, 0.8]) set.add(s[Math.min(s.length - 1, Math.floor(q * s.length))]!);
  return [...set];
}

export interface FilterRuleResult {
  text: string;            // "ADX struktur < 22 ditolak"
  featureLabel: string;
  // semua data (train+test), hanya sinyal yang punya fitur ini
  allRemovedLose: number;
  allRemovedWin: number;
  allNetR: number;         // total R yang diselamatkan (+) / hilang (-)
  allWrBefore: number;
  allWrAfter: number;
  // 70% tertua
  trainNetR: number;
  // 30% terbaru
  testRemoved: number;
  testNetR: number;
  verdict: 'lolos' | 'gagal' | 'belum_bisa';
}
export interface FilterScope { label: string; resolved: number; trainN: number; testN: number; rules: FilterRuleResult[] }
export interface FilterSimulation { ready: boolean; message: string | null; scopes: FilterScope[] }

function wr(a: JournalEntry[]): number { return a.length ? Math.round((a.filter(isWin).length / a.length) * 100) : 0; }

function simulateScope(label: string, resolved: JournalEntry[]): FilterScope {
  const sorted = [...resolved].sort((a, b) => a.savedAt - b.savedAt);
  const cut = Math.floor(sorted.length * 0.7);
  const train = sorted.slice(0, cut), test = sorted.slice(cut);
  const found: Array<{ f: Feature; t: number; dir: 'lt' | 'gt'; trainNet: number }> = [];

  for (const f of FEATURES) {
    const tr = train.map(e => ({ e, v: f.get(e) })).filter((x): x is { e: JournalEntry; v: number } => x.v !== undefined);
    if (tr.length < MIN_FEATURED) continue;
    let best: { t: number; dir: 'lt' | 'gt'; trainNet: number } | null = null;
    for (const t of quantiles(tr.map(x => x.v))) {
      for (const dir of ['lt', 'gt'] as const) {
        const removed = tr.filter(x => (dir === 'lt' ? x.v < t : x.v > t)).map(x => x.e);
        if (removed.length < MIN_REMOVED || removed.length > tr.length * MAX_REMOVED_FRAC) continue;
        const net = -sumR(removed);
        if (net > 0 && (!best || net > best.trainNet)) best = { t, dir, trainNet: net };
      }
    }
    if (best) found.push({ f, ...best });
  }
  found.sort((a, b) => b.trainNet - a.trainNet);

  const rules: FilterRuleResult[] = found.slice(0, 5).map(({ f, t, dir, trainNet }) => {
    const hit = (e: JournalEntry) => { const v = f.get(e); return v !== undefined && (dir === 'lt' ? v < t : v > t); };
    const featured = sorted.filter(e => f.get(e) !== undefined);
    const removedAll = featured.filter(hit), keptAll = featured.filter(e => !hit(e));
    const removedTest = test.filter(hit);
    const testNet = -sumR(removedTest);
    const verdict: FilterRuleResult['verdict'] = removedTest.length < MIN_TEST_REMOVED ? 'belum_bisa' : testNet > 0 ? 'lolos' : 'gagal';
    return {
      text: `${f.label} ${dir === 'lt' ? '<' : '>'} ${fmt(t)} ditolak`,
      featureLabel: f.label,
      allRemovedLose: removedAll.filter(e => e.status === 'lose').length,
      allRemovedWin: removedAll.filter(isWin).length,
      allNetR: r1(-sumR(removedAll)),
      allWrBefore: wr(featured),
      allWrAfter: wr(keptAll),
      trainNetR: r1(trainNet),
      testRemoved: removedTest.length,
      testNetR: r1(testNet),
      verdict,
    };
  });
  return { label, resolved: sorted.length, trainN: train.length, testN: test.length, rules };
}

/** Simulator filter: cari aturan tolak-sinyal yang menaikkan hasil, lalu uji di 30% sinyal terbaru. */
export function simulateFilters(entries: JournalEntry[]): FilterSimulation {
  const resolved = entries.filter(isResolved);
  if (resolved.length < MIN_RESOLVED) {
    return { ready: false, message: `Simulator butuh minimal ${MIN_RESOLVED} sinyal selesai (sekarang ${resolved.length}). Di bawah itu pola yang ketemu hampir pasti kebetulan.`, scopes: [] };
  }
  const scopes: FilterScope[] = [simulateScope('SEMUA MENU', resolved)];
  const byMenu = new Map<string, JournalEntry[]>();
  for (const e of resolved) { if (!byMenu.has(e.sourceMenu)) byMenu.set(e.sourceMenu, []); byMenu.get(e.sourceMenu)!.push(e); }
  for (const [m, arr] of byMenu) if (arr.length >= MIN_RESOLVED && byMenu.size > 1) scopes.push(simulateScope(m.toUpperCase(), arr));
  return { ready: true, message: null, scopes };
}

// ─── Analisis komponen skor TA PRO ───
export interface TaComponentSection { label: string; rows: JournalBreakdown[]; hint: string }

export function taComponentAnalysis(entries: JournalEntry[]): TaComponentSection[] {
  const withPts = entries.filter(e => taPtsOf(e));
  if (withPts.length === 0) return [];
  const out: TaComponentSection[] = [];
  for (const c of TA_COMPONENTS) {
    const groups = new Map<string, JournalEntry[]>();
    for (const e of withPts) {
      const v = taPtsOf(e)![c.key];
      const lab = v === null || v === undefined ? 'x (data tidak ada)' : `${v > 0 ? '+' : ''}${v}`;
      if (!groups.has(lab)) groups.set(lab, []);
      groups.get(lab)!.push(e);
    }
    const rows: JournalBreakdown[] = [...groups].map(([label, g]) => {
      const win = g.filter(isWin).length, lose = g.filter(e => e.status === 'lose').length;
      return { label: `${c.label}: ${label}`, total: g.length, win, lose, pending: g.filter(e => e.status === 'pending').length, winRate: win + lose > 0 ? Math.round((win / (win + lose)) * 100) : 0 };
    }).sort((a, b) => (parseFloat(b.label.split(': ')[1]!) || -99) - (parseFloat(a.label.split(': ')[1]!) || -99));
    const dec = (pred: (v: number) => boolean) => withPts.filter(isResolved).filter(e => { const v = taPtsOf(e)![c.key]; return v !== null && v !== undefined && pred(v); });
    const pos = dec(v => v > 0), neg = dec(v => v < 0);
    let hint: string;
    if (pos.length < 10 || neg.length < 10) hint = `Sampel kecil (poin positif ${pos.length}, negatif ${neg.length} sinyal selesai; butuh ≥10 masing-masing).`;
    else {
      const d = wr(pos) - wr(neg);
      hint = d >= 20 ? `✅ Membedakan: poin positif ${wr(pos)}% win vs negatif ${wr(neg)}%.`
        : d <= -20 ? `⚠️ Menyesatkan: poin negatif justru lebih sering menang (${wr(neg)}% vs ${wr(pos)}%). Kandidat komponen yang perlu dirombak.`
        : `Belum membedakan: positif ${wr(pos)}% vs negatif ${wr(neg)}%.`;
    }
    out.push({ label: c.label, rows, hint });
  }
  return out;
}
