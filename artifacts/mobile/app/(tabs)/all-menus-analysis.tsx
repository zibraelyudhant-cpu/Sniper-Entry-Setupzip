import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { AnimatedCard } from '@/components/animated/AnimatedCard';
import { FuturisticBackground } from '@/components/animated/FuturisticBackground';
import { MENU_COLORS } from '@/constants/theme';

const ACCENT = MENU_COLORS.allMenus;

function formatPrice(price: number): string {
  if (price === 0) return '0';
  if (price < 0.001) return price.toFixed(8);
  if (price < 1) return price.toFixed(6);
  if (price < 100) return price.toFixed(4);
  return price.toFixed(2);
}

// ─── Tipe lokal generik — cukup field yang dibutuhin buat render ringkas ────

interface GenericMenuResult {
  status?: string;
  bias?: 'bullish' | 'bearish';
  message?: string;
  confidence?: number;
  score?: number;
  maxScore?: number;
  confidenceTier?: string;
  grade?: string;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit1?: number;
  rr1?: number;
}

interface AllMenusResult {
  symbol: string;
  timestamp: string;
  breakoutCounterStructural: GenericMenuResult | null;
  scalpingStructural: GenericMenuResult | null;
  scalpingM15: GenericMenuResult | null;
  multiTf: {
    status: string;
    coinTFs?: { timeframe: string; bias: string; adx: number }[];
  } | null;
}

// Status yang dianggap "ada sinyal aktif" per menu (beda-beda tiap tipe)
const POSITIVE_STATUSES = ['siap_breakout', 'siap_retest', 'ready', 'in_zone', 'approaching', 'waiting', 'siap_entry'];

function isPositiveStatus(status?: string): boolean {
  return !!status && POSITIVE_STATUSES.includes(status);
}

function statusLabel(status?: string): string {
  const map: Record<string, string> = {
    siap_breakout: 'Siap Breakout', siap_retest: 'Siap Retest', ready: 'Ready',
    in_zone: 'Siap Entry', approaching: 'Mendekati', waiting: 'Waiting',
    siap_entry: 'Siap Entry', no_setup: 'No Setup', no_trend: 'No Trend',
    no_zone: 'No Zone', skip_conditions: 'Skip', not_extreme: 'Not Extreme',
    expired: 'Expired', no_structure: 'No Structure', skip: 'Skip', error: 'Error',
  };
  return map[status ?? ''] ?? status ?? '—';
}

// ─── Menu Result Card — generic, dipake buat semua 8 menu sinyal ──────────

function MenuResultCard({ title, subtitle, result, colors, index }: {
  title: string; subtitle: string; result: GenericMenuResult | null;
  colors: ReturnType<typeof useColors>; index: number;
}) {
  if (!result) {
    return (
      <AnimatedCard index={index}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: 0.5 }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
          <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 4 }}>Gagal fetch data</Text>
        </View>
      </AnimatedCard>
    );
  }

  const positive = isPositiveStatus(result.status);
  const biasColor = result.bias === 'bullish' ? colors.bullish : result.bias === 'bearish' ? colors.bearish : colors.mutedForeground;
  const statusColor = positive ? (result.bias === 'bearish' ? colors.bearish : colors.bullish) : colors.mutedForeground;
  const scoreDisplay = result.confidence !== undefined ? `${result.confidence}/100`
    : result.score !== undefined ? `${result.score}/${result.maxScore ?? '?'}`
    : null;

  return (
    <AnimatedCard index={index}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: positive ? statusColor : colors.border }]}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
            <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground }}>{subtitle}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={[styles.statusBadge, { backgroundColor: `${statusColor}18`, borderColor: statusColor }]}>
              <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusLabel(result.status)}</Text>
            </View>
            {scoreDisplay && <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground }}>{scoreDisplay}</Text>}
          </View>
        </View>

        {result.bias && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <Text style={[styles.bias, { color: biasColor }]}>{result.bias === 'bullish' ? '▲ LONG' : '▼ SHORT'}</Text>
            {result.grade && <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.gold }}>Grade {result.grade}</Text>}
          </View>
        )}

        {result.message && (
          <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 6, lineHeight: 16 }} numberOfLines={3}>
            {result.message}
          </Text>
        )}

        {positive && result.entryPrice !== undefined && (
          <View style={[styles.condRow, { borderTopColor: colors.border }]}>
            <View style={styles.condItem}>
              <Text style={[styles.condLabel, { color: colors.mutedForeground }]}>ENTRY</Text>
              <Text style={[styles.condValue, { color: colors.foreground }]}>{formatPrice(result.entryPrice)}</Text>
            </View>
            <View style={[styles.condDivider, { backgroundColor: colors.border }]} />
            <View style={styles.condItem}>
              <Text style={[styles.condLabel, { color: colors.mutedForeground }]}>SL</Text>
              <Text style={[styles.condValue, { color: colors.bearish }]}>{result.stopLoss ? formatPrice(result.stopLoss) : '—'}</Text>
            </View>
            <View style={[styles.condDivider, { backgroundColor: colors.border }]} />
            <View style={styles.condItem}>
              <Text style={[styles.condLabel, { color: colors.mutedForeground }]}>TP</Text>
              <Text style={[styles.condValue, { color: colors.bullish }]}>{result.takeProfit1 ? formatPrice(result.takeProfit1) : '—'}</Text>
            </View>
            <View style={[styles.condDivider, { backgroundColor: colors.border }]} />
            <View style={styles.condItem}>
              <Text style={[styles.condLabel, { color: colors.mutedForeground }]}>RR</Text>
              <Text style={[styles.condValue, { color: colors.foreground }]}>{result.rr1 ? `1:${result.rr1.toFixed(1)}` : '—'}</Text>
            </View>
          </View>
        )}
      </View>
    </AnimatedCard>
  );
}

