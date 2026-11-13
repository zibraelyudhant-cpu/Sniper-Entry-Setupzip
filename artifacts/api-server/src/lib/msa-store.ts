// ═══════════════════════════════════════════════════════════════════════════
// 📐 Market Structure — gudang candle (v26, request user 2026-11-13). TAMBAHAN program ini (bukan kode referensi).
// SUMBER UTAMA: tabel Postgres `msa_candles` (permanen). File .npz di disk = salinan cepat untuk Python
// (backend/data.py asli membaca {SIMBOL}_{tf}.npz berisi t,o,h,l,c,v; t = open time ms). Kalau file .npz hilang
// (deploy / restart), dibuat ulang dari Postgres TANPA unduh ulang dari Binance.
// Isi: 100 koin volume terbesar, TF 15m / 1h / 4h / 1d, candle yang sudah close, maksimal 50.000 candle terbaru
// per koin per TF di file .npz (Postgres menyimpan potongan utuh: 50.000 + sisa potongan tertua, maks < 55.000).
// Unduhan awal bertahap di latar belakang (pakai rem weight Binance yang sama dengan scan), lalu diperbarui tiap 1 jam.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { db, msaCandlesTable } from '@workspace/db';
import { and, eq, sql } from 'drizzle-orm';
import { binanceWeightGate, noteBinanceWeight } from './smc';
import { getUniverse } from '../routes/screener';
import { logger } from './logger';

export const MSA = {
  COINS: 100,
  TFS: ['15m', '1h', '4h', '1d'] as const,
  MAX_CANDLES: 50_000,
  CHUNK: 5_000,
  PAGE: 1500,
  UPDATE_MS: 60 * 60_000,
};
const TF_MS: Record<string, number> = { '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 };
const BASE = 'https://fapi.binance.com';

export interface MsaStoreStatus {
  phase: 'idle' | 'rebuild' | 'download' | 'update' | 'error';
  storage: string;               // penyimpanan yang dipakai
  dataDir: string;
  coins: number; pairsDone: number; pairsTotal: number; current: string | null;
  candlesInDb: number; npzFiles: number; dbBytes: number | null;
  startedAt: number | null; finishedAt: number | null; nextUpdateAt: number | null;
  lastError: string | null; rebuiltFromDb: number;
}
export const msaStatus: MsaStoreStatus = {
  phase: 'idle', storage: 'Replit PostgreSQL (tabel msa_candles) + salinan .npz di disk',
  dataDir: '', coins: 0, pairsDone: 0, pairsTotal: 0, current: null,
  candlesInDb: 0, npzFiles: 0, dbBytes: null, startedAt: null, finishedAt: null, nextUpdateAt: null, lastError: null, rebuiltFromDb: 0,
};

type Rows = { t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };
const emptyRows = (): Rows => ({ t: [], o: [], h: [], l: [], c: [], v: [] });

// ─── kodek potongan: zlib( Float64LE [t.., o.., h.., l.., c.., v..] ) ───
function encode(r: Rows): Buffer {
  const n = r.t.length, f = new Float64Array(n * 6);
  [r.t, r.o, r.h, r.l, r.c, r.v].forEach((col, k) => f.set(col, k * n));
  return zlib.deflateSync(Buffer.from(f.buffer));
}
function decode(buf: Buffer, n: number): Rows {
  const raw = zlib.inflateSync(buf);
  const f = new Float64Array(raw.buffer, raw.byteOffset, raw.byteLength / 8);
  const col = (k: number) => Array.from(f.subarray(k * n, (k + 1) * n));
  return { t: col(0), o: col(1), h: col(2), l: col(3), c: col(4), v: col(5) };
}
function mergeRows(a: Rows, b: Rows): Rows {
  const m = new Map<number, number[]>();
  for (const r of [a, b]) for (let i = 0; i < r.t.length; i++) m.set(r.t[i]!, [r.o[i]!, r.h[i]!, r.l[i]!, r.c[i]!, r.v[i]!]);
  const ts = [...m.keys()].sort((x, y) => x - y), out = emptyRows();
  for (const t of ts) { const x = m.get(t)!; out.t.push(t); out.o.push(x[0]!); out.h.push(x[1]!); out.l.push(x[2]!); out.c.push(x[3]!); out.v.push(x[4]!); }
  return out;
}

// ─── penulis .npz (format numpy: zip tanpa kompresi berisi t.npy (<i8) dan o/h/l/c/v.npy (<f8)) ───
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Buffer): number { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function npy(descr: '<i8' | '<f8', values: number[]): Buffer {
  let header = `{'descr': '${descr}', 'fortran_order': False, 'shape': (${values.length},), }`;
  const pre = 10; // magic(6) + versi(2) + panjang header(2)
  const total = Math.ceil((pre + header.length + 1) / 64) * 64;
  header = header + ' '.repeat(total - pre - header.length - 1) + '\n';
  const head = Buffer.alloc(pre);
  head.write('\x93NUMPY', 0, 'latin1'); head[6] = 1; head[7] = 0; head.writeUInt16LE(header.length, 8);
  const data = Buffer.alloc(values.length * 8);
  if (descr === '<i8') values.forEach((x, i) => data.writeBigInt64LE(BigInt(Math.round(x)), i * 8));
  else values.forEach((x, i) => data.writeDoubleLE(x, i * 8));
  return Buffer.concat([head, Buffer.from(header, 'latin1'), data]);
}
function zipStored(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(f.data.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, f.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(f.data.length, 20); ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38); ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + f.data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cd, end]);
}
export function writeNpz(file: string, r: Rows): void {
  const buf = zipStored([
    { name: 't.npy', data: npy('<i8', r.t) }, { name: 'o.npy', data: npy('<f8', r.o) }, { name: 'h.npy', data: npy('<f8', r.h) },
    { name: 'l.npy', data: npy('<f8', r.l) }, { name: 'c.npy', data: npy('<f8', r.c) }, { name: 'v.npy', data: npy('<f8', r.v) },
  ]);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);   // tulis atomik: Python tidak pernah membaca file setengah jadi
}

