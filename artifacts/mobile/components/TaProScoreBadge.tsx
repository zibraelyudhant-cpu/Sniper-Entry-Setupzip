import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Text, View } from 'react-native';
import { taProScoreOf } from './SortSelector';

const CYAN = '#00FFF0', AMBER = '#FFD700', MAGENTA = '#FF00E5';
const TINT_CYAN = '#E8FFFF', TINT_AMBER = '#FFF3B0';

type Wisp = { x: number; y0: number; rise: number; w: number; h: number; dur: number; delay: number; sway: number; hot: boolean };

// Profil api per grade (satuan dp). A+ lebih besar/rapat, B lebih kecil.
const PROFILE = {
  'A+': { count: 22, rise: [14, 30], w: [2, 3.6], h: [9, 17], dur: [900, 1500], sway: 4.5, pad: 22, aura: 0.34 },
  B: { count: 11, rise: [8, 15], w: [1.6, 2.6], h: [6, 11], dur: [800, 1250], sway: 2.8, pad: 12, aura: 0.24 },
} as const;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function WispView({ wisp, color, tint }: { wisp: Wisp; color: string; tint: string }) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(wisp.delay),
        Animated.timing(p, { toValue: 1, duration: wisp.dur, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(p, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [p, wisp]);
  const translateY = p.interpolate({ inputRange: [0, 1], outputRange: [0, -wisp.rise] });
  const translateX = p.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, wisp.sway, 0, -wisp.sway, 0] });
  const opacity = p.interpolate({ inputRange: [0, 0.15, 0.55, 1], outputRange: [0, 0.95, 0.5, 0] });
  const scaleY = p.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.7, 1, 0.3] });
  const col = wisp.hot ? tint : color;
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: wisp.x - wisp.w / 2,
        top: wisp.y0 - wisp.h,
        width: wisp.w,
        height: wisp.h,
        borderRadius: wisp.w,
        backgroundColor: col,
        opacity,
        transform: [{ translateX }, { translateY }, { scaleY }],
        shadowColor: color,
        shadowOpacity: 1,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 0 },
      }}
    />
  );
}

function Fire({ grade, color, tint, width, height }: { grade: 'A+' | 'B'; color: string; tint: string; width: number; height: number }) {
  const prof = PROFILE[grade];
  const wisps = useMemo<Wisp[]>(() => {
    const out: Wisp[] = [];
    for (let i = 0; i < prof.count; i++) {
      const side = Math.random() < 0.18;
      const x = side ? (Math.random() < 0.5 ? rnd(-3, 4) : width - rnd(-3, 4)) : rnd(width * 0.04, width * 0.96);
      out.push({
        x,
        y0: side ? rnd(height * 0.2, height * 0.6) : rnd(1, height * 0.25),
        rise: rnd(prof.rise[0], prof.rise[1]) * (side ? 0.6 : 1),
        w: rnd(prof.w[0], prof.w[1]),
        h: rnd(prof.h[0], prof.h[1]),
        dur: rnd(prof.dur[0], prof.dur[1]),
        delay: rnd(0, 1300),
        sway: rnd(prof.sway * 0.4, prof.sway) * (Math.random() < 0.5 ? 1 : -1),
        hot: Math.random() < 0.4,
      });
    }
    return out;
  }, [prof, width, height]);

  // Aura panas: mengembang pelan, tidak berkedip
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(a, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [a]);
  const auraScale = a.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.08] });
  const auraOpacity = a.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] });

  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height }}>
      <Animated.View
        style={{
          position: 'absolute',
          left: -prof.pad * 0.6,
          right: -prof.pad * 0.6,
          top: -prof.pad * 0.7,
          bottom: -prof.pad * 0.25,
          borderRadius: 999,
          backgroundColor: color,
          opacity: Animated.multiply(auraOpacity, prof.aura),
          transform: [{ scale: auraScale }],
          shadowColor: color,
          shadowOpacity: 0.9,
          shadowRadius: prof.pad,
          shadowOffset: { width: 0, height: 0 },
        }}
      />
      {wisps.map((w, i) => (
        <WispView key={i} wisp={w} color={color} tint={tint} />
      ))}
    </View>
  );
}

/** Badge kecil Skor TA PRO (sisi searah sinyal) di list Scan, biar gak perlu buka detail koin. Info saja.
 *  Grade A+ dan B diberi efek api (cyan / kuning); "Tidak layak" polos. */
export function TaProScoreBadge({ coin }: { coin: any }) {
  const s = taProScoreOf(coin);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
  }, []);
  if (!s) return null;
  const fire = s.grade === 'A+' || s.grade === 'B';
  const c = s.grade === 'A+' ? CYAN : s.grade === 'B' ? AMBER : MAGENTA;
  const tint = s.grade === 'A+' ? TINT_CYAN : TINT_AMBER;
  return (
    <View
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={{ marginTop: fire ? (s.grade === 'A+' ? 10 : 6) : 0 }}
    >
      {fire && !reduce && size.w > 0 ? <Fire grade={s.grade as 'A+' | 'B'} color={c} tint={tint} width={size.w} height={size.h} /> : null}
      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: fire ? `${c}8C` : c, backgroundColor: `${c}18` }}>
        <Text
          style={{
            fontSize: 10,
            fontFamily: 'Inter_700Bold',
            color: c,
            ...(fire ? { textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } } : null),
          }}
        >
          SKOR {s.score}/9 • {s.grade === 'Tidak layak' ? 'Tdk layak' : s.grade}
        </Text>
      </View>
    </View>
  );
}
