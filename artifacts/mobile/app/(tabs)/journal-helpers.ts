import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Tipe data ──────────────────────────────────────────────────────────────

export interface JournalTFIndicator {
  rsi: number;
  atr: number;
  atrPct: number;
  adx: number;
  stochK: number;
  stochD: number;
  macd: number;
  mfi: number;
  cci: number;
  roc: number;
  // FIX (request user, 12 indikator tambahan)
  williamsR: number;
  momentum: number;
  awesomeOscillator: number;
  chaikinMoneyFlow: number;
  obv: number;
  atrSqueeze: number;
  keltnerUpper: number; keltnerMiddle: number; keltnerLower: number;
  bbUpper: number; bbMiddle: number; bbLower: number; bbBandwidth: number;
  trix: number;
  elderBullPower: number; elderBearPower: number;
  vwap: number;
  cvd: number;
  openInterest: number | null;
}

export interface JournalTechnicalSnapshot {
  struktur: JournalTFIndicator;
  eksekusi: JournalTFIndicator;
}

export type JournalStatus = 'pending' | 'win_tp1' | 'win_tp2' | 'lose' | 'expired';

export const SOURCE_MENUS = [
  // FIX (request user): 'Counter Scalping' di-rename jadi 'Sniper Breakout'
  // (logic diganti total: Multi-Factor Score + limit retest -> M1/M5/M15
  // breakout pakai stop order). Nama LAMA SENGAJA DIPERTAHANIN di type ini
  // biar entry Journal yang UDAH TERSIMPAN gak rusak/ilang dari tampilan —
  // kalau mau bersih total, pakai tombol Reset Data di tab Ringkasan.
  'Sniper Breakout', 'Scalping', 'Counter Scalping',
  // BARU (request user, menu Money Magnet Scalping — M30 trend + M1 eksekusi)
  'Money Magnet Scalping',
] as const;
export type SourceMenu = typeof SOURCE_MENUS[number];

// ═══ Scalping Fakeout M15 (request user 2026-10-21, ganti total Scalping RSI v2) ═══
// Label lama (RSI v1/v2, Fakeout) tidak dipakai lagi; entry lama di Journal tetap tampil dengan labelnya sendiri.
export const SCALPING_SKILL_FAKEOUT = 'Scalping Fakeout (M15)'; // LEGACY (diganti Money Magnet 2026-10-21): entry lama di Journal tetap tampil dengan label ini
// Scalping Money Magnet H4->M30 (2026-10-21) — LEGACY (diganti CRT D1->M15 2026-10-22): entry lama di Journal tetap tampil dengan label ini.
export const SCALPING_SKILL_MAGNET = 'Scalping Money Magnet (H4→M30)';
// Scalping CRT D1->M15 versi longgar level 4 original, tanpa filter (request user 2026-10-22, ganti total Money Magnet).
// Label WAJIB sama dengan CRT_PARAMS.SKILL_LABEL di api-server/src/lib/crt-engine.ts.
export const SCALPING_SKILL_CRT = 'Scalping CRT D1→M15 (Longgar-4)';

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
  sourceSkill: string; // e.g. 'Sniper Breakout (Anticipation H1+M15)', 'Money Magnet', 'Money Magnet 2'

  // Harga & level
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
  currentPriceAtSignal: number; // harga pas sinyal diberikan
  rr1?: number;
  orderType?: 'stop' | 'limit'; // WAJIB buat evaluasi akurat — nentuin arah cek "entry udah ke-hit belum" (limit: harga harus DATENG ke entry; stop: harga harus TEMBUS ke arah breakout). Default 'limit' kalau gak ada (mayoritas skill basis breakout+retest limit order).
  btcAligned?: boolean; // BTC Correlation pas sinyal ini diberikan — informasional, buat riset kombinasi kondisi win/lose
  btcBias?: 'bullish' | 'bearish' | 'ranging';
  d1Aligned?: boolean; // S-006: Filter arah D1 Sniper Breakout — true = searah D1, false = MELAWAN D1 (ada peringatan), undefined = D1 datar / bukan Sniper
  rsi4H?: number; // LEGACY Scalping RSI (2026-10-20, sudah diganti Fakeout): RSI periode 14 candle closed saat sinyal
  rsi1H?: number;
  rsi15M?: number;
  // Scalping RSI v2 Gate (2026-10-20): metrik gate saat sinyal — buat forward test & riset. 'pass' = SELL lolos gate, 'na' = BUY (gate gak berlaku).
  scalpGate?: 'pass' | 'na';
  // Gate v2 BUY (2026-10-20): aturan yang lolos + metriknya (hanya terisi untuk BUY)
  buyRule?: 'A' | 'B' | 'AB';
  gateAdx1h?: number;             // ADX(14) 1H koin (aturan A: >= 25)
  gateRsi15Delta?: number;        // RSI M15 sekarang - 3 candle closed lalu (aturan A: > 0)
  gateBtcRet24h?: number;         // return BTC 24 jam, persen (aturan A & B: < 0)
  gateBtc4hAboveEma200?: boolean; // BTC 4H close > EMA200 4H (aturan B)
  gateEma50DistAtr?: number; // |entry - EMA50 1H| / ATR M15 (aturan: <= 0.5)
  gateRange12Atr?: number;   // range 12 candle M15 closed / ATR M15 (aturan: < 3.0)
  entryDistAtr?: number;     // |harga sinyal - entry limit| / ATR M15
  // Scalping Fakeout M15 (2026-10-21): batas waktu fill limit + metrik setup. Dipakai journalEvaluate (expired) & riset.
  validUntil?: number;       // ms epoch; limit yang belum fill sampai waktu ini = EXPIRED (kalau kosong: aturan lama 24 jam)
  fkVersion?: string;
  fkBreakoutSide?: 'up' | 'down';
  fkLevel?: number;
  fkBreakoutTime?: number;
  fkFailTime?: number;
  fkVolX?: number;
  fkRiskAtr?: number;
  fkLvlEmaDistAtr?: number;
  fkRsi1h?: number;
  fkCandlesSinceFail?: number;
  // Scalping Money Magnet H4->M30 (2026-10-21): metrik setup saat sinyal, buat forward test & riset.
  mmVersion?: string;
  mmAdxH4?: number;                  // ADX(14) H4 closed (aturan > 25)
  mmMagnetLevelUsed?: 'broken_level' | 'ema26'; // entry di level breakout atau EMA26 M30
  mmH4Cross?: number;                // crossing close vs EMA26 H4 per 20 candle (info, > 3 = agak exhausted)
  mmForceIndex?: number;             // Force Index (EMA2) M30 di candle sebelum retest
  mmConfluencePct?: number;          // |level - EMA26 M30| / level, persen (aturan <= 1)
  mmStochK?: number;                 // Stochastic Slow (5,3,3) M30 saat retest (info)
  mmStochD?: number;
  // Scalping CRT D1->M15 (2026-10-22): metrik setup saat sinyal, buat forward test & riset. validUntil (di atas) = batas fill limit.
  crtVersion?: string;
  crtOrderNo?: number;       // order ke-berapa di hari+arah itu (urutan waktu MSS)
  crtD1RangeAtr?: number;    // range D1 kemarin / ATR14 D1
  crtDepthPct?: number;      // kedalaman sweep (%)
  crtPosPct?: number;        // posisi entry di range D1 (%), 0 = ekstrem sweep
  crtRoomR?: number;         // ruang ke High/Low D1 dalam R
  crtRiskAtr?: number;       // risk / ATR14 M15
  crtMssTime?: number;       // open time candle MSS (ms)
  // Skor TA PRO (Fitur 5) saat sinyal disimpan (info, TIDAK memblokir). Kosong kalau fetch gagal.
  taLongScore?: number;      // 0-9
  taLongGrade?: 'A+' | 'B' | 'Tidak layak';
  taShortScore?: number;
  taShortGrade?: 'A+' | 'B' | 'Tidak layak';
  taLongPts?: string;        // poin per komponen: structH4|structH1|oi|lsr|funding (x = data tidak ada)
  taShortPts?: string;
  taScoreAt?: number;        // ms epoch saat skor diambil
  d1ChangePct?: number; // perubahan harga 3 candle D1 saat sinyal (%)
  entryHitAt?: number; // timestamp candle saat entry pertama kali kehit — dipake fitur Monitoring (real-time health tracking posisi aktif) DAN statistik timing (request user)
  resolvedAt?: number; // timestamp candle saat SL/TP kena — buat statistik "rata-rata berapa jam sampe resolve"
  oiAtEntryHit?: number; // Open Interest baseline saat entry kehit

  // TF
  tfStruktur: string;
  tfEksekusi?: string; // kosong kalau single-TF (mode sideways Momentum Hunter)

  // Status SINYAL saat disimpan (request user, fitur "Masukin Semua ke
  // Journal") — BEDA dari `status` di bawah (yang itu status EVALUASI
  // win/lose). Ini status dari hasil scan: 'in_zone' (siap entry sekarang),
  // 'approaching' (breakout udah kejadian, nunggu retest), 'waiting' (belum
  // ada breakout sama sekali). Optional — entry yang disimpan manual satuan
  // (tombol "Simpan ke Journal" biasa) gak perlu isi ini, dia SELALU in_zone.
  signalStatus?: 'in_zone' | 'approaching' | 'waiting';

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

// Nama menu LAMA yang sekarang udah dihapus total (request user, "bersihin
// semuanya") — Journal Entry dengan sourceMenu ini bakal DIBUANG PERMANEN
// dari storage begitu journalLoadAll dipanggil pertama kali setelah update.
const REMOVED_MENUS = new Set(['Breakout Entry', 'Sniper Entry', 'Extreme Scalping', 'Momentum Hunter']);

// BARU (request user, kasus asli: hasil "Evaluasi Semua" ilang abis ditutup
// app -- ternyata nulis ke storage gagal diem-diem, gak ada tanda apa-apa).
// Semua fungsi penulis di file ini sekarang lapor ke sini tiap abis nyoba
// nulis -- UI (journal.tsx, tombol "Simpan ke Journal" di tiap menu) bisa
// ngecek status ini abis manggil fungsi save/update, terus kasih tau user
// kalau GAGAL (bukan ditelen diem-diem) atau ada entry lama yang KEBUANG
// karena storage udah penuh (300 cap).
export interface JournalWriteStatus {
  ok: boolean;
  error?: string;
  droppedCount: number; // entry lama yang kebuang karena cap 300 (0 kalau gak ada)
  timestamp: number;
}
let lastWriteStatus: JournalWriteStatus = { ok: true, droppedCount: 0, timestamp: 0 };
export function journalGetLastWriteStatus(): JournalWriteStatus {
  return lastWriteStatus;
}
async function persistJournal(data: JournalEntry[], droppedCount = 0): Promise<boolean> {
  try {
    await AsyncStorage.setItem(JOURNAL_KEY, JSON.stringify(data));
    lastWriteStatus = { ok: true, droppedCount, timestamp: Date.now() };
    return true;
  } catch (e) {
    // FIX: dulu try/catch kosong (ditelen diem-diem). Sekarang dicatet biar
    // UI bisa nampilin "gagal simpan" -- bukan keliatan berhasil padahal enggak.
    lastWriteStatus = { ok: false, error: e instanceof Error ? e.message : 'Unknown error', droppedCount, timestamp: Date.now() };
    return false;
  }
}

export async function journalLoadAll(): Promise<JournalEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(JOURNAL_KEY);
    const all: JournalEntry[] = raw ? JSON.parse(raw) : [];
    // Pembersihan permanen (request user 2026-10-18): logic lama "Sniper Breakout
    // (M30 Fresh Breakout)" sudah tidak dipakai. Semua entri berlabel itu
    // (pending, WIN, LOSE, EXPIRED) dibuang dari storage biar gak bikin bingung.
    const isOldM30Sniper = (e: JournalEntry) =>
      typeof e.sourceSkill === 'string' && e.sourceSkill.includes('M30 Fresh Breakout');
    const kept = all.filter(e => !REMOVED_MENUS.has(e.sourceMenu as string) && !isOldM30Sniper(e));
    // Rapikan label TF Money Magnet lama: tersimpan 'M30' padahal logic H1->M5.
    // Cuma label tampilan; evaluasi WIN/LOSE pakai tfEksekusi ('5M') jadi tidak berubah.
    let relabeled = 0;
    const cleaned = kept.map(e => {
      if (e.sourceMenu === 'Money Magnet Scalping' && e.tfStruktur === 'M30') { relabeled++; return { ...e, tfStruktur: 'H1' }; }
      return e;
    });
    if (cleaned.length !== all.length || relabeled > 0) {
      // Ada entry lama yang kebuang — simpan balik biar PERMANEN kehapus
      // dari storage, bukan cuma di-filter pas ditampilin doang.
      await persistJournal(cleaned);
    }
    return cleaned;
  } catch {
    return [];
  }
}

/**
 * REVISI (request user): dedup sekarang berbasis symbol+bias+sourceSkill+
 * orderType (buy/sell DAN stop/limit) -- entryPrice SENGAJA DIHAPUS dari
 * kunci (harga beda tetep dianggap duplikat). Skill beda TETEP dianggap
 * sinyal terpisah (Money Magnet & Money Magnet 2 kasih sinyal buat koin yang sama
 * = bukan duplikat). Dedup ini CUMA berlaku ke sinyal yang kesimpen dalam
 * 24 jam terakhir -- lewat dari itu, sinyal "sama" boleh disimpen lagi
 * (dianggap kejadian baru, bukan re-save yang gak sengaja).
 */
