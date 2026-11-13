import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { MENU_COLORS } from '@/constants/theme';
import { AnimatedTabSwitcher } from '@/components/animated/AnimatedTabSwitcher';
import { MarketStructureTab } from '@/components/MarketStructureTab';
import SetupFinderView from './_setup-finder-view';

// v26 (2026-11-13): menu Setup Finder punya 2 tab.
//  - Tab 1 "Setup Finder" = isi menu Setup Finder LAMA, file dipindah UTUH tanpa diubah ke ./_setup-finder-view.tsx.
//  - Tab 2 "📐 Market Structure" = fitur port (HTML/JS asli di WebView, analisa Python asli di server).
// Kedua tab tetap terpasang (yang tidak aktif cuma disembunyikan) supaya hasil di tab lain tidak hilang.
// Tab terakhir yang dibuka diingat di HP.
type TabKey = 'sf' | 'msa';
const TAB_KEY = 'setup_finder_tab_v1';

export default function SetupFinderTabsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabKey>('sf');
  useEffect(() => {
    AsyncStorage.getItem(TAB_KEY).then(v => { if (v === 'sf' || v === 'msa') setTab(v); }).catch(() => {});
  }, []);
  const pick = (k: string) => {
    const t = k === 'msa' ? 'msa' : 'sf';
    setTab(t);
    AsyncStorage.setItem(TAB_KEY, t).catch(() => {});
  };
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <AnimatedTabSwitcher
          tabs={[{ key: 'sf', label: 'Setup Finder' }, { key: 'msa', label: '📐 Market Structure' }]}
          active={tab}
          onChange={pick}
          accentColor={MENU_COLORS.setupFinder}
        />
      </View>
      {/* header tab sudah memakai jarak atas layar -> isi tab 1 diberi inset atas 0 (file lamanya tidak diubah) */}
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
        <View style={[styles.pane, tab !== 'sf' && styles.hidden]}><SetupFinderView /></View>
      </SafeAreaInsetsContext.Provider>
      <View style={[styles.pane, tab !== 'msa' && styles.hidden, { paddingBottom: insets.bottom + 60 }]}><MarketStructureTab /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: 1 },
  pane: { flex: 1 },
  hidden: { display: 'none' },
});
