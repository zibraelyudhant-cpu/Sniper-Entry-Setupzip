import React, { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useGetExtremeScalping, useGetExtremeScalpingScan, getGetExtremeScalpingQueryKey, getGetExtremeScalpingScanQueryKey, type ExtremeScalpingResult } from '@workspace/api-client-react';
import { AnimatedCard } from '@/components/animated/AnimatedCard';
import { DirectionalCard } from '@/components/animated/DirectionalCard';
import { StatusBadge } from '@/components/animated/StatusBadge';
import { ScoreBadge } from '@/components/animated/ScoreBadge';
import { AnimatedTabSwitcher } from '@/components/animated/AnimatedTabSwitcher';
import { ScanLoading } from '@/components/animated/ScanLoading';
import { LogResultBadge } from '@/components/animated/LogResultBadge';
import { FuturisticBackground } from '@/components/animated/FuturisticBackground';
import { MENU_COLORS } from '@/constants/theme';

const ACCENT = MENU_COLORS.extremeScalping;

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(6);
}

// ─── Scan Coin Card ───────────────────────────────────────────────────────────

function ScanCoinCard({ coin, onPress, colors, index = 0 }: { coin: ExtremeScalpingResult; onPress: () => void; colors: ReturnType<typeof useColors>; index?: number }) {
  const base = coin.symbol.replace('USDT', '');
  const isBuy = coin.bias === 'bullish';
  const biasColor = isBuy ? colors.bullish : colors.bearish;

  return (
    <AnimatedCard index={index} onPress={onPress}>
    <DirectionalCard bias={coin.bias} style={scanStyles.card}>
      <View style={scanStyles.cardRow1}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
            <Text style={[scanStyles.cardBase, { color: colors.foreground }]}>{base}</Text>
            <Text style={[scanStyles.cardQuote, { color: colors.mutedForeground }]}>/USDT</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 4, marginTop: 3 }}>
            <View style={[scanStyles.biasBadge, { backgroundColor: `${biasColor}18`, borderColor: biasColor }]}>
              <Text style={[scanStyles.biasBadgeText, { color: biasColor }]}>{isBuy ? '▲ LONG' : '▼ SHORT'}</Text>
            </View>
            {coin.isReversalSetup && (
              <View style={[scanStyles.biasBadge, { backgroundColor: `${ACCENT}18`, borderColor: ACCENT }]}>
                <Text style={[scanStyles.biasBadgeText, { color: ACCENT }]}>🔄 REVERSAL</Text>
              </View>
            )}
          </View>
          {coin.structureH1 && (
            <Text style={{ fontSize: 9, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 2 }} numberOfLines={1}>
              {coin.structureH1}
            </Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <StatusBadge status={coin.status} />
          {coin.score !== undefined && <ScoreBadge score={coin.score} max={coin.maxScore} />}
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
          <Text style={[scanStyles.condValue, { color: colors.foreground }]}>{coin.atr5MPct ? `${coin.atr5MPct.toFixed(2)}%` : '—'}</Text>
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

function ScanTab({ colors, onSelectCoin }: { colors: ReturnType<typeof useColors>; onSelectCoin: (symbol: string) => void }) {
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError, refetch } = useGetExtremeScalpingScan({
    query: { queryKey: getGetExtremeScalpingScanQueryKey(), staleTime: 3 * 60 * 1000 },
  });

  if (isLoading) {
    return (
      <View style={scanStyles.center}>
        <ScanLoading label="SCANNING EXTREME" accentColor={ACCENT} />
        <Text style={[scanStyles.loadingSub, { color: colors.mutedForeground }]}>Analisa zona retest M15 → trigger M5</Text>
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
  const fetchedAt = data ? new Date((data as any).fetchedAt ?? Date.now()).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : null;
  const inZone     = coins.filter(c => c.status === 'in_zone');
  const approaching = coins.filter(c => c.status === 'approaching');
  const waiting    = coins.filter(c => c.status === 'waiting');

  if (coins.length === 0) {
    return (
      <View style={scanStyles.center}>
        <Feather name="crosshair" size={36} color={colors.mutedForeground} />
        <Text style={[scanStyles.emptyTitle, { color: colors.foreground }]}>Tidak ada setup scalping</Text>
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
          <Text style={[scanStyles.groupHeader, { color: colors.bullish }]}>🎯 BAGUS — Siap Entry Sekarang</Text>
          {inZone.map((c, i) => <ScanCoinCard key={c.symbol} coin={c} colors={colors} index={i} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectCoin(c.symbol); }} />)}
        </>
      )}
      {approaching.length > 0 && (
        <>
          <Text style={[scanStyles.groupHeader, { color: ACCENT }]}>⚡ MENDEKATI — Siap Pasang Limit</Text>
          {approaching.map((c, i) => <ScanCoinCard key={c.symbol} coin={c} colors={colors} index={i} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectCoin(c.symbol); }} />)}
        </>
      )}
      {waiting.length > 0 && (
        <>
          <Text style={[scanStyles.groupHeader, { color: colors.gold }]}>⏳ WAITING — Harga belum mendekati zona</Text>
          {waiting.map((c, i) => <ScanCoinCard key={c.symbol} coin={c} colors={colors} index={i} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectCoin(c.symbol); }} />)}
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
  condValue: { fontSize: 8, fontFamily: 'Inter_600SemiBold' },
  condDivider: { width: StyleSheet.hairlineWidth, marginVertical: 4 },
});