function signalDedupKey(e: Pick<JournalEntry, 'symbol' | 'bias' | 'sourceSkill' | 'orderType'> & { entryPrice?: number }): string {
  const orderType = e.orderType ?? 'limit';
  // Fakeout: satu koin bisa punya beberapa setup berbeda dalam 24 jam (level beda) -> entryPrice ikut kunci. Setup yang SAMA tetap ke-dedupe.
  const lv = (e.sourceSkill === SCALPING_SKILL_FAKEOUT || e.sourceSkill === SCALPING_SKILL_CRT) ? `|${e.entryPrice}` : '';
  return `${e.symbol}|${e.bias}|${e.sourceSkill}|${orderType}${lv}`;
}

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function journalSave(entry: JournalEntry): Promise<JournalEntry[]> {
  const all = await journalLoadAll();
  const cutoff = Date.now() - DEDUP_WINDOW_MS;
  const key = signalDedupKey(entry);
  const isDuplicate = all.some(e => e.savedAt >= cutoff && signalDedupKey(e) === key);
  if (isDuplicate) return all; // udah ada sinyal identik (koin+bias+skill+orderType) dalam 24 jam terakhir
  // Max 1500 entri (request user, naik dari 300 -- dihitung biar masih aman
  // di bawah limit localStorage: ~1,9KB/entry x 1500 = ~2,85MB).
  const beforeCount = all.length + 1;
  const updated = [entry, ...all].slice(0, 1500);
  const droppedCount = Math.max(0, beforeCount - updated.length);
  await persistJournal(updated, droppedCount);
  return updated;
}

/**
 * Simpan BANYAK entry sekaligus, 1x write ke storage doang (request user,
 * "Masukin Semua ke Journal" — biar gak satu-satu). Entry BARU ditaruh di
 * depan (paling baru duluan), sama urutan kayak journalSave biasa.
 *
 * FIX (request user, "pastikan gak ada yang terduplikat"): filter 2 lapis
 * sebelum nyimpen — (1) dalam batch yang mau disimpen sendiri (misal 2 skill
 * kebetulan kasih sinyal sama), (2) terhadap entry yang UDAH ADA di storage
 * DALAM 24 JAM TERAKHIR (request user — lewat 24 jam, sinyal "sama" boleh
 * disimpen lagi, dianggap kejadian baru bukan re-save). Return jumlah yang
 * GENUINELY baru disimpen (dipake buat notif UI).
 */
export async function journalSaveMany(entries: JournalEntry[]): Promise<{ all: JournalEntry[]; savedCount: number; skippedCount: number }> {
  const all = await journalLoadAll();
  const cutoff = Date.now() - DEDUP_WINDOW_MS;
  const existingKeys = new Set(all.filter(e => e.savedAt >= cutoff).map(signalDedupKey));
  const seenInBatch = new Set<string>();
  const deduped: JournalEntry[] = [];
  for (const e of entries) {
    const key = signalDedupKey(e);
    if (existingKeys.has(key) || seenInBatch.has(key)) continue; // udah ada di storage (24 jam terakhir) ATAU duplikat sesama batch ini
    seenInBatch.add(key);
    deduped.push(e);
  }
  // Max 1500 entri (request user, naik dari 300 -- lihat journalSave).
  const beforeCount = deduped.length + all.length;
  const updated = [...deduped, ...all].slice(0, 1500);
  const droppedCount = Math.max(0, beforeCount - updated.length);
  await persistJournal(updated, droppedCount);
  return { all: updated, savedCount: deduped.length, skippedCount: entries.length - deduped.length };
}

export async function journalUpdate(id: string, patch: Partial<JournalEntry>): Promise<JournalEntry[]> {
  const all = await journalLoadAll();
  const updated = all.map(e => e.id === id ? { ...e, ...patch } : e);
  await persistJournal(updated);
  return updated;
}

/**
 * Update banyak entri sekaligus, 1x write ke storage doang (bukan
 * journalUpdate dipanggil berkali-kali yang tiap panggilan baca+tulis ULANG
 * seluruh array). Dipake buat "Evaluasi Semua" (request user, biar gak satu-satu).
 */
export async function journalUpdateMany(patches: { id: string; patch: Partial<JournalEntry> }[]): Promise<JournalEntry[]> {
  const all = await journalLoadAll();
  const patchMap = new Map(patches.map(p => [p.id, p.patch]));
  const updated = all.map(e => patchMap.has(e.id) ? { ...e, ...patchMap.get(e.id) } : e);
  await persistJournal(updated);
  return updated;
}

export async function journalDelete(id: string): Promise<JournalEntry[]> {
  const all = await journalLoadAll();
  const updated = all.filter(e => e.id !== id);
  await persistJournal(updated);
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

const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000,
};

/**
 * Candle tempat entry ke-fill sering juga menyentuh SL/TP. Urutan di dalam
 * candle tidak diketahui, jadi hasilnya bisa WIN/LOSE palsu (SL/TP kesentuh
 * SEBELUM entry fill). Di sini candle itu dipecah ke 1m: cari menit fill
 * pertama, baru cek SL/TP mulai menit itu. Return:
 *   - objek hasil  -> resolve (WIN/LOSE) dihitung dari menit
 *   - 'unresolved' -> entry fill, tapi SL/TP belum kesentuh SETELAH fill di candle ini
 *   - null         -> gagal ambil 1m, pakai perilaku lama
 */
async function refineFillCandle(
  entry: JournalEntry, orderType: string, openTime: number, intervalMs: number,
  risk: number, evalAt: string,
): Promise<Partial<JournalEntry> | 'unresolved' | null> {
  try {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${entry.symbol}&interval=1m&startTime=${openTime}&endTime=${openTime + intervalMs - 1}&limit=1500`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const mins: unknown = await res.json();
    if (!Array.isArray(mins) || mins.length === 0) return null;
    let filledAt: number | undefined;
    for (const m of mins as (string | number)[][]) {
      const t = Number(m[0]), high = Number(m[2]), low = Number(m[3]);
      if (filledAt === undefined) {
        const filled =
          (entry.bias === 'bullish' && orderType === 'limit') ? low <= entry.entryPrice :
          (entry.bias === 'bearish' && orderType === 'limit') ? high >= entry.entryPrice :
          (entry.bias === 'bullish' && orderType === 'stop') ? high >= entry.entryPrice :
          low <= entry.entryPrice;
        if (!filled) continue;
        filledAt = t;
      }
      // SL dicek dulu (konservatif) kalau satu menit menyentuh SL dan TP.
      const sl = entry.bias === 'bullish' ? low <= entry.stopLoss : high >= entry.stopLoss;
      if (sl) return { status: 'lose', exitPrice: entry.stopLoss, rr: -1, evaluatedAt: evalAt, entryHitAt: filledAt, resolvedAt: t };
      const tp2 = entry.takeProfit2 !== undefined && entry.takeProfit2 !== 0 &&
        (entry.bias === 'bullish' ? high >= entry.takeProfit2 : low <= entry.takeProfit2);
      if (tp2) {
        const rr = Math.round((Math.abs(entry.takeProfit2! - entry.entryPrice) / risk) * 10) / 10;
        return { status: 'win_tp2', exitPrice: entry.takeProfit2, rr, evaluatedAt: evalAt, entryHitAt: filledAt, resolvedAt: t };
      }
      const tp1 = entry.bias === 'bullish' ? high >= entry.takeProfit1 : low <= entry.takeProfit1;
      if (tp1) {
        const rr = Math.round((Math.abs(entry.takeProfit1 - entry.entryPrice) / risk) * 10) / 10;
        return { status: 'win_tp1', exitPrice: entry.takeProfit1, rr, evaluatedAt: evalAt, entryHitAt: filledAt, resolvedAt: t };
      }
    }
    return filledAt === undefined ? null : 'unresolved';
  } catch {
    return null;
  }
}

export async function journalEvaluate(entry: JournalEntry): Promise<Partial<JournalEntry>> {
  try {
    const { interval, limit } = evalIntervalFor(entry);
    const risk = Math.abs(entry.entryPrice - entry.stopLoss);
    const evalAt = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
    const now = Date.now();
    const orderType = entry.orderType ?? 'limit'; // default limit (mayoritas skill basis breakout+retest limit order)

    // Fix bug (request user, "jangan sampe baca win/lose padahal entry belum
    // ke-hit"): kode LAMA langsung ngecek SL/TP dari harga sekarang tanpa
    // mastiin entry-nya BENERAN ke-fill dulu. Kalau LIMIT (nunggu harga balik
    // ke zona) tapi harga malah lanjut jalan terus TANPA PERNAH balik ke
    // level entry, order itu di real trading GAK PERNAH KE-EKSEKUSI — posisi
    // gak pernah kebuka. Tapi kalau cuma ngecek harga vs TP, bisa aja
    // ke-baca "WIN" padahal gak pernah ada posisi beneran.
    //   LIMIT bullish: entry ke-fill kalau harga TURUN nyampe/ngelewatin entry (low <= entry)
    //   LIMIT bearish: entry ke-fill kalau harga NAIK nyampe/ngelewatin entry (high >= entry)
    //   STOP bullish: entry ke-fill kalau harga TEMBUS NAIK ngelewatin entry (high >= entry)
    //   STOP bearish: entry ke-fill kalau harga TEMBUS TURUN ngelewatin entry (low <= entry)
    let entryHit = false;
    let entryHitAtTs: number | undefined; // timestamp candle open pas entry kehit — buat statistik timing (request user)

    let cursor = entry.savedAt;
    const maxIterations = 20; // safety cap — cakupan realistis: M1 20x1500candle ≈ 20 hari, cukup buat sinyal scalping/intraday manapun

    for (let iter = 0; iter < maxIterations && cursor < now; iter++) {
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${entry.symbol}&interval=${interval}&startTime=${cursor}&endTime=${now}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) return { status: 'pending' };
      const klines: number[][] = await res.json();
      if (!Array.isArray(klines) || klines.length === 0) break; // gak ada candle di rentang ini — normal kalau sinyal baru aja disimpen (belum cukup waktu buat 1 candle kebentuk), BUKAN tanda "data abis"

      for (const k of klines) {
        const openTime = k[0] as number;
        const high = k[2] as number, low = k[3] as number;

        // Fakeout: jendela fill terbatas (validUntil). Candle yang dibuka SETELAH batas = limit sudah dibatalkan -> EXPIRED.
        if (!entryHit && entry.validUntil !== undefined && openTime >= entry.validUntil) {
          return { status: 'expired', evaluatedAt: evalAt };
        }

        if (!entryHit) {
          const filled =
            (entry.bias === 'bullish' && orderType === 'limit') ? low <= entry.entryPrice :
            (entry.bias === 'bearish' && orderType === 'limit') ? high >= entry.entryPrice :
            (entry.bias === 'bullish' && orderType === 'stop') ? high >= entry.entryPrice :
            low <= entry.entryPrice; // bearish + stop
          if (!filled) continue; // entry belum ke-hit di candle ini, skip — JANGAN cek SL/TP dulu
          entryHit = true;
          entryHitAtTs = openTime;
          // Candle fill yang juga menyentuh SL/TP: urutan intra-candle tidak
          // diketahui, jadi pecah ke 1m (perbaikan audit 2026-10-18).
          const intervalMs = INTERVAL_MS[interval] ?? 0;
          const touchesExit = entry.bias === 'bullish'
            ? (low <= entry.stopLoss || high >= entry.takeProfit1)
            : (high >= entry.stopLoss || low <= entry.takeProfit1);
          if (intervalMs > 60_000 && touchesExit) {
            const refined = await refineFillCandle(entry, orderType, openTime, intervalMs, risk, evalAt);
            if (refined === 'unresolved') continue;
            if (refined) return refined;
          }
        }

        // Entry udah ke-hit (baik di candle ini atau candle sebelumnya) —
        // BARU sekarang valid buat ngecek SL/TP.
        if (entry.bias === 'bullish') {
          if (low <= entry.stopLoss) return { status: 'lose', exitPrice: entry.stopLoss, rr: -1, evaluatedAt: evalAt, entryHitAt: entryHitAtTs, resolvedAt: openTime };
          if (entry.takeProfit2 && high >= entry.takeProfit2) return { status: 'win_tp2', exitPrice: entry.takeProfit2, rr: Math.round(((entry.takeProfit2 - entry.entryPrice) / risk) * 10) / 10, evaluatedAt: evalAt, entryHitAt: entryHitAtTs, resolvedAt: openTime };
          if (high >= entry.takeProfit1) return { status: 'win_tp1', exitPrice: entry.takeProfit1, rr: Math.round(((entry.takeProfit1 - entry.entryPrice) / risk) * 10) / 10, evaluatedAt: evalAt, entryHitAt: entryHitAtTs, resolvedAt: openTime };
        } else {
          if (high >= entry.stopLoss) return { status: 'lose', exitPrice: entry.stopLoss, rr: -1, evaluatedAt: evalAt, entryHitAt: entryHitAtTs, resolvedAt: openTime };
          if (entry.takeProfit2 && low <= entry.takeProfit2) return { status: 'win_tp2', exitPrice: entry.takeProfit2, rr: Math.round(((entry.entryPrice - entry.takeProfit2) / risk) * 10) / 10, evaluatedAt: evalAt, entryHitAt: entryHitAtTs, resolvedAt: openTime };
          if (low <= entry.takeProfit1) return { status: 'win_tp1', exitPrice: entry.takeProfit1, rr: Math.round(((entry.entryPrice - entry.takeProfit1) / risk) * 10) / 10, evaluatedAt: evalAt, entryHitAt: entryHitAtTs, resolvedAt: openTime };
        }
      }

      // Majuin cursor ke tepat SETELAH closeTime candle TERAKHIR yang baru
      // diproses (k[6] = closeTime), biar batch berikutnya gak fetch ulang
      // candle yang sama.
      const lastCloseTime = klines[klines.length - 1]![6] as number;
      cursor = lastCloseTime + 1;
      if (cursor >= now) break; // udah nyampe waktu sekarang, gak ada candle baru lagi buat dicek SEKARANG
      if (iter < maxIterations - 1) await new Promise(r => setTimeout(r, 150)); // jaga rate limit Binance
    }

    // Fix bug KONSEPTUAL (ketemu user, "baru disimpen langsung expired"):
    // "udah nyampe waktu sekarang" itu BUKAN patokan yang valid buat expired —
    // data harga itu LIVE/terus berjalan, jadi "udah nyampe now" SELALU benar
    // buat SEMUA sinyal kapanpun dievaluasi (baru disimpen 1 menit lalu ATAU
    // udah seminggu, dua-duanya "nyampe now" begitu function ini jalan). Yang
    // BENERAN relevan buat nentuin "expired" itu SEBERAPA LAMA WAKTU UDAH
    // LEWAT sejak disimpen — kasih kesempatan wajar dulu (24 jam, request
    // user) sebelum nyerah bilang "kemungkinan gak akan kesentuh lagi".
    const maxValidityHours = 24;
    const elapsedHours = (now - entry.savedAt) / (1000 * 60 * 60);
    if (!entryHit) {
      // Fakeout punya batas sendiri (validUntil); lainnya tetap 24 jam sejak disimpan.
      const expiredNow = entry.validUntil !== undefined ? now >= entry.validUntil : elapsedHours >= maxValidityHours;
      if (expiredNow) return { status: 'expired', evaluatedAt: evalAt };
      return { status: 'pending' };
    }
    // Entry udah kehit tapi belum resolve (masih pending) — tetep simpen
    // entryHitAt-nya biar data timing (request user) kekumpul dari sekarang,
    // gak perlu nunggu sampe menang/kalah dulu.
    return { status: 'pending', entryHitAt: entryHitAtTs };
  } catch {
    return { status: 'pending' };
  }
}

// ─── Analisa pasca-trade otomatis (request user, "Menu Journal AI Agent" —
// cek 1 jam setelah SL/TP kena, apakah market beneran lanjut/balik) ────────

function getFollowupApiUrl(path: string): string {
  return typeof window !== 'undefined'
    ? `${window.location.origin}${path}`
    : `https://${process.env['EXPO_PUBLIC_DOMAIN']}${path}`;
}

/**
 * Daftarin entry yang BARU RESOLVE (status berubah dari pending ke
 * win_tp1/win_tp2/lose) ke server — server bakal cek harga 1 jam kemudian
 * via background worker. Dipanggil OTOMATIS begitu journalEvaluate ngasih
 * status non-pending (lihat journal.tsx handleEvaluate/handleEvaluateAll).
 * Gagal DIAM-DIAM (gak throw) — ini fitur analisa TAMBAHAN, bukan boleh
 * ganggu alur evaluasi utama kalau server API lagi bermasalah.
 */
export async function registerFollowup(entry: JournalEntry, patch: Partial<JournalEntry>): Promise<void> {
  const status = patch.status;
  if (status !== 'win_tp1' && status !== 'win_tp2' && status !== 'lose') return; // cuma resolve yang didaftarin
  const resolvedAt = patch.resolvedAt;
  const exitPrice = patch.exitPrice;
  if (!resolvedAt || exitPrice === undefined) return; // data gak lengkap, skip diam-diam

  try {
    await fetch(getFollowupApiUrl('/api/journal/register-followup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        journalEntryId: entry.id,
        symbol: entry.symbol,
        bias: entry.bias,
        sourceMenu: entry.sourceMenu,
        sourceSkill: entry.sourceSkill,
        resolvedStatus: status,
        resolvedPrice: exitPrice,
        resolvedAt,
        atrStrukturAtSignal: entry.technicalSnapshot?.struktur?.atr,
      }),
    });
  } catch {
    // diam-diam gagal — fitur analisa tambahan, gak boleh ganggu evaluasi utama
  }
}

