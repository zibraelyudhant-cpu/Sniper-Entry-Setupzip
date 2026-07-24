import React, { useState, useEffect } from 'react';

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

// ─── Types ────────────────────────────────────────────────────────────────────

interface BreakdownItem {
  trades: number;
  wins: number;
  winRate: number;
}

interface BacktestAnalysis {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgRR: number;
  breakdown: {
    withChoch15M: BreakdownItem;
    withoutChoch15M: BreakdownItem;
    withRejection15M: BreakdownItem;
    withoutRejection15M: BreakdownItem;
    withPattern: BreakdownItem;
    withoutPattern: BreakdownItem;
    tier1to2: BreakdownItem;
    tier3plus: BreakdownItem;
    londonNY: BreakdownItem;
    asian: BreakdownItem;
    highVolume: BreakdownItem;
    lowVolume: BreakdownItem;
  };
  lossCauses: Array<{ cause: string; count: number; percentage: number }>;
  recommendations: string[];
}

interface BacktestResult {
  symbol: string;
  period: string;
  totalCandles: number;
  sniperResult?: BacktestAnalysis;
  breakoutResult?: BacktestAnalysis;
  comparison?: {
    better: 'sniper' | 'breakout' | 'equal';
    sniperWinRate: number;
    breakoutWinRate: number;
    mostImpactfulFilter: string;
  };
  timestamp: string;
}

// ─── Components ───────────────────────────────────────────────────────────────

function WinRateBadge({ rate, colors }: { rate: number; colors: ReturnType<typeof useColors> }) {
  const color = rate >= 75 ? colors.bullish : rate >= 50 ? colors.gold : colors.bearish;
  return (
    <View style={[styles.badge, { backgroundColor: `${color}20`, borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{rate.toFixed(1)}%</Text>
    </View>
  );
}

function BreakdownRow({ label, with: withItem, without: withoutItem, colors }: {
  label: string;
  with: BreakdownItem;
  without: BreakdownItem;
  colors: ReturnType<typeof useColors>;
}) {
  if (withItem.trades === 0 && withoutItem.trades === 0) return null;
  const diff = withItem.winRate - withoutItem.winRate;
  const diffColor = diff > 0 ? colors.bullish : diff < 0 ? colors.bearish : colors.mutedForeground;

  return (
    <View style={[styles.breakdownRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.breakdownLabel, { color: colors.foreground }]}>{label}</Text>
      <View style={styles.breakdownRight}>
        <View style={styles.breakdownItem}>
          <Text style={[styles.breakdownSub, { color: colors.mutedForeground }]}>Ada ({withItem.trades})</Text>
          <WinRateBadge rate={withItem.winRate} colors={colors} />
        </View>
        <View style={styles.breakdownItem}>
          <Text style={[styles.breakdownSub, { color: colors.mutedForeground }]}>Tidak ({withoutItem.trades})</Text>
          <WinRateBadge rate={withoutItem.winRate} colors={colors} />
        </View>
        {Math.abs(diff) > 3 && (
          <Text style={[styles.breakdownDiff, { color: diffColor }]}>
            {diff > 0 ? '+' : ''}{diff.toFixed(0)}%
          </Text>
        )}
      </View>
    </View>
  );
}

function MenuResult({ title, result, colors }: {
  title: string;
  result: BacktestAnalysis;
  colors: ReturnType<typeof useColors>;
}) {
  const [expanded, setExpanded] = useState(false);
  const winColor = result.winRate >= 75 ? colors.bullish : result.winRate >= 50 ? colors.gold : colors.bearish;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header */}
      <Pressable onPress={() => setExpanded(!expanded)} style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
            {result.totalTrades} sinyal · Avg R:R {result.avgRR}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={[styles.winRateMain, { color: winColor }]}>{result.winRate.toFixed(1)}%</Text>
          <Text style={[styles.winRateSub, { color: colors.mutedForeground }]}>
            {result.wins}W / {result.losses}L
          </Text>
        </View>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedForeground} style={{ marginLeft: 8 }} />
      </Pressable>

      {expanded && (
        <>
          {/* Win rate bar */}
          <View style={[styles.barBg, { backgroundColor: colors.border }]}>
            <View style={[styles.barFill, { width: `${Math.min(result.winRate, 100)}%`, backgroundColor: winColor }]} />
          </View>

          {/* Breakdown kondisi */}
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>BREAKDOWN KONDISI</Text>
          <BreakdownRow label="CHoCH 15M" with={result.breakdown.withChoch15M} without={result.breakdown.withoutChoch15M} colors={colors} />
          <BreakdownRow label="Rejection 15M" with={result.breakdown.withRejection15M} without={result.breakdown.withoutRejection15M} colors={colors} />
          <BreakdownRow label="Pattern" with={result.breakdown.withPattern} without={result.breakdown.withoutPattern} colors={colors} />
          <BreakdownRow label="Zona Tier 1-2" with={result.breakdown.tier1to2} without={result.breakdown.tier3plus} colors={colors} />
          <BreakdownRow label="London/NY" with={result.breakdown.londonNY} without={result.breakdown.asian} colors={colors} />
          <BreakdownRow label="Vol Tinggi (≥2x)" with={result.breakdown.highVolume} without={result.breakdown.lowVolume} colors={colors} />

          {/* Penyebab lose */}
          {result.lossCauses.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 12 }]}>PENYEBAB LOSE</Text>
              {result.lossCauses.map((c, idx) => (
                <View key={idx} style={[styles.causeRow, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.causeRank, { color: colors.bearish }]}>#{idx + 1}</Text>
                  <Text style={[styles.causeName, { color: colors.foreground }]}>{c.cause}</Text>
                  <Text style={[styles.causePct, { color: colors.bearish }]}>{c.percentage}%</Text>
                </View>
              ))}
            </>
          )}

          {/* Rekomendasi */}
          {result.recommendations.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 12 }]}>
                {result.winRate >= 75 ? '✅ PERFORMA BAGUS' : '💡 REKOMENDASI'}
              </Text>
              {result.winRate >= 75 ? (
                <Text style={[styles.recText, { color: colors.bullish }]}>
                  Win rate sudah di atas 75% — pertahankan filter yang ada.
                </Text>
              ) : (
                result.recommendations.map((rec, idx) => (
                  <View key={idx} style={[styles.recRow, { borderLeftColor: colors.gold, backgroundColor: `${colors.gold}10` }]}>
                    <Text style={[styles.recText, { color: colors.foreground }]}>{rec}</Text>
                  </View>
                ))
              )}
            </>
          )}
        </>
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

