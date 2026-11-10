// ═══════════════════════════════════════════════════════════════════════
// SETUP FINDER (sf1) — implementasi spesifikasi_setup_finder.md (user, 2026-11-05)
// Whale (order book) + backtest WR. Analisa teknikal saja (WR & RR).
// Semua angka default = bagian 17 spek. Satu-satunya perubahan dari spek:
// daftar koin di-scan dari universe menu lain (getUniverse, 500 koin).
// Tembok order book TIDAK ikut backtest (spek #19) — cuma menaruh level.
// ═══════════════════════════════════════════════════════════════════════

export const SF = {
  VERSION: 'sf2',
  SKILL_LABEL: 'Setup Finder (Whale + Backtest)',
  threads: 3,
  rate: { brakeWeight: 2000, retries: 4 },
  walls: { minUsdt: 100_000, depthScan: 500, depthSingle: 1000, strengthPct: 2, top: 10, /* top = 10 TOTAL (beli + jual digabung) */ maxDistPct: 3, realSeen: 2, tolPct: 0.05, valueKeep: 0.5, spoofRemain: 0.3 },
  trades: { scan: 1, single: 2, perReq: 1000 },
  swing: { candles: 1000, fractal: 3, lookback: 200, atr: 14, maxPerSide: 3 },
  gocek: { lookahead: 96, reclaimBars: 4, depthPct: 90, defaultDepthAtr: 1.0 },
  round: { maxDistPct: 2, zoneAtr: 0.5 },
  thin: { ratio: 0.25, rangePct: 5, bucketPct: 0.25 },
  sl: { swingBufAtr: 0.1, wallBufAtr1h: 0.25, fallbackAtr1h: 1.5, roundBuf: 0.1, maxPct: 4 },
  entry: { wallBufAtr: 0.1, swingBufAtr: 0.15 },
  rr: [1, 1.5, 2, 3] as number[],
  bt: { slTfSwitchPct: 1.5, candles: 1500, maxBars15: 192, maxBars1h: 120, minTrades: 30, suspiciousWr: 85, warmup: 0 },
  fill: { window: 96, marketTolPct: 0.02 },
  regime: { wTrend: 0.45, wTrades: 0.30, wBook: 0.25, adxFull: 40, sideMin: 10, sideMax: 85, minH1: 60 },
  alarm: { warnVol: 3, warnMoveAtr: 2, dangerPeak: 5, dangerMoveAtr: 3 },
};

const BASE = 'https://fapi.binance.com';

// ─── Tipe ───────────────────────────────────────────────────────────────
type Candle = { t: number; o: number; h: number; l: number; c: number; v: number; qv: number };
export type Side = 'BUY' | 'SELL';
export type SlCapMode = 'potong' | 'tolak';
export type SFOptions = { rr: number[]; side: 'BUY' | 'SELL' | 'BOTH'; minWall: number; slCap?: SlCapMode };

export interface SFWall { side: 'bid' | 'ask'; price: number; value: number; distPct: number; strengthPct: number; impactPct: number; seen: number; real: boolean }

export interface SFSetup {
  symbol: string; side: Side; rr: number;
  entryKind: 'market' | 'wall' | 'swing'; orderType: 'market' | 'limit';
  entry: number; sl: number; tp: number; slPct: number; price: number;
  slSource: 'swing' | 'wall' | 'fallback'; slRounded: boolean; slClipped: boolean;
  tf: '15M' | '1H'; n: number; nWin: number; usedAllCandles: boolean;
  wr: number; breakevenWr: number; avgR: number; fillProb: number; score: number;
  wrSuspicious: boolean; medianHoursToTp: number | null;
  regime: 'Bullish' | 'Bearish' | 'Sideways' | null; align: 'searah' | 'melawan' | 'netral' | 'n/a';
  oppWall: { price: number; value: number } | null; thinInPath: boolean;
  alarm: 'BAHAYA' | 'WASPADA' | 'tenang' | 'n/a'; whalePressure: number;
  wallReal: boolean | null;
  best?: boolean; // 🏆 RR terbaik untuk koin+arah ini
}

export interface SFCoinResult {
  symbol: string; price: number; atr15: number; atrH1: number; p90GocekAtr: number;
  regime: SFSetup['regime']; whalePressure: number; alarm: SFSetup['alarm']; move1dPct: number; move4hPct: number;
  walls: SFWall[]; spoofCount: number; setups: SFSetup[]; skipped: string[];
}

// ─── Util ───────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const num = (x: unknown) => parseFloat(String(x));

function percentile(arr: number[], p: number): number {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo]! + (s[hi]! - s[lo]!) * (idx - lo);
}
const median = (a: number[]) => percentile(a, 50);

function emaSeries(vals: number[], n: number): number[] {
  const k = 2 / (n + 1); const out: number[] = []; let prev = vals[0]!;
  for (let i = 0; i < vals.length; i++) { prev = i === 0 ? vals[0]! : vals[i]! * k + prev * (1 - k); out.push(prev); }
  return out;
}

// ATR Wilder per candle (NaN sebelum candle ke-n)
function atrSeries(c: Candle[], n = 14): number[] {
  const out: number[] = new Array(c.length).fill(NaN);
  if (c.length < n) return out;
  const tr: number[] = [c[0]!.h - c[0]!.l];
  for (let i = 1; i < c.length; i++) tr.push(Math.max(c[i]!.h - c[i]!.l, Math.abs(c[i]!.h - c[i - 1]!.c), Math.abs(c[i]!.l - c[i - 1]!.c)));
  let a = tr.slice(0, n).reduce((s, x) => s + x, 0) / n; out[n - 1] = a;
  for (let i = n; i < tr.length; i++) { a = (a * (n - 1) + tr[i]!) / n; out[i] = a; }
  return out;
}

function atrLast(c: Candle[], n = 14): number {
  // Wilder: TR candle pertama = high - low; nilai pertama = rata-rata n TR pertama; lalu (sebelumnya x (n-1) + TR) / n
  if (c.length < n) return NaN;
  const tr: number[] = [c[0]!.h - c[0]!.l];
  for (let i = 1; i < c.length; i++) tr.push(Math.max(c[i]!.h - c[i]!.l, Math.abs(c[i]!.h - c[i - 1]!.c), Math.abs(c[i]!.l - c[i - 1]!.c)));
  let a = tr.slice(0, n).reduce((s, x) => s + x, 0) / n;
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]!) / n;
  return a;
}

function adxLast(c: Candle[], n = 14): number {
  if (c.length < n * 2 + 1) return NaN;
  const tr: number[] = [], pdm: number[] = [], mdm: number[] = [];
  for (let i = 1; i < c.length; i++) {
    const up = c[i]!.h - c[i - 1]!.h, dn = c[i - 1]!.l - c[i]!.l;
    pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(c[i]!.h - c[i]!.l, Math.abs(c[i]!.h - c[i - 1]!.c), Math.abs(c[i]!.l - c[i - 1]!.c)));
  }
  let str = tr.slice(0, n).reduce((s, x) => s + x, 0), sp = pdm.slice(0, n).reduce((s, x) => s + x, 0), sm = mdm.slice(0, n).reduce((s, x) => s + x, 0);
  const dxs: number[] = [];
  for (let i = n; i <= tr.length; i++) {
    if (i > n) { str = str - str / n + tr[i - 1]!; sp = sp - sp / n + pdm[i - 1]!; sm = sm - sm / n + mdm[i - 1]!; }
    const pdi = str ? 100 * sp / str : 0, mdi = str ? 100 * sm / str : 0;
    dxs.push(pdi + mdi ? 100 * Math.abs(pdi - mdi) / (pdi + mdi) : 0);
  }
  if (dxs.length < n) return NaN;
  let adx = dxs.slice(0, n).reduce((s, x) => s + x, 0) / n;
  for (let i = n; i < dxs.length; i++) adx = (adx * (n - 1) + dxs[i]!) / n;
  return adx;
}

