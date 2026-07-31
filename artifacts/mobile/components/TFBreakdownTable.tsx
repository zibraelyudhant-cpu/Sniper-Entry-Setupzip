import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

interface TFBreakdownItem {
  timeframe: string;
  label: string;
  detail: string;
  status: 'confirm' | 'warning' | 'neutral';
}

/**
 * Breakdown per-timeframe — sebelumnya info per-TF ke-selip di dalam teks
 * filterResults/probabilityFactors, harus baca satu-satu. Sekarang tabel jelas:
 * TF apa → ngecek apa → hasilnya gimana, biar user langsung liat TF mana yang
 * kuat/lemah tanpa perlu nyari-nyari di teks panjang.
 */
export function TFBreakdownTable({ items, accentColor }: {
  items?: TFBreakdownItem[];
  accentColor: string;
}) {
  const colors = useColors();
  if (!items || items.length === 0) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: accentColor }]}>🔍 BREAKDOWN PER-TIMEFRAME</Text>
      {items.map((item, i) => {
        const iconColor = item.status === 'confirm' ? colors.bullish : item.status === 'warning' ? colors.gold : colors.mutedForeground;
        const iconName = item.status === 'confirm' ? 'check-circle' : item.status === 'warning' ? 'alert-circle' : 'circle';
        return (
          <View key={i} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={[styles.tfBadge, { backgroundColor: `${accentColor}18` }]}>
              <Text style={[styles.tfBadgeText, { color: accentColor }]}>{item.timeframe}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.labelRow}>
                <Feather name={iconName as any} size={12} color={iconColor} />
                <Text style={[styles.label, { color: colors.foreground }]}>{item.label}</Text>
              </View>
              <Text style={[styles.detail, { color: colors.mutedForeground }]}>{item.detail}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 10 },
  title: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 0.3, marginBottom: 10 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 8, alignItems: 'flex-start' },
  tfBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, minWidth: 40, alignItems: 'center' },
  tfBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  detail: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2, lineHeight: 15 },
});