const PERIODS = [
  { label: '1 Bulan', value: '1m' },
  { label: '3 Bulan', value: '3m' },
  { label: '6 Bulan', value: '6m' },
  { label: '1 Tahun', value: '1y' },
  { label: 'Sejak Listing', value: 'all' },
] as const;

const MENUS = [
  { label: 'Sniper', value: 'sniper' },
  { label: 'Scalping', value: 'breakout' },
  { label: 'Keduanya', value: 'both' },
] as const;

export default function BacktestScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const bottomPadding = insets.bottom + 80;

  const [symbol, setSymbol] = useState('');
  const [period, setPeriod] = useState<'1m' | '3m' | '6m' | '1y' | 'all'>('3m');
  const [menu, setMenu] = useState<'sniper' | 'breakout' | 'both'>('both');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listingInfo, setListingInfo] = useState<{ ageLabel: string; listingDate: string; h1Candles: number } | null>(null);
  const [listingLoading, setListingLoading] = useState(false);

  const fetchListingInfo = async (sym: string) => {
    if (!sym.trim()) return;
    setListingLoading(true);
    setListingInfo(null);
    try {
      const normalized = sym.trim().toUpperCase().endsWith('USDT')
        ? sym.trim().toUpperCase() : `${sym.trim().toUpperCase()}USDT`;
      const apiUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/api/backtest/listing-info?symbol=${normalized}`
        : `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/backtest/listing-info?symbol=${normalized}`;
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setListingInfo({ ageLabel: data.ageLabel, listingDate: data.listingDate, h1Candles: data.h1Candles });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setListingLoading(false);
    }
  }

  // Auto-fetch listing info kalau period 'all' dan symbol sudah ada
  useEffect(() => {
    if (period === 'all' && symbol.trim()) {
      fetchListingInfo(symbol);
    } else if (period !== 'all') {
      setListingInfo(null);
    }
  }, [period, symbol]);;

  const handlePeriodSelect = (val: '1m' | '3m' | '6m' | '1y' | 'all') => {
    setPeriod(val);
    if (val === 'all' && symbol.trim()) fetchListingInfo(symbol);
  };

  const runBacktest = async () => {
    if (!symbol.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const sym = symbol.trim().toUpperCase();
      const normalized = sym.endsWith('USDT') ? sym : `${sym}USDT`;
      const apiUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/api/backtest`
        : `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/backtest`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: normalized, period, menu }),
      });
      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try { const body = await res.json(); if (body?.error) errMsg = body.error; } catch {}
        throw new Error(errMsg);
      }
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menjalankan backtest');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Backtesting</Text>
        <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>Analisa performa sinyal historis</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }} showsVerticalScrollIndicator={false}>

        {/* Input Symbol */}
        <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={15} color={colors.mutedForeground} />
          <TextInput
            style={[styles.inputText, { color: colors.foreground }]}
            placeholder="Masukkan pair (BTC atau BTCUSDT)"
            placeholderTextColor={colors.mutedForeground}
            value={symbol}
            onChangeText={setSymbol}
            autoCapitalize="characters"
            returnKeyType="done"
          />
          {symbol.length > 0 && (
            <Pressable onPress={() => setSymbol('')}>
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>

        {/* Pilih Periode */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 12 }]}>PERIODE</Text>
        <View style={styles.toggleRow}>
          {PERIODS.map(p => (
            <Pressable
              key={p.value}
              onPress={() => handlePeriodSelect(p.value)}
              style={[styles.toggleBtn, {
                backgroundColor: period === p.value ? colors.primary : colors.card,
                borderColor: period === p.value ? colors.primary : colors.border,
              }]}
            >
              <Text style={[styles.toggleText, { color: period === p.value ? '#fff' : colors.mutedForeground }]}>
                {p.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Pilih Menu */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 12 }]}>ANALISA</Text>
        <View style={styles.toggleRow}>
          {MENUS.map(m => (
            <Pressable
              key={m.value}
              onPress={() => setMenu(m.value)}
              style={[styles.toggleBtn, {
                backgroundColor: menu === m.value ? colors.primary : colors.card,
                borderColor: menu === m.value ? colors.primary : colors.border,
              }]}
            >
              <Text style={[styles.toggleText, { color: menu === m.value ? '#fff' : colors.mutedForeground }]}>
                {m.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Listing info — tampil kalau pilih Sejak Listing */}
        {period === 'all' && (
          <View style={[styles.listingInfo, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {listingLoading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : listingInfo ? (
              <>
                <Text style={[styles.listingTitle, { color: colors.foreground }]}>
                  📅 Listed {listingInfo.ageLabel} lalu
                </Text>
                <Text style={[styles.listingDate, { color: colors.mutedForeground }]}>
                  Sejak {listingInfo.listingDate} · {listingInfo.h1Candles.toLocaleString()} candle H1
                </Text>
              </>
            ) : symbol.trim() ? (
              <Text style={[styles.listingDate, { color: colors.mutedForeground }]}>
                Ketuk "Sejak Listing" lagi atau masukkan symbol untuk fetch info listing
              </Text>
            ) : (
              <Text style={[styles.listingDate, { color: colors.mutedForeground }]}>
                Masukkan symbol untuk lihat info listing
              </Text>
            )}
          </View>
        )}

        {/* Warning loading time */}
        <Text style={[styles.warningText, { color: colors.mutedForeground }]}>
          {period === 'all'
            ? '⏱ Backtest sejak listing bisa membutuhkan beberapa menit'
            : '⏱ Backtest 6 bulan / 1 tahun membutuhkan 30-60 detik'}
        </Text>

        {/* Tombol Run */}
        <Pressable
          onPress={runBacktest}
          disabled={loading || !symbol.trim()}
          style={({ pressed }) => [
            styles.runBtn,
            { backgroundColor: loading || !symbol.trim() ? `${colors.primary}60` : colors.primary, opacity: pressed ? 0.85 : 1 }
          ]}
        >
          {loading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.runBtnText}>▶ Jalankan Backtest</Text>
          }
        </Pressable>

        {/* Error */}
        {error && (
          <View style={[styles.errorBox, { backgroundColor: `${colors.bearish}15`, borderColor: colors.bearish }]}>
            <Feather name="alert-circle" size={16} color={colors.bearish} />
            <Text style={[styles.errorText, { color: colors.bearish }]}>{error}</Text>
          </View>
        )}

        {/* Loading state */}
        {loading && (
          <View style={styles.loadingBox}>
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
              Mengambil data historis dan menjalankan simulasi...
            </Text>
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
              Ini mungkin membutuhkan waktu beberapa puluh detik.
            </Text>
          </View>
        )}

        {/* Hasil */}
        {result && !loading && (
          <>
            {/* Info periode */}
            <View style={[styles.infoBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.infoText, { color: colors.foreground }]}>
                {result.symbol.replace('USDT', '/USDT')} · {result.period}
              </Text>
              <Text style={[styles.infoSub, { color: colors.mutedForeground }]}>
                {result.totalCandles} candle H1 · {result.timestamp}
              </Text>
            </View>

            {/* Hasil Sniper */}
            {result.sniperResult && (
              <MenuResult
                title="Menu 2 — Sniper Entry"
                result={result.sniperResult}
                colors={colors}
              />
            )}

            {/* Hasil Breakout */}
            {result.breakoutResult && (
              <MenuResult
                title="Menu 4 — Scalping SMC M30→M5"
                result={result.breakoutResult}
                colors={colors}
              />
            )}

            {/* Perbandingan */}
            {result.comparison && (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>⚖ Perbandingan</Text>
                <View style={styles.compareRow}>
                  <View style={styles.compareItem}>
                    <Text style={[styles.compareLabel, { color: colors.mutedForeground }]}>Sniper</Text>
                    <WinRateBadge rate={result.comparison.sniperWinRate} colors={colors} />
                  </View>
                  <Text style={[styles.compareVs, { color: colors.mutedForeground }]}>VS</Text>
                  <View style={styles.compareItem}>
                    <Text style={[styles.compareLabel, { color: colors.mutedForeground }]}>Breakout</Text>
                    <WinRateBadge rate={result.comparison.breakoutWinRate} colors={colors} />
                  </View>
                </View>
                <View style={[styles.compareResult, { borderTopColor: colors.border }]}>
                  <Text style={[styles.compareResultText, { color: colors.foreground }]}>
                    {result.comparison.better === 'equal'
                      ? '⚡ Performa setara'
                      : result.comparison.better === 'sniper'
                      ? '🎯 Sniper lebih profitable'
                      : '⚡ Breakout lebih profitable'}
                  </Text>
                  <Text style={[styles.compareFilterText, { color: colors.mutedForeground }]}>
                    Filter paling berpengaruh: {result.comparison.mostImpactfulFilter}
                  </Text>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },

  inputBox: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12, gap: 8, marginBottom: 4 },
  inputText: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', letterSpacing: 0.5 },

  sectionLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.2, marginBottom: 8 },

  toggleRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  toggleBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  toggleText: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  warningText: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 8, marginBottom: 12 },
  listingInfo: { borderRadius: 10, borderWidth: 1, padding: 12, marginTop: 8, gap: 4 },
  listingTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  listingDate: { fontSize: 12, fontFamily: 'Inter_400Regular' },

  runBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  runBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  errorBox: { flexDirection: 'row', gap: 8, borderWidth: 1, borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 12 },
  errorText: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1 },

  loadingBox: { alignItems: 'center', gap: 6, padding: 20 },
  loadingText: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center' },

  infoBar: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 12 },
  infoText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  infoSub: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },

  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  cardSub: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  winRateMain: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  winRateSub: { fontSize: 11, fontFamily: 'Inter_400Regular' },

  barBg: { height: 6, borderRadius: 3, marginVertical: 10, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },

  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  breakdownLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', flex: 1 },
  breakdownRight: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  breakdownItem: { alignItems: 'center', gap: 2 },
  breakdownSub: { fontSize: 9, fontFamily: 'Inter_400Regular' },
  breakdownDiff: { fontSize: 11, fontFamily: 'Inter_700Bold', minWidth: 32, textAlign: 'right' },

  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontFamily: 'Inter_700Bold' },

  causeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  causeRank: { fontSize: 11, fontFamily: 'Inter_700Bold', width: 20 },
  causeName: { fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1 },
  causePct: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  recRow: { borderLeftWidth: 3, paddingLeft: 10, paddingVertical: 8, marginBottom: 6, borderRadius: 4 },
  recText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },

  compareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, paddingVertical: 12 },
  compareItem: { alignItems: 'center', gap: 6 },
  compareLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  compareVs: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  compareResult: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, alignItems: 'center', gap: 4 },
  compareResultText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  compareFilterText: { fontSize: 11, fontFamily: 'Inter_400Regular' },
});