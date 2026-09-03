import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { AnimatedCard } from '@/components/animated/AnimatedCard';
import { ScanLoading } from '@/components/animated/ScanLoading';
import { FuturisticBackground } from '@/components/animated/FuturisticBackground';
import { MarketStructureV2Card } from '@/components/MarketStructureV2Card';
import type { MarketStructureV2Result } from '@/components/MarketStructureV2Card';
import { SortSelector, applySorting, type SortKey } from '@/components/SortSelector';
import { MENU_COLORS } from '@/constants/theme';

const ACCENT = MENU_COLORS.multiTfScan;

// ─── Tipe lokal (fetch langsung, gak pake generated client — codegen belum
// tentu udah dijalanin pas file ini ditimpa) ────────────────────────────────

type Bias = 'bullish' | 'bearish' | 'sideways';

interface ZoneInfo {
  type: 'order_block' | 'sr_fib';
  low: number;
  high: number;
  mid: number;
  touches: number;
}

interface DivergenceResult {
  bullish: boolean;
  bearish: boolean;
}

interface FreshBreakoutInfo {
  bias: 'bullish' | 'bearish';
  level: number;
  breakoutPrice: number;
  candlesSinceBreakout: number;
}

interface TFDetail {
  timeframe: 'D1' | 'H4' | 'H1' | 'M30' | 'M15' | 'M5';
  bias: Bias;
  adx: number;
  confirmations: string[];
  zone?: ZoneInfo;
  rsiDivergence?: DivergenceResult;
  volumeDivergence?: DivergenceResult;
  marketStructureV2?: MarketStructureV2Result | null;
  breakout?: FreshBreakoutInfo;
}

interface MultiTFScanCoin {
  symbol: string;
  d1Bias: Bias;
  d1Adx: number;
  h4Bias: Bias;
  h4Adx: number;
  // FIX (request user, tombol sortir Volume/Perubahan Harga/Funding Rate)
  marketMeta?: { priceChangePercent: number; quoteVolume: number; fundingRate: number | null } | null;
}

interface MultiTFDetailResult {
  status: 'ok' | 'error';
  symbol: string;
  timestamp: string;
  message?: string;
  coinTFs?: TFDetail[];
  btcTFs?: TFDetail[];
}

// ─── Fetch hooks ────────────────────────────────────────────────────────────

