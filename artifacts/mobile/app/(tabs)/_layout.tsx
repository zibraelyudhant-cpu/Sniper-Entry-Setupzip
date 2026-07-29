import React from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';
import { AnimatedTabIcon } from '@/components/animated/AnimatedTabIcon';
import { MENU_COLORS } from '@/constants/theme';

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: 'arrow.up.right', selected: 'arrow.up.right' }} />
        <Label>Breakout</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="sniper">
        <Icon sf={{ default: 'scope', selected: 'scope' }} />
        <Label>Sniper</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="breakout">
        <Icon sf={{ default: 'bolt.horizontal', selected: 'bolt.horizontal.fill' }} />
        <Label>Scalping</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="extreme-scalping">
        <Icon sf={{ default: 'flame', selected: 'flame.fill' }} />
        <Label>Extreme</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tools">
        <Icon sf={{ default: 'wrench.and.screwdriver', selected: 'wrench.and.screwdriver.fill' }} />
        <Label>Tools</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: isIOS ? 'transparent' : colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          height: isWeb ? 84 : 60,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={80}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
            />
          ) : null,
        tabBarLabelStyle: {
          fontFamily: 'Inter_500Medium',
          fontSize: 11,
          marginBottom: isWeb ? 0 : 4,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Breakout',
          tabBarActiveTintColor: MENU_COLORS.breakout,
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon focused={focused} color={color}>
              {isIOS ? (
                <SymbolView name="arrow.up.right" tintColor={color} size={22} />
              ) : (
                <Feather name="trending-up" size={22} color={color} />
              )}
            </AnimatedTabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="sniper"
        options={{
          title: 'Sniper',
          tabBarActiveTintColor: MENU_COLORS.sniper,
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon focused={focused} color={color}>
              {isIOS ? (
                <SymbolView name="scope" tintColor={color} size={22} />
              ) : (
                <Feather name="crosshair" size={22} color={color} />
              )}
            </AnimatedTabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="breakout"
        options={{
          title: 'Scalping',
          tabBarActiveTintColor: MENU_COLORS.scalping,
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon focused={focused} color={color}>
              {isIOS ? (
                <SymbolView name="bolt.horizontal.fill" tintColor={color} size={22} />
              ) : (
                <Feather name="zap" size={22} color={color} />
              )}
            </AnimatedTabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="extreme-scalping"
        options={{
          title: 'Extreme',
          tabBarActiveTintColor: MENU_COLORS.extremeScalping,
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon focused={focused} color={color}>
              {isIOS ? (
                <SymbolView name="flame.fill" tintColor={color} size={22} />
              ) : (
                <Feather name="zap" size={22} color={color} />
              )}
            </AnimatedTabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="tools"
        options={{
          title: 'Tools',
          tabBarActiveTintColor: MENU_COLORS.tools,
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon focused={focused} color={color}>
              {isIOS ? (
                <SymbolView name="wrench.and.screwdriver.fill" tintColor={color} size={22} />
              ) : (
                <Feather name="tool" size={22} color={color} />
              )}
            </AnimatedTabIcon>
          ),
        }}
      />
      {/* Hidden screens — file di (tabs) tapi jangan muncul di tab bar */}
      <Tabs.Screen name="_monitoring-view" options={{ href: null }} />
      <Tabs.Screen name="_patterns-view" options={{ href: null }} />
      <Tabs.Screen name="_calculator-view" options={{ href: null }} />
      <Tabs.Screen name="_insight-view" options={{ href: null }} />
      <Tabs.Screen name="_backtest-view" options={{ href: null }} />
      <Tabs.Screen name="monitoring-helpers" options={{ href: null }} />
      <Tabs.Screen name="signal-log-helpers" options={{ href: null }} />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}