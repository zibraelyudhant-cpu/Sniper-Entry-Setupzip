import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { STATUS_COLORS, StatusKey } from '@/constants/theme';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

/**
 * Badge status seragam dipakai di semua menu (BAGUS/MENDEKATI/WAITING/SIAP BREAKOUT/EXPIRED).
 * Warna sengaja netral (bukan hijau/merah) biar gak ketuker sama makna bullish/bearish.
 * MENDEKATI dan SIAP BREAKOUT punya animasi pulse halus buat narik perhatian.
 */
export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const cfg = STATUS_COLORS[status as StatusKey] ?? STATUS_COLORS.skip;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!cfg.pulse) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.55, duration: 750, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [cfg.pulse, pulseAnim]);

  const isSmall = size === 'sm';

  return (
    <Animated.View
      style={[
        styles.badge,
        isSmall && styles.badgeSm,
        { backgroundColor: cfg.bg, borderColor: cfg.border, opacity: cfg.pulse ? pulseAnim : 1 },
      ]}
    >
      <Feather name={cfg.icon} size={isSmall ? 9 : 11} color={cfg.text} />
      <Text style={[styles.text, isSmall && styles.textSm, { color: cfg.text }]}>{cfg.label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 9,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  badgeSm: { paddingHorizontal: 7, paddingVertical: 3, gap: 3 },
  text: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.4 },
  textSm: { fontSize: 9 },
});