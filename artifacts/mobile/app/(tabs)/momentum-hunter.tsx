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
import { useGetMomentumHunter, useGetMomentumHunterScan, getGetMomentumHunterQueryKey, getGetMomentumHunterScanQueryKey, type MomentumHunterResult } from '@workspace/api-client-react';
import { journalSave, type JournalEntry } from './journal-helpers';
import { AnimatedCard } from '@/components/animated/AnimatedCard';
import { DirectionalCard } from '@/components/animated/DirectionalCard';
import { StatusBadge } from '@/components/animated/StatusBadge';
import { AnimatedTabSwitcher } from '@/components/animated/AnimatedTabSwitcher';
import { ScanLoading } from '@/components/animated/ScanLoading';
import { LogResultBadge } from '@/components/animated/LogResultBadge';
import { FuturisticBackground } from '@/components/animated/FuturisticBackground';
import { MenuJournalSummary } from '@/components/MenuJournalSummary';
import { MarketStructureV2Card } from '@/components/MarketStructureV2Card';
import { MENU_COLORS } from '@/constants/theme';

const ACCENT = MENU_COLORS.momentumHunter;

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(5);
  return price.toFixed(6);
}

// setupType -> label + warna + icon, dipake scan card & detail view
function setupTypeInfo(setupType?: string): { label: string; short: string; color: string; icon: keyof typeof Feather.glyphMap; desc: string } {
  switch (setupType) {
    case 'retest':
      return { label: 'RETEST (Trend)', short: '↩ Retest', color: '#4ADE80', icon: 'repeat', desc: 'Breakout udah kejadian (candle close + volume confirm), harga balik retest ke zona — basis Skill 15M murni.' };
    case 'reversal_ekstrem':
      return { label: 'REVERSAL-EKSTREM', short: '⤴ Reversal', color: '#60A5FA', icon: 'refresh-ccw', desc: 'Harga di S&R TERKUAT (≥3x touch), ada rejection candle valid, didukung RSI ekstrem (20/80) atau divergence.' };
    case 'breakout_antisipasi':
      return { label: 'BREAKOUT-ANTISIPASI', short: '⚡ Antisipasi', color: '#FBBF24', icon: 'zap', desc: 'Breakout BELUM kejadian, harga mendekati edge zona dengan momentum akselerasi — entry pakai STOP order, nangkep breakout dari awal.' };
    case 'sideways_rejection':
      return { label: 'SIDEWAYS-REJECTION', short: '↔ Sideways', color: '#A78BFA', icon: 'shuffle', desc: 'Market genuinely ranging di semua TF trend — fallback single-TF, mean-reversion di boundary range.' };
    default:
      return { label: 'MOMENTUM HUNTER', short: '—', color: ACCENT, icon: 'compass', desc: '' };
  }
}

// ─── Scan Coin Card ───────────────────────────────────────────────────────────

