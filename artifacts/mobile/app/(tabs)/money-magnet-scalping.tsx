import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { customFetch, type ScalpingResult } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { MENU_COLORS } from '@/constants/theme';
import { AnimatedCard } from '@/components/animated/AnimatedCard';
import { DirectionalCard } from '@/components/animated/DirectionalCard';
import { StatusBadge } from '@/components/animated/StatusBadge';
import { ScanLoading } from '@/components/animated/ScanLoading';
import { AnimatedTabSwitcher } from '@/components/animated/AnimatedTabSwitcher';
import { CyberBackground } from '@/components/animated/CyberBackground';
import { TaProBonusBanner } from '@/components/animated/TaProBonusBanner';
import { journalSave, journalSaveMany, type JournalEntry } from './journal-helpers';

// ═══════════════════════════════════════════════════════════════════════════
// MENU BARU (request user): Money Magnet Scalping -- logic Money Magnet
// (Scalping, single-level) TF diganti H4->M30 (trend), M30->M5 (eksekusi,
// diganti dari M1 karena kelewat noise).
// SL pakai swing high/low terdekat (bukan ATR). Universe scan SENDIRI 300
// koin, auto-scan pas buka app + hasil progresif -- pola sama persis Sniper
// Breakout & Scalping (POLLING, bukan SSE/EventSource -- lihat breakout.ts
// buat penjelasan lengkap kenapa).
// ═══════════════════════════════════════════════════════════════════════════

const ACCENT = MENU_COLORS.moneyMagnetScalping;

type ScanResponse = {
  coins: Array<ScalpingResult & { marketMeta?: { priceChangePercent: number; quoteVolume: number; fundingRate: number | null } | null }>;
  scanned: number; total: number;
  status: 'idle' | 'running' | 'complete' | 'error';
  errorMessage?: string; fetchedAt: number;
};

async function fetchScan(): Promise<ScanResponse> {
  return customFetch<ScanResponse>('/api/money-magnet-scalping/scan');
}
async function fetchAnalisa(symbol: string): Promise<ScalpingResult> {
  return customFetch<ScalpingResult>(`/api/money-magnet-scalping?symbol=${encodeURIComponent(symbol)}`);
}

// ─── Scan Tab ───────────────────────────────────────────────────────────────

function ScanCoinCard({ coin, onPress, colors, index = 0 }: { coin: ScalpingResult; onPress: () => void; colors: ReturnType<typeof useColors>; index?: number }) {
  const base = coin.symbol.replace('USDT', '');
  const isBuy = coin.bias === 'bullish';
  const biasColor = isBuy ? colors.bullish : colors.bearish;
  const isInZone = coin.status === 'in_zone';
  const isWaiting = coin.status === 'waiting';
  const statusColor = isInZone ? colors.gold : isWaiting ? '#F87171' : '#818CF8';

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
                  {isInZone ? '🎯 SIAP ENTRY' : isWaiting ? '⏳ WAITING' : coin.status.toUpperCase()}
                </Text>
              </View>
            </View>
          </View>
          <StatusBadge status={coin.status} />
        </View>
        {isInZone && (
          <View style={scanStyles.levelsRow}>
            <View style={scanStyles.levelCol}>
              <Text style={[scanStyles.levelLabel, { color: colors.mutedForeground }]}>ENTRY</Text>
              <Text style={[scanStyles.levelValue, { color: colors.foreground }]}>{coin.entryPrice?.toFixed(6) ?? '—'}</Text>
            </View>
            <View style={scanStyles.levelCol}>
              <Text style={[scanStyles.levelLabel, { color: colors.mutedForeground }]}>SL</Text>
              <Text style={[scanStyles.levelValue, { color: colors.bearish }]}>{coin.stopLoss?.toFixed(6) ?? '—'}</Text>
            </View>
            <View style={scanStyles.levelCol}>
              <Text style={[scanStyles.levelLabel, { color: colors.mutedForeground }]}>TP1</Text>
              <Text style={[scanStyles.levelValue, { color: colors.bullish }]}>{coin.takeProfit1?.toFixed(6) ?? '—'}</Text>
            </View>
            <View style={scanStyles.levelCol}>
              <Text style={[scanStyles.levelLabel, { color: colors.mutedForeground }]}>RR</Text>
              <Text style={[scanStyles.levelValue, { color: colors.foreground }]}>{coin.rr1 ? `1:${coin.rr1}` : '—'}</Text>
            </View>
          </View>
        )}
      </DirectionalCard>
    </AnimatedCard>
  );
}

