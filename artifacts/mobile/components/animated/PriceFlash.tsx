import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TextStyle } from 'react-native';

interface PriceFlashProps {
  value: string;
  baseColor: string;
  upColor?: string;
  downColor?: string;
  style?: TextStyle;
}

/**
 * Teks harga yang "flash" warna hijau/merah sekilas pas nilainya berubah
 * (naik/turun), abis itu balik ke warna normal. Efek umum di trading app
 * buat nunjukin data yang beneran live, bukan statis.
 */
export function PriceFlash({ value, baseColor, upColor = '#4ADE80', downColor = '#F87171', style }: PriceFlashProps) {
  const prevValue = useRef(value);
  const colorAnim = useRef(new Animated.Value(0)).current; // 0 = base, 1 = flash
  const [flashColor, setFlashColor] = useState(baseColor);

  useEffect(() => {
    if (prevValue.current !== value) {
      const isUp = parseFloat(value) > parseFloat(prevValue.current);
      setFlashColor(isUp ? upColor : downColor);
      colorAnim.setValue(1);
      Animated.timing(colorAnim, { toValue: 0, duration: 500, useNativeDriver: false }).start();
      prevValue.current = value;
    }
  }, [value, upColor, downColor, colorAnim]);

  const textColor = colorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [baseColor, flashColor],
  });

  return (
    <Animated.Text style={[styles.text, style, { color: textColor }]}>
      {value}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  text: { fontFamily: 'Inter_600SemiBold' },
});