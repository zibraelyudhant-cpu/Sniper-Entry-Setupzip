import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { AnimatedCard } from '@/components/animated/AnimatedCard';
import { DirectionalCard } from '@/components/animated/DirectionalCard';
import { StatusBadge } from '@/components/animated/StatusBadge';
import { ScoreBadge } from '@/components/animated/ScoreBadge';
import { AnimatedTabSwitcher } from '@/components/animated/AnimatedTabSwitcher';
import { ScanLoading } from '@/components/animated/ScanLoading';
import { LogResultBadge } from '@/components/animated/LogResultBadge';
import { FuturisticBackground } from '@/components/animated/FuturisticBackground';
import { MENU_COLORS } from '@/constants/theme';
import { RecentPerformanceCard } from '@/components/RecentPerformanceCard';
import { MarketStructureV2Card } from '@/components/MarketStructureV2Card';
import type { MarketStructureV2Result } from '@/components/MarketStructureV2Card';
import { TFBreakdownTable } from '@/components/TFBreakdownTable';
import {
  STORAGE_KEY_BREAKOUT_ENTRY,
  addLog,
  deleteLog,
  evaluateLog,
  loadLogs,
  updateLog,
  type SignalLog,
} from './signal-log-helpers';
import { journalSave, type JournalEntry } from './journal-helpers';

const ACCENT = MENU_COLORS.breakout;
// ─── Types (mirror BreakoutTradingResult dari backend) ─────────────────────────

interface RecentPerformance {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  periodLabel: string;
}

interface TFBreakdownItem {
  timeframe: string;
  label: string;
  detail: string;
  status: 'confirm' | 'warning' | 'neutral';
}

interface BreakoutTradingResult {
  status: 'siap_breakout' | 'siap_retest' | 'no_setup' | 'error';
  symbol: string;
  bias?: 'bullish' | 'bearish';
  mode?: 'confidence' | 'crossover';
  recommendedMode?: 'confidence' | 'crossover';
  recentPerformance?: RecentPerformance;
  tfBreakdown?: TFBreakdownItem[];
  currentPrice: number;
  timestamp: string;
  message?: string;
  confidenceScore?: number;
  confidenceTier?: 'high' | 'medium';
  score?: number;
  maxScore: number;
  brokenLevel?: number;
  levelHits?: number;
  zoneEdgeUpper?: number;
  zoneEdgeLower?: number;
  candlesNearEdge?: number;
  entryPrice?: number;
  orderType?: 'stop' | 'limit';
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  rr1?: number;
  volumeRatio?: number;
  filterResults?: string[];
  adxRising?: boolean;
  macdHistogramExpanding?: boolean;
  vwapBreakout?: boolean;
  momentumClassification?: 'very_fast' | 'fast' | 'normal' | 'slow';
  technicalSnapshot?: JournalEntry['technicalSnapshot'];
  marketStructureV2?: MarketStructureV2Result | null;
}

// ─── Fetch hooks (fetch langsung ke backend, relative path /api) ───────────────