// ─── Postgres ───
async function loadPair(symbol: string, tf: string): Promise<Rows> {
  const rows = await db.select().from(msaCandlesTable).where(and(eq(msaCandlesTable.symbol, symbol), eq(msaCandlesTable.tf, tf))).orderBy(msaCandlesTable.chunk);
  let out = emptyRows();
  for (const r of rows) {
    const d = decode(r.data, r.n);
    out = out.t.length ? mergeRows(out, d) : d;
  }
  return out;
}
async function lastTime(symbol: string, tf: string): Promise<number | null> {
  const r = await db.select({ t1: sql<number>`max(${msaCandlesTable.t1})` }).from(msaCandlesTable).where(and(eq(msaCandlesTable.symbol, symbol), eq(msaCandlesTable.tf, tf)));
  const v = r[0]?.t1;
  return v === null || v === undefined ? null : Number(v);
}
async function savePairRows(symbol: string, tf: string, add: Rows): Promise<void> {
  if (!add.t.length) return;
  const span = MSA.CHUNK * TF_MS[tf]!;
  const groups = new Map<number, Rows>();
  for (let i = 0; i < add.t.length; i++) {
    const ch = Math.floor(add.t[i]! / span);
    const g = groups.get(ch) ?? emptyRows(); groups.set(ch, g);
    g.t.push(add.t[i]!); g.o.push(add.o[i]!); g.h.push(add.h[i]!); g.l.push(add.l[i]!); g.c.push(add.c[i]!); g.v.push(add.v[i]!);
  }
  for (const [ch, g] of groups) {
    const ex = await db.select().from(msaCandlesTable).where(and(eq(msaCandlesTable.symbol, symbol), eq(msaCandlesTable.tf, tf), eq(msaCandlesTable.chunk, ch)));
    const merged = ex[0] ? mergeRows(decode(ex[0].data, ex[0].n), g) : mergeRows(emptyRows(), g);
    const row = { symbol, tf, chunk: ch, t0: merged.t[0]!, t1: merged.t[merged.t.length - 1]!, n: merged.t.length, data: encode(merged) };
    await db.insert(msaCandlesTable).values(row).onConflictDoUpdate({
      target: [msaCandlesTable.symbol, msaCandlesTable.tf, msaCandlesTable.chunk],
      set: { t0: row.t0, t1: row.t1, n: row.n, data: row.data, updatedAt: sql`now()` },
    });
  }
  // potong: hapus potongan yang seluruhnya di luar 50.000 candle terbaru
  const meta = await db.select({ chunk: msaCandlesTable.chunk, n: msaCandlesTable.n }).from(msaCandlesTable)
    .where(and(eq(msaCandlesTable.symbol, symbol), eq(msaCandlesTable.tf, tf))).orderBy(sql`${msaCandlesTable.chunk} desc`);
  let acc = 0;
  for (const m of meta) {
    if (acc >= MSA.MAX_CANDLES) await db.delete(msaCandlesTable).where(and(eq(msaCandlesTable.symbol, symbol), eq(msaCandlesTable.tf, tf), eq(msaCandlesTable.chunk, m.chunk)));
    acc += m.n;
  }
}

