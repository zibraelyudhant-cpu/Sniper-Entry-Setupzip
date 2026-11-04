import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { customFetch } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { MENU_COLORS } from '@/constants/theme';
import { MenuJournalSummary } from '@/components/MenuJournalSummary';
import { journalSave, journalSaveMany, journalGetLastWriteStatus, SCALPING_SKILL_SF, type JournalEntry } from './journal-helpers';

// ═══════════════════════════════════════════════════════════════════════
// SETUP FINDER (sf1, request user 2026-11-05) — spesifikasi_setup_finder.md
// Whale (order book) + backtest WR. WR/avgR = hasil backtest candle (entry di tiap
// candle, jarak SL/TP sama), BUKAN bukti setup ini. Bukti sebenarnya = forward test Journal.
// Scan 500 koin (universe sama menu lain) MANUAL lewat tombol (semua menu manual, biar gak kena rate limit Binance). ±70-80 weight/koin.
// ═══════════════════════════════════════════════════════════════════════

const ACCENT = MENU_COLORS.setupFinder;
const RR_OPTIONS = [1, 1.5, 2, 3, 4, 5];
const WALL_OPTIONS = [50_000, 100_000, 250_000, 500_000];
const SHOW_OPTIONS = [10, 20, 50, 0];

type RrRow = { rr: number; wr: number; avgR: number; fillProb: number; score: number; best: boolean };
type Setup = {
  symbol: string; side: 'BUY' | 'SELL'; rr: number; entryKind: 'market' | 'wall' | 'swing'; orderType: 'market' | 'limit';
  entry: number; sl: number; tp: number; slPct: number; price: number; slSource: 'swing' | 'wall' | 'fallback'; slRounded: boolean;
  tf: '15M' | '1H'; n: number; nWin: number; usedAllCandles: boolean; wr: number; breakevenWr: number; avgR: number; fillProb: number; score: number;
  wrSuspicious: boolean; medianHoursToTp: number | null; regime: string | null; align: string;
  oppWall: { price: number; value: number } | null; thinInPath: boolean; alarm: string; whalePressure: number; wallReal: boolean | null;
  best?: boolean; rrTable: RrRow[]; move1dPct?: number; move4hPct?: number;
};
type ScanResponse = {
  status: 'idle' | 'running' | 'complete' | 'error'; errorMessage?: string;
  params: { rr: number[]; side: string; minWall: number; coins: number } | null;
  target: number; scanned: number; failed: number; skippedSetups: number; usedWeight: number;
  startedAt: number; fetchedAt: number; totalSetups: number; setups: Setup[];
};

