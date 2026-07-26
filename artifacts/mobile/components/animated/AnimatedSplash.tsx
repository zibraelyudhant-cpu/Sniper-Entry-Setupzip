import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

interface AnimatedSplashProps {
  onFinish: () => void;
  accentColor?: string;
}

/**
 * Splash screen custom yang muncul pas app pertama kali dibuka —
 * icon fade in, judul "Crypto Screener" dengan glow, subjudul "BY CRYPTODANT",
 * progress bar keisi, terus otomatis manggil onFinish buat masuk ke app.
 */
export function AnimatedSplash({ onFinish, accentColor = '#22D3EE' }: AnimatedSplashProps) {
  const iconOpacity = useRef(new Animated.Value(0)).current;
  const iconY = useRef(new Animated.Value(8)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleY = useRef(new Animated.Value(8)).current;
  const subOpacity = useRef(new Animated.Value(0)).current;
  const barWidth = useRef(new Animated.Value(0)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(iconOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(iconY, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(titleY, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]),
      Animated.timing(subOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(barWidth, { toValue: 1, duration: 700, useNativeDriver: false }),
    ]).start(() => {
      Animated.timing(screenOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        onFinish();
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: screenOpacity }]}>
      <Animated.View style={[styles.iconBox, { borderColor: `${accentColor}4D`, backgroundColor: `${accentColor}1A`, opacity: iconOpacity, transform: [{ translateY: iconY }] }]}>
        <Feather name="bar-chart-2" size={26} color={accentColor} />
      </Animated.View>
      <Animated.Text style={[styles.title, { opacity: titleOpacity, transform: [{ translateY: titleY }] }]}>
        Crypto Screener
      </Animated.Text>
      <Animated.Text style={[styles.sub, { opacity: subOpacity }]}>BY CRYPTODANT</Animated.Text>
      <View style={styles.barTrack}>
        <Animated.View
          style={[
            styles.barFill,
            { backgroundColor: accentColor, width: barWidth.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
          ]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    backgroundColor: '#05080D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBox: {
    width: 56, height: 56, borderRadius: 16, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  title: { fontSize: 20, fontFamily: 'Inter_600SemiBold', color: '#E8FBFF', letterSpacing: 0.3 },
  sub: { fontSize: 11, fontFamily: 'Inter_500Medium', color: '#5B6472', marginTop: 4, letterSpacing: 1.5 },
  barTrack: { width: 90, height: 2, borderRadius: 2, backgroundColor: '#0F1620', marginTop: 20, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
});