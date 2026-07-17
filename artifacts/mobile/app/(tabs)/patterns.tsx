import React, { useCallback, useState } from 'react';
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
import { useLocalSearchParams } from 'expo-router';
import { useGetPatterns } from '@workspace/api-client-react';
import type { TFPatterns, PatternResult } from '@workspace/api-client-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_PATTERNS = [
  'Bull Flag',
  'Bear Flag',
  'Ascending Triangle',
  'Descending Triangle',
  'Symmetrical Triangle',
  'Pennant',
  'Double Top',
  'Double Bottom',
  'Head & Shoulders',
  'Inverse H&S',
  'Rising Wedge',
  'Falling Wedge',
] as const;

const TIMEFRAMES = ['H4', 'H1', 'M30', 'M15', 'M5'] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPatternMeta(name: string): { category: string; direction: string } {
  const continuation = ['Bull Flag', 'Bear Flag', 'Ascending Triangle', 'Descending Triangle', 'Symmetrical Triangle', 'Pennant'];
  const bullish = ['Bull Flag', 'Ascending Triangle', 'Double Bottom', 'Inverse H&S', 'Falling Wedge'];
  return {
    category: continuation.includes(name) ? 'continuation' : 'reversal',
    direction: bullish.includes(name) ? 'bullish' : 'bearish',
  };
}

function findPattern(tf: TFPatterns, name: string): PatternResult | undefined {
  return tf.patterns.find(p => p.name === name);
}

// ─── Cell ─────────────────────────────────────────────────────────────────────

