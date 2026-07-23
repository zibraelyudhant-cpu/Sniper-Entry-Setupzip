import React, { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useGetSmcAnalysis, useGetSniperScan } from '@workspace/api-client-react';
import type { SniperResult } from '@workspace/api-client-react';

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

function NoTrendScreen({ data, colors }: { data: SniperResult; colors: ReturnType<typeof useColors> }) {
  return (
    <Section title="STATUS">
      <View style={styles.statusBlock}>
        <Feather name="alert-triangle" size={32} color={colors.warning} />
        <Text style={[styles.statusTitle, { color: colors.warning }]}>Tidak Ada Trend Jelas</Text>
        <Text style={[styles.statusMsg, { color: colors.mutedForeground }]}>{data.message}</Text>
        <View style={styles.trendRow}>
          <TrendBadge label="D1" bias={data.h4?.bias ?? 'ranging'} strength={data.h4?.strength ?? 'neutral'} colors={colors} />
        </View>
      </View>
    </Section>
  );
}

function NoZoneScreen({ data, colors }: { data: SniperResult; colors: ReturnType<typeof useColors> }) {
  return (
    <>
      <TrendSection data={data} colors={colors} />
      <Section title="STATUS">
        <View style={styles.statusBlock}>
          <Feather name="map-pin" size={32} color={colors.warning} />
          <Text style={[styles.statusTitle, { color: colors.warning }]}>Tidak Ada Zona Valid di H1</Text>
          <Text style={[styles.statusMsg, { color: colors.mutedForeground }]}>{data.message}</Text>
        </View>
      </Section>
    </>
  );
}

function SkipScreen({ data, colors }: { data: SniperResult; colors: ReturnType<typeof useColors> }) {
  return (
    <>
      <TrendSection data={data} colors={colors} />
      <Section title="SETUP DILEWATI">
        <View style={styles.statusBlock}>
          <Feather name="slash" size={32} color={colors.bearish} />
          <Text style={[styles.statusTitle, { color: colors.bearish }]}>Kondisi Tidak Mendukung</Text>
          {(data.skipReasons ?? []).map((r, i) => (
            <View key={i} style={styles.skipReason}>
              <Feather name="x-circle" size={13} color={colors.bearish} />
              <Text style={[styles.skipReasonText, { color: colors.foreground }]}>{r}</Text>
            </View>
          ))}
        </View>
      </Section>
      <MarketSection data={data} colors={colors} />
    </>
  );
}

function NoSetupScreen({ data, colors }: { data: SniperResult; colors: ReturnType<typeof useColors> }) {
  // Tentukan filter mana yang gagal berdasarkan field yang ada
  const filters = [
    {
      label: 'CHoCH 15M',
      passed: data.choch15M === true,
      desc: data.choch15MDescription ?? 'Belum terdeteksi',
    },
    {
      label: 'Rejection 15M',
      passed: data.rejection15M === true,
      desc: data.rejection15MCandle ?? 'Belum ada candle rejection di zona',
    },
    {
      label: 'Pattern Konfirmasi',
      passed: data.patternConfirmed === true,
      desc: data.patternName ?? 'Tidak ada pattern searah bias',
    },
  ];

  return (
    <>
      <TrendSection data={data} colors={colors} />
      <Section title="HARD FILTER TIDAK TERPENUHI">
        <View style={styles.statusBlock}>
          <Feather name="shield" size={32} color={colors.warning} />
          <Text style={[styles.statusTitle, { color: colors.warning }]}>Sinyal Belum Layak Entry</Text>
          <Text style={[styles.statusMsg, { color: colors.mutedForeground }]}>{data.message}</Text>
        </View>
        {filters.map((f, i) => (
          <View key={i} style={[styles.filterRow, { borderBottomColor: colors.border }]}>
            <Feather
              name={f.passed ? 'check-circle' : 'x-circle'}
              size={16}
              color={f.passed ? colors.bullish : colors.bearish}
            />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={[styles.filterLabel, { color: colors.foreground }]}>{f.label}</Text>
              <Text style={[styles.filterDesc, { color: colors.mutedForeground }]}>{f.desc}</Text>
            </View>
          </View>
        ))}
      </Section>
      {data.zoneType && (
        <Section title="ZONA DITEMUKAN">
          <Row label="Tipe Zona" value={data.zoneType} />
          {data.zoneRange && (
            <Row
              label="Range"
              value={`${formatPrice(data.zoneRange.low)} – ${formatPrice(data.zoneRange.high)}`}
            />
          )}
          <Text style={[styles.statusMsg, { color: colors.mutedForeground, marginTop: 8 }]}>
            Zona valid — tunggu semua filter terpenuhi sebelum entry.
          </Text>
        </Section>
      )}
    </>
  );
}

