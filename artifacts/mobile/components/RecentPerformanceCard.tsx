import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface RecentPerformance {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  periodLabel: string;
}

/**
 * Mini-backtest instan — tampil di tab Analisa (bukan Scan) buat kasih konteks
 * historis cepat: "N setup terakhir buat koin ini menang/kalah berapa" — tanpa
 * perlu buka tab Backtest terpisah. Kalau data null (gak ada histori sama sekali
 * dalam periode singkat ini), komponen gak render apa-apa (bukan nampilin 0/0
 * yang bisa disalahartikan).
 */
export function RecentPerformanceCard({ data, accentColor }: {
  data?: RecentPerformance | null;
  accentColor: string;
}) {
  const colors = useColors();
  if (!data || data.totalTrades === 0) return null;

  const winColor = data.winRate >= 75 ? colors.bullish : data.winRate >= 50 ? colors.gold : colors.bearish;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: accentColor }]}>📊 PERFORMA HISTORIS KOIN INI</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>{data.periodLabel}</Text>
      </View>
      <View style={styles.row}>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: winColor }]}>{data.winRate.toFixed(0)}%</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Win Rate</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{data.totalTrades}</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Total Setup</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.bullish }]}>{data.wins}W</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>/{data.losses}L</Text>
        </View>
      </View>
      <Text style={[styles.note, { color: colors.mutedForeground }]}>
        Simulasi cepat setup serupa buat koin ini — bukan jaminan hasil ke depan sama, tapi kasih gambaran pola historis singkat.
        {'\n'}⚠️ Dihitung pakai engine backtest yang sama kayak tab Backtest (logic LAMA, belum sinkron sama analisa live sekarang).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 },
  sub: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  row: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 2 },
  divider: { width: 1, height: 28 },
  note: { fontSize: 9, fontFamily: 'Inter_400Regular', marginTop: 10, fontStyle: 'italic', lineHeight: 13 },
});