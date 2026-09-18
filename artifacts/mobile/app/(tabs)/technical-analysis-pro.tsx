import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { customFetch } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { MENU_COLORS } from '@/constants/theme';
import { CyberBackground } from '@/components/animated/CyberBackground';
import { AnimatedTabSwitcher } from '@/components/animated/AnimatedTabSwitcher';
import { LongShortBattleCard } from '@/components/animated/LongShortBattleCard';
import { CyberCard } from '@/components/animated/CyberCard';
import { CyberBadge } from '@/components/animated/CyberBadge';
import { CyberBigNumber } from '@/components/animated/CyberBigNumber';

const ACCENT = MENU_COLORS.allMenus;
const CYAN = '#00FFF0';
const MAGENTA = '#FF00E5';
const NEUTRAL = '#5B6478';
const AMBER = '#FFD700';

type TFOption = 'D1' | 'H4' | 'H1' | 'M30' | 'M15' | 'M5';
const TF_OPTIONS: TFOption[] = ['D1', 'H4', 'H1', 'M30', 'M15', 'M5'];

type FeatureKey = 'trend' | 'multiTf' | 'transition' | 'breakoutBounce' | 'longShort';
const FEATURES: { key: FeatureKey; label: string; needsTf: boolean }[] = [
  { key: 'trend', label: 'Tren', needsTf: true },
  { key: 'multiTf', label: 'Multi-TF', needsTf: false },
  { key: 'transition', label: 'Transisi', needsTf: true },
  { key: 'breakoutBounce', label: 'SNR', needsTf: true },
  { key: 'longShort', label: 'Skor', needsTf: false },
];

function featureUrl(symbol: string, feature: FeatureKey, tf: TFOption): string {
  const enc = encodeURIComponent(symbol);
  switch (feature) {
    case 'trend': return `/api/technical-analysis-pro/trend?symbol=${enc}&tf=${tf}`;
    case 'multiTf': return `/api/technical-analysis-pro/multi-tf?symbol=${enc}`;
    case 'transition': return `/api/technical-analysis-pro/transition?symbol=${enc}&tf=${tf}`;
    case 'breakoutBounce': return `/api/technical-analysis-pro/breakout-bounce?symbol=${enc}&tf=${tf}`;
    case 'longShort': return `/api/technical-analysis-pro/long-short-score?symbol=${enc}`;
  }
}

