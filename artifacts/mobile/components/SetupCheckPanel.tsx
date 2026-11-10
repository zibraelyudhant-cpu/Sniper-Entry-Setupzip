import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { customFetch } from '@workspace/api-client-react';
import { getWrCached, loadWr, type WrResp } from '@/components/wrStore';
import { useColors } from '@/hooks/useColors';
import { MENU_COLORS } from '@/constants/theme';
import { smallPriceDecimals } from '@/components/priceFormat';

// ═══════════════════════════════════════════════════════════════════════
// CEK ENTRY & SARAN (Setup Finder bagian 16) — komponen bersama.
// Dipakai di menu Setup Finder (kosong) dan di layar Analisa Sniper Breakout,
// Fibonacci Retest, Money Magnet (terisi dari sinyal). Mesin = /api/setup-finder/check.
// Hanya INFO: tidak memblokir sinyal dan tidak mengubah SL/TP menu asal.
// Saran SL/TP memakai logika Setup Finder (anti-gocekan + tembok whale), bisa beda dari SL menu asal.
// ═══════════════════════════════════════════════════════════════════════

const ACCENT = MENU_COLORS.setupFinder;
// Harga tampil dengan KOMA desimal (tanpa pemisah ribuan) supaya bisa disalin ke Binance versi koma (permintaan user 2026-11-08)
const fmt = (v: number) => (v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v.toFixed(smallPriceDecimals(v))).replace('.', ',');

function Chip({ label, active, onPress, colors, accent }: { label: string; active: boolean; onPress: () => void; colors: ReturnType<typeof useColors>; accent: string }) {
  return (
    <Pressable onPress={onPress} style={[st.chip, { borderColor: active ? accent : colors.border, backgroundColor: active ? `${accent}22` : colors.card }]}>
      <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: active ? accent : colors.mutedForeground }}>{label}</Text>
    </Pressable>
  );
}

// ─── Cek entry & saran (spek bagian 16) ──────────────────────────────────
type CheckResp = {
  symbol: string; side: 'BUY' | 'SELL'; status: 'belum' | 'berjalan'; price: number; ref: number; finished: null | 'TP' | 'SL';
  slPct: number; tpPct: number; rr: number; rrRating: 'ok' | 'waspada' | 'buruk';
  orderType: 'market' | 'limit' | 'stop' | null; fillProb: number | null; escapeProb: number | null;
  tf: '15M' | '1H' | null; n: number | null; usedAllCandles: boolean | null; baseWr: number | null; avgR: number | null;
  points: Array<{ label: string; pts: number; note: string }>; totalPts: number; adj: number; finalProb: number | null;
  regime: string | null; alarm: string; whalePressure: number; move1dPct: number; move4hPct: number; antiGocekSl: number;
  suggestion: null | { entry: number; sl: number; tp: number; entryKind: string; slKind: string; tpKind: string; rr: number; wr: number; avgR: number; fillProb: number; score: number; tf: string; n: number; stillLosing: boolean };
  message: string;
};

export interface CheckInitial { symbol: string; side: 'BUY' | 'SELL'; entry?: number; sl?: number; tp?: number }
const initNum = (v?: number) => (v !== undefined && isFinite(v) && v > 0 ? String(v).replace('.', ',') : '');

