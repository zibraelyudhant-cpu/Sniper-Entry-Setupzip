import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import MonitoringView from './_monitoring-view';
import PatternsView from './_patterns-view';

type TabKey = 'monitoring' | 'pattern';

export default function InsightScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ symbol?: string; tab?: string }>();

  const initialTab: TabKey =
    params.tab === 'pattern' || !!params.symbol ? 'pattern' : 'monitoring';
  const [tab, setTab] = useState<TabKey>(initialTab);

  useEffect(() => {
    if (params.tab === 'pattern' || params.symbol) {
      setTab('pattern');
    }
  }, [params.tab, params.symbol]);

  const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Insight</Text>

        <View style={[styles.tabRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Pressable
            onPress={() => setTab('monitoring')}
            style={[styles.tabBtn, tab === 'monitoring' && { backgroundColor: colors.primary }]}
          >
            <Feather name="activity" size={13} color={tab === 'monitoring' ? colors.primaryForeground : colors.mutedForeground} />
            <Text style={[styles.tabText, { color: tab === 'monitoring' ? colors.primaryForeground : colors.mutedForeground }]}>
              Monitoring
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setTab('pattern')}
            style={[styles.tabBtn, tab === 'pattern' && { backgroundColor: colors.primary }]}
          >
            <Feather name="grid" size={13} color={tab === 'pattern' ? colors.primaryForeground : colors.mutedForeground} />
            <Text style={[styles.tabText, { color: tab === 'pattern' ? colors.primaryForeground : colors.mutedForeground }]}>
              Chart Pattern
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {tab === 'monitoring' ? (
          <MonitoringView />
        ) : (
          <PatternsView initialSymbol={params.symbol ?? ''} topPadding={0} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  title: { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  tabRow: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    padding: 3,
    gap: 3,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 7,
  },
  tabText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
});