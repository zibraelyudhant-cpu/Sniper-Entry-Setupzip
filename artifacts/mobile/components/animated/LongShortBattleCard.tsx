import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Polygon } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';

interface LongShortBattleCardProps {
  d1Score: number;
  d1Direction: 'long' | 'short';
  h4Score: number;
  h4Direction: 'long' | 'short';
  winner: 'long' | 'short' | 'neutral';
  summary: string;
}

const CYAN = '#00FFF0';
const MAGENTA = '#FF00E5';

/**
 * Kartu "battle" buat Fitur 5 (Skor Long vs Short) -- tema cyberpunk (grid
 * garis tipis, glow neon cyan/magenta, badge VS yang muter+pop, ledakan
 * partikel, kartu pemenang yang "slam" masuk dengan border yang napas).
 * Disetujui user dari serangkaian mockup visual sebelum diimplementasi.
 */
export function LongShortBattleCard({ d1Score, d1Direction, h4Score, h4Direction, winner, summary }: LongShortBattleCardProps) {
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.95)).current;
  const barLeft = useRef(new Animated.Value(0)).current;
  const barRight = useRef(new Animated.Value(0)).current;
  const vsScale = useRef(new Animated.Value(0)).current;
  const vsRotate = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(0.8)).current;
  const ringOpacity = useRef(new Animated.Value(0.8)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const glowD1 = useRef(new Animated.Value(0)).current;
  const glowH4 = useRef(new Animated.Value(0)).current;
  const winnerOpacity = useRef(new Animated.Value(0)).current;
  const winnerTranslateX = useRef(new Animated.Value(-8)).current;
  const winnerGlow = useRef(new Animated.Value(0)).current;
  const particles = useRef(Array.from({ length: 4 }, () => new Animated.Value(0))).current;

  const maxScore = Math.max(d1Score, h4Score, 1);
  const leftPct = (d1Score / (d1Score + h4Score || 1)) * 100;
  const rightPct = 100 - leftPct;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(cardOpacity, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.spring(cardScale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 6 }),
    ]).start();

    Animated.timing(barLeft, { toValue: leftPct, duration: 900, delay: 200, useNativeDriver: false }).start();
    Animated.timing(barRight, { toValue: rightPct, duration: 900, delay: 200, useNativeDriver: false }).start();

    // Badge VS: masuk lalu goyang terus
    Animated.sequence([
      Animated.delay(900),
      Animated.spring(vsScale, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 14 }),
    ]).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(vsRotate, { toValue: 1, duration: 1000, useNativeDriver: true }),
          Animated.timing(vsRotate, { toValue: -1, duration: 1000, useNativeDriver: true }),
          Animated.timing(vsRotate, { toValue: 0, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
    });

    // Ring + flash + partikel, diulang tiap beberapa detik
    const burst = () => {
      ringScale.setValue(0.8);
      ringOpacity.setValue(0.8);
      flash.setValue(0);
      particles.forEach(p => p.setValue(0));
      Animated.parallel([
        Animated.timing(ringScale, { toValue: 1.8, duration: 900, useNativeDriver: true }),
        Animated.timing(ringOpacity, { toValue: 0, duration: 900, useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(flash, { toValue: 1, duration: 80, useNativeDriver: true }),
          Animated.timing(flash, { toValue: 0, duration: 500, useNativeDriver: true }),
        ]),
        Animated.stagger(30, particles.map(p => Animated.timing(p, { toValue: 1, duration: 800, useNativeDriver: true }))),
      ]).start();
    };
    const burstTimeout = setTimeout(burst, 900);
    const burstInterval = setInterval(burst, 4000);

    // Glow pulse angka (loop terus)
    const glowLoop = (val: Animated.Value, dur: number) => Animated.loop(
      Animated.sequence([
        Animated.timing(val, { toValue: 1, duration: dur, useNativeDriver: false }),
        Animated.timing(val, { toValue: 0, duration: dur, useNativeDriver: false }),
      ])
    );
    const d1Loop = glowLoop(glowD1, 1200);
    const h4Loop = glowLoop(glowH4, 1000);
    d1Loop.start();
    h4Loop.start();

    // Kartu pemenang: slam masuk lalu border napas
    Animated.sequence([
      Animated.delay(1000),
      Animated.parallel([
        Animated.timing(winnerOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.spring(winnerTranslateX, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 10 }),
      ]),
    ]).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(winnerGlow, { toValue: 1, duration: 900, useNativeDriver: false }),
          Animated.timing(winnerGlow, { toValue: 0, duration: 900, useNativeDriver: false }),
        ])
      ).start();
    });

    return () => { clearTimeout(burstTimeout); clearInterval(burstInterval); d1Loop.stop(); h4Loop.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const winnerColor = winner === 'long' ? '#00D09C' : winner === 'short' ? MAGENTA : '#5B6478';
  const vsRotateDeg = vsRotate.interpolate({ inputRange: [-1, 1], outputRange: ['-6deg', '6deg'] });
  const d1TextShadow = glowD1.interpolate({ inputRange: [0, 1], outputRange: [6, 16] });
  const h4TextShadow = glowH4.interpolate({ inputRange: [0, 1], outputRange: [8, 20] });
  const winnerShadowRadius = winnerGlow.interpolate({ inputRange: [0, 1], outputRange: [8, 20] });

  return (
    <Animated.View style={[styles.card, { opacity: cardOpacity, transform: [{ scale: cardScale }] }]}>
      {/* Grid tipis dekoratif */}
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        {Array.from({ length: 8 }, (_, i) => (
          <Line key={`v${i}`} x1={i * 40} y1={0} x2={i * 40} y2={200} stroke={MAGENTA} strokeOpacity={0.06} strokeWidth={1} />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <Line key={`h${i}`} x1={0} y1={i * 40} x2={320} y2={i * 40} stroke={CYAN} strokeOpacity={0.05} strokeWidth={1} />
        ))}
      </Svg>

      <View style={styles.titleRow}>
        <Text style={styles.title}>// SKOR LONG VS SHORT</Text>
      </View>

      <View style={styles.battleRow}>
        <View style={styles.sideCol}>
          <Text style={[styles.sideLabel, { color: CYAN }]}>D1</Text>
          <Animated.Text style={[styles.sideNum, { color: CYAN, textShadowColor: CYAN, textShadowRadius: d1TextShadow, textShadowOffset: { width: 0, height: 0 } }]}>
            {d1Score}
          </Animated.Text>
          <Text style={[styles.sideSub, { color: CYAN }]}>{d1Direction.toUpperCase()}</Text>
        </View>

        <View style={styles.barTrack}>
          <Animated.View style={[styles.barSeg, { width: barLeft.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]}>
            <LinearGradient colors={['#00A8A0', CYAN]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
          <Animated.View style={[styles.barSeg, { width: barRight.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]}>
            <LinearGradient colors={['#B300A0', MAGENTA]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          </Animated.View>
        </View>

        <View style={styles.sideCol}>
          <Text style={[styles.sideLabel, { color: MAGENTA }]}>H4</Text>
          <Animated.Text style={[styles.sideNum, { color: MAGENTA, textShadowColor: MAGENTA, textShadowRadius: h4TextShadow, textShadowOffset: { width: 0, height: 0 } }]}>
            {h4Score}
          </Animated.Text>
          <Text style={[styles.sideSub, { color: MAGENTA }]}>{h4Direction.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.vsZone}>
        <Animated.View
          pointerEvents="none"
          style={[styles.flash, { opacity: flash }]}
        />
        <Animated.View
          pointerEvents="none"
          style={[styles.ring, { transform: [{ scale: ringScale }], opacity: ringOpacity }]}
        />
        {particles.map((p, i) => {
          const angle = (i / particles.length) * Math.PI * 2;
          const tx = p.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(angle) * 26] });
          const ty = p.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(angle) * 26 - 10] });
          const pOpacity = p.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] });
          return (
            <Animated.View
              key={i}
              pointerEvents="none"
              style={[styles.particle, { backgroundColor: i % 2 === 0 ? CYAN : MAGENTA, opacity: pOpacity, transform: [{ translateX: tx }, { translateY: ty }] }]}
            />
          );
        })}
        <Animated.View style={[styles.vsBadgeWrap, { transform: [{ scale: vsScale }, { rotate: vsRotateDeg }] }]}>
          <Svg width={34} height={34} viewBox="0 0 34 34" style={StyleSheet.absoluteFill}>
            <Polygon points="7,0 34,0 27,34 0,34" fill={CYAN} />
          </Svg>
          <LinearGradient colors={[CYAN, MAGENTA]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.vsBadge}>
            <Text style={styles.vsText}>VS</Text>
          </LinearGradient>
        </Animated.View>
      </View>

      <Animated.View
        style={[
          styles.winnerCard,
          {
            opacity: winnerOpacity,
            transform: [{ translateX: winnerTranslateX }],
            borderColor: `${winnerColor}90`,
            shadowColor: winnerColor,
            shadowRadius: winnerShadowRadius,
            shadowOpacity: 0.6,
            shadowOffset: { width: 0, height: 0 },
          },
        ]}
      >
        <View style={[styles.winnerIcon, { backgroundColor: `${winnerColor}25`, borderColor: `${winnerColor}60` }]}>
          <Feather name={winner === 'long' ? 'trending-up' : 'trending-down'} size={17} color={winnerColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.winnerLabel, { color: winnerColor }]}>
            {winner === 'neutral' ? 'NETRAL' : `${winner.toUpperCase()} MENANG`}
          </Text>
          <Text style={styles.winnerSummary}>{summary}</Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0D0518',
    borderWidth: 1,
    borderColor: 'rgba(255,0,229,0.25)',
    borderRadius: 14,
    padding: 18,
    overflow: 'hidden',
  },
  titleRow: { alignItems: 'center', marginBottom: 18 },
  title: { color: '#00FFF0', fontSize: 10, fontFamily: 'Courier', letterSpacing: 3, fontWeight: '700' },
  battleRow: { flexDirection: 'row', alignItems: 'center' },
  sideCol: { width: 78, alignItems: 'center' },
  sideLabel: { fontSize: 11, fontFamily: 'Courier', fontWeight: '700', marginBottom: 4 },
  sideNum: { fontSize: 28, fontFamily: 'Courier', fontWeight: '700' },
  sideSub: { fontSize: 9, marginTop: 2, opacity: 0.8, fontWeight: '600' },
  barTrack: {
    flex: 1, height: 10, backgroundColor: '#160A20', borderRadius: 0,
    overflow: 'hidden', flexDirection: 'row', marginHorizontal: 10,
    borderWidth: 1, borderColor: 'rgba(255,0,229,0.2)',
  },
  barSeg: { height: '100%' },
  vsZone: { alignItems: 'center', justifyContent: 'center', height: 24, marginTop: 2 },
  flash: {
    position: 'absolute', top: -34, width: 70, height: 70, borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  ring: {
    position: 'absolute', top: -16, width: 34, height: 34, borderRadius: 17,
    borderWidth: 2, borderColor: '#00FFF0',
  },
  particle: { position: 'absolute', top: -6, width: 4, height: 4, borderRadius: 2 },
  vsBadgeWrap: { width: 34, height: 34, marginTop: -17, alignItems: 'center', justifyContent: 'center' },
  vsBadge: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  vsText: { color: '#08040F', fontSize: 10, fontFamily: 'Courier', fontWeight: '700' },
  winnerCard: {
    marginTop: 16, borderWidth: 1, borderRadius: 10, borderLeftWidth: 3,
    padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,0,229,0.08)',
  },
  winnerIcon: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  winnerLabel: { fontSize: 14, fontFamily: 'Courier', fontWeight: '700', letterSpacing: 1 },
  winnerSummary: { color: '#8B7A9E', fontSize: 11, marginTop: 2 },
});