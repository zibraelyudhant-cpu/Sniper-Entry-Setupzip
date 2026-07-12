import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useGetSmcAnalysis } from '@workspace/api-client-react';
import type { SniperResult } from '@workspace/api-client-react';

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatPrice(price: number): string {
  if (price >= 10000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function formatSymbolClean(symbol: string): string {
  return symbol.replace('USDT', '/USDT');
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
}

// ─── Section Components ───────────────────────────────────────────────────────

interface SectionProps { title: string; children: React.ReactNode }
function Section({ title, children }: SectionProps) {
  const colors = useColors();
  return (
    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{title}</Text>
      {children}
    </View>
  );
}

interface RowProps { label: string; value: string; valueColor?: string; icon?: React.ReactNode }
function Row({ label, value, valueColor, icon }: RowProps) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon}
        <Text style={[styles.rowValue, { color: valueColor ?? colors.foreground }]}>{value}</Text>
      </View>
    </View>
  );
}

// ─── Status Screens ───────────────────────────────────────────────────────────

function NoTrendScreen({ data, colors }: { data: SniperResult; colors: ReturnType<typeof useColors> }) {
  return (
    <Section title="STATUS">
      <View style={styles.statusBlock}>
        <Feather name="alert-triangle" size={32} color={colors.warning} />
        <Text style={[styles.statusTitle, { color: colors.warning }]}>Tidak Ada Trend Jelas</Text>
        <Text style={[styles.statusMsg, { color: colors.mutedForeground }]}>{data.message}</Text>
        <View style={styles.trendRow}>
          <TrendBadge label="H4" bias={data.h4?.bias ?? 'ranging'} strength={data.h4?.strength ?? 'neutral'} colors={colors} />
        </View>
      </View>
    </Section>
  );
}

function NoZoneScreen({ data, colors }: { data: SniperResult; colors: ReturnType<typeof useColors> }) {
  return (
    <>
      <TrendSection data={data} colors={colors} />
      <Section title="STATUS">
        <View style={styles.statusBlock}>
          <Feather name="map-pin" size={32} color={colors.warning} />
          <Text style={[styles.statusTitle, { color: colors.warning }]}>Tidak Ada Zona Valid di H1</Text>
          <Text style={[styles.statusMsg, { color: colors.mutedForeground }]}>{data.message}</Text>
        </View>
      </Section>
    </>
  );
}

function SkipScreen({ data, colors }: { data: SniperResult; colors: ReturnType<typeof useColors> }) {
  return (
    <>
      <TrendSection data={data} colors={colors} />
      <Section title="SETUP DILEWATI">
        <View style={styles.statusBlock}>
          <Feather name="slash" size={32} color={colors.bearish} />
          <Text style={[styles.statusTitle, { color: colors.bearish }]}>Kondisi Tidak Mendukung</Text>
          {(data.skipReasons ?? []).map((r, i) => (
            <View key={i} style={styles.skipReason}>
              <Feather name="x-circle" size={13} color={colors.bearish} />
              <Text style={[styles.skipReasonText, { color: colors.foreground }]}>{r}</Text>
            </View>
          ))}
        </View>
      </Section>
      <MarketSection data={data} colors={colors} />
    </>
  );
}

function TrendBadge({
  label, bias, strength, colors,
}: {
  label: string;
  bias: string;
  strength: string;
  colors: ReturnType<typeof useColors>;
}) {
  const biasColor =
    bias === 'bullish' ? colors.bullish : bias === 'bearish' ? colors.bearish : colors.mutedForeground;
  return (
    <View style={[styles.trendBadge, { borderColor: biasColor }]}>
      <Text style={[styles.trendBadgeLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.trendBadgeBias, { color: biasColor }]}>{bias.toUpperCase()}</Text>
      {strength !== 'neutral' && (
        <Text style={[styles.trendBadgeStrength, { color: strength === 'strong' ? colors.gold : colors.mutedForeground }]}>
          [{strength.toUpperCase()}]
        </Text>
      )}
    </View>
  );
}

function TrendSection({ data, colors }: { data: SniperResult; colors: ReturnType<typeof useColors> }) {
  return (
    <Section title="TREND">
      <View style={styles.trendRow}>
        {data.h4 && <TrendBadge label="H4" bias={data.h4.bias} strength={data.h4.strength} colors={colors} />}
      </View>
    </Section>
  );
}

