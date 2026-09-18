import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

interface CyberBigNumberProps {
  value: string;
  label: string;
  color: string;
  fontSize?: number;
}

/** Angka besar yang pop-in lalu glow berdenyut terus -- ADX, skor, dll. */
export function CyberBigNumber({ value, label, color, fontSize = 28 }: CyberBigNumberProps) {
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(250),
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 10 }),
        Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]),
    ]).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 1100, useNativeDriver: false }),
          Animated.timing(glow, { toValue: 0, duration: 1100, useNativeDriver: false }),
        ])
      ).start();
    });
  }, [scale, opacity, glow]);

  const textShadowRadius = glow.interpolate({ inputRange: [0, 1], outputRange: [4, 14] });

  return (
    <View style={styles.wrap}>
      <Animated.Text
        style={[
          styles.num,
          { color, fontSize, opacity, transform: [{ scale }], textShadowColor: color, textShadowRadius, textShadowOffset: { width: 0, height: 0 } },
        ]}
      >
        {value}
      </Animated.Text>
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  num: { fontFamily: 'Courier', fontWeight: '700' },
  label: { fontSize: 9, opacity: 0.75, fontWeight: '600', marginTop: 2, letterSpacing: 0.3 },
});
