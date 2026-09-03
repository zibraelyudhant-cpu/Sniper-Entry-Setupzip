import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator, Platform, Pressable, ScrollView,
  StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { AnimatedCard } from '@/components/animated/AnimatedCard';
import { AnimatedTabSwitcher } from '@/components/animated/AnimatedTabSwitcher';
import { FuturisticBackground } from '@/components/animated/FuturisticBackground';
import { MENU_COLORS } from '@/constants/theme';
import {
  type JournalEntry, type SourceMenu,
  journalLoadAll, journalDelete, journalEvaluate, journalUpdate, journalUpdateMany,
  breakdownByMenu, breakdownBySkill, breakdownByTF, breakdownByAdxRange, breakdownByRsiRange, breakdownByBias,
  buildJournalSummary, compareIndicatorsWinLose, buildLoseConditionProfiles, computeTimingStats,
  getJournalBaseline, setJournalBaseline, filterByBaseline,
  registerFollowup, fetchFollowups, type SignalFollowupResult,
  type JournalBreakdown, type JournalSummary, type SimpleVerdict, type IndicatorComparison, type LoseConditionProfile, type TimingStats,
} from './journal-helpers';

const ACCENT = MENU_COLORS.journal;

function formatPrice(v: number): string {
  if (v >= 1000) return v.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(4);
  if (v >= 0.01) return v.toFixed(5);
  return v.toFixed(6);
}

const MENU_FILTER_COLORS: Record<SourceMenu, string> = {
  'Counter Scalping': MENU_COLORS.breakout,
  'Scalping': MENU_COLORS.scalping,
};

// ─── Breakdown mini bar ───────────────────────────────────────────────────────

function BreakdownRow({ item, colors }: { item: JournalBreakdown; colors: ReturnType<typeof useColors> }) {
  const decided = item.win + item.lose;
  const wrColor = item.winRate >= 60 ? colors.bullish : item.winRate >= 40 ? colors.gold : colors.bearish;
  return (
    <View style={{ paddingVertical: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.foreground, flex: 1 }} numberOfLines={1}>{item.label}</Text>
        <Text style={{ fontSize: 12, fontFamily: 'Inter_700Bold', color: decided > 0 ? wrColor : colors.mutedForeground }}>
          {decided > 0 ? `${item.winRate}%` : '—'}
        </Text>
      </View>
      <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden', flexDirection: 'row' }}>
        {decided > 0 && (
          <>
            <View style={{ width: `${(item.win / decided) * 100}%`, backgroundColor: colors.bullish }} />
            <View style={{ width: `${(item.lose / decided) * 100}%`, backgroundColor: colors.bearish }} />
          </>
        )}
      </View>
      <Text style={{ fontSize: 9, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 3 }}>
        {item.win}W / {item.lose}L / {item.pending}P — total {item.total}
      </Text>
    </View>
  );
}

function BreakdownSection({ title, data, colors }: { title: string; data: JournalBreakdown[]; colors: ReturnType<typeof useColors> }) {
  if (data.length === 0) return null;
  return (
    <View style={{ marginBottom: 4 }}>
      <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, letterSpacing: 0.5, marginBottom: 2 }}>{title}</Text>
      {data.map((item, i) => <BreakdownRow key={item.label + i} item={item} colors={colors} />)}
    </View>
  );
}

// ─── Detail Card ──────────────────────────────────────────────────────────────

function IndicatorRow({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
      <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground }}>{label}</Text>
      <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.foreground }}>{value}</Text>
    </View>
  );
}

