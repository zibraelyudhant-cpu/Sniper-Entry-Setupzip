// ═══════════════════════════════════════════════════════════════════════════
// CRT D1 -> M15 (LONGGAR LEVEL 4) — engine murni (tanpa network), port 1:1 dari
// `run_side` di crt_backtest.py (opsi --causal-order). Dipakai Menu Scalping.
//
// Semua parameter di CRT_PARAMS = nilai preset LOOSE4 + LOOSE4_A di backtest.
// RR 1:2 TIDAK BOLEH diubah (TP = 2R).
//
// Alur (LONG; SHORT = cermin: o,h,l,c dinegatif dengan h<->l):
//  1. Referensi = candle D1 UTC yang SUDAH close kemarin (High/Low). LL = Low D1.
//  2. Sweep : candle M15 hari ini low < LL. Reclaim = close pertama > LL dalam RECL_MAX candle.
//  3. Kedalaman sweep 0.01%-10%, candle reclaim bullish body >= 10% range, range candle sweep <= 99 x ATR.
//  4. Swing high internal (fractal 2-2, mundur <= 40 candle dari ei-2). MSS = close pertama > swing itu
//     (dalam MSS_WIN candle sejak candle reclaim).
//  5. Displacement = high tertinggi dari ekstrem sweep s/d candle MSS. Entry LIMIT di retrace 50%.
//     Posisi entry di range D1 harus 0..50%. SL = ekstrem sweep - 0.2 x ATR14 M15 (di candle MSS).
//     Ruang ke High D1 harus >= 2R. Batal kalau midpoint D1 tersentuh sebelum fill.
//  6. Nomor order = URUTAN WAKTU CANDLE MSS per hari per arah (kausal — satu-satunya yang bisa diketahui live).
//
// Murni fungsi: kalau input sama, output sama. TIDAK memakai candle yang belum close.
// ═══════════════════════════════════════════════════════════════════════════

export const CRT_PARAMS = {
  VERSION: 'crt2', // crt2 = tanpa filter (level 4 original)
  SKILL_LABEL: 'Scalping CRT D1→M15 (Longgar-4)',
  D1_FETCH: 100,
  M15_FETCH: 499,
  ATR_N: 14,
  MIN_D1_BARS: 20,        // butuh >= 20 candle D1 untuk ATR D1 (nD >= 20)
  RANGE_MIN_ATR: 0.0,     // range D1 / ATR D1 (preset longgar: tanpa batas)
  RANGE_MAX_ATR: 99.0,
  DEPTH_MIN: 0.0001,      // kedalaman sweep 0.01%
  DEPTH_MAX: 0.10,        // 10%
  BODY_MIN: 0.10,         // body candle reclaim / range candle
  SWEEP_RANGE_MAX_ATR: 99.0,
  RECL_MAX: 24,
  MSS_WIN: 24,
  SW_LB: 40,
  ENTRY_RET: 0.5,
  ZONE: 0.50,
  SL_BUF_ATR: 0.2,
  TP_R: 2.0,
  EXP: 32,                // limit berlaku 32 candle M15 setelah candle MSS
  MAX_ORDERS: 3,          // maks 3 order per hari per arah
} as const;

export const M15_MS = 900000;
export const D1_MS = 86400000;

export interface CrtM15 { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; }
export interface CrtD1 { t: number[]; h: number[]; l: number[]; c: number[]; }

export type CrtOrderStatus = 'pending' | 'filled' | 'cancel_mid' | 'expired';

export interface CrtOrder {
  side: 'L' | 'S';            // L = BUY limit, S = SELL limit
  day: number;                // hari UTC (epoch ms / 86400000)
  orderNo: number;            // urutan MSS di hari+arah itu (1..MAX_ORDERS)
  mIdx: number;               // index candle MSS di array M15
  tSig: number;               // open time candle MSS (ms)
  entry: number;              // harga asli (bukan cermin)
  sl: number;
  tp: number;
  risk: number;
  mid: number;                // midpoint D1 (harga asli)
  d1High: number;             // High D1 referensi (target struktur)
  d1Low: number;              // Low D1 referensi (level yang di-sweep)
  d1RangeAtr: number;         // range D1 / ATR14 D1
  sweepExtreme: number;       // ekstrem sweep (harga asli)
  depth: number;              // kedalaman sweep (fraksi)
  pos: number;                // posisi entry di range D1 (0..1, dihitung dari sisi sweep)
  roomR: number;              // (High D1 - entry) / risk
  riskAtr: number;            // risk / ATR14 M15 di candle MSS
  delayRecl: number;          // q - b
  delayMss: number;           // m - q
  status: CrtOrderStatus;
  fillIdx: number | null;     // index candle fill (kalau filled)
}

// ── Wilder (seed = nilai pertama), persis crt_backtest.wilder ─────────────────
function wilder(x: number[], n = 14): number[] {
  const out = new Array<number>(x.length);
  const a = 1 / n;
  out[0] = x[0]!;
  for (let i = 1; i < x.length; i++) out[i] = out[i - 1]! * (1 - a) + x[i]! * a;
  return out;
}

