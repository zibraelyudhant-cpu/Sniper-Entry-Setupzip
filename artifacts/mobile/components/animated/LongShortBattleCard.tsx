import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

interface LongShortBattleCardProps {
  status: 'ok' | 'no_breakout';
  breakoutDirection: 'bullish' | 'bearish' | null;
  brokenLevel: number | null;
  score: number;
  classification: string | null;
  breakdown: string[];
  btcBreakoutDirection: 'bullish' | 'bearish' | null;
  btcSearah: boolean;
}

const CYAN = '#00FFF0';
const MAGENTA = '#FF00E5';
const GOLD = '#FFD700';
const NEUTRAL = '#5B6478';

/**
 * Kartu Fitur 5 (Skor Long vs Short) -- REVISI TOTAL: sekarang terhubung ke
 * breakout M15 aktif (bukan analisa 3-TF mandiri lagi). Nampilin status
 * breakout, skor+klasifikasi (Kuat/Lemah), breakdown lengkap semua poin,
 * dan status korelasi BTC.
 */
export function LongShortBattleCard({
  status, breakoutDirection, brokenLevel, score, classification, breakdown, btcBreakoutDirection, btcSearah,
}: LongShortBattleCardProps) {
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.96)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const scoreScale = useRef(new Animated.Value(0.6)).current;
  const scoreOpacity = useRef(new Animated.Value(0)).current;

  const isKuat = classification?.includes('Kuat') ?? false;
  const color = breakoutDirection === 'bullish' ? CYAN : breakoutDirection === 'bearish' ? MAGENTA : NEUTRAL;
  const accentColor = status === 'ok' && isKuat ? GOLD : color;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(cardOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(cardScale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 6 }),
    ]).start();

    if (status === 'ok') {
      Animated.sequence([
        Animated.delay(200),
        Animated.parallel([
          Animated.spring(scoreScale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 10 }),
          Animated.timing(scoreOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        ]),
      ]).start();

      const glowLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 1200, delay: 500, useNativeDriver: false }),
          Animated.timing(glow, { toValue: 0, duration: 1200, useNativeDriver: false }),
        ])
      );
      glowLoop.start();
      return () => glowLoop.stop();
    }
  }, [status]);

  const shadowRadius = glow.interpolate({ inputRange: [0, 1], outputRange: [6, 18] });

  if (status === 'no_breakout') {
    return (
      <Animated.View style={[styles.card, styles.noBreakoutCard, { opacity: cardOpacity, transform: [{ scale: cardScale }] }]}>
        <Feather name="activity" size={22} color={NEUTRAL} />
        <Text style={styles.noBreakoutTitle}>GAK ADA BREAKOUT M15 AKTIF</Text>
        <Text style={styles.noBreakoutSub}>
          Fitur 5 butuh breakout M15 fresh (swing + volume≥2x MA20) buat ngitung skor. Coba lagi nanti atau cek koin lain.
        </Text>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: cardOpacity,
          transform: [{ scale: cardScale }],
          borderColor: `${accentColor}60`,
          shadowColor: accentColor,
          shadowOpacity: 0.5,
          shadowRadius,
          shadowOffset: { width: 0, height: 0 },
        },
      ]}
    >
      <View style={styles.titleRow}>
        <Text style={styles.title}>// SKOR LONG VS SHORT</Text>
      </View>

      <View style={styles.headerRow}>
        <View style={styles.dirBadge}>
          <Feather name={breakoutDirection === 'bullish' ? 'trending-up' : 'trending-down'} size={16} color={color} />
          <Text style={[styles.dirText, { color }]}>
            BREAKOUT {breakoutDirection === 'bullish' ? 'RESISTANCE (LONG)' : 'SUPPORT (SHORT)'}
          </Text>
        </View>
        {brokenLevel !== null && (
          <Text style={styles.levelText}>@ {brokenLevel.toFixed(6)}</Text>
        )}
      </View>

      <View style={styles.scoreRow}>
        <Animated.Text
          style={[
            styles.scoreNum,
            {
              color: accentColor, opacity: scoreOpacity, transform: [{ scale: scoreScale }],
              textShadowColor: accentColor, textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 },
            },
          ]}
        >
          {score >= 0 ? '+' : ''}{score}
        </Animated.Text>
        <View style={[styles.classBadge, { backgroundColor: `${accentColor}22`, borderColor: `${accentColor}60` }]}>
          <Text style={[styles.classText, { color: accentColor }]}>{classification?.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.breakdownList}>
        {breakdown.map((line, i) => (
          <Text key={i} style={styles.breakdownLine}>· {line}</Text>
        ))}
      </View>

      <View style={[styles.btcRow, { borderColor: btcSearah ? `${GOLD}60` : 'rgba(255,255,255,0.08)' }]}>
        <Feather name="link" size={13} color={btcSearah ? GOLD : NEUTRAL} />
        <Text style={[styles.btcText, { color: btcSearah ? GOLD : NEUTRAL }]}>
          {btcBreakoutDirection === null
            ? 'BTC gak lagi breakout M15'
            : `BTC breakout ${btcBreakoutDirection} -- ${btcSearah ? 'SEARAH (+1)' : 'gak searah (+0)'}`}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0D0518',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
  },
  noBreakoutCard: { alignItems: 'center', gap: 8, paddingVertical: 28 },
  noBreakoutTitle: { color: '#8B7A9E', fontSize: 12, fontFamily: 'Courier', fontWeight: '700', letterSpacing: 1 },
  noBreakoutSub: { color: '#5B6478', fontSize: 12, textAlign: 'center', lineHeight: 17, paddingHorizontal: 12 },
  titleRow: { alignItems: 'center', marginBottom: 12 },
  title: { color: '#00FFF0', fontSize: 10, fontFamily: 'Courier', letterSpacing: 1.5, fontWeight: '700' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  dirBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dirText: { fontSize: 12, fontFamily: 'Courier', fontWeight: '700', letterSpacing: 0.3 },
  levelText: { color: '#8B7A9E', fontSize: 11, fontFamily: 'Courier' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  scoreNum: { fontSize: 36, fontFamily: 'Courier', fontWeight: '700' },
  classBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  classText: { fontSize: 12, fontFamily: 'Courier', fontWeight: '700', letterSpacing: 0.5 },
  breakdownList: { gap: 3, marginBottom: 12 },
  breakdownLine: { color: '#B8AEC9', fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  btcRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, padding: 10 },
  btcText: { fontSize: 11.5, fontFamily: 'Inter_500Medium' },
});