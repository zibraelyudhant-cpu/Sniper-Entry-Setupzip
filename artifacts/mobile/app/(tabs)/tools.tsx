import React, { useState } from 'react';
import { CyberBackground } from '@/components/animated/CyberBackground';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { AnimatedTabSwitcher } from '@/components/animated/AnimatedTabSwitcher';
import { MENU_COLORS } from '@/constants/theme';
import CalculatorView from './_calculator-view';

const ACCENT = MENU_COLORS.tools;

type Section = 'kalkulator';

/**
 * Menu gabungan — dulu Kalkulator (3), Insight (5), Backtest (6) itu 3 tab
 * terpisah di bottom nav, sekarang digabung jadi 1 tab dengan switcher
 * internal. Backtest (request user) DIHAPUS total dari sini.
 *
 * Sub-view (_calculator-view) isinya PERSIS sama kayak
 * sebelumnya, gak ada logic yang berubah — cuma dipindah dari route sendiri
 * jadi komponen yang dirender di sini. Params dari navigasi luar (misal
 * tombol "Kalkulator PnL" di Menu 1/2/4) tetap kebaca normal lewat
 * useLocalSearchParams() di masing-masing sub-view, karena itu baca dari
 * URL route ini (tools), bukan per-komponen.
 */
export default function ToolsScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ section?: string; entryPrice?: string; symbol?: string }>();

  // Default section: kalau ada entryPrice (dari tombol Kalkulator PnL) → kalkulator.
  // Kalau section eksplisit dikasih → pakai itu. Fallback: kalkulator.
  const initialSection: Section = 'kalkulator';
  const [section, setSection] = useState<Section>(initialSection);

  return (
    <View style={[styles.container, { backgroundColor: '#050208' }]}>
      <CyberBackground />
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: 'rgba(255,0,229,0.2)', backgroundColor: '#050208' }]}>
        <AnimatedTabSwitcher
          tabs={[
            { key: 'kalkulator', label: 'KALKULATOR PNL FUTURES' },
          ]}
          active={section}
          onChange={(key) => setSection(key as Section)}
          accentColor={ACCENT}
        />
      </View>

      <View style={{ flex: 1 }}>
        {section === 'kalkulator' && <CalculatorView embedded />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: 1 },
});