export function atr15Series(m: CrtM15): number[] {
  const n = m.c.length;
  const tr = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const pc = i === 0 ? m.c[0]! : m.c[i - 1]!;
    tr[i] = Math.max(m.h[i]! - m.l[i]!, Math.abs(m.h[i]! - pc), Math.abs(m.l[i]! - pc));
  }
  return wilder(tr);
}

export interface D1Ref { idx: number; H: number; L: number; C: number; atr: number; nD: number; }

/** ATR D1 Wilder (seed TR pertama; reset kalau ada hari bolong) + peta hari -> referensi. */
export function d1RefMap(d1: CrtD1): Map<number, D1Ref> {
  const out = new Map<number, D1Ref>();
  let prevC: number | null = null, a: number | null = null, nD = 0, lastDay: number | null = null;
  for (let i = 0; i < d1.t.length; i++) {
    const day = Math.floor(d1.t[i]! / D1_MS);
    const H = d1.h[i]!, L = d1.l[i]!, C = d1.c[i]!;
    if (lastDay !== null && day !== lastDay + 1) { prevC = null; a = null; nD = 0; }
    const trd = prevC === null ? (H - L) : Math.max(H - L, Math.abs(H - prevC), Math.abs(L - prevC));
    a = a === null ? trd : a * (13 / 14) + trd / 14;
    nD += 1; prevC = C; lastDay = day;
    out.set(day, { idx: i, H, L, C, atr: a, nD });
  }
  return out;
}

/**
 * Cari semua order CRT untuk SATU hari UTC (`day`) dan SATU arah.
 * `m` = candle M15 yang sudah close (naik). Candle setelah akhir hari ikut dipakai (reclaim/fill bisa melewati tengah malam),
 * persis seperti backtest. Status dihitung terhadap candle yang ada: belum ada kejadian & jendela belum habis = 'pending'.
 */