// ─── Analisa Tab ──────────────────────────────────────────────────────────────

function AnalisaTab({ colors, initialSymbol, onSignalReady, onSave }: { colors: ReturnType<typeof useColors>; initialSymbol?: string; onSignalReady?: (d: any) => void; onSave?: () => void }) {
  const insets = useSafeAreaInsets();
  const [inputSymbol, setInputSymbol] = useState(initialSymbol ?? '');
  const [querySymbol, setQuerySymbol] = useState(initialSymbol ?? '');

  const { data, isLoading, isError, refetch } = useGetExtremeScalping(
    { symbol: querySymbol },
    { query: { queryKey: getGetExtremeScalpingQueryKey({ symbol: querySymbol }), enabled: !!querySymbol, staleTime: 60_000 } }
  );

  useEffect(() => {
    if (onSignalReady) onSignalReady(data?.status === 'waiting' || data?.status === 'approaching' || data?.status === 'in_zone' ? data : null);
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
          <Feather name="crosshair" size={15} color={ACCENT} />
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
          <Feather name="crosshair" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Extreme Scalping Scanner</Text>
          <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>Masukkan pair untuk analisa zona retest M15 → trigger M5</Text>
        </View>
      ) : isLoading ? (
        <View style={styles.emptyState}>
          <ScanLoading label="MENGANALISA" accentColor={ACCENT} coins={[querySymbol || 'BTCUSDT']} />
        </View>
      ) : isError || !data ? (
        <View style={styles.emptyState}>
          <Feather name="alert-circle" size={36} color={colors.bearish} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Gagal menganalisa</Text>
          <Pressable onPress={() => refetch()} style={[styles.retryBtn, { backgroundColor: ACCENT }]}>
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: bottomPadding }} showsVerticalScrollIndicator={false}>
          {/* Header result */}
          <AnimatedCard index={0}>
          <View style={[styles.section, { backgroundColor: 'rgba(251,146,60,0.06)', borderColor: 'rgba(251,146,60,0.25)' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View>
                <Text style={[styles.pairTitle, { color: colors.foreground }]}>
                  {data.symbol.replace('USDT', '')}/USDT
                </Text>
                <Text style={[styles.timestamp, { color: colors.mutedForeground }]}>{data.timestamp}</Text>
              </View>
              <View style={{ gap: 6, alignItems: 'flex-end' }}>
                <StatusBadge status={data.status} />
                {data.score !== undefined && <ScoreBadge score={data.score} max={data.maxScore} />}
              </View>
            </View>
            {data.message && (
              <View style={[styles.messageBox, { backgroundColor: `${ACCENT}10`, borderLeftColor: ACCENT }]}>
                <Text style={[styles.messageText, { color: colors.mutedForeground }]}>{data.message}</Text>
              </View>
            )}
          </View>
          </AnimatedCard>

          {/* Struktur 15M */}
          {data.structureH1 && (
            <AnimatedCard index={1}>
            <View style={[styles.section, { backgroundColor: 'rgba(167,139,250,0.06)', borderColor: 'rgba(167,139,250,0.22)' }]}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>STRUKTUR H1</Text>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Bias</Text>
                <Text style={[styles.infoValue, { color: data.bias === 'bullish' ? colors.bullish : colors.bearish }]}>
                  {data.bias === 'bullish' ? '▲ LONG' : '▼ SHORT'}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Struktur</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>{data.structureH1}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Trigger M5</Text>
                <Text style={[styles.infoValue, { color: data.chochH1 ? colors.bullish : colors.bearish }]}>
                  {data.chochH1 ? '✅ Terkonfirmasi' : '❌ Belum terbentuk'}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>ATR M5</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>
                  {data.atr5MPct ? `${data.atr5MPct.toFixed(2)}%` : '—'}
                </Text>
              </View>
              {data.isReversalSetup && (
                <>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <View style={[styles.infoRow, {
                    backgroundColor: `${ACCENT}18`,
                    marginHorizontal: -12,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 8,
                  }]}>
                    <Text style={[styles.infoLabel, { color: ACCENT, fontFamily: 'Inter_700Bold' }]}>🔄 REVERSAL SETUP</Text>
                    <Text style={[styles.infoValue, { color: ACCENT, fontFamily: 'Inter_700Bold' }]}>
                      Via CHoCH H1
                    </Text>
                  </View>
                </>
              )}
            </View>
            </AnimatedCard>
          )}

          {/* OB 5M */}
          {data.ob5M && (
            <AnimatedCard index={2}>
            <View style={[styles.section, { backgroundColor: 'rgba(74,222,128,0.06)', borderColor: 'rgba(74,222,128,0.22)' }]}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ZONA ENTRY (M15 → M5)</Text>
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
            </AnimatedCard>
          )}

          {/* Simpan Sinyal */}
          {(data.status === 'waiting' || data.status === 'approaching' || data.status === 'in_zone') && onSave && (
            <Pressable onPress={onSave}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, margin: 12, marginTop: 4, paddingVertical: 14, borderRadius: 12, backgroundColor: ACCENT, opacity: pressed ? 0.8 : 1 }]}>
              <Feather name="bookmark" size={15} color={colors.primaryForeground} />
              <Text style={{ fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.primaryForeground }}>Simpan Sinyal ke Log</Text>
            </Pressable>
          )}

          {/* Limit Order */}
          {data.entryPrice && (
            <AnimatedCard index={3}>
            <View style={[styles.section, { backgroundColor: 'rgba(251,191,36,0.06)', borderColor: 'rgba(251,191,36,0.22)' }]}>
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
                  {data.bias === 'bullish' ? 'BUY LIMIT' : 'SELL LIMIT'} — tengah zona M15/M5
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
            </AnimatedCard>
          )}

          {/* Filter Results */}
          {data.filterResults && data.filterResults.length > 0 && (
            <AnimatedCard index={4}>
            <View style={[styles.section, { backgroundColor: 'rgba(34,211,238,0.05)', borderColor: 'rgba(34,211,238,0.2)' }]}>
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
            </AnimatedCard>
          )}

          {/* Kalkulator PnL button */}
          {data.entryPrice && (
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
                    takeProfit2: String(data.takeProfit2 ?? 0),
                    symbol: data.symbol,
                    direction: data.bias ?? 'bullish',
                    source: 'extreme_scalping',
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

// ─── Main Screen ──────────────────────────────────────────────────────────────


// ─── Signal Log ───────────────────────────────────────────────────────────────

type ExtremeScalpingLogStatus = 'pending' | 'win_tp1' | 'win_tp2' | 'lose' | 'expired';

interface ExtremeScalpingLog {
  id: string;
  symbol: string;
  bias: 'bullish' | 'bearish';
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
  currentPriceAtSignal: number;
  timestamp: string;
  savedAt: number;
  score?: number;
  status: ExtremeScalpingLogStatus;
  evaluatedAt?: string;
  exitPrice?: number;
  rr?: number;
}

const SCALPING_LOG_KEY = 'signal_logs_extreme_scalping';

async function scalpLoadLogs(): Promise<ExtremeScalpingLog[]> {
  try { const r = await AsyncStorage.getItem(SCALPING_LOG_KEY); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
async function scalpSaveLog(log: ExtremeScalpingLog): Promise<ExtremeScalpingLog[]> {
  const all = await scalpLoadLogs();
  const updated = [log, ...all].slice(0, 100);
  try { await AsyncStorage.setItem(SCALPING_LOG_KEY, JSON.stringify(updated)); } catch {}
  return updated;
}
async function scalpUpdateLog(id: string, patch: Partial<ExtremeScalpingLog>): Promise<ExtremeScalpingLog[]> {
  const all = await scalpLoadLogs();
  const updated = all.map(l => l.id === id ? { ...l, ...patch } : l);
  try { await AsyncStorage.setItem(SCALPING_LOG_KEY, JSON.stringify(updated)); } catch {}
  return updated;
}
async function scalpDeleteLog(id: string): Promise<ExtremeScalpingLog[]> {
  const all = await scalpLoadLogs();
  const updated = all.filter(l => l.id !== id);
  try { await AsyncStorage.setItem(SCALPING_LOG_KEY, JSON.stringify(updated)); } catch {}
  return updated;
}
async function scalpEvalLog(log: ExtremeScalpingLog): Promise<Partial<ExtremeScalpingLog>> {
  try {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${log.symbol}&interval=15m&startTime=${log.savedAt}&endTime=${Date.now()}&limit=200`;
    const res = await fetch(url);
    if (!res.ok) return { status: 'pending' };
    const klines: number[][] = await res.json();
    const risk = Math.abs(log.entryPrice - log.stopLoss);
    const evalAt = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
    for (const k of klines) {
      const high = k[2] as number, low = k[3] as number;
      if (log.bias === 'bullish') {
        if (low <= log.stopLoss) return { status: 'lose', exitPrice: log.stopLoss, rr: -1, evaluatedAt: evalAt };
        if (log.takeProfit2 && high >= log.takeProfit2) return { status: 'win_tp2', exitPrice: log.takeProfit2, rr: +((log.takeProfit2-log.entryPrice)/risk).toFixed(1), evaluatedAt: evalAt };
        if (high >= log.takeProfit1) return { status: 'win_tp1', exitPrice: log.takeProfit1, rr: +((log.takeProfit1-log.entryPrice)/risk).toFixed(1), evaluatedAt: evalAt };
      } else {
        if (high >= log.stopLoss) return { status: 'lose', exitPrice: log.stopLoss, rr: -1, evaluatedAt: evalAt };
        if (log.takeProfit2 && low <= log.takeProfit2) return { status: 'win_tp2', exitPrice: log.takeProfit2, rr: +((log.entryPrice-log.takeProfit2)/risk).toFixed(1), evaluatedAt: evalAt };
        if (low <= log.takeProfit1) return { status: 'win_tp1', exitPrice: log.takeProfit1, rr: +((log.entryPrice-log.takeProfit1)/risk).toFixed(1), evaluatedAt: evalAt };
      }
    }
    return { status: 'pending' };
  } catch { return { status: 'pending' }; }
}

function ExtremeScalpingLogTab({ colors }: { colors: ReturnType<typeof useColors> }) {
  const insets = useSafeAreaInsets();
  const [logs, setLogs] = useState<ExtremeScalpingLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState<string | null>(null);

  useEffect(() => { scalpLoadLogs().then(l => { setLogs(l); setLoading(false); }); }, []);
  const doEval = async (log: ExtremeScalpingLog) => { setEvaluating(log.id); const p = await scalpEvalLog(log); setLogs(await scalpUpdateLog(log.id, p)); setEvaluating(null); };
  const doDelete = async (id: string) => setLogs(await scalpDeleteLog(id));

  const fp = (v: number) => v >= 1000 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v.toFixed(6);

  const wins = logs.filter(l => l.status==='win_tp1'||l.status==='win_tp2').length;
  const loses = logs.filter(l => l.status==='lose').length;
  const wr = wins+loses>0 ? Math.round(wins/(wins+loses)*100) : 0;
  const rrs = logs.filter(l => (l.rr??0)>0);
  const avgRR = rrs.length ? (rrs.reduce((a,b)=>a+(b.rr??0),0)/rrs.length).toFixed(2) : '—';

  if (loading) return <View style={{flex:1,alignItems:'center',justifyContent:'center'}}><ActivityIndicator color={ACCENT}/></View>;

  return (
    <ScrollView contentContainerStyle={{paddingBottom:insets.bottom+80}} showsVerticalScrollIndicator={false}>
      {logs.length>0&&<View style={{flexDirection:'row',margin:12,borderRadius:12,borderWidth:1,borderColor:colors.border,backgroundColor:colors.card,padding:14,justifyContent:'space-around'}}>
        {[
          {v:`${wins}`,c:'#4ADE80',bg:'rgba(74,222,128,0.12)',l:'WIN'},
          {v:`${loses}`,c:'#F87171',bg:'rgba(248,113,113,0.1)',l:'LOSE'},
          {v:`${logs.filter(x=>x.status==='pending').length}`,c:'#94A3B8',bg:'rgba(148,163,184,0.08)',l:'PENDING'},
          {v:`${wr}%`,c:'#FBBF24',bg:'rgba(251,191,36,0.12)',l:'WIN RATE'},
          {v:avgRR,c:ACCENT,bg:`${ACCENT}18`,l:'AVG R:R'},
        ].map(item=>(
          <View key={item.l} style={{alignItems:'center',gap:4,backgroundColor:item.bg,borderRadius:9,paddingVertical:8,paddingHorizontal:6,minWidth:52}}>
            <Text style={{fontSize:16,fontFamily:'Inter_700Bold',color:item.c}}>{item.v}</Text>
            <Text style={{fontSize:8,fontFamily:'Inter_500Medium',color:colors.mutedForeground,letterSpacing:0.3}}>{item.l}</Text>
          </View>
        ))}
      </View>}
      {logs.length===0 ? (
        <View style={{flex:1,alignItems:'center',justifyContent:'center',padding:32,gap:10,minHeight:300}}>
          <Feather name="bookmark" size={36} color={colors.mutedForeground}/>
          <Text style={{fontSize:16,fontFamily:'Inter_600SemiBold',color:colors.foreground,textAlign:'center'}}>Belum ada sinyal tersimpan</Text>
          <Text style={{fontSize:13,fontFamily:'Inter_400Regular',color:colors.mutedForeground,textAlign:'center',lineHeight:20}}>Simpan sinyal dari tab Analisa</Text>
        </View>
      ) : (
        <View style={{paddingHorizontal:12,paddingTop:10,gap:8}}>
          {logs.map((log,index)=>(
            <AnimatedCard key={log.id} index={index}>
            <View style={{borderRadius:12,borderWidth:1,borderColor:colors.border,backgroundColor:colors.card,overflow:'hidden',borderLeftWidth:3,borderLeftColor:log.status==='win_tp1'||log.status==='win_tp2'?'#4ADE80':log.status==='lose'?'#F87171':'#6B7280'}}>
              <View style={{flexDirection:'row',padding:12,alignItems:'flex-start'}}>
                <View style={{flex:1}}>
                  <Text style={{fontSize:16,fontFamily:'Inter_600SemiBold',color:colors.foreground}}>{log.symbol.replace('USDT','')}/USDT</Text>
                  <Text style={{fontSize:11,fontFamily:'Inter_400Regular',color:colors.mutedForeground,marginTop:2}}>{log.timestamp}</Text>
                </View>
                <View style={{alignItems:'flex-end',gap:4}}>
                  <LogResultBadge status={log.status} />
                  <Text style={{fontSize:11,fontFamily:'Inter_600SemiBold',color:log.bias==='bullish'?'#22c55e':'#ef4444'}}>{log.bias==='bullish'?'▲ LONG':'▼ SHORT'}</Text>
                </View>
              </View>
              <View style={{flexDirection:'row',borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.border,paddingVertical:8,paddingHorizontal:12}}>
                {([['Entry',log.entryPrice,colors.foreground],['SL',log.stopLoss,'#ef4444'],['TP1',log.takeProfit1,'#22c55e'],['TP2',log.takeProfit2,'#3b82f6']] as [string,number|undefined,string][]).map(([lbl,val,col])=>val?(
                  <View key={lbl} style={{flex:1,alignItems:'center'}}>
                    <Text style={{fontSize:9,fontFamily:'Inter_500Medium',color:colors.mutedForeground}}>{lbl}</Text>
                    <Text style={{fontSize:10,fontFamily:'Inter_600SemiBold',color:col,marginTop:2}}>{fp(val)}</Text>
                  </View>
                ):null)}
                {log.rr!==undefined&&<View style={{flex:1,alignItems:'center'}}><Text style={{fontSize:9,fontFamily:'Inter_500Medium',color:colors.mutedForeground}}>R:R</Text><Text style={{fontSize:10,fontFamily:'Inter_600SemiBold',color:log.rr>0?'#22c55e':'#ef4444',marginTop:2}}>{log.rr>0?`1:${log.rr}`:'-1'}</Text></View>}
              </View>
              {log.score!==undefined&&<Text style={{fontSize:11,color:colors.mutedForeground,paddingHorizontal:12,paddingBottom:4,fontFamily:'Inter_400Regular'}}>Score: {log.score}/6</Text>}
              {log.evaluatedAt&&<Text style={{fontSize:10,color:colors.mutedForeground,paddingHorizontal:12,paddingBottom:6,fontFamily:'Inter_400Regular'}}>Dievaluasi: {log.evaluatedAt}</Text>}
              <View style={{flexDirection:'row',borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.border,padding:8,gap:8,alignItems:'center'}}>
                {log.status==='pending'&&(
                  <Pressable onPress={()=>doEval(log)} disabled={evaluating===log.id}
                    style={({pressed})=>[{flex:1,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5,paddingVertical:7,borderRadius:8,borderWidth:1,borderColor:ACCENT,backgroundColor:ACCENT+'15',opacity:pressed||evaluating===log.id?0.7:1}]}>
                    {evaluating===log.id?<ActivityIndicator size={12} color={ACCENT}/>:<Feather name="search" size={12} color={ACCENT}/>}
                    <Text style={{fontSize:12,fontFamily:'Inter_600SemiBold',color:ACCENT}}>{evaluating===log.id?'Evaluasi...':'Evaluasi'}</Text>
                  </Pressable>
                )}
                <Pressable onPress={()=>doDelete(log.id)} style={({pressed})=>[{padding:8,opacity:pressed?0.7:1}]}>
                  <Feather name="trash-2" size={12} color="#ef4444"/>
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

export default function ExtremeScalpingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const [activeTab, setActiveTab] = useState<'scan' | 'analisa' | 'log'>('scan');
  const [selectedSymbol, setSelectedSymbol] = useState<string | undefined>();
  const [currentSignal, setCurrentSignal] = useState<any>(null);

  const handleSaveSignal = useCallback(async () => {
    if (!currentSignal || !currentSignal.entryPrice) return;
    const log: ExtremeScalpingLog = {
      id: `${Date.now()}_${currentSignal.symbol}`,
      symbol: currentSignal.symbol,
      bias: currentSignal.bias ?? 'bullish',
      entryPrice: currentSignal.entryPrice,
      stopLoss: currentSignal.stopLoss ?? 0,
      takeProfit1: currentSignal.takeProfit1 ?? 0,
      takeProfit2: currentSignal.takeProfit2,
      currentPriceAtSignal: currentSignal.currentPrice,
      timestamp: currentSignal.timestamp,
      savedAt: Date.now(),
      score: currentSignal.score,
      status: 'pending',
    };
    await scalpSaveLog(log);
    setActiveTab('log');
  }, [currentSignal]);

  const handleSelectCoin = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
    setActiveTab('analisa');
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FuturisticBackground accentColor={ACCENT} secondaryColor="#FBBF24" />
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={styles.headerTop}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Extreme Scalping</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>H1 Trend → Reversal CHoCH → Zona M15 → Trigger M5</Text>
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
        ? <AnalisaTab colors={colors} initialSymbol={selectedSymbol} onSignalReady={setCurrentSignal} onSave={handleSaveSignal} />
        : <ExtremeScalpingLogTab colors={colors} />
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