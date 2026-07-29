import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { AnimatedTabSwitcher } from '@/components/animated/AnimatedTabSwitcher';
import { MENU_COLORS } from '@/constants/theme';
import CalculatorView from './_calculator-view';
import InsightView from './_insight-view';
import BacktestView from './_backtest-view';

const ACCENT = MENU_COLORS.tools;

type Section = 'kalkulator' | 'insight' | 'backtest';

/**
 * Menu gabungan — dulu Kalkulator (3), Insight (5), Backtest (6) itu 3 tab
 * terpisah di bottom nav. Sekarang digabung jadi 1 tab dengan switcher
 * internal, biar bottom nav gak kepenuhan (6 → 4 menu).
 *
 * Sub-view (_calculator-view, _insight-view, _backtest-view) isinya PERSIS
 * sama kayak sebelumnya, gak ada logic yang berubah — cuma dipindah dari
 * route sendiri jadi komponen yang dirender di sini. Params dari navigasi
 * luar (misal tombol "Kalkulator PnL" di Menu 1/2/4) tetap kebaca normal
 * lewat useLocalSearchParams() di masing-masing sub-view, karena itu baca
 * dari URL route ini (tools), bukan per-komponen.
 */
export default function ToolsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ section?: string; entryPrice?: string; symbol?: string }>();

  // Default section: kalau ada entryPrice (dari tombol Kalkulator PnL) → kalkulator.
  // Kalau section eksplisit dikasih → pakai itu. Fallback: kalkulator.
  const initialSection: Section =
    params.section === 'insight' || params.section === 'backtest'
      ? params.section
      : 'kalkulator';
  const [section, setSection] = useState<Section>(initialSection);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <AnimatedTabSwitcher
          tabs={[
            { key: 'kalkulator', label: 'KALKULATOR' },
            { key: 'insight', label: 'INSIGHT' },
            { key: 'backtest', label: 'BACKTEST' },
          ]}
          active={section}
          onChange={(key) => setSection(key as Section)}
          accentColor={ACCENT}
        />
      </View>

      <View style={{ flex: 1 }}>
        {section === 'kalkulator' && <CalculatorView embedded />}
        {section === 'insight' && <InsightView embedded />}
        {section === 'backtest' && <BacktestView embedded />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 12, paddingBottom: 10, borderBottomWidth: 1 },
});