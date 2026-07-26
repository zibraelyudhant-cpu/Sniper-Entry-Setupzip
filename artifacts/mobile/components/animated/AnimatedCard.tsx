import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, ViewStyle } from 'react-native';
import { ANIM } from '@/constants/theme';

interface AnimatedCardProps {
  children: React.ReactNode;
  index?: number; // buat staggered entrance — kartu ke-N delay makin lama
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
}

/**
 * Kartu dengan animasi masuk (fade + slide naik, staggered per index) dan
 * efek "tekan" (scale down dikit) pas disentuh. Dipakai buat semua kartu
 * sinyal di Scan tab (Menu 1, 2, 4).
 */
export function AnimatedCard({ children, index = 0, onPress, style }: AnimatedCardProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const delay = Math.min(index * ANIM.staggerGap, 600); // cap delay biar list panjang gak lelet
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: ANIM.entrance,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: ANIM.entrance,
        delay,
        useNativeDriver: true,
      }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePressIn = () => {
    Animated.spring(scale, { toValue: 0.98, useNativeDriver: true, speed: 30 }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30 }).start();
  };

  const content = (
    <Animated.View style={[style, { opacity, transform: [{ translateY }, { scale }] }]}>
      {children}
    </Animated.View>
  );

  if (!onPress) return content;

  return (
    <Pressable onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut}>
      {content}
    </Pressable>
  );
}