// Penyimpanan WR backtest bersama (kartu scan + urutan "Selisih WR"). Satu request per kombinasi koin|arah|entry|SL|TP, di-cache 5 menit.
// Antrean maksimal 3 request bersamaan (±10 weight Binance per koin).
import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';

export type WrResp = { wr: number; n: number; tf: '15M' | '1H'; usedAllCandles: boolean; rr: number; breakevenWr: number; avgR: number };

const cache = new Map<string, { at: number; res: WrResp }>();
const failed = new Map<string, number>();
const inflight = new Map<string, Promise<WrResp>>();
const listeners = new Set<() => void>();
let active = 0; const queue: Array<() => void> = [];
const bump = () => listeners.forEach(l => l());
const acquire = (): Promise<void> => new Promise(r => { const go = () => { active++; r(); }; if (active < 3) go(); else queue.push(go); });
const release = () => { active--; const n = queue.shift(); if (n) n(); };

export const wrKey = (symbol: string, side: string, entry?: number, sl?: number, tp?: number) => `${symbol}|${side}|${entry}|${sl}|${tp}`;

export function getWrCached(key: string): WrResp | null {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < 300_000 ? hit.res : null;
}

export function loadWr(symbol: string, side: 'BUY' | 'SELL', entry: number, sl: number, tp: number): Promise<WrResp> {
  const key = wrKey(symbol, side, entry, sl, tp);
  const hit = getWrCached(key);
  if (hit) return Promise.resolve(hit);
  let pr = inflight.get(key);
  if (!pr) {
    pr = (async () => {
      await acquire();
      try {
        const r = await customFetch<WrResp>(`/api/setup-finder/wr?symbol=${encodeURIComponent(symbol)}&side=${side}&entry=${entry}&sl=${sl}&tp=${tp}`);
        cache.set(key, { at: Date.now(), res: r }); failed.delete(key); bump();
        return r;
      } catch (e) {
        failed.set(key, Date.now()); bump();
        throw e;
      } finally { release(); inflight.delete(key); }
    })();
    inflight.set(key, pr);
  }
  return pr;
}

/** Argumen WR dari satu koin hasil scan (TP = TP2 kalau ada, kalau tidak TP1; sama dengan badge WR di kartu). null kalau belum punya entry/SL/TP. */
export function coinWrArgs(c: any): { symbol: string; side: 'BUY' | 'SELL'; entry: number; sl: number; tp: number } | null {
  const entry = c?.entryPrice, sl = c?.stopLoss, tp = c?.takeProfit2 ?? c?.takeProfit1;
  if (!c?.symbol || !(entry > 0) || !(sl > 0) || !(tp > 0) || !c?.bias) return null;
  return { symbol: c.symbol, side: c.bias === 'bullish' ? 'BUY' : 'SELL', entry, sl, tp };
}

/** Selisih WR backtest (WR − impas, poin). null kalau belum dihitung / gagal. */
export function wrSelisihOf(c: any): number | null {
  const a = coinWrArgs(c);
  if (!a) return null;
  const r = getWrCached(wrKey(a.symbol, a.side, a.entry, a.sl, a.tp));
  return r ? r.wr - r.breakevenWr : null;
}

/** Dipanggil di komponen menu: saat urutan "Selisih WR" aktif, hitung WR semua koin yang punya entry/SL/TP dan render ulang tiap hasil masuk. */
export function useWrSort(coins: any[], sortKey: string): { done: number; total: number } | null {
  const [, setTick] = useState(0);
  const on = sortKey === 'selisihWr';
  const items = on ? coins.map(coinWrArgs).filter((x): x is NonNullable<ReturnType<typeof coinWrArgs>> => !!x) : [];
  const sig = items.map(a => wrKey(a.symbol, a.side, a.entry, a.sl, a.tp)).join(',');
  useEffect(() => {
    if (!on) return;
    const l = () => setTick(t => t + 1);
    listeners.add(l);
    for (const a of items) loadWr(a.symbol, a.side, a.entry, a.sl, a.tp).catch(() => {});
    return () => { listeners.delete(l); };
  }, [on, sig]);
  if (!on) return null;
  const done = items.filter(a => { const k = wrKey(a.symbol, a.side, a.entry, a.sl, a.tp); return !!getWrCached(k) || failed.has(k); }).length;
  return { done, total: items.length };
}