function useBreakoutEntry(symbol: string, mode?: 'confidence' | 'crossover', enabled: boolean = true) {
  const [data, setData] = useState<BreakoutTradingResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);

  const fetchData = useCallback(async () => {
    if (!symbol || !enabled) return;
    setIsLoading(true);
    setIsError(false);
    try {
      const modeQuery = mode ? `&mode=${mode}` : '';
      const res = await fetch(`/api/breakout-entry?symbol=${symbol}${modeQuery}`);
      if (!res.ok) throw new Error('fetch failed');
      setData(await res.json());
    } catch {
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  }, [symbol, mode, enabled]);

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

// ─── Breakout Type Badge (khusus Menu 1) ────────────────────────────────────

// ─── Scan Coin Card ───────────────────────────────────────────────────────────

function ScanCoinCard({ coin, onPress, colors, index = 0 }: { coin: BreakoutTradingResult; onPress: () => void; colors: ReturnType<typeof useColors>; index?: number }) {
  const base = coin.symbol.replace('USDT', '');
  const isBuy = coin.bias === 'bullish';
  const biasColor = isBuy ? colors.bullish : colors.bearish;
  const isSiapRetest = coin.status === 'siap_retest';
  const statusColor = isSiapRetest ? colors.gold : '#818CF8';
  const isCrossover = coin.mode === 'crossover';
  const modeColor = isCrossover ? '#F97316' : ACCENT;

  return (
    <AnimatedCard index={index} onPress={onPress}>
    <DirectionalCard bias={coin.bias} style={scanStyles.card}>
      <View style={scanStyles.cardRow1}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
            <Text style={[scanStyles.cardBase, { color: colors.foreground }]}>{base}</Text>
            <Text style={[scanStyles.cardQuote, { color: colors.mutedForeground }]}>/USDT</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
            <View style={[scanStyles.biasBadge, { backgroundColor: `${biasColor}18`, borderColor: biasColor }]}>
              <Text style={[scanStyles.biasBadgeText, { color: biasColor }]}>{isBuy ? '▲ LONG' : '▼ SHORT'}</Text>
            </View>
            <View style={[scanStyles.biasBadge, { backgroundColor: `${statusColor}18`, borderColor: statusColor }]}>
              <Text style={[scanStyles.biasBadgeText, { color: statusColor }]}>
                {isSiapRetest ? '🎯 SIAP RETEST' : '⏳ SIAP BREAKOUT'}
              </Text>
            </View>
            <View style={[scanStyles.biasBadge, { backgroundColor: `${modeColor}18`, borderColor: modeColor }]}>
              <Text style={[scanStyles.biasBadgeText, { color: modeColor }]}>{isCrossover ? '🔀 Crossover' : '📊 Confidence'}</Text>
            </View>
          </View>
          {coin.volumeRatio !== undefined && (
            <Text style={{ fontSize: 9, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 2 }} numberOfLines={1}>
              Volume {(coin.volumeRatio * 100).toFixed(0)}% avg{coin.orderType ? ` · ${coin.orderType === 'stop' ? 'BUY/SELL STOP' : 'BUY/SELL LIMIT'}` : ''}
            </Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <StatusBadge status={coin.status} />
          {isCrossover
            ? <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: `${modeColor}18` }}>
                <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: modeColor }}>{coin.candlesSinceBreakout ?? 0}c lalu</Text>
              </View>
            : <ScoreBadge score={coin.confidenceScore ?? 0} max={coin.maxScore ?? 100} />
          }
        </View>
        <Feather name="chevron-right" size={13} color={colors.mutedForeground} style={{ marginLeft: 2, flexShrink: 0 }} />
      </View>

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
      </View>
    </DirectionalCard>
    </AnimatedCard>
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
        backgroundColor: `${ACCENT}15`,
        borderWidth: 1, borderColor: ACCENT,
        opacity: pressed || isLoading ? 0.6 : 1,
      }]}
    >
      {isLoading
        ? <ActivityIndicator size={10} color={ACCENT} />
        : <Feather name="refresh-cw" size={11} color={ACCENT} />
      }
      <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: ACCENT, letterSpacing: 0.5 }}>
        {isLoading ? 'SCANNING...' : 'SCAN NOW'}
      </Text>
    </Pressable>
  );
}

function ScanTab({ colors, onSelectCoin }: { colors: ReturnType<typeof useColors>; onSelectCoin: (coin: BreakoutTradingResult) => void }) {
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, refetch } = useBreakoutEntryScan();

  if (isLoading) {
    return (
      <View style={scanStyles.center}>
        <ScanLoading label="SCANNING BREAKOUT" accentColor={ACCENT} />
        <Text style={[scanStyles.loadingSub, { color: colors.mutedForeground }]}>Confidence Score & Breakout Crossover — 2 skill</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={scanStyles.center}>
        <Feather name="wifi-off" size={36} color={colors.mutedForeground} />
        <Text style={[scanStyles.emptyTitle, { color: colors.foreground }]}>Gagal memuat data</Text>
        <Pressable onPress={() => refetch()} style={[scanStyles.retryBtn, { backgroundColor: ACCENT }]}>
          <Text style={[scanStyles.retryText, { color: colors.primaryForeground }]}>Coba Lagi</Text>
        </Pressable>
      </View>
    );
  }

  const coins = data?.coins ?? [];
  const fetchedAt = data ? new Date(data.fetchedAt ?? Date.now()).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : null;
  const inZone      = coins.filter(c => c.status === 'siap_retest');
  const ready       = coins.filter(c => c.status === 'siap_breakout');

  if (coins.length === 0) {
    return (
      <View style={scanStyles.center}>
        <Feather name="trending-up" size={36} color={colors.mutedForeground} />
        <Text style={[scanStyles.emptyTitle, { color: colors.foreground }]}>Tidak ada setup breakout</Text>
        <Text style={[scanStyles.emptySub, { color: colors.mutedForeground }]}>Tidak ada koin yang lolos semua filter saat ini</Text>
        <Pressable onPress={() => refetch()} style={[scanStyles.retryBtn, { backgroundColor: ACCENT }]}>
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
          <Text style={[scanStyles.groupHeader, { color: colors.gold }]}>🎯 SIAP RETEST — Entry Sekarang</Text>
          {inZone.map((c, i) => <ScanCoinCard key={c.symbol} coin={c} colors={colors} index={i} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectCoin(c); }} />)}
        </>
      )}
      {ready.length > 0 && (
        <>
          <Text style={[scanStyles.groupHeader, { color: '#818CF8' }]}>⏳ SIAP BREAKOUT — Tunggu Retest</Text>
          {ready.map((c, i) => <ScanCoinCard key={c.symbol} coin={c} colors={colors} index={i} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectCoin(c); }} />)}
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