export default function TechnicalAnalysisProScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const [symbolInput, setSymbolInput] = useState('');
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [activeFeature, setActiveFeature] = useState<FeatureKey>('trend');
  const [tf, setTf] = useState<TFOption>('H4');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['technical-analysis-pro', activeSymbol, activeFeature, tf],
    queryFn: () => customFetch<any>(featureUrl(activeSymbol!, activeFeature, tf)),
    enabled: !!activeSymbol,
  });

  const currentFeatureMeta = FEATURES.find(f => f.key === activeFeature)!;

  const handleAnalisa = () => {
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) return;
    setActiveSymbol(symbol.endsWith('USDT') ? symbol : `${symbol}USDT`);
  };

  return (
    <View style={[styles.container, { backgroundColor: '#050208' }]}>
      <CyberBackground />

      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: 'rgba(255,0,229,0.2)', backgroundColor: '#050208' }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Technical Analysis PRO</Text>
        <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>Tren, Multi-TF, Transisi, SNR & Skor Long/Short</Text>

        <View style={[styles.inputArea]}>
          <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.inputText, { color: colors.foreground }]}
              placeholder="Contoh: BTCUSDT"
              placeholderTextColor={colors.mutedForeground}
              value={symbolInput}
              onChangeText={setSymbolInput}
              autoCapitalize="characters"
              onSubmitEditing={handleAnalisa}
              returnKeyType="search"
            />
          </View>
          <TouchableOpacity style={[styles.analyzeBtn, { backgroundColor: ACCENT }]} onPress={handleAnalisa}>
            <Text style={[styles.analyzeBtnText, { color: '#031A1F' }]}>Analisa</Text>
          </TouchableOpacity>
        </View>

        {activeSymbol && (
          <View style={{ marginTop: 12 }}>
            <AnimatedTabSwitcher
              tabs={FEATURES.map(f => ({ key: f.key, label: f.label }))}
              active={activeFeature}
              onChange={(k) => setActiveFeature(k as FeatureKey)}
              accentColor={ACCENT}
            />
          </View>
        )}
      </View>

      {!activeSymbol ? (
        <View style={styles.emptyState}>
          <Feather name="bar-chart-2" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Pilih koin dulu</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Ketik simbol koin di atas, lalu tekan Analisa</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {currentFeatureMeta.needsTf && (
            <View style={styles.tfRow}>
              {TF_OPTIONS.map(opt => {
                const active = tf === opt;
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.tfChip, { backgroundColor: active ? colors.gold : colors.card, borderColor: active ? colors.gold : colors.border }]}
                    onPress={() => setTf(opt)}
                  >
                    <Text style={[styles.tfChipText, { color: active ? colors.background : colors.mutedForeground }]}>{opt}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {isLoading && <ActivityIndicator style={{ marginTop: 32 }} color={colors.highlight} />}
          {isError && (
            <View style={[styles.errorBox, { backgroundColor: `${colors.bearish}15`, borderColor: `${colors.bearish}40` }]}>
              <Feather name="alert-triangle" size={16} color={colors.bearish} />
              <Text style={[styles.errorText, { color: colors.bearish }]}>{error instanceof Error ? error.message : 'Gagal ambil data'}</Text>
            </View>
          )}

          {!isLoading && !isError && data && activeFeature === 'longShort' && (
            <LongShortBattleCard
              d1Score={data.d1Score}
              d1Direction={data.d1Direction}
              h4Score={data.h4Score}
              h4Direction={data.h4Direction}
              winner={data.winner}
              summary={
                data.winner === 'neutral'
                  ? 'Skor D1 dan H4 sama — netral, tunggu konfirmasi breakout/bounce'
                  : `${data.d1Score > data.h4Score ? 'D1' : 'H4'} punya skor lebih tinggi saat ini`
              }
            />
          )}

          {!isLoading && !isError && data && activeFeature === 'trend' && <TrendResultView data={data} />}
          {!isLoading && !isError && data && activeFeature === 'multiTf' && <MultiTfResultView data={data} />}
          {!isLoading && !isError && data && activeFeature === 'transition' && <TransitionResultView data={data} />}
          {!isLoading && !isError && data && activeFeature === 'breakoutBounce' && <BreakoutBounceResultView data={data} />}
        </ScrollView>
      )}
    </View>
  );
}

// ═══ FITUR 1: Identifikasi Tren ═══════════════════════════════════════════
function TrendResultView({ data }: { data: any }) {
  const isBull = data.classification?.startsWith('bullish');
  const isBear = data.classification?.startsWith('bearish');
  const color = isBull ? CYAN : isBear ? MAGENTA : NEUTRAL;
  const label: Record<string, string> = { bullish: 'BULLISH', bullish_strong: 'BULLISH STRONG', bearish: 'BEARISH', bearish_strong: 'BEARISH STRONG', none: 'BELUM ADA TREND' };
  return (
    <CyberCard accentColor={color} style={{ marginBottom: 12 }}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardTitle}>// IDENTIFIKASI TREN</Text>
        <CyberBadge label={label[data.classification] ?? data.classification} color={color} pulsing={isBull || isBear} />
      </View>
      <View style={styles.numRow}>
        <CyberBigNumber value={data.adx?.toFixed(1) ?? '—'} label="ADX(14)" color={color} />
        <View style={styles.statBox}>
          <Text style={[styles.statValue, { color }]}>{data.forceIndexValue?.toFixed(2) ?? '—'}</Text>
          <Text style={styles.statLabel}>FORCE INDEX</Text>
        </View>
      </View>
      {(data.reasoning ?? []).map((r: string, i: number) => (
        <Text key={i} style={styles.reasoningText}>{r}</Text>
      ))}
    </CyberCard>
  );
}

// ═══ FITUR 2: Multi-TF Reading ═════════════════════════════════════════════
function MultiTfResultView({ data }: { data: any[] }) {
  return (
    <View>
      {data.map((pair, i) => {
        const color = pair.direction === 'bullish' ? CYAN : pair.direction === 'bearish' ? MAGENTA : NEUTRAL;
        return (
          <CyberCard key={i} accentColor={color} style={{ marginBottom: 12 }}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>{pair.pairLabel}</Text>
              <CyberBadge label={pair.triggered ? pair.direction?.toUpperCase() : 'BELUM TRIGGER'} color={color} pulsing={pair.triggered} />
            </View>
            <Text style={styles.reasoningText}>{pair.interpretation}</Text>
            <View style={styles.numRow}>
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: CYAN }]}>{pair.higherTF.adx.toFixed(1)}</Text>
                <Text style={styles.statLabel}>{pair.higherTF.tf} · ADX</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: MAGENTA }]}>{pair.lowerTF.adx.toFixed(1)}</Text>
                <Text style={styles.statLabel}>{pair.lowerTF.tf} · ADX</Text>
              </View>
            </View>
            <Text style={styles.tfDetail}>{pair.higherTF.tf}: FI {pair.higherTF.forceIndexValue.toFixed(2)}, RSI {pair.higherTF.rsi.toFixed(1)}</Text>
            <Text style={styles.tfDetail}>{pair.lowerTF.tf}: FI {pair.lowerTF.forceIndexValue.toFixed(2)}, RSI {pair.lowerTF.rsi.toFixed(1)}</Text>
          </CyberCard>
        );
      })}
    </View>
  );
}

