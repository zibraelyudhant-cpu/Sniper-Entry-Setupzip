import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import {
  STORAGE_KEY_BREAKOUT_ENTRY,
  addLog,
  deleteLog,
  evaluateLog,
  loadLogs,
  updateLog,
  type SignalLog,
} from './signal-log-helpers';

// ─── Types (mirror BreakoutTradingResult dari backend) ─────────────────────────

interface BreakoutTradingResult {
  status: 'ready' | 'waiting' | 'approaching' | 'in_zone' | 'expired' | 'no_setup' | 'skip' | 'error';
  symbol: string;
  bias?: 'bullish' | 'bearish';
  breakoutType?: 'continuation' | 'reversal';
  currentPrice: number;
  timestamp: string;
  message?: string;
  score?: number;
  maxScore: number;
  consolidationHigh?: number;
  consolidationLow?: number;
  consolidationCandles?: number;
  brokenLevel?: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  rr1?: number;
  volumeRatio?: number;
  filterResults?: string[];
  buyStopPrice?: number;
  sellStopPrice?: number;
  rangeHeight?: number;
  leanBias?: 'bullish' | 'bearish' | 'neutral';
  anticipationEntry?: {
    direction: 'bullish' | 'bearish';
    entryPrice: number;
    stopLoss: number;
    sizeNote: string;
    trendContext: string;
  };
}

// ─── Fetch hooks (fetch langsung ke backend, relative path /api) ───────────────