function JournalEntryCard({
  entry, colors, index, expanded, onToggle, onEvaluate, onDelete, evaluating, followup,
}: {
  entry: JournalEntry; colors: ReturnType<typeof useColors>; index: number;
  expanded: boolean; onToggle: () => void; onEvaluate: () => void; onDelete: () => void; evaluating: boolean;
  followup?: SignalFollowupResult;
}) {
  const isBuy = entry.bias === 'bullish';
  const biasColor = isBuy ? colors.bullish : colors.bearish;
  const menuColor = MENU_FILTER_COLORS[entry.sourceMenu] ?? ACCENT;
  const statusColor = entry.status === 'win_tp1' || entry.status === 'win_tp2' ? colors.bullish
    : entry.status === 'lose' ? colors.bearish
    : entry.status === 'expired' ? colors.mutedForeground : colors.gold;
  const statusLabel = entry.status === 'win_tp1' ? 'WIN TP1' : entry.status === 'win_tp2' ? 'WIN TP2'
    : entry.status === 'lose' ? 'LOSE' : entry.status === 'expired' ? 'EXPIRED' : 'PENDING';
  // Status SINYAL saat disimpan (request user, "Masukin Semua ke Journal") —
  // BEDA dari status evaluasi win/lose di atas. Cuma tampil kalau ada
  // (entry manual satuan gak isi field ini, given itu SELALU in_zone).
  const signalStatusColor = entry.signalStatus === 'in_zone' ? colors.bullish
    : entry.signalStatus === 'approaching' ? ACCENT : colors.gold;
  const signalStatusLabel = entry.signalStatus === 'in_zone' ? '🎯 SIAP ENTRY'
    : entry.signalStatus === 'approaching' ? '⚡ MENDEKATI' : '⏳ WAITING';

  return (
    <AnimatedCard index={index}>
      <View style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: 'hidden', borderLeftWidth: 3, borderLeftColor: statusColor, marginBottom: 8 }}>
        <Pressable onPress={onToggle} style={{ padding: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontFamily: 'Inter_600SemiBold', color: colors.foreground }}>{entry.symbol.replace('USDT', '')}/USDT</Text>
              <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 2 }}>{entry.timestamp}</Text>
              <View style={{ flexDirection: 'row', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: `${menuColor}18`, borderWidth: 1, borderColor: menuColor }}>
                  <Text style={{ fontSize: 9, fontFamily: 'Inter_700Bold', color: menuColor }}>{entry.sourceMenu}</Text>
                </View>
                <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: `${colors.mutedForeground}12` }}>
                  <Text style={{ fontSize: 9, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground }}>{entry.sourceSkill}</Text>
                </View>
                {entry.signalStatus && (
                  <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: `${signalStatusColor}18`, borderWidth: 1, borderColor: signalStatusColor }}>
                    <Text style={{ fontSize: 9, fontFamily: 'Inter_700Bold', color: signalStatusColor }}>{signalStatusLabel}</Text>
                  </View>
                )}
              </View>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: `${statusColor}18` }}>
                <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: statusColor }}>{statusLabel}</Text>
              </View>
              <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: biasColor }}>{isBuy ? '▲ LONG' : '▼ SHORT'}</Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 10, paddingTop: 8 }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 9, fontFamily: 'Inter_500Medium', color: colors.mutedForeground }}>ENTRY</Text>
              <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.foreground, marginTop: 2 }}>{formatPrice(entry.entryPrice)}</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 9, fontFamily: 'Inter_500Medium', color: colors.mutedForeground }}>SL</Text>
              <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.bearish, marginTop: 2 }}>{formatPrice(entry.stopLoss)}</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 9, fontFamily: 'Inter_500Medium', color: colors.mutedForeground }}>TP1</Text>
              <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.bullish, marginTop: 2 }}>{formatPrice(entry.takeProfit1)}</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 9, fontFamily: 'Inter_500Medium', color: colors.mutedForeground }}>TF</Text>
              <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.foreground, marginTop: 2 }}>
                {entry.tfEksekusi ? `${entry.tfStruktur}→${entry.tfEksekusi}` : entry.tfStruktur}
              </Text>
            </View>
            <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedForeground} style={{ marginLeft: 4, alignSelf: 'center' }} />
          </View>
        </Pressable>

        {expanded && (
          <View style={{ paddingHorizontal: 12, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 10 }}>
            <IndicatorRow label="Harga saat sinyal" value={formatPrice(entry.currentPriceAtSignal)} colors={colors} />
            {entry.rr1 !== undefined && <IndicatorRow label="RR rencana" value={`1:${entry.rr1.toFixed(1)}`} colors={colors} />}
            {entry.rr !== undefined && <IndicatorRow label="RR hasil" value={entry.rr > 0 ? `1:${entry.rr}` : '-1'} colors={colors} />}
            {entry.evaluatedAt && <IndicatorRow label="Dievaluasi" value={entry.evaluatedAt} colors={colors} />}

            {entry.technicalSnapshot && (
              <>
                <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, letterSpacing: 0.5, marginTop: 10, marginBottom: 4 }}>
                  INDIKATOR — TF STRUKTUR ({entry.tfStruktur})
                </Text>
                <IndicatorRow label="RSI(14)" value={entry.technicalSnapshot.struktur.rsi.toFixed(1)} colors={colors} />
                <IndicatorRow label="ATR" value={`${entry.technicalSnapshot.struktur.atr.toFixed(6)} (${entry.technicalSnapshot.struktur.atrPct.toFixed(2)}%)`} colors={colors} />
                <IndicatorRow label="ADX(14)" value={entry.technicalSnapshot.struktur.adx.toFixed(1)} colors={colors} />
                <IndicatorRow label="Stochastic %K/%D" value={`${entry.technicalSnapshot.struktur.stochK.toFixed(1)} / ${entry.technicalSnapshot.struktur.stochD.toFixed(1)}`} colors={colors} />
                <IndicatorRow label="MACD Histogram" value={entry.technicalSnapshot.struktur.macd.toFixed(4)} colors={colors} />
                <IndicatorRow label="MFI(14)" value={entry.technicalSnapshot.struktur.mfi.toFixed(1)} colors={colors} />
                <IndicatorRow label="CCI(20)" value={entry.technicalSnapshot.struktur.cci.toFixed(1)} colors={colors} />
                <IndicatorRow label="ROC(12)" value={`${entry.technicalSnapshot.struktur.roc.toFixed(2)}%`} colors={colors} />

                {entry.tfEksekusi && (
                  <>
                    <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, letterSpacing: 0.5, marginTop: 10, marginBottom: 4 }}>
                      INDIKATOR — TF EKSEKUSI ({entry.tfEksekusi})
                    </Text>
                    <IndicatorRow label="RSI(14)" value={entry.technicalSnapshot.eksekusi.rsi.toFixed(1)} colors={colors} />
                    <IndicatorRow label="ATR" value={`${entry.technicalSnapshot.eksekusi.atr.toFixed(6)} (${entry.technicalSnapshot.eksekusi.atrPct.toFixed(2)}%)`} colors={colors} />
                    <IndicatorRow label="ADX(14)" value={entry.technicalSnapshot.eksekusi.adx.toFixed(1)} colors={colors} />
                    <IndicatorRow label="Stochastic %K/%D" value={`${entry.technicalSnapshot.eksekusi.stochK.toFixed(1)} / ${entry.technicalSnapshot.eksekusi.stochD.toFixed(1)}`} colors={colors} />
                    <IndicatorRow label="MACD Histogram" value={entry.technicalSnapshot.eksekusi.macd.toFixed(4)} colors={colors} />
                    <IndicatorRow label="MFI(14)" value={entry.technicalSnapshot.eksekusi.mfi.toFixed(1)} colors={colors} />
                    <IndicatorRow label="CCI(20)" value={entry.technicalSnapshot.eksekusi.cci.toFixed(1)} colors={colors} />
                    <IndicatorRow label="ROC(12)" value={`${entry.technicalSnapshot.eksekusi.roc.toFixed(2)}%`} colors={colors} />
                  </>
                )}
                <Text style={{ fontSize: 9, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 6, fontStyle: 'italic' }}>
                  Indikator di atas murni informasional (nilai pas sinyal diberikan) — gak pernah jadi bagian keputusan entry.
                </Text>
              </>
            )}

            {/* Analisa Pasca-Trade (request user, Menu Journal "AI Agent") —
                cek 1 jam SETELAH SL/TP kena, apakah market beneran lanjut ke
                arah bias asli atau balik. Cuma tampil buat entry yang UDAH
                RESOLVE (win/lose), dan udah didaftarin ke server. */}
            {(entry.status === 'win_tp1' || entry.status === 'win_tp2' || entry.status === 'lose') && (
              <>
                <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.gold, letterSpacing: 0.5, marginTop: 10, marginBottom: 6 }}>
                  🤖 ANALISA PASCA-TRADE (1 JAM SETELAH)
                </Text>
                {!followup ? (
                  <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, fontStyle: 'italic' }}>
                    Belum terdaftar — bakal otomatis dicek server begitu lo evaluasi ulang atau buka lagi nanti.
                  </Text>
                ) : followup.isPending ? (
                  <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, fontStyle: 'italic' }}>
                    ⏳ Masih dipantau — server bakal cek harga 1 jam setelah resolve, hasilnya muncul di sini otomatis.
                  </Text>
                ) : (
                  <View style={{ backgroundColor: `${colors.gold}12`, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: `${colors.gold}40` }}>
                    <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.foreground, marginBottom: 4 }}>
                      {followup.priceChangePct !== null ? `${followup.priceChangePct > 0 ? '+' : ''}${followup.priceChangePct.toFixed(2)}%` : '-'} dalam 1 jam
                      {followup.priceChangeAtrRatio !== null ? ` (${Math.abs(followup.priceChangeAtrRatio).toFixed(2)}x ATR)` : ''}
                    </Text>
                    <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, lineHeight: 15 }}>
                      {followup.verdictNote}
                    </Text>
                  </View>
                )}
              </>
            )}

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              {entry.status === 'pending' && (
                <Pressable onPress={onEvaluate} disabled={evaluating}
                  style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: ACCENT, backgroundColor: `${ACCENT}15`, opacity: pressed || evaluating ? 0.7 : 1 }]}>
                  {evaluating ? <ActivityIndicator size={12} color={ACCENT} /> : <Feather name="search" size={12} color={ACCENT} />}
                  <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: ACCENT }}>{evaluating ? 'Evaluasi...' : 'Evaluasi'}</Text>
                </Pressable>
              )}
              <Pressable onPress={onDelete} style={({ pressed }) => [{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, opacity: pressed ? 0.7 : 1 }]}>
                <Feather name="trash-2" size={14} color="#ef4444" />
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </AnimatedCard>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function JournalScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedOnceRef = useRef(false);
  const [activeTab, setActiveTab] = useState<'daftar' | 'analisa' | 'ringkasan'>('daftar');
  const [menuFilter, setMenuFilter] = useState<SourceMenu | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [followups, setFollowups] = useState<Map<string, SignalFollowupResult>>(new Map());

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    const all = await journalLoadAll();
    setEntries(all);
    setLoading(false);
    hasLoadedOnceRef.current = true;

    // Fetch hasil "Analisa Pasca-Trade" (request user, Menu Journal "AI
    // Agent") — cuma buat entry yang UDAH RESOLVE (pending gak punya
    // followup sama sekali). Fail-safe di dalam fetchFollowups sendiri.
    const resolved = all.filter(e => e.status !== 'pending' && e.status !== 'expired');
    if (resolved.length > 0) {
      const result = await fetchFollowups(resolved.map(e => e.id));
      setFollowups(result);

      // FIX (gap ketemu pas review — sinyal LAMA yang resolve SEBELUM fitur
      // ini ada gak akan pernah kedaftar, given registerFollowup cuma
      // dipanggil pas TITIK EVALUASI, bukan titik LOAD): daftarin OTOMATIS
      // entry yang statusnya resolve TAPI belum ada di hasil fetch sama
      // sekali (bukan cuma isPending — genuinely gak kedaftar). Batch 5 +
      // delay, biar gak flood server kalau ada RATUSAN sinyal lama sekaligus
      // (kejadian nyata: user punya 175 sinyal Journal).
      const unregistered = resolved.filter(e => !result.has(e.id) && e.exitPrice !== undefined && e.resolvedAt !== undefined);
      (async () => {
        for (let i = 0; i < unregistered.length; i += 5) {
          const batch = unregistered.slice(i, i + 5);
          await Promise.all(batch.map(e => registerFollowup(e, { status: e.status, exitPrice: e.exitPrice, resolvedAt: e.resolvedAt })));
          if (i + 5 < unregistered.length) await new Promise(r => setTimeout(r, 200));
        }
      })();
    }
  }, []);

  // Fix: dulu pake useEffect biasa — cuma load data pas screen ini PERTAMA
  // KALI mount, jadi kalau user simpan sinyal dari menu lain terus pindah ke
  // tab Journal (yang udah pernah ke-mount sebelumnya, gak remount ulang),
  // datanya gak ke-refresh sampe app di-reload manual. useFocusEffect nge-load
  // ulang TIAP KALI tab ini difokuskan. showSpinner cuma true pas load
  // pertama (pake ref, bukan state, biar gak kena stale closure) — refresh
  // berikutnya diem-diem di background (list lama tetep keliatan sampe data
  // baru siap, gak nge-flash full-screen spinner).
  useFocusEffect(
    useCallback(() => {
      load(!hasLoadedOnceRef.current);
    }, [load])
  );

  const handleEvaluate = useCallback(async (entry: JournalEntry) => {
    setEvaluatingId(entry.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const patch = await journalEvaluate(entry);
    const updated = await journalUpdate(entry.id, patch);
    setEntries(updated);
    setEvaluatingId(null);
    registerFollowup(entry, patch); // fire-and-forget — analisa pasca-trade (request user)
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updated = await journalDelete(id);
    setEntries(updated);
  }, []);

  const filtered = useMemo(() => menuFilter === 'all' ? entries : entries.filter(e => e.sourceMenu === menuFilter), [entries, menuFilter]);

  // "Evaluasi Semua" (request user, biar gak satu-satu). Batch 3 + delay
  // 300ms antar batch — pola sama kayak Scan biar gak kena rate limit Binance
  // (tiap evaluasi manggil klines API). Update storage 1x di akhir (bulk),
  // bukan per-entri, biar gak bolak-balik baca-tulis AsyncStorage.
  const [evaluatingAll, setEvaluatingAll] = useState(false);
  const [evalProgress, setEvalProgress] = useState({ done: 0, total: 0 });
  const handleEvaluateAll = useCallback(async () => {
    const pending = filtered.filter(e => e.status === 'pending');
    if (pending.length === 0) return;
    setEvaluatingAll(true);
    setEvalProgress({ done: 0, total: pending.length });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const patches: { id: string; patch: Partial<JournalEntry> }[] = [];
    const batchSize = 3;
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(async (entry) => {
        const patch = await journalEvaluate(entry);
        return { id: entry.id, patch, entry };
      }));
      patches.push(...results.map(r => ({ id: r.id, patch: r.patch })));
      results.forEach(r => registerFollowup(r.entry, r.patch)); // fire-and-forget — analisa pasca-trade (request user)
      setEvalProgress({ done: Math.min(i + batchSize, pending.length), total: pending.length });
      if (i + batchSize < pending.length) await new Promise(r => setTimeout(r, 300));
    }

    const updated = await journalUpdateMany(patches);
    setEntries(updated);
    setEvaluatingAll(false);
  }, [filtered]);

  const stats = useMemo(() => {
    const win = filtered.filter(e => e.status === 'win_tp1' || e.status === 'win_tp2').length;
    const lose = filtered.filter(e => e.status === 'lose').length;
    const pending = filtered.filter(e => e.status === 'pending').length;
    const decided = win + lose;
    return { win, lose, pending, winRate: decided > 0 ? Math.round((win / decided) * 100) : 0, total: filtered.length };
  }, [filtered]);

  const menuCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) counts[e.sourceMenu] = (counts[e.sourceMenu] ?? 0) + 1;
    return counts;
  }, [entries]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FuturisticBackground accentColor={ACCENT} secondaryColor="#818CF8" />
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Journal Trading</Text>
        <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>Rekap lengkap semua sinyal — entry/SL/TP, TF, indikator, evaluasi win-lose</Text>
        <View style={{ marginTop: 12 }}>
          <AnimatedTabSwitcher
            tabs={[{ key: 'daftar', label: 'DAFTAR' }, { key: 'analisa', label: 'ANALISA' }, { key: 'ringkasan', label: 'RINGKASAN' }]}
            active={activeTab}
            onChange={(k) => setActiveTab(k as 'daftar' | 'analisa' | 'ringkasan')}
            accentColor={ACCENT}
          />
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={ACCENT} />
        </View>
      ) : entries.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 }}>
          <Feather name="book-open" size={40} color={colors.mutedForeground} />
          <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: colors.foreground, textAlign: 'center' }}>Journal masih kosong</Text>
          <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, textAlign: 'center', lineHeight: 20 }}>
            Simpan sinyal ke Journal dari tab Analisa di menu manapun (Counter Scalping, Scalping) — tombol "Simpan ke Journal" ada di bawah kartu Entry/SL/TP.
          </Text>
        </View>
      ) : activeTab === 'daftar' ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: insets.bottom + 80 }} showsVerticalScrollIndicator={false}>
          {/* Summary stats */}
          <View style={{ flexDirection: 'row', borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12, justifyContent: 'space-around', marginBottom: 10 }}>
            {[
              { v: `${stats.win}`, c: colors.bullish, bg: `${colors.bullish}18`, l: 'WIN' },
              { v: `${stats.lose}`, c: colors.bearish, bg: `${colors.bearish}15`, l: 'LOSE' },
              { v: `${stats.pending}`, c: colors.mutedForeground, bg: `${colors.mutedForeground}12`, l: 'PENDING' },
              { v: `${stats.winRate}%`, c: colors.gold, bg: `${colors.gold}18`, l: 'WIN RATE' },
            ].map(item => (
              <View key={item.l} style={{ alignItems: 'center', gap: 4, backgroundColor: item.bg, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 8, minWidth: 60 }}>
                <Text style={{ fontSize: 16, fontFamily: 'Inter_700Bold', color: item.c }}>{item.v}</Text>
                <Text style={{ fontSize: 8, fontFamily: 'Inter_500Medium', color: colors.mutedForeground, letterSpacing: 0.3 }}>{item.l}</Text>
              </View>
            ))}
          </View>

          {stats.pending > 0 && (
            <Pressable onPress={handleEvaluateAll} disabled={evaluatingAll}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, borderWidth: 1, borderColor: ACCENT, backgroundColor: `${ACCENT}12`, paddingVertical: 11, marginBottom: 10, opacity: pressed || evaluatingAll ? 0.7 : 1 }]}>
              {evaluatingAll
                ? <ActivityIndicator size="small" color={ACCENT} />
                : <Feather name="check-circle" size={14} color={ACCENT} />
              }
              <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: ACCENT }}>
                {evaluatingAll ? `Evaluasi... (${evalProgress.done}/${evalProgress.total})` : `Evaluasi Semua (${stats.pending} pending)`}
              </Text>
            </Pressable>
          )}

          {/* Filter chip per menu — nestedScrollEnabled WAJIB (fix bug ketemu
              user: ScrollView horizontal ini nested di dalam ScrollView
              vertical parent, tanpa ini gesture geser sampingnya suka
              "ketelen" sama scroll vertical, terutama di Android) */}
          <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 10 }}>
            <Pressable onPress={() => setMenuFilter('all')} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: menuFilter === 'all' ? ACCENT : colors.card, borderWidth: 1, borderColor: menuFilter === 'all' ? ACCENT : colors.border }}>
              <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: menuFilter === 'all' ? '#1A0B1F' : colors.mutedForeground }}>Semua ({entries.length})</Text>
            </Pressable>
            {(Object.keys(menuCounts) as SourceMenu[]).map(m => (
              <Pressable key={m} onPress={() => setMenuFilter(m)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: menuFilter === m ? MENU_FILTER_COLORS[m] : colors.card, borderWidth: 1, borderColor: menuFilter === m ? MENU_FILTER_COLORS[m] : colors.border }}>
                <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: menuFilter === m ? '#0A0E1A' : colors.mutedForeground }}>{m} ({menuCounts[m]})</Text>
              </Pressable>
            ))}
          </ScrollView>

          {filtered.map((entry, i) => (
            <JournalEntryCard
              key={entry.id} entry={entry} colors={colors} index={i}
              expanded={expandedId === entry.id}
              onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              onEvaluate={() => handleEvaluate(entry)}
              onDelete={() => handleDelete(entry.id)}
              evaluating={evaluatingId === entry.id}
              followup={followups.get(entry.id)}
            />
          ))}
        </ScrollView>
      ) : activeTab === 'analisa' ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: insets.bottom + 80 }} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginBottom: 14, lineHeight: 17 }}>
            Breakdown win rate per kondisi — cari pola: sinyal dari mana / TF apa / kondisi indikator apa yang paling sering menang buat lo.
          </Text>
          <BreakdownSection title="PER MENU" data={breakdownByMenu(entries)} colors={colors} />
          <BreakdownSection title="PER SKILL" data={breakdownBySkill(entries)} colors={colors} />
          <BreakdownSection title="PER TIMEFRAME" data={breakdownByTF(entries)} colors={colors} />
          <BreakdownSection title="PER ARAH (LONG/SHORT)" data={breakdownByBias(entries)} colors={colors} />
          <BreakdownSection title="PER KEKUATAN TREND (ADX STRUKTUR)" data={breakdownByAdxRange(entries)} colors={colors} />
          <BreakdownSection title="PER KONDISI RSI EKSEKUSI" data={breakdownByRsiRange(entries)} colors={colors} />
        </ScrollView>
      ) : (
        <RingkasanTab entries={entries} colors={colors} />
      )}
    </View>
  );
}