function PatternCell({
  pattern,
  colors,
  onPress,
}: {
  pattern: PatternResult | undefined;
  colors: ReturnType<typeof useColors>;
  onPress?: () => void;
}) {
  if (!pattern) {
    return (
      <View style={[styles.cell, styles.cellEmpty]}>
        <Text style={[styles.cellDash, { color: colors.border }]}>—</Text>
      </View>
    );
  }

  const confColor =
    pattern.confidence === 'high'
      ? colors.bullish
      : pattern.confidence === 'medium'
      ? colors.gold
      : colors.mutedForeground;

  const dirIcon = pattern.direction === 'bullish' ? '▲' : '▼';
  const dirColor = pattern.direction === 'bullish' ? colors.bullish : colors.bearish;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.cell,
        styles.cellActive,
        {
          backgroundColor: `${confColor}15`,
          borderColor: confColor,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[styles.cellIcon, { color: dirColor }]}>{dirIcon}</Text>
      <View style={[styles.cellDot, { backgroundColor: confColor }]} />
    </Pressable>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function PatternDetail({
  pattern,
  tf,
  patternName,
  colors,
  onClose,
}: {
  pattern: PatternResult;
  tf: string;
  patternName: string;
  colors: ReturnType<typeof useColors>;
  onClose: () => void;
}) {
  const confColor =
    pattern.confidence === 'high'
      ? colors.bullish
      : pattern.confidence === 'medium'
      ? colors.gold
      : colors.mutedForeground;
  const dirColor = pattern.direction === 'bullish' ? colors.bullish : colors.bearish;
  const catLabel = pattern.category === 'continuation' ? 'Continuation' : 'Reversal';

  return (
    <View style={[styles.detailOverlay]}>
      <Pressable style={styles.detailBackdrop} onPress={onClose} />
      <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ScrollView showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ padding: 20, gap: 12 }}>
        {/* Header */}
        <View style={styles.detailHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.detailName, { color: colors.foreground }]}>{patternName}</Text>
            <Text style={[styles.detailTf, { color: colors.mutedForeground }]}>Timeframe: {tf}</Text>
          </View>
          <Pressable onPress={onClose} style={styles.detailClose}>
            <Feather name="x" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {/* Badges */}
        <View style={styles.detailBadges}>
          <View style={[styles.badge, { borderColor: dirColor, backgroundColor: `${dirColor}15` }]}>
            <Text style={[styles.badgeText, { color: dirColor }]}>
              {pattern.direction === 'bullish' ? '▲ BULLISH' : '▼ BEARISH'}
            </Text>
          </View>
          <View style={[styles.badge, { borderColor: colors.mutedForeground, backgroundColor: `${colors.mutedForeground}10` }]}>
            <Text style={[styles.badgeText, { color: colors.mutedForeground }]}>{catLabel.toUpperCase()}</Text>
          </View>
          <View style={[styles.badge, { borderColor: confColor, backgroundColor: `${confColor}15` }]}>
            <Text style={[styles.badgeText, { color: confColor }]}>
              {pattern.confidence.toUpperCase()} CONF
            </Text>
          </View>
        </View>

        {/* Description */}
        <View style={[styles.detailDesc, { backgroundColor: `${confColor}08`, borderLeftColor: confColor }]}>
          <Text style={[styles.detailDescText, { color: colors.foreground }]}>{pattern.description}</Text>
        </View>

        {/* Arti pattern */}
        <Text style={[styles.detailImplication, { color: colors.mutedForeground }]}>
          {pattern.category === 'continuation'
            ? `Pattern ini mengindikasikan trend saat ini kemungkinan akan berlanjut ke arah ${pattern.direction === 'bullish' ? 'atas' : 'bawah'}.`
            : `Pattern ini mengindikasikan kemungkinan pembalikan arah ke ${pattern.direction === 'bullish' ? 'atas (bullish)' : 'bawah (bearish)'}.`
          }
        </Text>
      </ScrollView>
    </View>
    </View>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend({ colors }: { colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[styles.legend, { borderColor: colors.border }]}>
      <View style={styles.legendItem}>
        <View style={[styles.legendDot, { backgroundColor: colors.bullish }]} />
        <Text style={[styles.legendText, { color: colors.mutedForeground }]}>High</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendDot, { backgroundColor: colors.gold }]} />
        <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Medium</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendDot, { backgroundColor: colors.mutedForeground }]} />
        <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Low</Text>
      </View>
      <View style={styles.legendItem}>
        <Text style={[styles.legendArrow, { color: colors.bullish }]}>▲</Text>
        <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Bullish</Text>
      </View>
      <View style={styles.legendItem}>
        <Text style={[styles.legendArrow, { color: colors.bearish }]}>▼</Text>
        <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Bearish</Text>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PatternsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ symbol?: string }>();
  const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const bottomPadding = insets.bottom + 80;

  const [inputSymbol, setInputSymbol] = useState(params.symbol ?? '');
  const [symbol, setSymbol] = useState(params.symbol ?? '');

  const handleSearch = useCallback(() => {
    if (!inputSymbol.trim()) return;
    const raw = inputSymbol.trim().toUpperCase();
    const sym = raw.endsWith('USDT') ? raw : `${raw}USDT`;
    setSymbol(sym);
  }, [inputSymbol]);

  const { data, isLoading, isError, refetch } = useGetPatterns(
    { symbol },
    { query: { enabled: !!symbol, staleTime: 120_000 } }
  );

  const [selected, setSelected] = useState<{ pattern: PatternResult; tf: string; name: string } | null>(null);

  // Summary: berapa TF punya pattern
  const activeTFs = data?.timeframes.filter(tf => tf.patterns.length > 0).length ?? 0;
  const totalPatterns = data?.timeframes.reduce((acc, tf) => acc + tf.patterns.length, 0) ?? 0;

  // Group patterns by category
  const continuationPatterns = ALL_PATTERNS.filter(p => getPatternMeta(p).category === 'continuation');
  const reversalPatterns = ALL_PATTERNS.filter(p => getPatternMeta(p).category === 'reversal');

  const renderGroup = (group: readonly string[], label: string) => (
    <>
      {/* Category label row */}
      <View style={[styles.categoryRow, { backgroundColor: `${colors.mutedForeground}08` }]}>
        <Text style={[styles.categoryLabel, { color: colors.mutedForeground }]}>{label}</Text>
        {TIMEFRAMES.map(tf => (
          <Text key={tf} style={[styles.tfHeader, { color: colors.mutedForeground }]}>{tf}</Text>
        ))}
      </View>

      {group.map(patternName => {
        const meta = getPatternMeta(patternName);
        const nameColor = meta.direction === 'bullish' ? colors.bullish : colors.bearish;
        const hasAny = data?.timeframes.some(tf => findPattern(tf, patternName));

        return (
          <View
            key={patternName}
            style={[
              styles.patternRow,
              { borderBottomColor: colors.border },
              hasAny && { backgroundColor: `${colors.primary}05` },
            ]}
          >
            {/* Pattern name */}
            <View style={styles.patternNameCell}>
              <Text style={[styles.patternName, { color: hasAny ? nameColor : colors.mutedForeground }]} numberOfLines={1}>
                {patternName}
              </Text>
            </View>

            {/* TF cells */}
            {TIMEFRAMES.map(tf => {
              const tfData = data?.timeframes.find(t => t.tf === tf);
              const p = tfData ? findPattern(tfData, patternName) : undefined;
              return (
                <View key={tf} style={styles.cellWrapper}>
                  <PatternCell
                    pattern={p}
                    colors={colors}
                    onPress={p ? () => setSelected({ pattern: p, tf, name: patternName }) : undefined}
                  />
                </View>
              );
            })}
          </View>
        );
      })}
    </>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={styles.headerTop}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Chart Pattern</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              Multi-Timeframe Pattern Detector
            </Text>
          </View>
          {data && (
            <Pressable onPress={() => refetch()} style={styles.refreshBtn}>
              <Feather name="refresh-cw" size={15} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>

        {/* Summary strip */}
        {data && !isLoading && (
          <View style={[styles.summaryStrip, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: colors.foreground }]}>{totalPatterns}</Text>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Pattern</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: colors.foreground }]}>{activeTFs}/5</Text>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>TF Aktif</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Update</Text>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]} numberOfLines={1}>
                {data.timestamp.split(' ')[0] + ' ' + data.timestamp.split(' ')[1]}
              </Text>
            </View>
          </View>
        )}

        {/* Search bar */}
        <View style={styles.searchRow}>
          <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="activity" size={15} color={colors.primary} />
            <TextInput
              style={[styles.inputText, { color: colors.foreground }]}
              placeholder="Masukkan pair (BTCUSDT)"
              placeholderTextColor={colors.mutedForeground}
              value={inputSymbol}
              onChangeText={setInputSymbol}
              autoCapitalize="characters"
              returnKeyType="search"
              onSubmitEditing={handleSearch}
            />
            {inputSymbol.length > 0 && (
              <Pressable onPress={() => setInputSymbol('')}>
                <Feather name="x" size={14} color={colors.mutedForeground} />
              </Pressable>
            )}
          </View>
          <Pressable
            onPress={handleSearch}
            style={({ pressed }) => [styles.analyzeBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={[styles.analyzeBtnText, { color: colors.primaryForeground }]}>Cari</Text>
          </Pressable>
        </View>
      </View>

      {/* Content */}
      {!symbol ? (
        <View style={styles.center}>
          <Feather name="activity" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Masukkan Symbol</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Ketik pair di atas atau buka dari halaman Sniper Entry
          </Text>
        </View>
      ) : isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Mendeteksi pattern...
          </Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            H4 → H1 → M30 → M15 → M5
          </Text>
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={40} color={colors.bearish} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Gagal memuat</Text>
          <Pressable onPress={() => refetch()} style={[styles.retryBtn, { backgroundColor: colors.primary }]}>
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : data ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: bottomPadding }}
          showsVerticalScrollIndicator={false}
        >
          <Legend colors={colors} />

          <ScrollView horizontal showsHorizontalScrollIndicator={true}>
            <View>
              {/* Column headers */}
              <View style={[styles.columnHeaders, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
                <View style={styles.patternNameCell}>
                  <Text style={[styles.colHeaderText, { color: colors.mutedForeground }]}>PATTERN</Text>
                </View>
                {TIMEFRAMES.map(tf => (
                  <View key={tf} style={styles.cellWrapper}>
                    <Text style={[styles.colHeaderText, { color: colors.mutedForeground, textAlign: 'center' }]}>{tf}</Text>
                  </View>
                ))}
              </View>

              {renderGroup(continuationPatterns, 'CONTINUATION')}
              {renderGroup(reversalPatterns, 'REVERSAL')}
            </View>
          </ScrollView>

          {totalPatterns === 0 && (
            <View style={styles.noPatternBox}>
              <Feather name="check-circle" size={28} color={colors.mutedForeground} />
              <Text style={[styles.noPatternText, { color: colors.mutedForeground }]}>
                Tidak ada pattern terdeteksi saat ini
              </Text>
            </View>
          )}
        </ScrollView>
      ) : null}

      {/* Detail overlay */}
      {selected && (
        <PatternDetail
          pattern={selected.pattern}
          tf={selected.tf}
          patternName={selected.name}
          colors={colors}
          onClose={() => setSelected(null)}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CELL_SIZE = 48;
const NAME_WIDTH = 120;

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  headerTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  refreshBtn: { padding: 6, marginTop: 4 },

  summaryStrip: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  summaryItem: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  summaryValue: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  summaryLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 1 },
  summaryDivider: { width: StyleSheet.hairlineWidth },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', textAlign: 'center', marginTop: 8 },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, marginTop: 8 },
  retryText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  // Legend
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendArrow: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  legendText: { fontSize: 10, fontFamily: 'Inter_400Regular' },

  // Grid
  columnHeaders: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  colHeaderText: { fontSize: 9, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8 },

  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  categoryLabel: {
    width: NAME_WIDTH,
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1,
  },
  tfHeader: {
    width: CELL_SIZE,
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
    letterSpacing: 0.5,
  },

  patternRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
  },
  patternNameCell: { width: NAME_WIDTH, paddingRight: 8 },
  patternName: { fontSize: 11, fontFamily: 'Inter_500Medium', lineHeight: 14 },
  cellWrapper: { width: CELL_SIZE, alignItems: 'center' },

  cell: {
    width: 34,
    height: 34,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellEmpty: {},
  cellActive: { borderWidth: 1 },
  cellDash: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  cellIcon: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  cellDot: { width: 5, height: 5, borderRadius: 3, position: 'absolute', bottom: 5, right: 5 },

  noPatternBox: { alignItems: 'center', gap: 8, padding: 32 },
  noPatternText: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center' },

  // Detail overlay
  detailOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', zIndex: 100 },
  detailBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  detailCard: {
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  detailName: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  detailTf: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  detailClose: { padding: 4 },
  detailBadges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  detailDesc: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    paddingVertical: 10,
    borderRadius: 4,
  },
  detailDescText: { fontSize: 13, fontFamily: 'Inter_500Medium', lineHeight: 20 },
  detailImplication: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },

  // Search bar
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 10 },
  inputBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 8,
  },
  inputText: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', letterSpacing: 0.5 },
  analyzeBtn: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  analyzeBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