function AnalisaTab({ colors, initialSymbol, initialMode, pinnedData, onSignalReady, onSave }: {
  colors: ReturnType<typeof useColors>;
  initialSymbol?: string;
  initialMode?: 'confidence' | 'crossover';
  pinnedData?: BreakoutTradingResult | null;
  onSignalReady?: (d: BreakoutTradingResult | null) => void;
  onSave?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ symbol?: string; mode?: string }>();
  const [inputSymbol, setInputSymbol] = useState(initialSymbol ?? params.symbol ?? '');
  const [querySymbol, setQuerySymbol] = useState(initialSymbol ?? params.symbol ?? '');
  // undefined = belum dipilih manual, biar classifier backend (ADX H1) yang nentuin otomatis
  const [mode, setMode] = useState<'confidence' | 'crossover' | undefined>(
    initialMode ?? (params.mode === 'confidence' || params.mode === 'crossover' ? params.mode : undefined)
  );
  // liveMode=false artinya lagi nampilin data yang DI-KUNCI dari hasil Scan (gak
  // auto-fetch ulang) — biar sinyal gak diem-diem berubah pas user transisi ke
  // Binance buat eksekusi. liveMode=true = data fresh (search manual / refresh eksplisit).
  const [liveMode, setLiveMode] = useState(!pinnedData);

  useEffect(() => {
    setLiveMode(!pinnedData); // reset tiap kali coin baru dipilih dari Scan
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedData]);

  const { data: liveData, isLoading, isError, refetch } = useBreakoutEntry(querySymbol, mode, liveMode);
  const data = liveMode ? liveData : pinnedData;

  useEffect(() => {
    if (onSignalReady) onSignalReady(data?.status === 'siap_breakout' || data?.status === 'siap_retest' ? data : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const handleAnalyze = useCallback(() => {
    const sym = inputSymbol.trim().toUpperCase();
    if (!sym) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const normalized = sym.endsWith('USDT') ? sym : `${sym}USDT`;
    setQuerySymbol(normalized);
    setLiveMode(true); // search manual = selalu minta data fresh
  }, [inputSymbol]);

  const handleRefreshLive = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLiveMode(true);
  }, []);

  const [savingJournal, setSavingJournal] = useState(false);
  const handleSaveJournal = useCallback(async () => {
    if (!data || !data.entryPrice || !data.bias) return;
    setSavingJournal(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const skillLabel = data.mode === 'confidence' ? 'Confidence Score' : 'Crossover';
    const entry: JournalEntry = {
      id: `${Date.now()}_${data.symbol}`,
      symbol: data.symbol, bias: data.bias,
      sourceMenu: 'Breakout Entry', sourceSkill: skillLabel,
      entryPrice: data.entryPrice, stopLoss: data.stopLoss ?? 0, takeProfit1: data.takeProfit1 ?? 0, takeProfit2: data.takeProfit2,
      currentPriceAtSignal: data.currentPrice, rr1: data.rr1,
      tfStruktur: data.mode === 'confidence' ? '15M' : 'M30', tfEksekusi: data.mode === 'confidence' ? '1M' : 'M5',
      technicalSnapshot: data.technicalSnapshot,
      timestamp: data.timestamp, savedAt: Date.now(), status: 'pending',
    };
    await journalSave(entry);
    setSavingJournal(false);
  }, [data]);

  const bottomPadding = 60 + (Platform.OS === 'web' ? 34 : insets.bottom);

  return (
    <View style={{ flex: 1 }}>
      {/* Mode Switcher — Confidence Score (S/R + weighted score) vs Breakout Crossover (multi-TF SMA) */}
      <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
        <View style={[styles.tabSwitcher, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {(['confidence', 'crossover'] as const).map((m) => {
            const active = (mode ?? data?.recommendedMode) === m;
            return (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                style={[styles.tabBtn, active && { backgroundColor: `${ACCENT}22` }]}
              >
                <Text style={[styles.tabBtnText, { color: active ? ACCENT : colors.mutedForeground }]}>
                  {m === 'confidence' ? 'Confidence Score' : 'Breakout Crossover'}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {data?.recommendedMode && mode && data.recommendedMode !== mode && (
          <Text style={{ fontSize: 10, color: colors.mutedForeground, marginTop: 4, fontStyle: 'italic' }}>
            💡 Classifier rekomendasiin "{data.recommendedMode === 'confidence' ? 'Confidence Score' : 'Breakout Crossover'}" buat koin ini
          </Text>
        )}
      </View>

      <View style={[styles.inputArea, { borderBottomColor: colors.border }]}>
        <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="trending-up" size={15} color={ACCENT} />
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
          style={({ pressed }) => [styles.analyzeBtn, { backgroundColor: ACCENT, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={[styles.analyzeBtnText, { color: colors.primaryForeground }]}>Analisa</Text>
        </Pressable>
      </View>

      {!querySymbol ? (
        <View style={styles.emptyState}>
          <Feather name="trending-up" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Breakout Entry Scanner</Text>
          <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>Masukkan pair buat analisa level S/R + confidence score</Text>
        </View>
      ) : (liveMode && isLoading) ? (
        <View style={styles.emptyState}>
          <ScanLoading label="MENGANALISA" accentColor={ACCENT} coins={[querySymbol || 'BTCUSDT']} />
        </View>
      ) : (liveMode && (isError || !data)) ? (
        <View style={styles.emptyState}>
          <Feather name="alert-circle" size={36} color={colors.bearish} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Gagal menganalisa</Text>
          <Pressable onPress={() => refetch()} style={[styles.retryBtn, { backgroundColor: ACCENT }]}>
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : !data ? (
        <View style={styles.emptyState}>
          <Feather name="alert-circle" size={36} color={colors.bearish} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Data gak ketemu</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: bottomPadding }} showsVerticalScrollIndicator={false}>
          {/* Banner: data terkunci dari Scan, BUKAN live */}
          {!liveMode && pinnedData && (
            <AnimatedCard index={0}>
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginTop: 12,
              padding: 12, borderRadius: 10, backgroundColor: 'rgba(251,191,36,0.08)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.3)',
            }}>
              <Feather name="lock" size={16} color="#FBBF24" />
              <Text style={{ flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, lineHeight: 16 }}>
                Data dari hasil Scan tadi (terkunci) — kondisi market bisa udah geser. Sebelum eksekusi ke exchange, disaranin refresh dulu.
              </Text>
              <Pressable onPress={handleRefreshLive} style={({ pressed }) => [{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: '#FBBF24', opacity: pressed ? 0.8 : 1 }]}>
                <Feather name="refresh-cw" size={14} color="#000" />
              </Pressable>
            </View>
            </AnimatedCard>
          )}

          {/* Header result */}
          <AnimatedCard index={1}>
          <View style={[styles.section, { backgroundColor: 'rgba(34,211,238,0.06)', borderColor: 'rgba(34,211,238,0.25)' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View>
                <Text style={[styles.pairTitle, { color: colors.foreground }]}>
                  {data.symbol.replace('USDT', '')}/USDT
                </Text>
                <Text style={[styles.timestamp, { color: colors.mutedForeground }]}>{data.timestamp}</Text>
              </View>
              <View style={{ gap: 6, alignItems: 'flex-end' }}>
                <StatusBadge status={data.status} />
                {data.confidenceScore !== undefined && <ScoreBadge score={data.confidenceScore} max={100} />}
              </View>
            </View>
            {data.message && (
              <View style={[styles.messageBox, { backgroundColor: `${ACCENT}10`, borderLeftColor: ACCENT }]}>
                <Text style={[styles.messageText, { color: colors.mutedForeground }]}>{data.message}</Text>
              </View>
            )}
          </View>
          </AnimatedCard>

          {/* Simpan Sinyal */}
          {(data.status === 'siap_breakout' || data.status === 'siap_retest') && onSave && (
            <Pressable onPress={onSave}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, margin: 12, marginTop: 4, paddingVertical: 14, borderRadius: 12, backgroundColor: ACCENT, opacity: pressed ? 0.8 : 1 }]}>
              <Feather name="bookmark" size={15} color={colors.primaryForeground} />
              <Text style={{ fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.primaryForeground }}>Simpan Sinyal ke Log</Text>
            </Pressable>
          )}
          {(data.status === 'siap_breakout' || data.status === 'siap_retest') && (
            <Pressable onPress={handleSaveJournal} disabled={savingJournal}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 12, marginTop: 4, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: MENU_COLORS.journal, backgroundColor: `${MENU_COLORS.journal}12`, opacity: pressed || savingJournal ? 0.7 : 1 }]}>
              <Feather name="book-open" size={14} color={MENU_COLORS.journal} />
              <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: MENU_COLORS.journal }}>{savingJournal ? 'Menyimpan...' : 'Simpan ke Journal (detail lengkap)'}</Text>
            </Pressable>
          )}

          <View style={{ marginHorizontal: 12 }}>
            <MarketStructureV2Card data={data.marketStructureV2} />
          </View>

          {/* Order (LIMIT hampir selalu — basis breakout+retest. STOP cuma
              buat Confidence Score yang genuinely anticipatory) */}
          {data.entryPrice !== undefined && (
            <AnimatedCard index={2}>
            <View style={[styles.section, { backgroundColor: 'rgba(74,222,128,0.06)', borderColor: 'rgba(74,222,128,0.22)' }]}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
                {data.orderType === 'stop' ? 'PASANG STOP ORDER' : 'PASANG LIMIT ORDER (RETEST)'}
              </Text>
              <View style={[styles.levelCard, {
                backgroundColor: `${data.bias === 'bullish' ? colors.bullish : colors.bearish}10`,
                borderColor: data.bias === 'bullish' ? colors.bullish : colors.bearish
              }]}>
                <Text style={[styles.levelCardLabel, { color: colors.mutedForeground }]}>LEVEL S&R</Text>
                <Text style={[styles.levelCardPrice, { color: data.bias === 'bullish' ? colors.bullish : colors.bearish }]}>
                  {formatPrice(data.entryPrice)}
                </Text>
                <Text style={[styles.levelCardSub, { color: colors.mutedForeground }]}>
                  {data.bias === 'bullish'
                    ? (data.orderType === 'stop' ? 'BUY STOP — nangkep breakout otomatis' : 'BUY LIMIT — nunggu retest balik ke level')
                    : (data.orderType === 'stop' ? 'SELL STOP — nangkep breakout otomatis' : 'SELL LIMIT — nunggu retest balik ke level')}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.bearish }]}>Stop Loss</Text>
                <Text style={[styles.infoValue, { color: colors.bearish }]}>{data.stopLoss ? formatPrice(data.stopLoss) : '—'}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.bullish }]}>{`TP — R:R 1:${data.rr1?.toFixed(1) ?? (data.mode === 'crossover' ? '2' : '3')}`}</Text>
                <Text style={[styles.infoValue, { color: colors.bullish }]}>{data.takeProfit1 ? formatPrice(data.takeProfit1) : '—'}</Text>
              </View>
              {data.mode === 'crossover' && data.takeProfit2 !== undefined && (
                <>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.gold }]}>TP2 — R:R 1:3</Text>
                    <Text style={[styles.infoValue, { color: colors.gold }]}>{formatPrice(data.takeProfit2)}</Text>
                  </View>
                </>
              )}
              {data.mode === 'confidence' && data.zoneEdgeUpper !== undefined && data.zoneEdgeLower !== undefined && (
                <>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Zona Edge</Text>
                    <Text style={[styles.infoValue, { color: colors.foreground }]}>
                      {formatPrice(data.zoneEdgeLower)} – {formatPrice(data.zoneEdgeUpper)}
                    </Text>
                  </View>
                </>
              )}
              {data.candlesNearEdge !== undefined && (
                <>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Nongkrong Deket Edge</Text>
                    <Text style={[styles.infoValue, { color: colors.foreground }]}>{data.candlesNearEdge} candle M15</Text>
                  </View>
                </>
              )}
              {data.levelHits !== undefined && (
                <>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Level Hits</Text>
                    <Text style={[styles.infoValue, { color: colors.foreground }]}>{data.levelHits}x disentuh sebelumnya</Text>
                  </View>
                </>
              )}
            </View>
            </AnimatedCard>
          )}

          {/* Filter Results */}
          {data.filterResults && data.filterResults.length > 0 && (
            <AnimatedCard index={3}>
            <View style={[styles.section, { backgroundColor: 'rgba(251,191,36,0.05)', borderColor: 'rgba(251,191,36,0.2)' }]}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
                CONFIDENCE FACTORS ({data.confidenceScore}/100 — {data.confidenceTier === 'high' ? 'High' : 'Medium'})
              </Text>
              {data.filterResults.map((f, i) => {
                const isPassed = f.startsWith('✅');
                return (
                  <Text key={i} style={[styles.filterItem, { color: isPassed ? colors.foreground : colors.mutedForeground }]}>
                    {f}
                  </Text>
                );
              })}
            </View>
            </AnimatedCard>
          )}

          <TFBreakdownTable items={data?.tfBreakdown} accentColor={ACCENT} />

          <RecentPerformanceCard data={data?.recentPerformance} accentColor={ACCENT} />

          {/* Kalkulator PnL button */}
          {data.entryPrice !== undefined && (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push({
                  pathname: '/(tabs)/tools',
                  params: {
                    section: 'kalkulator',
                    entryPrice: String(data.entryPrice ?? 0),
                    stopLoss: String(data.stopLoss ?? 0),
                    takeProfit1: String(data.takeProfit1 ?? 0),
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
  const fp = (v: number) => v >= 1000 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v.toFixed(6);

  const wins = logs.filter(l => l.status === 'win_tp1' || l.status === 'win_tp2').length;
  const loses = logs.filter(l => l.status === 'lose').length;
  const wr = wins + loses > 0 ? Math.round(wins / (wins + loses) * 100) : 0;
  const rrs = logs.filter(l => (l.rr ?? 0) > 0);
  const avgRR = rrs.length ? (rrs.reduce((a, b) => a + (b.rr ?? 0), 0) / rrs.length).toFixed(2) : '—';

  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={ACCENT} /></View>;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 80 }} showsVerticalScrollIndicator={false}>
      {logs.length > 0 && (
        <View style={{ flexDirection: 'row', margin: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14, justifyContent: 'space-around' }}>
          {[
            { v: `${wins}`, c: '#4ADE80', bg: 'rgba(74,222,128,0.12)', l: 'WIN' },
            { v: `${loses}`, c: '#F87171', bg: 'rgba(248,113,113,0.1)', l: 'LOSE' },
            { v: `${logs.filter(x => x.status === 'pending').length}`, c: '#94A3B8', bg: 'rgba(148,163,184,0.08)', l: 'PENDING' },
            { v: `${wr}%`, c: '#FBBF24', bg: 'rgba(251,191,36,0.12)', l: 'WIN RATE' },
            { v: avgRR, c: ACCENT, bg: `${ACCENT}18`, l: 'AVG R:R' },
          ].map((item, i) => (
            <View key={item.l} style={{ alignItems: 'center', gap: 4, backgroundColor: item.bg, borderRadius: 9, paddingVertical: 8, paddingHorizontal: 6, minWidth: 52 }}>
              <Text style={{ fontSize: 16, fontFamily: 'Inter_700Bold', color: item.c }}>{item.v}</Text>
              <Text style={{ fontSize: 8, fontFamily: 'Inter_500Medium', color: colors.mutedForeground, letterSpacing: 0.3 }}>{item.l}</Text>
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
          {logs.map((log, index) => (
            <AnimatedCard key={log.id} index={index}>
            <View style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: 'hidden', borderLeftWidth: 3, borderLeftColor: sc(log.status) }}>
              <View style={{ flexDirection: 'row', padding: 12, alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 16, fontFamily: 'Inter_600SemiBold', color: colors.foreground }}>{log.symbol.replace('USDT', '')}/USDT</Text>
                    {log.mode && (
                      <View style={{
                        paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
                        backgroundColor: log.mode === 'crossover' ? '#F9731618' : `${ACCENT}18`,
                      }}>
                        <Text style={{ fontSize: 9, fontFamily: 'Inter_700Bold', color: log.mode === 'crossover' ? '#F97316' : ACCENT }}>
                          {log.mode === 'crossover' ? 'Crossover' : 'Confidence'}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 2 }}>{log.timestamp}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <LogResultBadge status={log.status} />
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
                    style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: ACCENT, backgroundColor: ACCENT + '15', opacity: pressed || evaluating === log.id ? 0.7 : 1 }]}>
                    {evaluating === log.id ? <ActivityIndicator size={12} color={ACCENT} /> : <Feather name="search" size={12} color={ACCENT} />}
                    <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: ACCENT }}>{evaluating === log.id ? 'Evaluasi...' : 'Evaluasi'}</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => doDelete(log.id)} style={({ pressed }) => [{ padding: 8, opacity: pressed ? 0.7 : 1 }]}>
                  <Feather name="trash-2" size={12} color="#ef4444" />
                </Pressable>
              </View>
            </View>
            </AnimatedCard>
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
  const [pinnedCoin, setPinnedCoin] = useState<BreakoutTradingResult | undefined>();
  const [currentSignal, setCurrentSignal] = useState<BreakoutTradingResult | null>(null);

  const handleSaveSignal = useCallback(async () => {
    if (!currentSignal || currentSignal.entryPrice === undefined) return;
    const isCrossover = currentSignal.mode === 'crossover';
    const log: SignalLog = {
      id: `${Date.now()}_${currentSignal.symbol}`,
      menu: 'breakout_entry',
      mode: currentSignal.mode,
      symbol: currentSignal.symbol,
      bias: currentSignal.bias ?? 'bullish',
      entryPrice: currentSignal.entryPrice,
      stopLoss: currentSignal.stopLoss ?? 0,
      takeProfit1: currentSignal.takeProfit1 ?? 0,
      takeProfit2: currentSignal.takeProfit2,
      currentPriceAtSignal: currentSignal.currentPrice,
      timestamp: currentSignal.timestamp,
      savedAt: Date.now(),
      // Mode crossover (v3) udah gak punya confidence score numerik lagi (basis
      // rule-engine Skill 15M) — pakai candlesSinceBreakout sebagai proxy info.
      // Mode confidence tetep pakai confidenceScore (0-100) langsung.
      probabilityOrScore: isCrossover ? undefined : currentSignal.confidenceScore,
      zoneType: currentSignal.status,
      status: 'pending',
    };
    await addLog(STORAGE_KEY_BREAKOUT_ENTRY, log);
    setActiveTab('log');
  }, [currentSignal]);

  const handleSelectCoin = useCallback((coin: BreakoutTradingResult) => {
    setPinnedCoin(coin);
    setActiveTab('analisa');
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FuturisticBackground accentColor={ACCENT} secondaryColor="#A78BFA" />
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={styles.headerTop}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Breakout Entry</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>2 Skill — Confidence Score (S/R+scoring) & Breakout Crossover (multi-TF)</Text>
          </View>
          {activeTab === 'scan' && (
            <View style={[styles.liveDot, { backgroundColor: `${colors.bullish}20` }]}>
              <View style={[styles.liveDotInner, { backgroundColor: colors.bullish }]} />
              <Text style={[styles.liveText, { color: colors.bullish }]}>LIVE</Text>
            </View>
          )}
        </View>
        <AnimatedTabSwitcher
          tabs={[
            { key: 'scan', label: 'SCAN' },
            { key: 'analisa', label: 'ANALISA' },
            { key: 'log', label: 'LOG' },
          ]}
          active={activeTab}
          onChange={(k) => setActiveTab(k as 'scan' | 'analisa' | 'log')}
          accentColor={ACCENT}
        />
      </View>

      {activeTab === 'scan'
        ? <ScanTab colors={colors} onSelectCoin={handleSelectCoin} />
        : activeTab === 'analisa'
        ? <AnalisaTab colors={colors} initialSymbol={pinnedCoin?.symbol} initialMode={pinnedCoin?.mode as 'confidence' | 'crossover' | undefined} pinnedData={pinnedCoin} onSignalReady={setCurrentSignal} onSave={handleSaveSignal} />
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