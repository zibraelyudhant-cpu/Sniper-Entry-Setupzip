import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';

interface PulseDotProps {
  color: string;
  size?: number;
}

/** Titik kecil yang berdenyut terus — dipakai di dalam badge status "aktif". */
export function PulseDot({ color, size = 5 }: PulseDotProps) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] });

  return (
    <Animated.View
      style={[
        styles.dot,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity, transform: [{ scale }] },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {},
});