function MarketSection({ data, colors }: { data: SniperResult; colors: ReturnType<typeof useColors> }) {
  const rsiColor =
    (data.rsi ?? 50) > 70 ? colors.bearish : (data.rsi ?? 50) < 30 ? colors.bullish : colors.foreground;
  const volColor =
    data.volumeTrend === 'increasing' ? colors.bullish : data.volumeTrend === 'decreasing' ? colors.bearish : colors.foreground;
  const frColor =
    (data.fundingRate ?? 0) > 0.05 ? colors.bearish : (data.fundingRate ?? 0) < -0.05 ? colors.bullish : colors.foreground;
  const oiColor =
    (data.oiChange ?? 0) > 0 ? colors.bullish : colors.bearish;

  return (
    <Section title="KONDISI PASAR">
      <Row
        label="RSI H1"
        value={`${(data.rsi ?? 0).toFixed(1)}${data.rsiDivergence ? ' ⚠ divergence' : ' ✓'}`}
        valueColor={data.rsiDivergence ? colors.warning : rsiColor}
      />
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <Row
        label="Volume H1"
        value={
          data.volumeTrend === 'increasing' ? 'Meningkat ✓'
          : data.volumeTrend === 'decreasing' ? 'Menurun ⚠'
          : 'Netral'
        }
        valueColor={volColor}
      />
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <Row
        label="OI Change"
        value={`${(data.oiChange ?? 0) >= 0 ? '+' : ''}${(data.oiChange ?? 0).toFixed(2)}%`}
        valueColor={oiColor}
      />
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <Row
        label="Funding Rate"
        value={`${(data.fundingRate ?? 0) >= 0 ? '+' : ''}${(data.fundingRate ?? 0).toFixed(3)}%`}
        valueColor={frColor}
      />
    </Section>
  );
}

function ReadyScreen({ data, colors }: { data: SniperResult; colors: ReturnType<typeof useColors> }) {
  const isBuy = data.bias === 'bullish';
  const biasColor = isBuy ? colors.bullish : colors.bearish;

  return (
    <>
      <TrendSection data={data} colors={colors} />

      {/* Main Entry Setup */}
      <Section title="SNIPER ENTRY SETUP">
        {/* Header info */}
        <View style={[styles.entryHeader, { backgroundColor: colors.surfaceMid, borderRadius: 8, padding: 12, marginBottom: 12 }]}>
          <View style={styles.entryHeaderRow}>
            <Text style={[styles.entryLabel, { color: colors.mutedForeground }]}>Harga Saat Ini</Text>
            <Text style={[styles.entryCurrentPrice, { color: colors.foreground }]}>
              ${formatPrice(data.currentPrice)}
            </Text>
          </View>
          <Text style={[styles.entryTime, { color: colors.mutedForeground }]}>
            {formatTimestamp(data.timestamp)}
          </Text>
        </View>

        {/* Direction badge */}
        <View style={[styles.directionBadge, { backgroundColor: `${biasColor}18`, borderColor: biasColor }]}>
          <Feather
            name={isBuy ? 'arrow-up-right' : 'arrow-down-right'}
            size={18}
            color={biasColor}
          />
          <Text style={[styles.directionText, { color: biasColor }]}>
            {isBuy ? 'BUY' : 'SELL'}
          </Text>
        </View>

        {/* Entry levels */}
        <View style={[styles.levelsCard, { backgroundColor: colors.surfaceMid, borderColor: colors.border }]}>
          <LevelRow label="ENTRY IDEAL" price={data.entryPrice ?? 0} color={colors.highlight} colors={colors} big />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <LevelRow label="STOP LOSS" price={data.stopLoss ?? 0} color={colors.bearish} colors={colors} sub="ATR-based" />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <LevelRow label="TAKE PROFIT 1" price={data.takeProfit1 ?? 0} color={colors.bullish} colors={colors} sub="R:R 1:1.5" />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <LevelRow label="TAKE PROFIT 2" price={data.takeProfit2 ?? 0} color={colors.gold} colors={colors} sub="R:R 1:3" />
        </View>

        {/* Zone info */}
        <View style={styles.metaGrid}>
          <MetaItem label="Zona Entry" value={data.zoneType ?? ''} colors={colors} />
          {data.zoneRange && (
            <MetaItem
              label="Range Zona"
              value={`$${formatPrice(data.zoneRange.low)} – $${formatPrice(data.zoneRange.high)}`}
              colors={colors}
            />
          )}
          <MetaItem label="Refine (15M)" value={data.refinedZoneType ?? data.zoneType ?? ''} colors={colors} />
          <MetaItem
            label="Konfirmasi (5M)"
            value={data.entryConfirmed ? `✓ ${data.confirmationCandle}` : `⚠ ${data.confirmationCandle}`}
            valueColor={data.entryConfirmed ? colors.bullish : colors.warning}
            colors={colors}
          />
        </View>

        {/* Timing */}
        <View style={[styles.timingRow, { backgroundColor: colors.surfaceMid, borderRadius: 8 }]}>
          <TimingItem label="Setup Valid" value={`${data.setupValidHours}j`} colors={colors} />
          <View style={[styles.timingDivider, { backgroundColor: colors.border }]} />
          <TimingItem label="Est. Hit" value={`~${data.estimatedHitHours}j`} colors={colors} />
          <View style={[styles.timingDivider, { backgroundColor: colors.border }]} />
          <TimingItem label="Kadaluarsa" value={`${data.expiryHours}j`} colors={colors} />
        </View>

        {/* Reasoning */}
        {data.reasoning && (
          <View style={[styles.reasoning, { backgroundColor: colors.surfaceMid, borderLeftColor: colors.highlight }]}>
            <Text style={[styles.reasoningLabel, { color: colors.mutedForeground }]}>Alasan</Text>
            <Text style={[styles.reasoningText, { color: colors.foreground }]}>{data.reasoning}</Text>
          </View>
        )}

        {/* Disclaimer */}
        <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
          * Hanya referensi manual. Tidak ada auto-eksekusi.
        </Text>
      </Section>

      <MarketSection data={data} colors={colors} />
    </>
  );
}

