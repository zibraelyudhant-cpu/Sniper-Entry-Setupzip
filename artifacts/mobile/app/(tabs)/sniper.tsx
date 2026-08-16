import React, { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator,
  Animated,
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
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useGetSmcAnalysis, useGetSniperScan, getGetSmcAnalysisQueryKey, getGetSniperScanQueryKey } from '@workspace/api-client-react';
import type { SniperResult } from '@workspace/api-client-react';
import { journalSave, type JournalEntry } from './journal-helpers';
import { AnimatedCard } from '@/components/animated/AnimatedCard';
import { DirectionalCard } from '@/components/animated/DirectionalCard';
import { AnimatedTabSwitcher } from '@/components/animated/AnimatedTabSwitcher';
import { ScanLoading } from '@/components/animated/ScanLoading';
import { LogResultBadge } from '@/components/animated/LogResultBadge';
import { FuturisticBackground } from '@/components/animated/FuturisticBackground';
import { MENU_COLORS } from '@/constants/theme';
import { RecentPerformanceCard } from '@/components/RecentPerformanceCard';
import { MenuJournalSummary } from '@/components/MenuJournalSummary';
import { MarketStructureV2Card } from '@/components/MarketStructureV2Card';
import { TFBreakdownTable } from '@/components/TFBreakdownTable';

const ACCENT = MENU_COLORS.sniper;

// Module-level cache (BUKAN React state) — nitip data hasil Scan pas pindah ke
// Analisa lewat router.push (URL params cuma bisa bawa string, gak bisa full
// object). Di-set sesaat sebelum navigasi, di-consume sekali di AnalisaTab.
let pinnedScanCache: { symbol: string; data: SniperResult } | null = null;

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatPrice(price: number, decimals?: number): string {
  let d = decimals;
  if (d === undefined) {
    if (price >= 10000) d = 0;
    else if (price >= 1000) d = 1;
    else if (price >= 100) d = 2;
    else if (price >= 10) d = 3;
    else if (price >= 1) d = 4;
    else if (price >= 0.1) d = 4;
    else if (price >= 0.01) d = 5;
    else d = 6;
  }
  return price.toFixed(d).replace('.', ',');
}

function formatSymbolClean(symbol: string): string {
  return symbol.replace('USDT', '/USDT');
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
}

// ─── Section Components ───────────────────────────────────────────────────────

interface SectionProps { title: string; children: React.ReactNode; tint?: string; index?: number }
function Section({ title, children, tint, index = 0 }: SectionProps) {
  const colors = useColors();
  return (
    <AnimatedCard index={index}>
      <View style={[styles.section, tint ? { backgroundColor: `${tint}0F`, borderColor: `${tint}38` } : { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{title}</Text>
        {children}
      </View>
    </AnimatedCard>
  );
}

interface RowProps { label: string; value: string; valueColor?: string; icon?: React.ReactNode }
function Row({ label, value, valueColor, icon }: RowProps) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon}
        <Text style={[styles.rowValue, { color: valueColor ?? colors.foreground }]}>{value}</Text>
      </View>
    </View>
  );
}

// ─── Status Screens ───────────────────────────────────────────────────────────

/**
 * ProbabilitySection — CATATAN: dead code (gak dipake di manapun), udah dead
 * dari sebelum sesi ini, dibiarin sesuai kebiasaan (gak hapus kode tanpa izin
 * eksplisit buat ITU).
 */
function ProbabilitySection({ data, colors }: { data: SniperResult; colors: ReturnType<typeof useColors> }) {
  const prob = data.profitProbability ?? 0;
  const badgeColor = prob >= 75 ? colors.bullish : prob >= 50 ? colors.gold : colors.bearish;
  const label = prob >= 75 ? 'Tinggi' : prob >= 50 ? 'Sedang' : 'Rendah';

  return (
    <Section title="PROBABILITAS PROFIT" tint="#FBBF24" index={1}>
      {/* Badge utama */}
      <View style={[styles.probHeader, { backgroundColor: `${badgeColor}15`, borderColor: badgeColor }]}>
        <Text style={[styles.probEmoji]}>🎯</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.probLabel, { color: colors.mutedForeground }]}>Probabilitas Profit</Text>
          <Text style={[styles.probValue, { color: badgeColor }]}>{prob}%</Text>
        </View>
        <View style={[styles.probBadge, { backgroundColor: `${badgeColor}25`, borderColor: badgeColor }]}>
          <Text style={[styles.probBadgeText, { color: badgeColor }]}>{label}</Text>
        </View>
      </View>

      {/* List faktor */}
      {(data.probabilityFactors ?? []).map((factor, i) => {
        const isPassed = factor.startsWith('✅');
        return (
          <View key={i} style={[styles.probRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.probRowText, { color: isPassed ? colors.foreground : colors.mutedForeground }]}>
              {factor}
            </Text>
          </View>
        );
      })}
    </Section>
  );
}

/**
 * ReadyScreen — mode "Sniper" (structural). REWRITE (request user): dulu nampilin
 * scoring dari VWAP/Volume Profile/Dow Theory/H4 Confluence/RSI Divergence H1,
 * sekarang mode Sniper udah full breakout+retest (H1 struktur -> M15 eksekusi),
 * PERSIS sama alur kayak Menu 4 Skill 15M. Field lama itu udah gak dikirim lagi.
 */