// ─── Binance (candle yang sudah close saja) ───
async function fetchPage(symbol: string, tf: string, opt: { endTime?: number; startTime?: number }): Promise<Rows> {
  const q = new URLSearchParams({ symbol, interval: tf, limit: String(MSA.PAGE) });
  if (opt.endTime !== undefined) q.set('endTime', String(opt.endTime));
  if (opt.startTime !== undefined) q.set('startTime', String(opt.startTime));
  for (let attempt = 0; attempt < 4; attempt++) {
    await binanceWeightGate();
    const res = await fetch(`${BASE}/fapi/v1/klines?${q}`, { headers: { Accept: 'application/json' } });
    noteBinanceWeight(res);
    if (res.status === 418 || res.status === 429) { await new Promise(r => setTimeout(r, Number(res.headers.get('retry-after') ?? 10) * 1000)); continue; }
    if (!res.ok) throw new Error(`Binance ${res.status} untuk ${symbol} ${tf}`);
    const data = (await res.json()) as unknown[][];
    const now = Date.now(), out = emptyRows();
    for (const k of data) {
      if (!(Number(k[6]) < now)) continue;   // hanya candle yang sudah close
      out.t.push(Number(k[0])); out.o.push(parseFloat(k[1] as string)); out.h.push(parseFloat(k[2] as string));
      out.l.push(parseFloat(k[3] as string)); out.c.push(parseFloat(k[4] as string)); out.v.push(parseFloat(k[5] as string));
    }
    return out;
  }
  throw new Error(`Binance rate limit untuk ${symbol} ${tf}`);
}
async function syncPair(symbol: string, tf: string): Promise<boolean> {
  const last = await lastTime(symbol, tf);
  let got = emptyRows();
  if (last === null) {
    // unduhan awal: mundur dari candle terbaru sampai 50.000 candle atau awal listing
    let end: number | undefined;
    for (let p = 0; p < Math.ceil(MSA.MAX_CANDLES / MSA.PAGE) + 1 && got.t.length < MSA.MAX_CANDLES; p++) {
      const pg = await fetchPage(symbol, tf, end === undefined ? {} : { endTime: end });
      if (!pg.t.length) break;
      got = mergeRows(pg, got);
      end = pg.t[0]! - 1;
      if (pg.t.length < MSA.PAGE - 1) break;   // sudah sampai candle paling awal
    }
  } else {
    // pembaruan: maju dari candle terakhir yang tersimpan
    let start = last + 1;
    for (let p = 0; p < 40; p++) {
      const pg = await fetchPage(symbol, tf, { startTime: start });
      if (!pg.t.length) break;
      got = mergeRows(got, pg);
      start = pg.t[pg.t.length - 1]! + 1;
      if (pg.t.length < MSA.PAGE - 1) break;
    }
  }
  if (got.t.length) await savePairRows(symbol, tf, got);
  return got.t.length > 0;
}