export function SetupCheckPanel({ colors, initial, accent = ACCENT }: { colors: ReturnType<typeof useColors>; initial?: CheckInitial; accent?: string }) {
  const [symbol, setSymbol] = useState(initial?.symbol ?? '');
  const [side, setSide] = useState<'BUY' | 'SELL'>(initial?.side ?? 'BUY');
  const [status, setStatus] = useState<'belum' | 'berjalan'>('belum');
  const [entry, setEntry] = useState(initNum(initial?.entry)); const [sl, setSl] = useState(initNum(initial?.sl)); const [tp, setTp] = useState(initNum(initial?.tp));
  const [minRr, setMinRr] = useState(2);
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<CheckResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputStyle = [st.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }];

  const run = useCallback(async () => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) { Alert.alert('Koin kosong', 'Isi nama koin, misal BTC.'); return; }
    setLoading(true); setErr(null); setRes(null);
    try {
      const qs = `symbol=${encodeURIComponent(sym)}&side=${side}&status=${status}&entry=${entry.replace(',', '.')}&sl=${sl.replace(',', '.')}&tp=${tp.replace(',', '.')}&minRr=${minRr}`;
      setRes(await customFetch<CheckResp>(`/api/setup-finder/check?${qs}`));
    } catch (e: any) { setErr(e?.message ?? 'Gagal'); } finally { setLoading(false); }
  }, [symbol, side, status, entry, sl, tp, minRr]);

  const ratingColor = res?.rrRating === 'ok' ? colors.bullish : res?.rrRating === 'waspada' ? colors.gold : colors.bearish;
  return (
    <View style={{ gap: 10 }}>
      <View style={[st.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={st.h}>KOIN</Text>
        <TextInput value={symbol} onChangeText={setSymbol} placeholder="BTC / ETHUSDT" placeholderTextColor={colors.mutedForeground} autoCapitalize="characters" style={inputStyle} />
        <Text style={st.h}>ARAH</Text>
        <View style={st.wrap}>{(['BUY', 'SELL'] as const).map(v => <Chip key={v} label={v} active={side === v} onPress={() => setSide(v)} colors={colors} accent={accent} />)}</View>
        <Text style={st.h}>STATUS POSISI</Text>
        <View style={st.wrap}>
          <Chip label="Belum kena entry" active={status === 'belum'} onPress={() => setStatus('belum')} colors={colors} accent={accent} />
          <Chip label="Sudah berjalan" active={status === 'berjalan'} onPress={() => setStatus('berjalan')} colors={colors} accent={accent} />
        </View>
        {status === 'belum' && (<><Text style={st.h}>ENTRY</Text><TextInput value={entry} onChangeText={setEntry} keyboardType="decimal-pad" placeholder="harga entry" placeholderTextColor={colors.mutedForeground} style={inputStyle} /></>)}
        <Text style={st.h}>SL</Text>
        <TextInput value={sl} onChangeText={setSl} keyboardType="decimal-pad" placeholder="harga SL" placeholderTextColor={colors.mutedForeground} style={inputStyle} />
        <Text style={st.h}>TP</Text>
        <TextInput value={tp} onChangeText={setTp} keyboardType="decimal-pad" placeholder="harga TP" placeholderTextColor={colors.mutedForeground} style={inputStyle} />
        <Text style={st.h}>MIN. RR SARAN</Text>
        <View style={st.wrap}>{[1.5, 2, 3].map(v => <Chip key={v} label={`1:${v}`} active={minRr === v} onPress={() => setMinRr(v)} colors={colors} accent={accent} />)}</View>
        <Pressable onPress={run} disabled={loading} style={[st.startBtn, { backgroundColor: loading ? colors.border : accent }]}>
          <Text style={{ fontSize: 14, fontFamily: 'Inter_700Bold', color: '#0A0E1A' }}>{loading ? 'Menganalisa…' : 'Cek entry'}</Text>
        </Pressable>
        <Text style={{ fontSize: 10, color: colors.mutedForeground }}>Status posisi wajib dipilih sendiri, tidak ditebak. 1 koin = depth 1000 + 3 halaman transaksi.</Text>
      </View>

      {loading && <ActivityIndicator color={accent} />}
      {err && <Text style={{ fontSize: 12, color: colors.bearish }}>{err}</Text>}

      {res && res.finished && (
        <View style={[st.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ fontSize: 14, fontFamily: 'Inter_700Bold', color: res.finished === 'TP' ? colors.bullish : colors.bearish }}>SELESAI — {res.message}</Text>
          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Harga sekarang {fmt(res.price)}</Text>
        </View>
      )}

      {res && !res.finished && (
        <>
          <View style={[st.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Peluang akhir</Text>
            <Text style={{ fontSize: 30, fontFamily: 'Inter_700Bold', color: (res.finalProb ?? 0) >= 50 ? colors.bullish : colors.bearish }}>{res.finalProb?.toFixed(1)}%</Text>
            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
              WR dasar {res.baseWr?.toFixed(1)}% ({res.tf}, n={res.n}{res.usedAllCandles ? ', semua candle — sampel filter tren < 30' : ', filter tren'}) + penyesuaian {res.adj >= 0 ? '+' : ''}{res.adj.toFixed(1)} (0.6 × {res.totalPts} poin, dibatasi ±12; hasil dibatasi 3–97%)
            </Text>
            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Rata-rata R {res.avgR?.toFixed(2)} · backtest = bukan bukti setup</Text>
            <View style={st.row}><Text style={[st.lbl, { color: colors.mutedForeground }]}>RR rencana (SL {res.slPct.toFixed(2)}% / TP {res.tpPct.toFixed(2)}% dari {res.status === 'belum' ? 'entry' : 'harga sekarang'})</Text><Text style={[st.val, { color: ratingColor }]}>1:{res.rr.toFixed(2)}</Text></View>
            {res.orderType && (
              <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
                Order {res.orderType.toUpperCase()} · tersentuh {res.fillProb?.toFixed(0)}%{res.escapeProb !== null ? ` · harga kabur (bergerak sejauh jarak TP sebelum entry tersentuh) ${res.escapeProb.toFixed(0)}%` : ''}
              </Text>
            )}
            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
              Regime {res.regime ?? '-'} · alarm {res.alarm} · tekanan whale {res.whalePressure.toFixed(0)} · perkiraan gerak 4 jam ±{res.move4hPct.toFixed(2)}%, 1 hari ±{res.move1dPct.toFixed(2)}% (TP {res.tpPct.toFixed(2)}%)
            </Text>
          </View>

          <View style={[st.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={st.h}>POIN CEK</Text>
            {res.points.map(p => (
              <View key={p.label} style={st.row}>
                <Text style={{ fontSize: 11, color: colors.mutedForeground, flex: 1 }}>{p.label}: {p.note}</Text>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_700Bold', color: p.pts > 0 ? colors.bullish : p.pts < 0 ? colors.bearish : colors.mutedForeground, marginLeft: 8 }}>{p.pts > 0 ? '+' : ''}{p.pts}</Text>
              </View>
            ))}
            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>SL anti-gocekan (tanpa batas %): {fmt(res.antiGocekSl)}</Text>
          </View>

          <View style={[st.panel, { backgroundColor: colors.card, borderColor: res.suggestion ? accent : colors.border }]}>
            <Text style={st.h}>SARAN</Text>
            {res.suggestion ? (
              <>
                <Text style={{ fontSize: 12, color: colors.foreground }}>
                  Entry {fmt(res.suggestion.entry)} ({res.suggestion.entryKind === 'user' ? 'entry kamu' : res.suggestion.entryKind === 'market' ? 'market' : res.suggestion.entryKind === 'wall' ? 'depan tembok' : 'depan swing'}) · SL {fmt(res.suggestion.sl)} ({res.suggestion.slKind === 'antigocek' ? 'anti-gocekan' : 'SL kamu'}) · TP {fmt(res.suggestion.tp)} ({res.suggestion.tpKind === 'user' ? 'TP kamu' : 'Min. RR'})
                </Text>
                <Text style={{ fontSize: 11, color: colors.mutedForeground }}>RR 1:{res.suggestion.rr.toFixed(2)} · WR {res.suggestion.wr.toFixed(1)}% · {res.suggestion.avgR.toFixed(2)}R · tersentuh {res.suggestion.fillProb.toFixed(0)}% · {res.suggestion.tf} n={res.suggestion.n}</Text>
                <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Lolos karena WR ≥ WR kamu dan rata-rata R &gt; punya kamu + 0.02.</Text>
                {res.suggestion.stillLosing && <Text style={{ fontSize: 11, color: colors.bearish }}>⚠️ Saran ini pun masih rugi di backtest (rata-rata R ≤ 0).</Text>}
              </>
            ) : <Text style={{ fontSize: 12, color: colors.foreground }}>{res.message}</Text>}
          </View>
        </>
      )}
    </View>
  );
}


// ─── WR di kartu hasil Scan ────────────────────────────────────────────────
// WR dasar backtest (SAMA dengan "WR dasar" di Cek entry / layar Analisa), ±10 weight per koin.
// Antrean maks 3 request bersamaan, hasil di-cache 5 menit. TP = TP2 kalau ada, kalau tidak TP1 (sama dengan layar Analisa).
// (cache + antrean WR ada di components/wrStore.ts, dipakai bersama urutan "Selisih WR")

export function WrBadge({ colors, symbol, side, entry, sl, tp }: { colors: ReturnType<typeof useColors>; symbol: string; side: 'BUY' | 'SELL'; entry?: number; sl?: number; tp?: number }) {
  const [res, setRes] = useState<WrResp | null>(null);
  const [err, setErr] = useState(false);
  const ok = !!(entry && sl && tp);
  const key = `${symbol}|${side}|${entry}|${sl}|${tp}`;
  useEffect(() => {
    if (!ok) return;
    let dead = false;
    const hit = getWrCached(key);
    if (hit) { setRes(hit); return; }
    setRes(null); setErr(false);
    loadWr(symbol, side, entry!, sl!, tp!).then(r => { if (!dead) setRes(r); }).catch(() => { if (!dead) setErr(true); });
    return () => { dead = true; };
  }, [key]);
  if (!ok) return null;
  const diff = res ? res.wr - res.breakevenWr : 0; // selisih WR dengan impas (poin). >= +5 bagus, 0..+5 tipis, < 0 di bawah impas
  const diffColor = !res ? colors.mutedForeground : diff >= 5 ? colors.bullish : diff >= 0 ? colors.gold : colors.bearish;
  const diffLabel = !res ? '' : diff >= 5 ? 'BAGUS' : diff >= 0 ? 'TIPIS' : 'DI BAWAH IMPAS';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
      <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: ACCENT, letterSpacing: 0.4 }}>WR BACKTEST</Text>
      {!res && !err && <Text style={{ fontSize: 11, color: colors.mutedForeground }}>menghitung…</Text>}
      {err && <Text style={{ fontSize: 11, color: colors.mutedForeground }}>—</Text>}
      {res && (
        <Text style={{ fontSize: 12, fontFamily: 'Inter_700Bold', color: diffColor }}>
          {res.wr.toFixed(1)}% <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground }}>· n={res.n} · {res.tf} · impas {res.breakevenWr.toFixed(0)}% · RR 1:{res.rr.toFixed(1)} · </Text>
          <Text style={{ fontSize: 11, fontFamily: 'Inter_700Bold', color: diffColor }}>selisih {diff >= 0 ? '+' : ''}{diff.toFixed(1)} {diffLabel}</Text>
        </Text>
      )}
    </View>
  );
}

