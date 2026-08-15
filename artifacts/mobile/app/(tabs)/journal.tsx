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
  type JournalBreakdown,
} from './journal-helpers';

const ACCENT = MENU_COLORS.journal;

function formatPrice(v: number): string {
  if (v >= 1000) return v.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(4);
  if (v >= 0.01) return v.toFixed(5);
  return v.toFixed(6);
}

const MENU_FILTER_COLORS: Record<SourceMenu, string> = {
  'Breakout Entry': MENU_COLORS.breakout,
  'Sniper Entry': MENU_COLORS.sniper,
  'Scalping': MENU_COLORS.scalping,
  'Extreme Scalping': MENU_COLORS.extremeScalping,
  'Momentum Hunter': MENU_COLORS.momentumHunter,
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
  entry, colors, index, expanded, onToggle, onEvaluate, onDelete, evaluating,
}: {
  entry: JournalEntry; colors: ReturnType<typeof useColors>; index: number;
  expanded: boolean; onToggle: () => void; onEvaluate: () => void; onDelete: () => void; evaluating: boolean;
}) {
  const isBuy = entry.bias === 'bullish';
  const biasColor = isBuy ? colors.bullish : colors.bearish;
  const menuColor = MENU_FILTER_COLORS[entry.sourceMenu] ?? ACCENT;
  const statusColor = entry.status === 'win_tp1' || entry.status === 'win_tp2' ? colors.bullish
    : entry.status === 'lose' ? colors.bearish
    : entry.status === 'expired' ? colors.mutedForeground : colors.gold;
  const statusLabel = entry.status === 'win_tp1' ? 'WIN TP1' : entry.status === 'win_tp2' ? 'WIN TP2'
    : entry.status === 'lose' ? 'LOSE' : entry.status === 'expired' ? 'EXPIRED' : 'PENDING';

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

                {entry.tfEksekusi && (
                  <>
                    <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, letterSpacing: 0.5, marginTop: 10, marginBottom: 4 }}>
                      INDIKATOR — TF EKSEKUSI ({entry.tfEksekusi})
                    </Text>
                    <IndicatorRow label="RSI(14)" value={entry.technicalSnapshot.eksekusi.rsi.toFixed(1)} colors={colors} />
                    <IndicatorRow label="ATR" value={`${entry.technicalSnapshot.eksekusi.atr.toFixed(6)} (${entry.technicalSnapshot.eksekusi.atrPct.toFixed(2)}%)`} colors={colors} />
                    <IndicatorRow label="ADX(14)" value={entry.technicalSnapshot.eksekusi.adx.toFixed(1)} colors={colors} />
                    <IndicatorRow label="Stochastic %K/%D" value={`${entry.technicalSnapshot.eksekusi.stochK.toFixed(1)} / ${entry.technicalSnapshot.eksekusi.stochD.toFixed(1)}`} colors={colors} />
                  </>
                )}
                <Text style={{ fontSize: 9, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 6, fontStyle: 'italic' }}>
                  Indikator di atas murni informasional (nilai pas sinyal diberikan) — gak pernah jadi bagian keputusan entry.
                </Text>
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
  const [activeTab, setActiveTab] = useState<'daftar' | 'analisa'>('daftar');
  const [menuFilter, setMenuFilter] = useState<SourceMenu | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    const all = await journalLoadAll();
    setEntries(all);
    setLoading(false);
    hasLoadedOnceRef.current = true;
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
        return { id: entry.id, patch };
      }));
      patches.push(...results);
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
            tabs={[{ key: 'daftar', label: 'DAFTAR' }, { key: 'analisa', label: 'ANALISA' }]}
            active={activeTab}
            onChange={(k) => setActiveTab(k as 'daftar' | 'analisa')}
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
            Simpan sinyal ke Journal dari tab Analisa di menu manapun (Breakout Entry, Sniper, Scalping, Extreme Scalping, Momentum Hunter) — tombol "Simpan ke Journal" ada di bawah kartu Entry/SL/TP.
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
            />
          ))}
        </ScrollView>
      ) : (
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
});