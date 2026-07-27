import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface BacktestLoadingProps {
  totalCandles: number;
  accentColor?: string;
}

/**
 * Loading khusus backtest — beda dari scan loading biasa. Nunjukin progress
 * "ngolah data historis": jumlah candle terproses, tanggal berjalan maju,
 * dan 3 statistik yang keisi bertahap seolah lagi ngitung beneran.
 */
export function BacktestLoading({ totalCandles, accentColor }: BacktestLoadingProps) {
  const colors = useColors();
  const accent = accentColor ?? colors.primary;
  const progress = useRef(new Animated.Value(0)).current;
  const pulseOpacity = useRef(new Animated.Value(1)).current;
  const [pct, setPct] = useState(0);
  const [candlesProcessed, setCandlesProcessed] = useState(0);
  const [trades, setTrades] = useState(0);
  const [winRate, setWinRate] = useState(0);
  const [nearlyDone, setNearlyDone] = useState(false);

  useEffect(() => {
    const listener = progress.addListener(({ value }) => {
      setPct(Math.round(value * 100));
      setCandlesProcessed(Math.round(totalCandles * value));
      setTrades(Math.round(value * 23));
      setWinRate(Math.round(value * 78));
      if (value >= 0.985) setNearlyDone(true);
    });

    // FIX: progress sebelumnya berhenti total di 92% dan diem lama nunggu response
    // (kerasa "macet"). Sekarang 2 fase: (1) naik cepat ke 85% — kerasa responsif,
    // (2) creep PELAN TERUS-MENERUS dari 85% ke 99% selama durasi panjang (linear,
    // gak pernah benar-benar berhenti) — jadi kapan pun user liat, progress masih
    // keliatan jalan dikit, bukan freeze di angka statis. 99% (bukan 100%) sengaja
    // disisain — begitu response API beneran datang, parent langsung ganti ke hasil
    // asli, gak nunggu angka sempet nyampe 100 dulu.
    Animated.sequence([
      Animated.timing(progress, {
        toValue: 0.85,
        duration: Math.max(2500, Math.min(6000, totalCandles * 0.4)),
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(progress, {
        toValue: 0.99,
        duration: 90_000, // creep sangat pelan, nutupin backtest yang lama (3 tahun dll)
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    ]).start();

    return () => {
      progress.removeListener(listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalCandles]);

  // Begitu deket 99% dan mentok nunggu lama, kasih efek "napas" (breathing) di teks
  // persen — biar tetep keliatan "masih hidup/proses", walau angkanya udah gak naik.
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
    <View style={[styles.box, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.label, { color: accent }]}>MEMPROSES DATA H4</Text>
        <Animated.Text style={[styles.pct, { color: accent, opacity: nearlyDone ? pulseOpacity : 1 }]}>{pct}%</Animated.Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.background }]}>
        <Animated.View style={[styles.fill, { width: `${pct}%`, backgroundColor: accent, opacity: nearlyDone ? pulseOpacity : 1 }]} />
      </View>
      <Text style={[styles.subLabel, { color: colors.mutedForeground }]}>
        {candlesProcessed.toLocaleString('id-ID')} / {totalCandles.toLocaleString('id-ID')} candle
      </Text>
      <View style={styles.statsRow}>
        <View style={[styles.stat, { backgroundColor: colors.background }]}>
          <Text style={[styles.statVal, { color: colors.foreground }]}>{trades}</Text>
          <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>SINYAL</Text>
        </View>
        <View style={[styles.stat, { backgroundColor: colors.background }]}>
          <Text style={[styles.statVal, { color: colors.bullish }]}>{winRate}%</Text>
          <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>WIN RATE</Text>
        </View>
        <View style={[styles.stat, { backgroundColor: colors.background }]}>
          <Text style={[styles.statVal, { color: colors.gold }]}>1:{(1.5 + pct / 60).toFixed(1)}</Text>
          <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>AVG R:R</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 4 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  label: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5 },
  pct: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  subLabel: { fontSize: 9, fontFamily: 'Inter_400Regular', marginTop: 4, marginBottom: 14 },
  statsRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, borderRadius: 9, padding: 9, alignItems: 'center' },
  statVal: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  statLbl: { fontSize: 8, fontFamily: 'Inter_500Medium', marginTop: 2, letterSpacing: 0.5 },
});