export interface SignalFollowupResult {
  journalEntryId: string;
  symbol: string;
  bias: string;
  resolvedStatus: string;
  resolvedPrice: number;
  checkedAt: string | null;
  checkPrice1h: number | null;
  priceChangePct: number | null;
  priceChangeAtrRatio: number | null;
  verdict: string | null;
  verdictNote: string | null;
  isPending: boolean;
}

/**
 * Fetch hasil followup buat sekumpulan entry (dipanggil pas buka tab Journal
 * "Ringkasan"/list, biar bisa gabungin hasil analisa pasca-trade ke tampilan).
 * Return map kosong kalau gagal fetch (fail-safe, gak throw).
 */
export async function fetchFollowups(journalEntryIds: string[]): Promise<Map<string, SignalFollowupResult>> {
  if (journalEntryIds.length === 0) return new Map();
  try {
    const idsParam = journalEntryIds.join(',');
    const res = await fetch(getFollowupApiUrl(`/api/journal/followups?ids=${encodeURIComponent(idsParam)}`));
    if (!res.ok) return new Map();
    const data = await res.json() as { followups: SignalFollowupResult[] };
    return new Map(data.followups.map(f => [f.journalEntryId, f]));
  } catch {
    return new Map();
  }
}

/**
 * FIX (ketemu user — "apakah SL/TP setelah 1 jam udah masuk analisa jurnal?
 * karena itu FATAL buat nentuin kedepannya"): SEBELUMNYA data followup CUMA
 * tampil di CARD INDIVIDUAL per sinyal, GAK PERNAH DIAGREGASI jadi pola
 * menyeluruh. Padahal justru AGREGAT-nya yang berguna buat pengembangan:
 * "dari SEKIAN lose, berapa % yang ternyata struktur kita BENAR tapi SL
 * kepencet duluan?" vs "berapa % yang struktur kita emang SALAH BACA?".
 *
 * Verdict (dari server, lihat computeFollowupVerdict di routes/journal-followup.ts):
 * - struktur_benar_sl_prematur   : LOSE tapi market lanjut ke arah bias -> SL kekencengan / entry kecepetan
 * - struktur_salah_konfirmasi    : LOSE dan market gak lanjut -> bacaan struktur emang salah
 * - momentum_lanjut_rr_konservatif: WIN tapi momentum masih lanjut -> RR bisa dinaikin
 * - momentum_habis_rr_pas        : WIN dan momentum udah habis -> RR udah pas
 * - noise_gak_signifikan         : pergerakan < 0.5x ATR, gak cukup buat disimpulkan
 */
export interface FollowupAggregate {
  totalChecked: number; // yang UDAH selesai dicek server (isPending false)
  totalPending: number;
  strukturBenarSlPrematur: number;
  strukturSalahKonfirmasi: number;
  momentumLanjutRrKonservatif: number;
  momentumHabisRrPas: number;
  noiseGakSignifikan: number;
  // Insight siap-tampil, dihitung dari proporsi di atas
  insights: string[];
}

export function aggregateFollowups(
  entries: JournalEntry[],
  followups: Map<string, SignalFollowupResult>,
): FollowupAggregate {
  let totalChecked = 0, totalPending = 0;
  let slPrematur = 0, strukturSalah = 0, rrKonservatif = 0, rrPas = 0, noise = 0;

  for (const e of entries) {
    const f = followups.get(e.id);
    if (!f) continue;
    if (f.isPending) { totalPending++; continue; }
    totalChecked++;
    switch (f.verdict) {
      case 'struktur_benar_sl_prematur': slPrematur++; break;
      case 'struktur_salah_konfirmasi': strukturSalah++; break;
      case 'momentum_lanjut_rr_konservatif': rrKonservatif++; break;
      case 'momentum_habis_rr_pas': rrPas++; break;
      case 'noise_gak_signifikan': noise++; break;
      default: break;
    }
  }

  const insights: string[] = [];
  const totalLoseVerdicts = slPrematur + strukturSalah;
  const totalWinVerdicts = rrKonservatif + rrPas;

  if (totalChecked < 5) {
    insights.push(`Baru ${totalChecked} sinyal yang selesai dicek 1 jam setelah resolve — belum cukup buat nyimpulin pola. Kumpulin data lagi.`);
  } else {
    if (totalLoseVerdicts >= 3) {
      const pctPrematur = Math.round((slPrematur / totalLoseVerdicts) * 100);
      if (pctPrematur >= 60) {
        insights.push(`🔴 PENTING: ${pctPrematur}% dari LOSE (${slPrematur} dari ${totalLoseVerdicts}) itu ternyata ARAH BACAAN KITA BENAR — market lanjut searah bias 1 jam setelah SL kena. Artinya masalahnya BUKAN di analisa struktur, tapi di SL KEKENCENGAN atau ENTRY KECEPETAN. Prioritas perbaikan: perlebar SL atau tunggu konfirmasi lebih matang sebelum entry.`);
      } else if (pctPrematur <= 40) {
        insights.push(`🔴 PENTING: ${100 - pctPrematur}% dari LOSE (${strukturSalah} dari ${totalLoseVerdicts}) itu market GAK lanjut ke arah bias — bacaan struktur/arahnya emang salah. Prioritas perbaikan: cara analisa struktur & validasi breakout-nya, BUKAN sekadar setelan SL.`);
      } else {
        insights.push(`Dari ${totalLoseVerdicts} LOSE yang udah dicek: ${slPrematur} karena SL prematur (arah benar), ${strukturSalah} karena struktur salah baca — seimbang, perlu perbaikan di DUA sisi (SL/entry timing DAN validasi struktur).`);
      }
    }
    if (totalWinVerdicts >= 3) {
      const pctKonservatif = Math.round((rrKonservatif / totalWinVerdicts) * 100);
      if (pctKonservatif >= 60) {
        insights.push(`💡 ${pctKonservatif}% dari WIN (${rrKonservatif} dari ${totalWinVerdicts}) itu momentum MASIH LANJUT setelah TP kena — RR sekarang kekonservatifan, TP kepotong duluan. Pertimbangkan naikin RR (misal 1:3) buat kondisi serupa.`);
      } else {
        insights.push(`RR sekarang udah pas: ${rrPas} dari ${totalWinVerdicts} WIN itu momentum udah habis pas TP kena (TP di titik yang tepat).`);
      }
    }
    if (noise > totalChecked * 0.5) {
      insights.push(`⚠️ ${noise} dari ${totalChecked} followup hasilnya "noise" (pergerakan <0.5x ATR dalam 1 jam) — market lagi banyak konsolidasi/sideways, sinyal breakout emang kurang cocok di kondisi ini.`);
    }
  }

  return {
    totalChecked, totalPending,
    strukturBenarSlPrematur: slPrematur,
    strukturSalahKonfirmasi: strukturSalah,
    momentumLanjutRrKonservatif: rrKonservatif,
    momentumHabisRrPas: rrPas,
    noiseGakSignifikan: noise,
    insights,
  };
}


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

// ─── Ringkasan simpel — buat non-teknis, gampang dicerna cepat ────────────

export interface SimpleVerdict {
  label: string; // nama menu/skill
  total: number;
  winRate: number; // dari yang udah decided (win+lose), 0 kalau belum ada yang decided
  decided: number; // win+lose (yang udah dievaluasi tuntas)
  verdict: 'bagus' | 'cukup' | 'perlu_evaluasi' | 'data_kurang'; // <5 sinyal decided = data_kurang
}

function toVerdict(b: JournalBreakdown): SimpleVerdict {
  const decided = b.win + b.lose;
  let verdict: SimpleVerdict['verdict'];
  if (decided < 5) verdict = 'data_kurang'; // kurang dari 5 sinyal decided — belum cukup buat disimpulkan
  else if (b.winRate >= 55) verdict = 'bagus';
  else if (b.winRate >= 40) verdict = 'cukup';
  else verdict = 'perlu_evaluasi';
  return { label: b.label, total: b.total, winRate: b.winRate, decided, verdict };
}

// ═══ FORWARD TEST Scalping (request user 2026-10-21) ═══
// Dipakai buat strategi yang sedang jadi Menu Scalping: sekarang CRT D1->M15 (sebelumnya Money Magnet H4->M30 dan Fakeout M15, dibuang dari menu).
// Kriteria (dipertahankan): setelah >= 100 sinyal berlabel strategi itu resolve, win rate > 38% DAN avgR (RR 1:2, setelah biaya) > 0 -> dipertahankan.
// Kalau tidak -> evaluasi ulang / buang. Catatan CRT: backtest (tanpa biaya) filter-nya ~39,6% tapi threshold dipilih in-sample, jadi forward test ini bukti yang menentukan.
// Basis R konsisten dgn aturan RR 1:2: WIN (TP1 atau TP2) = +2R, LOSE = -1R. (TP2 RR 1:3 hanya info target, tidak dipakai buat menghitung R.)
// Biaya = asumsi round-trip 0.08% dari harga, dikonversi ke R lewat jarak SL (|entry - SL|).
export const SCALP_FORWARD = { MIN_RESOLVED: 100, MIN_WIN_RATE: 38, FEE_ROUNDTRIP: 0.0008 } as const;

