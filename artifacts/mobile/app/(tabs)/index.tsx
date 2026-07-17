import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useGetScreener } from '@workspace/api-client-react';
import type { ScreenerCoin } from '@workspace/api-client-react';

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatPrice(price: number): string {
  if (price >= 10000) return price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function formatVolume(vol: number): string {
  if (vol >= 1e9) return `$${(vol / 1e9).toFixed(1)}B`;
  if (vol >= 1e6) return `$${(vol / 1e6).toFixed(1)}M`;
  return `$${vol.toFixed(0)}`;
}

function formatSymbol(symbol: string): { base: string; quote: string } {
  return { base: symbol.replace('USDT', ''), quote: 'USDT' };
}

// ─── Coin Card ────────────────────────────────────────────────────────────────

interface CoinCardProps {
  coin: ScreenerCoin;
  onPress: (coin: ScreenerCoin) => void;
}

function CoinCard({ coin, onPress }: CoinCardProps) {
  const colors = useColors();
  const { base, quote } = formatSymbol(coin.symbol);
  const isPositive = coin.change24h >= 0;

  const biasColor = coin.bias === 'bullish' ? colors.bullish : colors.bearish;
  const biasLabel = coin.bias === 'bullish' ? 'BULLISH' : 'BEARISH';

  const confidenceColor =
    coin.confidence === 'HIGH'
      ? colors.bullish
      : coin.confidence === 'MODERATE'
      ? colors.gold
      : colors.mutedForeground;

  const confidenceBg =
    coin.confidence === 'HIGH'
      ? `${colors.bullish}20`
      : coin.confidence === 'MODERATE'
      ? `${colors.gold}20`
      : `${colors.mutedForeground}18`;

  const oiIcon =
    coin.oiDirection === 'up' ? '↑' : coin.oiDirection === 'down' ? '↓' : '→';
  const oiColor =
    coin.oiDirection === 'up'
      ? coin.bias === 'bullish' ? colors.bullish : colors.bearish
      : coin.oiDirection === 'down'
      ? coin.bias === 'bearish' ? colors.bullish : colors.bearish
      : colors.mutedForeground;

  return (
    <Pressable
      onPress={() => onPress(coin)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      {/* ── Row 1: Symbol · Confidence · Bias · Price ── */}
      <View style={styles.row1}>
        {/* Symbol */}
        <View style={styles.symbolCol}>
          <View style={styles.symbolRow}>
            <Text style={[styles.symbolBase, { color: colors.foreground }]}>{base}</Text>
            <Text style={[styles.symbolQuote, { color: colors.mutedForeground }]}>/{quote}</Text>
          </View>
          <Text style={[styles.volumeText, { color: colors.mutedForeground }]}>
            {formatVolume(coin.volume24h)}
          </Text>
        </View>

        {/* Confidence + Bias badges */}
        <View style={styles.badgeCol}>
          <View style={[styles.badge, { backgroundColor: confidenceBg, borderColor: confidenceColor }]}>
            <Text style={[styles.badgeText, { color: confidenceColor }]}>{coin.confidence}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: `${biasColor}15`, borderColor: biasColor, marginTop: 4 }]}>
            <Text style={[styles.badgeText, { color: biasColor }]}>{biasLabel}</Text>
          </View>
        </View>

        {/* Price + Change */}
        <View style={styles.priceCol}>
          <Text style={[styles.price, { color: colors.foreground }]}>
            ${formatPrice(coin.price)}
          </Text>
          <View style={[
            styles.changePill,
            { backgroundColor: isPositive ? `${colors.bullish}22` : `${colors.bearish}22` },
          ]}>
            <Feather
              name={isPositive ? 'trending-up' : 'trending-down'}
              size={10}
              color={isPositive ? colors.bullish : colors.bearish}
              style={{ marginRight: 2 }}
            />
            <Text style={[styles.changeText, { color: isPositive ? colors.bullish : colors.bearish }]}>
              {isPositive ? '+' : ''}{coin.change24h.toFixed(2)}%
            </Text>
          </View>
        </View>

        <Feather name="chevron-right" size={14} color={colors.mutedForeground} style={{ marginLeft: 2 }} />
      </View>

      {/* ── Row 2: Score bar + metrics ── */}
      <View style={[styles.row2, { borderTopColor: colors.border }]}>
        {/* Score */}
        <View style={styles.metricItem}>
          <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>SCORE</Text>
          <Text style={[styles.metricValue, { color: confidenceColor }]}>{coin.score}</Text>
        </View>

        <View style={[styles.metricDivider, { backgroundColor: colors.border }]} />

        {/* RSI */}
        <View style={styles.metricItem}>
          <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>RSI H4 · H1</Text>
          <Text style={[styles.metricValue, { color: colors.foreground }]}>
            {coin.rsiH4.toFixed(1)} · {coin.rsiH1.toFixed(1)}
          </Text>
        </View>

        <View style={[styles.metricDivider, { backgroundColor: colors.border }]} />

        {/* MACD H4 */}
        <View style={styles.metricItem}>
          <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>MACD H4</Text>
          <Text style={[styles.metricValue, { color: coin.macdValidH4 ? colors.bullish : colors.bearish }]}>
            {coin.macdValidH4 ? '✓' : '✗'}
          </Text>
        </View>

        <View style={[styles.metricDivider, { backgroundColor: colors.border }]} />

        {/* ADX */}
        <View style={styles.metricItem}>
          <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>ADX H4</Text>
          <Text style={[styles.metricValue, { color: coin.adxH4 > 30 ? colors.bullish : colors.foreground }]}>
            {coin.adxH4.toFixed(1)}
          </Text>
        </View>

        <View style={[styles.metricDivider, { backgroundColor: colors.border }]} />

        {/* ATR % */}
        <View style={styles.metricItem}>
          <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>ATR H4</Text>
          <Text style={[styles.metricValue, { color: colors.foreground }]}>
            {coin.atrH4Pct.toFixed(2)}%
          </Text>
        </View>

        <View style={[styles.metricDivider, { backgroundColor: colors.border }]} />

        {/* OI direction */}
        <View style={styles.metricItem}>
          <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>OI</Text>
          <Text style={[styles.metricValue, { color: oiColor }]}>{oiIcon}</Text>
        </View>
      </View>
    </Pressable>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ScreenerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isError, refetch } = useGetScreener({
    query: { staleTime: 0 },
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleCoinPress = useCallback((coin: ScreenerCoin) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: '/(tabs)/sniper', params: { symbol: coin.symbol } });
  }, []);

  const handleManualScan = useCallback(() => {
    if (!search.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const raw = search.trim().toUpperCase();
    const symbol = raw.endsWith('USDT') ? raw : `${raw}USDT`;
    setSearch('');
    router.push({ pathname: '/(tabs)/sniper', params: { symbol } });
  }, [search]);

  const filteredCoins = (data?.coins ?? []).filter((c) =>
    c.symbol.toLowerCase().includes(search.toLowerCase())
  );

  const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const bottomPadding = 60 + (Platform.OS === 'web' ? 34 : insets.bottom);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: topPadding + 12, backgroundColor: colors.background, borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.headerTop}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Screener</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              H4+H1 Multi-Filter
            </Text>
          </View>
          <View style={[styles.liveDot, { backgroundColor: `${colors.bullish}22` }]}>
            <View style={[styles.liveDotInner, { backgroundColor: colors.bullish }]} />
            <Text style={[styles.liveText, { color: colors.bullish }]}>LIVE</Text>
          </View>
        </View>

        {/* Search */}
        <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={15} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Cari atau scan manual (contoh: BTC)"
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="characters"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')}>
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>

      </View>

      {/* Tombol scan manual — muncul di atas list saat user ketik */}
      {search.trim().length >= 2 && (
        <Pressable
          onPress={handleManualScan}
          style={({ pressed }) => [
            styles.manualScanBtn,
            { backgroundColor: pressed ? `${colors.primary}dd` : colors.primary },
          ]}
        >
          <Feather name="crosshair" size={15} color={colors.primaryForeground} />
          <Text style={[styles.manualScanText, { color: colors.primaryForeground }]}>
            Scan{' '}
            <Text style={{ fontFamily: 'Inter_700Bold' }}>
              {search.trim().toUpperCase().endsWith('USDT')
                ? search.trim().toUpperCase()
                : `${search.trim().toUpperCase()}USDT`}
            </Text>
          </Text>
          <Feather name="arrow-right" size={15} color={colors.primaryForeground} />
        </Pressable>
      )}

      {/* Content */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Menerapkan filter H4+H1...
          </Text>
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={36} color={colors.mutedForeground} />
          <Text style={[styles.errorTitle, { color: colors.foreground }]}>Gagal memuat data</Text>
          <Text style={[styles.errorSub, { color: colors.mutedForeground }]}>
            Periksa koneksi internet Anda
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={filteredCoins}
          keyExtractor={(item) => item.symbol}
          renderItem={({ item }) => <CoinCard coin={item} onPress={handleCoinPress} />}
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingTop: 10,
            paddingBottom: bottomPadding,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.center}>
              <Feather name="filter" size={32} color={colors.mutedForeground} />
              <Text style={[styles.errorTitle, { color: colors.foreground }]}>
                {search ? 'Tidak ditemukan' : 'Tidak ada setup valid'}
              </Text>
              <Text style={[styles.errorSub, { color: colors.mutedForeground }]}>
                {search
                  ? 'Coba kata kunci lain'
                  : 'Semua pair tidak lolos filter H4+H1 saat ini'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  liveDot: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 5,
  },
  liveDotInner: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 1 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
  manualScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  manualScanText: { fontSize: 14, fontFamily: 'Inter_500Medium', flex: 1 },

  // Card
  card: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    overflow: 'hidden',
  },
  row1: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 8,
  },
  symbolCol: { flex: 1 },
  symbolRow: { flexDirection: 'row', alignItems: 'baseline' },
  symbolBase: { fontSize: 16, fontFamily: 'Inter_600SemiBold', letterSpacing: -0.3 },
  symbolQuote: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  volumeText: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  badgeCol: { alignItems: 'flex-start' },
  badge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  priceCol: { alignItems: 'flex-end' },
  price: { fontSize: 13, fontFamily: 'Inter_600SemiBold', letterSpacing: -0.3 },
  changePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
    marginTop: 3,
  },
  changeText: { fontSize: 10, fontFamily: 'Inter_500Medium' },

  // Row 2 metrics
  row2: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  metricItem: { flex: 1, alignItems: 'center', gap: 2 },
  metricLabel: { fontSize: 8, fontFamily: 'Inter_500Medium', letterSpacing: 0.4 },
  metricValue: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  metricDivider: { width: StyleSheet.hairlineWidth, marginVertical: 4 },

  // States
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  loadingText: { fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 8 },
  errorTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', textAlign: 'center', marginTop: 8 },
  errorSub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, marginTop: 8 },
  retryText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