function ReadyScreen({ data, colors }: { data: SniperResult; colors: ReturnType<typeof useColors> }) {
  const isBuy = data.bias === 'bullish';
  const biasColor = isBuy ? colors.bullish : colors.bearish;

  return (
    <>
      <Section title="BREAKOUT + RETEST (H1)" tint="#A78BFA" index={0}>
        <Row
          label="Zona breakout"
          value={`${formatPrice(data.zoneEdgeLower ?? 0)} – ${formatPrice(data.zoneEdgeUpper ?? 0)}`}
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Row label="Breakout terjadi" value={`${data.candlesSinceBreakout ?? 0} candle lalu`} />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Row label="Score (info)" value={`${data.score ?? 0}/${data.maxScore ?? 4}`} />
      </Section>

      <Section title="SNIPER ENTRY SETUP" tint="#A78BFA" index={1}>
        <View style={[styles.entryHeader, { backgroundColor: colors.surfaceMid, borderRadius: 8, padding: 12, marginBottom: 12 }]}>
          <View style={styles.entryHeaderRow}>
            <Text style={[styles.entryLabel, { color: colors.mutedForeground }]}>Harga Saat Ini</Text>
            <Text style={[styles.entryCurrentPrice, { color: colors.foreground }]}>
              {formatPrice(data.currentPrice)}
            </Text>
          </View>
          <Text style={[styles.entryTime, { color: colors.mutedForeground }]}>
            {data.timestamp}
          </Text>
        </View>

        <View style={[styles.directionBadge, { backgroundColor: `${biasColor}18`, borderColor: biasColor }]}>
          <Feather
            name={isBuy ? 'arrow-up-right' : 'arrow-down-right'}
            size={18}
            color={biasColor}
          />
          <Text style={[styles.directionText, { color: biasColor }]}>
            {isBuy ? 'BUY' : 'SELL'}
          </Text>
        </View>

        <View style={[styles.levelsCard, { backgroundColor: colors.surfaceMid, borderColor: colors.border }]}>
          <LevelRow label="ENTRY" price={data.entryPrice ?? 0} color={colors.highlight} colors={colors} big />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <LevelRow label="STOP LOSS" price={data.stopLoss ?? 0} color={colors.bearish} colors={colors} sub="1x ATR H1" />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <LevelRow label="TAKE PROFIT" price={data.takeProfit1 ?? 0} color={colors.bullish} colors={colors} sub={`R:R 1:${data.rr1 ?? 1.5}`} />
        </View>

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
                source: 'sniper',
              },
            });
          }}
          style={({ pressed }) => [
            styles.calcBtn,
            {
              borderColor: colors.mutedForeground,
              backgroundColor: pressed ? `${colors.mutedForeground}15` : 'transparent',
            },
          ]}
        >
          <Feather name="percent" size={15} color={colors.mutedForeground} />
          <Text style={[styles.calcBtnText, { color: colors.mutedForeground }]}>
            Kalkulator PnL
          </Text>
          <Feather name="arrow-right" size={14} color={colors.mutedForeground} style={{ marginLeft: 'auto' }} />
        </Pressable>

        <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
          * Hanya referensi manual. Tidak ada auto-eksekusi.
        </Text>
      </Section>

      {data.filterResults && data.filterResults.length > 0 && (
        <Section title="DETAIL FILTER" tint="#A78BFA" index={2}>
          {data.filterResults.map((f, i) => (
            <Text key={i} style={[styles.filterItem, { color: f.startsWith('✅') ? colors.foreground : colors.mutedForeground }]}>{f}</Text>
          ))}
        </Section>
      )}
    </>
  );
}

/** WaitingScreen — mode Sniper, belum ada breakout valid dalam retest window (24 candle H1). */
/** ApproachingScreen — mode Sniper, breakout udah kejadian, nunggu retest ke zona. */
function SniperApproachingScreen({ data, colors }: { data: SniperResult; colors: ReturnType<typeof useColors> }) {
  const isBuy = data.bias === 'bullish';
  const biasColor = isBuy ? colors.bullish : colors.bearish;
  return (
    <>
      <Section title="SIAP BREAKOUT — NUNGGU RETEST" tint="#FBBF24" index={0}>
        <Row
          label="Zona breakout"
          value={`${formatPrice(data.zoneEdgeLower ?? 0)} – ${formatPrice(data.zoneEdgeUpper ?? 0)}`}
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Row label="Breakout terjadi" value={`${data.candlesSinceBreakout ?? 0} candle lalu`} />
      </Section>

      <Section title="PROYEKSI ENTRY" tint="#FBBF24" index={1}>
        <View style={[styles.directionBadge, { backgroundColor: `${biasColor}18`, borderColor: biasColor }]}>
          <Feather name={isBuy ? 'arrow-up-right' : 'arrow-down-right'} size={18} color={biasColor} />
          <Text style={[styles.directionText, { color: biasColor }]}>{isBuy ? 'BUY' : 'SELL'}</Text>
        </View>
        <View style={[styles.levelsCard, { backgroundColor: colors.surfaceMid, borderColor: colors.border }]}>
          <LevelRow label="ENTRY (proyeksi)" price={data.entryPrice ?? 0} color={colors.highlight} colors={colors} big />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <LevelRow label="STOP LOSS" price={data.stopLoss ?? 0} color={colors.bearish} colors={colors} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <LevelRow label="TAKE PROFIT" price={data.takeProfit1 ?? 0} color={colors.bullish} colors={colors} sub={`R:R 1:${data.rr1 ?? 1.5}`} />
        </View>
        <Text style={[styles.entryTime, { color: colors.mutedForeground, marginTop: 10, fontStyle: 'italic' }]}>
          💡 Angka di atas proyeksi — baru final begitu harga bener-bener retest ke zona.
        </Text>
      </Section>
    </>
  );
}

/**
 * RSI2ReadyScreen — tampilan khusus mode "RSI Connors" (Connors RSI-2). Beda total dari
 * ReadyScreen (structural SMC): gak ada zona OB/FVG, tapi ada RSI(2), posisi vs
 * MA200, ADX, dan MA5 sebagai referensi exit dinamis (versi asli Connors, exit
 * gak fixed di TP tapi pas harga cross balik ke MA5).
 */
