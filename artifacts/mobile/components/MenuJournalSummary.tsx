import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { MENU_COLORS } from '@/constants/theme';
import {
  type JournalEntry, type SourceMenu,
  journalLoadAll, breakdownBySkill,
  buildJournalSummary, compareIndicatorsWinLose, buildLoseConditionProfiles, buildDevelopmentRecommendations,
  getJournalBaseline, setJournalBaseline, filterByBaseline,
  buildCrtForwardTest, SCALP_FORWARD,
} from '../app/(tabs)/journal-helpers';

/**
 * Ringkasan Journal yang difilter ke 1 menu — GANTIIN tab LOG lama (request
 * user: "sinyal log yang ada di semua menu ganti aja dengan ringkasan di
 * menu jurnal"). Journal jadi SATU-SATUNYA sumber data win/lose (lebih
 * akurat — udah lewat fix pagination + entry-hit-check — dan lebih lengkap:
 * BTC correlation, order type, 8 indikator momentum) dipake bareng di semua
 * menu, bukan sistem Log terpisah-pisah per menu lagi.
 */
export function MenuJournalSummary({ sourceMenu, accentColor }: { sourceMenu: SourceMenu; accentColor: string }) {
  const colors = useColors();
  const router = useRouter();
  const [allEntries, setAllEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [baseline, setBaseline] = useState<number | null>(null);

  const load = useCallback(async () => {
    const all = await journalLoadAll();
    setAllEntries(all.filter(e => e.sourceMenu === sourceMenu));
    setBaseline(await getJournalBaseline());
    setLoading(false);
  }, [sourceMenu]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const entries = React.useMemo(() => filterByBaseline(allEntries, baseline), [allEntries, baseline]);
  const summary = React.useMemo(() => buildJournalSummary(entries), [entries]);
  const indicatorResult = React.useMemo(() => compareIndicatorsWinLose(entries), [entries]);
  const loseProfiles = React.useMemo(() => buildLoseConditionProfiles(entries, 'skill'), [entries]);
  const recommendations = React.useMemo(() => buildDevelopmentRecommendations(entries), [entries]);
  const perSkill = React.useMemo(() => breakdownBySkill(entries), [entries]);
  // Forward test Scalping CRT D1→M15 — SENGAJA pakai allEntries (bukan yang kena baseline): strategi ini sendiri titik mulainya.
  const mmForward = React.useMemo(() => (sourceMenu === 'Scalping' ? buildCrtForwardTest(allEntries) : null), [allEntries, sourceMenu]);

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={accentColor} /></View>;
  }

  if (allEntries.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <Feather name="book" size={32} color={colors.mutedForeground} />
        <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.foreground, marginTop: 10, textAlign: 'center' }}>Belum ada sinyal dari menu ini di Journal</Text>
        <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 4, textAlign: 'center', lineHeight: 16 }}>
          Tap "Simpan ke Journal" pas ada sinyal di tab Analisa, terus evaluasi di menu Journal.
        </Text>
      </View>
    );
  }

  const baselineLabel = baseline ? new Date(baseline).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) + ' WIB' : null;

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
      {/* Info baseline aktif — baseline itu SETTING GLOBAL (di-set dari Journal
          utama tab Ringkasan), otomatis kepake di sini juga biar konsisten. */}
      {baseline && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, borderWidth: 1, borderColor: MENU_COLORS.journal, backgroundColor: `${MENU_COLORS.journal}12`, padding: 10, marginBottom: 12 }}>
          <Feather name="flag" size={13} color={MENU_COLORS.journal} />
          <Text style={{ fontSize: 10, fontFamily: 'Inter_500Medium', color: colors.foreground, flex: 1 }}>Baseline aktif sejak {baselineLabel} — data di bawah cuma sinyal SETELAH ini</Text>
          <Pressable onPress={async () => { await setJournalBaseline(null); setBaseline(null); }}><Feather name="x" size={14} color={colors.mutedForeground} /></Pressable>
        </View>
      )}

      {mmForward && (() => {
        const gf = mmForward;
        const vColor = gf.verdict === 'lolos' ? colors.bullish : gf.verdict === 'gagal' ? colors.bearish : colors.gold;
        return (
          <View style={{ borderRadius: 12, borderWidth: 1, borderColor: vColor, backgroundColor: `${vColor}0D`, padding: 12, marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Feather name="activity" size={12} color={vColor} />
              <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: vColor, letterSpacing: 0.5 }}>FORWARD TEST — SCALPING CRT D1→M15</Text>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: `${colors.mutedForeground}25`, overflow: 'hidden', marginBottom: 8 }}>
              <View style={{ width: `${gf.progressPct}%`, height: 6, backgroundColor: vColor }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              <StatBox label="RESOLVE" value={`${gf.resolved}/${SCALP_FORWARD.MIN_RESOLVED}`} color={vColor} colors={colors} />
              <StatBox label="WIN RATE" value={gf.winRate === null ? '—' : `${gf.winRate.toFixed(1)}%`} color={colors.foreground} colors={colors} />
              <StatBox label="AVG R" value={gf.avgR === null ? '—' : gf.avgR.toFixed(2)} color={colors.foreground} colors={colors} />
              <StatBox label="AVG R NET" value={gf.avgRNet === null ? '—' : gf.avgRNet.toFixed(2)} color={colors.foreground} colors={colors} />
            </View>
            <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.foreground, lineHeight: 18 }}>{gf.verdictText}</Text>
            <Text style={{ fontSize: 10, fontFamily: 'Inter_500Medium', color: colors.mutedForeground, lineHeight: 15, marginTop: 6 }}>
              Per arah: {gf.bySide.map(r => `${r.side} ${r.win}/${r.resolved}`).join(' · ')} (win/resolve)
            </Text>
            <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, lineHeight: 15, marginTop: 6 }}>
              {gf.total} sinyal berlabel CRT D1→M15 ({gf.win}W/{gf.lose}L, {gf.pending} pending, {gf.expired} expired). Kriteria lolos: ≥{SCALP_FORWARD.MIN_RESOLVED} resolve, win rate &gt; {SCALP_FORWARD.MIN_WIN_RATE}%, avgR (RR 1:2) setelah biaya &gt; 0. R dihitung pakai basis RR 1:2: WIN (TP1/TP2) = +2R, LOSE = −1R; biaya = asumsi 0,08% round-trip. Backtest filter-nya (tanpa biaya) sekitar 39,6% tapi threshold dipilih dari data yang sama, jadi forward test ini bukti yang menentukan.
            </Text>
          </View>
        );
      })()}

      {entries.length === 0 ? (
        <View style={{ alignItems: 'center', padding: 24 }}>
          <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, textAlign: 'center' }}>Belum ada sinyal dari menu ini setelah baseline ini.</Text>
        </View>
      ) : (
      <>
      {/* Quick stats */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        <StatBox label="WIN" value={String(entries.filter(e => e.status === 'win_tp1' || e.status === 'win_tp2').length)} color={colors.bullish} colors={colors} />
        <StatBox label="LOSE" value={String(entries.filter(e => e.status === 'lose').length)} color={colors.bearish} colors={colors} />
        <StatBox label="PENDING" value={String(entries.filter(e => e.status === 'pending').length)} color={colors.mutedForeground} colors={colors} />
        <StatBox label="WIN RATE" value={`${summary.overallWinRate}%`} color={accentColor} colors={colors} />
      </View>

      {/* Kesimpulan */}
      <View style={{ borderRadius: 12, borderWidth: 1, borderColor: accentColor, backgroundColor: `${accentColor}0D`, padding: 12, marginBottom: 14 }}>
        <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: accentColor, letterSpacing: 0.5, marginBottom: 8 }}>KESIMPULAN</Text>
        {summary.conclusions.map((c, i) => (
          <Text key={i} style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.foreground, lineHeight: 18, marginBottom: i < summary.conclusions.length - 1 ? 6 : 0 }}>{c}</Text>
        ))}
      </View>

      {/* Rekomendasi pengembangan — request user: "kasih tau apa yang perlu diperbaiki kedepannya" */}
      <View style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.gold, backgroundColor: `${colors.gold}0D`, padding: 12, marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Feather name="tool" size={12} color={colors.gold} />
          <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.gold, letterSpacing: 0.5 }}>REKOMENDASI PENGEMBANGAN</Text>
        </View>
        {recommendations.map((r, i) => (
          <Text key={i} style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.foreground, lineHeight: 18, marginBottom: i < recommendations.length - 1 ? 8 : 0 }}>• {r}</Text>
        ))}
      </View>

      {/* Per skill */}
      {perSkill.length > 0 && (
        <View style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, letterSpacing: 0.5, marginBottom: 4 }}>PER SKILL (di menu ini)</Text>
          {perSkill.sort((a, b) => b.winRate - a.winRate).map((s, i) => (
            <View key={s.label + i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.foreground }}>{s.label}</Text>
              <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: s.winRate >= 55 ? colors.bullish : s.winRate < 40 ? colors.bearish : colors.gold }}>
                {s.winRate}% ({s.win}W/{s.lose}L, {s.total} total)
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Profil kondisi LOSE */}
      {loseProfiles.length > 0 && (
        <View style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, letterSpacing: 0.5, marginBottom: 4 }}>🔍 PROFIL KONDISI LOSE</Text>
          {loseProfiles.map((p, i) => (
            <View key={p.groupLabel + i} style={{ borderRadius: 10, borderWidth: 1, borderColor: colors.bearish, backgroundColor: `${colors.bearish}0D`, padding: 10, marginBottom: 8 }}>
              <Text style={{ fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.foreground }}>{p.groupLabel} · TF {p.tfLabel}</Text>
              <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, lineHeight: 16, marginTop: 4 }}>{p.narrative}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Indikator win vs lose, ringkas (5 teratas doang, biar gak kepanjangan di sini) */}
      {indicatorResult.comparisons.length > 0 && (
        <View style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, letterSpacing: 0.5, marginBottom: 4 }}>INDIKATOR PAS WIN VS LOSE (ringkas)</Text>
          {indicatorResult.comparisons.slice(0, 5).map((c, i) => (
            <View key={c.label + i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: colors.foreground, flex: 1 }}>{c.label}</Text>
              <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.bullish }}>{c.winAvg}{c.unit}</Text>
              <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginHorizontal: 4 }}>vs</Text>
              <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.bearish }}>{c.loseAvg}{c.unit}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Link ke Journal lengkap buat detail penuh */}
      <Pressable onPress={() => router.push('/(tabs)/journal')} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, opacity: pressed ? 0.7 : 1 }]}>
        <Feather name="book-open" size={14} color={colors.mutedForeground} />
        <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground }}>Buka Journal Lengkap (detail per sinyal, evaluasi)</Text>
      </Pressable>
      </>
      )}
    </ScrollView>
  );
}

function StatBox({ label, value, color, colors }: { label: string; value: string; color: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingVertical: 10 }}>
      <Text style={{ fontSize: 16, fontFamily: 'Inter_700Bold', color }}>{value}</Text>
      <Text style={{ fontSize: 8, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, marginTop: 2 }}>{label}</Text>
    </View>
  );
}