// ─── Multi-TF Mini Card ─────────────────────────────────────────────────────

function MultiTFMiniCard({ data, colors, index }: { data: AllMenusResult['multiTf']; colors: ReturnType<typeof useColors>; index: number }) {
  if (!data || !data.coinTFs) {
    return (
      <AnimatedCard index={index}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: 0.5 }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Multi-TF Scanner</Text>
          <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 4 }}>Gagal fetch data</Text>
        </View>
      </AnimatedCard>
    );
  }
  return (
    <AnimatedCard index={index}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Multi-TF Breakdown</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {data.coinTFs.map((tf) => {
            const c = tf.bias === 'bullish' ? colors.bullish : tf.bias === 'bearish' ? colors.bearish : colors.mutedForeground;
            return (
              <View key={tf.timeframe} style={[styles.tfChip, { borderColor: c, backgroundColor: `${c}15` }]}>
                <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: c }}>{tf.timeframe}</Text>
                <Text style={{ fontSize: 9, fontFamily: 'Inter_400Regular', color: c }}>ADX {tf.adx.toFixed(0)}</Text>
              </View>
            );
          })}
        </View>
      </View>
    </AnimatedCard>
  );
}

// ─── Main Screen ────────────────────────────────────────────────────────────

export default function AllMenusAnalysisScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const [inputSymbol, setInputSymbol] = useState('');
  const [data, setData] = useState<AllMenusResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);

  const handleSearch = useCallback(async () => {
    const sym = inputSymbol.trim().toUpperCase();
    if (!sym) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const normalized = sym.endsWith('USDT') ? sym : `${sym}USDT`;
    setIsLoading(true);
    setIsError(false);
    try {
      const res = await fetch(`/api/all-menus-analysis?symbol=${normalized}`);
      if (!res.ok) throw new Error('fetch failed');
      setData(await res.json());
    } catch {
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  }, [inputSymbol]);

  const base = data?.symbol.replace('USDT', '') ?? '';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FuturisticBackground accentColor={ACCENT} secondaryColor="#FBCFE8" />
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Semua Menu</Text>
        <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>1 koin, hasil dari SEMUA menu sekaligus (3 skill + Multi-TF)</Text>
      </View>

      <View style={styles.inputArea}>
        <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={15} color={ACCENT} />
          <TextInput
            style={[styles.inputText, { color: colors.foreground }]}
            placeholder="Cari koin (BTCUSDT)"
            placeholderTextColor={colors.mutedForeground}
            value={inputSymbol}
            onChangeText={setInputSymbol}
            autoCapitalize="characters"
            autoCorrect={false}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          {inputSymbol.length > 0 && (
            <Pressable onPress={() => setInputSymbol('')}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
        <Pressable onPress={handleSearch} style={[styles.searchBtn, { backgroundColor: ACCENT }]}>
          <Text style={[styles.searchBtnText, { color: colors.primaryForeground }]}>Analisa</Text>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={ACCENT} size="large" />
          <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 12 }}>
            Menganalisa 4 fungsi sekaligus, mungkin agak lama...
          </Text>
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Feather name="alert-triangle" size={32} color={colors.bearish} />
          <Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.foreground, marginTop: 8 }}>Gagal fetch data</Text>
        </View>
      ) : !data ? (
        <View style={styles.center}>
          <Feather name="layers" size={36} color={colors.mutedForeground} />
          <Text style={{ fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.foreground, marginTop: 10, textAlign: 'center' }}>Cari 1 koin buat liat semua hasil</Text>
          <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 4, textAlign: 'center', paddingHorizontal: 32 }}>
            Counter Scalping, Scalping (2 skill) + Multi-TF breakdown
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 2 }}>{base}/USDT</Text>
          <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginBottom: 12 }}>{data.timestamp}</Text>

          <Text style={[styles.groupHeader, { color: MENU_COLORS.breakout }]}>🔄 COUNTER SCALPING</Text>
          <MenuResultCard title="Counter Structural" subtitle="H1→M5, kebalikan dari Skill Structural (Menu Scalping)" result={data.breakoutCounterStructural} colors={colors} index={0} />

          <Text style={[styles.groupHeader, { color: MENU_COLORS.scalping, marginTop: 8 }]}>⚡ SCALPING</Text>
          <MenuResultCard title="Structural" subtitle="M30→M5, breakout+retest" result={data.scalpingStructural} colors={colors} index={1} />
          <MenuResultCard title="Scalping 15M" subtitle="M15→M1 eksekusi" result={data.scalpingM15} colors={colors} index={2} />

          <Text style={[styles.groupHeader, { color: MENU_COLORS.multiTfScan, marginTop: 8 }]}>📊 MULTI-TF</Text>
          <MultiTFMiniCard data={data.multiTf} colors={colors} index={3} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  inputArea: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', gap: 8 },
  inputBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, height: 44,
  },
  inputText: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium' },
  searchBtn: { paddingHorizontal: 18, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  searchBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  groupHeader: { fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 0.5, marginBottom: 8 },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitle: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  statusBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  bias: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  condRow: { flexDirection: 'row', marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  condItem: { flex: 1 },
  condLabel: { fontSize: 9, fontFamily: 'Inter_400Regular', marginBottom: 2 },
  condValue: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  condDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: 8 },
  tfChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, alignItems: 'center' },
});