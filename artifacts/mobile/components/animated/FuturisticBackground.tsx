import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Line, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';

interface FuturisticBackgroundProps {
  accentColor?: string;
  secondaryColor?: string;
}

const PARTICLE_COUNT = 8;

/**
 * Background dekoratif dipasang di belakang konten tiap layar — grid tipis
 * transparan, 2 orb cahaya yang ngambang pelan, scanline yang jalan naik-turun,
 * dan partikel titik kecil yang naik perlahan. Dipasang absolute-fill di
 * belakang ScrollView, gak ganggu interaksi (pointerEvents none).
 */
export function FuturisticBackground({ accentColor = '#22D3EE', secondaryColor = '#A78BFA' }: FuturisticBackgroundProps) {
  const { width, height } = useWindowDimensions();
  // Instance ID unik — biar id SVG (grid, orb, scanline) gak bentrok kalau ada
  // beberapa layar yang tetep mounted bareng (umum di React Navigation tab).
  // Tanpa ini, di web semua <svg> bisa punya id sama & browser salah resolve url(#id).
  const instanceId = useRef(`fbg-${Math.random().toString(36).slice(2, 9)}`).current;
  const orb1 = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const orb2 = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scanY = useRef(new Animated.Value(-60)).current;
  const particles = useRef(
    Array.from({ length: PARTICLE_COUNT }, () => ({
      x: Math.random() * width,
      y: new Animated.Value(Math.random() * height),
      speed: 6000 + Math.random() * 6000,
    }))
  ).current;

  useEffect(() => {
    const loopFloat = (val: Animated.ValueXY, dx: number, dy: number, duration: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: { x: dx, y: dy }, duration, useNativeDriver: true }),
          Animated.timing(val, { toValue: { x: 0, y: 0 }, duration, useNativeDriver: true }),
        ])
      );
    };
    const anim1 = loopFloat(orb1, 25, -18, 4500);
    const anim2 = loopFloat(orb2, -20, 15, 5200);
    anim1.start();
    anim2.start();

    const scanAnim = Animated.loop(
      Animated.timing(scanY, { toValue: height + 60, duration: 4500, useNativeDriver: true })
    );
    scanAnim.start();

    const particleAnims = particles.map(p =>
      Animated.loop(
        Animated.timing(p.y, { toValue: -20, duration: p.speed, useNativeDriver: true })
      )
    );
    particleAnims.forEach(a => a.start());

    return () => {
      anim1.stop();
      anim2.stop();
      scanAnim.stop();
      particleAnims.forEach(a => a.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Grid tipis */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <Pattern id={`grid-${instanceId}`} width={20} height={20} patternUnits="userSpaceOnUse">
            <Line x1={0} y1={0} x2={20} y2={0} stroke={accentColor} strokeOpacity={0.05} strokeWidth={1} />
            <Line x1={0} y1={0} x2={0} y2={20} stroke={accentColor} strokeOpacity={0.05} strokeWidth={1} />
          </Pattern>
          <RadialGradient id={`orb1Grad-${instanceId}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={accentColor} stopOpacity={0.16} />
            <Stop offset="100%" stopColor={accentColor} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`orb2Grad-${instanceId}`} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={secondaryColor} stopOpacity={0.13} />
            <Stop offset="100%" stopColor={secondaryColor} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={width} height={height} fill={`url(#grid-${instanceId})`} />
      </Svg>

      {/* Orb 1 */}
      <Animated.View
        style={[
          styles.orb,
          {
            width: 220, height: 220, top: height * 0.08, left: -40,
            transform: [{ translateX: orb1.x }, { translateY: orb1.y }],
          },
        ]}
      >
        <Svg width={220} height={220}>
          <Defs>
            <RadialGradient id={`o1-${instanceId}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={accentColor} stopOpacity={0.18} />
              <Stop offset="100%" stopColor={accentColor} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width={220} height={220} fill={`url(#o1-${instanceId})`} />
        </Svg>
      </Animated.View>

      {/* Orb 2 */}
      <Animated.View
        style={[
          styles.orb,
          {
            width: 180, height: 180, bottom: height * 0.1, right: -30,
            transform: [{ translateX: orb2.x }, { translateY: orb2.y }],
          },
        ]}
      >
        <Svg width={180} height={180}>
          <Defs>
            <RadialGradient id={`o2-${instanceId}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={secondaryColor} stopOpacity={0.14} />
              <Stop offset="100%" stopColor={secondaryColor} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width={180} height={180} fill={`url(#o2-${instanceId})`} />
        </Svg>
      </Animated.View>

      {/* Scanline */}
      <Animated.View
        style={[
          styles.scanline,
          { width, transform: [{ translateY: scanY }] },
        ]}
      >
        <Svg width={width} height={60}>
          <Defs>
            <RadialGradient id={`scan-${instanceId}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={accentColor} stopOpacity={0.06} />
              <Stop offset="100%" stopColor={accentColor} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width={width} height={60} fill={`url(#scan-${instanceId})`} />
        </Svg>
      </Animated.View>

      {/* Partikel */}
      {particles.map((p, i) => (
        <Animated.View
          key={i}
          style={[
            styles.particle,
            {
              left: p.x,
              backgroundColor: accentColor,
              transform: [{ translateY: p.y }],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  orb: { position: 'absolute' },
  scanline: { position: 'absolute', left: 0, height: 60 },
  particle: { position: 'absolute', width: 2, height: 2, borderRadius: 1, opacity: 0.4 },
});