export interface ScalpForwardTest {
  total: number;      // semua sinyal berlabel strategi ini (termasuk pending/expired)
  resolved: number;   // win + lose
  win: number;
  lose: number;
  pending: number;
  expired: number;
  winRate: number | null;     // %
  avgR: number | null;        // RR 1:2, sebelum biaya
  avgRNet: number | null;     // setelah asumsi biaya
  progressPct: number;        // resolved / MIN_RESOLVED (maks 100)
  /** rincian per arah trade (informasional, bukan kriteria lolos): win/resolve */
  bySide: { side: 'BUY' | 'SELL'; resolved: number; win: number }[];
  verdict: 'belum_cukup' | 'lolos' | 'gagal';
  verdictText: string;
}

export function buildScalpForwardTest(entries: JournalEntry[], skill: string, shortName: string): ScalpForwardTest {
  const sk = entries.filter(e => e.sourceMenu === 'Scalping' && e.sourceSkill === skill);
  const resolvedE = sk.filter(e => e.status === 'win_tp1' || e.status === 'win_tp2' || e.status === 'lose');
  const win = resolvedE.filter(e => e.status !== 'lose').length;
  const lose = resolvedE.length - win;
  let sumR = 0, sumNet = 0;
  for (const e of resolvedE) {
    const r = e.status === 'lose' ? -1 : 2;
    const risk = Math.abs(e.entryPrice - e.stopLoss);
    const feeR = risk > 0 ? (SCALP_FORWARD.FEE_ROUNDTRIP * e.entryPrice) / risk : 0;
    sumR += r; sumNet += r - feeR;
  }
  const n = resolvedE.length;
  const winRate = n > 0 ? (win / n) * 100 : null;
  const avgR = n > 0 ? sumR / n : null;
  const avgRNet = n > 0 ? sumNet / n : null;
  const progressPct = Math.min(100, Math.round((n / SCALP_FORWARD.MIN_RESOLVED) * 100));
  let verdict: ScalpForwardTest['verdict'] = 'belum_cukup';
  let verdictText = `Belum cukup data: ${n}/${SCALP_FORWARD.MIN_RESOLVED} sinyal ${shortName} yang sudah resolve. Jangan simpulkan apa-apa sebelum ${SCALP_FORWARD.MIN_RESOLVED}.`;
  if (n >= SCALP_FORWARD.MIN_RESOLVED && winRate !== null && avgRNet !== null) {
    if (winRate > SCALP_FORWARD.MIN_WIN_RATE && avgRNet > 0) {
      verdict = 'lolos';
      verdictText = `LOLOS forward test: win ${winRate.toFixed(1)}% (> ${SCALP_FORWARD.MIN_WIN_RATE}%) dan avgR setelah biaya ${avgRNet.toFixed(2)}R (> 0). Strategi dipertahankan.`;
    } else {
      verdict = 'gagal';
      verdictText = `GAGAL forward test: win ${winRate.toFixed(1)}% / avgR setelah biaya ${avgRNet.toFixed(2)}R. Kriteria: win > ${SCALP_FORWARD.MIN_WIN_RATE}% dan avgR > 0. Strategi ini tidak menunjukkan keunggulan di data futures nyata -> evaluasi ulang atau buang.`;
    }
  }
  const bySide = (['BUY', 'SELL'] as const).map(side => {
    const rs = resolvedE.filter(e => (e.bias === 'bullish') === (side === 'BUY'));
    return { side, resolved: rs.length, win: rs.filter(e => e.status !== 'lose').length };
  });
  return {
    total: sk.length, resolved: n, win, lose,
    pending: sk.filter(e => e.status === 'pending').length,
    expired: sk.filter(e => e.status === 'expired').length,
    winRate, avgR, avgRNet, progressPct, bySide, verdict, verdictText,
  };
}

/** Forward test Menu Scalping yang aktif sekarang: CRT D1->M15 (Longgar-4, tanpa filter). */
export function buildCrtForwardTest(entries: JournalEntry[]): ScalpForwardTest {
  return buildScalpForwardTest(entries, SCALPING_SKILL_CRT, 'CRT D1→M15');
}

/** LEGACY: forward test Money Magnet (menu sudah diganti CRT; sinyal lama tetap bisa dihitung). */
export function buildMagnetForwardTest(entries: JournalEntry[]): ScalpForwardTest {
  return buildScalpForwardTest(entries, SCALPING_SKILL_MAGNET, 'Money Magnet');
}

export interface JournalSummary {
  totalDecided: number; // total sinyal yang udah win/lose (exclude pending)
  overallWinRate: number;
  perMenu: SimpleVerdict[];
  perSkill: SimpleVerdict[];
  bestMenu: SimpleVerdict | null;
  worstMenu: SimpleVerdict | null;
  bestSkill: SimpleVerdict | null;
  worstSkill: SimpleVerdict | null;
  conclusions: string[]; // kalimat kesimpulan siap baca, urutan dari paling penting
}

/**
 * Ringkasan lengkap siap-baca (request user: "biar gampang lunya cepet
 * nangkep") — breakdown per menu & skill dijadiin verdict simpel
 * (bagus/cukup/perlu_evaluasi), plus kesimpulan dalam kalimat biasa.
 */
export function buildJournalSummary(entries: JournalEntry[]): JournalSummary {
  const decided = entries.filter(e => e.status === 'win_tp1' || e.status === 'win_tp2' || e.status === 'lose');
  const win = decided.filter(e => e.status === 'win_tp1' || e.status === 'win_tp2').length;
  const overallWinRate = decided.length > 0 ? Math.round((win / decided.length) * 100) : 0;

  const perMenu = breakdownByMenu(entries).map(toVerdict).filter(v => v.decided > 0);
  const perSkill = breakdownBySkill(entries).map(toVerdict).filter(v => v.decided > 0);

  const withEnoughData = (arr: SimpleVerdict[]) => arr.filter(v => v.verdict !== 'data_kurang');
  const bestMenu = withEnoughData(perMenu).sort((a, b) => b.winRate - a.winRate)[0] ?? null;
  const worstMenu = withEnoughData(perMenu).sort((a, b) => a.winRate - b.winRate)[0] ?? null;
  const bestSkill = withEnoughData(perSkill).sort((a, b) => b.winRate - a.winRate)[0] ?? null;
  const worstSkill = withEnoughData(perSkill).sort((a, b) => a.winRate - b.winRate)[0] ?? null;

  const conclusions: string[] = [];
  if (decided.length < 5) {
    conclusions.push(`Baru ${decided.length} sinyal yang udah selesai (menang/kalah) — data masih kurang buat kesimpulan yang solid, evaluasi lebih banyak sinyal dulu.`);
  } else {
    conclusions.push(`Dari ${decided.length} sinyal yang udah selesai, win rate keseluruhan ${overallWinRate}% (${win} menang, ${decided.length - win} kalah).`);
    if (bestMenu) conclusions.push(`✅ Menu paling bagus: ${bestMenu.label} — win rate ${bestMenu.winRate}% dari ${bestMenu.decided} sinyal.`);
    if (worstMenu && worstMenu.label !== bestMenu?.label) {
      conclusions.push(worstMenu.verdict === 'perlu_evaluasi'
        ? `⚠️ Menu paling lemah: ${worstMenu.label} — win rate cuma ${worstMenu.winRate}% dari ${worstMenu.decided} sinyal. PERLU DIEVALUASI/DIUPGRADE.`
        : `Menu paling lemah (tapi masih oke): ${worstMenu.label} — win rate ${worstMenu.winRate}% dari ${worstMenu.decided} sinyal.`);
    }
    if (bestSkill) conclusions.push(`✅ Skill paling bagus: ${bestSkill.label} — win rate ${bestSkill.winRate}%.`);
    if (worstSkill && worstSkill.label !== bestSkill?.label) {
      conclusions.push(worstSkill.verdict === 'perlu_evaluasi'
        ? `⚠️ Skill paling lemah: ${worstSkill.label} — win rate cuma ${worstSkill.winRate}%. PERLU DIEVALUASI/DIUPGRADE.`
        : `Skill paling lemah (tapi masih oke): ${worstSkill.label} — win rate ${worstSkill.winRate}%.`);
    }
  }

  return { totalDecided: decided.length, overallWinRate, perMenu, perSkill, bestMenu, worstMenu, bestSkill, worstSkill, conclusions };
}

// ─── Perbandingan indikator WIN vs LOSE ────────────────────────────────────

export interface IndicatorComparison {
  label: string;
  winAvg: number;
  loseAvg: number;
  unit: string; // '' buat angka polos, '%' buat persen
  insight: string; // kesimpulan siap-baca
}

const avg = (arr: number[]): number => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

/**
 * Bandingin rata-rata tiap indikator pas sinyal WIN vs pas sinyal LOSE
 * (request user: "spesifik indikator apa yang sering muncul pas win vs
 * lose"). Butuh minimal 3 data di kedua sisi (win & lose) biar gak
 * menyimpulkan dari sample kekecilan.
 */