// ─── .npz dari Postgres ───
let dataDir = '';
export function msaDataDir(): string { return dataDir; }
const npzPath = (symbol: string, tf: string) => path.join(dataDir, `${symbol}_${tf}.npz`);
async function writePairNpz(symbol: string, tf: string): Promise<boolean> {
  const r = await loadPair(symbol, tf);
  if (!r.t.length) return false;
  const k = Math.max(0, r.t.length - MSA.MAX_CANDLES);
  const cut: Rows = { t: r.t.slice(k), o: r.o.slice(k), h: r.h.slice(k), l: r.l.slice(k), c: r.c.slice(k), v: r.v.slice(k) };
  writeNpz(npzPath(symbol, tf), cut);
  return true;
}
/** Buat ulang .npz yang hilang dari Postgres (tanpa Binance). Return jumlah file yang dibuat. */
export async function msaRebuildMissingNpz(): Promise<number> {
  const pairs = await db.selectDistinct({ symbol: msaCandlesTable.symbol, tf: msaCandlesTable.tf }).from(msaCandlesTable);
  let made = 0;
  for (const p of pairs) {
    if (fs.existsSync(npzPath(p.symbol, p.tf))) continue;
    if (await writePairNpz(p.symbol, p.tf)) made++;
  }
  return made;
}
async function refreshCounts(): Promise<void> {
  try {
    const r = await db.select({ n: sql<number>`coalesce(sum(${msaCandlesTable.n}),0)` }).from(msaCandlesTable);
    msaStatus.candlesInDb = Number(r[0]?.n ?? 0);
    const s = await db.execute(sql`select pg_total_relation_size('msa_candles') as b`);
    const row = (s as unknown as { rows?: { b: string | number }[] }).rows?.[0];
    msaStatus.dbBytes = row ? Number(row.b) : null;
  } catch { /* abaikan */ }
  try { msaStatus.npzFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.npz')).length; } catch { msaStatus.npzFiles = 0; }
}

let reloadPy: () => Promise<void> = async () => {};
let running = false;
async function cycle(first: boolean): Promise<void> {
  if (running) return;
  running = true;
  msaStatus.startedAt = Date.now(); msaStatus.finishedAt = null; msaStatus.lastError = null;
  try {
    // 1) salinan .npz yang hilang dibuat ulang dari Postgres dulu (tanpa Binance)
    if (first) {
      msaStatus.phase = 'rebuild';
      msaStatus.rebuiltFromDb = await msaRebuildMissingNpz();
      if (msaStatus.rebuiltFromDb) { await reloadPy(); logger.info({ files: msaStatus.rebuiltFromDb }, 'MSA: .npz dibuat ulang dari Postgres'); }
    }
    // 2) unduh / perbarui dari Binance
    const coins = (await getUniverse(MSA.COINS)).slice(0, MSA.COINS);
    const empty = Number((await db.select({ n: sql<number>`count(*)` }).from(msaCandlesTable))[0]?.n ?? 0) === 0;
    msaStatus.phase = empty ? 'download' : 'update';
    msaStatus.coins = coins.length; msaStatus.pairsTotal = coins.length * MSA.TFS.length; msaStatus.pairsDone = 0;
    for (const sym of coins) {
      for (const tf of MSA.TFS) {
        msaStatus.current = `${sym} ${tf}`;
        try {
          const changed = await syncPair(sym, tf);
          if (changed || !fs.existsSync(npzPath(sym, tf))) await writePairNpz(sym, tf);
        } catch (err) {
          msaStatus.lastError = `${sym} ${tf}: ${err instanceof Error ? err.message : String(err)}`;
        }
        msaStatus.pairsDone++;
      }
      if (msaStatus.pairsDone % 20 === 0) { await refreshCounts(); await reloadPy(); }
    }
    // 3) koin yang keluar dari 100 besar dihapus (batas 100 koin)
    const keep = new Set(coins);
    const all = await db.selectDistinct({ symbol: msaCandlesTable.symbol }).from(msaCandlesTable);
    for (const s of all) if (!keep.has(s.symbol)) {
      await db.delete(msaCandlesTable).where(eq(msaCandlesTable.symbol, s.symbol));
      for (const tf of MSA.TFS) { try { fs.unlinkSync(npzPath(s.symbol, tf)); } catch { /* tidak ada */ } }
    }
    await reloadPy();
    msaStatus.phase = 'idle';
  } catch (err) {
    msaStatus.phase = 'error';
    msaStatus.lastError = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, 'MSA: siklus gudang candle gagal');
  } finally {
    msaStatus.current = null; msaStatus.finishedAt = Date.now(); msaStatus.nextUpdateAt = Date.now() + MSA.UPDATE_MS;
    await refreshCounts();
    running = false;
  }
}

/** Dipanggil sekali saat api-server start. */
export function startMsaStore(dir: string, reload: () => Promise<void>): void {
  dataDir = dir; msaStatus.dataDir = dir; reloadPy = reload;
  fs.mkdirSync(dir, { recursive: true });
  setTimeout(() => { cycle(true).catch(() => {}); }, 10_000);
  setInterval(() => { cycle(false).catch(() => {}); }, MSA.UPDATE_MS);
}

/** Hanya untuk tes (bukti format .npz & pembuatan ulang dari Postgres). */
export const __msaTest = { savePairRows, writePairNpz, loadPair, setDataDir: (d: string) => { dataDir = d; } };
