import React, { useState } from 'react';

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
import { BacktestLoading } from '@/components/animated/BacktestLoading';
import { MENU_COLORS } from '@/constants/theme';

const ACCENT = MENU_COLORS.backtest;
const PERIOD_CANDLES: Record<string, number> = { '1m': 720, '3m': 2160, '6m': 4320, '1y': 8640, '2y': 17280, '3y': 25920 };

// ─── Types ────────────────────────────────────────────────────────────────────
// GANTI TOTAL (request user, "sekalian diperbarui" — backend sekarang Python
// vectorized, REPLIKASI PERSIS 3 skill live: Structural, Skill 15M, Counter
// Scalping). Struktur hasil lebih SEDERHANA dari versi lama (gak ada
// breakdown "with/without ChoCH/pattern/dst" — itu basis sistem LAMA yang
// udah ditinggalkan jauh sebelum sesi ini).

interface BacktestTrade {
  bias: 'bullish' | 'bearish';
  result: 'WIN' | 'LOSE';
  entry_price: number;
  stop_loss: number;
  take_profit1: number;
  entry_time: number;
  exit_time: number;
}

interface PyBacktestSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  trades: BacktestTrade[];
}

interface BacktestResult {
  symbol: string;
  period: string;
  timestamp: string;
  structuralResult: PyBacktestSummary | null;
  scalping15mResult: PyBacktestSummary | null;
  counterScalpingResult: PyBacktestSummary | null;
  elapsedSeconds: number;
}

// ─── Components ───────────────────────────────────────────────────────────────

function WinRateBadge({ rate, colors }: { rate: number; colors: ReturnType<typeof useColors> }) {
  const color = rate >= 55 ? colors.bullish : rate >= 40 ? colors.gold : colors.bearish;
  return (
    <View style={[styles.badge, { backgroundColor: `${color}20`, borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{rate.toFixed(1)}%</Text>
    </View>
  );
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function TradeRow({ trade, colors }: { trade: BacktestTrade; colors: ReturnType<typeof useColors> }) {
  const resultColor = trade.result === 'WIN' ? colors.bullish : colors.bearish;
  const biasColor = trade.bias === 'bullish' ? colors.bullish : colors.bearish;
  return (
    <View style={[styles.tradeRow, { borderColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: biasColor }}>
            {trade.bias === 'bullish' ? '▲ LONG' : '▼ SHORT'}
          </Text>
          <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground }}>
            {formatTime(trade.entry_time)}
          </Text>
        </View>
        <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 2 }}>
          Entry {trade.entry_price.toFixed(4)} · SL {trade.stop_loss.toFixed(4)} · TP {trade.take_profit1.toFixed(4)}
        </Text>
      </View>
      <View style={[styles.tradeResultBadge, { backgroundColor: `${resultColor}20`, borderColor: resultColor }]}>
        <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: resultColor }}>{trade.result}</Text>
      </View>
    </View>
  );
}

