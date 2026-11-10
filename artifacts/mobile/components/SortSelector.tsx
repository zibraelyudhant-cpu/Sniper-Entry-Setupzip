import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { wrSelisihOf } from '@/components/wrStore';

/**
 * Tombol sortir buat semua Menu Scan (request user — samain persis 3 kolom
 * yang ada di Binance Futures market list: "Kontrak/Vol" default, "Perubahan
 * 24j", "Tingkat 8j" (funding rate)). Data (priceChangePercent, quoteVolume,
 * fundingRate) itu dari field marketMeta yang di-attach backend — sortirnya
 * sendiri dikerjain CLIENT-SIDE (data udah lengkap, gak perlu fetch ulang).
 */
export type SortKey = 'default' | 'skor' | 'selisihWr' | 'volume' | 'priceChange' | 'fundingRate';

export interface MarketMeta {
  priceChangePercent: number;
  quoteVolume: number;
  fundingRate: number | null;
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'default', label: 'Default' },
  { key: 'skor', label: 'Skor TA PRO' },
  { key: 'selisihWr', label: 'Selisih WR' },
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
export function SortSelector({ value, onChange, wrProgress }: { value: SortKey; onChange: (key: SortKey) => void; wrProgress?: { done: number; total: number } | null }) {
  const colors = useColors();
  return (
    <>
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
    {value === 'selisihWr' && (
      <Text style={{ fontSize: 10, color: colors.mutedForeground, marginBottom: 8 }}>
        Urut dari selisih WR backtest (WR − impas) terbesar. {wrProgress && wrProgress.done < wrProgress.total ? `Menghitung WR ${wrProgress.done}/${wrProgress.total}…` : 'Koin tanpa entry/SL/TP atau gagal dihitung di paling bawah.'}
      </Text>
    )}
    </>
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
/**
 * Skor TA PRO sisi yang SEARAH sinyal (bullish -> LONG, bearish -> SHORT), dari `taPro` yang dibekukan server
 * saat sinyal dibuat. null kalau koin itu belum punya skor (mis. status waiting / data lama).
 */
export function taProScoreOf(item: any): { score: number; grade: 'A+' | 'B' | 'Tidak layak'; max: number } | null {
  const snap = item?.taPro;
  if (!snap?.long || !snap?.short) return null;
  const side = item?.bias === 'bearish' ? snap.short : snap.long;
  return typeof side?.score === 'number' ? { score: side.score, grade: side.grade, max: typeof snap.maxScore === 'number' ? snap.maxScore : 9 } : null;
}

export function applySorting<T>(items: T[], sortKey: SortKey, getMeta: (item: T) => MarketMeta | null | undefined): T[] {
  if (sortKey === 'default') return items;
  const sorted = [...items];
  if (sortKey === 'skor') {
    // skor tertinggi dulu; yang belum punya skor di paling bawah; seri = urutan asli (sort stabil)
    sorted.sort((a, b) => (taProScoreOf(b)?.score ?? -99) - (taProScoreOf(a)?.score ?? -99));
    return sorted;
  }
  if (sortKey === 'selisihWr') {
    // selisih WR (WR backtest − impas) terbesar dulu; belum dihitung / gagal / tanpa entry di paling bawah; seri = urutan asli
    sorted.sort((a, b) => (wrSelisihOf(b) ?? -999) - (wrSelisihOf(a) ?? -999));
    return sorted;
  }
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