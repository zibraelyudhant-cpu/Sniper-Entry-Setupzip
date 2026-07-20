import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useGetScalping, useGetScalpingScan } from '@workspace/api-client-react';
import type { ScalpingResult } from '@workspace/api-client-react';

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(6);
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, colors }: { status: string; colors: ReturnType<typeof useColors> }) {
  const map: Record<string, { label: string; color: string }> = {
    in_zone:  { label: '🎯 IN ZONE', color: colors.bullish },
    waiting:  { label: '⏳ WAITING', color: colors.gold },
    expired:  { label: '💨 EXPIRED', color: colors.mutedForeground },
    no_setup: { label: '🚫 NO SETUP', color: colors.bearish },
    skip:     { label: '⏭ SKIP', color: colors.mutedForeground },
  };
  const item = map[status] ?? { label: status.toUpperCase(), color: colors.mutedForeground };
  return (
    <View style={[styles.statusBadge, { borderColor: item.color, backgroundColor: `${item.color}18` }]}>
      <Text style={[styles.statusBadgeText, { color: item.color }]}>{item.label}</Text>
    </View>
  );
}

// ─── Score Badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ score, max, colors }: { score: number; max: number; colors: ReturnType<typeof useColors> }) {
  const pct = score / max;
  const color = pct >= 0.85 ? colors.bullish : pct >= 0.6 ? colors.gold : colors.bearish;
  return (
    <View style={[styles.scoreBadge, { borderColor: color, backgroundColor: `${color}18` }]}>
      <Text style={[styles.scoreBadgeText, { color }]}>{score}/{max}</Text>
    </View>
  );
}

// ─── Scan Coin Card ───────────────────────────────────────────────────────────

function ScanCoinCard({ coin, onPress, colors }: { coin: ScalpingResult; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  const base = coin.symbol.replace('USDT', '');
  const isBuy = coin.bias === 'bullish';
  const biasColor = isBuy ? colors.bullish : colors.bearish;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [scanStyles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
    >
      <View style={scanStyles.cardRow1}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
            <Text style={[scanStyles.cardBase, { color: colors.foreground }]}>{base}</Text>
            <Text style={[scanStyles.cardQuote, { color: colors.mutedForeground }]}>/USDT</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <View style={[scanStyles.biasBadge, { backgroundColor: `${biasColor}18`, borderColor: biasColor }]}>
              <Text style={[scanStyles.biasBadgeText, { color: biasColor }]}>{isBuy ? '▲ LONG' : '▼ SHORT'}</Text>
            </View>
            {coin.structure15M && (
              <View style={[scanStyles.zoneBadge, { borderColor: colors.border }]}>
                <Text style={[scanStyles.zoneBadgeText, { color: colors.mutedForeground }]}>{coin.structure15M}</Text>
              </View>
            )}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <StatusBadge status={coin.status} colors={colors} />
          {coin.score !== undefined && <ScoreBadge score={coin.score} max={coin.maxScore} colors={colors} />}
        </View>
        <Feather name="chevron-right" size={14} color={colors.mutedForeground} style={{ marginLeft: 4 }} />
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
          <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>TP2</Text>
          <Text style={[scanStyles.condValue, { color: colors.gold }]}>{coin.takeProfit2 ? formatPrice(coin.takeProfit2) : '—'}</Text>
        </View>
        <View style={[scanStyles.condDivider, { backgroundColor: colors.border }]} />
        <View style={scanStyles.condItem}>
          <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>RR</Text>
          <Text style={[scanStyles.condValue, { color: colors.foreground }]}>{coin.rr1 ? `1:${coin.rr1.toFixed(1)}` : '—'}</Text>
        </View>
        <View style={[scanStyles.condDivider, { backgroundColor: colors.border }]} />
        <View style={scanStyles.condItem}>
          <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>ATR</Text>
          <Text style={[scanStyles.condValue, { color: colors.foreground }]}>{coin.atr15MPct ? `${coin.atr15MPct.toFixed(2)}%` : '—'}</Text>
        </View>
      </View>
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
  const { data, isLoading, isError, refetch } = useGetScalpingScan({
    query: { staleTime: 3 * 60 * 1000 },
  });

  if (isLoading) {
    return (
      <View style={scanStyles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[scanStyles.loadingText, { color: colors.mutedForeground }]}>Scanning scalping setup...</Text>
        <Text style={[scanStyles.loadingSub, { color: colors.mutedForeground }]}>Analisa OB 5M dalam struktur 15M</Text>
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
  const fetchedAt = data ? new Date((data as any).fetchedAt ?? Date.now()).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : null;
  const inZone = coins.filter(c => c.status === 'in_zone');
  const waiting = coins.filter(c => c.status === 'waiting');

  if (coins.length === 0) {
    return (
      <View style={scanStyles.center}>
        <Feather name="crosshair" size={36} color={colors.mutedForeground} />
        <Text style={[scanStyles.emptyTitle, { color: colors.foreground }]}>Tidak ada setup scalping</Text>
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
          <Text style={[scanStyles.groupHeader, { color: colors.bullish }]}>🎯 IN ZONE — Pasang limit sekarang</Text>
          {inZone.map(c => <ScanCoinCard key={c.symbol} coin={c} colors={colors} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectCoin(c.symbol); }} />)}
        </>
      )}
      {waiting.length > 0 && (
        <>
          <Text style={[scanStyles.groupHeader, { color: colors.gold }]}>⏳ WAITING — Harga belum di zona</Text>
          {waiting.map(c => <ScanCoinCard key={c.symbol} coin={c} colors={colors} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectCoin(c.symbol); }} />)}
        </>
      )}
    </ScrollView>
  );
}

