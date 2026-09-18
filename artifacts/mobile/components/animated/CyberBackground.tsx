import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Line, LinearGradient as SvgLinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

const CYAN = '#00FFF0';
const MAGENTA = '#FF00E5';

/**
 * Background "kota cyber" -- perspective grid lantai yang bergerak turun
 * pelan (kesan terbang di atasnya), garis horizon nyala, orb cahaya
 * cyan/magenta ngambang, garis data naik dari bawah. Disetujui user dari
 * mockup HTML sebelum diimplementasi. Dipasang di belakang semua kartu
 * Technical Analysis PRO (gantiin FuturisticBackground generik).
 */
export function CyberBackground() {
  const { width, height } = useWindowDimensions();
  const gridY = useRef(new Animated.Value(0)).current;
  const orb1 = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const orb2 = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scanY = useRef(new Animated.Value(-100)).current;
  const dataLines = useRef(
    Array.from({ length: 5 }, () => new Animated.Value(0))
  ).current;

  useEffect(() => {
    const gridLoop = Animated.loop(
      Animated.timing(gridY, { toValue: 60, duration: 4000, useNativeDriver: true })
    );
    const loopFloat = (val: Animated.ValueXY, dx: number, dy: number, duration: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, { toValue: { x: dx, y: dy }, duration, useNativeDriver: true }),
          Animated.timing(val, { toValue: { x: 0, y: 0 }, duration, useNativeDriver: true }),
        ])
      );
    const orb1Loop = loopFloat(orb1, 20, -24, 3000);
    const orb2Loop = loopFloat(orb2, -24, 20, 3500);
    const scanLoop = Animated.loop(
      Animated.timing(scanY, { toValue: height + 100, duration: 5000, useNativeDriver: true })
    );
    const dataLoops = dataLines.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 700),
          Animated.timing(v, { toValue: 1, duration: 3000 + i * 400, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      )
    );

    gridLoop.start();
    orb1Loop.start();
    orb2Loop.start();
    scanLoop.start();
    dataLoops.forEach(l => l.start());

    return () => {
      gridLoop.stop(); orb1Loop.stop(); orb2Loop.stop(); scanLoop.stop();
      dataLoops.forEach(l => l.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  const floorHeight = 180;
  const horizonY = height - floorHeight;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Grid lantai perspektif */}
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: gridY }] }]}>
        <Svg width={width} height={floorHeight + 60} style={{ position: 'absolute', bottom: -60, left: 0 }}>
          <Line x1={width / 2} y1={0} x2={0} y2={floorHeight + 60} stroke={MAGENTA} strokeOpacity={0.18} strokeWidth={1} />
          <Line x1={width / 2} y1={0} x2={width * 0.25} y2={floorHeight + 60} stroke={MAGENTA} strokeOpacity={0.18} strokeWidth={1} />
          <Line x1={width / 2} y1={0} x2={width * 0.5} y2={floorHeight + 60} stroke={CYAN} strokeOpacity={0.22} strokeWidth={1} />
          <Line x1={width / 2} y1={0} x2={width * 0.75} y2={floorHeight + 60} stroke={MAGENTA} strokeOpacity={0.18} strokeWidth={1} />
          <Line x1={width / 2} y1={0} x2={width} y2={floorHeight + 60} stroke={MAGENTA} strokeOpacity={0.18} strokeWidth={1} />
          {[20, 35, 50, 60].map((y, i) => (
            <Line key={i} x1={0} y1={y} x2={width} y2={y} stroke={CYAN} strokeOpacity={0.15 + i * 0.08} strokeWidth={0.8 + i * 0.2} />
          ))}
        </Svg>
      </Animated.View>

      {/* Garis horizon nyala */}
      <View style={{ position: 'absolute', top: horizonY, left: 0, right: 0 }}>
        <Svg width={width} height={2}>
          <Defs>
            <SvgLinearGradient id="horizon" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0%" stopColor={CYAN} stopOpacity={0} />
              <Stop offset="50%" stopColor={CYAN} stopOpacity={0.5} />
              <Stop offset="100%" stopColor={CYAN} stopOpacity={0} />
            </SvgLinearGradient>
          </Defs>
          <Rect width={width} height={2} fill="url(#horizon)" />
        </Svg>
      </View>

      {/* Orb cahaya */}
      <Animated.View
        style={{
          position: 'absolute', top: -50, right: -50, width: 220, height: 220,
          transform: [{ translateX: orb1.x }, { translateY: orb1.y }],
        }}
      >
        <Svg width={220} height={220}>
          <Defs>
            <RadialGradient id="o1" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={MAGENTA} stopOpacity={0.18} />
              <Stop offset="100%" stopColor={MAGENTA} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width={220} height={220} fill="url(#o1)" />
        </Svg>
      </Animated.View>
      <Animated.View
        style={{
          position: 'absolute', top: 60, left: -60, width: 200, height: 200,
          transform: [{ translateX: orb2.x }, { translateY: orb2.y }],
        }}
      >
        <Svg width={200} height={200}>
          <Defs>
            <RadialGradient id="o2" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={CYAN} stopOpacity={0.15} />
              <Stop offset="100%" stopColor={CYAN} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width={200} height={200} fill="url(#o2)" />
        </Svg>
      </Animated.View>

      {/* Garis data naik */}
      {dataLines.map((v, i) => {
        const x = width * (0.12 + i * 0.19);
        const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [0, -(height * 0.5)] });
        const opacity = v.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 0.5, 0.5, 0] });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute', left: x, bottom: floorHeight, width: 1, height: 40,
              backgroundColor: i % 2 === 0 ? CYAN : MAGENTA,
              opacity, transform: [{ translateY }],
            }}
          />
        );
      })}

      {/* Scanbeam */}
      <Animated.View
        style={{
          position: 'absolute', left: 0, right: 0, height: 70,
          backgroundColor: 'rgba(0,255,240,0.05)',
          transform: [{ translateY: scanY }],
        }}
      />

      {/* Vignette biar konten depan tetep kebaca */}
      <View style={styles.vignette} />
    </View>
  );
}

const styles = StyleSheet.create({
  vignette: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' },
});