export function crtOrdersForDay(
  m: CrtM15, atr15: number[], refs: Map<number, D1Ref>, day: number, side: 'L' | 'S',
): CrtOrder[] {
  const P = CRT_PARAMS;
  const n = m.c.length;
  const ref = refs.get(day - 1);
  if (!ref || ref.nD < P.MIN_D1_BARS) return [];
  const sg = side === 'S' ? -1 : 1;
  // arah cermin: SHORT diperlakukan sebagai LONG
  const O = side === 'S' ? m.o.map(v => -v) : m.o;
  const Hh = side === 'S' ? m.l.map(v => -v) : m.h;
  const Ll = side === 'S' ? m.h.map(v => -v) : m.l;
  const C = side === 'S' ? m.c.map(v => -v) : m.c;

  const aD = ref.atr;
  const LL = side === 'L' ? ref.L : -ref.H;
  const HH = side === 'L' ? ref.H : -ref.L;
  const R = HH - LL;
  if (!(P.RANGE_MIN_ATR * aD <= R && R <= P.RANGE_MAX_ATR * aD)) return [];
  const mid = (HH + LL) / 2;

  // candle milik hari ini (yang sudah close)
  let s = -1, e = -1;
  for (let i = 0; i < n; i++) {
    const d = Math.floor(m.t[i]! / D1_MS);
    if (d === day) { if (s < 0) s = i; e = i + 1; } else if (d > day) break;
  }
  if (s < 0) return [];
  const brk: number[] = [];
  for (let i = s; i < e; i++) if (Ll[i]! < LL) brk.push(i);

  const lowerBound = (arr: number[], x: number): number => { // np.searchsorted(side='left')
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mdl = (lo + hi) >> 1; if (arr[mdl]! < x) lo = mdl + 1; else hi = mdl; }
    return lo;
  };

  const found: CrtOrder[] = [];
  let p = 0;
  while (p < brk.length) {
    const b = brk[p]!;
    let q = -1;
    for (let j = b; j < Math.min(b + P.RECL_MAX, n); j++) { if (C[j]! > LL) { q = j; break; } }
    if (q < 0) { p = lowerBound(brk, b + P.RECL_MAX); continue; }
    // ei = argmin low di [b..q] (indeks pertama kalau seri, seperti np.argmin)
    let ei = b;
    for (let j = b + 1; j <= q; j++) if (Ll[j]! < Ll[ei]!) ei = j;
    const ext = Ll[ei]!;
    const depth = (LL - ext) / Math.abs(LL);
    p = lowerBound(brk, q + 1);
    if (!(P.DEPTH_MIN <= depth && depth <= P.DEPTH_MAX)) continue;
    const rng = Hh[q]! - Ll[q]!;
    if (!(C[q]! > O[q]! && rng > 0 && (C[q]! - O[q]!) / rng >= P.BODY_MIN)) continue;
    if (!(q >= 20)) continue; // (volume tidak dicek di level 4, tapi q >= 20 tetap wajib seperti backtest)
    if (ei < 1 || !((Hh[ei]! - Ll[ei]!) <= P.SWEEP_RANGE_MAX_ATR * atr15[ei - 1]!)) continue;

    let S: number | null = null;
    for (let k = ei - 2; k >= Math.max(2, ei - 2 - P.SW_LB); k--) {
      if (Hh[k]! > Hh[k - 1]! && Hh[k]! > Hh[k - 2]! && Hh[k]! > Hh[k + 1]! && Hh[k]! > Hh[k + 2]!) { S = Hh[k]!; break; }
    }
    if (S === null) continue;
    let mm = -1;
    for (let j = q; j < Math.min(q + P.MSS_WIN + 1, n); j++) { if (C[j]! > S) { mm = j; break; } }
    if (mm < 0) continue;

    let Dh = -Infinity;
    for (let j = ei; j <= mm; j++) if (Hh[j]! > Dh) Dh = Hh[j]!;
    const size = Dh - ext;
    const entry = Dh - P.ENTRY_RET * size;
    const pos = (entry - LL) / R;
    if (!(0.0 <= pos && pos <= P.ZONE)) continue;
    const sl = ext - P.SL_BUF_ATR * atr15[mm]!;
    const risk = entry - sl;
    if (!(risk > 0)) continue;
    if (HH - entry < P.TP_R * risk) continue;
    const tp = entry + P.TP_R * risk;

    // status limit
    let status: CrtOrderStatus = 'pending';
    let fillIdx: number | null = null;
    if (Hh[mm]! >= mid) {
      status = 'cancel_mid';
    } else {
      let decided = false;
      for (let j = mm + 1; j < Math.min(mm + P.EXP + 1, n); j++) {
        if (Ll[j]! <= entry) { fillIdx = j; status = 'filled'; decided = true; break; }
        if (Hh[j]! >= mid) { status = 'cancel_mid'; decided = true; break; }
      }
      if (!decided) status = (mm + P.EXP <= n - 1) ? 'expired' : 'pending';
    }

    found.push({
      side, day, orderNo: 0, mIdx: mm, tSig: m.t[mm]!,
      entry: sg * entry, sl: sg * sl, tp: sg * tp, risk, mid: sg * mid,
      d1High: ref.H, d1Low: ref.L, d1RangeAtr: R / aD,
      sweepExtreme: sg * ext, depth, pos, roomR: (HH - entry) / risk, riskAtr: risk / atr15[mm]!,
      delayRecl: q - b, delayMss: mm - q, status, fillIdx,
    });
  }
  // nomor order = urutan waktu MSS (stabil: seri dipecah oleh urutan episode), maks MAX_ORDERS
  found.sort((x, y) => x.mIdx - y.mIdx);
  found.forEach((o, i) => { o.orderNo = i + 1; });
  return found.slice(0, P.MAX_ORDERS);
}

export interface CrtScanInput {
  m15: CrtM15;          // HANYA candle yang sudah close
  d1: CrtD1;            // HANYA candle yang sudah close
  nowMs: number;
  forming?: { h: number; l: number; c: number } | null; // candle M15 yang sedang berjalan (opsional)
}

export interface CrtPending extends CrtOrder {
  validUntil: number;   // ms: candle yang DIBUKA pada/setelah waktu ini = limit sudah batal (expired)
  price: number;
}

/**
 * Daftar order yang LIMIT-nya masih menunggu fill sekarang (hari UTC sekarang + kemarin, karena limit melewati 00:00 UTC),
 * tanpa filter apa pun (level 4 original).
 */
export function crtPendingOrders(inp: CrtScanInput): CrtPending[] {
  const { m15, d1, nowMs, forming } = inp;
  const refs = d1RefMap(d1);
  const atr15 = atr15Series(m15);
  const today = Math.floor(nowMs / D1_MS);
  const out: CrtPending[] = [];
  for (const day of [today - 1, today]) {
    for (const side of ['L', 'S'] as const) {
      for (const o of crtOrdersForDay(m15, atr15, refs, day, side)) {
        if (o.status !== 'pending') continue;
        const validUntil = o.tSig + (CRT_PARAMS.EXP + 1) * M15_MS;
        if (nowMs >= validUntil) continue;
        let price = m15.c[m15.c.length - 1]!;
        if (forming) {
          price = forming.c;
          // candle berjalan sudah menyentuh entry (limit ke-fill) atau midpoint (batal) -> bukan pending lagi
          if (o.side === 'L') { if (forming.l <= o.entry || forming.h >= o.mid) continue; }
          else { if (forming.h >= o.entry || forming.l <= o.mid) continue; }
        }
        // harga sekarang harus masih di sisi benar (limit belum tersentuh)
        if (o.side === 'L' ? price <= o.entry : price >= o.entry) continue;
        out.push({ ...o, validUntil, price });
      }
    }
  }
  return out;
}