interface LevelRowProps {
  label: string;
  price: number;
  color: string;
  colors: ReturnType<typeof useColors>;
  sub?: string;
  big?: boolean;
}
function LevelRow({ label, price, color, colors, sub, big }: LevelRowProps) {
  return (
    <View style={styles.levelRow}>
      <View>
        <Text style={[styles.levelLabel, { color: colors.mutedForeground, fontSize: big ? 13 : 11 }]}>
          {label}
        </Text>
        {sub && <Text style={[styles.levelSub, { color: colors.mutedForeground }]}>{sub}</Text>}
      </View>
      <Text style={[styles.levelPrice, { color, fontSize: big ? 20 : 16, fontFamily: big ? 'Inter_700Bold' : 'Inter_600SemiBold' }]}>
        ${formatPrice(price)}
      </Text>
    </View>
  );
}

interface MetaItemProps { label: string; value: string; valueColor?: string; colors: ReturnType<typeof useColors> }
function MetaItem({ label, value, valueColor, colors }: MetaItemProps) {
  return (
    <View style={[styles.metaItem, { backgroundColor: colors.surfaceMid, borderColor: colors.border }]}>
      <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.metaValue, { color: valueColor ?? colors.foreground }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

interface TimingItemProps { label: string; value: string; colors: ReturnType<typeof useColors> }
function TimingItem({ label, value, colors }: TimingItemProps) {
  return (
    <View style={styles.timingItem}>
      <Text style={[styles.timingValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.timingLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SniperScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ symbol?: string }>();

  const [inputSymbol, setInputSymbol] = useState(params.symbol ?? '');
  const [querySymbol, setQuerySymbol] = useState(params.symbol ?? '');

  // Update when navigated from screener
  useEffect(() => {
    if (params.symbol) {
      setInputSymbol(params.symbol);
      setQuerySymbol(params.symbol);
    }
  }, [params.symbol]);

  const { data, isLoading, isError, refetch } = useGetSmcAnalysis(
    { symbol: querySymbol },
    { query: { enabled: !!querySymbol, staleTime: 120_000 } }
  );

  const handleAnalyze = useCallback(() => {
    const sym = inputSymbol.trim().toUpperCase();
    if (!sym) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setQuerySymbol(sym);
  }, [inputSymbol]);

  const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const bottomPadding = 60 + (Platform.OS === 'web' ? 34 : insets.bottom);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Sticky Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: topPadding + 12,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Sniper Entry</Text>
        <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
          Analisa top-down SMC presisi
        </Text>

        <View style={styles.searchRow}>
          <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="crosshair" size={15} color={colors.primary} />
            <TextInput
              style={[styles.inputText, { color: colors.foreground }]}
              placeholder="Masukkan pair (BTCUSDT)"
              placeholderTextColor={colors.mutedForeground}
              value={inputSymbol}
              onChangeText={setInputSymbol}
              autoCapitalize="characters"
              returnKeyType="search"
              onSubmitEditing={handleAnalyze}
            />
          </View>
          <Pressable
            onPress={handleAnalyze}
            style={({ pressed }) => [
              styles.analyzeBtn,
              { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={[styles.analyzeBtnText, { color: colors.primaryForeground }]}>Analisa</Text>
          </Pressable>
        </View>
      </View>

      {/* Content */}
      {!querySymbol ? (
        <View style={styles.emptyState}>
          <Feather name="crosshair" size={52} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Pilih Pair</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Ketik pair di atas atau pilih dari Screener
          </Text>
        </View>
      ) : isLoading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Menganalisa {formatSymbolClean(querySymbol)}
          </Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            H4 → H1 → 15M → 5M...
          </Text>
        </View>
      ) : isError ? (
        <View style={styles.emptyState}>
          <Feather name="alert-circle" size={40} color={colors.bearish} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Gagal menganalisa</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Periksa nama pair dan koneksi internet
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : data ? (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }}
          showsVerticalScrollIndicator={false}
        >
          {/* Symbol + timestamp header */}
          <View style={styles.resultHeader}>
            <Text style={[styles.resultSymbol, { color: colors.foreground }]}>
              {formatSymbolClean(data.symbol)}
            </Text>
            <Pressable onPress={() => refetch()} style={styles.refreshBtn}>
              <Feather name="refresh-cw" size={15} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {data.status === 'no_trend' && <NoTrendScreen data={data} colors={colors} />}
          {data.status === 'no_zone' && <NoZoneScreen data={data} colors={colors} />}
          {data.status === 'skip_conditions' && <SkipScreen data={data} colors={colors} />}
          {data.status === 'ready' && <ReadyScreen data={data} colors={colors} />}
          {data.status === 'error' && (
            <Section title="ERROR">
              <View style={styles.statusBlock}>
                <Feather name="x-circle" size={32} color={colors.bearish} />
                <Text style={[styles.statusMsg, { color: colors.mutedForeground }]}>{data.message}</Text>
              </View>
            </Section>
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
    marginBottom: 12,
  },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  inputBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  inputText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 0.5,
  },
  analyzeBtn: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  analyzeBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
    marginTop: 8,
  },
  emptySub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 8,
  },
  retryText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  resultSymbol: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.3,
  },
  refreshBtn: { padding: 6 },
  section: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  rowLabel: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  rowValue: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  statusBlock: { alignItems: 'center', gap: 10, paddingVertical: 8 },
  statusTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', textAlign: 'center', marginTop: 4 },
  statusMsg: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  trendRow: { flexDirection: 'row', gap: 10, justifyContent: 'center', marginTop: 12 },
  trendBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    minWidth: 90,
    gap: 2,
  },
  trendBadgeLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', letterSpacing: 0.5 },
  trendBadgeBias: { fontSize: 14, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  trendBadgeStrength: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  skipReason: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 6, paddingHorizontal: 4 },
  skipReasonText: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1, lineHeight: 20 },
  entryHeader: {},
  entryHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  entryLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', letterSpacing: 0.5 },
  entryCurrentPrice: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  entryTime: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  directionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 10,
    marginBottom: 12,
  },
  directionText: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: 2 },
  levelsCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  levelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  levelLabel: { fontFamily: 'Inter_500Medium', letterSpacing: 0.5 },
  levelSub: { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 2 },
  levelPrice: { letterSpacing: -0.5 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  metaItem: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    width: '47.5%',
    flexGrow: 1,
  },
  metaLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', letterSpacing: 0.5, marginBottom: 4 },
  metaValue: { fontSize: 12, fontFamily: 'Inter_600SemiBold', lineHeight: 18 },
  timingRow: {
    flexDirection: 'row',
    marginBottom: 12,
    overflow: 'hidden',
  },
  timingItem: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  timingValue: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  timingLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 2 },
  timingDivider: { width: StyleSheet.hairlineWidth },
  reasoning: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    paddingVertical: 10,
    paddingRight: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  reasoningLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', letterSpacing: 0.5, marginBottom: 4 },
  reasoningText: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  disclaimer: { fontSize: 10, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 4 },
});
