// ═══════════════════════════════════════════════════════════════════════════
// TP3 SNR H1 (v20, request user 2026-11-10) — dipakai layar Analisa (detail) Sniper Breakout,
// Fibonacci Retest, Money Magnet. TIDAK dipanggil saat scan (hemat weight Binance): ±20 weight per
// koin (2 request kline H1), cache 10 menit per simbol.
//
// Langkah:
//  1. Kline H1 2688 candle tertutup (2 halaman: 1500 + sisa, paging endTime).
//  2. SNR H1: swing fractal 3 (3 candle kiri-kanan), cluster toleransi 0,5 x ATR14 H1 sekarang, >= 2 sentuhan.
//  3. Kandidat TP3 = zona SNR di arah posisi yang tepi dekatnya di luar TP2 (RR 1:3). Level TP3 = tepi dekat zona
//     dikurangi buffer 0,1 ATR H1 (dipasang SEBELUM zona, seperti SL anti-gocekan dipasang di luar zona),
//     dan tetap harus di luar TP2. Konfluensi Fib: ekstensi 1,272 / 1,618 / 2,0 / 2,618 leg H1 terakhir dalam 0,5 ATR.
//  4. Peluang sampai (empiris, seperti kedalaman gocekan P90 di SL anti-gocekan): di setiap candle H1 historis,
//     simulasi entry di close dengan jarak SL dan TP2 yang SAMA dalam satuan ATR H1 saat itu. Hanya sampel yang
//     kena TP2 dulu (harga sudah jalan searah) yang dihitung. Setelah TP2, dicatat jarak terjauh (MFE) sampai harga
//     balik ke TP1 atau 120 candle H1 (5 hari sejak entry) habis. Peluang TP3 = % sampel TP2 yang MFE-nya >= jarak TP3.
//     Sampel saling tumpang tindih (bukan trade independen) -> angka ini perkiraan, bukan bukti.
//  5. Pilih zona SNR terjauh dengan peluang >= 50% ("rata-rata harga sampai"). Kalau tidak ada yang >= 50%,
//     pilih zona SNR terdekat di luar TP2 (peluang ditampilkan). Tanpa zona SNR: level Fib terdekat di luar TP2.
// ═══════════════════════════════════════════════════════════════════════════

const BASE = 'https://fapi.binance.com';
export const TP3 = {
  VERSION: 'tp3a',
  CANDLES: 2688, SWING: 3, TOL_ATR: 0.5, MIN_TOUCH: 2, BUF_ATR: 0.1,
  HORIZON: 120, MIN_PROB: 50, FIB_EXT: [1.272, 1.618, 2.0, 2.618], FIB_TOL_ATR: 0.5, MAX_CANDS: 6,
  CACHE_MS: 10 * 60_000,
};

type C = { t: number; o: number; h: number; l: number; c: number };
const kCache = new Map<string, { at: number; v: C[] }>();

