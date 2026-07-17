import React, { useCallback, useState } from 'react';
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
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useGetBreakout, useGetBreakoutScan } from '@workspace/api-client-react';
import type { BreakoutResult } from '@workspace/api-client-react';

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatPrice(price: number): string {
  if (price >= 10000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function formatSymbol(symbol: string) {
  return { base: symbol.replace('USDT', ''), quote: 'USDT' };
}

// ─── Badge tipe breakout ──────────────────────────────────────────────────────

function BreakoutTypeBadge({ type, colors }: { type: string; colors: ReturnType<typeof useColors> }) {
  const map: Record<string, { label: string; color: string }> = {
    sr_horizontal: { label: 'S/R HORIZONTAL', color: '#3B82F6' },
    structure_hh: { label: 'STRUKTUR HH/LL', color: '#8B5CF6' },
    range_squeeze: { label: 'RANGE SQUEEZE', color: '#F97316' },
  };
  const item = map[type] ?? { label: type.toUpperCase(), color: colors.mutedForeground };
  return (
    <View style={[styles.typeBadge, { borderColor: item.color, backgroundColor: `${item.color}18` }]}>
      <Text style={[styles.typeBadgeText, { color: item.color }]}>{item.label}</Text>
    </View>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, colors }: { status: string; colors: ReturnType<typeof useColors> }) {
  const map: Record<string, { label: string; color: string }> = {
    ready: { label: '✅ SIAP ENTRY', color: colors.bullish },
    in_zone: { label: '👀 DI ZONA', color: '#14B8A6' },
    approaching: { label: '⏳ MENUJU ZONA', color: colors.gold },
  };
  const item = map[status] ?? { label: status.toUpperCase(), color: colors.mutedForeground };
  return (
    <View style={[styles.statusBadge, { borderColor: item.color, backgroundColor: `${item.color}18` }]}>
      <Text style={[styles.statusBadgeText, { color: item.color }]}>{item.label}</Text>
    </View>
  );
}

function PatternConfidenceBadge({ confidence, patterns, colors }: {
  confidence: string;
  patterns: string[];
  colors: ReturnType<typeof useColors>;
}) {
  const map: Record<string, { label: string; color: string }> = {
    HIGH: { label: '🔥 PATTERN HIGH', color: colors.bullish },
    MEDIUM: { label: '📊 PATTERN MED', color: colors.gold },
    LOW: { label: '⚠ PATTERN LOW', color: colors.mutedForeground },
    NONE: { label: '— NO PATTERN', color: colors.mutedForeground },
  };
  const item = map[confidence] ?? { label: confidence, color: colors.mutedForeground };
  return (
    <View style={{ gap: 4 }}>
      <View style={[styles.statusBadge, { borderColor: item.color, backgroundColor: `${item.color}18` }]}>
        <Text style={[styles.statusBadgeText, { color: item.color }]}>{item.label}</Text>
      </View>
      {patterns.length > 0 && (
        <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
          {patterns.join(' · ')}
        </Text>
      )}
    </View>
  );
}

// ─── Coin Card ────────────────────────────────────────────────────────────────

function CoinCard({ coin, onPress, colors }: { coin: BreakoutResult; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  const { base, quote } = formatSymbol(coin.symbol);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
    >
      <View style={styles.cardRow1}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
            <Text style={[styles.cardBase, { color: colors.foreground }]}>{base}</Text>
            <Text style={[styles.cardQuote, { color: colors.mutedForeground }]}>/{quote}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            {coin.breakoutType && <BreakoutTypeBadge type={coin.breakoutType} colors={colors} />}
            <View style={[styles.volBadge, { borderColor: colors.border }]}>
              <Text style={[styles.volText, { color: colors.mutedForeground }]}>Vol {coin.volumeRatio?.toFixed(1)}x</Text>
            </View>
            {coin.patternConfidence && coin.patternConfidence !== 'LOW' && coin.patternConfidence !== 'NONE' && (
              <View style={[styles.volBadge, { borderColor: coin.patternConfidence === 'HIGH' ? colors.bullish : colors.gold }]}>
                <Text style={[styles.volText, { color: coin.patternConfidence === 'HIGH' ? colors.bullish : colors.gold }]}>
                  {coin.patternConfidence === 'HIGH' ? '🔥 PATTERN HIGH' : '📊 PATTERN MED'}
                </Text>
              </View>
            )}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <StatusBadge status={coin.status} colors={colors} />
          <Text style={[styles.cardPrice, { color: colors.foreground }]}>{formatPrice(coin.currentPrice)}</Text>
        </View>
        <Feather name="chevron-right" size={14} color={colors.mutedForeground} style={{ marginLeft: 4 }} />
      </View>

      {coin.entryPrice && (
        <View style={[styles.cardRow2, { borderTopColor: colors.border }]}>
          <View style={styles.levelItem}>
            <Text style={[styles.levelLabel, { color: colors.mutedForeground }]}>ENTRY</Text>
            <Text style={[styles.levelValue, { color: colors.foreground }]}>{formatPrice(coin.entryPrice)}</Text>
          </View>
          <View style={[styles.levelDivider, { backgroundColor: colors.border }]} />
          <View style={styles.levelItem}>
            <Text style={[styles.levelLabel, { color: colors.mutedForeground }]}>SL</Text>
            <Text style={[styles.levelValue, { color: colors.bearish }]}>{coin.stopLoss ? formatPrice(coin.stopLoss) : '—'}</Text>
          </View>
          <View style={[styles.levelDivider, { backgroundColor: colors.border }]} />
          <View style={styles.levelItem}>
            <Text style={[styles.levelLabel, { color: colors.mutedForeground }]}>TP1</Text>
            <Text style={[styles.levelValue, { color: colors.bullish }]}>{coin.takeProfit1 ? formatPrice(coin.takeProfit1) : '—'}</Text>
          </View>
          <View style={[styles.levelDivider, { backgroundColor: colors.border }]} />
          <View style={styles.levelItem}>
            <Text style={[styles.levelLabel, { color: colors.mutedForeground }]}>TP2</Text>
            <Text style={[styles.levelValue, { color: colors.gold }]}>{coin.takeProfit2 ? formatPrice(coin.takeProfit2) : '—'}</Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

// ─── Tab SCAN ─────────────────────────────────────────────────────────────────

function ScanTab({ colors }: { colors: ReturnType<typeof useColors> }) {
  const insets = useSafeAreaInsets();
  const bottomPadding = insets.bottom + 80;
  const { data, isLoading, isError, refetch } = useGetBreakoutScan({
    query: { staleTime: 5 * 60 * 1000 },
  });

  const handleCoinPress = useCallback((coin: BreakoutResult) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/(tabs)/breakout',
      params: { tab: 'analisa', symbol: coin.symbol },
    });
  }, []);

  const ready = (data?.coins ?? []).filter(c => c.status === 'ready');
  const inZone = (data?.coins ?? []).filter(c => c.status === 'in_zone');
  const approaching = (data?.coins ?? []).filter(c => c.status === 'approaching');
  const total = ready.length + inZone.length + approaching.length;

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Scanning breakout...</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center}>
        <Feather name="wifi-off" size={36} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Gagal memuat data</Text>
        <Pressable onPress={() => refetch()} style={[styles.retryBtn, { backgroundColor: colors.primary }]}>
          <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Coba Lagi</Text>
        </Pressable>
      </View>
    );
  }

  if (total === 0) {
    return (
      <View style={styles.center}>
        <Feather name="search" size={36} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Tidak ada breakout valid</Text>
        <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
          Market sedang konsolidasi atau tidak ada level yang ditembus dengan volume kuat.
        </Text>
        <Pressable onPress={() => refetch()} style={[styles.retryBtn, { backgroundColor: colors.primary }]}>
          <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Scan Ulang</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
    >
      {ready.length > 0 && (
        <>
          <Text style={[styles.sectionHeader, { color: colors.bullish }]}>✅ SIAP ENTRY — Retest Terkonfirmasi</Text>
          {ready.map(c => <CoinCard key={c.symbol} coin={c} colors={colors} onPress={() => handleCoinPress(c)} />)}
        </>
      )}
      {inZone.length > 0 && (
        <>
          <Text style={[styles.sectionHeader, { color: '#14B8A6' }]}>👀 DI ZONA — Pantau Rejection</Text>
          {inZone.map(c => <CoinCard key={c.symbol} coin={c} colors={colors} onPress={() => handleCoinPress(c)} />)}
        </>
      )}
      {approaching.length > 0 && (
        <>
          <Text style={[styles.sectionHeader, { color: colors.gold }]}>⏳ MENUNGGU RETEST</Text>
          {approaching.map(c => <CoinCard key={c.symbol} coin={c} colors={colors} onPress={() => handleCoinPress(c)} />)}
        </>
      )}
    </ScrollView>
  );
}

// ─── Tab ANALISA ──────────────────────────────────────────────────────────────

function AnalisaTab({ colors, initialSymbol }: { colors: ReturnType<typeof useColors>; initialSymbol?: string }) {
  const insets = useSafeAreaInsets();
  const bottomPadding = insets.bottom + 80;
  const [inputSymbol, setInputSymbol] = useState(initialSymbol ?? '');
  const [activeSymbol, setActiveSymbol] = useState(() => {
    if (!initialSymbol) return '';
    const raw = initialSymbol.trim().toUpperCase();
    return raw.endsWith('USDT') ? raw : `${raw}USDT`;
  });

  const { data, isLoading, refetch } = useGetBreakout(
    { symbol: activeSymbol },
    { query: { enabled: !!activeSymbol, staleTime: 0 } }
  );

  const handleAnalyze = () => {
    if (!inputSymbol.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const raw = inputSymbol.trim().toUpperCase();
    const sym = raw.endsWith('USDT') ? raw : `${raw}USDT`;
    setActiveSymbol(sym);
  };

  const biasColor = data?.bias === 'bullish' ? colors.bullish : colors.bearish;

  return (
    <View style={{ flex: 1 }}>
      {/* Input bar */}
      <View style={[styles.inputArea, { borderBottomColor: colors.border }]}>
        <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={15} color={colors.mutedForeground} />
          <TextInput
            style={[styles.inputText, { color: colors.foreground }]}
            placeholder="Contoh: BTC atau BTCUSDT"
            placeholderTextColor={colors.mutedForeground}
            value={inputSymbol}
            onChangeText={setInputSymbol}
            autoCapitalize="characters"
            onSubmitEditing={handleAnalyze}
            returnKeyType="search"
          />
          {inputSymbol.length > 0 && (
            <Pressable onPress={() => setInputSymbol('')}>
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
        <Pressable onPress={handleAnalyze} style={[styles.analyzeBtn, { backgroundColor: colors.primary }]}>
          <Text style={[styles.analyzeBtnText, { color: colors.primaryForeground }]}>Analisa</Text>
        </Pressable>
      </View>

      {!activeSymbol ? (
        <View style={styles.center}>
          <Feather name="zap" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Masukkan Symbol</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Ketik symbol untuk cek breakout retest</Text>
        </View>
      ) : isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Menganalisa {activeSymbol}...</Text>
        </View>
      ) : data ? (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.resultHeader}>
            <Text style={[styles.resultSymbol, { color: colors.foreground }]}>
              {data.symbol.replace('USDT', '/USDT')}
            </Text>
            <Pressable onPress={() => refetch()} style={styles.refreshBtn}>
              <Feather name="refresh-cw" size={15} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {/* Status tidak ada setup */}
          {['no_trend', 'no_breakout', 'no_zone', 'skip', 'error'].includes(data.status) && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>STATUS</Text>
              <View style={styles.statusBlock}>
                <Feather name="alert-circle" size={32} color={colors.warning} />
                <Text style={[styles.statusMsg, { color: colors.mutedForeground }]}>{data.message}</Text>
              </View>
            </View>
          )}

          {/* Ada setup */}
          {['approaching', 'in_zone', 'ready'].includes(data.status) && (
            <>
              {/* Breakout info */}
              <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>BREAKOUT H1</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  {data.breakoutType && <BreakoutTypeBadge type={data.breakoutType} colors={colors} />}
                  <StatusBadge status={data.status} colors={colors} />
                </View>
                {data.patternConfidence && (
                  <View style={{ marginBottom: 12 }}>
                    <PatternConfidenceBadge
                      confidence={data.patternConfidence}
                      patterns={data.confirmingPatterns ?? []}
                      colors={colors}
                    />
                  </View>
                )}
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Bias H4</Text>
                  <Text style={[styles.infoValue, { color: biasColor }]}>{data.bias?.toUpperCase()}</Text>
                </View>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Level Ditembus</Text>
                  <Text style={[styles.infoValue, { color: colors.foreground }]}>
                    {data.brokenLevel ? formatPrice(data.brokenLevel) : '—'}
                  </Text>
                </View>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <View style={styles.infoRow}>
                  <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Volume Breakout</Text>
                  <Text style={[styles.infoValue, { color: (data.volumeRatio ?? 0) >= 2 ? colors.bullish : colors.foreground }]}>
                    {data.volumeRatio?.toFixed(2)}x rata-rata
                  </Text>
                </View>
              </View>

              {/* Zona retest */}
              {data.retestZone && (
                <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ZONA RETEST</Text>
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Tipe Zona</Text>
                    <Text style={[styles.infoValue, { color: colors.foreground }]}>
                      {data.retestZone.type} (Tier {data.retestZone.tier})
                    </Text>
                  </View>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Range Zona</Text>
                    <Text style={[styles.infoValue, { color: colors.foreground }]}>
                      {formatPrice(data.retestZone.zoneLow)} – {formatPrice(data.retestZone.zoneHigh)}
                    </Text>
                  </View>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Jarak dari Harga</Text>
                    <Text style={[styles.infoValue, { color: colors.foreground }]}>
                      {data.retestZone.distancePct.toFixed(2)}%
                    </Text>
                  </View>
                  {data.retestZone.reason && (
                    <View style={[styles.reasonBox, { borderLeftColor: colors.primary, backgroundColor: `${colors.primary}10` }]}>
                      <Text style={[styles.reasonText, { color: colors.mutedForeground }]}>{data.retestZone.reason}</Text>
                    </View>
                  )}
                </View>
              )}

              {/* Limit order levels */}
              {data.entryPrice && (
                <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>LIMIT ORDER</Text>
                  <View style={[styles.levelCard, { backgroundColor: `${biasColor}10`, borderColor: biasColor }]}>
                    <View style={[styles.buySellBadge, { backgroundColor: biasColor }]}>
                      <Text style={styles.buySellText}>
                        {data.bias === 'bullish' ? '▲ BUY LIMIT' : '▼ SELL LIMIT'}
                      </Text>
                    </View>
                    <Text style={[styles.levelCardLabel, { color: colors.mutedForeground }]}>ENTRY</Text>
                    <Text style={[styles.levelCardPrice, { color: biasColor }]}>{formatPrice(data.entryPrice)}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.bearish }]}>Stop Loss</Text>
                    <Text style={[styles.infoValue, { color: colors.bearish }]}>
                      {data.stopLoss ? formatPrice(data.stopLoss) : '—'}
                    </Text>
                  </View>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.bullish }]}>Take Profit 1</Text>
                    <Text style={[styles.infoValue, { color: colors.bullish }]}>
                      {data.takeProfit1 ? formatPrice(data.takeProfit1) : '—'}
                    </Text>
                  </View>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.gold }]}>Take Profit 2</Text>
                    <Text style={[styles.infoValue, { color: colors.gold }]}>
                      {data.takeProfit2 ? formatPrice(data.takeProfit2) : '—'}
                    </Text>
                  </View>
                  {data.takeProfit3 && (
                    <>
                      <View style={[styles.divider, { backgroundColor: colors.border }]} />
                      <View style={styles.infoRow}>
                        <Text style={[styles.infoLabel, { color: '#A78BFA' }]}>Take Profit 3 🚀</Text>
                        <Text style={[styles.infoValue, { color: '#A78BFA' }]}>{formatPrice(data.takeProfit3)}</Text>
                      </View>
                    </>
                  )}
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Expiry Setup</Text>
                    <Text style={[styles.infoValue, { color: colors.mutedForeground }]}>{data.setupExpiryHours} jam</Text>
                  </View>
                </View>
              )}

              {/* Tombol kalkulator */}
              {data.entryPrice && (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push({
                      pathname: '/(tabs)/calculator',
                      params: {
                        entryPrice: String(data.entryPrice),
                        stopLoss: String(data.stopLoss ?? ''),
                        takeProfit1: String(data.takeProfit1 ?? ''),
                        takeProfit2: String(data.takeProfit2 ?? ''),
                        symbol: data.symbol,
                        direction: data.bias,
                      },
                    });
                  }}
                  style={[styles.calcBtn, { borderColor: colors.border }]}
                >
                  <Feather name="percent" size={15} color={colors.mutedForeground} />
                  <Text style={[styles.calcBtnText, { color: colors.foreground }]}>Kalkulator PnL →</Text>
                </Pressable>
              )}
            </>
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

  export default function BreakoutScreen() {
    const colors = useColors();
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<{ tab?: string; symbol?: string }>();
    const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);
    const [activeTab, setActiveTab] = useState<'scan' | 'analisa'>(
      params.tab === 'analisa' ? 'analisa' : 'scan'
    );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={styles.headerTop}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Breakout Scanner</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>Breakout + Retest Setups</Text>
          </View>
          {activeTab === 'scan' && (
            <View style={[styles.liveDot, { backgroundColor: `${colors.bullish}20` }]}>
              <View style={[styles.liveDotInner, { backgroundColor: colors.bullish }]} />
              <Text style={[styles.liveText, { color: colors.bullish }]}>LIVE</Text>
            </View>
          )}
        </View>

        {/* Tab switcher */}
        <View style={[styles.tabSwitcher, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {(['scan', 'analisa'] as const).map(tab => (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={[styles.tabBtn, activeTab === tab && { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.tabBtnText, { color: activeTab === tab ? colors.primaryForeground : colors.mutedForeground }]}>
                {tab === 'scan' ? 'SCAN' : 'ANALISA'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {activeTab === 'scan'
        ? <ScanTab colors={colors} />
        : <AnalisaTab colors={colors} initialSymbol={params.symbol ?? undefined} />
      }
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  headerTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  liveDot: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, gap: 5 },
  liveDotInner: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 1 },
  tabSwitcher: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, overflow: 'hidden', height: 38 },
  tabBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8 },

  card: { borderRadius: 12, borderWidth: 1, marginBottom: 8, overflow: 'hidden' },
  cardRow1: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  cardBase: { fontSize: 16, fontFamily: 'Inter_600SemiBold', letterSpacing: -0.3 },
  cardQuote: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  cardPrice: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  cardRow2: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8, paddingHorizontal: 4 },
  levelItem: { flex: 1, alignItems: 'center', gap: 2 },
  levelLabel: { fontSize: 8, fontFamily: 'Inter_500Medium', letterSpacing: 0.4 },
  levelValue: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  levelDivider: { width: StyleSheet.hairlineWidth, marginVertical: 4 },
  typeBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  typeBadgeText: { fontSize: 8, fontFamily: 'Inter_700Bold', letterSpacing: 0.4 },
  statusBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  statusBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 },
  volBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  volText: { fontSize: 8, fontFamily: 'Inter_500Medium' },
  sectionHeader: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8, marginBottom: 8, marginTop: 4 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  loadingText: { fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 8 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', textAlign: 'center', marginTop: 8 },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, marginTop: 8 },
  retryText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  inputArea: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 8 },
  inputBox: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  inputText: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', letterSpacing: 0.5 },
  analyzeBtn: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  analyzeBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  resultSymbol: { fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  refreshBtn: { padding: 6 },

  section: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  sectionTitle: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.5, marginBottom: 12 },
  statusBlock: { alignItems: 'center', gap: 10, paddingVertical: 8 },
  statusMsg: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  infoLabel: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  infoValue: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  reasonBox: { borderLeftWidth: 3, paddingLeft: 10, paddingVertical: 8, marginTop: 10, borderRadius: 4 },
  reasonText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  levelCard: { borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 12, alignItems: 'center' },
  buySellBadge: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 5, marginBottom: 10 },
  buySellText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: 0.5 },
  levelCardLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', letterSpacing: 1, marginBottom: 4 },
  levelCardPrice: { fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  calcBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 },
  calcBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
});
