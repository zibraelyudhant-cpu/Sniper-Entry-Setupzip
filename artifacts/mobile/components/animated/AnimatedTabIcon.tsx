import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';

interface AnimatedTabIconProps {
  focused: boolean;
  color: string;
  children: React.ReactNode;
}

/**
 * Wrapper icon bottom-nav yang bounce pas jadi aktif + dot indikator kecil
 * muncul di bawahnya. Cuma jalan di Android/Web (React Navigation classic tabs) —
 * iOS pakai NativeTabs (native UIKit tab bar), gak bisa dikustomisasi animasi JS,
 * itu batasan platform bukan sesuatu yang bisa di-workaround dari sisi kita.
 */
export function AnimatedTabIcon({ focused, color, children }: AnimatedTabIconProps) {
  const scale = useRef(new Animated.Value(focused ? 1.1 : 1)).current;
  const dotOpacity = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const wasFocused = useRef(focused);

  useEffect(() => {
    if (focused && !wasFocused.current) {
      // Baru jadi aktif — bounce (overshoot dikit terus balik)
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.25, useNativeDriver: true, speed: 30, bounciness: 12 }),
        Animated.spring(scale, { toValue: 1.1, useNativeDriver: true, speed: 20, bounciness: 8 }),
      ]).start();
      Animated.timing(dotOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    } else if (!focused && wasFocused.current) {
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20 }).start();
      Animated.timing(dotOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    }
    wasFocused.current = focused;
  }, [focused, scale, dotOpacity]);

  return (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <Animated.View style={{ transform: [{ scale }] }}>
        {children}
      </Animated.View>
      <Animated.View
        style={{
          width: 3, height: 3, borderRadius: 1.5,
          backgroundColor: color,
          opacity: dotOpacity,
        }}
      />
    </View>
  );
}