function ScanCoinCard({ coin, onPress, colors, index = 0 }: { coin: MomentumHunterResult; onPress: () => void; colors: ReturnType<typeof useColors>; index?: number }) {
  const base = coin.symbol.replace('USDT', '');
  const isBuy = coin.bias === 'bullish';
  const biasColor = isBuy ? colors.bullish : colors.bearish;
  const info = setupTypeInfo(coin.setupType);
  const tfLabel = coin.tfEksekusi ? `${coin.tfStruktur}→${coin.tfEksekusi}` : coin.tfStruktur;

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
            <View style={[scanStyles.biasBadge, { backgroundColor: `${info.color}18`, borderColor: info.color }]}>
              <Text style={[scanStyles.biasBadgeText, { color: info.color }]}>{info.short}</Text>
            </View>
          </View>
          <Text style={{ fontSize: 9, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 2 }} numberOfLines={1}>
            TF {tfLabel} · {coin.orderType === 'stop' ? 'Stop' : 'Limit'} order
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <StatusBadge status={coin.status} />
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
          <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>TP</Text>
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

function ScanTab({ colors, onSelectCoin }: { colors: ReturnType<typeof useColors>; onSelectCoin: (coin: MomentumHunterResult) => void }) {
  const insets = useSafeAreaInsets();
  // isFetching (bukan isLoading) — fix bug audit: isLoading React Query cuma
  // true pas fetch PERTAMA kali, jadi tombol SCAN NOW kliatan "gak ngerespon"
  // pas refetch (isLoading tetep false walau lagi proses di background) —
  // paling kerasa di sini karena Momentum Hunter scan-nya paling lama (4 TF
  // pair × 3 tipe setup per koin).
  const { data, isLoading, isFetching, isError, refetch } = useGetMomentumHunterScan({
    query: { queryKey: getGetMomentumHunterScanQueryKey(), staleTime: 3 * 60 * 1000 },
  });

  if (isLoading) {
    return (
      <View style={scanStyles.center}>
        <ScanLoading label="MEMBURU MOMENTUM" accentColor={ACCENT} />
        <Text style={[scanStyles.loadingSub, { color: colors.mutedForeground }]}>4 pasangan TF × 3 tipe setup + fallback sideways</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={scanStyles.center}>
        <Feather name="wifi-off" size={36} color={colors.mutedForeground} />
        <Text style={[scanStyles.emptyTitle, { color: colors.foreground }]}>Gagal memuat data</Text>
        <Pressable onPress={() => refetch()} disabled={isFetching} style={[scanStyles.retryBtn, { backgroundColor: ACCENT, opacity: isFetching ? 0.6 : 1 }]}>
          {isFetching ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Text style={[scanStyles.retryText, { color: colors.primaryForeground }]}>Coba Lagi</Text>}
        </Pressable>
      </View>
    );
  }

  const coins = data?.coins ?? [];
  const fetchedAt = data ? new Date((data as any).fetchedAt ?? Date.now()).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : null;

  if (coins.length === 0) {
    return (
      <View style={scanStyles.center}>
        <Feather name="compass" size={36} color={colors.mutedForeground} />
        <Text style={[scanStyles.emptyTitle, { color: colors.foreground }]}>Belum ada momentum yang ketemu</Text>
        <Text style={[scanStyles.emptySub, { color: colors.mutedForeground }]}>Sistem ini coba 4 TF × 3 tipe setup + fallback sideways per koin — kosong itu wajar kalau lagi gak ada peluang jelas. Jaga kesehatan, jangan overtrading.</Text>
        <Pressable onPress={() => refetch()} disabled={isFetching} style={[scanStyles.retryBtn, { backgroundColor: ACCENT, opacity: isFetching ? 0.6 : 1 }]}>
          {isFetching ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Text style={[scanStyles.retryText, { color: colors.primaryForeground }]}>Scan Ulang</Text>}
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
        <ScanNowButton onPress={() => refetch()} isLoading={isFetching} colors={colors} />
      </View>

      <Text style={[scanStyles.groupHeader, { color: colors.gold }]}>🔭 MOMENTUM KETEMU (siap entry duluan, baru mendekati)</Text>
      {coins.map((c, i) => <ScanCoinCard key={c.symbol} coin={c} colors={colors} index={i} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectCoin(c); }} />)}
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
  condRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8, paddingHorizontal: 4 },
  condItem: { flex: 1, alignItems: 'center', gap: 3 },
  condLabel: { fontSize: 7, fontFamily: 'Inter_500Medium', letterSpacing: 0.3 },
  condValue: { fontSize: 8, fontFamily: 'Inter_600SemiBold' },
  condDivider: { width: StyleSheet.hairlineWidth, marginVertical: 4 },
});

// ─── Analisa Tab ──────────────────────────────────────────────────────────────