function useBreakoutEntry(symbol: string) {
  const [data, setData] = useState<BreakoutTradingResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);

  const fetchData = useCallback(async () => {
    if (!symbol) return;
    setIsLoading(true);
    setIsError(false);
    try {
      const res = await fetch(`/api/breakout-entry?symbol=${symbol}`);
      if (!res.ok) throw new Error('fetch failed');
      setData(await res.json());
    } catch {
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  }, [symbol]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return { data, isLoading, isError, refetch: fetchData };
}

function useBreakoutEntryScan() {
  const [data, setData] = useState<{ coins: BreakoutTradingResult[]; fetchedAt: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setIsError(false);
    try {
      const res = await fetch('/api/breakout-entry/scan');
      if (!res.ok) throw new Error('fetch failed');
      setData(await res.json());
    } catch {
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return { data, isLoading, isError, refetch: fetchData };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(6);
}

// ─── Status & Score Badge ───────────────────────────────────────────────────────

function StatusBadge({ status, colors }: { status: string; colors: ReturnType<typeof useColors> }) {
  const map: Record<string, { label: string; color: string }> = {
    in_zone:     { label: '🎯 BAGUS', color: colors.bullish },
    approaching: { label: '⚡ MENDEKATI', color: colors.primary },
    waiting:     { label: '⏳ WAITING', color: colors.gold },
    ready:       { label: '🔥 SIAP BREAKOUT', color: '#f97316' },
    expired:     { label: '💨 EXPIRED', color: colors.mutedForeground },
    no_setup:    { label: '🚫 NO SETUP', color: colors.bearish },
    skip:        { label: '⏭ SKIP', color: colors.mutedForeground },
  };
  const item = map[status] ?? { label: status.toUpperCase(), color: colors.mutedForeground };
  return (
    <View style={[styles.statusBadge, { borderColor: item.color, backgroundColor: `${item.color}18` }]}>
      <Text style={[styles.statusBadgeText, { color: item.color }]}>{item.label}</Text>
    </View>
  );
}

function ScoreBadge({ score, max, colors }: { score: number; max: number; colors: ReturnType<typeof useColors> }) {
  const pct = score / max;
  const color = pct >= 0.85 ? colors.bullish : pct >= 0.6 ? colors.gold : colors.bearish;
  return (
    <View style={[styles.scoreBadge, { borderColor: color, backgroundColor: `${color}18` }]}>
      <Text style={[styles.scoreBadgeText, { color }]}>{score}/{max}</Text>
    </View>
  );
}

function BreakoutTypeBadge({ type, colors }: { type: 'continuation' | 'reversal'; colors: ReturnType<typeof useColors> }) {
  const color = type === 'continuation' ? colors.bullish : colors.gold;
  const label = type === 'continuation' ? '➡ CONTINUATION' : '🔄 REVERSAL';
  return (
    <View style={[scanStyles.biasBadge, { backgroundColor: `${color}18`, borderColor: color }]}>
      <Text style={[scanStyles.biasBadgeText, { color }]}>{label}</Text>
    </View>
  );
}

// ─── Scan Coin Card ───────────────────────────────────────────────────────────

function ScanCoinCard({ coin, onPress, colors }: { coin: BreakoutTradingResult; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  const base = coin.symbol.replace('USDT', '');
  const isReady = coin.status === 'ready';
  const isBuy = coin.bias === 'bullish';
  const biasColor = isBuy ? colors.bullish : colors.bearish;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [scanStyles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
    >
      <View style={scanStyles.cardRow1}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
            <Text style={[scanStyles.cardBase, { color: colors.foreground }]}>{base}</Text>
            <Text style={[scanStyles.cardQuote, { color: colors.mutedForeground }]}>/USDT</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
            {isReady ? (
              <>
                <View style={[scanStyles.biasBadge, { backgroundColor: '#f9731618', borderColor: '#f97316' }]}>
                  <Text style={[scanStyles.biasBadgeText, { color: '#f97316' }]}>
                    {coin.leanBias === 'bullish' ? '↗ LEAN LONG' : coin.leanBias === 'bearish' ? '↘ LEAN SHORT' : '↔ NETRAL'}
                  </Text>
                </View>
                {coin.anticipationEntry && (
                  <View style={[scanStyles.biasBadge, { backgroundColor: '#f9731618', borderColor: '#f97316' }]}>
                    <Text style={[scanStyles.biasBadgeText, { color: '#f97316' }]}>🎯 ANTICIPATION</Text>
                  </View>
                )}
              </>
            ) : (
              <View style={[scanStyles.biasBadge, { backgroundColor: `${biasColor}18`, borderColor: biasColor }]}>
                <Text style={[scanStyles.biasBadgeText, { color: biasColor }]}>{isBuy ? '▲ LONG' : '▼ SHORT'}</Text>
              </View>
            )}
            {coin.breakoutType && <BreakoutTypeBadge type={coin.breakoutType} colors={colors} />}
          </View>
          {coin.volumeRatio !== undefined && (
            <Text style={{ fontSize: 9, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 2 }} numberOfLines={1}>
              Volume breakout {coin.volumeRatio.toFixed(1)}x rata-rata
            </Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <StatusBadge status={coin.status} colors={colors} />
          {coin.score !== undefined && <ScoreBadge score={coin.score} max={coin.maxScore} colors={colors} />}
        </View>
        <Feather name="chevron-right" size={13} color={colors.mutedForeground} style={{ marginLeft: 2, flexShrink: 0 }} />
      </View>

      {isReady ? (
        <View style={[scanStyles.condRow, { borderTopColor: colors.border }]}>
          <View style={scanStyles.condItem}>
            <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>BUY STOP</Text>
            <Text style={[scanStyles.condValue, { color: colors.bullish }]}>{coin.buyStopPrice ? formatPrice(coin.buyStopPrice) : '—'}</Text>
          </View>
          <View style={[scanStyles.condDivider, { backgroundColor: colors.border }]} />
          <View style={scanStyles.condItem}>
            <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>SELL STOP</Text>
            <Text style={[scanStyles.condValue, { color: colors.bearish }]}>{coin.sellStopPrice ? formatPrice(coin.sellStopPrice) : '—'}</Text>
          </View>
          <View style={[scanStyles.condDivider, { backgroundColor: colors.border }]} />
          <View style={scanStyles.condItem}>
            <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>RANGE</Text>
            <Text style={[scanStyles.condValue, { color: colors.foreground }]}>{coin.rangeHeight ? formatPrice(coin.rangeHeight) : '—'}</Text>
          </View>
          <View style={[scanStyles.condDivider, { backgroundColor: colors.border }]} />
          <View style={scanStyles.condItem}>
            <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>CANDLE</Text>
            <Text style={[scanStyles.condValue, { color: colors.foreground }]}>{coin.consolidationCandles ?? '—'}</Text>
          </View>
        </View>
      ) : (
        <View style={[scanStyles.condRow, { borderTopColor: colors.border }]}>
          <View style={scanStyles.condItem}>
            <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>ENTRY</Text>
            <Text style={[scanStyles.condValue, { color: colors.foreground }]}>{coin.entryPrice ? formatPrice(coin.entryPrice) : '—'}</Text>
          </View>
          <View style={[scanStyles.condDivider, { backgroundColor: colors.border }]} />
          <View style={scanStyles.condItem}>
            <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>SL</Text>
            <Text style={[scanStyles.condValue, { color: colors.bearish }]}>{coin.stopLoss ? formatPrice(coin.stopLoss) : '—'}</Text>
          </View>
          <View style={[scanStyles.condDivider, { backgroundColor: colors.border }]} />
          <View style={scanStyles.condItem}>
            <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>TP1</Text>
            <Text style={[scanStyles.condValue, { color: colors.bullish }]}>{coin.takeProfit1 ? formatPrice(coin.takeProfit1) : '—'}</Text>
          </View>
          <View style={[scanStyles.condDivider, { backgroundColor: colors.border }]} />
          <View style={scanStyles.condItem}>
            <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>RR</Text>
            <Text style={[scanStyles.condValue, { color: colors.foreground }]}>{coin.rr1 ? `1:${coin.rr1.toFixed(1)}` : '—'}</Text>
          </View>
          <View style={[scanStyles.condDivider, { backgroundColor: colors.border }]} />
          <View style={scanStyles.condItem}>
            <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>CANDLE</Text>
            <Text style={[scanStyles.condValue, { color: colors.foreground }]}>{coin.consolidationCandles ?? '—'}</Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

// ─── Scan Tab ─────────────────────────────────────────────────────────────────

function ScanNowButton({ onPress, isLoading, colors }: { onPress: () => void; isLoading: boolean; colors: ReturnType<typeof useColors> }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={isLoading}
      style={({ pressed }) => [{
        flexDirection: 'row', alignItems: 'center', gap: 5,
        paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
        backgroundColor: `${colors.primary}15`,
        borderWidth: 1, borderColor: colors.primary,
        opacity: pressed || isLoading ? 0.6 : 1,
      }]}
    >
      {isLoading
        ? <ActivityIndicator size={10} color={colors.primary} />
        : <Feather name="refresh-cw" size={11} color={colors.primary} />
      }
      <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.primary, letterSpacing: 0.5 }}>
        {isLoading ? 'SCANNING...' : 'SCAN NOW'}
      </Text>
    </Pressable>
  );
}

function ScanTab({ colors, onSelectCoin }: { colors: ReturnType<typeof useColors>; onSelectCoin: (symbol: string) => void }) {
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, refetch } = useBreakoutEntryScan();

  if (isLoading) {
    return (
      <View style={scanStyles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[scanStyles.loadingText, { color: colors.mutedForeground }]}>Scanning breakout setup...</Text>
        <Text style={[scanStyles.loadingSub, { color: colors.mutedForeground }]}>Analisa konsolidasi H4 → breakout tervolume → retest</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={scanStyles.center}>
        <Feather name="wifi-off" size={36} color={colors.mutedForeground} />
        <Text style={[scanStyles.emptyTitle, { color: colors.foreground }]}>Gagal memuat data</Text>
        <Pressable onPress={() => refetch()} style={[scanStyles.retryBtn, { backgroundColor: colors.primary }]}>
          <Text style={[scanStyles.retryText, { color: colors.primaryForeground }]}>Coba Lagi</Text>
        </Pressable>
      </View>
    );
  }

  const coins = data?.coins ?? [];
  const fetchedAt = data ? new Date(data.fetchedAt ?? Date.now()).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : null;
  const inZone      = coins.filter(c => c.status === 'in_zone');
  const approaching = coins.filter(c => c.status === 'approaching');
  const waiting      = coins.filter(c => c.status === 'waiting');
  const ready       = coins.filter(c => c.status === 'ready');

  if (coins.length === 0) {
    return (
      <View style={scanStyles.center}>
        <Feather name="trending-up" size={36} color={colors.mutedForeground} />
        <Text style={[scanStyles.emptyTitle, { color: colors.foreground }]}>Tidak ada setup breakout</Text>
        <Text style={[scanStyles.emptySub, { color: colors.mutedForeground }]}>Tidak ada koin yang lolos semua filter saat ini</Text>
        <Pressable onPress={() => refetch()} style={[scanStyles.retryBtn, { backgroundColor: colors.primary }]}>
          <Text style={[scanStyles.retryText, { color: colors.primaryForeground }]}>Scan Ulang</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: insets.bottom + 80 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        {fetchedAt && <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground }}>Update: {fetchedAt} WIB</Text>}
        <ScanNowButton onPress={() => refetch()} isLoading={isLoading} colors={colors} />
      </View>

      {inZone.length > 0 && (
        <>
          <Text style={[scanStyles.groupHeader, { color: colors.bullish }]}>🎯 BAGUS — Sudah Tersentuh, Entry Sekarang</Text>
          {inZone.map(c => <ScanCoinCard key={c.symbol} coin={c} colors={colors} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectCoin(c.symbol); }} />)}
        </>
      )}
      {approaching.length > 0 && (
        <>
          <Text style={[scanStyles.groupHeader, { color: colors.primary }]}>⚡ MENDEKATI — Siap Pasang Limit</Text>
          {approaching.map(c => <ScanCoinCard key={c.symbol} coin={c} colors={colors} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectCoin(c.symbol); }} />)}
        </>
      )}
      {waiting.length > 0 && (
        <>
          <Text style={[scanStyles.groupHeader, { color: colors.gold }]}>⏳ WAITING — Baru Breakout, Menunggu Retest</Text>
          {waiting.map(c => <ScanCoinCard key={c.symbol} coin={c} colors={colors} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectCoin(c.symbol); }} />)}
        </>
      )}
      {ready.length > 0 && (
        <>
          <Text style={[scanStyles.groupHeader, { color: '#f97316' }]}>🔥 SIAP BREAKOUT — Pasang Stop Order Duluan</Text>
          {ready.map(c => <ScanCoinCard key={c.symbol} coin={c} colors={colors} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectCoin(c.symbol); }} />)}
        </>
      )}
    </ScrollView>
  );
}