const scanStyles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  loadingText: { fontSize: 14, fontFamily: 'Inter_500Medium', marginTop: 8 },
  loadingSub: { fontSize: 12, fontFamily: 'Inter_400Regular' },
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
  zoneBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  zoneBadgeText: { fontSize: 8, fontFamily: 'Inter_500Medium' },
  condRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8, paddingHorizontal: 4 },
  condItem: { flex: 1, alignItems: 'center', gap: 3 },
  condLabel: { fontSize: 7, fontFamily: 'Inter_500Medium', letterSpacing: 0.3 },
  condValue: { fontSize: 9, fontFamily: 'Inter_600SemiBold' },
  condDivider: { width: StyleSheet.hairlineWidth, marginVertical: 4 },
});

// ─── Analisa Tab ──────────────────────────────────────────────────────────────

function AnalisaTab({ colors, initialSymbol }: { colors: ReturnType<typeof useColors>; initialSymbol?: string }) {
  const insets = useSafeAreaInsets();
  const [inputSymbol, setInputSymbol] = useState(initialSymbol ?? '');
  const [querySymbol, setQuerySymbol] = useState(initialSymbol ?? '');

  const { data, isLoading, isError, refetch } = useGetScalping(querySymbol, {
    query: { enabled: !!querySymbol, staleTime: 60_000 },
  });

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
          <Feather name="crosshair" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Scalping Scanner</Text>
          <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>Masukkan pair untuk analisa OB 5M dalam struktur 15M</Text>
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
            {data.message && (
              <View style={[styles.messageBox, { backgroundColor: `${colors.primary}10`, borderLeftColor: colors.primary }]}>
                <Text style={[styles.messageText, { color: colors.mutedForeground }]}>{data.message}</Text>
              </View>
            )}
          </View>

          {/* Struktur 15M */}
          {data.structure15M && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>STRUKTUR 15M</Text>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Bias</Text>
                <Text style={[styles.infoValue, { color: data.bias === 'bullish' ? colors.bullish : colors.bearish }]}>
                  {data.bias === 'bullish' ? '▲ LONG' : '▼ SHORT'}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Struktur</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>{data.structure15M}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>CHoCH 15M</Text>
                <Text style={[styles.infoValue, { color: data.choch15M ? colors.bullish : colors.bearish }]}>
                  {data.choch15M ? '✅ Terkonfirmasi' : '❌ Belum terbentuk'}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>ATR 15M</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>
                  {data.atr15MPct ? `${data.atr15MPct.toFixed(2)}%` : '—'}
                </Text>
              </View>
            </View>
          )}

          {/* OB 5M */}
          {data.ob5M && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ORDER BLOCK 5M</Text>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Range OB</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>
                  {formatPrice(data.ob5M.low)} – {formatPrice(data.ob5M.high)}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Mid OB</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>{formatPrice(data.ob5M.mid)}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Status</Text>
                <Text style={[styles.infoValue, { color: data.ob5M.fresh ? colors.bullish : colors.bearish }]}>
                  {data.ob5M.fresh ? '✅ Fresh' : '⚠️ Sudah disentuh'}
                </Text>
              </View>
            </View>
          )}

          {/* Limit Order */}
          {data.entryPrice && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>LIMIT ORDER</Text>
              <View style={[styles.levelCard, {
                backgroundColor: `${data.bias === 'bullish' ? colors.bullish : colors.bearish}10`,
                borderColor: data.bias === 'bullish' ? colors.bullish : colors.bearish
              }]}>
                <Text style={[styles.levelCardLabel, { color: colors.mutedForeground }]}>ENTRY</Text>
                <Text style={[styles.levelCardPrice, { color: data.bias === 'bullish' ? colors.bullish : colors.bearish }]}>
                  {formatPrice(data.entryPrice)}
                </Text>
                <Text style={[styles.levelCardSub, { color: colors.mutedForeground }]}>
                  {data.bias === 'bullish' ? 'BUY LIMIT' : 'SELL LIMIT'} — tengah OB 5M
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.bearish }]}>Stop Loss</Text>
                <Text style={[styles.infoValue, { color: colors.bearish }]}>{data.stopLoss ? formatPrice(data.stopLoss) : '—'}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.bullish }]}>TP1 (RR 1:{data.rr1?.toFixed(1)})</Text>
                <Text style={[styles.infoValue, { color: colors.bullish }]}>{data.takeProfit1 ? formatPrice(data.takeProfit1) : '—'}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.gold }]}>TP2 (RR 1:{data.rr2?.toFixed(1)})</Text>
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
        </ScrollView>
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ScalpingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const [activeTab, setActiveTab] = useState<'scan' | 'analisa'>('scan');
  const [selectedSymbol, setSelectedSymbol] = useState<string | undefined>();

  const handleSelectCoin = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
    setActiveTab('analisa');
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={styles.headerTop}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Scalping</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>SMC Micro — OB 5M dalam struktur 15M</Text>
          </View>
          {activeTab === 'scan' && (
            <View style={[styles.liveDot, { backgroundColor: `${colors.bullish}20` }]}>
              <View style={[styles.liveDotInner, { backgroundColor: colors.bullish }]} />
              <Text style={[styles.liveText, { color: colors.bullish }]}>LIVE</Text>
            </View>
          )}
        </View>
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
        ? <ScanTab colors={colors} onSelectCoin={handleSelectCoin} />
        : <AnalisaTab colors={colors} initialSymbol={selectedSymbol} />
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
  statusBadge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  scoreBadge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  scoreBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
});