function AnalisaTab({ colors, initialSymbol, pinnedData }: { colors: ReturnType<typeof useColors>; initialSymbol?: string; pinnedData?: MomentumHunterResult | null }) {
  const insets = useSafeAreaInsets();
  const [inputSymbol, setInputSymbol] = useState(initialSymbol ?? '');
  const [querySymbol, setQuerySymbol] = useState(initialSymbol ?? '');
  const [showAllAttempts, setShowAllAttempts] = useState(false);
  // liveMode=false artinya lagi nampilin data yang DI-KUNCI dari hasil Scan
  // (gak auto-fetch ulang) — biar sinyal gak diem-diem berubah pas user lagi
  // transisi ke Binance buat eksekusi. liveMode=true = data fresh (search
  // manual, atau user eksplisit minta refresh).
  const [liveMode, setLiveMode] = useState(!pinnedData);

  useEffect(() => {
    if (initialSymbol) {
      setQuerySymbol(initialSymbol);
      setInputSymbol(initialSymbol);
    }
    setLiveMode(!pinnedData); // reset tiap kali coin baru dipilih dari Scan
  }, [initialSymbol, pinnedData]);

  const { data: liveData, isLoading, isError, refetch } = useGetMomentumHunter(
    { symbol: querySymbol },
    { query: { queryKey: getGetMomentumHunterQueryKey({ symbol: querySymbol }), enabled: !!querySymbol && liveMode, staleTime: 60_000 } }
  );

  const data = liveMode ? liveData : pinnedData;

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
    const setupLabel = setupTypeInfo(data.setupType).label;
    const entry: JournalEntry = {
      id: `${Date.now()}_${data.symbol}`,
      symbol: data.symbol, bias: data.bias,
      sourceMenu: 'Momentum Hunter', sourceSkill: setupLabel,
      entryPrice: data.entryPrice, stopLoss: data.stopLoss ?? 0, takeProfit1: data.takeProfit1 ?? 0,
      currentPriceAtSignal: data.currentPrice, rr1: data.rr1,
      tfStruktur: data.tfStruktur ?? '15M', tfEksekusi: data.tfEksekusi,
      technicalSnapshot: data.technicalSnapshot as JournalEntry['technicalSnapshot'],
      orderType: data.orderType, // dinamis — stop khusus breakout_antisipasi, limit buat 3 tipe setup lain
      btcAligned: data.btcAligned, btcBias: data.btcBias,
      timestamp: data.timestamp, savedAt: Date.now(), status: 'pending',
    };
    await journalSave(entry);
    setSavingJournal(false);
  }, [data]);

  const bottomPadding = 60 + (Platform.OS === 'web' ? 34 : insets.bottom);
  const info = setupTypeInfo(data?.setupType);

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.inputArea, { borderBottomColor: colors.border }]}>
        <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="compass" size={15} color={ACCENT} />
          <TextInput
            style={[styles.inputText, { color: colors.foreground }]}
            placeholder="Masukkan pair (BTCUSDT)"
            placeholderTextColor={colors.mutedForeground}
            value={inputSymbol}
            onChangeText={setInputSymbol}
            autoCapitalize="characters"
            autoCorrect={false}
            onSubmitEditing={handleAnalyze}
            returnKeyType="search"
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
          <Feather name="compass" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Momentum Hunter</Text>
          <Text style={[styles.emptyDesc, { color: colors.mutedForeground }]}>Masukkan pair — sistem otomatis coba 4 pasangan TF (15M→1M, 5M→1M, H1→15M, H4→M30) × 3 tipe setup (retest, reversal-ekstrem, breakout-antisipasi), fallback sideways (15M/5M/H1) kalau semua TF trend gak ketemu apa-apa</Text>
        </View>
      ) : (liveMode && isLoading) ? (
        <View style={styles.emptyState}>
          <ScanLoading label="MEMBURU MOMENTUM" accentColor={ACCENT} coins={[querySymbol || 'BTCUSDT']} />
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
          {/* Banner: data terkunci dari Scan, BUKAN live — biar user gak salah kira ini fresh */}
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
          <View style={[styles.section, { backgroundColor: `${ACCENT}0F`, borderColor: `${ACCENT}40` }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View>
                <Text style={[styles.pairTitle, { color: colors.foreground }]}>
                  {data.symbol.replace('USDT', '')}/USDT
                </Text>
                <Text style={[styles.timestamp, { color: colors.mutedForeground }]}>{data.timestamp}</Text>
              </View>
              <StatusBadge status={data.status} />
            </View>
            {data.setupType && (
              <View style={[scanStyles.biasBadge, { backgroundColor: `${info.color}18`, borderColor: info.color, alignSelf: 'flex-start', marginTop: 8 }]}>
                <Text style={[scanStyles.biasBadgeText, { color: info.color, fontSize: 10 }]}>{info.label}</Text>
              </View>
            )}
            {data.message && (
              <View style={[styles.messageBox, { backgroundColor: `${ACCENT}10`, borderLeftColor: ACCENT }]}>
                <Text style={[styles.messageText, { color: colors.mutedForeground }]}>{data.message}</Text>
              </View>
            )}
          </View>
          </AnimatedCard>

          {/* Penjelasan tipe setup — biar user paham KENAPA ini yang dipilih */}
          {data.setupType && info.desc && (
            <AnimatedCard index={2}>
            <View style={[styles.section, { backgroundColor: `${info.color}0A`, borderColor: `${info.color}30` }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Feather name={info.icon} size={16} color={info.color} />
                <Text style={[styles.sectionTitle, { color: info.color, marginBottom: 0 }]}>KENAPA TIPE INI?</Text>
              </View>
              <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.foreground, lineHeight: 20 }}>{info.desc}</Text>
              <View style={[styles.divider, { backgroundColor: colors.border, marginTop: 10 }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>TF yang ketemu momentum</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>
                  {data.tfEksekusi ? `${data.tfStruktur} → ${data.tfEksekusi}` : `${data.tfStruktur} (single-TF)`}
                </Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Order type</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>
                  {data.orderType === 'stop' ? '🔺 STOP (breakout belum kejadian)' : '🎯 LIMIT (zona/retest udah dikonfirmasi)'}
                </Text>
              </View>
            </View>
            </AnimatedCard>
          )}

          {/* Zona */}
          {data.zoneEdgeUpper !== undefined && (
            <AnimatedCard index={3}>
            <View style={[styles.section, { backgroundColor: 'rgba(74,222,128,0.06)', borderColor: 'rgba(74,222,128,0.22)' }]}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ZONA</Text>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Edge Zona</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>
                  {formatPrice(data.zoneEdgeLower ?? 0)} – {formatPrice(data.zoneEdgeUpper ?? 0)}
                </Text>
              </View>
              {data.candlesSinceBreakout !== undefined && (
                <>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <View style={styles.infoRow}>
                    <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Event terjadi</Text>
                    <Text style={[styles.infoValue, { color: colors.foreground }]}>{data.candlesSinceBreakout} candle lalu</Text>
                  </View>
                </>
              )}
            </View>
            </AnimatedCard>
          )}

          {/* Simpan ke Journal — SATU-SATUNYA cara nyimpen sinyal sekarang */}
          {(data.status === 'siap_entry' || data.status === 'approaching') && (
            <Pressable onPress={handleSaveJournal} disabled={savingJournal}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, margin: 12, marginTop: 4, paddingVertical: 14, borderRadius: 12, backgroundColor: ACCENT, opacity: pressed || savingJournal ? 0.8 : 1 }]}>
              <Feather name="book-open" size={15} color={colors.primaryForeground} />
              <Text style={{ fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.primaryForeground }}>{savingJournal ? 'Menyimpan...' : 'Simpan ke Journal'}</Text>
            </Pressable>
          )}

          {/* Entry / SL / TP */}
          {data.entryPrice && (
            <AnimatedCard index={4}>
            <View style={[styles.section, { backgroundColor: 'rgba(251,191,36,0.06)', borderColor: 'rgba(251,191,36,0.22)' }]}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ENTRY / SL / TP</Text>
              <View style={[styles.levelCard, {
                backgroundColor: `${data.bias === 'bullish' ? colors.bullish : colors.bearish}10`,
                borderColor: data.bias === 'bullish' ? colors.bullish : colors.bearish
              }]}>
                <Text style={[styles.levelCardLabel, { color: colors.mutedForeground }]}>ENTRY</Text>
                <Text style={[styles.levelCardPrice, { color: data.bias === 'bullish' ? colors.bullish : colors.bearish }]}>
                  {formatPrice(data.entryPrice)}
                </Text>
                <Text style={[styles.levelCardSub, { color: colors.mutedForeground }]}>
                  {data.orderType === 'stop' ? 'STOP' : 'LIMIT'} — {data.bias === 'bullish' ? 'BUY' : 'SELL'}
                </Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.bearish }]}>Stop Loss</Text>
                <Text style={[styles.infoValue, { color: colors.bearish }]}>{data.stopLoss ? formatPrice(data.stopLoss) : '—'}</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.bullish }]}>TP (RR 1:{data.rr1?.toFixed(1) ?? 2})</Text>
                <Text style={[styles.infoValue, { color: colors.bullish }]}>{data.takeProfit1 ? formatPrice(data.takeProfit1) : '—'}</Text>
              </View>
            </View>
            </AnimatedCard>
          )}

          <View style={{ marginHorizontal: 12 }}>
            <MarketStructureV2Card data={data.marketStructureV2} />
          </View>

          {/* Filter Results */}
          {data.filterResults && data.filterResults.length > 0 && (
            <AnimatedCard index={5}>
            <View style={[styles.section, { backgroundColor: 'rgba(34,211,238,0.05)', borderColor: 'rgba(34,211,238,0.2)' }]}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>DETAIL KONFIRMASI</Text>
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

          {/* Attempts Log — transparansi semua TF x tipe yang udah dicoba */}
          {data.attemptsLog && data.attemptsLog.length > 0 && (
            <AnimatedCard index={6}>
            <View style={[styles.section, { backgroundColor: 'rgba(148,163,184,0.05)', borderColor: 'rgba(148,163,184,0.18)' }]}>
              <Pressable onPress={() => setShowAllAttempts(v => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[styles.sectionTitle, { color: colors.mutedForeground, marginBottom: 0 }]}>
                  RIWAYAT PENCARIAN ({data.attemptsLog.length} percobaan)
                </Text>
                <Feather name={showAllAttempts ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedForeground} />
              </Pressable>
              <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 4, marginBottom: showAllAttempts ? 8 : 0, fontStyle: 'italic' }}>
                Transparansi kenapa akhirnya milih setup ini — semua TF & tipe yang dicoba sebelumnya.
              </Text>
              {showAllAttempts && data.attemptsLog.map((a, i) => (
                <Text key={i} style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, paddingVertical: 3, lineHeight: 16 }}>
                  {i + 1}. {a}
                </Text>
              ))}
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
                    symbol: data.symbol,
                    direction: data.bias ?? 'bullish',
                    source: 'momentum_hunter',
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

export default function MomentumHunterScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const [activeTab, setActiveTab] = useState<'scan' | 'analisa' | 'ringkasan'>('scan');
  const [pinnedCoin, setPinnedCoin] = useState<MomentumHunterResult | undefined>();

  const handleSelectCoin = useCallback((coin: MomentumHunterResult) => {
    setPinnedCoin(coin);
    setActiveTab('analisa');
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FuturisticBackground accentColor={ACCENT} secondaryColor="#60A5FA" />
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={styles.headerTop}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Momentum Hunter</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>4 TF × 3 tipe setup, basis Skill 15M — retest, reversal-ekstrem, breakout-antisipasi</Text>
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
            { key: 'ringkasan', label: 'RINGKASAN' },
          ]}
          active={activeTab}
          onChange={(k) => setActiveTab(k as 'scan' | 'analisa' | 'ringkasan')}
          accentColor={ACCENT}
        />
      </View>

      {activeTab === 'scan'
        ? <ScanTab colors={colors} onSelectCoin={handleSelectCoin} />
        : activeTab === 'analisa'
        ? <AnalisaTab colors={colors} initialSymbol={pinnedCoin?.symbol} pinnedData={pinnedCoin} />
        : <MenuJournalSummary sourceMenu="Momentum Hunter" accentColor={ACCENT} />
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
});