// ─── Tab Ringkasan — kesimpulan siap-baca + perbandingan indikator WIN vs LOSE ──

function VerdictBadge({ verdict, colors }: { verdict: SimpleVerdict['verdict']; colors: ReturnType<typeof useColors> }) {
  const meta = {
    bagus: { label: 'BAGUS', color: colors.bullish },
    cukup: { label: 'CUKUP', color: colors.gold },
    perlu_evaluasi: { label: 'PERLU EVALUASI', color: colors.bearish },
    data_kurang: { label: 'DATA KURANG', color: colors.mutedForeground },
  }[verdict];
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: `${meta.color}18`, borderWidth: 1, borderColor: meta.color }}>
      <Text style={{ fontSize: 9, fontFamily: 'Inter_700Bold', color: meta.color }}>{meta.label}</Text>
    </View>
  );
}

function VerdictRow({ item, colors }: { item: SimpleVerdict; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
      <View style={{ flex: 1, marginRight: 8 }}>
        <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.foreground }} numberOfLines={1}>{item.label}</Text>
        <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 1 }}>
          {item.winRate}% win rate · {item.decided} sinyal selesai (dari {item.total} total)
        </Text>
      </View>
      <VerdictBadge verdict={item.verdict} colors={colors} />
    </View>
  );
}