function ScanTab({ colors, onSelectCoin }: { colors: ReturnType<typeof useColors>; onSelectCoin: (coin: ScalpingResult) => void }) {
  const insets = useSafeAreaInsets();
  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['money-magnet-scalping-scan'],
    queryFn: fetchScan,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'running' || s === 'idle' || s === undefined ? 1500 : false;
    },
  });

  const scanStatus = data?.status;
  const scannedCount = data?.scanned ?? 0;
  const totalCount = data?.total ?? 0;
  const [showCompleteNotif, setShowCompleteNotif] = useState(false);
  const prevScanStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevScanStatusRef.current === 'running' && scanStatus === 'complete') {
      setShowCompleteNotif(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setShowCompleteNotif(false), 3000);
    }
    prevScanStatusRef.current = scanStatus;
  }, [scanStatus]);

  const [savingAll, setSavingAll] = useState(false);
  const [saveAllResult, setSaveAllResult] = useState<{ savedCount: number; skippedCount: number } | null>(null);

  const coins = data?.coins ?? [];
  const fetchedAt = data ? new Date(data.fetchedAt || Date.now()).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : null;
  const inZone = coins.filter(c => c.status === 'in_zone');
  const approaching = coins.filter(c => c.status === 'approaching');
  const waiting = coins.filter(c => c.status === 'waiting');

  const handleSaveAllToJournal = useCallback(async (coinsToSave: ScalpingResult[]) => {
    const eligible = coinsToSave.filter(c => c.entryPrice !== undefined && c.stopLoss !== undefined && c.takeProfit1 !== undefined && c.bias);
    if (eligible.length === 0) return;
    setSavingAll(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const entries: JournalEntry[] = eligible.map(c => ({
      id: `${Date.now()}_${c.symbol}_${Math.random().toString(36).slice(2, 7)}`,
      symbol: c.symbol, bias: c.bias!,
      sourceMenu: 'Money Magnet Scalping', sourceSkill: 'Money Magnet Scalping (M30→M5)',
      entryPrice: c.entryPrice!, stopLoss: c.stopLoss ?? 0, takeProfit1: c.takeProfit1 ?? 0,
      currentPriceAtSignal: c.currentPrice, rr1: c.rr1,
      // FIX: tfEksekusi PAKAI '5M' (angka duluan) -- itu konvensi yang match
      // case di evalIntervalFor() journal-helpers.ts, 'M5' gak match apapun
      // (jatuh ke default 15m yang SALAH).
      tfStruktur: 'M30', tfEksekusi: '5M',
      technicalSnapshot: c.technicalSnapshot,
      orderType: 'limit',
      signalStatus: c.status === 'in_zone' ? 'in_zone' : c.status === 'approaching' ? 'approaching' : 'waiting',
      timestamp: c.timestamp, savedAt: Date.now(), status: 'pending',
    }));
    const { savedCount, skippedCount } = await journalSaveMany(entries);
    setSaveAllResult({ savedCount, skippedCount });
    setSavingAll(false);
    setTimeout(() => setSaveAllResult(null), 3000);
  }, []);

  if (isLoading) {
    return (
      <View style={scanStyles.center}>
        <ScanLoading label="SCANNING MONEY MAGNET" accentColor={ACCENT} />
        <Text style={[scanStyles.loadingSub, { color: colors.mutedForeground }]}>Money Magnet Scalping — breakout M15 + RSI D1 filter</Text>
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

  if (coins.length === 0) {
    if (scanStatus === 'running' || scanStatus === 'idle') {
      return (
        <View style={scanStyles.center}>
          <ScanLoading label="SCANNING MONEY MAGNET" accentColor={ACCENT} />
          <Text style={[scanStyles.loadingSub, { color: colors.mutedForeground }]}>
            {totalCount > 0 ? `${scannedCount}/${totalCount} koin — hasil bakal muncul progresif` : 'Money Magnet Scalping — breakout M15 + RSI D1 filter'}
          </Text>
        </View>
      );
    }
    return (
      <View style={scanStyles.center}>
        <Feather name="target" size={36} color={colors.mutedForeground} />
        <Text style={[scanStyles.emptyTitle, { color: colors.foreground }]}>Tidak ada setup Money Magnet Scalping</Text>
        <Text style={[scanStyles.emptySub, { color: colors.mutedForeground }]}>Tidak ada koin yang lolos semua filter saat ini</Text>
        <Pressable onPress={() => refetch()} disabled={isFetching} style={[scanStyles.retryBtn, { backgroundColor: ACCENT, opacity: isFetching ? 0.6 : 1 }]}>
          {isFetching ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Text style={[scanStyles.retryText, { color: colors.primaryForeground }]}>Scan Ulang</Text>}
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: insets.bottom + 80 }} showsVerticalScrollIndicator={false}>
      {showCompleteNotif && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${colors.bullish}18`, borderWidth: 1, borderColor: colors.bullish, borderRadius: 10, padding: 10, marginBottom: 8 }}>
          <Feather name="check-circle" size={14} color={colors.bullish} />
          <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.bullish }}>Scan {totalCount} koin selesai!</Text>
        </View>
      )}
      {scanStatus === 'running' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${ACCENT}12`, borderWidth: 1, borderColor: ACCENT, borderRadius: 10, padding: 10, marginBottom: 8 }}>
          <ActivityIndicator size="small" color={ACCENT} />
          <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: ACCENT }}>Masih scanning... {scannedCount}/{totalCount} koin (hasil di bawah update otomatis)</Text>
        </View>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        {fetchedAt && <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground }}>Update: {fetchedAt} WIB</Text>}
        <Pressable onPress={() => refetch()} disabled={isFetching} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: `${ACCENT}18` }}>
          {isFetching ? <ActivityIndicator size="small" color={ACCENT} /> : <Feather name="refresh-cw" size={13} color={ACCENT} />}
          <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: ACCENT }}>Scan Ulang</Text>
        </Pressable>
      </View>

      {inZone.length > 0 && (
        <>
          <Pressable
            onPress={() => handleSaveAllToJournal(inZone)}
            disabled={savingAll}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: ACCENT, borderRadius: 10, padding: 10, marginBottom: 8, opacity: savingAll ? 0.6 : 1 }}
          >
            {savingAll ? <ActivityIndicator size="small" color="#000" /> : <Feather name="book-open" size={14} color="#000" />}
            <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#000' }}>Simpan Semua ke Journal ({inZone.length})</Text>
          </Pressable>
          {saveAllResult && (
            <Text style={{ fontSize: 11, color: colors.mutedForeground, textAlign: 'center', marginBottom: 8 }}>
              Tersimpan {saveAllResult.savedCount}, dilewati {saveAllResult.skippedCount} (duplikat)
            </Text>
          )}
          <Text style={[scanStyles.sectionLabel, { color: colors.gold }]}>🎯 SIAP ENTRY ({inZone.length})</Text>
          {inZone.map((c, i) => <ScanCoinCard key={`${c.symbol}_${i}`} coin={c} colors={colors} index={i} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectCoin(c); }} />)}
        </>
      )}
      {approaching.length > 0 && (
        <>
          <Text style={[scanStyles.sectionLabel, { color: '#818CF8', marginTop: 12 }]}>APPROACHING ({approaching.length})</Text>
          {approaching.map((c, i) => <ScanCoinCard key={`${c.symbol}_${i}`} coin={c} colors={colors} index={i} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectCoin(c); }} />)}
        </>
      )}
      {waiting.length > 0 && (
        <>
          <Text style={[scanStyles.sectionLabel, { color: '#F87171', marginTop: 12 }]}>⚠️ PANTAU — WAITING ({waiting.length})</Text>
          {waiting.map((c, i) => <ScanCoinCard key={`${c.symbol}_${i}`} coin={c} colors={colors} index={i} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectCoin(c); }} />)}
        </>
      )}
    </ScrollView>
  );
}

