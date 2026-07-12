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
  const base = symbol.replace('USDT', '');
  return { base, quote: 'USDT' };
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

  const biasColor =
    coin.bias === 'bullish'
      ? colors.bullish
      : coin.bias === 'bearish'
      ? colors.bearish
      : colors.mutedForeground;

  const biasLabel =
    coin.bias === 'bullish' ? 'BULLISH' : coin.bias === 'bearish' ? 'BEARISH' : 'RANGING';

  const strengthColor =
    coin.strength === 'strong' ? colors.gold : colors.mutedForeground;

  return (
    <Pressable
      onPress={() => onPress(coin)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {/* Left: Symbol + Volume */}
      <View style={styles.cardLeft}>
        <View style={styles.symbolRow}>
          <Text style={[styles.symbolBase, { color: colors.foreground }]}>{base}</Text>
          <Text style={[styles.symbolQuote, { color: colors.mutedForeground }]}>/{quote}</Text>
        </View>
        <Text style={[styles.volume, { color: colors.mutedForeground }]}>
          Vol {formatVolume(coin.volume24h)}
        </Text>
      </View>

      {/* Center: Bias badge */}
      <View style={styles.cardCenter}>
        <View style={[styles.biasBadge, { borderColor: biasColor }]}>
          <Text style={[styles.biasText, { color: biasColor }]}>{biasLabel}</Text>
        </View>
        {coin.strength !== 'neutral' && (
          <Text style={[styles.strengthText, { color: strengthColor }]}>
            {coin.strength.toUpperCase()}
          </Text>
        )}
      </View>

      {/* Right: Price + Change */}
      <View style={styles.cardRight}>
        <Text style={[styles.price, { color: colors.foreground }]}>
          ${formatPrice(coin.price)}
        </Text>
        <View
          style={[
            styles.changePill,
            { backgroundColor: isPositive ? `${colors.bullish}22` : `${colors.bearish}22` },
          ]}
        >
          <Feather
            name={isPositive ? 'trending-up' : 'trending-down'}
            size={11}
            color={isPositive ? colors.bullish : colors.bearish}
            style={{ marginRight: 3 }}
          />
          <Text
            style={[
              styles.changeText,
              { color: isPositive ? colors.bullish : colors.bearish },
            ]}
          >
            {isPositive ? '+' : ''}
            {coin.change24h.toFixed(2)}%
          </Text>
        </View>
      </View>

      {/* Arrow */}
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} style={{ marginLeft: 4 }} />
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
    query: { staleTime: 60_000 },
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
              Top Futures Pairs
            </Text>
          </View>
          <View style={[styles.liveDot, { backgroundColor: `${colors.bullish}33` }]}>
            <View style={[styles.liveDotInner, { backgroundColor: colors.bullish }]} />
            <Text style={[styles.liveText, { color: colors.bullish }]}>LIVE</Text>
          </View>
        </View>

        {/* Search */}
        <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={15} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Cari pair..."
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

        {/* Column labels */}
        <View style={styles.colLabels}>
          <Text style={[styles.colLabel, { color: colors.mutedForeground, flex: 1 }]}>PAIR</Text>
          <Text style={[styles.colLabel, { color: colors.mutedForeground, flex: 1, textAlign: 'center' }]}>BIAS</Text>
          <Text style={[styles.colLabel, { color: colors.mutedForeground, width: 90, textAlign: 'right' }]}>
            PRICE / CHG
          </Text>
          <View style={{ width: 20 }} />
        </View>
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Memuat data pasar...
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
          renderItem={({ item }) => (
            <CoinCard coin={item} onPress={handleCoinPress} />
          )}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 8,
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
              <Feather name="search" size={32} color={colors.mutedForeground} />
              <Text style={[styles.errorTitle, { color: colors.foreground }]}>
                Tidak ditemukan
              </Text>
              <Text style={[styles.errorSub, { color: colors.mutedForeground }]}>
                Coba kata kunci lain
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

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
    fontSize: 13,
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
  liveDotInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  colLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 4,
  },
  colLabel: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 0.8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 8,
  },
  cardLeft: { flex: 1 },
  symbolRow: { flexDirection: 'row', alignItems: 'baseline' },
  symbolBase: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: -0.3,
  },
  symbolQuote: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  volume: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 3,
  },
  cardCenter: { flex: 1, alignItems: 'center' },
  biasBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  biasText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.5,
  },
  strengthText: {
    fontSize: 9,
    fontFamily: 'Inter_500Medium',
    marginTop: 3,
    letterSpacing: 0.5,
  },
  cardRight: { width: 90, alignItems: 'flex-end' },
  price: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: -0.3,
  },
  changePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginTop: 3,
  },
  changeText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginTop: 8,
  },
  errorTitle: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
    marginTop: 8,
  },
  errorSub: {
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
});