function IndicatorCompareRow({ item, colors }: { item: IndicatorComparison; colors: ReturnType<typeof useColors> }) {
  const winHigher = item.winAvg > item.loseAvg;
  return (
    <View style={{ borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 10, marginBottom: 8 }}>
      <Text style={{ fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 6 }}>{item.label}</Text>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 6 }}>
        <View style={{ flex: 1, alignItems: 'center', backgroundColor: `${colors.bullish}12`, borderRadius: 8, paddingVertical: 6 }}>
          <Text style={{ fontSize: 8, fontFamily: 'Inter_600SemiBold', color: colors.bullish }}>PAS WIN</Text>
          <Text style={{ fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.bullish, marginTop: 2 }}>{item.winAvg}{item.unit}</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'center', backgroundColor: `${colors.bearish}12`, borderRadius: 8, paddingVertical: 6 }}>
          <Text style={{ fontSize: 8, fontFamily: 'Inter_600SemiBold', color: colors.bearish }}>PAS LOSE</Text>
          <Text style={{ fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.bearish, marginTop: 2 }}>{item.loseAvg}{item.unit}</Text>
        </View>
      </View>
      <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, lineHeight: 15 }}>{item.insight}</Text>
    </View>
  );
}

function LoseProfileCard({ profile, colors }: { profile: LoseConditionProfile; colors: ReturnType<typeof useColors> }) {
  const isMixedTf = profile.tfLabel.includes('campur');
  return (
    <View style={{ borderRadius: 10, borderWidth: 1, borderColor: colors.bearish, backgroundColor: `${colors.bearish}0D`, padding: 12, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={{ fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.foreground }} numberOfLines={1}>{profile.groupLabel}</Text>
          <Text style={{ fontSize: 9, fontFamily: 'Inter_500Medium', color: colors.mutedForeground, marginTop: 1 }}>TF: {profile.tfLabel}</Text>
        </View>
        <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: `${colors.bearish}20` }}>
          <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.bearish }}>{profile.totalLose} LOSE</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.border }}>
          <Text style={{ fontSize: 9, fontFamily: 'Inter_600SemiBold', color: colors.foreground }}>BUY {profile.buyPct}% · SELL {profile.sellPct}%</Text>
        </View>
        {profile.btcSampleSize >= 3 && (
          <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.border }}>
            <Text style={{ fontSize: 9, fontFamily: 'Inter_600SemiBold', color: colors.foreground }}>BTC Searah {profile.btcAlignedPct}% · Gak Searah {profile.btcNotAlignedPct}%</Text>
          </View>
        )}
      </View>
      <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, lineHeight: 17 }}>{profile.narrative}</Text>
      {isMixedTf && (
        <Text style={{ fontSize: 9, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 6, fontStyle: 'italic' }}>
          * TF di atas TF mayoritas doang (grup ini gabungan beberapa skill dengan TF beda-beda) — buat TF pasti per-sinyal, cek breakdown PER SKILL.
        </Text>
      )}
    </View>
  );
}