function RSI2ReadyScreen({ data, colors }: { data: SniperResult; colors: ReturnType<typeof useColors> }) {
  const isBuy = data.bias === 'bullish';
  const biasColor = isBuy ? colors.bullish : colors.bearish;

  return (
    <>
      <Section title="KONDISI RSI-2" tint="#F472B6" index={0}>
        <Row label="Trend (vs MA150 H1)" value={data.ma150Relation === 'above' ? 'Di atas MA150 ✅' : 'Di bawah MA150 ✅'} valueColor={biasColor} />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Row label="ADX H1" value={`${(data.adxH4 ?? 0).toFixed(1)} (trend kuat)`} />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Row
          label="RSI(2) H1"
          value={`${(data.rsi2Value ?? 0).toFixed(1)} ${isBuy ? '(oversold)' : '(overbought)'}`}
          valueColor={isBuy ? colors.bullish : colors.bearish}
        />
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Row label="MA5 (exit dinamis)" value={formatPrice(data.ma5ExitTarget ?? 0)} />
      </Section>

      <Section title="RSI ENTRY SETUP" tint="#F472B6" index={1}>
        <View style={[styles.entryHeader, { backgroundColor: colors.surfaceMid, borderRadius: 8, padding: 12, marginBottom: 12 }]}>
          <View style={styles.entryHeaderRow}>
            <Text style={[styles.entryLabel, { color: colors.mutedForeground }]}>Harga Saat Ini</Text>
            <Text style={[styles.entryCurrentPrice, { color: colors.foreground }]}>{formatPrice(data.currentPrice)}</Text>
          </View>
          <Text style={[styles.entryTime, { color: colors.mutedForeground }]}>{data.timestamp}</Text>
        </View>

        <View style={[styles.directionBadge, { backgroundColor: `${biasColor}18`, borderColor: biasColor }]}>
          <Feather name={isBuy ? 'arrow-up-right' : 'arrow-down-right'} size={18} color={biasColor} />
          <Text style={[styles.directionText, { color: biasColor }]}>{isBuy ? 'BUY' : 'SELL'}</Text>
        </View>

        <View style={[styles.levelsCard, { backgroundColor: colors.surfaceMid, borderColor: colors.border }]}>
          <LevelRow label="ENTRY (harga sekarang)" price={data.entryPrice ?? 0} color={colors.highlight} colors={colors} big />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <LevelRow label="STOP LOSS" price={data.stopLoss ?? 0} color={colors.bearish} colors={colors} sub="ATR-based" />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <LevelRow label="TAKE PROFIT 1" price={data.takeProfit1 ?? 0} color={colors.bullish} colors={colors} sub="R:R 1:2" />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <LevelRow label="TAKE PROFIT 2" price={data.takeProfit2 ?? 0} color={colors.gold} colors={colors} sub="R:R 1:3" />
        </View>

        {/* Kalkulator PnL button — source 'sniper_rsi2' biar badge di Kalkulator */}
        {/* nunjukin "RSI Connors", bukan ke-generalisir jadi "Sniper" doang */}
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
                source: 'sniper_rsi2',
              },
            });
          }}
          style={({ pressed }) => [
            styles.calcBtn,
            {
              borderColor: colors.mutedForeground,
              backgroundColor: pressed ? `${colors.mutedForeground}15` : 'transparent',
            },
          ]}
        >
          <Feather name="percent" size={15} color={colors.mutedForeground} />
          <Text style={[styles.calcBtnText, { color: colors.mutedForeground }]}>
            Kalkulator PnL
          </Text>
          <Feather name="arrow-right" size={14} color={colors.mutedForeground} style={{ marginLeft: 'auto' }} />
        </Pressable>

        <Text style={[styles.entryTime, { color: colors.mutedForeground, marginTop: 10, fontStyle: 'italic' }]}>
          💡 Versi asli Connors RSI-2: exit begitu harga cross balik ke MA5 ({formatPrice(data.ma5ExitTarget ?? 0)}), bukan nunggu TP fixed. TP1/TP2 di atas cuma referensi tambahan.
        </Text>
      </Section>

      {data.filterResults && data.filterResults.length > 0 && (
        <Section title="DETAIL FILTER" tint="#F472B6" index={2}>
          {data.filterResults.map((f, i) => (
            <Text key={i} style={[styles.filterItem, { color: f.startsWith('✅') ? colors.foreground : colors.mutedForeground }]}>{f}</Text>
          ))}
        </Section>
      )}
    </>
  );
}

interface LevelRowProps {
  label: string;
  price: number;
  color: string;
  colors: ReturnType<typeof useColors>;
  sub?: string;
  big?: boolean;
}
function LevelRow({ label, price, color, colors, sub, big }: LevelRowProps) {
  return (
    <View style={styles.levelRow}>
      <View>
        <Text style={[styles.levelLabel, { color: colors.mutedForeground, fontSize: big ? 13 : 11 }]}>
          {label}
        </Text>
        {sub && <Text style={[styles.levelSub, { color: colors.mutedForeground }]}>{sub}</Text>}
      </View>
      <Text style={[styles.levelPrice, { color, fontSize: big ? 20 : 16, fontFamily: big ? 'Inter_700Bold' : 'Inter_600SemiBold' }]}>
        {formatPrice(price)}
      </Text>
    </View>
  );
}