// ═══ FITUR 3: Identifikasi Transisi ════════════════════════════════════════
function TransitionResultView({ data }: { data: any }) {
  const isTransition = data.classification === 'transition';
  const color = isTransition ? AMBER : data.classification?.startsWith('bullish') ? CYAN : data.classification?.startsWith('bearish') ? MAGENTA : NEUTRAL;
  return (
    <CyberCard accentColor={color} style={{ marginBottom: 12 }}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardTitle}>// IDENTIFIKASI TRANSISI</Text>
        <CyberBadge label={isTransition ? `TRANSISI ${data.bias?.toUpperCase()}` : data.classification?.toUpperCase()} color={color} pulsing={isTransition} />
      </View>
      <Text style={[styles.reasoningText, { marginTop: 0 }]}>{data.breakQualityLabel}</Text>
      {(data.reasoning ?? []).map((r: string, i: number) => (
        <Text key={i} style={styles.reasoningText}>{r}</Text>
      ))}
    </CyberCard>
  );
}

// ═══ FITUR 4: Breakout & Bounce SNR ════════════════════════════════════════
function BreakoutBounceResultView({ data }: { data: any }) {
  const catLabel: Record<string, string> = {
    false_breakout: 'FALSE BREAKOUT', strong_breakout: 'BREAKOUT TREN KUAT',
    strong_bounce: 'BOUNCE KUAT', weak_bounce: 'BOUNCE LEMAH', none: 'GAK ADA SINYAL',
  };
  const catColor: Record<string, string> = {
    false_breakout: NEUTRAL, strong_breakout: CYAN, strong_bounce: AMBER, weak_bounce: NEUTRAL, none: NEUTRAL,
  };
  const color = catColor[data.category] ?? NEUTRAL;
  return (
    <CyberCard accentColor={color} style={{ marginBottom: 12 }}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardTitle}>// BREAKOUT & BOUNCE SNR</Text>
        <CyberBadge label={catLabel[data.category] ?? data.category} color={color} pulsing={data.category !== 'none'} />
      </View>
      <Text style={[styles.reasoningText, { marginTop: 0, marginBottom: 12 }]}>{data.interpretation}</Text>
      <View style={styles.numRow}>
        <CyberBigNumber value={data.adx?.toFixed(1) ?? '—'} label="ADX(14)" color={color} fontSize={24} />
        <View style={styles.statBox}>
          <Text style={[styles.statValue, { color }]}>{data.volumeRatio?.toFixed(2) ?? '—'}x</Text>
          <Text style={styles.statLabel}>VOL vs MA20</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={[styles.statValue, { color }]}>{data.rsi?.toFixed(1) ?? '—'}</Text>
          <Text style={styles.statLabel}>RSI(13)</Text>
        </View>
      </View>
      <Text style={styles.tfDetail}>Force Index: {data.forceIndexValue?.toFixed(2) ?? '—'}</Text>
      {data.nearSnr && <Text style={styles.tfDetail}>Dekat {data.snrType} @ {data.snrLevel?.toFixed(6)}</Text>}
    </CyberCard>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2, marginBottom: 12 },
  inputArea: { flexDirection: 'row', gap: 8 },
  inputBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, height: 40 },
  inputText: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
  analyzeBtn: { paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  analyzeBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptySub: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  scrollContent: { padding: 16, paddingBottom: 48 },
  tfRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  tfChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  tfChipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, borderWidth: 1, padding: 12, marginTop: 8 },
  errorText: { fontSize: 13, fontFamily: 'Inter_500Medium', flex: 1 },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { color: '#00FFF0', fontSize: 11, fontFamily: 'Courier', letterSpacing: 1.5, fontWeight: '700' },
  numRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4, marginBottom: 8 },
  statBox: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 16, fontFamily: 'Courier', fontWeight: '700' },
  statLabel: { fontSize: 10, color: '#B8AEC9', marginTop: 4, fontWeight: '600', letterSpacing: 0.3 },
  reasoningText: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 6, lineHeight: 19, color: '#D8D0E4' },
  tfDetail: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4, color: '#B8AEC9' },
});