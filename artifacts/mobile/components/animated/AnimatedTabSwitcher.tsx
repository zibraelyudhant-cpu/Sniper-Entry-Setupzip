import React, { useEffect, useRef } from 'react';
import { Animated, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';

interface Tab {
  key: string;
  label: string;
}

interface AnimatedTabSwitcherProps {
  tabs: Tab[];
  active: string;
  onChange: (key: string) => void;
  accentColor?: string;
}

/**
 * Segmented tab control dengan pill background yang geser mulus ngikutin
 * tab aktif (bukan cuma ganti warna teks doang). Dipakai buat SCAN/ANALISA/LOG
 * di semua menu yang punya struktur tab serupa.
 */
export function AnimatedTabSwitcher({ tabs, active, onChange, accentColor }: AnimatedTabSwitcherProps) {
  const colors = useColors();
  const accent = accentColor ?? colors.primary;
  const [containerWidth, setContainerWidth] = React.useState(0);
  const pillX = useRef(new Animated.Value(0)).current;

  const activeIndex = Math.max(0, tabs.findIndex(t => t.key === active));
  const tabWidth = containerWidth / (tabs.length || 1);

  useEffect(() => {
    if (containerWidth === 0) return;
    Animated.spring(pillX, {
      toValue: activeIndex * tabWidth,
      useNativeDriver: true,
      speed: 16,
      bounciness: 6,
    }).start();
  }, [activeIndex, tabWidth, containerWidth, pillX]);

  const onLayout = (e: LayoutChangeEvent) => setContainerWidth(e.nativeEvent.layout.width);

  return (
    <View
      onLayout={onLayout}
      style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      {containerWidth > 0 && (
        <Animated.View
          style={[
            styles.pill,
            {
              width: tabWidth - 6,
              backgroundColor: accent,
              transform: [{ translateX: Animated.add(pillX, new Animated.Value(3)) }],
            },
          ]}
        />
      )}
      {tabs.map(tab => {
        const isActive = tab.key === active;
        return (
          <Pressable key={tab.key} style={styles.tabBtn} onPress={() => onChange(tab.key)}>
            <Text style={[styles.tabText, { color: isActive ? '#031A1F' : colors.mutedForeground }]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    height: 38,
    position: 'relative',
    overflow: 'hidden',
  },
  pill: {
    position: 'absolute',
    top: 3,
    left: 0,
    bottom: 3,
    borderRadius: 8,
  },
  tabBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  tabText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5 },
});