const fmt = (v: number) => (v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v.toFixed(6));
const fmtUsd = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}jt` : `${Math.round(v / 1e3)}rb`);

function Chip({ label, active, onPress, colors }: { label: string; active: boolean; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  return (
    <Pressable onPress={onPress} style={[st.chip, { borderColor: active ? ACCENT : colors.border, backgroundColor: active ? `${ACCENT}22` : colors.card }]}>
      <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: active ? ACCENT : colors.mutedForeground }}>{label}</Text>
    </Pressable>
  );
}

function SetupCard({ s, colors, onSave, saved }: { s: Setup; colors: ReturnType<typeof useColors>; onSave: (s: Setup) => void; saved: boolean }) {
  const [open, setOpen] = useState(false);
  const buy = s.side === 'BUY'; const sideColor = buy ? colors.bullish : colors.bearish;
  const positive = s.avgR > 0;
  return (
    <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: sideColor }]}>
      <Pressable onPress={() => setOpen(o => !o)}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.foreground }}>{s.symbol.replace('USDT', '')}</Text>
            <Text style={{ fontSize: 11, fontFamily: 'Inter_700Bold', color: sideColor }}>{buy ? '▲ BUY' : '▼ SELL'} · 1:{s.rr}</Text>
            {s.best && <Text style={{ fontSize: 12 }}>🏆</Text>}
            {s.wrSuspicious && <Text style={{ fontSize: 12 }}>⚠️</Text>}
          </View>
          <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: positive ? colors.bullish : colors.bearish }}>skor {s.score.toFixed(3)}</Text>
        </View>
        <View style={st.row}>
          <Text style={[st.lbl, { color: colors.mutedForeground }]}>ENTRY ({s.entryKind === 'market' ? 'market' : s.entryKind === 'wall' ? 'depan tembok' : 'depan swing'})</Text>
          <Text style={[st.val, { color: colors.foreground }]}>{fmt(s.entry)}</Text>
        </View>
        <View style={st.row}><Text style={[st.lbl, { color: colors.mutedForeground }]}>SL ({s.slPct.toFixed(2)}%, {s.slSource})</Text><Text style={[st.val, { color: colors.bearish }]}>{fmt(s.sl)}</Text></View>
        <View style={st.row}><Text style={[st.lbl, { color: colors.mutedForeground }]}>TP</Text><Text style={[st.val, { color: colors.bullish }]}>{fmt(s.tp)}</Text></View>
        <View style={[st.row, { marginTop: 6 }]}>
          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>WR {s.wr.toFixed(1)}% (impas {s.breakevenWr.toFixed(0)}%) · {s.avgR.toFixed(2)}R · tersentuh {s.fillProb.toFixed(0)}%</Text>
        </View>
        <Text style={{ fontSize: 10, color: colors.mutedForeground, marginTop: 2 }}>
          {s.tf} n={s.n}{s.usedAllCandles ? ' (semua candle, filter tren <30)' : ''} · {s.regime ?? 'regime -'} ({s.align}) · alarm {s.alarm}
        </Text>
      </Pressable>
      <View style={{ marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.border, gap: 2 }}>
        <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.mutedForeground, letterSpacing: 0.5 }}>PERBANDINGAN RR (semua RR yang diuji)</Text>
        {s.rrTable.map(r => (
          <Text key={r.rr} style={{ fontSize: 11, color: r.rr === s.rr ? ACCENT : colors.mutedForeground, fontFamily: r.best ? 'Inter_700Bold' : 'Inter_400Regular' }}>
            1:{r.rr}   WR {r.wr.toFixed(1)}%   {r.avgR.toFixed(2)}R{r.best ? '  🏆' : ''}
          </Text>
        ))}
      </View>
      {open && (
        <View style={{ marginTop: 8, gap: 3 }}>
          {s.move1dPct !== undefined && s.move4hPct !== undefined && (
            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Perkiraan gerak: 4 jam ±{s.move4hPct.toFixed(2)}% · 1 hari ±{s.move1dPct.toFixed(2)}% (jarak TP {(Math.abs(s.tp - s.entry) / s.entry * 100).toFixed(2)}%)</Text>
          )}
          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Entry {s.entryKind === 'market' ? 'market' : s.entryKind === 'wall' ? 'limit depan tembok' : 'limit depan swing'} · {s.n} trade backtest</Text>
          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Tekanan whale {s.whalePressure.toFixed(0)} · median waktu ke TP {s.medianHoursToTp === null ? '-' : `${s.medianHoursToTp.toFixed(1)} jam`}</Text>
          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
            Tembok lawan di jalur TP: {s.oppWall ? `${fmt(s.oppWall.price)} (${fmtUsd(s.oppWall.value)} USDT)` : 'tidak ada'}{s.thinInPath ? ' · zona tipis di jalur (harga bisa loncat)' : ''}
          </Text>
          {s.wallReal !== null && <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Tembok entry: {s.wallReal ? 'asli (terlihat ≥2 scan)' : 'belum terverifikasi (scan pertama)'}</Text>}
          {s.slRounded && <Text style={{ fontSize: 11, color: colors.mutedForeground }}>SL digeser keluar zona angka bulat</Text>}
          {s.wrSuspicious && <Text style={{ fontSize: 11, color: colors.gold }}>⚠️ WR &gt; 85%: biasanya data satu arah</Text>}
        </View>
      )}
      <Pressable onPress={() => onSave(s)} disabled={saved} style={[st.saveBtn, { borderColor: ACCENT, opacity: saved ? 0.5 : 1 }]}>
        <Text style={{ fontSize: 12, fontFamily: 'Inter_700Bold', color: ACCENT }}>{saved ? '✓ Tersimpan di Journal' : 'Simpan ke Journal'}</Text>
      </Pressable>
    </View>
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

function CheckPanel({ colors }: { colors: ReturnType<typeof useColors> }) {
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [status, setStatus] = useState<'belum' | 'berjalan'>('belum');
  const [entry, setEntry] = useState(''); const [sl, setSl] = useState(''); const [tp, setTp] = useState('');
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
        <View style={st.wrap}>{(['BUY', 'SELL'] as const).map(v => <Chip key={v} label={v} active={side === v} onPress={() => setSide(v)} colors={colors} />)}</View>
        <Text style={st.h}>STATUS POSISI</Text>
        <View style={st.wrap}>
          <Chip label="Belum kena entry" active={status === 'belum'} onPress={() => setStatus('belum')} colors={colors} />
          <Chip label="Sudah berjalan" active={status === 'berjalan'} onPress={() => setStatus('berjalan')} colors={colors} />
        </View>
        {status === 'belum' && (<><Text style={st.h}>ENTRY</Text><TextInput value={entry} onChangeText={setEntry} keyboardType="decimal-pad" placeholder="harga entry" placeholderTextColor={colors.mutedForeground} style={inputStyle} /></>)}
        <Text style={st.h}>SL</Text>
        <TextInput value={sl} onChangeText={setSl} keyboardType="decimal-pad" placeholder="harga SL" placeholderTextColor={colors.mutedForeground} style={inputStyle} />
        <Text style={st.h}>TP</Text>
        <TextInput value={tp} onChangeText={setTp} keyboardType="decimal-pad" placeholder="harga TP" placeholderTextColor={colors.mutedForeground} style={inputStyle} />
        <Text style={st.h}>MIN. RR SARAN</Text>
        <View style={st.wrap}>{[1.5, 2, 3].map(v => <Chip key={v} label={`1:${v}`} active={minRr === v} onPress={() => setMinRr(v)} colors={colors} />)}</View>
        <Pressable onPress={run} disabled={loading} style={[st.startBtn, { backgroundColor: loading ? colors.border : ACCENT }]}>
          <Text style={{ fontSize: 14, fontFamily: 'Inter_700Bold', color: '#0A0E1A' }}>{loading ? 'Menganalisa…' : 'Cek entry'}</Text>
        </Pressable>
        <Text style={{ fontSize: 10, color: colors.mutedForeground }}>Status posisi wajib dipilih sendiri, tidak ditebak. 1 koin = depth 1000 + 3 halaman transaksi.</Text>
      </View>

      {loading && <ActivityIndicator color={ACCENT} />}
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

          <View style={[st.panel, { backgroundColor: colors.card, borderColor: res.suggestion ? ACCENT : colors.border }]}>
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

export default function SetupFinderScreen() {
  const colors = useColors(); const insets = useSafeAreaInsets(); const qc = useQueryClient();
  const [mode, setMode] = useState<'cari' | 'cek'>('cari');
  const [rr, setRr] = useState<number[]>([1, 1.5, 2, 3]);
  const [side, setSide] = useState<'BOTH' | 'BUY' | 'SELL'>('BOTH');
  const [minWall, setMinWall] = useState(50_000);
  const [minWr, setMinWr] = useState(0);
  const [show, setShow] = useState(10);
  const [onlyPos, setOnlyPos] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ['setup-finder-scan', minWr, show, onlyPos],
    queryFn: () => customFetch<ScanResponse>(`/api/setup-finder/scan?minWr=${minWr}&show=${show}&onlyPositive=${onlyPos}`),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 4000 : false),
    placeholderData: (prev) => prev,
  });
  const data = q.data; const running = data?.status === 'running';

  const start = useCallback(async () => {
    if (rr.length === 0) { Alert.alert('RR kosong', 'Pilih minimal satu RR.'); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaved(new Set());
    await customFetch(`/api/setup-finder/scan?start=true&rr=${[...rr].sort((a, b) => a - b).join(',')}&side=${side}&minWall=${minWall}&coins=500&minWr=${minWr}&show=${show}`);
    qc.invalidateQueries({ queryKey: ['setup-finder-scan'] });
  }, [rr, side, minWall, minWr, show, qc]);

  const buildEntry = (s: Setup, now: number): JournalEntry => ({
    id: `${now}_${s.symbol}_${Math.random().toString(36).slice(2, 7)}`,
    symbol: s.symbol, bias: s.side === 'BUY' ? 'bullish' : 'bearish',
    sourceMenu: 'Setup Finder', sourceSkill: SCALPING_SKILL_SF,
    entryPrice: s.entry, stopLoss: s.sl, takeProfit1: s.tp, currentPriceAtSignal: s.price, rr1: s.rr,
    tfStruktur: 'H1', tfEksekusi: '15M', orderType: 'limit',
    validUntil: now + 24 * 3_600_000, // jendela peluang tersentuh spek = 96 candle 15M (24 jam)
    sfVersion: 'sf1', sfWr: s.wr, sfN: s.n, sfAvgR: s.avgR, sfFill: s.fillProb, sfScore: s.score, sfSlPct: s.slPct,
    sfTf: s.tf, sfEntryKind: s.entryKind, sfSlSource: s.slSource, sfRegime: s.regime ?? undefined, sfAlign: s.align,
    sfWhalePressure: s.whalePressure, sfAlarm: s.alarm, sfWallReal: s.wallReal,
    timestamp: new Date(now).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB',
    savedAt: now, status: 'pending',
  } as JournalEntry);
  const keyOf = (s: Setup) => `${s.symbol}|${s.side}|${s.rr}|${s.entry}`;

  const saveOne = useCallback(async (s: Setup) => {
    await journalSave(buildEntry(s, Date.now()));
    const ws = journalGetLastWriteStatus();
    if (!ws.ok) { Alert.alert('Gagal Simpan', `Gagal kesimpen ke storage (${ws.error ?? 'error'})`); return; }
    setSaved(prev => new Set(prev).add(keyOf(s)));
  }, []);

  const [savingAll, setSavingAll] = useState(false);
  const [saveAllMsg, setSaveAllMsg] = useState<string | null>(null);
  const saveAll = useCallback(async (list: Setup[]) => {
    if (list.length === 0) return;
    setSavingAll(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const now = Date.now();
    const { savedCount, skippedCount } = await journalSaveMany(list.map(x => buildEntry(x, now)));
    const ws = journalGetLastWriteStatus();
    if (!ws.ok) Alert.alert('Gagal Simpan', `Gagal kesimpen ke storage (${ws.error ?? 'error'})`);
    else if (ws.droppedCount > 0) Alert.alert('Journal Penuh', `Journal di batas 1500 sinyal — ${ws.droppedCount} sinyal paling lama otomatis kebuang.`);
    setSaved(prev => { const n = new Set(prev); list.forEach(x => n.add(keyOf(x))); return n; });
    setSaveAllMsg(`${savedCount} tersimpan, ${skippedCount} dilewati (duplikat 24 jam)`);
    setSavingAll(false); setTimeout(() => setSaveAllMsg(null), 4000);
  }, []);

  const toggleRr = (v: number) => setRr(p => (p.includes(v) ? p.filter(x => x !== v) : [...p, v]));
  const pct = data && data.target > 0 ? Math.round((data.scanned / data.target) * 100) : 0;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 90, paddingHorizontal: 14, gap: 10 }}>
      <Text style={{ fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.foreground }}>Setup Finder</Text>
      <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Whale (order book) + backtest WR. WR/R di sini = backtest candle, bukan bukti setup — buktinya forward test di Journal.</Text>

      <View style={st.wrap}>
        <Chip label="🎯 Cari setup terbaik" active={mode === 'cari'} onPress={() => setMode('cari')} colors={colors} />
        <Chip label="🔎 Cek entry & saran" active={mode === 'cek'} onPress={() => setMode('cek')} colors={colors} />
      </View>
      {mode === 'cek' && <CheckPanel colors={colors} />}
      {mode === 'cari' && (<>
      <View style={[st.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={st.h}>RR (maks 6)</Text>
        <View style={st.wrap}>{RR_OPTIONS.map(v => <Chip key={v} label={`1:${v}`} active={rr.includes(v)} onPress={() => toggleRr(v)} colors={colors} />)}</View>
        <Text style={st.h}>Arah</Text>
        <View style={st.wrap}>{(['BOTH', 'BUY', 'SELL'] as const).map(v => <Chip key={v} label={v === 'BOTH' ? 'Keduanya' : v} active={side === v} onPress={() => setSide(v)} colors={colors} />)}</View>
        <Text style={st.h}>Min. nilai tembok (USDT)</Text>
        <View style={st.wrap}>{WALL_OPTIONS.map(v => <Chip key={v} label={fmtUsd(v)} active={minWall === v} onPress={() => setMinWall(v)} colors={colors} />)}</View>
        <Text style={st.h}>Min. WR (filter tampilan)</Text>
        <View style={st.wrap}>{[0, 40, 50, 60, 70].map(v => <Chip key={v} label={`${v}%`} active={minWr === v} onPress={() => setMinWr(v)} colors={colors} />)}</View>
        <Text style={st.h}>Tampilkan</Text>
        <View style={st.wrap}>
          {SHOW_OPTIONS.map(v => <Chip key={v} label={v === 0 ? 'Semua' : `Top ${v}`} active={show === v} onPress={() => setShow(v)} colors={colors} />)}
          <Chip label="Hanya R > 0" active={onlyPos} onPress={() => setOnlyPos(o => !o)} colors={colors} />
        </View>
        <Pressable onPress={start} disabled={running} style={[st.startBtn, { backgroundColor: running ? colors.border : ACCENT }]}>
          <Text style={{ fontSize: 14, fontFamily: 'Inter_700Bold', color: '#0A0E1A' }}>{running ? 'Scanning…' : data?.status === 'complete' ? 'Scan ulang 500 koin' : 'Mulai scan 500 koin'}</Text>
        </Pressable>
        <Text style={{ fontSize: 10, color: colors.mutedForeground }}>Scan jalan manual, pakai pengaturan di atas. ±70–80 weight per koin, 500 koin ±20 menit, hasil muncul progresif. Scan ulang baru bisa menandai tembok &quot;asli&quot;.</Text>
      </View>

      {data && (
        <View style={[st.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.foreground }}>
            {data.status === 'running' ? `Scanning ${data.scanned}/${data.target} (${pct}%)` : data.status === 'complete' ? `Selesai: ${data.scanned} koin` : data.status === 'error' ? 'Error' : 'Belum scan — tekan Mulai scan'}
          </Text>
          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
            gagal & diganti {data.failed} · setup ditolak (SL &gt; 4%) {data.skippedSetups} · total kandidat {data.totalSetups} · weight 1m {data.usedWeight}/2400
          </Text>
          {data.status === 'error' && <Text style={{ fontSize: 11, color: colors.bearish }}>{data.errorMessage}</Text>}
        </View>
      )}
      {!data && <ActivityIndicator color={ACCENT} />}

      {data && data.setups.length > 0 && (
        <Pressable onPress={() => saveAll(data.setups)} disabled={savingAll} style={[st.saveBtn, { borderColor: ACCENT, opacity: savingAll ? 0.5 : 1 }]}>
          <Text style={{ fontSize: 12, fontFamily: 'Inter_700Bold', color: ACCENT }}>{savingAll ? 'Menyimpan…' : `Simpan semua ke Journal (${data.setups.length})`}</Text>
        </Pressable>
      )}
      {saveAllMsg && <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{saveAllMsg}</Text>}
      {data?.setups.map(s => {
        const k = `${s.symbol}|${s.side}|${s.rr}|${s.entry}`;
        return <SetupCard key={k} s={s} colors={colors} onSave={saveOne} saved={saved.has(k)} />;
      })}
      {data && data.status !== 'idle' && data.setups.length === 0 && data.scanned > 0 && (
        <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Belum ada setup yang lolos filter (Min. WR / Hanya R &gt; 0).</Text>
      )}

      </>)}

      <MenuJournalSummary sourceMenu="Setup Finder" accentColor={ACCENT} />
    </ScrollView>
  );
}

const st = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  h: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#94A3B8', letterSpacing: 0.5, marginTop: 2 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  startBtn: { marginTop: 6, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  card: { borderWidth: 1, borderLeftWidth: 3, borderRadius: 12, padding: 12, gap: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  lbl: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  val: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  saveBtn: { marginTop: 10, borderWidth: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
});