function TimingCard({ stat, colors }: { stat: TimingStats; colors: ReturnType<typeof useColors> }) {
  const fmtHours = (h: number | null) => h === null ? '—' : h < 1 ? `${Math.round(h * 60)} menit` : `${h} jam`;
  return (
    <View style={{ borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 12, marginBottom: 8 }}>
      <Text style={{ fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 8 }} numberOfLines={1}>{stat.groupLabel}</Text>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 90, alignItems: 'center', backgroundColor: colors.border, borderRadius: 8, paddingVertical: 8 }}>
          <Text style={{ fontSize: 8, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground }}>ENTRY→KEHIT</Text>
          <Text style={{ fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.foreground, marginTop: 2 }}>{fmtHours(stat.avgHoursToEntryHit)}</Text>
          <Text style={{ fontSize: 8, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 1 }}>{stat.sampleEntryHit} sinyal</Text>
        </View>
        <View style={{ flex: 1, minWidth: 90, alignItems: 'center', backgroundColor: `${colors.bullish}12`, borderRadius: 8, paddingVertical: 8 }}>
          <Text style={{ fontSize: 8, fontFamily: 'Inter_600SemiBold', color: colors.bullish }}>KEHIT→TP</Text>
          <Text style={{ fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.bullish, marginTop: 2 }}>{fmtHours(stat.avgHoursToTp)}</Text>
          <Text style={{ fontSize: 8, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 1 }}>{stat.sampleTpHit} sinyal</Text>
        </View>
        <View style={{ flex: 1, minWidth: 90, alignItems: 'center', backgroundColor: `${colors.bearish}12`, borderRadius: 8, paddingVertical: 8 }}>
          <Text style={{ fontSize: 8, fontFamily: 'Inter_600SemiBold', color: colors.bearish }}>KEHIT→SL</Text>
          <Text style={{ fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.bearish, marginTop: 2 }}>{fmtHours(stat.avgHoursToSl)}</Text>
          <Text style={{ fontSize: 8, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 1 }}>{stat.sampleSlHit} sinyal</Text>
        </View>
      </View>
    </View>
  );
}

