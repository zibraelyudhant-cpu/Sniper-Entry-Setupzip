import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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

// FIX BUG KRUSIAL (ketemu user — "klik Volume berhasil, abis itu klik yang
// lain gak bisa semua"): SEBELUMNYA ini dibungkus <ScrollView horizontal>,
// yang berarti NESTED SCROLL (ScrollView horizontal DI DALAM ScrollView
// vertikal parent-nya). Nested scroll gesture itu KNOWN ISSUE di React
// Native Web/Expo — abis scroll/tap PERTAMA, gesture recognizer sering
// "salah klaim" sentuhan berikutnya sebagai SCROLL bukan TAP, jadi onPress
// gak ke-trigger lagi. FIX: ganti jadi View biasa + flexWrap — cuma 4 opsi
// pendek, GAK PERLU scroll horizontal sama sekali, jadi masalah nested-
// scroll-conflict-nya HILANG TOTAL (bukan di-patch, tapi dihindarin).
export function SortSelector({ value, onChange }: { value: SortKey; onChange: (key: SortKey) => void }) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      {SORT_OPTIONS.map(opt => {
        const active = value === opt.key;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            hitSlop={4}
            style={[styles.chip, { backgroundColor: active ? colors.foreground : colors.card, borderColor: active ? colors.foreground : colors.border }]}
          >
            {opt.key !== 'default' && <Feather name="arrow-down" size={10} color={active ? colors.background : colors.mutedForeground} />}
            <Text style={[styles.chipText, { color: active ? colors.background : colors.mutedForeground }]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
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
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1,
  },
  chipText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
});