// ─── Binance dengan rem weight (spek #3) ─────────────────────────────────
let usedWeight = 0; let usedWeightAt = 0;
async function waitBrake(): Promise<void> {
  for (;;) {
    const now = Date.now();
    if (Math.floor(usedWeightAt / 60000) !== Math.floor(now / 60000)) { usedWeight = 0; return; }
    if (usedWeight <= SF.rate.brakeWeight) return;
    await sleep(60000 - (now % 60000) + 500);
  }
}
export function sfUsedWeight(): number { return Math.floor(usedWeightAt / 60000) === Math.floor(Date.now() / 60000) ? usedWeight : 0; }

async function bget<T>(path: string): Promise<T> {
  let lastErr: unknown;
  for (let a = 0; a < SF.rate.retries; a++) {
    await waitBrake();
    try {
      const res = await fetch(BASE + path, { signal: AbortSignal.timeout(15000) });
      const uw = res.headers.get('x-mbx-used-weight-1m');
      if (uw) { usedWeight = parseInt(uw, 10); usedWeightAt = Date.now(); }
      if (res.status === 418 || res.status === 429) {
        const ra = parseInt(res.headers.get('retry-after') ?? '60', 10);
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(Math.min(Math.max(ra, 1), 300) * 1000);
        continue;
      }
      if (!res.ok) { const e: any = new Error(`HTTP ${res.status}`); e.fatal = true; throw e; }
      return (await res.json()) as T;
    } catch (e: any) {
      if (e?.fatal) throw e;
      lastErr = e;
      await sleep((a + 1) * 1000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('request gagal');
}

async function getKlines(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const rows = await bget<any[][]>(`/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  const all = rows.map(r => ({ t: r[0] as number, o: num(r[1]), h: num(r[2]), l: num(r[3]), c: num(r[4]), v: num(r[5]), qv: num(r[7]) }));
  return all.slice(0, -1); // buang candle yang masih berjalan — cuma candle selesai
}

// ─── Riwayat tembok (buat tembok asli / palsu, spek #4) ─────────────────
type SnapWall = { side: 'bid' | 'ask'; price: number; value: number; seen: number };
const wallHistory = new Map<string, { price: number; walls: SnapWall[] }>();

// ─── Tembok whale (spek #4) ──────────────────────────────────────────────
function simulateSweep(levels: [number, number][], startPrice: number, usd: number): number {
  // levels: sisi lawan, urut dari terdekat. Hasil: % gerak harga setelah market order sebesar usd.
  let remain = usd; let last = startPrice;
  for (const [p, q] of levels) {
    const val = p * q; last = p;
    if (remain <= val) { remain = 0; break; }
    remain -= val;
  }
  return Math.abs(last - startPrice) / startPrice * 100;
}

function detectWalls(symbol: string, bids: [number, number][], asks: [number, number][], price: number, minValue: number): { walls: SFWall[]; allWalls: SFWall[]; spoofCount: number } {
  const lo = price * (1 - SF.walls.strengthPct / 100), hi = price * (1 + SF.walls.strengthPct / 100);
  const bidTotal = bids.filter(b => b[0] >= lo).reduce((s, b) => s + b[0] * b[1], 0);
  const askTotal = asks.filter(a => a[0] <= hi).reduce((s, a) => s + a[0] * a[1], 0);
  const mk = (side: 'bid' | 'ask'): SFWall[] => {
    const lv = side === 'bid' ? bids : asks; const opp = side === 'bid' ? asks : bids; const tot = side === 'bid' ? bidTotal : askTotal;
    const out: SFWall[] = [];
    for (const [p, q] of lv) {
      const v = p * q; if (v < minValue) continue;
      out.push({
        side, price: p, value: v, distPct: Math.abs(p - price) / price * 100,
        strengthPct: tot > 0 ? v / tot * 100 : 0,
        impactPct: simulateSweep(opp, price, v),
        seen: 1, real: false,
      });
    }
    return out;
  };
  // SEMUA tembok >= Min. nilai (beli + jual): dipakai SL anti-gocekan & deteksi asli/palsu.
  // 10 tembok TOTAL (urut dampak % terbesar, sama -> nilai USDT terbesar): hanya untuk kandidat entry "depan tembok", tabel tembok, dan Cek entry.
  const allWalls = [...mk('bid'), ...mk('ask')].sort((a, b) => (b.impactPct - a.impactPct) || (b.value - a.value));
  const walls = allWalls.slice(0, SF.walls.top);

  // asli / palsu — bandingkan dengan scan sebelumnya
  let spoofCount = 0;
  const prev = wallHistory.get(symbol);
  if (prev) {
    const tol = price * SF.walls.tolPct / 100;
    for (const w of allWalls) {
      const m = prev.walls.find(p => p.side === w.side && Math.abs(p.price - w.price) <= tol);
      if (m && w.value >= m.value * SF.walls.valueKeep) w.seen = m.seen + 1;
    }
    for (const p of prev.walls) {
      if (allWalls.some(w => w.side === p.side && Math.abs(w.price - p.price) <= tol)) continue;
      const lv = p.side === 'bid' ? bids : asks;
      const remain = lv.filter(l => Math.abs(l[0] - p.price) <= tol).reduce((s, l) => s + l[0] * l[1], 0);
      const approached = Math.abs(price - p.price) < Math.abs(prev.price - p.price);
      if (remain < p.value * SF.walls.spoofRemain && approached) spoofCount++;
    }
  }
  for (const w of allWalls) w.real = w.seen >= SF.walls.realSeen;
  wallHistory.set(symbol, { price, walls: allWalls.map(w => ({ side: w.side, price: w.price, value: w.value, seen: w.seen })) });
  return { walls, allWalls, spoofCount };
}

// ─── Zona tipis (spek #6): bucket antrean < 25% median, hanya di area yang tercakup order book ───
function thinBuckets(bids: [number, number][], asks: [number, number][], price: number): Array<{ lo: number; hi: number }> {
  const step = price * SF.thin.bucketPct / 100; const nB = Math.floor(SF.thin.rangePct / SF.thin.bucketPct);
  const bidCover = bids.length ? bids[bids.length - 1]![0] : price; const askCover = asks.length ? asks[asks.length - 1]![0] : price;
  const bk: Array<{ lo: number; hi: number; val: number }> = [];
  for (let i = 0; i < nB; i++) {
    const aLo = price + i * step, aHi = aLo + step;
    if (aHi <= askCover) bk.push({ lo: aLo, hi: aHi, val: asks.filter(a => a[0] >= aLo && a[0] < aHi).reduce((s, a) => s + a[0] * a[1], 0) });
    const bHi = price - i * step, bLo = bHi - step;
    if (bLo >= bidCover) bk.push({ lo: bLo, hi: bHi, val: bids.filter(b => b[0] >= bLo && b[0] < bHi).reduce((s, b) => s + b[0] * b[1], 0) });
  }
  if (bk.length < 4) return [];
  const med = median(bk.map(b => b.val));
  return bk.filter(b => b.val < med * SF.thin.ratio).map(b => ({ lo: b.lo, hi: b.hi }));
}

// ─── Swing, gocekan, angka bulat (spek #6) ───────────────────────────────
function findSwings(c: Candle[], n: number): { highs: Array<{ i: number; p: number }>; lows: Array<{ i: number; p: number }> } {
  const highs: Array<{ i: number; p: number }> = [], lows: Array<{ i: number; p: number }> = [];
  for (let i = n; i < c.length - n; i++) { // hanya yang sudah terkonfirmasi (n candle kanan)
    let isH = true, isL = true;
    for (let k = 1; k <= n; k++) {
      if (!(c[i]!.h >= c[i - k]!.h && c[i]!.h >= c[i + k]!.h)) isH = false; // tertinggi di 2n+1 candle; nilai kembar tetap swing
      if (!(c[i]!.l <= c[i - k]!.l && c[i]!.l <= c[i + k]!.l)) isL = false;
      if (!isH && !isL) break;
    }
    if (isH) highs.push({ i, p: c[i]!.h });
    if (isL) lows.push({ i, p: c[i]!.l });
  }
  return { highs, lows };
}

function gocekDepthsAtr(c: Candle[], sw: ReturnType<typeof findSwings>, atrArr: number[]): number[] {
  // Per swing (SEMUA swing di 1000 candle 15M, bukan hanya 200 terakhir): dicek mulai candle i+n+1, jendela 96 candle, SAPUAN PERTAMA saja. Tembus = ketat (low < level / high > level).
  // Jendela "close balik <= 4 candle" dimulai dari candle penembus (ikut dihitung): j .. j+3.
  // Kedalaman = jarak level swing ke low terendah (swing low) / high tertinggi (swing high) di jendela itu, dibagi ATR15 di candle penembus.
  const out: number[] = []; const n = SF.swing.fractal; const look = SF.gocek.lookahead, rec = SF.gocek.reclaimBars;
  const scan = (s: { i: number; p: number }, isLow: boolean) => {
    for (let j = s.i + n + 1; j <= Math.min(c.length - 1, s.i + n + look); j++) { // swing terkonfirmasi di i+n; cek tembusan mulai i+n+1, jendela 96 candle dari situ
      const broke = isLow ? c[j]!.l < s.p : c[j]!.h > s.p;
      if (!broke) continue;
      const end = Math.min(j + rec - 1, c.length - 1);
      let ext = isLow ? c[j]!.l : c[j]!.h; let reclaimed = false;
      for (let k = j; k <= end; k++) {
        ext = isLow ? Math.min(ext, c[k]!.l) : Math.max(ext, c[k]!.h);
        if (isLow ? c[k]!.c > s.p : c[k]!.c < s.p) reclaimed = true; // close balik: di atas level (swing low) / di bawah level (swing high)
      }
      const a = atrArr[j];
      if (reclaimed && a !== undefined && isFinite(a) && a > 0) out.push((isLow ? s.p - ext : ext - s.p) / a);
      return; // sapuan pertama saja
    }
  };
  for (const s of sw.lows) scan(s, true);
  for (const s of sw.highs) scan(s, false);
  return out;
}

function roundLevels(price: number): number[] {
  // step = 5 x 10^(floor(log10(harga)) - 2); bawah/atas = kelipatan step terdekat; dipakai kalau jarak <= 2% dari harga
  const step = 5 * Math.pow(10, Math.floor(Math.log10(price)) - 2);
  const lo = Math.floor(price / step) * step, hi = Math.ceil(price / step) * step;
  const out = new Set<number>();
  for (const v of [lo, hi]) if (Math.abs(v - price) / price * 100 <= SF.round.maxDistPct) out.add(Number(v.toPrecision(12)));
  return [...out];
}

// ─── Backtest WR (spek #12) ──────────────────────────────────────────────
interface BtRes { wr: number; n: number; nWin: number; medianBars: number | null; usedAll: boolean }
function backtest(c: Candle[], side: Side, slPct: number, rrs: number[], maxBars: number, nowUp: boolean): Map<number, BtRes> {
  const ema20 = emaSeries(c.map(x => x.c), 20), ema50 = emaSeries(c.map(x => x.c), 50);
  // mulai dari candle pertama (index 0); entry di close candle i selama i < jumlah candle - 1 - maxBars
  const first = SF.bt.warmup, last = c.length - 2 - maxBars;
  const all: number[] = [], filt: number[] = [];
  for (let i = first; i <= last; i++) { all.push(i); if ((ema20[i]! > ema50[i]!) === nowUp) filt.push(i); }
  const useFilt = filt.length >= SF.bt.minTrades; const idxs = useFilt ? filt : all;
  const wins = new Map<number, number[]>(); for (const rr of rrs) wins.set(rr, []);
  const sgn = side === 'BUY' ? 1 : -1;
  for (const i of idxs) {
    const e = c[i]!.c; const sl = e * (1 - sgn * slPct / 100);
    const tps = rrs.map(rr => e * (1 + sgn * rr * slPct / 100)); const hit: number[] = rrs.map(() => -1);
    let left = rrs.length;
    for (let j = i + 1; j <= i + maxBars; j++) {
      const slHit = sgn === 1 ? c[j]!.l <= sl : c[j]!.h >= sl;
      if (slHit) break; // TP & SL di candle yang sama = kalah
      for (let k = 0; k < rrs.length; k++) {
        if (hit[k] !== -1) continue;
        if (sgn === 1 ? c[j]!.h >= tps[k]! : c[j]!.l <= tps[k]!) { hit[k] = j - i; left--; }
      }
      if (left === 0) break;
    }
    for (let k = 0; k < rrs.length; k++) if (hit[k] !== -1) wins.get(rrs[k]!)!.push(hit[k]!);
  }
  const out = new Map<number, BtRes>();
  for (const rr of rrs) {
    const w = wins.get(rr)!; const n = idxs.length;
    out.set(rr, { wr: n ? w.length / n * 100 : 0, n, nWin: w.length, medianBars: w.length ? median(w) : null, usedAll: !useFilt });
  }
  return out;
}
// ─── Peluang entry tersentuh (spek #13) + "harga kabur" (limit) ──────────
type OrderKind = 'market' | 'limit' | 'stop';
function orderKindFor(side: Side, entry: number, price: number): OrderKind {
  if (Math.abs(entry - price) / price * 100 <= SF.fill.marketTolPct) return 'market';
  const fav = side === 'BUY' ? entry < price : entry > price; // limit = entry di sisi menguntungkan
  return fav ? 'limit' : 'stop';
}
function touchStats(c: Candle[], side: Side, kind: OrderKind, distFrac: number, tpDistFrac: number): { fill: number; escape: number | null } {
  if (kind === 'market') return { fill: 100, escape: null };
  const W = SF.fill.window; let tot = 0, hit = 0, esc = 0;
  const down = (side === 'BUY') === (kind === 'limit'); // entry di bawah harga?
  for (let i = 0; i + W < c.length; i++) {
    const base = c[i]!.c; const lvl = down ? base * (1 - distFrac) : base * (1 + distFrac);
    const escLvl = side === 'BUY' ? base * (1 + tpDistFrac) : base * (1 - tpDistFrac);
    tot++;
    for (let j = i + 1; j <= i + W; j++) {
      const touched = down ? c[j]!.l <= lvl : c[j]!.h >= lvl;
      if (touched) { hit++; break; } // entry & kabur di candle yang sama = entry dihitung duluan
      if (kind === 'limit' && (side === 'BUY' ? c[j]!.h >= escLvl : c[j]!.l <= escLvl)) { esc++; break; }
    }
  }
  return { fill: tot ? hit / tot * 100 : 0, escape: kind === 'limit' ? (tot ? esc / tot * 100 : 0) : null };
}

// ─── Konteks data satu koin (spek #3-#8) ─────────────────────────────────
interface Ctx {
  symbol: string; opt: SFOptions; price: number;
  k15all: Candle[]; k15: Candle[]; h1: Candle[];
  atr15: number; atrH1: number; atrH1Real: number; move1dPct: number; move4hPct: number;
  bids: [number, number][]; asks: [number, number][];
  walls: SFWall[]; allWalls: SFWall[]; spoofCount: number; whalePressure: number;
  lows: Array<{ i: number; p: number }>; highs: Array<{ i: number; p: number }>;
  p90: number; rounds: number[]; zones8: Array<{ kind: 'swingLow' | 'swingHigh' | 'round'; p: number }>; thin: Array<{ lo: number; hi: number }>;
  regime: SFSetup['regime']; alarm: SFSetup['alarm'];
  h1Long: () => Promise<Candle[]>;
}

async function fetchTrades(symbol: string, single: boolean) {
  type T = { a: number; p: string; q: string; m: boolean };
  let trades = await bget<T[]>(`/fapi/v1/aggTrades?symbol=${symbol}&limit=${SF.trades.perReq}`);
  if (!single) return trades; // scan banyak koin = 1 request (1000 transaksi)
  // 1 koin = 3 request: terbaru + 2 halaman ke belakang (fromId = id pertama - 1000), ganda dibuang
  for (let page = 0; page < 2; page++) {
    const firstId = trades[0]?.a; if (firstId === undefined || firstId <= 0) break;
    try {
      const older = await bget<T[]>(`/fapi/v1/aggTrades?symbol=${symbol}&fromId=${Math.max(0, firstId - SF.trades.perReq)}&limit=${SF.trades.perReq}`);
      const seen = new Set(trades.map(t => t.a)); trades = [...older.filter(t => !seen.has(t.a)), ...trades];
    } catch { break; }
  }
  return trades;
}

async function loadCtx(symbol: string, opt: SFOptions, single: boolean): Promise<Ctx> {
  // 2.1 data live
  const tk = await bget<{ lastPrice: string }>(`/fapi/v1/ticker/24hr?symbol=${symbol}`);
  const price = num(tk.lastPrice);
  const depth = await bget<{ bids: string[][]; asks: string[][] }>(`/fapi/v1/depth?symbol=${symbol}&limit=${single ? SF.walls.depthSingle : SF.walls.depthScan}`);
  const bids: [number, number][] = depth.bids.map(x => [num(x[0]), num(x[1])]);
  const asks: [number, number][] = depth.asks.map(x => [num(x[0]), num(x[1])]);
  const trades = await fetchTrades(symbol, single);
  const k15all = await getKlines(symbol, '15m', SF.bt.candles); // 1500; 1000 terakhir dipakai swing & peluang tersentuh (cache)
  const k15 = k15all.slice(-SF.swing.candles);
  const h1 = await getKlines(symbol, '1h', 300);
  const d1 = await getKlines(symbol, '1d', 31); // 30 candle selesai — buat perkiraan gerak (bukan regime)
  const k1m = await getKlines(symbol, '1m', 62); // 61 candle selesai
  if (k15.length < 300) throw new Error('data candle 15M kurang');
  // ATR15 kosong / NaN -> harga x 0.003. "ATR H1" di Setup Finder = 2 x ATR15 (BUKAN ATR dari candle 1H).
  const atr15Raw = atrLast(k15, SF.swing.atr);
  const atr15 = isFinite(atr15Raw) && atr15Raw > 0 ? atr15Raw : price * 0.003;
  const atrH1 = 2 * atr15; // HANYA untuk SL anti-gocekan (SL tembok & SL cadangan)
  const atrH1RealRaw = atrLast(h1, 14); // ATR H1 ASLI (Wilder 14, 300 candle 1H) — regime & perkiraan gerak
  const atrH1Real = isFinite(atrH1RealRaw) && atrH1RealRaw > 0 ? atrH1RealRaw : atrH1;

  // perkiraan gerak: ATR D1% (kalau candle D1 < 15 pakai ATR H1% x 5); 1 hari = x0.8; 4 jam = ATR H1% x2 x0.8
  const atrH1Pct = atrH1Real / price * 100;
  const atrD1Pct = d1.length >= 15 ? atrLast(d1, 14) / price * 100 : atrH1Pct * 5;
  const move1dPct = atrD1Pct * 0.8; const move4hPct = atrH1Pct * 2 * 0.8;

  // 2.2 tembok
  const { walls, allWalls, spoofCount } = detectWalls(symbol, bids, asks, price, opt.minWall);

  // transaksi besar (spek #5)
  let buyV = 0, sellV = 0;
  for (const t of trades) { const v = num(t.p) * num(t.q); if (v < opt.minWall) continue; if (t.m) sellV += v; else buyV += v; }
  const whalePressure = buyV + sellV > 0 ? (buyV - sellV) / (buyV + sellV) * 100 : 0;

  // 2.3 swing, gocekan, angka bulat
  const sw = findSwings(k15, SF.swing.fractal);
  const fromIdx = k15.length - SF.swing.lookback;
  const lows = sw.lows.filter(s => s.i >= fromIdx && s.p < price).sort((a, b) => b.p - a.p).slice(0, SF.swing.maxPerSide);
  const highs = sw.highs.filter(s => s.i >= fromIdx && s.p > price).sort((a, b) => a.p - b.p).slice(0, SF.swing.maxPerSide);
  const depths = gocekDepthsAtr(k15, sw, atrSeries(k15, SF.swing.atr));
  const p90 = depths.length ? percentile(depths, SF.gocek.depthPct) : SF.gocek.defaultDepthAtr;
  const rounds = roundLevels(price);
  // 8 zona terdekat ke harga (zona swing + angka bulat, urut jarak) — kandidat entry "depan swing" diambil dari sini
  const zones8 = [
    ...sw.lows.filter(s => s.i >= fromIdx && s.p < price).map(s => ({ kind: 'swingLow' as const, p: s.p })),
    ...sw.highs.filter(s => s.i >= fromIdx && s.p > price).map(s => ({ kind: 'swingHigh' as const, p: s.p })),
    ...rounds.map(p => ({ kind: 'round' as const, p })),
  ].sort((a, b) => Math.abs(a.p - price) - Math.abs(b.p - price)).slice(0, 8);
  const thin = thinBuckets(bids, asks, price);

  // 2.4 regime
  let regime: SFSetup['regime'] = null;
  if (h1.length >= SF.regime.minH1) {
    const cl = h1.map(x => x.c); const e20 = emaSeries(cl, 20), e50 = emaSeries(cl, 50), e200 = emaSeries(cl, 200); const L = cl.length - 1;
    const s1 = Math.sign(cl[L]! - e20[L]!), s2 = Math.sign(e20[L]! - e50[L]!), s3 = Math.sign(e50[L]! - e200[L]!);
    const trend = (cl.length < 200 ? (s1 + s2) / 2 : (s1 + s2 + s3) / 3) * 100; // < 200 candle: hanya 2 tanda pertama, dibagi 2
    const bidSum = bids.filter(b => b[0] >= price * 0.98).reduce((s, b) => s + b[0] * b[1], 0);
    const askSum = asks.filter(a => a[0] <= price * 1.02).reduce((s, a) => s + a[0] * a[1], 0);
    const book = bidSum + askSum > 0 ? (bidSum - askSum) / (bidSum + askSum) * 100 : 0;
    const skor = SF.regime.wTrend * trend + SF.regime.wTrades * whalePressure + SF.regime.wBook * book;
    const adx = adxLast(h1, 14);
    const side = Math.min(SF.regime.sideMax, Math.max(SF.regime.sideMin, 100 * (1 - (isFinite(adx) ? adx : SF.regime.adxFull) / SF.regime.adxFull)));
    const bull = (100 - side) * (0.5 + skor / 200); const bear = 100 - side - bull;
    regime = bull >= bear && bull >= side ? 'Bullish' : bear >= bull && bear >= side ? 'Bearish' : 'Sideways';
  }

  // alarm lonjakan (spek #8): 61 candle 1M, quote volume
  let alarm: SFSetup['alarm'] = 'n/a';
  if (k1m.length >= 61) {
    const w = k1m.slice(-61); const base = median(w.slice(0, 56).map(x => x.qv)); const last5 = w.slice(56);
    const atr1mPct = atrLast(w, 14) / w[60]!.c * 100;
    const movePct = Math.abs(last5[4]!.c / last5[0]!.o - 1) * 100;
    if (base > 0 && isFinite(atr1mPct) && atr1mPct > 0) {
      const ratio = (last5.reduce((s, x) => s + x.qv, 0) / 5) / base; // rata-rata 5 candle terakhir -> WASPADA
      const peak = Math.max(...last5.map(x => x.qv)) / base;          // volume terbesar 5 candle terakhir -> BAHAYA
      alarm = peak >= SF.alarm.dangerPeak && movePct >= SF.alarm.dangerMoveAtr * atr1mPct ? 'BAHAYA'
        : (ratio >= SF.alarm.warnVol || movePct >= SF.alarm.warnMoveAtr * atr1mPct) ? 'WASPADA' : 'tenang';
    }
  }

  let h1LongCache: Candle[] | null = null;
  return {
    symbol, opt, price, k15all, k15, h1, atr15, atrH1, atrH1Real, move1dPct, move4hPct, bids, asks, walls, allWalls, spoofCount, whalePressure,
    lows, highs, p90, rounds, zones8, thin, regime, alarm,
    h1Long: async () => (h1LongCache ??= await getKlines(symbol, '1h', SF.bt.candles)),
  };
}

// backtest memakai TF sesuai jarak SL: < 1.5% -> 15M, selain itu 1H
function btOnSeries(series: Candle[], use1h: boolean, side: Side, slPct: number, rrs: number[]) {
  const maxBars = use1h ? SF.bt.maxBars1h : SF.bt.maxBars15;
  if (series.length < SF.bt.warmup + maxBars + 30) return null;
  const em20 = emaSeries(series.map(x => x.c), 20), em50 = emaSeries(series.map(x => x.c), 50);
  const nowUp = em20[em20.length - 1]! > em50[em50.length - 1]!;
  return { tf: (use1h ? '1H' : '15M') as '15M' | '1H', bt: backtest(series, side, slPct, rrs, maxBars, nowUp) };
}
async function runBt(ctx: Ctx, side: Side, slPct: number, rrs: number[]) {
  const use1h = slPct >= SF.bt.slTfSwitchPct;
  const series = use1h ? await ctx.h1Long() : ctx.k15all;
  return btOnSeries(series, use1h, side, slPct, rrs);
}

// WR dasar SAJA (tanpa order book / transaksi / regime) untuk kartu hasil Scan menu lain.
// Memakai backtest yang SAMA persis dengan "WR dasar" di Cek entry (status 'belum'): ±10 weight per koin (1 request candle).
const quickWrCache = new Map<string, { at: number; res: { wr: number; n: number; tf: '15M' | '1H'; usedAllCandles: boolean; rr: number; breakevenWr: number; avgR: number } }>();
export async function quickWr(symbol: string, side: Side, entry: number, sl: number, tp: number) {
  const buy = side === 'BUY';
  if (!(buy ? sl < entry && entry < tp : tp < entry && entry < sl)) throw new Error(buy ? 'BUY: harus SL < entry < TP' : 'SELL: harus TP < entry < SL');
  const key = `${symbol}|${side}|${entry}|${sl}|${tp}`;
  const hit = quickWrCache.get(key); if (hit && Date.now() - hit.at < 300_000) return hit.res;
  const slPct = Math.abs(entry - sl) / entry * 100; const tpPct = Math.abs(tp - entry) / entry * 100; const rr = tpPct / slPct;
  const use1h = slPct >= SF.bt.slTfSwitchPct;
  const series = await getKlines(symbol, use1h ? '1h' : '15m', SF.bt.candles);
  const run = btOnSeries(series, use1h, side, slPct, [rr]);
  if (!run) throw new Error('Data backtest kurang');
  const b = run.bt.get(rr)!;
  const res = { wr: b.wr, n: b.n, tf: run.tf, usedAllCandles: b.usedAll, rr, breakevenWr: 100 / (1 + rr), avgR: b.wr / 100 * rr - (1 - b.wr / 100) };
  quickWrCache.set(key, { at: Date.now(), res });
  return res;
}

// SL anti-gocekan (spek #9). capped=false -> tanpa batas 4% (dipakai Cek entry / saran)
function antiGocekSl(ctx: Ctx, side: Side, capMode: SlCapMode | 'none') {
  const buy = side === 'BUY'; const sgn = buy ? 1 : -1; const { price, atr15, atrH1, p90 } = ctx;
  const wallsSide = ctx.allWalls.filter(w => w.side === (buy ? 'bid' : 'ask') && w.distPct <= SF.walls.maxDistPct); // SEMUA tembok >= Min. nilai, jarak <= 3%
  const bigWall = [...wallsSide].sort((a, b) => b.value - a.value);
  const slWall = bigWall.find(w => w.real) ?? bigWall[0] ?? null; // SL: utamakan tembok asli
  const swing = buy ? ctx.lows[0] : ctx.highs[0];
  const cands: Array<{ v: number; src: SFSetup['slSource'] }> = [];
  if (swing) cands.push({ v: swing.p - sgn * (p90 + SF.sl.swingBufAtr) * atr15, src: 'swing' });
  if (slWall) cands.push({ v: slWall.price - sgn * SF.sl.wallBufAtr1h * atrH1, src: 'wall' });
  if (!cands.length) cands.push({ v: price - sgn * SF.sl.fallbackAtr1h * atrH1, src: 'fallback' });
  const far = cands.reduce((a, b) => (buy ? (b.v < a.v ? b : a) : (b.v > a.v ? b : a)));
  let sl = far.v; let rounded = false;
  for (const r of ctx.rounds) {
    if (Math.abs(sl - r) <= SF.round.zoneAtr * p90 * atr15) { sl = r - sgn * (SF.round.zoneAtr * p90 + SF.sl.roundBuf) * atr15; rounded = true; break; }
  }
  const tooFar = Math.abs(price - sl) / price * 100 > SF.sl.maxPct;
  // potong: SL dipindah tepat ke 4% dari harga (BUY x0.96, SELL x1.04), setup tetap dipakai. tolak: setup dibuang. none: tanpa batas (Cek entry / saran).
  let clipped = false;
  if (capMode === 'potong' && tooFar) { sl = price * (1 - sgn * SF.sl.maxPct / 100); clipped = true; }
  return { sl, src: far.src, rounded, clipped, rejected: capMode === 'tolak' && tooFar };
}

// Kedalaman gocekan P90 (satuan ATR14 15M) dari candle 15M milik pemanggil — dipakai Fibo Retest rp11 (tanpa request Binance).
// Rumus sama dengan Setup Finder: swing fractal 3 di 1000 candle terakhir, sapuan pertama dalam 96 candle, close balik <= 4 candle.
// null kalau tidak ada sampel gocekan.
export function gocekP90FromOhlc(o: number[], h: number[], l: number[], c: number[]): number | null {
  const all: Candle[] = o.map((_, i) => ({ t: 0, o: o[i]!, h: h[i]!, l: l[i]!, c: c[i]!, v: 0, qv: 0 }));
  const k = all.slice(-SF.swing.candles);
  const depths = gocekDepthsAtr(k, findSwings(k, SF.swing.fractal), atrSeries(k, SF.swing.atr));
  return depths.length ? percentile(depths, SF.gocek.depthPct) : null;
}
/** Angka bulat di sekitar harga (sama dengan Setup Finder). */
export function sfRoundLevels(price: number): number[] { return roundLevels(price); }
export const SF_ROUND_ZONE_ATR = SF.round.zoneAtr;
export const SF_ROUND_BUF = SF.sl.roundBuf;

// SL anti-gocekan untuk LEVEL ENTRY tertentu (dipakai menu Sniper / Fibo Retest / Money Magnet, v18+).
// Logika sama dengan antiGocekSl, tapi dijangkarkan ke ENTRY limit (bukan harga live): swing terdekat DI LUAR entry,
// tembok order book DI LUAR entry (jarak <= 3% dari entry), angka bulat di sekitar SL, batas 4% dari entry (dipotong).
export async function sfAntiGocekForEntry(symbol: string, side: Side, entry: number): Promise<{ sl: number; src: 'swing' | 'wall' | 'fallback'; rounded: boolean; clipped: boolean; p90: number }> {
  const ctx = await loadCtx(symbol, { rr: [2], side, minWall: SF.walls.minUsdt }, false);
  const buy = side === 'BUY'; const sgn = buy ? 1 : -1; const { atr15, atrH1, p90 } = ctx;
  const wallsSide = ctx.allWalls.filter(w => w.side === (buy ? 'bid' : 'ask') && (buy ? w.price < entry : w.price > entry) && Math.abs(entry - w.price) / entry * 100 <= SF.walls.maxDistPct);
  const bigWall = [...wallsSide].sort((a, b) => b.value - a.value);
  const slWall = bigWall.find(w => w.real) ?? bigWall[0] ?? null;
  const sw = findSwings(ctx.k15, SF.swing.fractal);
  const fromIdx = ctx.k15.length - SF.swing.lookback;
  const outside = (buy ? sw.lows.filter(s => s.i >= fromIdx && s.p < entry).sort((a, b) => b.p - a.p) : sw.highs.filter(s => s.i >= fromIdx && s.p > entry).sort((a, b) => a.p - b.p));
  const swing = outside[0];
  const cands: Array<{ v: number; src: 'swing' | 'wall' | 'fallback' }> = [];
  if (swing) cands.push({ v: swing.p - sgn * (p90 + SF.sl.swingBufAtr) * atr15, src: 'swing' });
  if (slWall) cands.push({ v: slWall.price - sgn * SF.sl.wallBufAtr1h * atrH1, src: 'wall' });
  if (!cands.length) cands.push({ v: entry - sgn * SF.sl.fallbackAtr1h * atrH1, src: 'fallback' });
  const far = cands.reduce((a, b) => (buy ? (b.v < a.v ? b : a) : (b.v > a.v ? b : a)));
  let sl = far.v; let rounded = false;
  for (const r of roundLevels(entry)) {
    if (Math.abs(sl - r) <= SF.round.zoneAtr * p90 * atr15) { sl = r - sgn * (SF.round.zoneAtr * p90 + SF.sl.roundBuf) * atr15; rounded = true; break; }
  }
  let clipped = false;
  if (Math.abs(entry - sl) / entry * 100 > SF.sl.maxPct) { sl = entry * (1 - sgn * SF.sl.maxPct / 100); clipped = true; }
  return { sl, src: far.src, rounded, clipped, p90 };
}

// kandidat entry (spek #10) — validitas dicek pemanggil
function entryCandidates(ctx: Ctx, side: Side) {
  const buy = side === 'BUY'; const sgn = buy ? 1 : -1;
  // dari 10 tembok total: sisi sama (BUY: tembok beli di bawah harga; SELL: tembok jual di atas), jarak <= 3%,
  // utamakan yang asli (kalau tidak ada yang asli pakai semua), lalu nilai USDT TERBESAR
  const wallsSide = ctx.walls.filter(w => w.side === (buy ? 'bid' : 'ask') && w.distPct <= SF.walls.maxDistPct);
  const realSide = wallsSide.filter(w => w.real);
  const entWall = [...(realSide.length ? realSide : wallsSide)].sort((a, b) => b.value - a.value)[0] ?? null;
  const swZ = ctx.zones8.filter(z => z.kind === (buy ? 'swingLow' : 'swingHigh')); // swing terdekat di antara 8 zona terdekat
  const swing = swZ.length ? { p: swZ[0]!.p } : null;
  const ents: Array<{ kind: 'market' | 'wall' | 'swing'; v: number; wallReal: boolean | null }> = [{ kind: 'market', v: ctx.price, wallReal: null }];
  if (entWall) ents.push({ kind: 'wall', v: entWall.price + sgn * SF.entry.wallBufAtr * ctx.atr15, wallReal: entWall.real });
  if (swing) ents.push({ kind: 'swing', v: swing.p + sgn * SF.entry.swingBufAtr * ctx.atr15, wallReal: null });
  return ents;
}

// ─── Analisa satu koin (Cari setup terbaik) ──────────────────────────────
export async function analyzeSetupFinderCoin(symbol: string, opt: SFOptions, single = false): Promise<SFCoinResult> {
  const ctx = await loadCtx(symbol, opt, single);
  const { price, regime, alarm, whalePressure } = ctx;
  const setups: SFSetup[] = []; const skipped: string[] = [];
  const sides: Side[] = opt.side === 'BOTH' ? ['BUY', 'SELL'] : [opt.side];

  for (const side of sides) {
    const buy = side === 'BUY'; const sgn = buy ? 1 : -1;
    const ag = antiGocekSl(ctx, side, opt.slCap ?? 'potong');
    if (ag.rejected) { skipped.push(`${side}: SL > ${SF.sl.maxPct}% — setup ditolak`); continue; }
    const sl = ag.sl;
    const valid = entryCandidates(ctx, side).filter(e => (buy ? sl < e.v && e.v <= price : price <= e.v && e.v < sl) && Math.abs(e.v - sl) > 0);

    const best = new Map<number, SFSetup>();
    for (const e of valid) {
      const risk = Math.abs(e.v - sl); const slPct = risk / e.v * 100;
      const run = await runBt(ctx, side, slPct, opt.rr);
      if (!run) { skipped.push(`${side}: data backtest kurang`); continue; }
      const distFrac = Math.abs(price - e.v) / price;
      const fill = e.kind === 'market' ? 100 : touchStats(ctx.k15, side, 'limit', distFrac, 0).fill;
      for (const rr of opt.rr) {
        const b = run.bt.get(rr)!; const wr = b.wr; const avgR = wr / 100 * rr - (1 - wr / 100);
        const tp = e.v + sgn * rr * risk; const score = avgR * fill / 100;
        const lo = Math.min(e.v, tp), hi = Math.max(e.v, tp);
        const opp = ctx.walls.filter(w => w.side === (buy ? 'ask' : 'bid') && w.price >= lo && w.price <= hi).sort((a, b) => b.value - a.value)[0] ?? null;
        const setup: SFSetup = {
          symbol, side, rr, entryKind: e.kind, orderType: e.kind === 'market' ? 'market' : 'limit',
          entry: e.v, sl, tp, slPct, price, slSource: ag.src, slRounded: ag.rounded, slClipped: ag.clipped,
          tf: run.tf, n: b.n, nWin: b.nWin, usedAllCandles: b.usedAll,
          wr, breakevenWr: 100 / (1 + rr), avgR, fillProb: fill, score,
          wrSuspicious: wr > SF.bt.suspiciousWr,
          medianHoursToTp: b.medianBars === null ? null : b.medianBars * (run.tf === '1H' ? 1 : 0.25),
          regime, align: regime === null ? 'n/a' : regime === 'Sideways' ? 'netral' : ((buy && regime === 'Bullish') || (!buy && regime === 'Bearish')) ? 'searah' : 'melawan',
          oppWall: opp ? { price: opp.price, value: opp.value } : null,
          thinInPath: ctx.thin.some(t => t.hi > lo && t.lo < hi),
          alarm, whalePressure, wallReal: e.wallReal,
        };
        const cur = best.get(rr);
        if (!cur || setup.score > cur.score) best.set(rr, setup); // 1 kandidat skor tertinggi per (arah, RR)
      }
    }
    const rows = [...best.values()];
    if (rows.length) { const top = rows.reduce((a, b) => (b.score > a.score ? b : a)); top.best = true; }
    setups.push(...rows);
  }

  return {
    symbol, price, atr15: ctx.atr15, atrH1: ctx.atrH1, p90GocekAtr: ctx.p90, regime, whalePressure, alarm,
    move1dPct: ctx.move1dPct, move4hPct: ctx.move4hPct,
    walls: ctx.walls.slice(0, 20), spoofCount: ctx.spoofCount, setups, skipped,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// CEK ENTRY & SARAN (spek bagian 16, rincian poin dari user 2026-11-05)
// ═══════════════════════════════════════════════════════════════════════
export interface CheckInput { side: Side; entry: number; sl: number; tp: number; status: 'belum' | 'berjalan'; minRr: number; minWall: number }
export interface CheckPoint { label: string; pts: number; note: string }
export interface CheckSuggestion {
  entry: number; sl: number; tp: number; entryKind: 'user' | 'market' | 'wall' | 'swing'; slKind: 'antigocek' | 'user'; tpKind: 'user' | 'minrr';
  rr: number; wr: number; avgR: number; fillProb: number; score: number; tf: '15M' | '1H'; n: number; stillLosing: boolean;
}
export interface CheckResult {
  symbol: string; side: Side; status: 'belum' | 'berjalan'; price: number; ref: number;
  finished: null | 'TP' | 'SL';
  slPct: number; tpPct: number; rr: number; rrRating: 'ok' | 'waspada' | 'buruk';
  orderType: OrderKind | null; fillProb: number | null; escapeProb: number | null;
  tf: '15M' | '1H' | null; n: number | null; usedAllCandles: boolean | null;
  baseWr: number | null; avgR: number | null; points: CheckPoint[]; totalPts: number; adj: number; finalProb: number | null;
  regime: SFSetup['regime']; alarm: SFSetup['alarm']; whalePressure: number; move1dPct: number; move4hPct: number;
  antiGocekSl: number; suggestion: CheckSuggestion | null; message: string; version: string;
}

const clip = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export async function checkSetupEntry(symbol: string, inp: CheckInput): Promise<CheckResult> {
  const ctx = await loadCtx(symbol, { rr: SF.rr, side: inp.side, minWall: inp.minWall }, true);
  const { price } = ctx; const side = inp.side; const buy = side === 'BUY'; const sgn = buy ? 1 : -1;
  const { entry, sl, tp } = inp;
  const ref = inp.status === 'belum' ? entry : price;
  // validitas level
  if (!(buy ? sl < ref && ref < tp : tp < ref && ref < sl)) {
    if (inp.status === 'belum') throw new Error(buy ? 'BUY: harus SL < entry < TP' : 'SELL: harus TP < entry < SL');
  }
  const ag = antiGocekSl(ctx, side, 'none');          // tanpa batas 4% — dipakai SARAN
  const agCap = antiGocekSl(ctx, side, 'potong');     // sudah dipotong 4% — pembanding SL user
  const base = {
    symbol, side, status: inp.status, price, ref, regime: ctx.regime, alarm: ctx.alarm, whalePressure: ctx.whalePressure,
    move1dPct: ctx.move1dPct, move4hPct: ctx.move4hPct, antiGocekSl: agCap.sl, version: SF.VERSION,
  };
  // sudah berjalan & harga sudah lewat TP/SL -> selesai
  if (inp.status === 'berjalan') {
    const hitTp = buy ? price >= tp : price <= tp; const hitSl = buy ? price <= sl : price >= sl;
    if (hitTp || hitSl) {
      return { ...base, finished: hitTp ? 'TP' : 'SL', slPct: 0, tpPct: 0, rr: 0, rrRating: 'buruk', orderType: null, fillProb: null, escapeProb: null, tf: null, n: null, usedAllCandles: null, baseWr: null, avgR: null, points: [], totalPts: 0, adj: 0, finalProb: null, suggestion: null, message: `Selesai: harga sekarang sudah ${hitTp ? 'melewati TP' : 'melewati SL'}.` };
    }
    if (!(buy ? sl < price && price < tp : tp < price && price < sl)) throw new Error('Level tidak valid terhadap harga sekarang');
  }
  const slPct = Math.abs(ref - sl) / ref * 100; const tpPct = Math.abs(tp - ref) / ref * 100; const rr = tpPct / slPct;
  const rrRating = rr >= 1.5 ? 'ok' : rr >= 1 ? 'waspada' : 'buruk';

  // WR dasar (backtest, filter tren kalau sampel >= 30, kalau kurang semua candle)
  const run = await runBt(ctx, side, slPct, [rr]);
  if (!run) throw new Error('Data backtest kurang');
  const b = run.bt.get(rr)!; const baseWr = b.wr; const avgR = baseWr / 100 * rr - (1 - baseWr / 100);

  // jenis order, peluang tersentuh, harga kabur
  let orderType: OrderKind | null = null; let fillProb: number | null = null; let escapeProb: number | null = null;
  if (inp.status === 'belum') {
    orderType = orderKindFor(side, entry, price);
    const ts = touchStats(ctx.k15, side, orderType, Math.abs(entry - price) / price, Math.abs(tp - price) / price);
    fillProb = ts.fill; escapeProb = ts.escape;
  }

  // poin cek
  const pts: CheckPoint[] = [];
  const add = (label: string, p: number, note: string) => pts.push({ label, pts: p, note });
  add('RR rencana', 0, `1:${rr.toFixed(2)} (${rrRating === 'ok' ? 'ok ≥ 1.5' : rrRating === 'waspada' ? 'waspada ≥ 1' : 'buruk < 1'}) — info saja`);
  if (ctx.regime) {
    if (ctx.regime === 'Sideways') add('Regime', -3, 'SIDEWAYS');
    else if ((buy && ctx.regime === 'Bullish') || (!buy && ctx.regime === 'Bearish')) add('Regime', 8, `searah (${ctx.regime})`);
    else add('Regime', -10, `melawan (${ctx.regime})`);
  } else add('Regime', 0, 'tidak ada data');
  const swingLv = (buy ? ctx.lows : ctx.highs).map(s => s.p);
  // zona swing: swing low = (swing - p90 x ATR15) .. swing; swing high = swing .. (swing + p90 x ATR15). Zona angka bulat +-0.5 x p90 x ATR15.
  const zw = ctx.p90 * ctx.atr15;
  const inGocek = swingLv.some(l => (buy ? sl >= l - zw && sl <= l : sl >= l && sl <= l + zw)) || ctx.rounds.some(r => Math.abs(sl - r) <= SF.round.zoneAtr * zw);
  add('SL di zona gocekan', inGocek ? -15 : 0, inGocek ? 'SL jatuh di zona swing / angka bulat' : 'tidak');
  const eps = 1e-9 * price; const closer = buy ? sl > agCap.sl + eps : sl < agCap.sl - eps;
  add('SL vs SL anti-gocekan', closer ? -6 : 6, `${closer ? 'lebih dekat' : 'sama / lebih jauh'} dari ${agCap.sl.toFixed(6)}${agCap.clipped ? ' (sudah dipotong 4%)' : ''}`);
  const inThin = (v: number) => ctx.thin.some(t => v >= t.lo && v < t.hi);
  add('SL di zona tipis', inThin(sl) ? -4 : 0, inThin(sl) ? 'ya' : 'tidak');
  add('TP di zona tipis', inThin(tp) ? 3 : 0, inThin(tp) ? 'ya' : 'tidak');
  add('Alarm', ctx.alarm === 'BAHAYA' ? -8 : ctx.alarm === 'WASPADA' ? -4 : 0, ctx.alarm);
  const lo1 = Math.min(sl, ref), hi1 = Math.max(sl, ref);
  const prot = ctx.walls.filter(w => w.side === (buy ? 'bid' : 'ask') && w.price > lo1 && w.price < hi1);
  add('Tembok pelindung SL', prot.length ? (prot.some(w => w.real) ? 6 : 3) : 0, prot.length ? (prot.some(w => w.real) ? 'ada, asli (≥ 2 scan)' : 'ada, belum terbukti') : 'tidak ada');
  const lo2 = Math.min(ref, tp), hi2 = Math.max(ref, tp);
  const opp = ctx.walls.filter(w => w.side === (buy ? 'ask' : 'bid') && w.price > lo2 && w.price < hi2);
  add('Tembok lawan ke TP', opp.length ? -8 : 4, opp.length ? 'ada di antara ref dan TP' : 'tidak ada');
  add('Jenis order / peluang tersentuh', 0, orderType ? `${orderType}${fillProb !== null ? `, tersentuh ${fillProb.toFixed(0)}%` : ''} — info saja` : 'posisi berjalan');
  const totalPts = pts.reduce((s, p) => s + p.pts, 0); const adj = clip(0.6 * totalPts, -12, 12);
  const finalProb = clip(baseWr + adj, 3, 97);

  // saran
  const userScoreWr = baseWr; const userAvgR = avgR;
  let bestSug: CheckSuggestion | null = null;
  const entries: Array<{ kind: CheckSuggestion['entryKind']; v: number }> = [{ kind: 'user', v: entry }];
  for (const e of entryCandidates(ctx, side)) if (e.kind !== 'market' || Math.abs(e.v - entry) > 1e-12) entries.push({ kind: e.kind, v: e.v });
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.kind !== 'user' && (buy ? e.v > price * 1.003 : e.v < price * 0.997)) continue; // entry kandidat > 0.3% melewati harga
    const slOpts: Array<{ kind: CheckSuggestion['slKind']; v: number }> = [{ kind: 'antigocek', v: ag.sl }, { kind: 'user', v: sl }];
    for (const s of slOpts) {
      if (!(buy ? s.v < e.v : s.v > e.v)) continue; const risk = Math.abs(e.v - s.v); if (!(risk > 0)) continue;
      const tpOpts: Array<{ kind: CheckSuggestion['tpKind']; v: number }> = [{ kind: 'user', v: tp }, { kind: 'minrr', v: e.v + sgn * inp.minRr * risk }];
      for (const t of tpOpts) {
        if (!(buy ? t.v > e.v : t.v < e.v)) continue;
        const rrC = Math.abs(t.v - e.v) / risk; if (rrC + 1e-9 < inp.minRr) continue; // buang kalau RR < Min.RR
        const key = `${e.v.toFixed(8)}|${s.v.toFixed(8)}|${t.v.toFixed(8)}`; if (seen.has(key)) continue; seen.add(key);
        if (e.kind === 'user' && s.kind === 'user' && t.kind === 'user') continue; // = setup user sendiri
        const sPct = risk / e.v * 100; const r2 = await runBt(ctx, side, sPct, [rrC]); if (!r2) continue;
        const bt2 = r2.bt.get(rrC)!; const wr2 = bt2.wr; const avg2 = wr2 / 100 * rrC - (1 - wr2 / 100);
        if (!(wr2 >= userScoreWr && avg2 > userAvgR + 0.02)) continue; // terima hanya kalau WR >= WR user DAN rata-rata R > punya user + 0.02
        const kind2 = orderKindFor(side, e.v, price);
        const fill2 = kind2 === 'market' ? 100 : touchStats(ctx.k15, side, kind2, Math.abs(e.v - price) / price, 0).fill;
        const score = avg2 * fill2 / 100;
        if (!bestSug || score > bestSug.score) bestSug = { entry: e.v, sl: s.v, tp: t.v, entryKind: e.kind, slKind: s.kind, tpKind: t.kind, rr: rrC, wr: wr2, avgR: avg2, fillProb: fill2, score, tf: r2.tf, n: bt2.n, stillLosing: avg2 <= 0 };
      }
    }
  }
  return {
    ...base, finished: null, slPct, tpPct, rr, rrRating, orderType, fillProb, escapeProb,
    tf: run.tf, n: b.n, usedAllCandles: b.usedAll, baseWr, avgR, points: pts, totalPts, adj, finalProb,
    suggestion: bestSug,
    message: bestSug ? 'Ada setup yang lebih baik (lihat saran).' : 'Setup kamu sudah yang terbaik.',
  };
}

// ─── Peringkat (revisi user 2026-11-07): 1 baris per (koin, arah, RR) ───
// Tiap (koin, arah, RR) sudah berisi 1 kandidat entry dengan skor tertinggi (dari analisa koin).
// Semua baris diurutkan skor tertinggi; satu koin boleh muncul beberapa kali kalau RR beda.
// Perbandingan RR (WR & rata-rata R tiap RR, RR terbaik 🏆) dikeluarkan di tabel terpisah.
export type SFRow = SFSetup & { move1dPct: number; move4hPct: number };
export interface SFRrComparison { symbol: string; side: Side; rows: Array<{ rr: number; wr: number; avgR: number; fillProb: number; score: number; best: boolean }> }
export function rankSetups(results: SFCoinResult[], minWr: number, show: number, onlyPositive: boolean): { rows: SFRow[]; comparison: SFRrComparison[] } {
  const all: SFRow[] = [];
  for (const r of results) {
    for (const x of r.setups) {
      if (x.wr < minWr) continue;
      if (onlyPositive && !(x.avgR > 0)) continue;
      all.push({ ...x, move1dPct: r.move1dPct, move4hPct: r.move4hPct });
    }
  }
  all.sort((a, b) => b.score - a.score);
  const rows = show > 0 ? all.slice(0, show) : all;
  const seen = new Set<string>(); const comparison: SFRrComparison[] = [];
  for (const row of rows) {
    const k = `${row.symbol}|${row.side}`; if (seen.has(k)) continue; seen.add(k);
    const coin = results.find(r => r.symbol === row.symbol); if (!coin) continue;
    comparison.push({
      symbol: row.symbol, side: row.side,
      rows: coin.setups.filter(x => x.side === row.side).sort((a, b) => a.rr - b.rr)
        .map(x => ({ rr: x.rr, wr: x.wr, avgR: x.avgR, fillProb: x.fillProb, score: x.score, best: !!x.best })),
    });
  }
  return { rows, comparison };
}

// ─── Scan progresif banyak koin (3 thread, koin gagal diganti) ──────────
export type SFScanParams = { rr: number[]; side: 'BUY' | 'SELL' | 'BOTH'; minWall: number; coins: number; slCap: SlCapMode; symbols?: string[] };
export interface SFScanState {
  status: 'idle' | 'running' | 'complete' | 'error'; errorMessage?: string;
  params: SFScanParams | null; target: number; scanned: number; failed: number; skippedSetups: number;
  startedAt: number; fetchedAt: number; usedWeight: number; results: SFCoinResult[];
}
export const sfState: SFScanState = { status: 'idle', params: null, target: 0, scanned: 0, failed: 0, skippedSetups: 0, startedAt: 0, fetchedAt: 0, usedWeight: 0, results: [] };
let sfRunning = false;
export const sfIsRunning = () => sfRunning;

// "Semua koin" = semua USDT perpetual status TRADING, urut volume 24 jam, tanpa batas 550
export async function getAllUsdtPerps(): Promise<string[]> {
  const [info, tk] = await Promise.all([
    bget<{ symbols: Array<{ symbol: string; status: string; contractType: string; quoteAsset: string }> }>('/fapi/v1/exchangeInfo'),
    bget<Array<{ symbol: string; quoteVolume: string }>>('/fapi/v1/ticker/24hr'),
  ]);
  const ok = new Set(info.symbols.filter(x => x.status === 'TRADING' && x.contractType === 'PERPETUAL' && x.quoteAsset === 'USDT').map(x => x.symbol));
  return tk.filter(t => ok.has(t.symbol)).sort((a, b) => num(b.quoteVolume) - num(a.quoteVolume)).map(t => t.symbol);
}

export function normalizeRr(list: number[]): number[] {
  const u = [...new Set(list.filter(x => isFinite(x) && x >= 0.5 && x <= 10))].sort((a, b) => a - b);
  return (u.length ? u : SF.rr).slice(0, 6);
}

export async function runSetupFinderScan(pool: string[], p: SFScanParams): Promise<void> {
  if (sfRunning) return;
  sfRunning = true;
  Object.assign(sfState, { status: 'running', errorMessage: undefined, params: p, target: Math.min(p.coins, pool.length), scanned: 0, failed: 0, skippedSetups: 0, startedAt: Date.now(), results: [] as SFCoinResult[] });
  try {
    let next = 0;
    const opt: SFOptions = { rr: p.rr, side: p.side, minWall: p.minWall, slCap: p.slCap };
    const worker = async () => {
      for (;;) {
        if (sfState.scanned >= sfState.target || next >= pool.length) return;
        const sym = pool[next++]!;
        try {
          const r = await analyzeSetupFinderCoin(sym, opt, false);
          if (sfState.scanned >= sfState.target) return;
          sfState.scanned++; sfState.skippedSetups += r.skipped.length; sfState.results.push(r);
        } catch { sfState.failed++; /* koin berikutnya di pool jadi pengganti */ }
        sfState.usedWeight = sfUsedWeight();
      }
    };
    await Promise.all(Array.from({ length: SF.threads }, worker));
    sfState.status = 'complete'; sfState.fetchedAt = Date.now();
  } catch (e) {
    sfState.status = 'error'; sfState.errorMessage = e instanceof Error ? e.message : 'Unknown error';
  } finally { sfRunning = false; }
}