const scanStyles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  loadingText: { fontSize: 14, fontFamily: 'Inter_500Medium', marginTop: 8 },
  loadingSub: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', textAlign: 'center', marginTop: 8 },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, marginTop: 8 },
  retryText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  groupHeader: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8, marginBottom: 8, marginTop: 4 },
  card: { borderRadius: 12, borderWidth: 1, marginBottom: 8, overflow: 'hidden' },
  cardRow1: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  cardBase: { fontSize: 16, fontFamily: 'Inter_600SemiBold', letterSpacing: -0.3 },
  cardQuote: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  biasBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  biasBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 },
  condRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8, paddingHorizontal: 4 },
  condItem: { flex: 1, alignItems: 'center', gap: 3 },
  condLabel: { fontSize: 7, fontFamily: 'Inter_500Medium', letterSpacing: 0.3 },
  condValue: { fontSize: 8, fontFamily: 'Inter_600SemiBold' },
  condDivider: { width: StyleSheet.hairlineWidth, marginVertical: 4 },
});

// ─── Analisa Tab ──────────────────────────────────────────────────────────────

function AnalisaTab({ colors, initialSymbol, onSignalReady, onSave }: {
  colors: ReturnType<typeof useColors>;
  initialSymbol?: string;
  onSignalReady?: (d: BreakoutTradingResult | null) => void;
  onSave?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [inputSymbol, setInputSymbol] = useState(initialSymbol ?? '');
  const [querySymbol, setQuerySymbol] = useState(initialSymbol ?? '');

  const { data, isLoading, isError, refetch } = useBreakoutEntry(querySymbol);

  useEffect(() => {
    if (onSignalReady) onSignalReady(data?.status === 'waiting' || data?.status === 'approaching' || data?.status === 'in_zone' ? data : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const handleAnalyze = useCallback(() => {
    const sym = inputSymbol.trim().toUpperCase();
    if (!sym) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const normalized = sym.endsWith('USDT') ? sym : `${sym}USDT`;
    setQuerySymbol(normalized);
  }, [inputSymbol]);

  const bottomPadding = 60 + (Platform.OS === 'web' ? 34 : insets.bottom);

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.inputArea, { borderBottomColor: colors.border }]}>
        <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="trending-up" size={15} color={colors.primary} />
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
          {inputSymbol.length > 0 && (
            <Pressable onPress={() => setInputSymbol('')}>
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
        <Pressable
          onPress={handleAnalyze}
          style={({ pressed }) => [styles.analyzeBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={[styles.analyzeBtnText, { color: colors.primaryForeground }]}>Analisa</Text>
        </Pressable>
      </View>

      {!querySymbol ? (
        <View style={styles.emptyState}>
          <Feather name="trending-up" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Breakout Entry Scanner</Text>
          <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>Masukkan pair untuk analisa konsolidasi H4 → breakout tervolume → retest</Text>
        </View>
      ) : isLoading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>Menganalisa {querySymbol}...</Text>
        </View>
      ) : isError || !data ? (
        <View style={styles.emptyState}>
          <Feather name="alert-circle" size={36} color={colors.bearish} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Gagal menganalisa</Text>
          <Pressable onPress={() => refetch()} style={[styles.retryBtn, { backgroundColor: colors.primary }]}>
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: bottomPadding }} showsVerticalScrollIndicator={false}>
          {/* Header result */}
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View>
                <Text style={[styles.pairTitle, { color: colors.foreground }]}>
                  {data.symbol.replace('USDT', '')}/USDT
                </Text>
                <Text style={[styles.timestamp, { color: colors.mutedForeground }]}>{data.timestamp}</Text>
              </View>
              <View style={{ gap: 6, alignItems: 'flex-end' }}>
                <StatusBadge status={data.status} colors={colors} />
                {data.score !== undefined && <ScoreBadge score={data.score} max={data.maxScore} colors={colors} />}
              </View>
            </View>
            {data.breakoutType && (
              <View style={{ marginTop: 8, flexDirection: 'row' }}>
                <BreakoutTypeBadge type={data.breakoutType} colors={colors} />
              </View>
            )}
            {data.message && (
              <View style={[styles.messageBox, { backgroundColor: `${colors.primary}10`, borderLeftColor: colors.primary }]}>
                <Text style={[styles.messageText, { color: colors.mutedForeground }]}>{data.message}</Text>
              </View>
            )}
          </View>

          {/* Konsolidasi H4 */}
          {data.consolidationHigh !== undefined && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>KONSOLIDASI H4</Text>
              {data.bias ? (
                <>
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Bias</Text>
                    <Text style={[styles.infoValue, { color: data.bias === 'bullish' ? colors.bullish : colors.bearish }]}>
                      {data.bias === 'bullish' ? '▲ LONG' : '▼ SHORT'}
                    </Text>
                  </View>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                </>
              ) : data.leanBias ? (
                <>
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Kecenderungan</Text>
                    <Text style={[styles.infoValue, { color: '#f97316' }]}>
                      {data.leanBias === 'bullish' ? '↗ LEAN LONG' : data.leanBias === 'bearish' ? '↘ LEAN SHORT' : '↔ NETRAL — belum jelas'}
                    </Text>
                  </View>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                </>
              ) : null}
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Range Konsolidasi</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>
                  {formatPrice(data.consolidationLow ?? 0)} – {formatPrice(data.consolidationHigh)}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Durasi</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>{data.consolidationCandles} candle H4</Text>
              </View>
              {data.volumeRatio !== undefined && (
                <>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <View style={[styles.infoRow, {
                    backgroundColor: `${colors.primary}18`,
                    marginHorizontal: -12,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 8,
                  }]}>
                    <Text style={[styles.infoLabel, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>⚡ VOLUME BREAKOUT</Text>
                    <Text style={[styles.infoValue, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>
                      {data.volumeRatio.toFixed(1)}x rata-rata
                    </Text>
                  </View>
                </>
              )}
            </View>
          )}

          {/* Anticipation Entry — khusus status ready & ada trend besar jelas */}
          {data.status === 'ready' && data.anticipationEntry && (
            <View style={[styles.section, { backgroundColor: `#f9731608`, borderColor: '#f97316' }]}>
              <Text style={[styles.sectionTitle, { color: '#f97316' }]}>🎯 ANTICIPATION ENTRY</Text>
              <Text style={[styles.messageText, { color: colors.mutedForeground, marginBottom: 10 }]}>
                {data.anticipationEntry.trendContext}
              </Text>
              <View style={[styles.levelCard, {
                backgroundColor: `${data.anticipationEntry.direction === 'bullish' ? colors.bullish : colors.bearish}10`,
                borderColor: data.anticipationEntry.direction === 'bullish' ? colors.bullish : colors.bearish,
              }]}>
                <Text style={[styles.levelCardLabel, { color: colors.mutedForeground }]}>
                  ENTRY {data.anticipationEntry.direction === 'bullish' ? '(deket support)' : '(deket resistance)'}
                </Text>
                <Text style={[styles.levelCardPrice, { color: data.anticipationEntry.direction === 'bullish' ? colors.bullish : colors.bearish }]}>
                  {formatPrice(data.anticipationEntry.entryPrice)}
                </Text>
                <Text style={[styles.levelCardSub, { color: colors.mutedForeground }]}>
                  SL ketat: {formatPrice(data.anticipationEntry.stopLoss)}
                </Text>
              </View>
              <View style={[styles.infoRow, { backgroundColor: '#f9731615', marginHorizontal: -12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }]}>
                <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.foreground, lineHeight: 18, flex: 1 }}>
                  {data.anticipationEntry.sizeNote}
                </Text>
              </View>
            </View>
          )}

          {/* Stop Order — khusus status ready (belum breakout) */}
          {data.status === 'ready' && data.buyStopPrice !== undefined && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>PASANG STOP ORDER DULUAN</Text>
              <Text style={[styles.messageText, { color: colors.mutedForeground, marginBottom: 10 }]}>
                Arah belum pasti — pasang di kedua sisi. Kalau salah satu kena, batalkan sisi satunya.
              </Text>
              <View style={[styles.levelCard, { backgroundColor: `${colors.bullish}10`, borderColor: colors.bullish, marginBottom: 8 }]}>
                <Text style={[styles.levelCardLabel, { color: colors.mutedForeground }]}>BUY STOP (kalau tembus ke atas)</Text>
                <Text style={[styles.levelCardPrice, { color: colors.bullish }]}>{formatPrice(data.buyStopPrice)}</Text>
                <Text style={[styles.levelCardSub, { color: colors.mutedForeground }]}>
                  TP measured move: {data.rangeHeight ? formatPrice(data.buyStopPrice + data.rangeHeight) : '—'}
                </Text>
              </View>
              {data.sellStopPrice !== undefined && (
                <View style={[styles.levelCard, { backgroundColor: `${colors.bearish}10`, borderColor: colors.bearish }]}>
                  <Text style={[styles.levelCardLabel, { color: colors.mutedForeground }]}>SELL STOP (kalau tembus ke bawah)</Text>
                  <Text style={[styles.levelCardPrice, { color: colors.bearish }]}>{formatPrice(data.sellStopPrice)}</Text>
                  <Text style={[styles.levelCardSub, { color: colors.mutedForeground }]}>
                    TP measured move: {data.rangeHeight ? formatPrice(data.sellStopPrice - data.rangeHeight) : '—'}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Simpan Sinyal */}
          {(data.status === 'waiting' || data.status === 'approaching' || data.status === 'in_zone') && onSave && (
            <Pressable onPress={onSave}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, margin: 12, marginTop: 4, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}>
              <Feather name="bookmark" size={15} color={colors.primaryForeground} />
              <Text style={{ fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.primaryForeground }}>Simpan Sinyal ke Log</Text>
            </Pressable>
          )}

          {/* Limit Order */}
          {data.entryPrice !== undefined && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>LIMIT ORDER (RETEST)</Text>
              <View style={[styles.levelCard, {
                backgroundColor: `${data.bias === 'bullish' ? colors.bullish : colors.bearish}10`,
                borderColor: data.bias === 'bullish' ? colors.bullish : colors.bearish
              }]}>
                <Text style={[styles.levelCardLabel, { color: colors.mutedForeground }]}>ENTRY (LEVEL BREAKOUT)</Text>
                <Text style={[styles.levelCardPrice, { color: data.bias === 'bullish' ? colors.bullish : colors.bearish }]}>
                  {formatPrice(data.entryPrice)}
                </Text>
                <Text style={[styles.levelCardSub, { color: colors.mutedForeground }]}>
                  {data.bias === 'bullish' ? 'BUY LIMIT' : 'SELL LIMIT'} — retest resistance/support baru
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.bearish }]}>Stop Loss</Text>
                <Text style={[styles.infoValue, { color: colors.bearish }]}>{data.stopLoss ? formatPrice(data.stopLoss) : '—'}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.bullish }]}>TP1 — Measured Move (RR 1:{data.rr1?.toFixed(1)})</Text>
                <Text style={[styles.infoValue, { color: colors.bullish }]}>{data.takeProfit1 ? formatPrice(data.takeProfit1) : '—'}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.gold }]}>TP2 — Extended 1.618x</Text>
                <Text style={[styles.infoValue, { color: colors.gold }]}>{data.takeProfit2 ? formatPrice(data.takeProfit2) : '—'}</Text>
              </View>
            </View>
          )}

          {/* Filter Results */}
          {data.filterResults && data.filterResults.length > 0 && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>HASIL FILTER (Score: {data.score}/{data.maxScore})</Text>
              {data.filterResults.map((f, i) => {
                const isPassed = f.startsWith('✅');
                return (
                  <Text key={i} style={[styles.filterItem, { color: isPassed ? colors.foreground : colors.mutedForeground }]}>
                    {f}
                  </Text>
                );
              })}
            </View>
          )}

          {/* Kalkulator PnL button */}
          {data.entryPrice !== undefined && (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({
                  pathname: '/(tabs)/calculator',
                  params: {
                    entryPrice: String(data.entryPrice ?? 0),
                    stopLoss: String(data.stopLoss ?? 0),
                    takeProfit1: String(data.takeProfit1 ?? 0),
                    takeProfit2: String(data.takeProfit2 ?? 0),
                    symbol: data.symbol,
                    direction: data.bias ?? 'bullish',
                    source: 'breakout_entry',
                  },
                });
              }}
              style={({ pressed }) => [{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                margin: 12, marginTop: 4, padding: 14, borderRadius: 12,
                borderWidth: 1, borderColor: colors.mutedForeground,
                backgroundColor: pressed ? `${colors.mutedForeground}15` : 'transparent',
              }]}
            >
              <Feather name="percent" size={15} color={colors.mutedForeground} />
              <Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground }}>
                Kalkulator PnL
              </Text>
              <Feather name="arrow-right" size={14} color={colors.mutedForeground} style={{ marginLeft: 'auto' }} />
            </Pressable>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Log Tab (pakai shared signal-log-helpers) ─────────────────────────────────