export function compareIndicatorsWinLose(entries: JournalEntry[]): { comparisons: IndicatorComparison[]; sampleWin: number; sampleLose: number } {
  const wins = entries.filter(e => (e.status === 'win_tp1' || e.status === 'win_tp2') && e.technicalSnapshot);
  const loses = entries.filter(e => e.status === 'lose' && e.technicalSnapshot);

  if (wins.length < 3 || loses.length < 3) {
    return { comparisons: [], sampleWin: wins.length, sampleLose: loses.length };
  }

  const mk = (
    label: string, unit: string,
    pick: (e: JournalEntry) => number,
    insightFn: (winAvg: number, loseAvg: number) => string
  ): IndicatorComparison => {
    const winAvg = Math.round(avg(wins.map(pick)) * 10) / 10;
    const loseAvg = Math.round(avg(loses.map(pick)) * 10) / 10;
    return { label, winAvg, loseAvg, unit, insight: insightFn(winAvg, loseAvg) };
  };

  const rsiInsight = (w: number, l: number) => {
    const diff = w - l;
    if (Math.abs(diff) < 5) return 'Gak ada pola jelas — RSI mirip di win & lose.';
    if (l >= 70 && diff < -5) return '⚠️ Sinyal yang LOSE cenderung entry pas RSI overbought (≥70) — waspada entry di kondisi ini.';
    if (l <= 30 && diff > 5) return '⚠️ Sinyal yang LOSE cenderung entry pas RSI oversold (≤30) — waspada entry di kondisi ini.';
    return diff > 0 ? 'Sinyal WIN cenderung RSI lebih tinggi dari LOSE.' : 'Sinyal WIN cenderung RSI lebih rendah dari LOSE.';
  };
  const adxInsight = (w: number, l: number) => {
    const diff = w - l;
    if (Math.abs(diff) < 3) return 'Gak ada pola jelas — kekuatan trend (ADX) mirip di win & lose.';
    return diff > 0
      ? `✅ Sinyal WIN cenderung entry pas trend LEBIH KUAT (ADX ${w} vs ${l}) — pertimbangin filter ADX minimal lebih tinggi.`
      : `⚠️ Sinyal LOSE cenderung entry pas trend LEBIH KUAT (ADX ${l} vs ${w}) — trend kuat gak jamin menang di skill ini.`;
  };
  const atrInsight = (w: number, l: number) => {
    const diff = w - l;
    if (Math.abs(diff) < 0.1) return 'Gak ada pola jelas — volatilitas (ATR%) mirip di win & lose.';
    return diff > 0
      ? 'Sinyal WIN cenderung entry pas volatilitas lebih tinggi.'
      : '⚠️ Sinyal LOSE cenderung entry pas volatilitas lebih tinggi — market kegedean gerak bisa nyundul SL.';
  };
  const stochInsight = (w: number, l: number) => {
    const diff = w - l;
    if (Math.abs(diff) < 8) return 'Gak ada pola jelas — Stochastic mirip di win & lose.';
    if (l >= 80 && diff < -8) return '⚠️ Sinyal LOSE cenderung entry pas Stochastic overbought (≥80).';
    if (l <= 20 && diff > 8) return '⚠️ Sinyal LOSE cenderung entry pas Stochastic oversold (≤20).';
    return 'Ada beda pola Stochastic antara win & lose, cek detail per sinyal buat konfirmasi.';
  };
  const macdInsight = (w: number, l: number) => {
    // Dibandingin dari MAGNITUDE (|histogram|) — yang penting buat riset ini
    // seberapa KUAT dorongan momentumnya, bukan arahnya (arah udah ke-cover
    // dari bias sinyal itu sendiri).
    const diff = w - l;
    if (Math.abs(diff) < Math.max(0.1, l * 0.15)) return 'Gak ada pola jelas — kekuatan dorongan MACD mirip di win & lose.';
    return diff > 0
      ? '✅ Sinyal WIN cenderung entry pas dorongan MACD lebih KUAT (momentum lagi nambah kenceng).'
      : '⚠️ Sinyal LOSE cenderung entry pas dorongan MACD lebih kuat — momentum kenceng gak jamin menang di skill ini, mungkin telat masuk (udah exhaustion).';
  };
  const mfiInsight = (w: number, l: number) => {
    const diff = w - l;
    if (Math.abs(diff) < 5) return 'Gak ada pola jelas — MFI (momentum+volume) mirip di win & lose.';
    if (l >= 80 && diff < -5) return '⚠️ Sinyal LOSE cenderung entry pas MFI overbought (≥80) — volume udah jenuh support arah itu.';
    if (l <= 20 && diff > 5) return '⚠️ Sinyal LOSE cenderung entry pas MFI oversold (≤20).';
    return diff > 0 ? 'Sinyal WIN cenderung didukung volume (MFI) lebih kuat dari LOSE.' : 'Sinyal LOSE justru MFI lebih tinggi — cek apa pergerakannya "hollow" (harga gerak, volume kurang).';
  };
  const cciInsight = (w: number, l: number) => {
    // Dibandingin dari MAGNITUDE (|CCI|) — extremity, bukan arah
    const diff = w - l;
    if (Math.abs(diff) < 20) return 'Gak ada pola jelas — extremity CCI mirip di win & lose.';
    return diff > 0
      ? 'Sinyal WIN cenderung entry pas CCI lebih ekstrem (deviasi harga dari rata-rata lebih jauh).'
      : '⚠️ Sinyal LOSE cenderung entry pas CCI lebih ekstrem — bisa jadi entry di puncak/dasar sesaat yang gampang reversal.';
  };
  const rocInsight = (w: number, l: number) => {
    // Dibandingin dari MAGNITUDE (|ROC|) — kecepatan gerak, bukan arah
    const diff = w - l;
    if (Math.abs(diff) < 0.2) return 'Gak ada pola jelas — kecepatan gerak harga (ROC) mirip di win & lose.';
    return diff > 0
      ? `✅ Sinyal WIN cenderung entry pas harga gerak LEBIH TAJAM (ROC ${w}% vs ${l}%).`
      : `⚠️ Sinyal LOSE cenderung entry pas harga gerak LEBIH TAJAM (ROC ${l}% vs ${w}%) — gerakan buru-buru bisa jadi tanda exhaustion/gak sehat.`;
  };

  // FIX (ketemu user: "di menu jurnal ringkasan belum ada data indikator baru
  // yang udah ditambahin"): 12 indikator baru (Williams %R, Momentum, Awesome
  // Oscillator, CMF, OBV, ATR Squeeze, Keltner, Bollinger bandwidth, Trix,
  // Elder Ray, VWAP, CVD, Open Interest) SELAMA INI TERSIMPAN di Journal TAPI
  // GAK PERNAH DIANALISA di Ringkasan — cuma 8 indikator lama yang dibandingin.
  const williamsInsight = (w: number, l: number) => {
    const diff = w - l;
    if (Math.abs(diff) < 8) return 'Gak ada pola jelas — Williams %R mirip di win & lose.';
    if (l >= -20 && diff < -8) return '⚠️ Sinyal LOSE cenderung entry pas Williams %R overbought (≥-20).';
    if (l <= -80 && diff > 8) return '⚠️ Sinyal LOSE cenderung entry pas Williams %R oversold (≤-80).';
    return 'Ada beda pola Williams %R antara win & lose, cek detail per sinyal.';
  };
  const momentumInsight = (w: number, l: number) => {
    const diff = w - l;
    if (Math.abs(diff) < Math.max(0.0001, Math.abs(l) * 0.15)) return 'Gak ada pola jelas — Momentum mirip di win & lose.';
    return diff > 0
      ? '✅ Sinyal WIN cenderung entry pas momentum harga LEBIH KUAT.'
      : '⚠️ Sinyal LOSE justru momentum lebih kuat — bisa jadi tanda entry telat (udah exhaustion).';
  };
  const aoInsight = (w: number, l: number) => {
    const diff = w - l;
    if (Math.abs(diff) < Math.max(0.0001, Math.abs(l) * 0.15)) return 'Gak ada pola jelas — Awesome Oscillator mirip di win & lose.';
    return diff > 0
      ? '✅ Sinyal WIN cenderung entry pas Awesome Oscillator lebih kuat (momentum jangka menengah dukung).'
      : '⚠️ Sinyal LOSE justru AO lebih kuat — momentum menengah gak jamin menang di skill ini.';
  };
  const cmfInsight = (w: number, l: number) => {
    const diff = w - l;
    if (Math.abs(diff) < 0.05) return 'Gak ada pola jelas — Chaikin Money Flow mirip di win & lose.';
    return diff > 0
      ? '✅ Sinyal WIN cenderung didukung aliran dana (CMF) lebih kuat.'
      : '⚠️ Sinyal LOSE justru CMF lebih tinggi — aliran dana kuat gak jamin menang, cek apa itu jebakan.';
  };
  const atrSqueezeInsight = (w: number, l: number) => {
    const diff = w - l;
    if (Math.abs(diff) < 0.1) return 'Gak ada pola jelas — ATR Squeeze mirip di win & lose.';
    return diff > 0
      ? `✅ Sinyal WIN cenderung entry pas volatilitas MELEBAR (${w} vs ${l}) — ekspansi dukung breakout.`
      : `⚠️ Sinyal LOSE cenderung entry pas volatilitas melebar (${l} vs ${w}) — ekspansi bisa jadi tanda gerakan udah kelewat matang.`;
  };
  const bbBandwidthInsight = (w: number, l: number) => {
    const diff = w - l;
    if (Math.abs(diff) < 0.3) return 'Gak ada pola jelas — lebar Bollinger Band mirip di win & lose.';
    return diff > 0
      ? '✅ Sinyal WIN cenderung entry pas Bollinger MELEBAR (volatilitas ekspansi).'
      : '⚠️ Sinyal LOSE cenderung entry pas Bollinger lebih lebar — market kegedean gerak bisa nyundul SL.';
  };
  const trixInsight = (w: number, l: number) => {
    const diff = w - l;
    if (Math.abs(diff) < 0.02) return 'Gak ada pola jelas — Trix mirip di win & lose.';
    return diff > 0
      ? '✅ Sinyal WIN cenderung entry pas Trix (momentum tersaring) lebih kuat.'
      : '⚠️ Sinyal LOSE justru Trix lebih kuat — momentum tersaring gak jamin menang di skill ini.';
  };
  const elderInsight = (w: number, l: number) => {
    const diff = w - l;
    if (Math.abs(diff) < Math.max(0.0001, Math.abs(l) * 0.15)) return 'Gak ada pola jelas — Elder Ray mirip di win & lose.';
    return diff > 0
      ? '✅ Sinyal WIN cenderung entry pas tekanan (Elder Ray) lebih kuat searah bias.'
      : '⚠️ Sinyal LOSE justru tekanan Elder Ray lebih kuat — cek apa itu tanda exhaustion.';
  };
  const vwapDistInsight = (w: number, l: number) => {
    const diff = w - l;
    if (Math.abs(diff) < 0.3) return 'Gak ada pola jelas — jarak harga ke VWAP mirip di win & lose.';
    return diff > 0
      ? `⚠️ Sinyal WIN justru entry LEBIH JAUH dari VWAP (${w}% vs ${l}%) — cek apa itu breakout kuat atau kebetulan.`
      : `✅ Sinyal WIN cenderung entry LEBIH DEKAT ke VWAP (${w}% vs ${l}%) — entry deket harga wajar lebih aman, LOSE cenderung ngejar harga yang udah jauh (${l}%).`;
  };
  const cvdInsight = (w: number, l: number) => {
    const diff = w - l;
    if (Math.abs(diff) < Math.max(1, Math.abs(l) * 0.15)) return 'Gak ada pola jelas — CVD (tekanan beli-jual kumulatif) mirip di win & lose.';
    return diff > 0
      ? '✅ Sinyal WIN cenderung didukung tekanan beli agresif (CVD) lebih kuat.'
      : '⚠️ Sinyal LOSE justru CVD lebih tinggi — tekanan agresif gak jamin menang, bisa jadi jebakan/distribusi.';
  };

  const comparisons: IndicatorComparison[] = [
    mk('RSI Struktur', '', e => e.technicalSnapshot!.struktur.rsi, rsiInsight),
    mk('RSI Eksekusi', '', e => e.technicalSnapshot!.eksekusi.rsi, rsiInsight),
    mk('ADX Struktur', '', e => e.technicalSnapshot!.struktur.adx, adxInsight),
    mk('ADX Eksekusi', '', e => e.technicalSnapshot!.eksekusi.adx, adxInsight),
    mk('ATR% Struktur', '%', e => e.technicalSnapshot!.struktur.atrPct, atrInsight),
    mk('ATR% Eksekusi', '%', e => e.technicalSnapshot!.eksekusi.atrPct, atrInsight),
    mk('Stochastic %K Struktur', '', e => e.technicalSnapshot!.struktur.stochK, stochInsight),
    mk('Stochastic %K Eksekusi', '', e => e.technicalSnapshot!.eksekusi.stochK, stochInsight),
    mk('MACD Histogram Struktur', '', e => Math.abs(e.technicalSnapshot!.struktur.macd), macdInsight),
    mk('MACD Histogram Eksekusi', '', e => Math.abs(e.technicalSnapshot!.eksekusi.macd), macdInsight),
    mk('MFI Struktur', '', e => e.technicalSnapshot!.struktur.mfi, mfiInsight),
    mk('MFI Eksekusi', '', e => e.technicalSnapshot!.eksekusi.mfi, mfiInsight),
    mk('CCI Struktur', '', e => Math.abs(e.technicalSnapshot!.struktur.cci), cciInsight),
    mk('CCI Eksekusi', '', e => Math.abs(e.technicalSnapshot!.eksekusi.cci), cciInsight),
    mk('ROC Struktur', '%', e => Math.abs(e.technicalSnapshot!.struktur.roc), rocInsight),
    mk('ROC Eksekusi', '%', e => Math.abs(e.technicalSnapshot!.eksekusi.roc), rocInsight),
    // ── 12 indikator baru (FIX: sebelumnya tersimpan tapi gak dianalisa) ──
    mk('Williams %R Struktur', '', e => e.technicalSnapshot!.struktur.williamsR ?? -50, williamsInsight),
    mk('Williams %R Eksekusi', '', e => e.technicalSnapshot!.eksekusi.williamsR ?? -50, williamsInsight),
    mk('Momentum Struktur', '', e => Math.abs(e.technicalSnapshot!.struktur.momentum ?? 0), momentumInsight),
    mk('Momentum Eksekusi', '', e => Math.abs(e.technicalSnapshot!.eksekusi.momentum ?? 0), momentumInsight),
    mk('Awesome Osc Struktur', '', e => Math.abs(e.technicalSnapshot!.struktur.awesomeOscillator ?? 0), aoInsight),
    mk('Awesome Osc Eksekusi', '', e => Math.abs(e.technicalSnapshot!.eksekusi.awesomeOscillator ?? 0), aoInsight),
    mk('Chaikin Money Flow Struktur', '', e => e.technicalSnapshot!.struktur.chaikinMoneyFlow ?? 0, cmfInsight),
    mk('Chaikin Money Flow Eksekusi', '', e => e.technicalSnapshot!.eksekusi.chaikinMoneyFlow ?? 0, cmfInsight),
    mk('ATR Squeeze Struktur', 'x', e => e.technicalSnapshot!.struktur.atrSqueeze ?? 1, atrSqueezeInsight),
    mk('ATR Squeeze Eksekusi', 'x', e => e.technicalSnapshot!.eksekusi.atrSqueeze ?? 1, atrSqueezeInsight),
    mk('Bollinger Bandwidth Struktur', '%', e => e.technicalSnapshot!.struktur.bbBandwidth ?? 0, bbBandwidthInsight),
    mk('Bollinger Bandwidth Eksekusi', '%', e => e.technicalSnapshot!.eksekusi.bbBandwidth ?? 0, bbBandwidthInsight),
    mk('Trix Struktur', '%', e => Math.abs(e.technicalSnapshot!.struktur.trix ?? 0), trixInsight),
    mk('Trix Eksekusi', '%', e => Math.abs(e.technicalSnapshot!.eksekusi.trix ?? 0), trixInsight),
    mk('Elder Bull Power Struktur', '', e => Math.abs(e.technicalSnapshot!.struktur.elderBullPower ?? 0), elderInsight),
    mk('Elder Bear Power Struktur', '', e => Math.abs(e.technicalSnapshot!.struktur.elderBearPower ?? 0), elderInsight),
    // VWAP dibandingin sebagai JARAK harga ke VWAP (%) — angka VWAP mentah
    // gak bisa dibandingin lintas koin (skala harga beda-beda)
    mk('Jarak ke VWAP Struktur', '%', e => {
      const s = e.technicalSnapshot!.struktur;
      const vwap = s.vwap ?? 0;
      return vwap > 0 ? Math.abs((s.bbMiddle - vwap) / vwap) * 100 : 0;
    }, vwapDistInsight),
    mk('CVD Struktur', '', e => Math.abs(e.technicalSnapshot!.struktur.cvd ?? 0), cvdInsight),
    mk('CVD Eksekusi', '', e => Math.abs(e.technicalSnapshot!.eksekusi.cvd ?? 0), cvdInsight),
  ];

  return { comparisons, sampleWin: wins.length, sampleLose: loses.length };
}

// ─── Profil kondisi LOSE — analisa KOMBINASI (bias + BTC + semua indikator
// sekaligus), bukan per-indikator terpisah (request user: "biar tau detail
// mana kekurangannya pada kondisi apa sinyal itu dikasih") ─────────────────

export interface LoseConditionProfile {
  groupLabel: string; // nama menu atau "menu — skill"
  tfLabel: string; // TF struktur→eksekusi yang dominan di grup ini, atau "TF campur (lihat breakdown skill)" kalau gak konsisten
  totalLose: number;
  buyPct: number; sellPct: number;
  btcAlignedPct: number; btcNotAlignedPct: number; btcSampleSize: number;
  dominantConditions: string[]; // list kondisi indikator ekstrem yang dominan (≥50% dari sinyal LOSE)
  narrative: string; // 1 paragraf kesimpulan siap-baca, gabungin semua di atas
}

