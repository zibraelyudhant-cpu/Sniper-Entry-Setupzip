import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { customFetch } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { smallPriceDecimals } from '@/components/priceFormat';

// ═══════════════════════════════════════════════════════════════════════════
// TP3 SNR H1 (v20) — baris di blok "Pasang limit order" layar Analisa Sniper / Fibo Retest / Money Magnet.
// Dihitung OTOMATIS hanya saat layar Analisa dibuka (tidak di scan): /api/tp3, ±20 weight per koin, cache 10 menit.
// Hanya info target lanjutan: evaluator Jurnal tetap menilai WIN/LOSE dari TP1/TP2.
// ═══════════════════════════════════════════════════════════════════════════

export type Tp3Resp = {
  tp3: number | null; rr3: number | null; reachPct: number | null; source: 'snr' | 'fib' | null;
  zoneLo: number | null; zoneHi: number | null; touches: number | null; fib: string | null;
  nTp2: number; horizonH: number; candles: number; message: string; version: string;
};

const fmt = (v: number) => (v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v.toFixed(smallPriceDecimals(v))).replace('.', ',');
const cache = new Map<string, { at: number; res: Tp3Resp }>();
const inflight = new Map<string, Promise<Tp3Resp>>();
const keyOf = (symbol: string, side: string, entry?: number, sl?: number) => `${symbol}|${side}|${entry}|${sl}`;

/** Hasil TP3 yang sudah dihitung layar Analisa (dipakai saat simpan ke Jurnal). */
export function getTp3Cached(symbol: string, side: 'BUY' | 'SELL', entry?: number, sl?: number): Tp3Resp | null {
  const h = cache.get(keyOf(symbol, side, entry, sl));
  return h && Date.now() - h.at < 600_000 ? h.res : null;
}
/** Field Jurnal TP3 (kosong kalau belum dihitung / tidak ada). */
export function tp3JournalFields(symbol: string, side: 'BUY' | 'SELL', entry?: number, sl?: number) {
  const r = getTp3Cached(symbol, side, entry, sl);
  if (!r || r.tp3 === null) return {};
  return { takeProfit3: r.tp3, tp3Rr: r.rr3 ?? undefined, tp3ReachPct: r.reachPct ?? undefined, tp3Source: r.source ?? undefined, tp3Version: r.version };
}

export function Tp3Row({ colors, symbol, side, entry, sl, rowStyle, labelStyle, valueStyle }: {
  colors: ReturnType<typeof useColors>; symbol: string; side: 'BUY' | 'SELL'; entry?: number; sl?: number; rowStyle?: any; labelStyle?: any; valueStyle?: any;
}) {
  const [res, setRes] = useState<Tp3Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const key = keyOf(symbol, side, entry, sl);
  useEffect(() => {
    if (!(entry && sl)) return;
    let dead = false;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 600_000 && tick === 0) { setRes(hit.res); setErr(null); setLoading(false); return; }
    setLoading(true); setErr(null); setRes(null);
    let pr = inflight.get(key);
    if (!pr) {
      pr = customFetch<Tp3Resp>(`/api/tp3?symbol=${encodeURIComponent(symbol)}&side=${side}&entry=${entry}&sl=${sl}`);
      inflight.set(key, pr);
      pr.then(r => { cache.set(key, { at: Date.now(), res: r }); }).catch(() => {}).finally(() => { inflight.delete(key); });
    }
    pr.then(r => { if (!dead) setRes(r); }).catch(e => { if (!dead) setErr(e?.message ?? 'Gagal'); }).finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [key, tick]);
  if (!(entry && sl)) return null;
  const color = colors.bullish;
  const low = res?.reachPct !== null && res?.reachPct !== undefined && res.reachPct < 50;
  return (
    <View style={{ gap: 2 }}>
      <View style={rowStyle ?? { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
        <Text style={[labelStyle, { color }]}>{`TP3 SNR H1${res?.rr3 ? ` (RR 1:${res.rr3.toFixed(1)})` : ''}`}</Text>
        <Text style={[valueStyle, { color }]}>{res?.tp3 ? fmt(res.tp3) : loading ? 'menghitung…' : '—'}</Text>
      </View>
      {err && <Pressable onPress={() => setTick(t => t + 1)}><Text style={{ fontSize: 10, color: colors.bearish }}>Gagal: {err}. Ketuk untuk ulang.</Text></Pressable>}
      {res && res.tp3 !== null && (
        <Text style={{ fontSize: 10, color: colors.mutedForeground }}>
          {res.source === 'snr' ? `Zona ${fmt(res.zoneLo!)} – ${fmt(res.zoneHi!)} · ${res.touches} sentuhan` : `Ekstensi Fib ${res.fib}`}
          {res.source === 'snr' && res.fib ? ` · + Fib ${res.fib}` : ''}
          {' · '}
          <Text style={{ fontFamily: 'Inter_700Bold', color: low ? colors.gold : colors.bullish }}>
            {`lanjut ke TP3 setelah TP2: ${res.reachPct?.toFixed(0)}%`}
          </Text>
          {` (n=${res.nTp2}, ${res.candles} candle H1, maks ${res.horizonH / 24} hari)`}
        </Text>
      )}
      {res && (res.tp3 === null || low) && <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{res.message}</Text>}
    </View>
  );
}
