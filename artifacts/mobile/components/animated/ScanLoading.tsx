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
  const pulseOpacity = useRef(new Animated.Value(1)).current;
  const [strokeOffset, setStrokeOffset] = useState(CIRCUMFERENCE);
  const [pct, setPct] = useState(0);
  const [nearlyDone, setNearlyDone] = useState(false);
  const [coinIdx, setCoinIdx] = useState(0);
  const defaultCoins = coins ?? ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'INJUSDT', 'XRPUSDT'];

  useEffect(() => {
    const listener = progress.addListener(({ value }) => {
      setStrokeOffset(CIRCUMFERENCE - CIRCUMFERENCE * value);
      setPct(Math.round(value * 100));
      if (value >= 0.985) setNearlyDone(true);
    });
    // FIX: sebelumnya naik sekali ke 92% terus BERHENTI TOTAL nunggu response —
    // kerasa "macet" kalau scan-nya lebih lama dari 3.5 detik (umum buat scan 50
    // koin). Sekarang 2 fase: (1) naik cepat ke 75% dulu (kerasa responsif),
    // (2) creep PELAN TERUS-MENERUS ke 99% (gak pernah benar-benar diem). Begitu
    // data beneran datang, parent langsung unmount komponen ini & ganti hasil asli.
    Animated.sequence([
      Animated.timing(progress, {
        toValue: 0.75,
        duration: 1800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(progress, {
        toValue: 0.99,
        duration: 25_000, // creep pelan, nutupin scan yang lebih lama dari biasa
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    ]).start();

    const coinTimer = setInterval(() => {
      setCoinIdx(i => (i + 1) % defaultCoins.length);
    }, 450);

    return () => {
      progress.removeListener(listener);
      clearInterval(coinTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Efek "napas" begitu deket 99% dan masih nunggu lama — biar tetep keliatan
  // "masih proses", walau angkanya udah gak naik lagi.
  useEffect(() => {
    if (!nearlyDone) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseOpacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [nearlyDone, pulseOpacity]);

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
          <Animated.Text style={[styles.pctText, { color: accent, opacity: nearlyDone ? pulseOpacity : 1 }]}>{pct}%</Animated.Text>
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