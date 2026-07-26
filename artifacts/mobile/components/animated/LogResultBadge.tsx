import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

interface LogResultBadgeProps {
  status: 'pending' | 'win_tp1' | 'win_tp2' | 'lose' | 'expired';
}

const CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending: { label: 'PENDING', color: '#94A3B8', bg: 'rgba(148,163,184,.1)', border: 'rgba(148,163,184,.25)' },
  win_tp1: { label: 'WIN TP1', color: '#4ADE80', bg: 'rgba(74,222,128,.15)', border: 'rgba(74,222,128,.4)' },
  win_tp2: { label: 'WIN TP2', color: '#4ADE80', bg: 'rgba(74,222,128,.15)', border: 'rgba(74,222,128,.4)' },
  lose: { label: 'LOSE', color: '#F87171', bg: 'rgba(248,113,113,.1)', border: 'rgba(248,113,113,.3)' },
  expired: { label: 'EXPIRED', color: '#6B7280', bg: 'rgba(107,114,128,.1)', border: 'rgba(107,114,128,.2)' },
};

/**
 * Badge status hasil log — sengaja dibedain treatment-nya:
 * WIN dapet efek "reward" ringan (glow + bounce sekali pas muncul),
 * LOSE dibikin tenang/informatif aja (fade biasa, tanpa efek "seru").
 * Ini disengaja biar app gak kerasa kayak judi — menang gak dirayain
 * berlebihan, kalah gak bikin penasaran buat coba lagi.
 */
export function LogResultBadge({ status }: LogResultBadgeProps) {
  const cfg = CONFIG[status] ?? CONFIG.pending;
  const isWin = status === 'win_tp1' || status === 'win_tp2';
  const scale = useRef(new Animated.Value(isWin ? 0.7 : 1)).current;
  const opacity = useRef(new Animated.Value(status === 'pending' ? 1 : 0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (status === 'pending') return;
    if (isWin) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 4, tension: 120 }),
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 250, useNativeDriver: false }),
          Animated.timing(glow, { toValue: 0, duration: 500, useNativeDriver: false }),
        ]),
      ]).start();
    } else {
      // LOSE / EXPIRED: fade tenang, gak ada bounce/glow
      Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const shadowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.8] });

  return (
    <Animated.View
      style={[
        styles.badge,
        {
          backgroundColor: cfg.bg,
          borderColor: cfg.border,
          opacity,
          transform: [{ scale }],
          shadowColor: cfg.color,
          shadowOpacity: isWin ? shadowOpacity : 0,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 0 },
        },
      ]}
    >
      <Text style={[styles.text, { color: cfg.color }]}>{cfg.label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  text: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
});