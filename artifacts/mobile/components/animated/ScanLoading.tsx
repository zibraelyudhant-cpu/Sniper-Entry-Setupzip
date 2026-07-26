import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';

interface ScanLoadingProps {
  label?: string;
  accentColor?: string;
  coins?: string[];
}

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Loading buat scan — ring progress animasi (bukan spinner generik) + label
 * koin yang lagi "dipindai" berganti-ganti biar kerasa app-nya aktif kerja.
 */
export function ScanLoading({ label = 'MENGANALISA...', accentColor, coins }: ScanLoadingProps) {
  const colors = useColors();
  const accent = accentColor ?? colors.primary;
  const progress = useRef(new Animated.Value(0)).current;
  const [strokeOffset, setStrokeOffset] = useState(CIRCUMFERENCE);
  const [pct, setPct] = useState(0);
  const [coinIdx, setCoinIdx] = useState(0);
  const defaultCoins = coins ?? ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'INJUSDT', 'XRPUSDT'];

  useEffect(() => {
    const listener = progress.addListener(({ value }) => {
      setStrokeOffset(CIRCUMFERENCE - CIRCUMFERENCE * value);
      setPct(Math.round(value * 100));
    });
    // Naik sekali aja menuju ~92% pakai easing yang melambat (bukan loop 0→100→0 terus-terusan).
    // Berhenti di situ nunggu data beneran datang — pas parent selesai loading,
    // komponen ini otomatis di-unmount & diganti hasil asli, gak perlu nunggu "100%".
    Animated.timing(progress, {
      toValue: 0.92,
      duration: 3500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    const coinTimer = setInterval(() => {
      setCoinIdx(i => (i + 1) % defaultCoins.length);
    }, 450);

    return () => {
      progress.removeListener(listener);
      clearInterval(coinTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.ringWrap}>
        <Svg width={64} height={64} viewBox="0 0 64 64">
          <Circle cx={32} cy={32} r={RADIUS} stroke="#0F1620" strokeWidth={4} fill="none" />
          <Circle
            cx={32}
            cy={32}
            r={RADIUS}
            stroke={accent}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={strokeOffset}
            transform="rotate(-90 32 32)"
          />
        </Svg>
        <View style={styles.pctWrap}>
          <Text style={[styles.pctText, { color: accent }]}>{pct}%</Text>
        </View>
      </View>
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <Text style={[styles.coin, { color: colors.mutedForeground }]}>
        memindai {defaultCoins[coinIdx]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  ringWrap: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  pctWrap: { position: 'absolute' },
  pctText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5, marginTop: 4 },
  coin: { fontSize: 11, fontFamily: 'Inter_400Regular' },
});