function BaselineControl({ colors }: { colors: ReturnType<typeof useColors> }) {
  const [baseline, setBaseline] = useState<number | null>(null);
  const [showPresets, setShowPresets] = useState(false);

  useFocusEffect(useCallback(() => {
    getJournalBaseline().then(setBaseline);
  }, []));

  const presets = [
    { label: '1 jam lalu', ms: 60 * 60 * 1000 },
    { label: '6 jam lalu', ms: 6 * 60 * 60 * 1000 },
    { label: '24 jam lalu', ms: 24 * 60 * 60 * 1000 },
    { label: '3 hari lalu', ms: 3 * 24 * 60 * 60 * 1000 },
    { label: '7 hari lalu', ms: 7 * 24 * 60 * 60 * 1000 },
  ];

  const applyPreset = async (ms: number) => {
    const ts = Date.now() - ms;
    await setJournalBaseline(ts);
    setBaseline(ts);
    setShowPresets(false);
  };

  const clearBaseline = async () => {
    await setJournalBaseline(null);
    setBaseline(null);
  };

  const baselineLabel = baseline ? new Date(baseline).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) + ' WIB' : null;

  return (
    <View style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Feather name="flag" size={11} color={colors.mutedForeground} />
        <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, letterSpacing: 0.5 }}>BASELINE — PISAHIN DATA LAMA VS BARU</Text>
      </View>
      <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginBottom: 8, lineHeight: 15 }}>
        Habis rombak formula skill? Set baseline biar analisa di bawah cuma liat sinyal yang disimpen SETELAH titik itu — gak nyampur sama data formula lama.
      </Text>
      {baseline ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, borderWidth: 1, borderColor: MENU_COLORS.journal, backgroundColor: `${MENU_COLORS.journal}12`, padding: 10 }}>
          <Feather name="check-circle" size={14} color={MENU_COLORS.journal} />
          <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: colors.foreground, flex: 1 }}>Aktif sejak {baselineLabel} — analisa di bawah cuma sinyal SETELAH ini</Text>
          <Pressable onPress={clearBaseline}><Feather name="x" size={16} color={colors.mutedForeground} /></Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setShowPresets(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingVertical: 10 }}>
          <Feather name="flag" size={13} color={colors.mutedForeground} />
          <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground }}>Set Baseline</Text>
        </Pressable>
      )}
      {showPresets && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {presets.map(p => (
            <Pressable key={p.label} onPress={() => applyPreset(p.ms)} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: colors.foreground }}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function RingkasanTab({ entries: allEntries, colors }: { entries: JournalEntry[]; colors: ReturnType<typeof useColors> }) {
  const insets = useSafeAreaInsets();
  const [baseline, setBaseline] = useState<number | null>(null);

  useFocusEffect(useCallback(() => {
    getJournalBaseline().then(setBaseline);
  }, []));

  const entries = useMemo(() => filterByBaseline(allEntries, baseline), [allEntries, baseline]);
  const summary = useMemo(() => buildJournalSummary(entries), [entries]);
  const indicatorResult = useMemo(() => compareIndicatorsWinLose(entries), [entries]);
  const loseProfilesByMenu = useMemo(() => buildLoseConditionProfiles(entries, 'menu'), [entries]);
  const loseProfilesBySkill = useMemo(() => buildLoseConditionProfiles(entries, 'skill'), [entries]);
  const timingOverall = useMemo(() => computeTimingStats(entries), [entries]);
  const timingByMenu = useMemo(() => computeTimingStats(entries, 'menu'), [entries]);
  const timingBySkill = useMemo(() => computeTimingStats(entries, 'skill'), [entries]);

  if (allEntries.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, textAlign: 'center' }}>Belum ada data buat diringkas.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: insets.bottom + 80 }} showsVerticalScrollIndicator={false}>
      <BaselineControl colors={colors} />

      {entries.length === 0 ? (
        <View style={{ alignItems: 'center', padding: 24 }}>
          <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, textAlign: 'center' }}>Belum ada sinyal yang disimpen setelah baseline ini.</Text>
        </View>
      ) : (
      <>
      {/* Kesimpulan siap-baca — paling atas, paling gampang dicerna cepat */}
      <View style={{ borderRadius: 12, borderWidth: 1, borderColor: ACCENT, backgroundColor: `${ACCENT}0D`, padding: 12, marginBottom: 16 }}>
        <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: ACCENT, letterSpacing: 0.5, marginBottom: 8 }}>KESIMPULAN</Text>
        {summary.conclusions.map((c, i) => (
          <Text key={i} style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.foreground, lineHeight: 19, marginBottom: i < summary.conclusions.length - 1 ? 8 : 0 }}>{c}</Text>
        ))}
      </View>

      {summary.perMenu.length > 0 && (
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, letterSpacing: 0.5, marginBottom: 4 }}>PER MENU</Text>
          {summary.perMenu.sort((a, b) => b.winRate - a.winRate).map((v, i) => <VerdictRow key={v.label + i} item={v} colors={colors} />)}
        </View>
      )}

      {summary.perSkill.length > 0 && (
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, letterSpacing: 0.5, marginBottom: 4 }}>PER SKILL</Text>
          {summary.perSkill.sort((a, b) => b.winRate - a.winRate).map((v, i) => <VerdictRow key={v.label + i} item={v} colors={colors} />)}
        </View>
      )}

      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, letterSpacing: 0.5, marginBottom: 4 }}>⏱️ TIMING — KECEPATAN SINYAL</Text>
        {timingOverall.length === 0 ? (
          <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, lineHeight: 17 }}>
            Belum ada data timing — fitur ini baru mulai kerekam mulai sekarang. Sinyal LAMA yang udah dievaluasi sebelum fix ini gak punya data ini, tapi sinyal BARU otomatis kekumpul tiap dievaluasi.
          </Text>
        ) : (
          <>
            <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginBottom: 8, lineHeight: 15 }}>
              "Entry→Kehit": dari sinyal disimpen sampe harga BENERAN nyentuh level entry. "Kehit→TP"/"Kehit→SL": dari entry kehit sampe resolve. Angka beda antara TP vs SL itu insight sendiri — misal kalau SL selalu jauh lebih cepet dari TP, kemungkinan momentum di skill itu sering kebalik cepet.
            </Text>
            <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.mutedForeground, letterSpacing: 0.3, marginBottom: 4 }}>KESELURUHAN</Text>
            {timingOverall.map((s, i) => <TimingCard key={'all-' + s.groupLabel + i} stat={s} colors={colors} />)}

            {timingByMenu.length > 0 && (
              <>
                <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.mutedForeground, letterSpacing: 0.3, marginTop: 6, marginBottom: 4 }}>PER MENU</Text>
                {timingByMenu.map((s, i) => <TimingCard key={'menu-' + s.groupLabel + i} stat={s} colors={colors} />)}
              </>
            )}

            {timingBySkill.length > 0 && (
              <>
                <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.mutedForeground, letterSpacing: 0.3, marginTop: 6, marginBottom: 4 }}>PER SKILL</Text>
                {timingBySkill.map((s, i) => <TimingCard key={'skill-' + s.groupLabel + i} stat={s} colors={colors} />)}
              </>
            )}
          </>
        )}
      </View>

      {(loseProfilesByMenu.length > 0 || loseProfilesBySkill.length > 0) && (
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, letterSpacing: 0.5, marginBottom: 4 }}>🔍 PROFIL KONDISI LOSE (per menu & skill)</Text>
          <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginBottom: 8, lineHeight: 15 }}>
            Kombinasi arah (buy/sell), BTC Correlation, dan indikator yang paling sering BARENGAN muncul pas LOSE — minimal 3 sinyal LOSE per grup biar gak asal simpul.
          </Text>
          {loseProfilesByMenu.map((p, i) => <LoseProfileCard key={'menu-' + p.groupLabel + i} profile={p} colors={colors} />)}
          {loseProfilesBySkill.map((p, i) => <LoseProfileCard key={'skill-' + p.groupLabel + i} profile={p} colors={colors} />)}
          {loseProfilesByMenu.length === 0 && loseProfilesBySkill.length === 0 && (
            <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground }}>Belum ada menu/skill dengan minimal 3 sinyal LOSE.</Text>
          )}
        </View>
      )}

      <View style={{ marginBottom: 8 }}>
        <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, letterSpacing: 0.5, marginBottom: 4 }}>INDIKATOR — PAS WIN VS PAS LOSE</Text>
        {indicatorResult.comparisons.length === 0 ? (
          <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, lineHeight: 17 }}>
            Butuh minimal 3 sinyal WIN dan 3 sinyal LOSE (yang punya data indikator) buat mulai bandingin — sekarang baru {indicatorResult.sampleWin} win dan {indicatorResult.sampleLose} lose.
          </Text>
        ) : (
          <>
            <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginBottom: 4 }}>
              Dari {indicatorResult.sampleWin} sinyal WIN dan {indicatorResult.sampleLose} sinyal LOSE yang punya data indikator.
            </Text>
            <Text style={{ fontSize: 9, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginBottom: 8, fontStyle: 'italic', lineHeight: 13 }}>
              "Struktur"/"Eksekusi" di sini gabungan SEMUA skill (TF-nya beda-beda tiap skill, misal Structural H1→M5 vs Counter Structural H1→M5). Mau tau TF konkret per skill? Cek "PROFIL KONDISI LOSE" di atas.
            </Text>
            {indicatorResult.comparisons.map((c, i) => <IndicatorCompareRow key={c.label + i} item={c} colors={colors} />)}
          </>
        )}
      </View>
      </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
});