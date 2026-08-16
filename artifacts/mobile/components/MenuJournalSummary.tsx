import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import {
  type JournalEntry, type SourceMenu,
  journalLoadAll, breakdownBySkill,
  buildJournalSummary, compareIndicatorsWinLose, buildLoseConditionProfiles, buildDevelopmentRecommendations,
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
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const all = await journalLoadAll();
    setEntries(all.filter(e => e.sourceMenu === sourceMenu));
    setLoading(false);
  }, [sourceMenu]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const summary = React.useMemo(() => buildJournalSummary(entries), [entries]);
  const indicatorResult = React.useMemo(() => compareIndicatorsWinLose(entries), [entries]);
  const loseProfiles = React.useMemo(() => buildLoseConditionProfiles(entries, 'skill'), [entries]);
  const recommendations = React.useMemo(() => buildDevelopmentRecommendations(entries), [entries]);
  const perSkill = React.useMemo(() => breakdownBySkill(entries), [entries]);

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={accentColor} /></View>;
  }

  if (entries.length === 0) {
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

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
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