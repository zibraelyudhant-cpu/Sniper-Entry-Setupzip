import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/**
 * Tombol sortir buat semua Menu Scan (request user — samain persis 3 kolom
 * yang ada di Binance Futures market list: "Kontrak/Vol" default, "Perubahan
 * 24j", "Tingkat 8j" (funding rate)). Data (priceChangePercent, quoteVolume,
 * fundingRate) itu dari field marketMeta yang di-attach backend — sortirnya
 * sendiri dikerjain CLIENT-SIDE (data udah lengkap, gak perlu fetch ulang).
 */
export type SortKey = 'default' | 'volume' | 'priceChange' | 'fundingRate';

export interface MarketMeta {
  priceChangePercent: number;
  quoteVolume: number;
  fundingRate: number | null;
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'default', label: 'Default' },
  { key: 'volume', label: 'Volume' },
  { key: 'priceChange', label: 'Perubahan 24j' },
  { key: 'fundingRate', label: 'Funding Rate' },
];

export function SortSelector({ value, onChange }: { value: SortKey; onChange: (key: SortKey) => void }) {
  const colors = useColors();
  return (
    <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {SORT_OPTIONS.map(opt => {
        const active = value === opt.key;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            style={[styles.chip, { backgroundColor: active ? colors.foreground : colors.card, borderColor: active ? colors.foreground : colors.border }]}
          >
            {opt.key !== 'default' && <Feather name="arrow-down" size={10} color={active ? colors.background : colors.mutedForeground} />}
            <Text style={[styles.chipText, { color: active ? colors.background : colors.mutedForeground }]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * Sortir array koin berdasarkan SortKey. `getMeta` extractor biar reusable
 * buat 3 tipe hasil scan beda (ScalpingResult/BreakoutTradingResult/
 * MultiTFScanCoin) — semua punya field marketMeta yang BARU di-attach
 * backend, TAPI di-cast manual di tiap caller (belum ada di generated types).
 * 'default' artinya GAK diurutin ulang (biarin urutan asli dari backend,
 * yang udah berarti prioritas: in_zone > approaching > waiting, dst).
 */
export function applySorting<T>(items: T[], sortKey: SortKey, getMeta: (item: T) => MarketMeta | null | undefined): T[] {
  if (sortKey === 'default') return items;
  const sorted = [...items];
  sorted.sort((a, b) => {
    const metaA = getMeta(a);
    const metaB = getMeta(b);
    if (sortKey === 'volume') return (metaB?.quoteVolume ?? 0) - (metaA?.quoteVolume ?? 0);
    if (sortKey === 'priceChange') return (metaB?.priceChangePercent ?? 0) - (metaA?.priceChangePercent ?? 0);
    // fundingRate — null ditaruh paling belakang (gak ada data), bukan dianggap 0
    const fa = metaA?.fundingRate, fb = metaB?.fundingRate;
    if (fa === null || fa === undefined) return 1;
    if (fb === null || fb === undefined) return -1;
    return fb - fa;
  });
  return sorted;
}

const styles = StyleSheet.create({
  row: { gap: 6, paddingBottom: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1,
  },
  chipText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
});