// ─── Analisa Tab ────────────────────────────────────────────────────────────

function AnalisaTab({ colors, initialSymbol, pinnedData }: { colors: ReturnType<typeof useColors>; initialSymbol?: string; pinnedData?: ScalpingResult | null }) {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ symbol?: string }>();
  const [inputSymbol, setInputSymbol] = useState(initialSymbol ?? params.symbol ?? '');
  const [querySymbol, setQuerySymbol] = useState(initialSymbol ?? params.symbol ?? '');
  const [liveMode, setLiveMode] = useState(!pinnedData);

  // FIX BUG (ketemu user, "klik koin gak muncul entry/SL/TP"): querySymbol
  // CUMA di-set sekali via useState awal -- pas pinnedData berubah (user
  // klik koin baru dari Scan), querySymbol GAK PERNAH ke-update, jadi
  // kondisi "!querySymbol" selalu true dan nampilin empty state MULU,
  // biarpun pinnedData udah ada isinya. Perlu useEffect buat sync ulang.
  useEffect(() => {
    if (initialSymbol) setQuerySymbol(initialSymbol);
    setLiveMode(!pinnedData); // reset tiap kali coin baru dipilih dari Scan
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSymbol, pinnedData]);

  const { data: liveData, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['money-magnet-scalping-analisa', querySymbol],
    queryFn: () => fetchAnalisa(querySymbol),
    enabled: !!querySymbol && liveMode,
    staleTime: 60_000,
  });
  const data = liveMode ? liveData : pinnedData;

  const handleAnalyze = useCallback(() => {
    const sym = inputSymbol.trim().toUpperCase();
    if (!sym) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const normalized = sym.endsWith('USDT') ? sym : `${sym}USDT`;
    setQuerySymbol(normalized);
    setLiveMode(true);
  }, [inputSymbol]);

  const [savingJournal, setSavingJournal] = useState(false);
  const handleSaveJournal = useCallback(async () => {
    if (!data || !data.entryPrice || !data.bias) return;
    setSavingJournal(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const entry: JournalEntry = {
      id: `${Date.now()}_${data.symbol}`,
      symbol: data.symbol, bias: data.bias,
      sourceMenu: 'Money Magnet Scalping', sourceSkill: 'Money Magnet Scalping (M30→M5)',
      entryPrice: data.entryPrice, stopLoss: data.stopLoss ?? 0, takeProfit1: data.takeProfit1 ?? 0,
      currentPriceAtSignal: data.currentPrice, rr1: data.rr1,
      tfStruktur: 'M30', tfEksekusi: '5M',
      technicalSnapshot: data.technicalSnapshot,
      orderType: 'limit',
      timestamp: data.timestamp, savedAt: Date.now(), status: 'pending',
    };
    await journalSave(entry);
    setSavingJournal(false);
  }, [data]);

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.inputArea, { borderBottomColor: colors.border }]}>
        <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="target" size={15} color={ACCENT} />
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
        <Pressable onPress={handleAnalyze} style={({ pressed }) => [styles.analyzeBtn, { backgroundColor: ACCENT, opacity: pressed ? 0.8 : 1 }]}>
          <Text style={[styles.analyzeBtnText, { color: '#000' }]}>Analisa</Text>
        </Pressable>
      </View>

      {!querySymbol ? (
        <View style={styles.emptyState}>
          <Feather name="target" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Money Magnet Scalping</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Breakout M15 + level signifikan H4 + RSI D1 filter</Text>
        </View>
      ) : isLoading ? (
        <View style={styles.emptyState}>
          <ScanLoading label="MENGANALISA" accentColor={ACCENT} coins={[querySymbol]} />
        </View>
      ) : isError ? (
        <View style={styles.emptyState}>
          <Feather name="wifi-off" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Gagal memuat data</Text>
          <Pressable onPress={() => refetch()} style={[scanStyles.retryBtn, { backgroundColor: ACCENT }]}>
            <Text style={[scanStyles.retryText, { color: '#000' }]}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : data ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: insets.bottom + 80 }} showsVerticalScrollIndicator={false}>
          {!liveMode && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${colors.gold}18`, borderWidth: 1, borderColor: colors.gold, borderRadius: 10, padding: 10, marginBottom: 8 }}>
              <Feather name="lock" size={12} color={colors.gold} />
              <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, flex: 1 }}>Data dari hasil Scan tadi (terkunci) — kondisi market bisa udah geser.</Text>
              <Pressable onPress={() => { setLiveMode(true); refetch(); }} style={{ padding: 4 }}>
                <Feather name="refresh-cw" size={14} color={colors.gold} />
              </Pressable>
            </View>
          )}
          <Text style={[styles.symbolTitle, { color: colors.foreground }]}>{data.symbol.replace('USDT', '')}/USDT</Text>
          <Text style={{ fontSize: 11, color: colors.mutedForeground, marginBottom: 8 }}>{data.timestamp}</Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <StatusBadge status={data.status} />
            {data.bias && (
              <View style={[scanStyles.biasBadge, { backgroundColor: `${data.bias === 'bullish' ? colors.bullish : colors.bearish}18`, borderColor: data.bias === 'bullish' ? colors.bullish : colors.bearish }]}>
                <Text style={[scanStyles.biasBadgeText, { color: data.bias === 'bullish' ? colors.bullish : colors.bearish }]}>{data.bias === 'bullish' ? '▲ LONG' : '▼ SHORT'}</Text>
              </View>
            )}
          </View>

          {data.message && (
            <View style={{ backgroundColor: `${colors.border}40`, borderRadius: 10, padding: 12, marginBottom: 10 }}>
              <Text style={{ fontSize: 12, color: colors.foreground, lineHeight: 18 }}>{data.message}</Text>
            </View>
          )}

          {data.status === 'in_zone' && (
            <>
              <Pressable onPress={handleSaveJournal} disabled={savingJournal} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: ACCENT, borderRadius: 10, padding: 12, marginBottom: 10, opacity: savingJournal ? 0.6 : 1 }}>
                {savingJournal ? <ActivityIndicator size="small" color="#000" /> : <Feather name="book-open" size={15} color="#000" />}
                <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#000' }}>Simpan ke Journal</Text>
              </Pressable>
              {(data as any).taProBonusConfirmed && (
                <TaProBonusBanner classification={(data as any).taProBonusClassification} score={(data as any).taProBonusScore} />
              )}
              <View style={[styles.levelCard, { borderColor: data.bias === 'bullish' ? colors.bullish : colors.bearish, backgroundColor: `${data.bias === 'bullish' ? colors.bullish : colors.bearish}10` }]}>
                <Text style={[styles.levelCardLabel, { color: colors.mutedForeground }]}>ENTRY</Text>
                <Text style={[styles.levelCardValue, { color: data.bias === 'bullish' ? colors.bullish : colors.bearish }]}>{data.entryPrice?.toFixed(6)}</Text>
                <Text style={[styles.levelCardSub, { color: colors.mutedForeground }]}>{data.bias === 'bullish' ? 'BUY LIMIT' : 'SELL LIMIT'} — magnet zone (M5)</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.bearish }]}>Stop Loss</Text>
                <Text style={[styles.infoValue, { color: colors.bearish }]}>{data.stopLoss?.toFixed(6) ?? '—'}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.bullish }]}>TP1 (RR 1:{data.rr1?.toFixed(1) ?? '2.0'})</Text>
                <Text style={[styles.infoValue, { color: colors.bullish }]}>{data.takeProfit1?.toFixed(6) ?? '—'}</Text>
              </View>
            </>
          )}

          {data.filterResults && data.filterResults.length > 0 && (
            <View style={{ marginTop: 16, backgroundColor: `${colors.border}20`, borderRadius: 10, padding: 12 }}>
              <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, letterSpacing: 0.5, marginBottom: 8 }}>SYARAT YANG DICEK</Text>
              {data.filterResults.map((f, i) => (
                <Text key={i} style={{ fontSize: 12, color: colors.foreground, lineHeight: 18, marginBottom: 6 }}>{f}</Text>
              ))}
            </View>
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

// ─── Root ───────────────────────────────────────────────────────────────────

export default function MoneyMagnetScalpingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  // FIX BUG (ketemu user, "tulisan kepotong keatas"): di web, insets.top
  // doang gak cukup -- ada offset tambahan dari chrome browser/frame
  // simulator yang gak ke-hitung insets. Pola ini SAMA PERSIS kayak yang
  // dipake breakout.tsx/index.tsx.
  const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const [activeTab, setActiveTab] = useState<'scan' | 'analisa' | 'ringkasan'>('scan');
  const [pinnedCoin, setPinnedCoin] = useState<ScalpingResult | null>(null);

  const handleSelectCoin = useCallback((coin: ScalpingResult) => {
    setPinnedCoin(coin);
    setActiveTab('analisa');
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: '#050208' }]}>
      <CyberBackground />
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: 'rgba(255,0,229,0.2)', backgroundColor: '#050208' }]}>
        <View style={styles.headerTop}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Money Magnet Scalping</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>Breakout M15 + level signifikan H4 + RSI D1 filter</Text>
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
        : <RingkasanTab colors={colors} />}
    </View>
  );
}

// ─── Ringkasan Tab (basic) ──────────────────────────────────────────────────

function RingkasanTab({ colors }: { colors: ReturnType<typeof useColors> }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: insets.bottom + 80 }}>
      <View style={{ backgroundColor: `${colors.border}20`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
        <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.foreground, marginBottom: 8 }}>Tentang Money Magnet Scalping</Text>
        <Text style={{ fontSize: 12, color: colors.mutedForeground, lineHeight: 19 }}>
          Arah sinyal murni dari breakout M15 sendiri (gak ada trend gate H4 lagi). Level S/R harus signifikan (min. 2x reaksi jelas di H4). Filter RSI(14) D1 nolak sinyal kalau udah overbought/oversold. SL pakai 1,4×ATR M15 (TF eksekusi).
        </Text>
      </View>
      <View style={{ backgroundColor: `${colors.border}20`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
        <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.foreground, marginBottom: 8 }}>Alur Logic</Text>
        <Text style={{ fontSize: 12, color: colors.mutedForeground, lineHeight: 19 }}>
          1. Breakout M15 fresh & untouched, volume ≥2,5x MA20{'\n'}
          2. Level signifikan — min. 2x reaksi jelas di H4 (toleransi ATR×0,15){'\n'}
          3. Retest ke level (toleransi 0,3%), Force Index berlawanan (tanda genuine menuju retest), tanpa divergence{'\n'}
          4. Filter RSI(14) D1 — ≥65 tolak BUY (overbought), ≤35 tolak SELL (oversold){'\n'}
          5. Entry limit, SL = 1,4×ATR M15, TP1 RR 1:2, TP2 RR 1:3
        </Text>
      </View>
      <Text style={{ fontSize: 11, color: colors.mutedForeground, textAlign: 'center', marginTop: 8 }}>
        Statistik win-rate belum tersedia untuk menu ini (belum terintegrasi ke infra backtest).
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  headerTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  liveDot: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, gap: 5 },
  liveDotInner: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 1 },
  inputArea: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1 },
  inputBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, height: 40 },
  inputText: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
  analyzeBtn: { paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  analyzeBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptySub: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  symbolTitle: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  levelCard: { borderWidth: 1, borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 10 },
  levelCardLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 1 },
  levelCardValue: { fontSize: 26, fontFamily: 'Inter_700Bold', marginTop: 4 },
  levelCardSub: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  infoLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  infoValue: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});

const scanStyles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
  loadingSub: { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 4 },
  emptyTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptySub: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginTop: 8 },
  retryText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  sectionLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5, marginBottom: 6 },
  card: { padding: 12, borderRadius: 12, marginBottom: 8 },
  cardRow1: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardBase: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  cardQuote: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  biasBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  biasBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  levelsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  levelCol: { alignItems: 'center' },
  levelLabel: { fontSize: 9, fontFamily: 'Inter_500Medium' },
  levelValue: { fontSize: 11, fontFamily: 'Inter_600SemiBold', marginTop: 2 },
});