/**
 * Analisa KOMBINASI kondisi pas LOSE — beda dari compareIndicatorsWinLose
 * (yang bandingin 1 indikator per kartu), ini gabungin SEMUA sekaligus jadi
 * 1 profil per menu/skill: arah (buy/sell), BTC correlation, DAN kondisi
 * indikator mana yang paling sering muncul BARENGAN pas LOSE. Request user:
 * "kebanyakan lose kondisi MACD/RSI selalu oversold" — jenis insight ini.
 */
export function buildLoseConditionProfiles(entries: JournalEntry[], groupBy: 'menu' | 'skill'): LoseConditionProfile[] {
  const losers = entries.filter(e => e.status === 'lose');
  const groups = new Map<string, JournalEntry[]>();
  for (const e of losers) {
    const key = groupBy === 'menu' ? e.sourceMenu : `${e.sourceMenu} — ${e.sourceSkill}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const profiles: LoseConditionProfile[] = [];
  for (const [label, group] of groups) {
    if (group.length < 3) continue; // minimal 3 sample biar gak asal nyimpul dari data kekecilan

    // Hitung TF struktur→eksekusi yang paling sering muncul di grup ini (buat
    // dipasang di label indikator — request user: "TF berapa nya kan gua ga
    // tau", soalnya beda skill beda TF, misal Sniper H1→M15 vs Confidence
    // Score M15→M1). Kalau grup ini (biasanya level 'menu', yang isinya bisa
    // lebih dari 1 skill dengan TF beda) ternyata TF-nya CAMPUR, kasih tau
    // jujur daripada nyebut 1 TF yang bisa salah buat sebagian sinyal.
    const tfPairs = group.map(e => `${e.tfStruktur}${e.tfEksekusi ? `→${e.tfEksekusi}` : ''}`);
    const tfCounts = new Map<string, number>();
    for (const tf of tfPairs) tfCounts.set(tf, (tfCounts.get(tf) ?? 0) + 1);
    const uniqueTfCount = tfCounts.size;
    const [dominantTf] = [...tfCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['?'];
    const tfLabel = uniqueTfCount === 1 ? dominantTf : `TF campur (mayoritas ${dominantTf}, cek breakdown per skill)`;
    const [tfStrukturLabel, tfEksekusiLabel] = dominantTf.split('→');

    const buyCount = group.filter(e => e.bias === 'bullish').length;
    const buyPct = Math.round((buyCount / group.length) * 100);
    const sellPct = 100 - buyPct;

    const withBtc = group.filter(e => e.btcAligned !== undefined && e.btcBias !== undefined);
    const btcAlignedCount = withBtc.filter(e => e.btcAligned === true).length;
    const btcNotAlignedCount = withBtc.filter(e => e.btcAligned === false).length;
    const btcAlignedPct = withBtc.length > 0 ? Math.round((btcAlignedCount / withBtc.length) * 100) : 0;
    const btcNotAlignedPct = withBtc.length > 0 ? Math.round((btcNotAlignedCount / withBtc.length) * 100) : 0;

    const withSnapshot = group.filter(e => e.technicalSnapshot);
    const dominantConditions: string[] = [];
    const checkExtreme = (
      indicatorLabel: string,
      pick: (e: JournalEntry) => number,
      isExtreme: (v: number) => boolean,
      extremeDesc: string
    ) => {
      if (withSnapshot.length === 0) return;
      const extremeCount = withSnapshot.filter(e => isExtreme(pick(e))).length;
      const pct = Math.round((extremeCount / withSnapshot.length) * 100);
      if (pct >= 50) dominantConditions.push(`${indicatorLabel} ${extremeDesc} (${pct}% dari ${withSnapshot.length} sinyal)`);
    };

    // Label indikator sekarang sebut TF KONKRET (misal "RSI M15"), bukan cuma
    // "eksekusi"/"struktur" doang — kalau TF campur di grup ini, dikasih
    // tanda "*" biar jelas itu TF mayoritas doang, bukan semua sinyal.
    const tfTag = (tf: string | undefined) => tf ? `${tf}${uniqueTfCount > 1 ? '*' : ''}` : '?';
    const strukturTag = tfTag(tfStrukturLabel);
    const eksekusiTag = tfTag(tfEksekusiLabel);

    checkExtreme(`RSI ${eksekusiTag}`, e => e.technicalSnapshot!.eksekusi.rsi, v => v >= 70, 'overbought (≥70)');
    checkExtreme(`RSI ${eksekusiTag}`, e => e.technicalSnapshot!.eksekusi.rsi, v => v <= 30, 'oversold (≤30)');
    checkExtreme(`RSI ${strukturTag}`, e => e.technicalSnapshot!.struktur.rsi, v => v >= 70, 'overbought (≥70)');
    checkExtreme(`RSI ${strukturTag}`, e => e.technicalSnapshot!.struktur.rsi, v => v <= 30, 'oversold (≤30)');
    checkExtreme(`MFI ${eksekusiTag}`, e => e.technicalSnapshot!.eksekusi.mfi, v => v >= 80, 'overbought (≥80)');
    checkExtreme(`MFI ${eksekusiTag}`, e => e.technicalSnapshot!.eksekusi.mfi, v => v <= 20, 'oversold (≤20)');
    checkExtreme(`MFI ${strukturTag}`, e => e.technicalSnapshot!.struktur.mfi, v => v >= 80, 'overbought (≥80)');
    checkExtreme(`MFI ${strukturTag}`, e => e.technicalSnapshot!.struktur.mfi, v => v <= 20, 'oversold (≤20)');
    checkExtreme(`Stochastic ${eksekusiTag}`, e => e.technicalSnapshot!.eksekusi.stochK, v => v >= 80, 'overbought (≥80)');
    checkExtreme(`Stochastic ${eksekusiTag}`, e => e.technicalSnapshot!.eksekusi.stochK, v => v <= 20, 'oversold (≤20)');
    checkExtreme(`ADX ${strukturTag}`, e => e.technicalSnapshot!.struktur.adx, v => v < 20, 'trend LEMAH (<20)');
    checkExtreme(`ADX ${eksekusiTag}`, e => e.technicalSnapshot!.eksekusi.adx, v => v < 20, 'trend LEMAH (<20)');
    checkExtreme(`CCI ${eksekusiTag}`, e => Math.abs(e.technicalSnapshot!.eksekusi.cci), v => v >= 100, 'ekstrem (|CCI|≥100)');
    checkExtreme(`CCI ${strukturTag}`, e => Math.abs(e.technicalSnapshot!.struktur.cci), v => v >= 100, 'ekstrem (|CCI|≥100)');
    checkExtreme(`MACD histogram ${eksekusiTag}`, e => Math.abs(e.technicalSnapshot!.eksekusi.macd), v => v < 0.0001, 'nyaris flat (momentum lemah)');
    checkExtreme(`ROC ${eksekusiTag}`, e => Math.abs(e.technicalSnapshot!.eksekusi.roc), v => v < 0.15, 'nyaris flat (harga lambat gerak)');
    // FIX (ketemu user: indikator baru tersimpan tapi gak dianalisa) — 12
    // indikator tambahan sekarang ikut dicek buat profil kondisi LOSE
    checkExtreme(`Williams %R ${eksekusiTag}`, e => e.technicalSnapshot!.eksekusi.williamsR ?? -50, v => v >= -20, 'overbought (≥-20)');
    checkExtreme(`Williams %R ${eksekusiTag}`, e => e.technicalSnapshot!.eksekusi.williamsR ?? -50, v => v <= -80, 'oversold (≤-80)');
    checkExtreme(`Williams %R ${strukturTag}`, e => e.technicalSnapshot!.struktur.williamsR ?? -50, v => v >= -20, 'overbought (≥-20)');
    checkExtreme(`Williams %R ${strukturTag}`, e => e.technicalSnapshot!.struktur.williamsR ?? -50, v => v <= -80, 'oversold (≤-80)');
    checkExtreme(`Chaikin Money Flow ${strukturTag}`, e => e.technicalSnapshot!.struktur.chaikinMoneyFlow ?? 0, v => v >= 0.2, 'aliran dana beli KUAT (≥0.2)');
    checkExtreme(`Chaikin Money Flow ${strukturTag}`, e => e.technicalSnapshot!.struktur.chaikinMoneyFlow ?? 0, v => v <= -0.2, 'aliran dana jual KUAT (≤-0.2)');
    checkExtreme(`ATR Squeeze ${strukturTag}`, e => e.technicalSnapshot!.struktur.atrSqueeze ?? 1, v => v < 0.8, 'volatilitas MENYEMPIT (squeeze <0.8x)');
    checkExtreme(`ATR Squeeze ${strukturTag}`, e => e.technicalSnapshot!.struktur.atrSqueeze ?? 1, v => v > 1.5, 'volatilitas MELEBAR ekstrem (>1.5x)');
    checkExtreme(`Bollinger bandwidth ${strukturTag}`, e => e.technicalSnapshot!.struktur.bbBandwidth ?? 0, v => v > 8, 'band MELEBAR ekstrem (>8%, market kegedean gerak)');
    checkExtreme(`Awesome Oscillator ${strukturTag}`, e => Math.abs(e.technicalSnapshot!.struktur.awesomeOscillator ?? 0), v => v < 0.0001, 'nyaris flat (momentum menengah lemah)');
    checkExtreme(`Trix ${strukturTag}`, e => Math.abs(e.technicalSnapshot!.struktur.trix ?? 0), v => v < 0.01, 'nyaris flat (momentum tersaring lemah)');
    // Jarak harga ke VWAP — entry kejauhan dari harga wajar itu tanda "ngejar harga"
    checkExtreme(`Jarak ke VWAP ${strukturTag}`, e => {
      const s = e.technicalSnapshot!.struktur;
      const vwap = s.vwap ?? 0;
      return vwap > 0 ? Math.abs((s.bbMiddle - vwap) / vwap) * 100 : 0;
    }, v => v > 2, 'harga JAUH dari VWAP (>2%, kemungkinan ngejar harga)');

    const biasNote = buyPct > sellPct ? `mayoritas BUY/LONG (${buyPct}%)` : sellPct > buyPct ? `mayoritas SELL/SHORT (${sellPct}%)` : 'seimbang antara BUY & SELL';
    let btcNote = '';
    if (withBtc.length >= 3) {
      btcNote = btcNotAlignedPct > btcAlignedPct
        ? `, dan ${btcNotAlignedPct}% dari itu terjadi PAS BTC LAGI GAK SEARAH (BTC bertentangan sama arah sinyal) — kombinasi ini pola paling sering muncul di LOSE`
        : `, dan ${btcAlignedPct}% terjadi pas BTC UDAH SEARAH — jadi bukan gara-gara lawan arah BTC`;
    }

    let narrative = `Dari ${group.length} sinyal LOSE, ${biasNote}${btcNote}.`;
    narrative += dominantConditions.length > 0
      ? ` Kondisi indikator yang paling sering muncul BARENGAN pas LOSE: ${dominantConditions.join('; ')}.`
      : ' Gak ada kondisi indikator tunggal yang dominan (>50%) — kemungkinan lose-nya lebih ke faktor market umum, bukan pola indikator spesifik.';

    profiles.push({
      groupLabel: label, tfLabel, totalLose: group.length,
      buyPct, sellPct, btcAlignedPct, btcNotAlignedPct, btcSampleSize: withBtc.length,
      dominantConditions, narrative,
    });
  }

  return profiles.sort((a, b) => b.totalLose - a.totalLose);
}

// ─── Rekomendasi pengembangan — request user: "kasih tau juga apa yang perlu
// diperbaiki kedepannya", dipake di Ringkasan per-menu (gantiin Log lama) ──

/**
 * Rangkum kondisi 1 menu (udah difilter entries-nya sebelum masuk sini) jadi
 * saran actionable buat pengembangan — bukan cuma angka mentah, tapi
 * kesimpulan siap-baca soal apa yang perlu dibenerin.
 */
export function buildDevelopmentRecommendations(entries: JournalEntry[]): string[] {
  const recs: string[] = [];
  const decided = entries.filter(e => e.status === 'win_tp1' || e.status === 'win_tp2' || e.status === 'lose');

  if (decided.length < 5) {
    recs.push(`Baru ${decided.length} sinyal yang udah selesai — kumpulin minimal 5-10 sinyal dulu (evaluasi rutin di Journal) sebelum nyimpulin apapun soal performa menu ini.`);
    return recs;
  }

  const win = decided.filter(e => e.status === 'win_tp1' || e.status === 'win_tp2').length;
  const winRate = Math.round((win / decided.length) * 100);

  if (winRate < 40) {
    recs.push(`Win rate keseluruhan cuma ${winRate}% dari ${decided.length} sinyal — di bawah rata-rata sehat (biasanya minimal 40-50% buat sistem RR 1:2/1:3). Pertimbangin evaluasi ulang syarat entry skill ini, mungkin terlalu longgar.`);
  } else if (winRate < 55) {
    recs.push(`Win rate ${winRate}% dari ${decided.length} sinyal — masih di zona "cukup", belum bisa dibilang solid. Cek breakdown skill di bawah, biasanya ada 1 skill yang narik rata-rata turun.`);
  } else {
    recs.push(`Win rate ${winRate}% dari ${decided.length} sinyal — udah bagus, pertahanin syarat entry yang ada sekarang.`);
  }

  const perSkill = breakdownBySkill(entries).filter(b => b.win + b.lose >= 5);
  if (perSkill.length >= 2) {
    const sorted = [...perSkill].sort((a, b) => a.winRate - b.winRate);
    const weakest = sorted[0]!;
    const strongest = sorted[sorted.length - 1]!;
    if (strongest.winRate - weakest.winRate >= 20) {
      recs.push(`Skill "${weakest.label}" (${weakest.winRate}% win rate) jauh di bawah skill "${strongest.label}" (${strongest.winRate}%) di menu yang sama — worth dicek apa syarat entry ${weakest.label} perlu diperketat, atau malah dipertimbangin buat non-aktifin sementara.`);
    }
  }

  const loseProfiles = buildLoseConditionProfiles(entries, 'skill');
  for (const p of loseProfiles) {
    if (p.dominantConditions.length === 0) continue;
    // Ambil 1-2 kondisi paling menonjol buat jadi saran konkret
    const top = p.dominantConditions.slice(0, 2).join(' dan ');
    recs.push(`"${p.groupLabel}": pola LOSE paling sering muncul bareng ${top} — pertimbangin nambah filter buat kondisi ini kalau polanya konsisten di data yang lebih banyak.`);
  }

  if (recs.length === 1) {
    recs.push('Belum ada pola LOSE yang dominan/konsisten kelihatan — kekalahan sejauh ini lebih ke variasi market umum, bukan kesalahan sistematis di logic entry.');
  }

  return recs;
}

// ─── Statistik timing — rata-rata berapa jam entry sampe kehit, dan berapa
// jam dari entry kehit sampe resolve (kena TP atau SL) — request user, biar
// tau kecepatan tiap menu/skill, bukan cuma win rate-nya doang ────────────

export interface TimingStats {
  groupLabel: string; // 'Semua' (overall) atau nama menu/skill
  sampleEntryHit: number; // jumlah sinyal yang punya data waktu entry-hit
  avgHoursToEntryHit: number | null; // null kalau belum ada data
  sampleResolve: number; // jumlah sinyal yang punya data waktu resolve (entry-hit DAN selesai)
  avgHoursToResolve: number | null; // gabungan TP+SL
  sampleTpHit: number;
  avgHoursToTp: number | null; // spesifik yang kena TP doang
  sampleSlHit: number;
  avgHoursToSl: number | null; // spesifik yang kena SL doang
}

const hoursBetween = (a: number, b: number): number => (b - a) / (1000 * 60 * 60);

/**
 * Rata-rata KECEPATAN sinyal — dua tahap: (1) dari sinyal disimpen sampe
 * entry beneran kehit di market, (2) dari entry kehit sampe resolve (kena
 * TP atau SL). Dipisah juga rata-rata TP vs SL doang (request user: "detail")
 * karena bisa aja polanya beda — misal kalau kena SL biasanya CEPET (harga
 * langsung salah arah) tapi kalau kena TP biasanya LEBIH LAMA (nunggu trend
 * jalan), atau sebaliknya — itu insight yang beda dari sekadar win rate.
 *
 * CATATAN: data `entryHitAt`/`resolvedAt` baru mulai kesimpen SETELAH fix
 * ini — sinyal LAMA yang udah dievaluasi sebelumnya gak akan punya data ini
 * (bakal keluar dari sample otomatis, gak nyampur sama data baru).
 */
export function computeTimingStats(entries: JournalEntry[], groupBy?: 'menu' | 'skill'): TimingStats[] {
  const groups = new Map<string, JournalEntry[]>();
  if (!groupBy) {
    groups.set('Semua', entries);
  } else {
    for (const e of entries) {
      const key = groupBy === 'menu' ? e.sourceMenu : `${e.sourceMenu} — ${e.sourceSkill}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }
  }

  const avgOf = (arr: number[]): number => arr.reduce((a, b) => a + b, 0) / arr.length;

  const result: TimingStats[] = [];
  for (const [label, group] of groups) {
    const withEntryHit = group.filter(e => e.entryHitAt !== undefined);
    const avgHoursToEntryHit = withEntryHit.length > 0
      ? Math.round(avgOf(withEntryHit.map(e => hoursBetween(e.savedAt, e.entryHitAt!))) * 10) / 10
      : null;

    const withResolve = group.filter(e => e.entryHitAt !== undefined && e.resolvedAt !== undefined);
    const avgHoursToResolve = withResolve.length > 0
      ? Math.round(avgOf(withResolve.map(e => hoursBetween(e.entryHitAt!, e.resolvedAt!))) * 10) / 10
      : null;

    const tpHits = withResolve.filter(e => e.status === 'win_tp1' || e.status === 'win_tp2');
    const avgHoursToTp = tpHits.length > 0
      ? Math.round(avgOf(tpHits.map(e => hoursBetween(e.entryHitAt!, e.resolvedAt!))) * 10) / 10
      : null;

    const slHits = withResolve.filter(e => e.status === 'lose');
    const avgHoursToSl = slHits.length > 0
      ? Math.round(avgOf(slHits.map(e => hoursBetween(e.entryHitAt!, e.resolvedAt!))) * 10) / 10
      : null;

    if (withEntryHit.length === 0) continue; // skip grup yang belum ada data timing sama sekali

    result.push({
      groupLabel: label,
      sampleEntryHit: withEntryHit.length, avgHoursToEntryHit,
      sampleResolve: withResolve.length, avgHoursToResolve,
      sampleTpHit: tpHits.length, avgHoursToTp,
      sampleSlHit: slHits.length, avgHoursToSl,
    });
  }
  return result.sort((a, b) => b.sampleEntryHit - a.sampleEntryHit);
}