function MenuResult({ title, result, colors }: {
  title: string;
  result: PyBacktestSummary;
  colors: ReturnType<typeof useColors>;
}) {
  const [expanded, setExpanded] = useState(false);
  const winColor = result.winRate >= 55 ? colors.bullish : result.winRate >= 40 ? colors.gold : colors.bearish;

  if (result.totalTrades === 0) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 4 }}>
          Gak ada sinyal ketemu di periode ini.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable onPress={() => setExpanded(!expanded)} style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>{result.totalTrades} sinyal</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={[styles.winRateMain, { color: winColor }]}>{result.winRate.toFixed(1)}%</Text>
          <Text style={[styles.winRateSub, { color: colors.mutedForeground }]}>{result.wins}W / {result.losses}L</Text>
        </View>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedForeground} style={{ marginLeft: 8 }} />
      </Pressable>

      {expanded && (
        <>
          <View style={[styles.barBg, { backgroundColor: colors.border }]}>
            <View style={[styles.barFill, { width: `${Math.min(result.winRate, 100)}%`, backgroundColor: winColor }]} />
          </View>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>DAFTAR TRADE ({result.trades.length})</Text>
          {result.trades.slice().reverse().map((t, i) => <TradeRow key={i} trade={t} colors={colors} />)}
        </>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

const PERIODS = [
  { label: '1 Bulan', value: '1m' as const },
  { label: '3 Bulan', value: '3m' as const },
  { label: '6 Bulan', value: '6m' as const },
  { label: '1 Tahun', value: '1y' as const },
  { label: '2 Tahun', value: '2y' as const },
  { label: '3 Tahun', value: '3y' as const },
];

const MENUS = [
  { label: 'Structural', value: 'structural' as const },
  { label: 'Skill 15M', value: 'scalping15m' as const },
  { label: 'Counter Scalping', value: 'counter_scalping' as const },
  { label: 'Semua', value: 'both' as const },
];

export default function BacktestScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = embedded ? 12 : insets.top + (Platform.OS === 'web' ? 67 : 0);
  const bottomPadding = insets.bottom + 80;

  const [symbol, setSymbol] = useState('');
  const [period, setPeriod] = useState<'1m' | '3m' | '6m' | '1y' | '2y' | '3y'>('3m');
  const [menu, setMenu] = useState<'structural' | 'scalping15m' | 'counter_scalping' | 'both'>('both');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePeriodSelect = (val: '1m' | '3m' | '6m' | '1y' | '2y' | '3y') => {
    setPeriod(val);
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
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Backtesting</Text>
        <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>Analisa performa sinyal historis — powered by Python (pandas/numpy)</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }} showsVerticalScrollIndicator={false}>
        {/* Input symbol */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PAIR</Text>
        <TextInput
          value={symbol}
          onChangeText={setSymbol}
          placeholder="BTCUSDT"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="characters"
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
        />

        {/* Pilih Periode */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 12 }]}>PERIODE</Text>
        <View style={styles.toggleRow}>
          {PERIODS.map(p => (
            <Pressable
              key={p.value}
              onPress={() => handlePeriodSelect(p.value)}
              style={[styles.toggleBtn, {
                backgroundColor: period === p.value ? ACCENT : colors.card,
                borderColor: period === p.value ? ACCENT : colors.border,
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
                backgroundColor: menu === m.value ? ACCENT : colors.card,
                borderColor: menu === m.value ? ACCENT : colors.border,
              }]}
            >
              <Text style={[styles.toggleText, { color: menu === m.value ? '#fff' : colors.mutedForeground }]}>
                {m.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.warningText, { color: colors.mutedForeground }]}>
          {period === '2y' || period === '3y'
            ? '⏱ Backtest 2-3 tahun bisa membutuhkan beberapa menit'
            : '⏱ Backtest 6 bulan / 1 tahun butuh sekitar 10-30 detik'}
        </Text>

        <Pressable
          onPress={runBacktest}
          disabled={loading || !symbol.trim()}
          style={({ pressed }) => [
            styles.runBtn,
            { backgroundColor: loading || !symbol.trim() ? `${ACCENT}60` : ACCENT, opacity: pressed ? 0.85 : 1 }
          ]}
        >
          {loading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.runBtnText}>▶ Jalankan Backtest</Text>
          }
        </Pressable>

        {error && (
          <View style={[styles.errorBox, { backgroundColor: `${colors.bearish}15`, borderColor: colors.bearish }]}>
            <Feather name="alert-circle" size={16} color={colors.bearish} />
            <Text style={[styles.errorText, { color: colors.bearish }]}>{error}</Text>
          </View>
        )}

        {loading && (
          <BacktestLoading totalCandles={PERIOD_CANDLES[period] ?? 8640} accentColor={ACCENT} />
        )}

        {result && !loading && (
          <>
            <View style={[styles.infoBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.infoText, { color: colors.foreground }]}>
                {result.symbol.replace('USDT', '/USDT')} · {result.period}
              </Text>
              <Text style={[styles.infoSub, { color: colors.mutedForeground }]}>
                {result.timestamp} · diproses {result.elapsedSeconds}s
              </Text>
            </View>

            {result.structuralResult && (
              <MenuResult title="Scalping — Structural (M30)" result={result.structuralResult} colors={colors} />
            )}
            {result.scalping15mResult && (
              <MenuResult title="Scalping — Skill 15M" result={result.scalping15mResult} colors={colors} />
            )}
            {result.counterScalpingResult && (
              <MenuResult title="Counter Scalping — Multi-Factor Score (H1)" result={result.counterScalpingResult} colors={colors} />
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
  headerTitle: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  sectionLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5, marginBottom: 6 },
  input: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, fontFamily: 'Inter_600SemiBold',
  },
  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toggleBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  toggleText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  warningText: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 10, fontStyle: 'italic' },
  runBtn: { marginTop: 16, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  runBtnText: { color: '#fff', fontSize: 15, fontFamily: 'Inter_700Bold' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, padding: 12, borderRadius: 10, borderWidth: 1 },
  errorText: { fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1 },
  infoBar: { marginTop: 16, padding: 12, borderRadius: 10, borderWidth: 1 },
  infoText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  infoSub: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  card: { marginTop: 10, padding: 14, borderRadius: 12, borderWidth: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  cardSub: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  winRateMain: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  winRateSub: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  barBg: { height: 6, borderRadius: 3, marginTop: 12, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  tradeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth,
  },
  tradeResultBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
});