function BreakoutLogTab({ colors }: { colors: ReturnType<typeof useColors> }) {
  const insets = useSafeAreaInsets();
  const [logs, setLogs] = useState<SignalLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState<string | null>(null);

  useEffect(() => {
    loadLogs(STORAGE_KEY_BREAKOUT_ENTRY).then(l => { setLogs(l); setLoading(false); });
  }, []);

  const doEval = async (log: SignalLog) => {
    setEvaluating(log.id);
    const patch = await evaluateLog(log);
    setLogs(await updateLog(STORAGE_KEY_BREAKOUT_ENTRY, log.id, patch));
    setEvaluating(null);
  };
  const doDelete = async (id: string) => setLogs(await deleteLog(STORAGE_KEY_BREAKOUT_ENTRY, id));

  const sc = (s: SignalLog['status']) => s === 'win_tp1' || s === 'win_tp2' ? '#22c55e' : s === 'lose' ? '#ef4444' : '#888';
  const sl = (s: SignalLog['status']) => s === 'win_tp1' ? 'WIN TP1' : s === 'win_tp2' ? 'WIN TP2' : s === 'lose' ? 'LOSE' : s === 'expired' ? 'EXPIRED' : 'PENDING';
  const fp = (v: number) => v >= 1000 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v.toFixed(6);

  const wins = logs.filter(l => l.status === 'win_tp1' || l.status === 'win_tp2').length;
  const loses = logs.filter(l => l.status === 'lose').length;
  const wr = wins + loses > 0 ? Math.round(wins / (wins + loses) * 100) : 0;
  const rrs = logs.filter(l => (l.rr ?? 0) > 0);
  const avgRR = rrs.length ? (rrs.reduce((a, b) => a + (b.rr ?? 0), 0) / rrs.length).toFixed(2) : '—';

  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 80 }} showsVerticalScrollIndicator={false}>
      {logs.length > 0 && (
        <View style={{ flexDirection: 'row', margin: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14, justifyContent: 'space-around' }}>
          {[{ v: `${wins}W`, c: '#22c55e', l: 'Win' }, { v: `${loses}L`, c: '#ef4444', l: 'Lose' }, { v: `${logs.filter(x => x.status === 'pending').length}`, c: colors.mutedForeground, l: 'Pending' }, { v: `${wr}%`, c: colors.foreground, l: 'Win Rate' }, { v: avgRR, c: colors.foreground, l: 'Avg R:R' }].map(item => (
            <View key={item.l} style={{ alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 18, fontFamily: 'Inter_700Bold', color: item.c }}>{item.v}</Text>
              <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground }}>{item.l}</Text>
            </View>
          ))}
        </View>
      )}
      {logs.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10, minHeight: 300 }}>
          <Feather name="bookmark" size={36} color={colors.mutedForeground} />
          <Text style={{ fontSize: 16, fontFamily: 'Inter_600SemiBold', color: colors.foreground, textAlign: 'center' }}>Belum ada sinyal tersimpan</Text>
          <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, textAlign: 'center', lineHeight: 20 }}>Simpan sinyal dari tab Analisa</Text>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 12, paddingTop: 10, gap: 8 }}>
          {logs.map(log => (
            <View key={log.id} style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: 'hidden' }}>
              <View style={{ flexDirection: 'row', padding: 12, alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontFamily: 'Inter_600SemiBold', color: colors.foreground }}>{log.symbol.replace('USDT', '')}/USDT</Text>
                  <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 2 }}>{log.timestamp}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1, borderColor: sc(log.status), backgroundColor: sc(log.status) + '18' }}>
                    <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.5, color: sc(log.status) }}>{sl(log.status)}</Text>
                  </View>
                  <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: log.bias === 'bullish' ? '#22c55e' : '#ef4444' }}>{log.bias === 'bullish' ? '▲ LONG' : '▼ SHORT'}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingVertical: 8, paddingHorizontal: 12 }}>
                {([['Entry', log.entryPrice, colors.foreground], ['SL', log.stopLoss, '#ef4444'], ['TP1', log.takeProfit1, '#22c55e'], ['TP2', log.takeProfit2, '#3b82f6']] as [string, number | undefined, string][]).map(([lbl, val, col]) => val ? (
                  <View key={lbl} style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={{ fontSize: 9, fontFamily: 'Inter_500Medium', color: colors.mutedForeground }}>{lbl}</Text>
                    <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: col, marginTop: 2 }}>{fp(val)}</Text>
                  </View>
                ) : null)}
                {log.rr !== undefined && <View style={{ flex: 1, alignItems: 'center' }}><Text style={{ fontSize: 9, fontFamily: 'Inter_500Medium', color: colors.mutedForeground }}>R:R</Text><Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: log.rr > 0 ? '#22c55e' : '#ef4444', marginTop: 2 }}>{log.rr > 0 ? `1:${log.rr}` : '-1'}</Text></View>}
              </View>
              {log.probabilityOrScore !== undefined && <Text style={{ fontSize: 11, color: colors.mutedForeground, paddingHorizontal: 12, paddingBottom: 4, fontFamily: 'Inter_400Regular' }}>Score: {log.probabilityOrScore}/5</Text>}
              {log.evaluatedAt && <Text style={{ fontSize: 10, color: colors.mutedForeground, paddingHorizontal: 12, paddingBottom: 6, fontFamily: 'Inter_400Regular' }}>Dievaluasi: {log.evaluatedAt}</Text>}
              <View style={{ flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, padding: 8, gap: 8, alignItems: 'center' }}>
                {log.status === 'pending' && (
                  <Pressable onPress={() => doEval(log)} disabled={evaluating === log.id}
                    style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primary + '15', opacity: pressed || evaluating === log.id ? 0.7 : 1 }]}>
                    {evaluating === log.id ? <ActivityIndicator size={12} color={colors.primary} /> : <Feather name="search" size={12} color={colors.primary} />}
                    <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.primary }}>{evaluating === log.id ? 'Evaluasi...' : 'Evaluasi'}</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => doDelete(log.id)} style={({ pressed }) => [{ padding: 8, opacity: pressed ? 0.7 : 1 }]}>
                  <Feather name="trash-2" size={12} color="#ef4444" />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function BreakoutEntryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const [activeTab, setActiveTab] = useState<'scan' | 'analisa' | 'log'>('scan');
  const [selectedSymbol, setSelectedSymbol] = useState<string | undefined>();
  const [currentSignal, setCurrentSignal] = useState<BreakoutTradingResult | null>(null);

  const handleSaveSignal = useCallback(async () => {
    if (!currentSignal || currentSignal.entryPrice === undefined) return;
    const log: SignalLog = {
      id: `${Date.now()}_${currentSignal.symbol}`,
      menu: 'breakout_entry',
      symbol: currentSignal.symbol,
      bias: currentSignal.bias ?? 'bullish',
      entryPrice: currentSignal.entryPrice,
      stopLoss: currentSignal.stopLoss ?? 0,
      takeProfit1: currentSignal.takeProfit1 ?? 0,
      takeProfit2: currentSignal.takeProfit2,
      currentPriceAtSignal: currentSignal.currentPrice,
      timestamp: currentSignal.timestamp,
      savedAt: Date.now(),
      probabilityOrScore: currentSignal.score,
      zoneType: currentSignal.breakoutType,
      status: 'pending',
    };
    await addLog(STORAGE_KEY_BREAKOUT_ENTRY, log);
    setActiveTab('log');
  }, [currentSignal]);

  const handleSelectCoin = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
    setActiveTab('analisa');
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={styles.headerTop}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Breakout Entry</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>Konsolidasi H4 → Breakout + Volume → Retest → Entry</Text>
          </View>
          {activeTab === 'scan' && (
            <View style={[styles.liveDot, { backgroundColor: `${colors.bullish}20` }]}>
              <View style={[styles.liveDotInner, { backgroundColor: colors.bullish }]} />
              <Text style={[styles.liveText, { color: colors.bullish }]}>LIVE</Text>
            </View>
          )}
        </View>
        <View style={[styles.tabSwitcher, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {(['scan', 'analisa', 'log'] as const).map(tab => (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={[styles.tabBtn, activeTab === tab && { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.tabBtnText, { color: activeTab === tab ? colors.primaryForeground : colors.mutedForeground }]}>
                {tab === 'scan' ? 'SCAN' : tab === 'analisa' ? 'ANALISA' : 'LOG'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {activeTab === 'scan'
        ? <ScanTab colors={colors} onSelectCoin={handleSelectCoin} />
        : activeTab === 'analisa'
        ? <AnalisaTab colors={colors} initialSymbol={selectedSymbol} onSignalReady={setCurrentSignal} onSave={handleSaveSignal} />
        : <BreakoutLogTab colors={colors} />
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
  inputArea: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 8 },
  inputBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  inputText: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular' },
  analyzeBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, justifyContent: 'center' },
  analyzeBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptyDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  retryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  section: { marginHorizontal: 12, marginTop: 12, borderRadius: 12, borderWidth: 1, padding: 14 },
  sectionTitle: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 1, marginBottom: 10 },
  pairTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  timestamp: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  messageBox: { borderLeftWidth: 3, paddingLeft: 10, paddingVertical: 8, marginTop: 10, borderRadius: 4 },
  messageText: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  infoLabel: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  infoValue: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  levelCard: { borderRadius: 10, borderWidth: 1, padding: 14, marginBottom: 12, alignItems: 'center' },
  levelCardLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 1 },
  levelCardPrice: { fontSize: 28, fontFamily: 'Inter_700Bold', marginVertical: 4 },
  levelCardSub: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  filterItem: { fontSize: 12, fontFamily: 'Inter_400Regular', paddingVertical: 4, lineHeight: 20 },
  statusBadge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 1 },
  statusBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  scoreBadge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  scoreBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
});