function TrendBadge({
  label, bias, strength, colors,
}: {
  label: string;
  bias: string;
  strength: string;
  colors: ReturnType<typeof useColors>;
}) {
  const biasColor =
    bias === 'bullish' ? colors.bullish : bias === 'bearish' ? colors.bearish : colors.mutedForeground;
  return (
    <View style={[styles.trendBadge, { borderColor: biasColor }]}>
      <Text style={[styles.trendBadgeLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.trendBadgeBias, { color: biasColor }]}>{bias.toUpperCase()}</Text>
      {strength !== 'neutral' && (
        <Text style={[styles.trendBadgeStrength, { color: strength === 'strong' ? colors.gold : colors.mutedForeground }]}>
          [{strength.toUpperCase()}]
        </Text>
      )}
    </View>
  );
}

function TrendSection({ data, colors }: { data: SniperResult; colors: ReturnType<typeof useColors> }) {
  return (
    <Section title="TREND">
      <View style={styles.trendRow}>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {data.h4 && <TrendBadge label="D1" bias={data.h4.bias} strength={data.h4.strength} colors={colors} />}
                {(data as any).h4Actual && <TrendBadge label="H4" bias={(data as any).h4Actual.bias} strength={(data as any).h4Actual.strength} colors={colors} />}
              </View>
      </View>
    </Section>
  );
}

function MarketSection({ data, colors }: { data: SniperResult; colors: ReturnType<typeof useColors> }) {
  const rsiColor =
    (data.rsi ?? 50) > 70 ? colors.bearish : (data.rsi ?? 50) < 30 ? colors.bullish : colors.foreground;
  const frColor =
    (data.fundingRate ?? 0) > 0.05 ? colors.bearish : (data.fundingRate ?? 0) < -0.05 ? colors.bullish : colors.foreground;
  const oiColor =
    (data.oiChange ?? 0) > 0 ? colors.bullish : colors.bearish;

  const chochColor = data.chochDetected ? colors.bearish : colors.bullish;
  const choch15MColor = (data as any).choch15M ? colors.bullish : colors.mutedForeground;
  const rejection15MColor = (data as any).rejection15M ? colors.bullish : colors.mutedForeground;

  return (
    <Section title="KONDISI PASAR">
      <Row
        label="CHoCH H1"
        value={data.chochDetected ? 'Terbentuk ⚠' : 'Belum terbentuk ✓'}
        valueColor={chochColor}
      />
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <Row
        label="CHoCH 15M"
        value={(data as any).choch15M ? 'Terkonfirmasi ✓' : 'Belum terbentuk'}
        valueColor={choch15MColor}
      />
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <Row
        label="Rejection 15M"
        value={(data as any).rejection15M
          ? `${(data as any).rejection15MCandle} ✓`
          : 'Belum ada'}
        valueColor={rejection15MColor}
      />
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <Row
        label="RSI H1"
        value={`${(data.rsi ?? 0).toFixed(1)}${data.rsiDivergence ? ' ⚠ divergence' : ' ✓'}`}
        valueColor={data.rsiDivergence ? colors.warning : rsiColor}
      />
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <Row
        label="OI Change"
        value={`${(data.oiChange ?? 0) >= 0 ? '+' : ''}${(data.oiChange ?? 0).toFixed(2)}%`}
        valueColor={oiColor}
      />
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <Row
        label="OI Akumulasi"
        value={(data as any).oiAccumulation
          ? '✅ Akumulasi terdeteksi'
          : (data as any).oiAccumulationDesc ?? 'Memuat...'}
        valueColor={(data as any).oiAccumulation ? colors.bullish : colors.mutedForeground}
      />
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      <Row
        label="Funding Rate"
        value={`${(data.fundingRate ?? 0) >= 0 ? '+' : ''}${(data.fundingRate ?? 0).toFixed(3)}%`}
        valueColor={frColor}
      />
    </Section>
  );
}

