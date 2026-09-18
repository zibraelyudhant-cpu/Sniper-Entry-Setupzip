import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Line } from 'react-native-svg';

interface CyberCardProps {
  children: React.ReactNode;
  accentColor: string; // warna glow border + grid (cyan buat bullish/netral, magenta buat bearish, dst)
  style?: ViewStyle | ViewStyle[];
}

const CYAN = '#00FFF0';
const MAGENTA = '#FF00E5';

/**
 * Wrapper kartu tema cyberpunk (grid garis tipis cyan/magenta, border yang
 * napas nyala-redup, scanline yang lewat pelan) -- dipakai bareng di semua
 * kartu hasil Technical Analysis PRO (Tren, Multi-TF, Transisi, SNR).
 */
export function CyberCard({ children, accentColor, style }: CyberCardProps) {
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.96)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const scanY = useRef(new Animated.Value(-40)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(cardOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(cardScale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 6 }),
    ]).start();

    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1400, useNativeDriver: false }),
        Animated.timing(glow, { toValue: 0, duration: 1400, useNativeDriver: false }),
      ])
    );
    const scanLoop = Animated.loop(
      Animated.timing(scanY, { toValue: 260, duration: 2800, useNativeDriver: true })
    );
    glowLoop.start();
    scanLoop.start();
    return () => { glowLoop.stop(); scanLoop.stop(); };
  }, [cardOpacity, cardScale, glow, scanY]);

  const borderColor = glow.interpolate({ inputRange: [0, 1], outputRange: [`${accentColor}35`, `${accentColor}80`] });
  const shadowRadius = glow.interpolate({ inputRange: [0, 1], outputRange: [6, 18] });

  return (
    <Animated.View
      style={[
        style,
        styles.wrap,
        {
          opacity: cardOpacity,
          transform: [{ scale: cardScale }],
          borderColor,
          shadowColor: accentColor,
          shadowOpacity: 0.5,
          shadowRadius,
          shadowOffset: { width: 0, height: 0 },
        },
      ]}
    >
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        {Array.from({ length: 8 }, (_, i) => (
          <Line key={`v${i}`} x1={i * 40} y1={0} x2={i * 40} y2={260} stroke={MAGENTA} strokeOpacity={0.05} strokeWidth={1} />
        ))}
        {Array.from({ length: 7 }, (_, i) => (
          <Line key={`h${i}`} x1={0} y1={i * 40} x2={320} y2={i * 40} stroke={CYAN} strokeOpacity={0.04} strokeWidth={1} />
        ))}
      </Svg>
      <Animated.View
        pointerEvents="none"
        style={[styles.scanline, { backgroundColor: `${accentColor}12`, transform: [{ translateY: scanY }] }]}
      />
      <View style={styles.content}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#0D0518', borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  scanline: { position: 'absolute', left: 0, right: 0, height: 50 },
  content: { padding: 16 },
});