async function getH1(symbol: string): Promise<C[]> {
  const hit = kCache.get(symbol);
  if (hit && Date.now() - hit.at < TP3.CACHE_MS) return hit.v;
  let out: C[] = []; let endTime: number | undefined;
  const need = TP3.CANDLES + 1; // +1 candle berjalan (dibuang)
  while (out.length < need) {
    const lim = Math.min(1500, need - out.length);
    const url = `${BASE}/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=${lim}${endTime ? `&endTime=${endTime}` : ''}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`kline H1 gagal (${r.status})`);
    const d = await r.json() as unknown[][];
    if (!Array.isArray(d) || d.length === 0) break;
    out = [...d.map(x => ({ t: Number(x[0]), o: Number(x[1]), h: Number(x[2]), l: Number(x[3]), c: Number(x[4]) })), ...out];
    endTime = Number(d[0]![0]) - 1;
    if (d.length < lim) break;
  }
  const now = Date.now();
  if (out.length && out[out.length - 1]!.t + 3_600_000 > now) out = out.slice(0, -1); // buang candle berjalan
  kCache.set(symbol, { at: Date.now(), v: out });
  return out;
}

function atrSeries(c: C[], p = 14): number[] {
  const out: number[] = new Array(c.length).fill(NaN);
  let rma = 0;
  for (let i = 1; i < c.length; i++) {
    const tr = Math.max(c[i]!.h - c[i]!.l, Math.abs(c[i]!.h - c[i - 1]!.c), Math.abs(c[i]!.l - c[i - 1]!.c));
    if (i <= p) { rma += tr; if (i === p) { rma /= p; out[i] = rma; } }
    else { rma = (rma * (p - 1) + tr) / p; out[i] = rma; }
  }
  return out;
}

export interface Tp3Cand { lo: number; hi: number; touches: number; level: number; rr: number; reachPct: number; fib: string | null; source: 'snr' | 'fib' }
export interface Tp3Result {
  symbol: string; side: 'BUY' | 'SELL'; entry: number; sl: number; tp2: number; version: string;
  tp3: number | null; rr3: number | null; reachPct: number | null; source: 'snr' | 'fib' | null;
  zoneLo: number | null; zoneHi: number | null; touches: number | null; fib: string | null;
  nTp2: number; nSamples: number; horizonH: number; candles: number; atrH1: number;
  candidates: Tp3Cand[]; message: string;
}

export async function analyzeTp3(symbol: string, side: 'BUY' | 'SELL', entry: number, sl: number): Promise<Tp3Result> {
  const g = side === 'BUY' ? 1 : -1;
  const risk = (entry - sl) * g;
  if (!(risk > 0)) throw new Error(side === 'BUY' ? 'BUY: SL harus di bawah entry' : 'SELL: SL harus di atas entry');
  const tp2 = entry + g * 3 * risk;
  const k = await getH1(symbol);
  if (k.length < 300) throw new Error(`data H1 kurang (${k.length} candle)`);
  const n = k.length;
  const atr = atrSeries(k);
  const a = atr[n - 1]!;
  if (!(a > 0)) throw new Error('ATR H1 tidak valid');

  // 2. SNR H1
  const pts: { p: number; i: number }[] = [];
  const S = TP3.SWING;
  const swH: number[] = [], swL: number[] = [];
  for (let i = S; i < n - S; i++) {
    let isH = true, isL = true;
    for (let q = 1; q <= S; q++) {
      if (!(k[i]!.h > k[i - q]!.h && k[i]!.h > k[i + q]!.h)) isH = false;
      if (!(k[i]!.l < k[i - q]!.l && k[i]!.l < k[i + q]!.l)) isL = false;
    }
    if (isH) { pts.push({ p: k[i]!.h, i }); swH.push(i); }
    if (isL) { pts.push({ p: k[i]!.l, i }); swL.push(i); }
  }
  pts.sort((x, y) => x.p - y.p);
  const zones: { lo: number; hi: number; touches: number }[] = [];
  let grp: number[] = [];
  const flush = () => { if (grp.length >= TP3.MIN_TOUCH) zones.push({ lo: grp[0]!, hi: grp[grp.length - 1]!, touches: grp.length }); };
  for (const q of pts) {
    if (grp.length && q.p - grp[0]! > TP3.TOL_ATR * a) { flush(); grp = []; }
    grp.push(q.p);
  }
  flush();

  // Fib: ekstensi leg H1 terakhir (BUY: swing low terakhir sebelum swing high terakhir; SELL kebalikannya)
  const fibLv: { f: number; p: number }[] = [];
  {
    const last = (arr: number[]) => arr.length ? arr[arr.length - 1]! : -1;
    if (g === 1) {
      const ih = last(swH); let il = -1; for (const i of swL) if (i < ih) il = i;
      if (ih >= 0 && il >= 0) { const L = k[il]!.l, H = k[ih]!.h, R = H - L; if (R > 0) for (const f of TP3.FIB_EXT) fibLv.push({ f, p: L + f * R }); }
    } else {
      const il = last(swL); let ih = -1; for (const i of swH) if (i < il) ih = i;
      if (ih >= 0 && il >= 0) { const L = k[il]!.l, H = k[ih]!.h, R = H - L; if (R > 0) for (const f of TP3.FIB_EXT) fibLv.push({ f, p: H - f * R }); }
    }
  }
  const fibNear = (lo: number, hi: number) => {
    const m = fibLv.filter(x => x.p >= lo - TP3.FIB_TOL_ATR * a && x.p <= hi + TP3.FIB_TOL_ATR * a);
    return m.length ? m.map(x => String(x.f).replace('.', ',')).join('/') : null;
  };

  // 4. MFE empiris setelah TP2 (satuan ATR H1)
  const dsA = risk / a, d2A = 3 * risk / a;
  const mfe: number[] = []; let nSamples = 0;
  for (let i = 30; i < n - 2; i++) {
    const ai = atr[i]!; if (!(ai > 0)) continue;
    const e = k[i]!.c, slP = e - g * dsA * ai, t2P = e + g * d2A * ai;
    const end = Math.min(n - 1, i + TP3.HORIZON);
    let j = i + 1, hitTp2 = -1;
    for (; j <= end; j++) {
      const c = k[j]!;
      const slHit = g === 1 ? c.l <= slP : c.h >= slP;
      if (slHit) break; // SL dulu (atau SL & TP2 di candle sama = dianggap SL, konservatif)
      if (g === 1 ? c.h >= t2P : c.l <= t2P) { hitTp2 = j; break; }
    }
    if (j > end && hitTp2 < 0) { if (end - i >= TP3.HORIZON) nSamples++; continue; }
    nSamples++;
    if (hitTp2 < 0) continue;
    let best = g === 1 ? k[hitTp2]!.h : k[hitTp2]!.l;
    const t1P = e + g * 2 * dsA * ai; // TP1 (RR 1:2)
    for (let q = hitTp2 + 1; q <= end; q++) {
      const c = k[q]!;
      if (g === 1 ? c.l <= t1P : c.h >= t1P) break; // harga balik ke TP1 = lari selesai
      best = g === 1 ? Math.max(best, c.h) : Math.min(best, c.l);
    }
    mfe.push((best - e) * g / ai);
  }
  const reach = (dist: number) => mfe.length ? mfe.filter(x => x >= dist / a).length / mfe.length * 100 : 0;

  // 3. kandidat
  const cands: Tp3Cand[] = [];
  for (const z of zones) {
    const near = g === 1 ? z.lo : z.hi;
    if ((near - tp2) * g <= 0) continue;
    const level = near - g * TP3.BUF_ATR * a;
    if ((level - tp2) * g <= 0) continue;
    const dist = (level - entry) * g;
    cands.push({ lo: z.lo, hi: z.hi, touches: z.touches, level, rr: dist / risk, reachPct: reach(dist), fib: fibNear(z.lo, z.hi), source: 'snr' });
  }
  cands.sort((x, y) => (x.level - y.level) * g);
  let pick: Tp3Cand | null = null; let pi = -1;
  cands.forEach((c, idx) => { if (c.reachPct >= TP3.MIN_PROB) { pick = c; pi = idx; } }); // terjauh yang >= 50% (semua zona di data)
  if (!pick && cands.length) { pick = cands[0]!; pi = 0; }
  const top = cands.slice(Math.max(0, pi - (TP3.MAX_CANDS - 3)), Math.max(0, pi) + 3); // sekitar pilihan: beberapa sebelum + 2 sesudah
  if (!pick) {
    const fc = fibLv.map(x => ({ x, level: x.p - g * TP3.BUF_ATR * a })).filter(y => (y.level - tp2) * g > 0).sort((p1, p2) => (p1.level - p2.level) * g)[0];
    if (fc) {
      const dist = (fc.level - entry) * g;
      pick = { lo: fc.x.p, hi: fc.x.p, touches: 0, level: fc.level, rr: dist / risk, reachPct: reach(dist), fib: String(fc.x.f).replace('.', ','), source: 'fib' };
      top.push(pick);
    }
  }
  const base = { symbol, side, entry, sl, tp2, version: TP3.VERSION, nTp2: mfe.length, nSamples, horizonH: TP3.HORIZON, candles: n, atrH1: a, candidates: top };
  if (!pick) return { ...base, tp3: null, rr3: null, reachPct: null, source: null, zoneLo: null, zoneHi: null, touches: null, fib: null, message: `Tidak ada SNR H1 (${n} candle) maupun ekstensi Fib di luar TP2 (RR 1:3)` };
  const lowProb = pick.reachPct < TP3.MIN_PROB;
  return {
    ...base, tp3: pick.level, rr3: Number(pick.rr.toFixed(2)), reachPct: Number(pick.reachPct.toFixed(1)), source: pick.source,
    zoneLo: pick.lo, zoneHi: pick.hi, touches: pick.touches, fib: pick.fib,
    message: pick.source === 'fib'
      ? `Tidak ada SNR H1 di luar TP2; TP3 = ekstensi Fib ${pick.fib} leg H1 terakhir`
      : `TP3 = ${lowProb ? 'zona SNR H1 terdekat di luar TP2 (tidak ada zona dengan peluang >= 50%)' : `zona SNR H1 terjauh dengan peluang >= ${TP3.MIN_PROB}%`}`,
  };
}