// ─── Baseline — pisahin data histori "lama" vs "baru" (request user: mau
// bandingin performa formula LAMA vs BARU pas skill di-rombak, tanpa data
// campur aduk) ───────────────────────────────────────────────────────────

const BASELINE_KEY = 'journal_baseline_v1';

/** Ambil timestamp baseline yang tersimpen, null kalau belum pernah di-set. */
export async function getJournalBaseline(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(BASELINE_KEY);
    return raw ? (JSON.parse(raw) as number) : null;
  } catch {
    return null;
  }
}

/** Set/hapus baseline. ts=null buat hapus (balik nampilin semua data). */
export async function setJournalBaseline(ts: number | null): Promise<void> {
  try {
    if (ts === null) await AsyncStorage.removeItem(BASELINE_KEY);
    else await AsyncStorage.setItem(BASELINE_KEY, JSON.stringify(ts));
  } catch {}
}

/** Filter entries yang savedAt >= baseline. baseline=null = gak difilter (semua). */
export function filterByBaseline(entries: JournalEntry[], baseline: number | null): JournalEntry[] {
  if (baseline === null) return entries;
  return entries.filter(e => e.savedAt >= baseline);
}
// ─── Diagnosa Terpadu (request user: sub tab baru yang analisa SEMUA data
// jadi poin-poin ringkas siap-eksekusi, bukan tumpukan angka mentah) ────────

export type FindingSeverity = 'critical' | 'warning' | 'info' | 'good';

export interface DiagnosticFinding {
  severity: FindingSeverity;
  title: string;        // 1 baris, langsung ke inti masalahnya
  evidence: string;     // angka konkret pendukung — biar bukan klaim kosong
  action: string;       // APA yang harus diubah/dikembangin
  sampleSize: number;   // biar user tau ini kesimpulan dari data banyak atau dikit
}