function useMultiTFScan() {
  const [data, setData] = useState<{ coins: MultiTFScanCoin[] } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setIsError(false);
    try {
      const res = await fetch('/api/multi-tf-scan');
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

function useMultiTFDetail(symbol: string) {
  const [data, setData] = useState<MultiTFDetailResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);

  const fetchData = useCallback(async () => {
    if (!symbol) return;
    setIsLoading(true);
    setIsError(false);
    try {
      const res = await fetch(`/api/multi-tf-detail?symbol=${symbol}`);
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

// ─── Helper tampilan bias ───────────────────────────────────────────────────

function biasColorOf(bias: Bias, colors: ReturnType<typeof useColors>) {
  if (bias === 'bullish') return colors.bullish;
  if (bias === 'bearish') return colors.bearish;
  return colors.mutedForeground;
}
function biasLabelOf(bias: Bias) {
  if (bias === 'bullish') return '▲ Bullish';
  if (bias === 'bearish') return '▼ Bearish';
  return '↔ Sideways';
}

// ─── Scan Coin Card ─────────────────────────────────────────────────────────

function ScanCoinCard({ coin, onPress, colors, index = 0 }: { coin: MultiTFScanCoin; onPress: () => void; colors: ReturnType<typeof useColors>; index?: number }) {
  const base = coin.symbol.replace('USDT', '');
  const d1Color = biasColorOf(coin.d1Bias, colors);
  const h4Color = biasColorOf(coin.h4Bias, colors);

  return (
    <AnimatedCard index={index} onPress={onPress}>
      <View style={[scanStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={scanStyles.cardRow1}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
              <Text style={[scanStyles.cardBase, { color: colors.foreground }]}>{base}</Text>
              <Text style={[scanStyles.cardQuote, { color: colors.mutedForeground }]}>/USDT</Text>
            </View>
          </View>
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        </View>
        <View style={[scanStyles.condRow, { borderTopColor: colors.border }]}>
          <View style={scanStyles.condItem}>
            <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>D1 (ADX {coin.d1Adx.toFixed(0)})</Text>
            <Text style={[scanStyles.condValue, { color: d1Color }]}>{biasLabelOf(coin.d1Bias)}</Text>
          </View>
          <View style={[scanStyles.condDivider, { backgroundColor: colors.border }]} />
          <View style={scanStyles.condItem}>
            <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>H4 (ADX {coin.h4Adx.toFixed(0)})</Text>
            <Text style={[scanStyles.condValue, { color: h4Color }]}>{biasLabelOf(coin.h4Bias)}</Text>
          </View>
        </View>
      </View>
    </AnimatedCard>
  );
}

// ─── Scan View ──────────────────────────────────────────────────────────────

function ScanView({ colors, onSelectCoin }: { colors: ReturnType<typeof useColors>; onSelectCoin: (symbol: string) => void }) {
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, refetch } = useMultiTFScan();
  const [sortKey, setSortKey] = useState<SortKey>('default');
  const coins = applySorting(data?.coins ?? [], sortKey, c => c.marketMeta);
  const fetchedAt = data ? new Date(Date.now()).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : null;

  if (isLoading) {
    return (
      <View style={scanStyles.center}>
        <ScanLoading label="SCANNING TREND D1+H4" accentColor={ACCENT} />
        <Text style={[scanStyles.loadingSub, { color: colors.mutedForeground }]}>D1 ADX≥25 & H4 ADX≥25 (independen)</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={scanStyles.center}>
        <Feather name="alert-triangle" size={36} color={colors.bearish} />
        <Text style={[scanStyles.emptyTitle, { color: colors.foreground }]}>Gagal fetch data</Text>
        <Pressable onPress={() => refetch()} style={[scanStyles.retryBtn, { backgroundColor: ACCENT }]}>
          <Text style={[scanStyles.retryText, { color: colors.primaryForeground }]}>Coba Lagi</Text>
        </Pressable>
      </View>
    );
  }

  if (coins.length === 0) {
    return (
      <View style={scanStyles.center}>
        <Feather name="grid" size={36} color={colors.mutedForeground} />
        <Text style={[scanStyles.emptyTitle, { color: colors.foreground }]}>Gak ada koin yang trending kuat</Text>
        <Text style={[scanStyles.emptySub, { color: colors.mutedForeground }]}>D1 dan H4 harus sama-sama ADX≥25 (independen, gak perlu searah)</Text>
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
        <Pressable onPress={() => refetch()} style={[scanStyles.scanNowBtn, { borderColor: ACCENT }]}>
          <Feather name="refresh-cw" size={12} color={ACCENT} />
          <Text style={[scanStyles.scanNowText, { color: ACCENT }]}>Scan Ulang</Text>
        </Pressable>
      </View>
      <SortSelector value={sortKey} onChange={setSortKey} />
      <Text style={[scanStyles.groupHeader, { color: ACCENT }]}>📊 D1 & H4 TRENDING KUAT ({coins.length} koin)</Text>
      {coins.map((c, i) => <ScanCoinCard key={c.symbol} coin={c} colors={colors} index={i} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectCoin(c.symbol); }} />)}
    </ScrollView>
  );
}

// ─── TF Detail Card ─────────────────────────────────────────────────────────

function TFDetailCard({ tf, colors, index }: { tf: TFDetail; colors: ReturnType<typeof useColors>; index: number }) {
  const biasColor = biasColorOf(tf.bias, colors);
  // Sekarang breakout udah pasti "ADA" begitu backend ngirim field ini
  // (backend cuma isi field ini kalau breakout candle-nya udah kejadian+valid,
  // TANPA nunggu retest — lihat detectFreshBreakout di backend)
  const hasBreakout = !!tf.breakout;
  const breakoutColor = hasBreakout ? (tf.breakout!.bias === 'bullish' ? colors.bullish : colors.bearish) : undefined;

  return (
    <AnimatedCard index={index}>
      <View style={[
        styles.section,
        { backgroundColor: colors.card, borderColor: hasBreakout ? breakoutColor : colors.border },
        // Border/glow mencolok (request user) — TF yang lagi breakout valid
        // ditandain beda dari TF biasa, biar keliatan langsung tanpa perlu baca detail
        hasBreakout && { borderWidth: 2, shadowColor: breakoutColor, shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
      ]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[styles.tfLabel, { color: colors.foreground }]}>{tf.timeframe}</Text>
            {hasBreakout && (
              <View style={[styles.biasBadge, { backgroundColor: `${breakoutColor}25`, borderColor: breakoutColor }]}>
                <Text style={[styles.biasBadgeText, { color: breakoutColor }]}>🎯 ADA BREAKOUT</Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground }}>ADX {tf.adx.toFixed(1)}</Text>
            <View style={[styles.biasBadge, { backgroundColor: `${biasColor}18`, borderColor: biasColor }]}>
              <Text style={[styles.biasBadgeText, { color: biasColor }]}>{biasLabelOf(tf.bias)}</Text>
            </View>
          </View>
        </View>

        {tf.breakout && (
          <View style={[styles.infoRow, { backgroundColor: `${breakoutColor}12`, borderRadius: 8, padding: 8, marginBottom: 8 }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: breakoutColor, marginBottom: 2 }}>
                {tf.breakout.bias === 'bullish' ? '▲ LONG' : '▼ SHORT'} — nembus {tf.breakout.level.toFixed(4)}
              </Text>
              <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground }}>
                Breakout di {tf.breakout.breakoutPrice.toFixed(4)} · {tf.breakout.candlesSinceBreakout === 0 ? 'candle ini' : `${tf.breakout.candlesSinceBreakout} candle lalu`}
              </Text>
            </View>
          </View>
        )}

        {tf.marketStructureV2 && (
          <View style={{ marginBottom: 8 }}>
            <MarketStructureV2Card data={tf.marketStructureV2} compact />
          </View>
        )}

        {tf.confirmations.length > 0 && (
          <View style={{ marginBottom: 6 }}>
            {tf.confirmations.map((c, i) => (
              <Text key={i} style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, lineHeight: 17 }}>{c}</Text>
            ))}
          </View>
        )}

        {tf.zone && (
          <View style={[styles.infoRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 6, marginTop: 4 }]}>
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>
              {tf.zone.type === 'order_block' ? '📦 Order Block' : '📐 S&R+Fib'}
            </Text>
            <Text style={[styles.infoValue, { color: colors.foreground }]}>
              {tf.zone.low.toFixed(4)} – {tf.zone.high.toFixed(4)}
            </Text>
          </View>
        )}

        {tf.rsiDivergence && (tf.rsiDivergence.bullish || tf.rsiDivergence.bearish) && (
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>RSI Divergence</Text>
            <Text style={[styles.infoValue, { color: tf.rsiDivergence.bullish ? colors.bullish : colors.bearish }]}>
              {tf.rsiDivergence.bullish ? '✅ Bullish' : '✅ Bearish'}
            </Text>
          </View>
        )}

        {tf.volumeDivergence && (tf.volumeDivergence.bullish || tf.volumeDivergence.bearish) && (
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Volume Divergence</Text>
            <Text style={[styles.infoValue, { color: tf.volumeDivergence.bullish ? colors.bullish : colors.bearish }]}>
              {tf.volumeDivergence.bullish ? '⚠️ Bullish (momentum jual lemah)' : '⚠️ Bearish (momentum beli lemah)'}
            </Text>
          </View>
        )}
      </View>
    </AnimatedCard>
  );
}

// ─── Detail View ────────────────────────────────────────────────────────────

function DetailView({ colors, symbol, onBack }: { colors: ReturnType<typeof useColors>; symbol: string; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [subTab, setSubTab] = useState<'coin' | 'btc'>('coin');
  const { data, isLoading, isError, refetch } = useMultiTFDetail(symbol);
  const base = symbol.replace('USDT', '');

  const tfs = subTab === 'coin' ? data?.coinTFs : data?.btcTFs;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.detailHeader}>
        <Pressable onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Feather name="arrow-left" size={18} color={colors.foreground} />
          <Text style={[styles.detailHeaderTitle, { color: colors.foreground }]}>{base}/USDT</Text>
        </Pressable>
        <Pressable onPress={() => refetch()}>
          <Feather name="refresh-cw" size={16} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
        <View style={[styles.tabSwitcher, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {(['coin', 'btc'] as const).map((t) => {
            const active = subTab === t;
            return (
              <Pressable key={t} onPress={() => setSubTab(t)} style={[styles.tabBtn, active && { backgroundColor: `${ACCENT}22` }]}>
                <Text style={[styles.tabBtnText, { color: active ? ACCENT : colors.mutedForeground }]}>
                  {t === 'coin' ? base : 'BTC'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {isLoading ? (
        <View style={scanStyles.center}>
          <ActivityIndicator color={ACCENT} />
        </View>
      ) : isError || !data || data.status === 'error' ? (
        <View style={scanStyles.center}>
          <Feather name="alert-triangle" size={32} color={colors.bearish} />
          <Text style={[scanStyles.emptyTitle, { color: colors.foreground }]}>{data?.message ?? 'Gagal fetch data'}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          {(() => {
            const breakoutTFs = tfs?.filter(tf => tf.breakout) ?? [];
            if (breakoutTFs.length < 2) return null;
            // Cek apakah SEMUA breakout yang ketemu itu SEARAH (bukan campur bullish+bearish)
            const allBullish = breakoutTFs.every(tf => tf.breakout!.bias === 'bullish');
            const allBearish = breakoutTFs.every(tf => tf.breakout!.bias === 'bearish');
            const bonusColor = allBullish ? colors.bullish : allBearish ? colors.bearish : colors.gold;
            return (
              <View style={[styles.section, { backgroundColor: `${bonusColor}15`, borderColor: bonusColor, borderWidth: 2, marginBottom: 12 }]}>
                <Text style={{ fontSize: 13, fontFamily: 'Inter_700Bold', color: bonusColor, marginBottom: 4 }}>
                  🔥 BONUS — {breakoutTFs.length} TF breakout bareng!
                </Text>
                <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground }}>
                  {breakoutTFs.map(tf => tf.timeframe).join(', ')}
                  {allBullish || allBearish ? ` — SEMUA ${allBullish ? 'LONG' : 'SHORT'}, sinyal makin kuat` : ' — arah campur, hati-hati'}
                </Text>
              </View>
            );
          })()}
          {tfs?.map((tf, i) => <TFDetailCard key={tf.timeframe} tf={tf} colors={colors} index={i} />)}
          <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, textAlign: 'center', marginTop: 8, fontStyle: 'italic' }}>
            Zona referensi (📦/📐) itu info doang. Breakout (🎯) itu candle udah nembus zona + volume valid + lolos struktur — BUKAN sinyal entry siap pakai (belum ada retest), tetep DYOR sebelum eksekusi.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

// ─── Main Screen ────────────────────────────────────────────────────────────

export default function MultiTFScanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const [selectedSymbol, setSelectedSymbol] = useState<string | undefined>();
  const [inputSymbol, setInputSymbol] = useState('');

  const handleSelectCoin = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
  }, []);

  const handleSearch = useCallback(() => {
    const sym = inputSymbol.trim().toUpperCase();
    if (!sym) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const normalized = sym.endsWith('USDT') ? sym : `${sym}USDT`;
    setSelectedSymbol(normalized);
  }, [inputSymbol]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FuturisticBackground accentColor={ACCENT} secondaryColor="#6EE7B7" />
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Multi-TF Scanner</Text>
        <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>D1+H4 trending kuat → breakdown 6 TF (D1/H4/H1/M30/M15/M5)</Text>
      </View>

      {!selectedSymbol && (
        <View style={styles.inputArea}>
          <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="search" size={15} color={ACCENT} />
            <TextInput
              style={[styles.inputText, { color: colors.foreground }]}
              placeholder="Cari koin manual (BTCUSDT)"
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
            <Text style={[styles.searchBtnText, { color: colors.primaryForeground }]}>Cari</Text>
          </Pressable>
        </View>
      )}

      {selectedSymbol
        ? <DetailView colors={colors} symbol={selectedSymbol} onBack={() => setSelectedSymbol(undefined)} />
        : <ScanView colors={colors} onSelectCoin={handleSelectCoin} />}
    </View>
  );
}

const scanStyles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  loadingSub: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 4 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', marginTop: 8, textAlign: 'center' },
  emptySub: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18 },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginTop: 8 },
  retryText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  scanNowBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  scanNowText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  groupHeader: { fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 0.5, marginBottom: 8, marginTop: 4 },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 10 },
  cardRow1: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardBase: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  cardQuote: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  condRow: { flexDirection: 'row', marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  condItem: { flex: 1 },
  condLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', marginBottom: 2 },
  condValue: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  condDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: 10 },
});

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
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12 },
  detailHeaderTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  tabSwitcher: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, overflow: 'hidden', height: 38 },
  tabBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8 },
  section: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 10 },
  tfLabel: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  biasBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  biasBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  infoLabel: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  infoValue: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
});