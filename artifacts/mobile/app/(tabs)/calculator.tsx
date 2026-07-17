import React, { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
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

import { useLocalSearchParams } from 'expo-router';

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatPrice(price: number): string {
  if (price >= 10000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(6);
}

function formatPnl(pnl: number): string {
  const abs = Math.abs(pnl);
  const sign = pnl >= 0 ? '+' : '-';
  return `${sign}${abs.toFixed(2)}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface SectionProps { title: string; children: React.ReactNode }
function Section({ title, children }: SectionProps) {
  const colors = useColors();
  return (
    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{title}</Text>
      {children}
    </View>
  );
}

interface RowProps { label: string; value: string; valueColor?: string; mono?: boolean }
function Row({ label, value, valueColor, mono }: RowProps) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: valueColor ?? colors.foreground, fontFamily: mono ? 'Inter_600SemiBold' : 'Inter_500Medium' }]}>
        {value}
      </Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CalculatorScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    entryPrice?: string;
    stopLoss?: string;
    takeProfit1?: string;
    takeProfit2?: string;
    symbol?: string;
    direction?: string;
  }>();

  const roundParam = (val: string | undefined): string => {
    const n = parseFloat(val ?? '');
    if (isNaN(n)) return '';
    if (n >= 10000) return n.toFixed(2);
    if (n >= 100) return n.toFixed(2);
    if (n >= 1) return n.toFixed(4);
    return n.toFixed(6);
  };
  const [entryStr, setEntryStr] = useState(() => roundParam(params.entryPrice));
  const [slStr, setSlStr] = useState(() => roundParam(params.stopLoss));
  const [tp1Str, setTp1Str] = useState(() => roundParam(params.takeProfit1));
  const [tp2Str, setTp2Str] = useState(() => roundParam(params.takeProfit2));
  const entryPrice = parseFloat(entryStr) || 0;
  const stopLoss = parseFloat(slStr) || 0;
  const takeProfit1 = parseFloat(tp1Str) || 0;
  const takeProfit2 = parseFloat(tp2Str) || 0;
  const symbol = params.symbol ?? '';
  const bias = (params.direction === 'bearish' ? 'bearish' : 'bullish') as 'bullish' | 'bearish';
  const base = symbol.replace('USDT', '') || 'Coin';
  const hasPrices = entryPrice > 0 && stopLoss > 0 && takeProfit1 > 0;

  // ─── Input state ────────────────────────────────────────────────────────────
  const [modalStr, setModalStr] = useState('100');
  const [contractsStr, setContractsStr] = useState('');
  const [leverageStr, setLeverageStr] = useState('10');
  const [marginMode, setMarginMode] = useState<'cross' | 'isolated'>('isolated');
  const [lastEdited, setLastEdited] = useState<'modal' | 'contracts'>('modal');

  const [side, setSide] = useState<'long' | 'short'>(bias === 'bullish' ? 'long' : 'short');
  const leverage = Math.min(Math.max(parseFloat(leverageStr) || 1, 1), 125);
  const showLevWarning = leverage > 20;

  // ─── Handlers ───────────────────────────────────────────────────────────────
  const handleModalChange = useCallback((val: string) => {
    setModalStr(val);
    setLastEdited('modal');
    const m = parseFloat(val);
    if (!isNaN(m) && m > 0 && entryPrice > 0 && leverage > 0) {
      setContractsStr(((m * leverage) / entryPrice).toFixed(6));
    }
  }, [entryPrice, leverage]);

  const handleContractsChange = useCallback((val: string) => {
    setContractsStr(val);
    setLastEdited('contracts');
    const c = parseFloat(val);
    if (!isNaN(c) && c > 0 && entryPrice > 0 && leverage > 0) {
      setModalStr(((c * entryPrice) / leverage).toFixed(2));
    }
  }, [entryPrice, leverage]);

  const handleLeverageChange = useCallback((val: string) => {
    setLeverageStr(val);
    const lev = Math.min(Math.max(parseFloat(val) || 1, 1), 125);
    if (lastEdited === 'modal') {
      const m = parseFloat(modalStr);
      if (!isNaN(m) && m > 0 && entryPrice > 0) {
        setContractsStr(((m * lev) / entryPrice).toFixed(6));
      }
    } else {
      const c = parseFloat(contractsStr);
      if (!isNaN(c) && c > 0 && entryPrice > 0) {
        setModalStr(((c * entryPrice) / lev).toFixed(2));
      }
    }
  }, [lastEdited, modalStr, contractsStr, entryPrice]);

  // ─── Calculations ────────────────────────────────────────────────────────────
  const calc = useMemo(() => {
    if (!hasPrices || leverage <= 0) return null;

    const modal = parseFloat(modalStr) || 0;
    if (modal <= 0) return null;

    const contracts = (modal * leverage) / entryPrice;
    const initialMargin = modal; // = (contracts * entryPrice) / leverage
    const dir = side === 'long' ? 1 : -1;
    const mmRate = 0.005;

    const pnlSL  = contracts * (stopLoss - entryPrice) * dir;
    const pnlTP1 = contracts * (takeProfit1 - entryPrice) * dir;
    const pnlTP2 = contracts * (takeProfit2 - entryPrice) * dir;

    const roeSL  = initialMargin > 0 ? (pnlSL  / initialMargin) * 100 : 0;
    const roeTP1 = initialMargin > 0 ? (pnlTP1 / initialMargin) * 100 : 0;
    const roeTP2 = initialMargin > 0 ? (pnlTP2 / initialMargin) * 100 : 0;

    const liqCross = bias === 'bullish'
      ? entryPrice * (1 - 1 / leverage)
      : entryPrice * (1 + 1 / leverage);
    const liqIsolated = bias === 'bullish'
      ? entryPrice * (1 - 1 / leverage + mmRate)
      : entryPrice * (1 + 1 / leverage - mmRate);
    const liqPrice = marginMode === 'cross' ? liqCross : liqIsolated;

    const liqDist = Math.abs((liqPrice - entryPrice) / entryPrice) * 100;

    return { contracts, initialMargin, pnlSL, pnlTP1, pnlTP2, roeSL, roeTP1, roeTP2, liqPrice, liqDist };
  }, [modalStr, leverage, entryPrice, stopLoss, takeProfit1, takeProfit2, bias, marginMode, hasPrices]);

  const liqColor = !calc ? colors.mutedForeground
    : calc.liqDist > 20 ? colors.bullish
    : calc.liqDist > 10 ? colors.warning
    : colors.bearish;

  const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const bottomPadding = insets.bottom + 80;

  return (
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Kalkulator PnL</Text>
        <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
          {symbol ? symbol.replace('USDT', '/USDT') : 'Futures Perpetual'}
        </Text>
      </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
        >
        {/* ── LONG / SHORT TOGGLE ────────────────────────────────────────── */}
        <View style={[styles.sideToggle, { borderColor: colors.border }]}>
          <Pressable
            onPress={() => setSide('long')}
            style={[styles.sideBtn, side === 'long' && { backgroundColor: '#16A34A' }]}
          >
            <Text style={[styles.sideBtnText, { color: side === 'long' ? '#fff' : colors.mutedForeground }]}>
              ↗ Long
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSide('short')}
            style={[styles.sideBtn, side === 'short' && { backgroundColor: '#DC2626' }]}
          >
            <Text style={[styles.sideBtnText, { color: side === 'short' ? '#fff' : colors.mutedForeground }]}>
              ↘ Short
            </Text>
          </Pressable>
        </View>

        {/* ── LEVERAGE ───────────────────────────────────────────────────── */}
        <Section title="LEVERAGE">
          <View style={styles.levRow}>
            <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Leverage</Text>
            <View style={styles.inputRight}>
              <TextInput
                style={[styles.inputField, { color: colors.foreground }]}
                keyboardType="number-pad"
                value={leverageStr}
                onChangeText={handleLeverageChange}
                placeholder="10"
                placeholderTextColor={colors.mutedForeground}
                selectTextOnFocus
              />
              <Text style={[styles.inputUnit, { color: colors.mutedForeground }]}>x</Text>
            </View>
          </View>
          <View style={styles.presets}>
            {[1, 5, 10, 20, 50, 125].map(p => (
              <Pressable
                key={p}
                onPress={() => handleLeverageChange(String(p))}
                style={[styles.presetBtn, {
                  borderColor: colors.border,
                  backgroundColor: leverage === p ? colors.primary : colors.background,
                }]}
              >
                <Text style={[styles.presetText, { color: leverage === p ? '#fff' : colors.mutedForeground }]}>
                  {p}x
                </Text>
              </Pressable>
            ))}
          </View>
          {showLevWarning && (
            <Text style={{ fontSize: 12, color: '#F59E0B', marginTop: 8 }}>
              ⚠ Leverage tinggi meningkatkan risiko likuidasi
            </Text>
          )}
        </Section>

        {/* ── INPUT ─────────────────────────────────────────────────────── */}
        <Section title="INPUT">
          {/* Modal USDT */}
          <View style={[styles.inputRow, { borderColor: colors.border }]}>
            <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Modal</Text>
            <View style={styles.inputRight}>
              <TextInput
                style={[styles.inputField, { color: colors.foreground }]}
                keyboardType="decimal-pad"
                value={modalStr}
                onChangeText={handleModalChange}
                placeholder="100"
                placeholderTextColor={colors.mutedForeground}
                selectTextOnFocus
              />
              <Text style={[styles.inputUnit, { color: colors.mutedForeground }]}>USDT</Text>
            </View>
          </View>

          <View style={[styles.orDivider, { borderColor: colors.border }]}>
            <View style={[styles.orLine, { backgroundColor: colors.border }]} />
            <Text style={[styles.orText, { color: colors.mutedForeground }]}>atau</Text>
            <View style={[styles.orLine, { backgroundColor: colors.border }]} />
          </View>

          {/* Ukuran Posisi */}
          <View style={[styles.inputRow, { borderColor: colors.border }]}>
            <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Ukuran Posisi</Text>
            <View style={styles.inputRight}>
              <TextInput
                style={[styles.inputField, { color: colors.foreground }]}
                keyboardType="decimal-pad"
                value={contractsStr}
                onChangeText={handleContractsChange}
                placeholder="0.000000"
                placeholderTextColor={colors.mutedForeground}
                selectTextOnFocus
              />
              <Text style={[styles.inputUnit, { color: colors.mutedForeground }]}>{base}</Text>
            </View>
          </View>

          <Text style={[styles.inputHint, { color: colors.mutedForeground }]}>
            Isi salah satu — yang lain dihitung otomatis
          </Text>

          {/* Margin mode toggle */}
          <View style={styles.marginRow}>
            <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Mode Margin</Text>
            <View style={[styles.toggleGroup, { backgroundColor: colors.background, borderColor: colors.border }]}>
              {(['isolated', 'cross'] as const).map((mode) => (
                <Pressable
                  key={mode}
                  onPress={() => setMarginMode(mode)}
                  style={[
                    styles.toggleBtn,
                    marginMode === mode && { backgroundColor: colors.primary },
                  ]}
                >
                  <Text style={[
                    styles.toggleText,
                    { color: marginMode === mode ? colors.primaryForeground : colors.mutedForeground },
                  ]}>
                    {mode === 'isolated' ? 'Isolated' : 'Cross'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Section>

        {/* ── HARGA (editable) ───────────────────────────────────────────── */}
        <Section title="HARGA">
          <View style={[styles.inputRow, { borderColor: colors.border }]}>
            <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>Entry</Text>
            <View style={styles.inputRight}>
              <TextInput
                style={[styles.inputField, { color: colors.foreground }]}
                keyboardType="decimal-pad"
                value={entryStr}
                onChangeText={setEntryStr}
                placeholder="0"
                placeholderTextColor={colors.mutedForeground}
                selectTextOnFocus
              />
            </View>
          </View>
          <View style={[styles.inputRow, { borderColor: colors.border }]}>
            <Text style={[styles.inputLabel, { color: colors.bearish }]}>Stop Loss</Text>
            <View style={styles.inputRight}>
              <TextInput
                style={[styles.inputField, { color: colors.bearish }]}
                keyboardType="decimal-pad"
                value={slStr}
                onChangeText={setSlStr}
                placeholder="0"
                placeholderTextColor={colors.mutedForeground}
                selectTextOnFocus
              />
            </View>
          </View>
          <View style={[styles.inputRow, { borderColor: colors.border }]}>
            <Text style={[styles.inputLabel, { color: colors.bullish }]}>Take Profit 1</Text>
            <View style={styles.inputRight}>
              <TextInput
                style={[styles.inputField, { color: colors.bullish }]}
                keyboardType="decimal-pad"
                value={tp1Str}
                onChangeText={setTp1Str}
                placeholder="0"
                placeholderTextColor={colors.mutedForeground}
                selectTextOnFocus
              />
            </View>
          </View>
          <View style={[styles.inputRow, { borderColor: colors.border }]}>
            <Text style={[styles.inputLabel, { color: colors.gold }]}>Take Profit 2</Text>
            <View style={styles.inputRight}>
              <TextInput
                style={[styles.inputField, { color: colors.gold }]}
                keyboardType="decimal-pad"
                value={tp2Str}
                onChangeText={setTp2Str}
                placeholder="0"
                placeholderTextColor={colors.mutedForeground}
                selectTextOnFocus
              />
            </View>
          </View>
          <Text style={[styles.inputHint, { color: colors.mutedForeground }]}>
            Edit manual untuk simulasi skenario berbeda
          </Text>
        </Section>

        {/* ── HASIL ──────────────────────────────────────────────────────── */}
        <Section title="HASIL">
          {!hasPrices ? (
            <View style={styles.noPriceBox}>
              <Text style={[styles.noPriceText, { color: colors.mutedForeground }]}>
                Masukkan data harga terlebih dahulu
              </Text>
            </View>
          ) : !calc ? (
            <View style={styles.noPriceBox}>
              <Text style={[styles.noPriceText, { color: colors.mutedForeground }]}>
                Masukkan modal dan leverage untuk menghitung
              </Text>
            </View>
          ) : (
            <>
              {/* Position size & margin */}
              <View style={[styles.resultCard, { backgroundColor: colors.surfaceMid ?? colors.background, borderColor: colors.border }]}>
                <View style={styles.resultCardRow}>
                  <View style={styles.resultCardItem}>
                    <Text style={[styles.resultCardLabel, { color: colors.mutedForeground }]}>Ukuran Posisi</Text>
                    <Text style={[styles.resultCardValue, { color: colors.foreground }]}>
                      {calc.contracts.toFixed(6)}
                    </Text>
                    <Text style={[styles.resultCardUnit, { color: colors.mutedForeground }]}>{base}</Text>
                  </View>
                  <View style={[styles.resultCardDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.resultCardItem}>
                    <Text style={[styles.resultCardLabel, { color: colors.mutedForeground }]}>Initial Margin</Text>
                    <Text style={[styles.resultCardValue, { color: colors.foreground }]}>
                      {calc.initialMargin.toFixed(2)}
                    </Text>
                    <Text style={[styles.resultCardUnit, { color: colors.mutedForeground }]}>USDT</Text>
                  </View>
                </View>
              </View>

              {/* Liquidation price */}
              <View style={[styles.liqBox, { borderColor: liqColor, backgroundColor: `${liqColor}12` }]}>
                <View style={styles.liqLeft}>
                  <Text style={[styles.liqLabel, { color: colors.mutedForeground }]}>
                    Liq. Price ({marginMode === 'cross' ? 'Cross' : 'Isolated'})
                  </Text>
                  <Text style={[styles.liqDist, { color: liqColor }]}>
                    Jarak {calc.liqDist.toFixed(1)}% dari entry
                    {calc.liqDist > 20 ? ' ✓ Aman' : calc.liqDist > 10 ? ' ⚠ Perhatikan' : ' ⚠ Berbahaya'}
                  </Text>
                </View>
                <Text style={[styles.liqPrice, { color: liqColor }]}>
                  {formatPrice(calc.liqPrice)}
                </Text>
              </View>

              {/* PnL rows */}
              <View style={[styles.pnlCard, { borderColor: colors.border }]}>
                {/* SL */}
                <View style={styles.pnlRow}>
                  <View style={styles.pnlLeft}>
                    <View style={[styles.pnlDot, { backgroundColor: colors.bearish }]} />
                    <Text style={[styles.pnlLabel, { color: colors.foreground }]}>STOP LOSS</Text>
                  </View>
                  <View style={styles.pnlRight}>
                    <Text style={[styles.pnlUsdt, { color: colors.bearish }]}>
                      {formatPnl(calc.pnlSL)} USDT
                    </Text>
                    <Text style={[styles.pnlRoe, { color: colors.bearish }]}>
                      ({calc.roeSL.toFixed(2)}%)
                    </Text>
                  </View>
                </View>

                <View style={[styles.divider, { backgroundColor: colors.border }]} />

                {/* TP1 */}
                <View style={styles.pnlRow}>
                  <View style={styles.pnlLeft}>
                    <View style={[styles.pnlDot, { backgroundColor: colors.bullish }]} />
                    <Text style={[styles.pnlLabel, { color: colors.foreground }]}>TAKE PROFIT 1</Text>
                  </View>
                  <View style={styles.pnlRight}>
                    <Text style={[styles.pnlUsdt, { color: colors.bullish }]}>
                      {formatPnl(calc.pnlTP1)} USDT
                    </Text>
                    <Text style={[styles.pnlRoe, { color: colors.bullish }]}>
                      ({calc.roeTP1.toFixed(2)}%)
                    </Text>
                  </View>
                </View>

                {takeProfit2 > 0 && (
                  <>
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    {/* TP2 */}
                    <View style={styles.pnlRow}>
                      <View style={styles.pnlLeft}>
                        <View style={[styles.pnlDot, { backgroundColor: colors.gold }]} />
                        <Text style={[styles.pnlLabel, { color: colors.foreground }]}>TAKE PROFIT 2</Text>
                      </View>
                      <View style={styles.pnlRight}>
                        <Text style={[styles.pnlUsdt, { color: colors.gold }]}>
                          {formatPnl(calc.pnlTP2)} USDT
                        </Text>
                        <Text style={[styles.pnlRoe, { color: colors.gold }]}>
                          ({calc.roeTP2.toFixed(2)}%)
                        </Text>
                      </View>
                    </View>
                  </>
                )}
              </View>
            </>
          )}
        </Section>

        {/* Disclaimer */}
        <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
          * Kalkulasi menggunakan formula Binance Futures. Hanya untuk referensi. Bukan saran finansial.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  headerSub: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 },

  section: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.5,
    marginBottom: 12,
  },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
  },
  rowLabel: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  rowValue: { fontSize: 13 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },

  // Inputs
  inputRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  inputLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1, marginRight: 8 },
  inputRight: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  inputField: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'right',
    minWidth: 80,
    maxWidth: 160,
    flexShrink: 1,
    letterSpacing: -0.3,
  },
  inputUnit: { fontSize: 13, fontFamily: 'Inter_500Medium', minWidth: 40 },
  inputHint: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 6, textAlign: 'center' },

  orDivider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 4 },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth },
  orText: { fontSize: 12, fontFamily: 'Inter_400Regular' },

  marginRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  toggleGroup: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  toggleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  toggleText: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  warningText: { fontSize: 12, fontFamily: 'Inter_500Medium', flex: 1 },

  // No price state
  noPriceBox: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  noPriceText: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },

  // Results
  resultCard: {
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
    overflow: 'hidden',
  },
  resultCardRow: { flexDirection: 'row' },
  resultCardItem: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  resultCardDivider: { width: StyleSheet.hairlineWidth },
  resultCardLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', letterSpacing: 0.5, marginBottom: 4 },
  resultCardValue: { fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  resultCardUnit: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },

  liqBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  liqLeft: { flex: 1 },
  liqLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', letterSpacing: 0.5 },
  liqDist: { fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 2 },
  liqPrice: { fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },

  pnlCard: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  pnlRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pnlLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pnlDot: { width: 8, height: 8, borderRadius: 4 },
  pnlLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.3 },
  pnlRight: { alignItems: 'flex-end' },
  pnlUsdt: { fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  pnlRoe: { fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 1 },

  disclaimer: { fontSize: 10, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 4, lineHeight: 16 },

  // Long/Short toggle
  sideToggle: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
    height: 46,
    marginBottom: 12,
  },
  sideBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sideBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  // Leverage presets
  levRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  presets: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  presetBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1 },
  presetText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
});