export interface DiagnosticReport {
  headline: string;              // 1 kalimat: kondisi sistem sekarang
  overallWinRate: number;
  totalResolved: number;
  findings: DiagnosticFinding[]; // udah terurut: critical -> warning -> info -> good
  dataGaps: string[];            // data yang BELUM cukup buat disimpulin
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = { critical: 0, warning: 1, info: 2, good: 3 };

/**
 * Gabungin SEMUA sumber analisa (win rate, followup 1-jam, timing, indikator
 * win-vs-lose, profil lose, breakdown per menu/skill) jadi DAFTAR TEMUAN
 * TERPRIORITAS. Beda dari tab Ringkasan yang nampilin SEMUA angka mentah —
 * ini SIMPULIN: apa yang salah, buktinya apa, dan apa yang harus diubah.
 *
 * Prinsipnya: setiap finding WAJIB punya (1) angka bukti konkret, (2) sample
 * size — biar user bisa nilai sendiri seberapa kuat kesimpulannya, bukan
 * disodorin klaim tanpa dasar.
 */
export function buildDiagnosticReport(
  entries: JournalEntry[],
  followups: Map<string, SignalFollowupResult>,
): DiagnosticReport {
  const findings: DiagnosticFinding[] = [];
  const dataGaps: string[] = [];

  const resolved = entries.filter(e => e.status === 'win_tp1' || e.status === 'win_tp2' || e.status === 'lose');
  const wins = resolved.filter(e => e.status !== 'lose');
  const totalResolved = resolved.length;
  const overallWinRate = totalResolved > 0 ? Math.round((wins.length / totalResolved) * 100) : 0;

  if (totalResolved < 10) {
    return {
      headline: `Baru ${totalResolved} sinyal selesai — belum cukup buat didiagnosa. Kumpulin minimal 10-20 dulu.`,
      overallWinRate, totalResolved, findings: [],
      dataGaps: ['Butuh minimal 10 sinyal selesai (win/lose) buat mulai analisa pola.'],
    };
  }

  // ── 1. Win rate vs breakeven RR ──────────────────────────────────────────
  // RR 1:2 butuh WR >33% buat breakeven (belum termasuk fee). Ini paling
  // fundamental — kalau di bawah ini, sistem RUGI walau "kelihatan wajar".
  const rrValues = resolved.map(e => e.rr1).filter((v): v is number => typeof v === 'number' && v > 0);
  const avgRR = rrValues.length > 0 ? rrValues.reduce((a, b) => a + b, 0) / rrValues.length : 2;
  const breakevenWR = Math.round((1 / (1 + avgRR)) * 100);
  if (overallWinRate < breakevenWR) {
    findings.push({
      severity: 'critical',
      title: `Win rate ${overallWinRate}% ADA DI BAWAH breakeven (${breakevenWR}%) buat RR 1:${avgRR.toFixed(1)}`,
      evidence: `${wins.length} menang dari ${totalResolved} sinyal. Dengan RR 1:${avgRR.toFixed(1)}, minimal butuh ${breakevenWR}% cuma buat balik modal (belum potong fee).`,
      action: `Ini masalah paling fundamental — sistem lagi rugi secara matematis. Yang perlu diperbaiki: geometri SL/TP (jarak SL vs TP relatif ATR) ATAU kualitas sinyal (filter entry). Cek temuan di bawah buat tau yang mana.`,
      sampleSize: totalResolved,
    });
  } else if (overallWinRate < breakevenWR + 10) {
    findings.push({
      severity: 'warning',
      title: `Win rate ${overallWinRate}% cuma tipis di atas breakeven (${breakevenWR}%)`,
      evidence: `${wins.length} menang dari ${totalResolved} sinyal. Margin aman cuma ${overallWinRate - breakevenWR} poin — sekali kena losing streak bisa langsung minus.`,
      action: `Perlu ditingkatkan biar ada bantalan. Fokus ke temuan lain di bawah.`,
      sampleSize: totalResolved,
    });
  } else {
    findings.push({
      severity: 'good',
      title: `Win rate ${overallWinRate}% di atas breakeven (${breakevenWR}%) — sistem profitable secara matematis`,
      evidence: `${wins.length} menang dari ${totalResolved} sinyal, RR rata-rata 1:${avgRR.toFixed(1)}.`,
      action: `Pertahankan. Fokus optimasi ke temuan lain buat naikin margin.`,
      sampleSize: totalResolved,
    });
  }

  // ── 2. Followup 1-jam: akar masalah LOSE (paling actionable) ────────────
  const agg = aggregateFollowups(entries, followups);
  const loseVerdicts = agg.strukturBenarSlPrematur + agg.strukturSalahKonfirmasi;
  if (loseVerdicts >= 5) {
    const pctPrematur = Math.round((agg.strukturBenarSlPrematur / loseVerdicts) * 100);
    if (pctPrematur >= 60) {
      findings.push({
        severity: 'critical',
        title: `${pctPrematur}% LOSE ternyata ARAH BACAAN BENAR — SL kepencet duluan`,
        evidence: `${agg.strukturBenarSlPrematur} dari ${loseVerdicts} LOSE: 1 jam setelah SL kena, market LANJUT searah bias awal. Artinya analisa struktur udah bener, cuma posisi keburu ketutup.`,
        action: `PRIORITAS UTAMA: perlebar SL (jarak SL sekarang kekencengan relatif volatilitas), ATAU tunda entry sampai konfirmasi lebih matang. JANGAN utak-atik filter indikator — itu bukan masalahnya.`,
        sampleSize: loseVerdicts,
      });
    } else if (pctPrematur <= 40) {
      findings.push({
        severity: 'critical',
        title: `${100 - pctPrematur}% LOSE karena bacaan struktur SALAH`,
        evidence: `${agg.strukturSalahKonfirmasi} dari ${loseVerdicts} LOSE: 1 jam setelah SL, market TIDAK lanjut ke arah bias — arahnya emang salah dari awal.`,
        action: `PRIORITAS UTAMA: perbaiki cara analisa struktur & validasi breakout (bukan setelan SL). Perketat syarat konfirmasi breakout, atau tambah filter arah yang lebih kuat.`,
        sampleSize: loseVerdicts,
      });
    } else {
      findings.push({
        severity: 'warning',
        title: `Penyebab LOSE terbagi rata: ${agg.strukturBenarSlPrematur} SL prematur, ${agg.strukturSalahKonfirmasi} struktur salah`,
        evidence: `Dari ${loseVerdicts} LOSE yang udah dicek 1 jam setelahnya.`,
        action: `Perlu perbaikan di DUA sisi: (1) perlebar SL/tunda entry, (2) perketat validasi struktur.`,
        sampleSize: loseVerdicts,
      });
    }
  } else {
    dataGaps.push(`Analisa pasca-trade 1-jam baru ${loseVerdicts} LOSE yang selesai dicek (butuh ≥5). Ini data PALING PENTING buat tau akar masalah — biarkan server ngumpulin lagi.`);
  }

  // ── 3. RR kekonservatifan (dari followup WIN) ───────────────────────────
  const winVerdicts = agg.momentumLanjutRrKonservatif + agg.momentumHabisRrPas;
  if (winVerdicts >= 5) {
    const pctKonservatif = Math.round((agg.momentumLanjutRrKonservatif / winVerdicts) * 100);
    if (pctKonservatif >= 60) {
      findings.push({
        severity: 'info',
        title: `${pctKonservatif}% WIN masih punya momentum sisa saat TP kena — RR bisa dinaikin`,
        evidence: `${agg.momentumLanjutRrKonservatif} dari ${winVerdicts} WIN: 1 jam setelah TP, market masih lanjut searah. Profit ketinggalan di meja.`,
        action: `Pertimbangkan naikin RR (1:2 → 1:3) atau pakai trailing TP buat kondisi serupa.`,
        sampleSize: winVerdicts,
      });
    }
  }

  // ── 4. Timing: SL jauh lebih cepat dari TP = geometri timpang ───────────
  const timing = computeTimingStats(entries)[0];
  if (timing && timing.avgHoursToSl !== null && timing.avgHoursToTp !== null && timing.sampleSlHit >= 5 && timing.sampleTpHit >= 5) {
    const ratio = timing.avgHoursToTp / timing.avgHoursToSl;
    if (ratio >= 2) {
      findings.push({
        severity: 'warning',
        title: `TP butuh ${ratio.toFixed(1)}x lebih lama dari SL — target profit kejauhan`,
        evidence: `SL kena rata-rata ${timing.avgHoursToSl.toFixed(1)} jam (${timing.sampleSlHit} sinyal), TP ${timing.avgHoursToTp.toFixed(1)} jam (${timing.sampleTpHit} sinyal).`,
        action: `Ini tanda jarak TP terlalu jauh relatif SL dalam satuan volatilitas. Harga lebih sering nyentuh yang deket duluan. Perbaikan: perlebar SL (bukan perkecil TP, biar RR tetap).`,
        sampleSize: timing.sampleSlHit + timing.sampleTpHit,
      });
    }
  } else {
    dataGaps.push('Data timing (kapan SL/TP kena) belum cukup — butuh ≥5 sinyal kena SL dan ≥5 kena TP.');
  }

  // ── 5. Menu/skill terlemah ──────────────────────────────────────────────
  const bySkill = breakdownBySkill(entries).filter(b => b.win + b.lose >= 8);
  if (bySkill.length >= 2) {
    const sorted = [...bySkill].sort((a, b) => a.winRate - b.winRate);
    const worst = sorted[0]!;
    const best = sorted[sorted.length - 1]!;
    if (best.winRate - worst.winRate >= 15) {
      findings.push({
        severity: 'warning',
        title: `Skill "${worst.label}" jauh tertinggal (${worst.winRate}%) dibanding "${best.label}" (${best.winRate}%)`,
        evidence: `${worst.label}: ${worst.win}W/${worst.lose}L. ${best.label}: ${best.win}W/${best.lose}L. Selisih ${best.winRate - worst.winRate} poin.`,
        action: `Evaluasi ulang skill "${worst.label}" — atau matikan sementara dan fokus ke yang lebih kuat sambil dikembangkan.`,
        sampleSize: worst.win + worst.lose,
      });
    }
  }

  // ── 6. Bias arah (BUY vs SELL) ──────────────────────────────────────────
  const byBias = breakdownByBias(entries).filter(b => b.win + b.lose >= 8);
  if (byBias.length === 2) {
    const [a, b] = byBias;
    if (a && b && Math.abs(a.winRate - b.winRate) >= 20) {
      const weak = a.winRate < b.winRate ? a : b;
      const strong = a.winRate < b.winRate ? b : a;
      findings.push({
        severity: 'warning',
        title: `Sinyal ${weak.label} jauh lebih sering rugi (${weak.winRate}%) dibanding ${strong.label} (${strong.winRate}%)`,
        evidence: `${weak.label}: ${weak.win}W/${weak.lose}L. ${strong.label}: ${strong.win}W/${strong.lose}L.`,
        action: `Cek apakah kondisi market periode ini emang trending satu arah. Kalau iya, pertimbangkan filter arah yang ngikutin bias market besar.`,
        sampleSize: weak.win + weak.lose,
      });
    }
  }

  // ── 7. Indikator dengan beda paling mencolok win vs lose ────────────────
  const indicatorRes = compareIndicatorsWinLose(entries);
  if (indicatorRes.sampleWin >= 5 && indicatorRes.sampleLose >= 5) {
    // Cari yang selisihnya paling besar relatif ke skalanya sendiri
    const scored = indicatorRes.comparisons
      .map(c => {
        const scale = Math.max(Math.abs(c.winAvg), Math.abs(c.loseAvg), 0.0001);
        return { c, relDiff: Math.abs(c.winAvg - c.loseAvg) / scale };
      })
      .filter(x => x.relDiff >= 0.25) // minimal beda 25% relatif — biar bukan noise
      .sort((a, b) => b.relDiff - a.relDiff)
      .slice(0, 3);
    for (const { c, relDiff } of scored) {
      findings.push({
        severity: 'info',
        title: `${c.label}: beda mencolok antara WIN (${c.winAvg}${c.unit}) vs LOSE (${c.loseAvg}${c.unit})`,
        evidence: `Selisih ${Math.round(relDiff * 100)}% relatif. Dari ${indicatorRes.sampleWin} WIN dan ${indicatorRes.sampleLose} LOSE.`,
        action: `Kandidat filter baru: coba saring sinyal berdasarkan ${c.label}. Test dulu sebelum dijadiin hard filter.`,
        sampleSize: indicatorRes.sampleWin + indicatorRes.sampleLose,
      });
    }
    if (scored.length === 0) {
      findings.push({
        severity: 'info',
        title: `Gak ada indikator tunggal yang jelas bedain WIN vs LOSE`,
        evidence: `Dari ${indicatorRes.comparisons.length} indikator yang dibandingin (${indicatorRes.sampleWin} WIN, ${indicatorRes.sampleLose} LOSE), gak ada yang selisihnya >25%.`,
        action: `Artinya masalahnya kemungkinan BUKAN di pemilihan indikator — lebih ke struktur SL/TP atau timing entry. Fokus ke temuan critical di atas.`,
        sampleSize: indicatorRes.sampleWin + indicatorRes.sampleLose,
      });
    }
  } else {
    dataGaps.push(`Perbandingan indikator butuh ≥5 WIN dan ≥5 LOSE yang punya data snapshot (sekarang ${indicatorRes.sampleWin} WIN, ${indicatorRes.sampleLose} LOSE).`);
  }

  // ── 8. Sinyal yang gak pernah kehit entry ───────────────────────────────
  const pending = entries.filter(e => e.status === 'pending');
  const neverHit = pending.filter(e => !e.entryHitAt);
  if (entries.length >= 20 && neverHit.length / entries.length >= 0.4) {
    findings.push({
      severity: 'warning',
      title: `${Math.round((neverHit.length / entries.length) * 100)}% sinyal gak pernah kena entry`,
      evidence: `${neverHit.length} dari ${entries.length} sinyal masih nunggu harga nyampe ke entry price (limit order gak pernah kesentuh).`,
      action: `Entry price kejauhan dari harga saat sinyal muncul. Pertimbangkan entry lebih dekat ke harga pasar, atau perpendek jarak retest yang ditunggu.`,
      sampleSize: entries.length,
    });
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const criticalCount = findings.filter(f => f.severity === 'critical').length;
  const headline = criticalCount > 0
    ? `${criticalCount} masalah KRITIS ketemu — win rate ${overallWinRate}% dari ${totalResolved} sinyal. Baca temuan merah dulu.`
    : findings.some(f => f.severity === 'warning')
    ? `Gak ada masalah kritis, tapi ada beberapa yang perlu diperbaiki — win rate ${overallWinRate}% dari ${totalResolved} sinyal.`
    : `Sistem dalam kondisi sehat — win rate ${overallWinRate}% dari ${totalResolved} sinyal.`;

  return { headline, overallWinRate, totalResolved, findings, dataGaps };
}

/**
 * HAPUS PERMANEN semua data Journal (request user: "tombol reset data biar
 * kalau ada perubahan menu, data lama gak kecampur data baru").
 *
 * BEDA dari baseline: baseline cuma NYEMBUNYIIN data lama dari analisa (masih
 * kesimpen, bisa dibalikin kapan aja). Ini GENUINELY NGEHAPUS — gak ada undo.
 * Baseline ikut di-reset juga biar bersih total.
 *
 * CATATAN: data followup di SERVER (tabel signal_followups) TIDAK ikut
 * kehapus — itu kesimpen terpisah di database, dan entry-nya bakal
 * "yatim" (gak ada JournalEntry yang ngacu ke situ). Gak masalah secara
 * fungsional: fetchFollowups cuma ambil followup buat id yang MASIH ADA di
 * Journal, jadi sisa data lama di server otomatis ke-abaikan.
 */
export async function journalDeleteAll(): Promise<void> {
  await AsyncStorage.multiRemove([JOURNAL_KEY, BASELINE_KEY]);
}

// ─── Data siap-pakai buat chart tab Diagnosa ────────────────────────────────

export interface DailyWinRatePoint {
  label: string;   // 'Sen', 'Sel', dst
  winRate: number;
  count: number;   // jumlah sinyal resolve hari itu — buat bar volume
}

/**
 * Win rate per hari buat chart tren. Cuma ngitung sinyal yang UDAH RESOLVE
 * (win/lose) — pending gak dihitung karena belum ada hasilnya.
 */
export function buildDailyWinRateTrend(entries: JournalEntry[], days = 7): DailyWinRatePoint[] {
  const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const now = new Date();
  const points: DailyWinRatePoint[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const dayStart = new Date(now);
    dayStart.setDate(now.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayStart.getDate() + 1);

    const dayEntries = entries.filter(e => {
      const t = e.resolvedAt ?? e.savedAt; // evaluatedAt itu teks ("... WIB"), bukan angka; savedAt sebagai fallback entri lama
      if (!t) return false;
      if (e.status !== 'win_tp1' && e.status !== 'win_tp2' && e.status !== 'lose') return false;
      return t >= dayStart.getTime() && t < dayEnd.getTime();
    });

    const wins = dayEntries.filter(e => e.status !== 'lose').length;
    points.push({
      label: dayNames[dayStart.getDay()] ?? '',
      winRate: dayEntries.length > 0 ? Math.round((wins / dayEntries.length) * 100) : 0,
      count: dayEntries.length,
    });
  }
  return points;
}

export interface HeatmapData {
  columns: string[];
  rows: { label: string; cells: { pct: number; caption?: string }[] }[];
}

/**
 * Matriks "seberapa sering kondisi X muncul saat LOSE", dipecah per skill.
 * Dipake buat heatmap di tab Diagnosa — biar kelihatan kondisi mana yang
 * dominan di skill mana (misal CCI ekstrem dominan di Structural tapi gak
 * di Counter → kandidat filter khusus per-skill, bukan global).
 */
export function buildLoseConditionHeatmap(entries: JournalEntry[]): HeatmapData {
  const withSnapshot = entries.filter(e => e.status === 'lose' && e.technicalSnapshot);
  if (withSnapshot.length === 0) return { columns: [], rows: [] };

  // Kolom = skill yang punya minimal 5 lose (biar persentasenya gak nyesatin)
  const skillGroups = new Map<string, JournalEntry[]>();
  for (const e of withSnapshot) {
    const key = e.sourceSkill || e.sourceMenu;
    if (!skillGroups.has(key)) skillGroups.set(key, []);
    skillGroups.get(key)!.push(e);
  }
  const columns = [...skillGroups.entries()]
    .filter(([, list]) => list.length >= 5)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 3);

  if (columns.length === 0) return { columns: [], rows: [] };

  const conditions: { label: string; test: (e: JournalEntry) => boolean }[] = [
    { label: 'CCI ekstrem', test: e => Math.abs(e.technicalSnapshot!.struktur.cci) >= 100 },
    { label: 'MACD flat', test: e => Math.abs(e.technicalSnapshot!.eksekusi.macd) < 0.0001 },
    { label: 'MFI tinggi', test: e => e.technicalSnapshot!.struktur.mfi >= 60 },
    { label: 'RSI ekstrem', test: e => { const r = e.technicalSnapshot!.struktur.rsi; return r >= 70 || r <= 30; } },
    { label: 'ATR melebar', test: e => (e.technicalSnapshot!.struktur.atrSqueeze ?? 1) > 1.3 },
  ];

  const rows = conditions.map(cond => ({
    label: cond.label,
    cells: columns.map(([, list]) => {
      const hits = list.filter(cond.test).length;
      return {
        pct: Math.round((hits / list.length) * 100),
        caption: `${hits} dari ${list.length}`,
      };
    }),
  }))
  // Buang baris yang semua kolomnya 0 — gak informatif
  .filter(r => r.cells.some(c => c.pct > 0));

  return { columns: columns.map(([label]) => label), rows };
}