// Cache hasil otomatis (5 menit) + dedupe request supaya badge Peluang Entry dan baris "TP Setup Finder" memakai 1 request yang sama
const autoCache = new Map<string, { at: number; res: CheckResp }>();
const autoInflight = new Map<string, Promise<CheckResp>>();

function useAutoCheck(symbol: string, side: 'BUY' | 'SELL', entry?: number, sl?: number, tp?: number) {
  const [res, setRes] = useState<CheckResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const key = `${symbol}|${side}|${entry}|${sl}|${tp}`;
  useEffect(() => {
    let dead = false;
    const hit = autoCache.get(key);
    if (hit && Date.now() - hit.at < 300_000 && tick === 0) { setRes(hit.res); setErr(null); setLoading(false); return; }
    setLoading(true); setErr(null); setRes(null);
    let pr = autoInflight.get(key);
    if (!pr) {
      pr = customFetch<CheckResp>(`/api/setup-finder/check?symbol=${encodeURIComponent(symbol)}&side=${side}&status=belum&entry=${entry}&sl=${sl}&tp=${tp}&minRr=2`);
      autoInflight.set(key, pr);
      pr.then(r => { autoCache.set(key, { at: Date.now(), res: r }); }).catch(() => {}).finally(() => { autoInflight.delete(key); });
    }
    pr.then(r => { if (!dead) setRes(r); }).catch(e => { if (!dead) setErr(e?.message ?? 'Gagal'); }).finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [key, tick]);
  return { res, loading, err, retry: () => setTick(t => t + 1) };
}

// Baris "TP Setup Finder" untuk blok "Pasang limit order" di layar Analisa (di bawah TP1 / TP2).
// TP = TP dari SARAN Cek entry (kombinasi entry/SL/TP dengan WR dan rata-rata R terbaik). Kalau tidak ada saran yang lebih baik: TP kamu sudah yang terbaik.
export function SetupFinderTpRow({ colors, symbol, side, entry, sl, tp, rowStyle, labelStyle, valueStyle }: {
  colors: ReturnType<typeof useColors>; symbol: string; side: 'BUY' | 'SELL'; entry?: number; sl?: number; tp?: number; rowStyle?: any; labelStyle?: any; valueStyle?: any;
}) {
  const { res, loading, err, retry } = useAutoCheck(symbol, side, entry, sl, tp);
  if (!(entry && sl && tp)) return null;
  const sg = res && !res.finished ? res.suggestion : null;
  const rr = sg ? sg.rr : res?.rr ?? 0; const wr = sg ? sg.wr : res?.baseWr ?? null;
  const diff = wr !== null && rr > 0 ? wr - 100 / (1 + rr) : null;
  const diffColor = diff === null ? colors.mutedForeground : diff >= 5 ? colors.bullish : diff >= 0 ? colors.gold : colors.bearish;
  const diffLabel = diff === null ? '' : diff >= 5 ? 'BAGUS' : diff >= 0 ? 'TIPIS' : 'DI BAWAH IMPAS';
  const differs = !!sg && (Math.abs(sg.entry - entry) / entry > 0.0002 || Math.abs(sg.sl - sl) / sl > 0.0002);
  return (
    <View style={{ gap: 2 }}>
      <View style={rowStyle ?? { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
        <Text style={[labelStyle, { color: ACCENT }]}>TP Setup Finder</Text>
        <Text style={[valueStyle, { color: ACCENT }]}>{sg ? fmt(sg.tp) : loading ? 'menghitung…' : err ? '—' : res?.finished ? '—' : 'TP kamu'}</Text>
      </View>
      {err && <Pressable onPress={retry}><Text style={{ fontSize: 10, color: colors.bearish }}>Gagal: {err}. Ketuk untuk ulang.</Text></Pressable>}
      {res && !res.finished && (
        <Text style={{ fontSize: 10, color: colors.mutedForeground }}>
          {sg ? '' : 'Tidak ada TP yang lebih baik dari TP kamu · '}R:R 1:{rr.toFixed(2)} · WR {wr !== null ? wr.toFixed(1) : '—'}% · impas {(100 / (1 + rr)).toFixed(0)}%
          {diff !== null ? <Text style={{ fontFamily: 'Inter_700Bold', color: diffColor }}> · selisih {diff >= 0 ? '+' : ''}{diff.toFixed(1)} {diffLabel}</Text> : null}
        </Text>
      )}
      {res && res.finished && <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{res.message}</Text>}
      {differs && sg && <Text style={{ fontSize: 10, color: colors.mutedForeground }}>Saran ini memakai entry {fmt(sg.entry)} · SL {fmt(sg.sl)} (beda dari sinyal). Rincian di "Detail cek entry & saran".</Text>}
    </View>
  );
}

// Badge otomatis (Peluang akhir + WR dasar, status "belum kena entry") + tombol detail.
// TP = TP2 kalau ada, kalau tidak TP1. Satu koin ≈ 70-80 weight, jalan sekali saat layar dibuka.
export function SetupCheckButton({ colors, accent, symbol, side, entry, sl, tp }: { colors: ReturnType<typeof useColors>; accent: string; symbol: string; side: 'BUY' | 'SELL'; entry?: number; sl?: number; tp?: number }) {
  const [open, setOpen] = useState(false);
  const { res, loading, err, retry } = useAutoCheck(symbol, side, entry, sl, tp);

  const p = res?.finalProb ?? null;
  const pColor = p === null ? colors.mutedForeground : p >= 50 ? colors.bullish : colors.bearish;
  return (
    <View style={{ marginHorizontal: 12, marginTop: 12, gap: 8 }}>
      <View style={[st.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={{ fontSize: 11, fontFamily: 'Inter_700Bold', color: ACCENT, letterSpacing: 0.5 }}>SETUP FINDER • PELUANG ENTRY (info)</Text>
        {loading && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator size="small" color={ACCENT} /><Text style={{ fontSize: 11, color: colors.mutedForeground }}>Menghitung WR backtest + whale…</Text></View>}
        {err && (
          <Pressable onPress={retry}>
            <Text style={{ fontSize: 11, color: colors.bearish }}>Gagal: {err}. Ketuk untuk ulang.</Text>
          </Pressable>
        )}
        {res && res.finished && <Text style={{ fontSize: 12, fontFamily: 'Inter_700Bold', color: res.finished === 'TP' ? colors.bullish : colors.bearish }}>{res.message}</Text>}
        {res && !res.finished && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
              <Text style={{ fontSize: 26, fontFamily: 'Inter_700Bold', color: pColor }}>{p !== null ? `${p.toFixed(1)}%` : '—'}</Text>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, flex: 1 }}>peluang akhir · WR dasar {res.baseWr?.toFixed(1) ?? '—'}% ({res.tf}, n={res.n}) · RR 1:{res.rr.toFixed(2)} · impas {(100 / (1 + res.rr)).toFixed(0)}% · selisih {res.baseWr !== null ? `${res.baseWr - 100 / (1 + res.rr) >= 0 ? '+' : ''}${(res.baseWr - 100 / (1 + res.rr)).toFixed(1)}` : '—'}</Text>
            </View>
            <Text style={{ fontSize: 10, color: colors.mutedForeground }}>
              Asumsi belum kena entry · regime {res.regime ?? '-'} · {res.suggestion ? 'ada saran entry/SL/TP lain (buka detail)' : 'tidak ada saran yang lebih baik'}. Backtest bukan bukti setup; hanya info, sinyal tidak diblokir.
            </Text>
          </>
        )}
      </View>
      <Pressable onPress={() => setOpen(o => !o)} style={[st.btn, { borderColor: ACCENT, backgroundColor: `${ACCENT}14` }]}>
        <Text style={{ fontSize: 13, fontFamily: 'Inter_700Bold', color: ACCENT }}>{open ? '▾ Tutup detail' : '🔎 Detail cek entry & saran'}</Text>
      </Pressable>
      {open && <SetupCheckPanel colors={colors} accent={ACCENT} initial={{ symbol, side, entry, sl, tp }} />}
    </View>
  );
}

const st = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  h: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#94A3B8', letterSpacing: 0.5, marginTop: 2 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  startBtn: { marginTop: 6, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  lbl: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  val: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  btn: { borderWidth: 1, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
});