interface MetaItemProps { label: string; value: string; valueColor?: string; colors: ReturnType<typeof useColors> }
function MetaItem({ label, value, valueColor, colors }: MetaItemProps) {
  return (
    <View style={[styles.metaItem, { backgroundColor: colors.surfaceMid, borderColor: colors.border }]}>
      <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.metaValue, { color: valueColor ?? colors.foreground }]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

interface TimingItemProps { label: string; value: string; colors: ReturnType<typeof useColors> }
function TimingItem({ label, value, colors }: TimingItemProps) {
  return (
    <View style={styles.timingItem}>
      <Text style={[styles.timingValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.timingLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}


// ─── Main Screen ──────────────────────────────────────────────────────────────


// ─── Probability Badge ────────────────────────────────────────────────────────

function ProbBadge({ prob, colors }: { prob: number; colors: ReturnType<typeof useColors> }) {
  const color = prob >= 75 ? colors.bullish : prob >= 50 ? colors.gold : colors.bearish;
  const label = prob >= 75 ? 'TINGGI' : prob >= 50 ? 'SEDANG' : 'RENDAH';
  const [displayProb, setDisplayProb] = useState(0);
  const animValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    animValue.setValue(0);
    const listener = animValue.addListener(({ value }) => setDisplayProb(Math.round(value)));
    Animated.timing(animValue, { toValue: prob, duration: 500, useNativeDriver: false }).start();
    return () => animValue.removeListener(listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prob]);

  return (
    <View style={[scanStyles.probBadge, { borderColor: color, backgroundColor: `${color}18` }]}>
      <Text style={[scanStyles.probBadgeText, { color }]}>{displayProb}% {label}</Text>
    </View>
  );
}

// ─── Scan Coin Card ───────────────────────────────────────────────────────────

function ScanCoinCard({ coin, onPress, colors, index = 0 }: { coin: SniperResult; onPress: () => void; colors: ReturnType<typeof useColors>; index?: number }) {
  const base = coin.symbol.replace('USDT', '');
  const isBuy = coin.bias === 'bullish';
  const biasColor = isBuy ? colors.bullish : colors.bearish;
  const isRsi2 = coin.mode === 'rsi2';
  // Normalisasi confidence — kedua mode sekarang pakai score/maxScore
  // (profitProbability udah dihapus dari mode Sniper).
  const prob = ((coin.score ?? 0) / (coin.maxScore || 1)) * 100;
  const modeColor = isRsi2 ? '#F472B6' : ACCENT;

  return (
    <AnimatedCard index={index} onPress={onPress}>
    <DirectionalCard bias={coin.bias} style={scanStyles.card}>
      {/* Row 1: symbol + prob badge */}
      <View style={scanStyles.cardRow1}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
            <Text style={[scanStyles.cardBase, { color: colors.foreground }]}>{base}</Text>
            <Text style={[scanStyles.cardQuote, { color: colors.mutedForeground }]}>/USDT</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <View style={[scanStyles.biasBadge, { backgroundColor: `${biasColor}18`, borderColor: biasColor }]}>
              <Text style={[scanStyles.biasBadgeText, { color: biasColor }]}>
                {isBuy ? '▲ BUY' : '▼ SELL'}
              </Text>
            </View>
            <View style={[scanStyles.zoneBadge, { borderColor: modeColor, backgroundColor: `${modeColor}18` }]}>
              <Text style={[scanStyles.zoneBadgeText, { color: modeColor }]}>{isRsi2 ? '🎯 RSI Connors' : '🎯 Sniper'}</Text>
            </View>
            {coin.zoneType && (
              <View style={[scanStyles.zoneBadge, { borderColor: colors.border }]}>
                <Text style={[scanStyles.zoneBadgeText, { color: colors.mutedForeground }]}>{coin.zoneType}</Text>
              </View>
            )}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          {coin.status === 'approaching'
            ? (
              <View style={[scanStyles.probBadge, { borderColor: colors.gold, backgroundColor: `${colors.gold}18` }]}>
                <Text style={[scanStyles.probBadgeText, { color: colors.gold }]}>NUNGGU RETEST</Text>
              </View>
            )
            : <ProbBadge prob={prob} colors={colors} />
          }
          <Text style={[scanStyles.cardPrice, { color: colors.foreground }]}>{formatPrice(coin.currentPrice)}</Text>
        </View>
        <Feather name="chevron-right" size={14} color={colors.mutedForeground} style={{ marginLeft: 4 }} />
      </View>

      {/* Row 2: kondisi — beda per mode */}
      <View style={[scanStyles.condRow, { borderTopColor: colors.border }]}>
        {isRsi2 ? (
          <>
            <View style={scanStyles.condItem}>
              <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>ADX H1</Text>
              <Text style={[scanStyles.condValue, { color: colors.foreground }]}>{(coin.adxH4 ?? 0).toFixed(0)}</Text>
            </View>
            <View style={[scanStyles.condDivider, { backgroundColor: colors.border }]} />
            <View style={scanStyles.condItem}>
              <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>RSI(2)</Text>
              <Text style={[scanStyles.condValue, { color: isBuy ? colors.bullish : colors.bearish }]}>{(coin.rsi2Value ?? 0).toFixed(0)}</Text>
            </View>
          </>
        ) : (
          <>
            <View style={scanStyles.condItem}>
              <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>Breakout</Text>
              <Text style={[scanStyles.condValue, { color: colors.foreground }]}>
                {coin.candlesSinceBreakout !== undefined ? `${coin.candlesSinceBreakout}c lalu` : '—'}
              </Text>
            </View>
            <View style={[scanStyles.condDivider, { backgroundColor: colors.border }]} />
            <View style={scanStyles.condItem}>
              <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>Score</Text>
              <Text style={[scanStyles.condValue, { color: colors.foreground }]}>
                {coin.score ?? 0}/{coin.maxScore ?? 4}
              </Text>
            </View>
          </>
        )}
        <View style={[scanStyles.condDivider, { backgroundColor: colors.border }]} />
        <View style={scanStyles.condItem}>
          <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>ENTRY</Text>
          <Text style={[scanStyles.condValue, { color: colors.foreground }]}>
            {coin.entryPrice ? formatPrice(coin.entryPrice) : '—'}
          </Text>
        </View>
        <View style={[scanStyles.condDivider, { backgroundColor: colors.border }]} />
        <View style={scanStyles.condItem}>
          <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>SL</Text>
          <Text style={[scanStyles.condValue, { color: colors.bearish }]}>
            {coin.stopLoss ? formatPrice(coin.stopLoss) : '—'}
          </Text>
        </View>
        <View style={[scanStyles.condDivider, { backgroundColor: colors.border }]} />
        <View style={scanStyles.condItem}>
          <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>TP1</Text>
          <Text style={[scanStyles.condValue, { color: colors.bullish }]}>
            {coin.takeProfit1 ? formatPrice(coin.takeProfit1) : '—'}
          </Text>
        </View>
        <View style={[scanStyles.condDivider, { backgroundColor: colors.border }]} />
        <View style={scanStyles.condItem}>
          <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>TP2</Text>
          <Text style={[scanStyles.condValue, { color: colors.gold }]}>
            {coin.takeProfit2 ? formatPrice(coin.takeProfit2) : '—'}
          </Text>
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

function ScanTab({ colors }: { colors: ReturnType<typeof useColors> }) {
  const insets = useSafeAreaInsets();
  const bottomPadding = insets.bottom + 80;
  // isFetching (bukan isLoading) — fix bug audit: isLoading React Query cuma
  // true pas fetch PERTAMA kali, jadi tombol SCAN NOW kliatan "gak ngerespon"
  // pas refetch (isLoading tetep false walau lagi proses di background).
  const { data, isLoading, isFetching, isError, refetch } = useGetSniperScan({
    query: { queryKey: getGetSniperScanQueryKey(), staleTime: 5 * 60 * 1000 },
  });

  const handleCoinPress = useCallback((coin: SniperResult) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pinnedScanCache = { symbol: coin.symbol, data: coin };
    router.push({
      pathname: '/(tabs)/sniper',
      params: { tab: 'analisa', symbol: coin.symbol, mode: coin.mode ?? 'sniper' },
    });
  }, []);

  if (isLoading) {
    return (
      <View style={scanStyles.center}>
        <ScanLoading label="SCANNING SNIPER" accentColor={ACCENT} />
        <Text style={[scanStyles.loadingSub, { color: colors.mutedForeground }]}>2 Skill — Structural & RSI-2 (H1→M15)</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={scanStyles.center}>
        <Feather name="wifi-off" size={36} color={colors.mutedForeground} />
        <Text style={[scanStyles.emptyTitle, { color: colors.foreground }]}>Gagal memuat data</Text>
        <Pressable onPress={() => refetch()} disabled={isFetching} style={[scanStyles.retryBtn, { backgroundColor: ACCENT, opacity: isFetching ? 0.6 : 1 }]}>
          {isFetching
            ? <ActivityIndicator size="small" color={colors.primaryForeground} />
            : <Text style={[scanStyles.retryText, { color: colors.primaryForeground }]}>Coba Lagi</Text>
          }
        </Pressable>
      </View>
    );
  }

  const coins = data?.coins ?? [];
  const fetchedAt = data ? new Date((data as any).fetchedAt ?? Date.now()).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : null;

  if (coins.length === 0) {
    return (
      <View style={scanStyles.center}>
        <Feather name="crosshair" size={36} color={colors.mutedForeground} />
        <Text style={[scanStyles.emptyTitle, { color: colors.foreground }]}>Tidak ada setup valid</Text>
        <Text style={[scanStyles.emptySub, { color: colors.mutedForeground }]}>
          Tidak ada koin dengan probabilitas ≥ 30% saat ini.
        </Text>
        <Pressable onPress={() => refetch()} disabled={isFetching} style={[scanStyles.retryBtn, { backgroundColor: ACCENT, opacity: isFetching ? 0.6 : 1 }]}>
          {isFetching
            ? <ActivityIndicator size="small" color={colors.primaryForeground} />
            : <Text style={[scanStyles.retryText, { color: colors.primaryForeground }]}>Scan Ulang</Text>
          }
        </Pressable>
      </View>
    );
  }

  // Confidence dinormalisasi — kedua mode sekarang pakai score/maxScore
  // (profitProbability udah dihapus dari mode Sniper).
  const confidenceOf = (c: SniperResult) => ((c.score ?? 0) / (c.maxScore || 1)) * 100;

  // Fix bug (ketemu user, "koin ada tapi keliatan kosong"): status 'approaching'
  // (breakout udah kejadian, nunggu retest) SELALU score=0 — konfirmasi
  // tambahan baru dihitung SETELAH harga masuk zona retest. Kalau dipaksa
  // masuk sistem grup 3-tier (Tinggi/Sedang/Rendah, minimal 30%), dia gak
  // pernah masuk grup manapun (0% < 30%) — ADA di data tapi RAIB di layar.
  // Fix: approaching dipisah jadi grup sendiri, gak pake sistem skor persentase
  // sama sekali (emang belum ada apa-apa buat dinilai di tahap ini).
  const approaching = coins.filter(c => c.status === 'approaching');
  const readyCoins = coins.filter(c => c.status === 'ready');

  // Group by probability tier (khusus status 'ready', yang beneran punya skor)
  const high = readyCoins.filter(c => confidenceOf(c) >= 75);
  const mid = readyCoins.filter(c => confidenceOf(c) >= 50 && confidenceOf(c) < 75);
  const low = readyCoins.filter(c => confidenceOf(c) >= 30 && confidenceOf(c) < 50);

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        {fetchedAt && <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground }}>Update: {fetchedAt} WIB</Text>}
        <ScanNowButton onPress={() => refetch()} isLoading={isFetching} colors={colors} />
      </View>

      {approaching.length > 0 && (
        <>
          <Text style={[scanStyles.groupHeader, { color: colors.gold }]}>🔵 SIAP BREAKOUT — NUNGGU RETEST</Text>
          {[...approaching]
            .sort((a, b) => (a.candlesSinceBreakout ?? 999) - (b.candlesSinceBreakout ?? 999))
            .map((c, i) => <ScanCoinCard key={c.symbol} coin={c} colors={colors} index={i} onPress={() => handleCoinPress(c)} />)}
        </>
      )}
      {high.length > 0 && (
        <>
          <Text style={[scanStyles.groupHeader, { color: colors.bullish }]}>🟢 PROBABILITAS TINGGI (≥75%)</Text>
          {high.map((c, i) => <ScanCoinCard key={c.symbol} coin={c} colors={colors} index={i} onPress={() => handleCoinPress(c)} />)}
        </>
      )}
      {mid.length > 0 && (
        <>
          <Text style={[scanStyles.groupHeader, { color: colors.gold }]}>🟡 PROBABILITAS SEDANG (50–74%)</Text>
          {mid.map((c, i) => <ScanCoinCard key={c.symbol} coin={c} colors={colors} index={i} onPress={() => handleCoinPress(c)} />)}
        </>
      )}
      {low.length > 0 && (
        <>
          <Text style={[scanStyles.groupHeader, { color: colors.mutedForeground }]}>🔴 PROBABILITAS RENDAH (30–49%)</Text>
          {low.map((c, i) => <ScanCoinCard key={c.symbol} coin={c} colors={colors} index={i} onPress={() => handleCoinPress(c)} />)}
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
  cardPrice: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  biasBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  biasBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 },
  zoneBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  zoneBadgeText: { fontSize: 8, fontFamily: 'Inter_500Medium' },
  probBadge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  probBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  condRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8, paddingHorizontal: 4 },
  condItem: { flex: 1, alignItems: 'center', gap: 3 },
  condLabel: { fontSize: 7, fontFamily: 'Inter_500Medium', letterSpacing: 0.3 },
  condValue: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  condDivider: { width: StyleSheet.hairlineWidth, marginVertical: 4 },
});

// ─── Analisa Tab ──────────────────────────────────────────────────────────────

function AnalisaTab({ colors, initialSymbol, initialMode }: { colors: ReturnType<typeof useColors>; initialSymbol?: string; initialMode?: 'sniper' | 'rsi2' }) {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ symbol?: string; mode?: string }>();

  const [inputSymbol, setInputSymbol] = useState(initialSymbol ?? params.symbol ?? '');
  const [querySymbol, setQuerySymbol] = useState(initialSymbol ?? params.symbol ?? '');
  // undefined = belum dipilih manual, biar classifier backend yang nentuin otomatis
  const [mode, setMode] = useState<'sniper' | 'rsi2' | undefined>(
    initialMode ?? (params.mode === 'sniper' || params.mode === 'rsi2' ? params.mode : undefined)
  );
  // Ref buat nge-track symbol yang UDAH diproses — biar useEffect di bawah gak
  // nimpa ulang pinnedData yang bener dari initializer pas run pertama (mount).
  const lastProcessedSymbolRef = useRef<string | undefined>(initialSymbol ?? params.symbol);

  // Consume cache SEKALI pas mount awal
  const [pinnedData, setPinnedData] = useState<SniperResult | null>(() => {
    const sym = initialSymbol ?? params.symbol;
    if (pinnedScanCache && pinnedScanCache.symbol === sym) {
      const d = pinnedScanCache.data;
      pinnedScanCache = null;
      return d;
    }
    return null;
  });
  // liveMode=false artinya lagi nampilin data yang DI-KUNCI dari hasil Scan (gak
  // auto-fetch ulang) — biar sinyal gak diem-diem berubah pas user transisi ke
  // Binance buat eksekusi. liveMode=true = data fresh (search manual / refresh eksplisit).
  const [liveMode, setLiveMode] = useState(!pinnedData);

  // Update when navigated from screener — route sama (router.push ke '/sniper'
  // lagi) gak selalu bikin komponen remount, jadi cache dicek ULANG tiap kali
  // params.symbol beneran BERUBAH (bukan pas mount pertama — itu udah dihandle
  // initializer di atas, guard pake ref biar gak diproses dobel).
  useEffect(() => {
    if (!params.symbol || params.symbol === lastProcessedSymbolRef.current) return;
    lastProcessedSymbolRef.current = params.symbol;
    setInputSymbol(params.symbol);
    setQuerySymbol(params.symbol);
    if (pinnedScanCache && pinnedScanCache.symbol === params.symbol) {
      setPinnedData(pinnedScanCache.data);
      setLiveMode(false);
      pinnedScanCache = null;
    } else {
      setPinnedData(null);
      setLiveMode(true); // gak ada cache cocok (misal reload manual) -> langsung live
    }
    if (params.mode === 'sniper' || params.mode === 'rsi2') {
      setMode(params.mode);
    }
  }, [params.symbol, params.mode]);

  const { data: liveData, isLoading, isError, refetch } = useGetSmcAnalysis(
    { symbol: querySymbol, ...(mode ? { mode } : {}) },
    { query: { queryKey: getGetSmcAnalysisQueryKey({ symbol: querySymbol, ...(mode ? { mode } : {}) }), enabled: !!querySymbol && liveMode, staleTime: 120_000 } }
  );
  const data = liveMode ? liveData : pinnedData;

  const handleAnalyze = useCallback(() => {
    const sym = inputSymbol.trim().toUpperCase();
    if (!sym) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setQuerySymbol(sym);
    setLiveMode(true); // search manual = selalu minta data fresh
  }, [inputSymbol]);

  const handleRefreshLive = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLiveMode(true);
  }, []);

  const [savingJournal, setSavingJournal] = useState(false);
  const handleSaveJournal = useCallback(async (d: SniperResult) => {
    if (!d.entryPrice || !d.bias) return;
    setSavingJournal(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const skillLabel = d.mode === 'rsi2' ? 'RSI-2' : 'Sniper';
    const entry: JournalEntry = {
      id: `${Date.now()}_${d.symbol}`,
      symbol: d.symbol, bias: d.bias,
      sourceMenu: 'Sniper Entry', sourceSkill: skillLabel,
      entryPrice: d.entryPrice, stopLoss: d.stopLoss ?? 0, takeProfit1: d.takeProfit1 ?? 0, takeProfit2: d.takeProfit2,
      currentPriceAtSignal: d.currentPrice ?? 0, rr1: d.rr1,
      tfStruktur: 'H1', tfEksekusi: 'M15',
      technicalSnapshot: d.technicalSnapshot as JournalEntry['technicalSnapshot'],
      orderType: 'limit', // Sniper & RSI-2 dua-duanya basis breakout+retest, selalu LIMIT
      btcAligned: d.btcAligned, btcBias: d.btcBias,
      timestamp: d.timestamp ?? '', savedAt: Date.now(), status: 'pending',
    };
    await journalSave(entry);
    setSavingJournal(false);
  }, []);

  const bottomPadding = 60 + (Platform.OS === 'web' ? 34 : insets.bottom);

  return (
    <View style={{ flex: 1 }}>
      {/* Mode Switcher — Sniper (structural SMC) vs RSI (Connors RSI-2 mean reversion) */}
      <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
        <View style={[styles.tabSwitcher, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {(['sniper', 'rsi2'] as const).map((m) => {
            const active = (mode ?? data?.recommendedMode) === m;
            return (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                style={[styles.tabBtn, active && { backgroundColor: `${ACCENT}22` }]}
              >
                <Text style={[styles.tabBtnText, { color: active ? ACCENT : colors.mutedForeground }]}>
                  {m === 'sniper' ? 'Sniper' : 'RSI Connors'}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {data?.recommendedMode && mode && data.recommendedMode !== mode && (
          <Text style={{ fontSize: 10, color: colors.mutedForeground, marginTop: 4, fontStyle: 'italic' }}>
            💡 Classifier rekomendasiin mode "{data.recommendedMode === 'sniper' ? 'Sniper' : 'RSI Connors'}" buat koin ini
          </Text>
        )}
      </View>

      {/* Input bar */}
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
          style={({ pressed }) => [
            styles.analyzeBtn,
            { backgroundColor: ACCENT, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[styles.analyzeBtnText, { color: colors.primaryForeground }]}>Analisa</Text>
        </Pressable>
      </View>

      {/* Content */}
      {!querySymbol ? (
        <View style={styles.emptyState}>
          <Feather name="crosshair" size={52} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Pilih Pair</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Ketik pair di atas atau pilih dari Screener
          </Text>
        </View>
      ) : (liveMode && isLoading) ? (
        <View style={styles.emptyState}>
          <ScanLoading label="H1 → M15" accentColor={ACCENT} coins={[querySymbol || 'BTCUSDT']} />
        </View>
      ) : (liveMode && isError) ? (
        <View style={styles.emptyState}>
          <Feather name="alert-circle" size={40} color={colors.bearish} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Gagal menganalisa</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Periksa nama pair dan koneksi internet
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={[styles.retryBtn, { backgroundColor: ACCENT }]}
          >
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : data ? (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }}
          showsVerticalScrollIndicator={false}
        >
          {/* Banner: data terkunci dari Scan, BUKAN live */}
          {!liveMode && pinnedData && (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12,
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
          )}

          {/* Symbol + timestamp header */}
          <View style={styles.resultHeader}>
            <Text style={[styles.resultSymbol, { color: colors.foreground }]}>
              {formatSymbolClean(data.symbol)}
            </Text>
            <Pressable onPress={() => refetch()} style={styles.refreshBtn}>
              <Feather name="refresh-cw" size={15} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {/* Status "gak guna" (no_trend, no_zone, skip_conditions, not_extreme,
              waiting, expired, error) — SEMUA disatuin jadi 1 pesan generik.
              Cuma 2 status yang beneran actionable: approaching & ready. */}
          {(data.status === 'no_trend' || data.status === 'no_zone' || data.status === 'skip_conditions'
            || data.status === 'not_extreme' || data.status === 'waiting' || data.status === 'expired'
            || data.status === 'error') && (
            <Section title="STATUS">
              <View style={styles.statusBlock}>
                <Feather name={data.status === 'error' ? 'x-circle' : 'info'} size={32} color={data.status === 'error' ? colors.bearish : colors.mutedForeground} />
                <Text style={[styles.statusTitle, { color: colors.foreground }]}>Belum ada sinyal</Text>
                <Text style={[styles.statusMsg, { color: colors.mutedForeground }]}>{data.message}</Text>
              </View>
            </Section>
          )}
          {data.status === 'approaching' && (
            <>
              <SniperApproachingScreen data={data} colors={colors} />
              <View style={{ marginHorizontal: 12 }}>
                <MarketStructureV2Card data={data.marketStructureV2} />
              </View>
              <Pressable onPress={() => handleSaveJournal(data)} disabled={savingJournal}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, margin: 12, marginTop: 0, paddingVertical: 14, borderRadius: 12, backgroundColor: ACCENT, opacity: pressed || savingJournal ? 0.8 : 1 }]}>
                <Feather name="book-open" size={15} color={colors.primaryForeground} />
                <Text style={{ fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.primaryForeground }}>{savingJournal ? 'Menyimpan...' : 'Simpan ke Journal'}</Text>
              </Pressable>
            </>
          )}
          {data.status === 'ready' && (
            <>
              {data.mode === 'rsi2' ? (
                <RSI2ReadyScreen data={data} colors={colors} />
              ) : (
                <ReadyScreen data={data} colors={colors} />
              )}
              <View style={{ marginHorizontal: 12 }}>
                <MarketStructureV2Card data={data.marketStructureV2} />
              </View>
              <Pressable onPress={() => handleSaveJournal(data)} disabled={savingJournal}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, margin: 12, marginTop: 0, paddingVertical: 14, borderRadius: 12, backgroundColor: ACCENT, opacity: pressed || savingJournal ? 0.8 : 1 }]}>
                <Feather name="book-open" size={15} color={colors.primaryForeground} />
                <Text style={{ fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.primaryForeground }}>{savingJournal ? 'Menyimpan...' : 'Simpan ke Journal'}</Text>
              </Pressable>
              <Pressable onPress={() => handleSaveJournal(data)} disabled={savingJournal}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 12, marginTop: 4, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: MENU_COLORS.journal, backgroundColor: `${MENU_COLORS.journal}12`, opacity: pressed || savingJournal ? 0.7 : 1 }]}>
                <Feather name="book-open" size={14} color={MENU_COLORS.journal} />
                <Text style={{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: MENU_COLORS.journal }}>{savingJournal ? 'Menyimpan...' : 'Simpan ke Journal (detail lengkap)'}</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function SniperScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string; symbol?: string; mode?: string }>();
  const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const [activeTab, setActiveTab] = useState<'scan' | 'analisa' | 'ringkasan'>(
    params.tab === 'analisa' ? 'analisa' : params.tab === 'ringkasan' ? 'ringkasan' : 'scan'
  );
  // FIX: useState initializer di atas cuma jalan SEKALI pas mount, gak react ke
  // perubahan params setelahnya. Kalau user udah di halaman Sniper (komponen udah
  // ke-mount) terus tap koin di Scan, router.push cuma re-render params baru
  // TANPA re-mount komponen — activeTab jadi gak pernah switch ke 'analisa'.
  // useEffect ini re-sync activeTab tiap kali params.tab ATAU params.symbol
  // berubah — fix bug ketemu user: dependency SEBELUMNYA cuma [params.tab],
  // jadi kalau user UDAH pernah ke Analisa (params.tab udah 'analisa'), balik
  // manual ke Scan, terus tap koin LAIN, params.tab TETEP 'analisa' (gak
  // "berubah" dari sebelumnya) — effect gak ke-trigger, activeTab gak pernah
  // pindah, keliatan kaya "koin gak bisa diklik" padahal cuma tab-nya yang
  // gak switch.
  useEffect(() => {
    if (params.tab === 'analisa') setActiveTab('analisa');
    else if (params.tab === 'ringkasan') setActiveTab('ringkasan');
  }, [params.tab, params.symbol]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FuturisticBackground accentColor={ACCENT} secondaryColor="#22D3EE" />
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={styles.headerTop}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Sniper Entry</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>2 Skill — Structural & RSI-2 (H1→M15)</Text>
          </View>
          {activeTab === 'scan' && (
            <View style={[styles.liveDot, { backgroundColor: `${colors.bullish}20` }]}>
              <View style={[styles.liveDotInner, { backgroundColor: colors.bullish }]} />
              <Text style={[styles.liveText, { color: colors.bullish }]}>LIVE</Text>
            </View>
          )}
        </View>
        {/* Tab switcher */}
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
        ? <ScanTab colors={colors} />
        : activeTab === 'analisa'
        ? <AnalisaTab colors={colors} initialSymbol={params.symbol ?? undefined} initialMode={params.mode === 'sniper' || params.mode === 'rsi2' ? params.mode : undefined} />
        : <MenuJournalSummary sourceMenu="Sniper Entry" accentColor={ACCENT} />
      }
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  filterItem: { fontSize: 12, fontFamily: 'Inter_400Regular', paddingVertical: 4, lineHeight: 20 },
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
  inputBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  inputText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 0.5,
  },
  analyzeBtn: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  analyzeBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
    marginTop: 8,
  },
  emptySub: {
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
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  resultSymbol: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.3,
  },
  refreshBtn: { padding: 6 },
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
    paddingVertical: 6,
  },
  rowLabel: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  rowValue: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  statusBlock: { alignItems: 'center', gap: 10, paddingVertical: 8 },
  statusTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', textAlign: 'center', marginTop: 4 },
  statusMsg: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  trendRow: { flexDirection: 'row', gap: 10, justifyContent: 'center', marginTop: 12 },
  trendBadge: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    minWidth: 90,
    gap: 2,
  },
  trendBadgeLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', letterSpacing: 0.5 },
  trendBadgeBias: { fontSize: 14, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  trendBadgeStrength: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  skipReason: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 6, paddingHorizontal: 4 },
  skipReasonText: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1, lineHeight: 20 },
  probHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 12 },
  probEmoji: { fontSize: 24 },
  probLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', marginBottom: 2 },
  probValue: { fontSize: 28, fontFamily: 'Inter_700Bold' },
  probBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  probBadgeText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  probRow: { paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  probRowText: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  filterRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1 },
  filterLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  filterDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  entryHeader: {},
  entryHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  entryLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', letterSpacing: 0.5 },
  entryCurrentPrice: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  entryTime: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  directionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 10,
    marginBottom: 12,
  },
  directionText: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: 2 },
  levelsCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  levelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  levelLabel: { fontFamily: 'Inter_500Medium', letterSpacing: 0.5 },
  levelSub: { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 2 },
  levelPrice: { letterSpacing: -0.5 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  metaItem: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    width: '47.5%',
    flexGrow: 1,
  },
  metaLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', letterSpacing: 0.5, marginBottom: 4 },
  metaValue: { fontSize: 12, fontFamily: 'Inter_600SemiBold', lineHeight: 18 },
  timingRow: {
    flexDirection: 'row',
    marginBottom: 12,
    overflow: 'hidden',
  },
  timingItem: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  timingValue: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  timingLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 2 },
  timingDivider: { width: StyleSheet.hairlineWidth },
  reasoning: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    paddingVertical: 10,
    paddingRight: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  reasoningLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', letterSpacing: 0.5, marginBottom: 4 },
  reasoningText: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  disclaimer: { fontSize: 10, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 4 },
  calcBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  calcBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
});