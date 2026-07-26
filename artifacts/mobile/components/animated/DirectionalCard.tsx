import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { DIRECTION_COLORS } from '@/constants/theme';

interface DirectionalCardProps {
  bias?: 'bullish' | 'bearish';
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
}

/**
 * Wrapper kartu yang otomatis nge-tint background & border sesuai bias.
 * Long/bullish = nuansa hijau, short/bearish = nuansa merah — bukan cuma
 * dot kecil, tapi keseluruhan kartu ikut arah biar sekilas langsung kebaca.
 * Kalau bias gak ada (misal status 'ready' yang belum tentu arah), fallback netral.
 */
export function DirectionalCard({ bias, children, style }: DirectionalCardProps) {
  const colors = bias ? DIRECTION_COLORS[bias] : null;

  return (
    <View
      style={[
        styles.card,
        style,
        colors
          ? { backgroundColor: colors.bg, borderColor: colors.border }
          : { backgroundColor: '#0B0F16', borderColor: '#1C2431' },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
});