import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';

interface TaProBonusBannerProps {
  classification: string | null;
  score: number;
}

const GOLD = '#FFD700';
const GOLD_DIM = '#FF8F00';

/**
 * Banner bonus yang nempel di kartu sinyal menu APAPUN (Sniper Breakout,
 * Money Magnet, dll) -- muncul kalau sinyal itu SEARAH sama Fitur 5
 * Technical Analysis PRO (Skor Long vs Short). Kartu sinyal aslinya gak
 * diubah, ini cuma nempel di atasnya. Disetujui user dari mockup sebelum
 * diimplementasi.
 */
export function TaProBonusBanner({ classification, score }: TaProBonusBannerProps) {
  const bannerOpacity = useRef(new Animated.Value(0)).current;
  const bannerScale = useRef(new Animated.Value(0.95)).current;
  const bannerTranslateY = useRef(new Animated.Value(-8)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const shineX = useRef(new Animated.Value(-1)).current;
  const iconScale = useRef(new Animated.Value(0)).current;
  const iconRotate = useRef(new Animated.Value(-20)).current;
  const sparkles = useRef(Array.from({ length: 4 }, () => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(bannerOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(bannerScale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 10 }),
      Animated.spring(bannerTranslateY, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 10 }),
    ]).start();

    Animated.sequence([
      Animated.delay(200),
      Animated.parallel([
        Animated.spring(iconScale, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 16 }),
        Animated.spring(iconRotate, { toValue: 0, useNativeDriver: true, speed: 12, bounciness: 16 }),
      ]),
    ]).start();

    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1100, delay: 500, useNativeDriver: false }),
        Animated.timing(glow, { toValue: 0, duration: 1100, useNativeDriver: false }),
      ])
    );
    const shineLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shineX, { toValue: 2, duration: 1400, delay: 1200, useNativeDriver: true }),
        Animated.timing(shineX, { toValue: -1, duration: 0, useNativeDriver: true }),
        Animated.delay(1400),
      ])
    );
    const sparkleLoops = sparkles.map((s, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(400 * i),
          Animated.timing(s, { toValue: 1, duration: 900, useNativeDriver: true }),
          Animated.timing(s, { toValue: 0, duration: 900, useNativeDriver: true }),
          Animated.delay(1800 - 400 * i),
        ])
      )
    );

    glowLoop.start();
    shineLoop.start();
    sparkleLoops.forEach(l => l.start());

    return () => { glowLoop.stop(); shineLoop.stop(); sparkleLoops.forEach(l => l.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shadowRadius = glow.interpolate({ inputRange: [0, 1], outputRange: [8, 18] });
  const iconRotateDeg = iconRotate.interpolate({ inputRange: [-20, 0], outputRange: ['-20deg', '0deg'] });
  const shineTranslateX = shineX.interpolate({ inputRange: [-1, 2], outputRange: [-120, 220] });

  return (
    <Animated.View
      style={[
        styles.banner,
        {
          opacity: bannerOpacity,
          transform: [{ scale: bannerScale }, { translateY: bannerTranslateY }],
          shadowColor: GOLD,
          shadowOpacity: 0.5,
          shadowRadius,
          shadowOffset: { width: 0, height: 0 },
        },
      ]}
    >
      <LinearGradient colors={['#3D2E00', '#1A1200']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />

      <Animated.View pointerEvents="none" style={[styles.shine, { transform: [{ translateX: shineTranslateX }, { skewX: '-20deg' }] }]} />

      {sparkles.map((s, i) => {
        const opacity = s;
        const scale = s.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
        const rotate = s.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
        const pos = [
          { top: 4, right: 14, fontSize: 10 },
          { bottom: 4, right: 34, fontSize: 8 },
          { top: 8, right: 50, fontSize: 7 },
          { bottom: 6, right: 8, fontSize: 9 },
        ][i]!;
        return (
          <Animated.Text
            key={i}
            pointerEvents="none"
            style={[styles.sparkle, pos, { opacity, transform: [{ scale }, { rotate }] }]}
          >
            ✦
          </Animated.Text>
        );
      })}

      <Animated.View style={[styles.iconBox, { transform: [{ scale: iconScale }, { rotate: iconRotateDeg }] }]}>
        <LinearGradient colors={[GOLD, GOLD_DIM]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.iconGradient}>
          <Feather name="zap" size={17} color="#1A1200" />
        </LinearGradient>
      </Animated.View>

      <View style={{ flex: 1 }}>
        <Text style={styles.title}>⚡ TA PRO CONFIRMED</Text>
        <Text style={styles.subtitle}>
          Searah breakout Fitur 5 — {classification} (skor {score >= 0 ? '+' : ''}{score})
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,184,0,0.5)',
    padding: 11, marginBottom: 10, overflow: 'hidden',
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  shine: {
    position: 'absolute', top: 0, left: 0, width: '40%', height: '100%',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  sparkle: { position: 'absolute', color: GOLD },
  iconBox: { width: 30, height: 30, borderRadius: 8, flexShrink: 0 },
  iconGradient: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  title: { color: GOLD, fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 },
  subtitle: { color: '#C9A96B', fontSize: 10.5, fontFamily: 'Inter_400Regular', marginTop: 1 },
});