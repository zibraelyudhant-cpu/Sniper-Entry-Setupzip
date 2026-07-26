import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

interface ScoreBadgeProps {
  score: number;
  max: number;
}

/**
 * Badge skor (misal "4/5") dengan animasi angka count-up dari 0 ke nilai final.
 * Warna otomatis nyesuain: hijau kalau skor tinggi, amber sedang, merah rendah.
 */
export function ScoreBadge({ score, max }: ScoreBadgeProps) {
  const [displayScore, setDisplayScore] = useState(0);
  const animValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    animValue.setValue(0);
    const listener = animValue.addListener(({ value }) => {
      setDisplayScore(Math.round(value));
    });
    Animated.timing(animValue, {
      toValue: score,
      duration: 500,
      useNativeDriver: false,
    }).start();
    return () => animValue.removeListener(listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score]);

  const pct = score / max;
  const color = pct >= 0.85 ? '#4ADE80' : pct >= 0.6 ? '#FBBF24' : '#F87171';

  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: `${color}18` }]}>
      <Text style={[styles.text, { color }]}>{displayScore}/{max}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  text: { fontSize: 11, fontFamily: 'Inter_700Bold' },
});