function ProbabilitySection({ data, colors }: { data: SniperResult; colors: ReturnType<typeof useColors> }) {
  const prob = data.profitProbability ?? 0;
  const badgeColor = prob >= 75 ? colors.bullish : prob >= 50 ? colors.gold : colors.bearish;
  const label = prob >= 75 ? 'Tinggi' : prob >= 50 ? 'Sedang' : 'Rendah';

  return (
    <Section title="PROBABILITAS PROFIT">
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

function ReadyScreen({ data, colors }: { data: SniperResult; colors: ReturnType<typeof useColors> }) {
  const isBuy = data.bias === 'bullish';
  const biasColor = isBuy ? colors.bullish : colors.bearish;

  return (
    <>
      <TrendSection data={data} colors={colors} />

      <ProbabilitySection data={data} colors={colors} />

      {/* Main Entry Setup */}
      <Section title="SNIPER ENTRY SETUP">
        {/* Header info */}
        <View style={[styles.entryHeader, { backgroundColor: colors.surfaceMid, borderRadius: 8, padding: 12, marginBottom: 12 }]}>
          <View style={styles.entryHeaderRow}>
            <Text style={[styles.entryLabel, { color: colors.mutedForeground }]}>Harga Saat Ini</Text>
            <Text style={[styles.entryCurrentPrice, { color: colors.foreground }]}>
              {formatPrice(data.currentPrice)}
            </Text>
          </View>
          <Text style={[styles.entryTime, { color: colors.mutedForeground }]}>
            {formatTimestamp(data.timestamp)}
          </Text>
        </View>

        {/* Direction badge */}
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

        {/* Entry levels */}
        <View style={[styles.levelsCard, { backgroundColor: colors.surfaceMid, borderColor: colors.border }]}>
          <LevelRow label="ENTRY IDEAL" price={data.entryPrice ?? 0} color={colors.highlight} colors={colors} big />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <LevelRow label="STOP LOSS" price={data.stopLoss ?? 0} color={colors.bearish} colors={colors} sub="ATR-based" />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <LevelRow label="TAKE PROFIT 1" price={data.takeProfit1 ?? 0} color={colors.bullish} colors={colors} sub="R:R 1:1.5" />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <LevelRow label="TAKE PROFIT 2" price={data.takeProfit2 ?? 0} color={colors.gold} colors={colors} sub="R:R 1:3" />
        </View>

        {/* Kalkulator PnL button */}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push({
              pathname: '/(tabs)/calculator',
              params: {
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

        {/* Chart Pattern button */}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push({
              pathname: '/(tabs)/patterns',
              params: { symbol: data.symbol },
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
          <Feather name="activity" size={15} color={colors.mutedForeground} />
          <Text style={[styles.calcBtnText, { color: colors.mutedForeground }]}>
            Chart Pattern
          </Text>
          <Feather name="arrow-right" size={14} color={colors.mutedForeground} style={{ marginLeft: 'auto' }} />
        </Pressable>

        {/* Zone info */}
        <View style={styles.metaGrid}>
          <MetaItem label="Zona Entry" value={data.zoneType ?? ''} colors={colors} />
          {data.zoneRange && (
            <MetaItem
              label="Range Zona"
              value={`${formatPrice(data.zoneRange.low)} – ${formatPrice(data.zoneRange.high)}`}
              colors={colors}
            />
          )}
          <MetaItem label="Refine (15M)" value={data.refinedZoneType ?? data.zoneType ?? ''} colors={colors} />
          <MetaItem
            label="Konfirmasi (5M)"
            value={data.entryConfirmed ? `✓ ${data.confirmationCandle}` : `⚠ ${data.confirmationCandle}`}
            valueColor={data.entryConfirmed ? colors.bullish : colors.warning}
            colors={colors}
          />
        </View>

        {/* Timing */}
        <View style={[styles.timingRow, { backgroundColor: colors.surfaceMid, borderRadius: 8 }]}>
          <TimingItem label="Setup Valid" value={`${data.setupValidHours}j`} colors={colors} />
          <View style={[styles.timingDivider, { backgroundColor: colors.border }]} />
          <TimingItem label="Est. Hit" value={`~${data.estimatedHitHours}j`} colors={colors} />
          <View style={[styles.timingDivider, { backgroundColor: colors.border }]} />
          <TimingItem label="Kadaluarsa" value={`${data.expiryHours}j`} colors={colors} />
        </View>

        {/* Reasoning */}
        {data.reasoning && (
          <View style={[styles.reasoning, { backgroundColor: colors.surfaceMid, borderLeftColor: colors.highlight }]}>
            <Text style={[styles.reasoningLabel, { color: colors.mutedForeground }]}>Alasan</Text>
            <Text style={[styles.reasoningText, { color: colors.foreground }]}>{data.reasoning}</Text>
          </View>
        )}

        {/* Disclaimer */}
        <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
          * Hanya referensi manual. Tidak ada auto-eksekusi.
        </Text>
      </Section>

      <MarketSection data={data} colors={colors} />
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


// ─── Signal Log ───────────────────────────────────────────────────────────────

type SignalLogStatus = 'pending' | 'win_tp1' | 'win_tp2' | 'lose' | 'expired';

interface SignalLog {
  id: string;
  menu: 'sniper' | 'scalping';
  symbol: string;
  bias: 'bullish' | 'bearish';
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
  currentPriceAtSignal: number;
  timestamp: string;
  savedAt: number;
  probabilityOrScore?: number;
  zoneType?: string;
  status: SignalLogStatus;
  evaluatedAt?: string;
  exitPrice?: number;
  rr?: number;
  explanation?: string; // penjelasan kenapa win/lose
}

const SNIPER_LOG_KEY = 'signal_logs_sniper';

async function sniperLoadLogs(): Promise<SignalLog[]> {
  try { const r = await AsyncStorage.getItem(SNIPER_LOG_KEY); return r ? JSON.parse(r) : []; }
  catch { return []; }
}
async function sniperSaveLog(log: SignalLog): Promise<SignalLog[]> {
  const all = await sniperLoadLogs();
  const updated = [log, ...all].slice(0, 100);
  try { await AsyncStorage.setItem(SNIPER_LOG_KEY, JSON.stringify(updated)); } catch {}
  return updated;
}
async function sniperUpdateLog(id: string, patch: Partial<SignalLog>): Promise<SignalLog[]> {
  const all = await sniperLoadLogs();
  const updated = all.map(l => l.id === id ? { ...l, ...patch } : l);
  try { await AsyncStorage.setItem(SNIPER_LOG_KEY, JSON.stringify(updated)); } catch {}
  return updated;
}
async function sniperDeleteLog(id: string): Promise<SignalLog[]> {
  const all = await sniperLoadLogs();
  const updated = all.filter(l => l.id !== id);
  try { await AsyncStorage.setItem(SNIPER_LOG_KEY, JSON.stringify(updated)); } catch {}
  return updated;
}
async function sniperEvaluateLog(log: SignalLog): Promise<Partial<SignalLog>> {
  try {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${log.symbol}&interval=15m&startTime=${log.savedAt}&endTime=${Date.now()}&limit=200`;
    const res = await fetch(url);
    if (!res.ok) return { status: 'pending' };
    const klines: number[][] = await res.json();
    const risk = Math.abs(log.entryPrice - log.stopLoss);
    const evalAt = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
    for (const k of klines) {
      const high = k[2] as number, low = k[3] as number;
      const fp = (v: number) => v >= 1000 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v.toFixed(6);
      if (log.bias === 'bullish') {
        const hitSL = low <= log.stopLoss;
        const hitTP2 = log.takeProfit2 != null && high >= log.takeProfit2;
        const hitTP1 = high >= log.takeProfit1;
        if (hitSL && !hitTP1) return { status: 'lose', exitPrice: log.stopLoss, rr: -1, evaluatedAt: evalAt,
          explanation: `❌ LOSE — Harga turun ke SL ${fp(log.stopLoss)}. Low candle ${fp(low)} menyentuh stop loss. Entry ${fp(log.entryPrice)} tidak terkonfirmasi, harga melanjutkan turun.` };
        if (hitTP2) return { status: 'win_tp2', exitPrice: log.takeProfit2!, rr: +((log.takeProfit2! - log.entryPrice) / risk).toFixed(1), evaluatedAt: evalAt,
          explanation: `✅ WIN TP2 — Harga naik ke TP2 ${fp(log.takeProfit2!)}. Trend kuat berlanjut melewati TP1 hingga target penuh. R:R ${+((log.takeProfit2! - log.entryPrice) / risk).toFixed(1)}.` };
        if (hitTP1) return { status: 'win_tp1', exitPrice: log.takeProfit1, rr: +((log.takeProfit1 - log.entryPrice) / risk).toFixed(1), evaluatedAt: evalAt,
          explanation: `✅ WIN TP1 — Harga naik ke TP1 ${fp(log.takeProfit1)}. Pullback selesai dan trend bullish berlanjut. R:R ${+((log.takeProfit1 - log.entryPrice) / risk).toFixed(1)}.` };
        if (hitSL) return { status: 'lose', exitPrice: log.stopLoss, rr: -1, evaluatedAt: evalAt,
          explanation: `❌ LOSE — SL ${fp(log.stopLoss)} kena di candle yang sama dengan TP. Harga volatile, entry prematur atau zona tidak kuat.` };
      } else {
        const hitSL = high >= log.stopLoss;
        const hitTP2 = log.takeProfit2 != null && low <= log.takeProfit2;
        const hitTP1 = low <= log.takeProfit1;
        if (hitSL && !hitTP1) return { status: 'lose', exitPrice: log.stopLoss, rr: -1, evaluatedAt: evalAt,
          explanation: `❌ LOSE — Harga naik ke SL ${fp(log.stopLoss)}. High candle ${fp(high)} menyentuh stop loss. Harga tidak melanjutkan penurunan.` };
        if (hitTP2) return { status: 'win_tp2', exitPrice: log.takeProfit2!, rr: +((log.entryPrice - log.takeProfit2!) / risk).toFixed(1), evaluatedAt: evalAt,
          explanation: `✅ WIN TP2 — Harga turun ke TP2 ${fp(log.takeProfit2!)}. Trend bearish kuat berlanjut hingga target penuh. R:R ${+((log.entryPrice - log.takeProfit2!) / risk).toFixed(1)}.` };
        if (hitTP1) return { status: 'win_tp1', exitPrice: log.takeProfit1, rr: +((log.entryPrice - log.takeProfit1) / risk).toFixed(1), evaluatedAt: evalAt,
          explanation: `✅ WIN TP1 — Harga turun ke TP1 ${fp(log.takeProfit1)}. Bounce selesai dan trend bearish berlanjut. R:R ${+((log.entryPrice - log.takeProfit1) / risk).toFixed(1)}.` };
        if (hitSL) return { status: 'lose', exitPrice: log.stopLoss, rr: -1, evaluatedAt: evalAt,
          explanation: `❌ LOSE — SL ${fp(log.stopLoss)} kena bersamaan dengan TP. Volatilitas tinggi, zona tidak cukup kuat menahan harga.` };
      }
    }
    return { status: 'pending' };
  } catch { return { status: 'pending' }; }
}

function SniperLogTab({ colors }: { colors: ReturnType<typeof useColors> }) {
  const insets = useSafeAreaInsets();
  const [logs, setLogs] = useState<SignalLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState<string | null>(null);

  useEffect(() => { sniperLoadLogs().then(l => { setLogs(l); setLoading(false); }); }, []);

  const doEval = async (log: SignalLog) => {
    setEvaluating(log.id);
    const patch = await sniperEvaluateLog(log);
    const updated = await sniperUpdateLog(log.id, patch);
    setLogs(updated); setEvaluating(null);
  };

  const doDelete = async (id: string) => { setLogs(await sniperDeleteLog(id)); };

  const sc = (s: SignalLogStatus) => s === 'win_tp1' || s === 'win_tp2' ? '#22c55e' : s === 'lose' ? '#ef4444' : '#888';
  const sl = (s: SignalLogStatus) => s === 'win_tp1' ? 'WIN TP1' : s === 'win_tp2' ? 'WIN TP2' : s === 'lose' ? 'LOSE' : s === 'expired' ? 'EXPIRED' : 'PENDING';

  const wins = logs.filter(l => l.status === 'win_tp1' || l.status === 'win_tp2').length;
  const loses = logs.filter(l => l.status === 'lose').length;
  const wr = wins + loses > 0 ? Math.round(wins / (wins + loses) * 100) : 0;
  const rrs = logs.filter(l => (l.rr ?? 0) > 0);
  const avgRR = rrs.length ? (rrs.reduce((a, b) => a + (b.rr ?? 0), 0) / rrs.length).toFixed(2) : '—';

  const fp = (v: number) => v >= 1000 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v.toFixed(6);

  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 80 }} showsVerticalScrollIndicator={false}>
      {logs.length > 0 && (
        <View style={{ flexDirection: 'row', margin: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14, justifyContent: 'space-around' }}>
          {[{ v: `${wins}W`, c: '#22c55e', l: 'Win' }, { v: `${loses}L`, c: '#ef4444', l: 'Lose' }, { v: `${logs.filter(x => x.status === 'pending').length}`, c: colors.mutedForeground, l: 'Pending' }, { v: `${wr}%`, c: colors.foreground, l: 'Win Rate' }, { v: avgRR, c: colors.foreground, l: 'Avg R:R' }].map(item => (
            <View key={item.l} style={{ alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 18, fontFamily: 'Inter_700Bold', color: item.c }}>{item.v}</Text>
              <Text style={{ fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground }}>{item.l}</Text>
            </View>
          ))}
        </View>
      )}
      {logs.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10, minHeight: 300 }}>
          <Feather name="bookmark" size={36} color={colors.mutedForeground} />
          <Text style={{ fontSize: 16, fontFamily: 'Inter_600SemiBold', color: colors.foreground, textAlign: 'center' }}>Belum ada sinyal tersimpan</Text>
          <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, textAlign: 'center', lineHeight: 20 }}>Simpan sinyal dari tab Analisa saat status Ready</Text>
        </View>
      ) : (
        <View style={{ paddingHorizontal: 12, paddingTop: 10, gap: 8 }}>
          {logs.map(log => (
            <View key={log.id} style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: 'hidden' }}>
              <View style={{ flexDirection: 'row', padding: 12, alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontFamily: 'Inter_600SemiBold', color: colors.foreground }}>{log.symbol.replace('USDT', '')}/USDT</Text>
                  <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 2 }}>{log.timestamp}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1, borderColor: sc(log.status), backgroundColor: sc(log.status) + '18' }}>
                    <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.5, color: sc(log.status) }}>{sl(log.status)}</Text>
                  </View>
                  <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: log.bias === 'bullish' ? '#22c55e' : '#ef4444' }}>{log.bias === 'bullish' ? '▲ LONG' : '▼ SHORT'}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingVertical: 8, paddingHorizontal: 12 }}>
                {([['Entry', log.entryPrice, colors.foreground], ['SL', log.stopLoss, '#ef4444'], ['TP1', log.takeProfit1, '#22c55e'], ['TP2', log.takeProfit2, '#3b82f6']] as [string, number|undefined, string][]).map(([lbl, val, col]) => val ? (
                  <View key={lbl} style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={{ fontSize: 9, fontFamily: 'Inter_500Medium', color: colors.mutedForeground }}>{lbl}</Text>
                    <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: col, marginTop: 2 }}>{fp(val)}</Text>
                  </View>
                ) : null)}
                {log.rr !== undefined && (
                  <View style={{ flex: 1, alignItems: 'center' }}>
                    <Text style={{ fontSize: 9, fontFamily: 'Inter_500Medium', color: colors.mutedForeground }}>R:R</Text>
                    <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: log.rr > 0 ? '#22c55e' : '#ef4444', marginTop: 2 }}>{log.rr > 0 ? `1:${log.rr}` : '-1'}</Text>
                  </View>
                )}
              </View>
              {log.currentPriceAtSignal > 0 && <Text style={{ fontSize: 11, color: colors.mutedForeground, paddingHorizontal: 12, paddingBottom: 2, fontFamily: 'Inter_400Regular' }}>Harga saat sinyal: {log.currentPriceAtSignal >= 1000 ? log.currentPriceAtSignal.toFixed(2) : log.currentPriceAtSignal >= 1 ? log.currentPriceAtSignal.toFixed(4) : log.currentPriceAtSignal.toFixed(6)}</Text>}
              {log.probabilityOrScore !== undefined && <Text style={{ fontSize: 11, color: colors.mutedForeground, paddingHorizontal: 12, paddingBottom: 4, fontFamily: 'Inter_400Regular' }}>Probabilitas saat sinyal: {log.probabilityOrScore}%</Text>}
              {log.evaluatedAt && <Text style={{ fontSize: 10, color: colors.mutedForeground, paddingHorizontal: 12, paddingBottom: 2, fontFamily: 'Inter_400Regular' }}>Dievaluasi: {log.evaluatedAt}</Text>}
              {log.explanation && (
                <View style={{ marginHorizontal: 12, marginBottom: 8, padding: 10, borderRadius: 8, backgroundColor: (log.status === 'win_tp1' || log.status === 'win_tp2') ? '#16A34A15' : log.status === 'lose' ? '#DC262615' : `${colors.card}`, borderLeftWidth: 3, borderLeftColor: (log.status === 'win_tp1' || log.status === 'win_tp2') ? '#22c55e' : log.status === 'lose' ? '#ef4444' : colors.mutedForeground }}>
                  <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, lineHeight: 17 }}>{log.explanation}</Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, padding: 8, gap: 8, alignItems: 'center' }}>
                {log.status === 'pending' && (
                  <Pressable onPress={() => doEval(log)} disabled={evaluating === log.id}
                    style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primary + '15', opacity: pressed || evaluating === log.id ? 0.7 : 1 }]}>
                    {evaluating === log.id ? <ActivityIndicator size={12} color={colors.primary} /> : <Feather name="search" size={12} color={colors.primary} />}
                    <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.primary }}>{evaluating === log.id ? 'Evaluasi...' : 'Evaluasi'}</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => doDelete(log.id)} style={({ pressed }) => [{ padding: 8, opacity: pressed ? 0.7 : 1 }]}>
                  <Feather name="trash-2" size={12} color="#ef4444" />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────


// ─── Probability Badge ────────────────────────────────────────────────────────

function ProbBadge({ prob, colors }: { prob: number; colors: ReturnType<typeof useColors> }) {
  const color = prob >= 75 ? colors.bullish : prob >= 50 ? colors.gold : colors.bearish;
  const label = prob >= 75 ? 'TINGGI' : prob >= 50 ? 'SEDANG' : 'RENDAH';
  return (
    <View style={[scanStyles.probBadge, { borderColor: color, backgroundColor: `${color}18` }]}>
      <Text style={[scanStyles.probBadgeText, { color }]}>{prob}% {label}</Text>
    </View>
  );
}

// ─── Scan Coin Card ───────────────────────────────────────────────────────────

function ScanCoinCard({ coin, onPress, colors }: { coin: SniperResult; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  const base = coin.symbol.replace('USDT', '');
  const isBuy = coin.bias === 'bullish';
  const biasColor = isBuy ? colors.bullish : colors.bearish;
  const prob = coin.profitProbability ?? 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [scanStyles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
    >
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
            {coin.zoneType && (
              <View style={[scanStyles.zoneBadge, { borderColor: colors.border }]}>
                <Text style={[scanStyles.zoneBadgeText, { color: colors.mutedForeground }]}>{coin.zoneType}</Text>
              </View>
            )}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <ProbBadge prob={prob} colors={colors} />
          <Text style={[scanStyles.cardPrice, { color: colors.foreground }]}>{formatPrice(coin.currentPrice)}</Text>
        </View>
        <Feather name="chevron-right" size={14} color={colors.mutedForeground} style={{ marginLeft: 4 }} />
      </View>

      {/* Row 2: kondisi CHoCH + Rejection + Pattern */}
      <View style={[scanStyles.condRow, { borderTopColor: colors.border }]}>
        <View style={scanStyles.condItem}>
          <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>CHoCH 15M</Text>
          <Text style={[scanStyles.condValue, { color: coin.choch15M ? colors.bullish : colors.bearish }]}>
            {coin.choch15M ? '✅' : '⚠️'}
          </Text>
        </View>
        <View style={[scanStyles.condDivider, { backgroundColor: colors.border }]} />
        <View style={scanStyles.condItem}>
          <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>Rejection</Text>
          <Text style={[scanStyles.condValue, { color: coin.rejection15M ? colors.bullish : colors.bearish }]}>
            {coin.rejection15M ? '✅' : '⚠️'}
          </Text>
        </View>
        <View style={[scanStyles.condDivider, { backgroundColor: colors.border }]} />
        <View style={scanStyles.condItem}>
          <Text style={[scanStyles.condLabel, { color: colors.mutedForeground }]}>Pattern</Text>
          <Text style={[scanStyles.condValue, { color: coin.patternConfirmed ? colors.bullish : colors.bearish }]}>
            {coin.patternConfirmed ? '✅' : '⚠️'}
          </Text>
        </View>
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

function ScanTab({ colors }: { colors: ReturnType<typeof useColors> }) {
  const insets = useSafeAreaInsets();
  const bottomPadding = insets.bottom + 80;
  const { data, isLoading, isError, refetch } = useGetSniperScan({
    query: { staleTime: 5 * 60 * 1000 },
  });

  const handleCoinPress = useCallback((coin: SniperResult) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/(tabs)/sniper',
      params: { tab: 'analisa', symbol: coin.symbol },
    });
  }, []);

  if (isLoading) {
    return (
      <View style={scanStyles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[scanStyles.loadingText, { color: colors.mutedForeground }]}>Scanning sniper setup...</Text>
        <Text style={[scanStyles.loadingSub, { color: colors.mutedForeground }]}>Analisa H4→H1→15M tiap koin</Text>
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

  if (coins.length === 0) {
    return (
      <View style={scanStyles.center}>
        <Feather name="crosshair" size={36} color={colors.mutedForeground} />
        <Text style={[scanStyles.emptyTitle, { color: colors.foreground }]}>Tidak ada setup valid</Text>
        <Text style={[scanStyles.emptySub, { color: colors.mutedForeground }]}>
          Tidak ada koin dengan probabilitas ≥ 30% saat ini.
        </Text>
        <Pressable onPress={() => refetch()} style={[scanStyles.retryBtn, { backgroundColor: colors.primary }]}>
          <Text style={[scanStyles.retryText, { color: colors.primaryForeground }]}>Scan Ulang</Text>
        </Pressable>
      </View>
    );
  }

  // Group by probability tier
  const high = coins.filter(c => (c.profitProbability ?? 0) >= 75);
  const mid = coins.filter(c => (c.profitProbability ?? 0) >= 50 && (c.profitProbability ?? 0) < 75);
  const low = coins.filter(c => (c.profitProbability ?? 0) >= 30 && (c.profitProbability ?? 0) < 50);

  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: bottomPadding }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        {fetchedAt && <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground }}>Update: {fetchedAt} WIB</Text>}
        <ScanNowButton onPress={() => refetch()} isLoading={isLoading} colors={colors} />
      </View>

      {high.length > 0 && (
        <>
          <Text style={[scanStyles.groupHeader, { color: colors.bullish }]}>🟢 PROBABILITAS TINGGI (≥75%)</Text>
          {high.map(c => <ScanCoinCard key={c.symbol} coin={c} colors={colors} onPress={() => handleCoinPress(c)} />)}
        </>
      )}
      {mid.length > 0 && (
        <>
          <Text style={[scanStyles.groupHeader, { color: colors.gold }]}>🟡 PROBABILITAS SEDANG (50–74%)</Text>
          {mid.map(c => <ScanCoinCard key={c.symbol} coin={c} colors={colors} onPress={() => handleCoinPress(c)} />)}
        </>
      )}
      {low.length > 0 && (
        <>
          <Text style={[scanStyles.groupHeader, { color: colors.mutedForeground }]}>🔴 PROBABILITAS RENDAH (30–49%)</Text>
          {low.map(c => <ScanCoinCard key={c.symbol} coin={c} colors={colors} onPress={() => handleCoinPress(c)} />)}
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

function AnalisaTab({ colors, initialSymbol, onSignalReady, onSave }: { colors: ReturnType<typeof useColors>; initialSymbol?: string; onSignalReady?: (d: SniperResult | null) => void; onSave?: () => void }) {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ symbol?: string }>();

  const [inputSymbol, setInputSymbol] = useState(initialSymbol ?? params.symbol ?? '');
  const [querySymbol, setQuerySymbol] = useState(initialSymbol ?? params.symbol ?? '');

  // Update when navigated from screener
  useEffect(() => {
    if (params.symbol) {
      setInputSymbol(params.symbol);
      setQuerySymbol(params.symbol);
    }
  }, [params.symbol]);

  const { data, isLoading, isError, refetch } = useGetSmcAnalysis(
    { symbol: querySymbol },
    { query: { enabled: !!querySymbol, staleTime: 120_000 } }
  );

  useEffect(() => {
    if (onSignalReady) onSignalReady(data?.status === 'ready' ? (data as SniperResult) : null);
  }, [data]);

  const handleAnalyze = useCallback(() => {
    const sym = inputSymbol.trim().toUpperCase();
    if (!sym) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setQuerySymbol(sym);
  }, [inputSymbol]);

  const bottomPadding = 60 + (Platform.OS === 'web' ? 34 : insets.bottom);

  return (
    <View style={{ flex: 1 }}>
      {/* Input bar */}
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
          style={({ pressed }) => [
            styles.analyzeBtn,
            { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
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
      ) : isLoading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Menganalisa {formatSymbolClean(querySymbol)}
          </Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            H4 → H1 → 15M → 5M...
          </Text>
        </View>
      ) : isError ? (
        <View style={styles.emptyState}>
          <Feather name="alert-circle" size={40} color={colors.bearish} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Gagal menganalisa</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Periksa nama pair dan koneksi internet
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : data ? (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding }}
          showsVerticalScrollIndicator={false}
        >
          {/* Symbol + timestamp header */}
          <View style={styles.resultHeader}>
            <Text style={[styles.resultSymbol, { color: colors.foreground }]}>
              {formatSymbolClean(data.symbol)}
            </Text>
            <Pressable onPress={() => refetch()} style={styles.refreshBtn}>
              <Feather name="refresh-cw" size={15} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {data.status === 'no_trend' && <NoTrendScreen data={data} colors={colors} />}
          {data.status === 'no_zone' && <NoZoneScreen data={data} colors={colors} />}
          {data.status === 'skip_conditions' && <SkipScreen data={data} colors={colors} />}
          {data.status === 'no_setup' && <NoSetupScreen data={data} colors={colors} />}
          {data.status === 'ready' && (
            <>
              <ReadyScreen data={data} colors={colors} />
              {onSave && (
                <Pressable onPress={onSave}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, margin: 12, marginTop: 0, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}>
                  <Feather name="bookmark" size={15} color={colors.primaryForeground} />
                  <Text style={{ fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.primaryForeground }}>Simpan Sinyal ke Log</Text>
                </Pressable>
              )}
            </>
          )}
          {data.status === 'error' && (
            <Section title="ERROR">
              <View style={styles.statusBlock}>
                <Feather name="x-circle" size={32} color={colors.bearish} />
                <Text style={[styles.statusMsg, { color: colors.mutedForeground }]}>{data.message}</Text>
              </View>
            </Section>
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
  const params = useLocalSearchParams<{ tab?: string; symbol?: string }>();
  const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const [activeTab, setActiveTab] = useState<'scan' | 'analisa' | 'log'>(
    params.tab === 'analisa' ? 'analisa' : params.tab === 'log' ? 'log' : 'scan'
  );
  const [currentSignal, setCurrentSignal] = useState<SniperResult | null>(null);

  const handleSaveSignal = useCallback(async () => {
    if (!currentSignal || !currentSignal.entryPrice) return;
    const log: SignalLog = {
      id: `${Date.now()}_${currentSignal.symbol}`,
      menu: 'sniper',
      symbol: currentSignal.symbol,
      bias: currentSignal.bias ?? 'bullish',
      entryPrice: currentSignal.entryPrice,
      stopLoss: currentSignal.stopLoss ?? 0,
      takeProfit1: currentSignal.takeProfit1 ?? 0,
      takeProfit2: currentSignal.takeProfit2,
      currentPriceAtSignal: currentSignal.currentPrice,
      timestamp: currentSignal.timestamp,
      savedAt: Date.now(),
      probabilityOrScore: currentSignal.profitProbability,
      zoneType: currentSignal.zoneType,
      status: 'pending',
    };
    await sniperSaveLog(log);
    setActiveTab('log');
  }, [currentSignal]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={styles.headerTop}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Sniper Entry</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>SMC Top-Down H4→H1→15M</Text>
          </View>
          {activeTab === 'scan' && (
            <View style={[styles.liveDot, { backgroundColor: `${colors.bullish}20` }]}>
              <View style={[styles.liveDotInner, { backgroundColor: colors.bullish }]} />
              <Text style={[styles.liveText, { color: colors.bullish }]}>LIVE</Text>
            </View>
          )}
        </View>
        {/* Tab switcher */}
        <View style={[styles.tabSwitcher, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {(['scan', 'analisa', 'log'] as const).map(tab => (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={[styles.tabBtn, activeTab === tab && { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.tabBtnText, { color: activeTab === tab ? colors.primaryForeground : colors.mutedForeground }]}>
                {tab === 'scan' ? 'SCAN' : tab === 'analisa' ? 'ANALISA' : 'LOG'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {activeTab === 'scan'
        ? <ScanTab colors={colors} />
        : activeTab === 'analisa'
        ? <AnalisaTab colors={colors} initialSymbol={params.symbol ?? undefined} onSignalReady={setCurrentSignal} onSave={handleSaveSignal} />
        : <SniperLogTab colors={colors} />
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