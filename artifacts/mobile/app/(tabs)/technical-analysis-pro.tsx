import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { customFetch } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { MENU_COLORS } from '@/constants/theme';
import { CyberBackground } from '@/components/animated/CyberBackground';
import { AnimatedTabSwitcher } from '@/components/animated/AnimatedTabSwitcher';
import { CyberCard } from '@/components/animated/CyberCard';
import { CyberBadge } from '@/components/animated/CyberBadge';
import { CyberBigNumber } from '@/components/animated/CyberBigNumber';

const ACCENT = MENU_COLORS.allMenus;
const CYAN = '#00FFF0';
const MAGENTA = '#FF00E5';
const NEUTRAL = '#5B6478';
const AMBER = '#FFD700';

type TFOption = 'D1' | 'H4' | 'H1' | 'M30' | 'M15' | 'M5' | 'M1';
const TF_OPTIONS: TFOption[] = ['D1', 'H4', 'H1', 'M30', 'M15', 'M5', 'M1']; // M1 ditambahin (request user)

type FeatureKey = 'trend' | 'multiTf' | 'snrZones' | 'longShort' | 'divergenceTrend' | 'btcCorrelation';
const FEATURES: { key: FeatureKey; label: string; needsTf: boolean; noSymbolNeeded?: boolean }[] = [
  { key: 'btcCorrelation', label: 'BTC', noSymbolNeeded: true, needsTf: false },
  { key: 'trend', label: 'Tren', needsTf: true },
  { key: 'multiTf', label: 'Multi-TF', needsTf: false },
  { key: 'snrZones', label: 'Price Action', needsTf: true },
  { key: 'longShort', label: 'Skor', needsTf: false },
  { key: 'divergenceTrend', label: 'Divergence', needsTf: true },
];

const SNR_TFS: TFOption[] = ['H4', 'H1', 'M15', 'M5'];

function featureUrl(symbol: string, feature: FeatureKey, tf: TFOption): string {
  const enc = encodeURIComponent(symbol);
  switch (feature) {
    case 'btcCorrelation': return `/api/technical-analysis-pro/btc-correlation`;
    case 'trend': return `/api/technical-analysis-pro/trend?symbol=${enc}&tf=${tf}`;
    case 'multiTf': return `/api/technical-analysis-pro/multi-tf?symbol=${enc}`;
    case 'snrZones': return `/api/technical-analysis-pro/snr-zones?symbol=${enc}&tf=${SNR_TFS.includes(tf) ? tf : 'H4'}`;
    case 'longShort': return `/api/technical-analysis-pro/long-short-score?symbol=${enc}`;
    case 'divergenceTrend': return `/api/technical-analysis-pro/divergence-trend?symbol=${enc}&tf=${tf}`;
  }
}

export default function TechnicalAnalysisProScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = insets.top + (Platform.OS === 'web' ? 67 : 0);
  const [symbolInput, setSymbolInput] = useState('');
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [activeFeature, setActiveFeature] = useState<FeatureKey>('trend');
  const [tf, setTf] = useState<TFOption>('H4');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['technical-analysis-pro', activeFeature === 'btcCorrelation' ? 'BTC' : activeSymbol, activeFeature, tf],
    queryFn: () => customFetch<any>(featureUrl(activeSymbol ?? '', activeFeature, tf)),
    enabled: activeFeature === 'btcCorrelation' || !!activeSymbol,
  });

  const currentFeatureMeta = FEATURES.find(f => f.key === activeFeature)!;

  const handleAnalisa = () => {
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) return;
    setActiveSymbol(symbol.endsWith('USDT') ? symbol : `${symbol}USDT`);
  };

  return (
    <View style={[styles.container, { backgroundColor: '#050208' }]}>
      <CyberBackground />

      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: 'rgba(255,0,229,0.2)', backgroundColor: '#050208' }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Technical Analysis PRO</Text>
        <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>Tren, Multi-TF, Price Action, Skor Long/Short & Divergence</Text>

        <View style={[styles.inputArea]}>
          <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.inputText, { color: colors.foreground }]}
              placeholder="Contoh: BTCUSDT"
              placeholderTextColor={colors.mutedForeground}
              value={symbolInput}
              onChangeText={setSymbolInput}
              autoCapitalize="characters"
              onSubmitEditing={handleAnalisa}
              returnKeyType="search"
            />
          </View>
          <TouchableOpacity style={[styles.analyzeBtn, { backgroundColor: ACCENT }]} onPress={handleAnalisa}>
            <Text style={[styles.analyzeBtnText, { color: '#031A1F' }]}>Analisa</Text>
          </TouchableOpacity>
        </View>

        <View style={{ marginTop: 12 }}>
          <AnimatedTabSwitcher
            tabs={FEATURES.map(f => ({ key: f.key, label: f.label }))}
            active={activeFeature}
            onChange={(k) => setActiveFeature(k as FeatureKey)}
            accentColor={ACCENT}
          />
        </View>
      </View>

      {!activeSymbol && activeFeature !== 'btcCorrelation' ? (
        <View style={styles.emptyState}>
          <Feather name="bar-chart-2" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Pilih koin dulu</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Ketik simbol koin di atas, lalu tekan Analisa — atau buka tab BTC buat liat outlook BTC dulu (gak perlu pilih koin)</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {currentFeatureMeta.needsTf && (
            <View style={styles.tfRow}>
              {(activeFeature === 'snrZones' ? SNR_TFS : TF_OPTIONS).map(opt => {
                const active = activeFeature === 'snrZones' ? opt === (SNR_TFS.includes(tf) ? tf : 'H4') : tf === opt;
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.tfChip, { backgroundColor: active ? colors.gold : colors.card, borderColor: active ? colors.gold : colors.border }]}
                    onPress={() => setTf(opt)}
                  >
                    <Text style={[styles.tfChipText, { color: active ? colors.background : colors.mutedForeground }]}>{opt}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {isLoading && <ActivityIndicator style={{ marginTop: 32 }} color={colors.highlight} />}
          {isError && (
            <View style={[styles.errorBox, { backgroundColor: `${colors.bearish}15`, borderColor: `${colors.bearish}40` }]}>
              <Feather name="alert-triangle" size={16} color={colors.bearish} />
              <Text style={[styles.errorText, { color: colors.bearish }]}>{error instanceof Error ? error.message : 'Gagal ambil data'}</Text>
            </View>
          )}

          {!isLoading && !isError && data && activeFeature === 'longShort' && <LongShortScoreResultView data={data} />}

          {!isLoading && !isError && data && activeFeature === 'trend' && <TrendResultView data={data} />}
          {!isLoading && !isError && data && activeFeature === 'multiTf' && <MultiTfResultView data={data} />}
          {!isLoading && !isError && data && activeFeature === 'snrZones' && <SnrZonesResultView data={data} />}
          {!isLoading && !isError && data && activeFeature === 'divergenceTrend' && <DivergenceTrendResultView data={data} />}
          {!isLoading && !isError && data && activeFeature === 'btcCorrelation' && <BtcCorrelationResultView data={data} />}
        </ScrollView>
      )}
    </View>
  );
}

// ═══ FITUR 1: Identifikasi Tren ═══════════════════════════════════════════
function TrendResultView({ data }: { data: any }) {
  const isBull = data.classification?.startsWith('bullish');
  const isBear = data.classification?.startsWith('bearish');
  const color = isBull ? CYAN : isBear ? MAGENTA : NEUTRAL;
  const label: Record<string, string> = { bullish: 'BULLISH', bullish_strong: 'BULLISH STRONG', bearish: 'BEARISH', bearish_strong: 'BEARISH STRONG', none: 'BELUM ADA TREND' };
  return (
    <CyberCard accentColor={color} style={{ marginBottom: 12 }}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardTitle}>// IDENTIFIKASI TREN</Text>
        <CyberBadge label={label[data.classification] ?? data.classification} color={color} pulsing={isBull || isBear} />
      </View>
      <View style={styles.numRow}>
        <CyberBigNumber value={data.adx?.toFixed(1) ?? '—'} label="ADX(14)" color={color} />
        <View style={styles.statBox}>
          <Text style={[styles.statValue, { color }]}>{data.forceIndexValue?.toFixed(2) ?? '—'}</Text>
          <Text style={styles.statLabel}>FORCE INDEX</Text>
        </View>
      </View>
      {(data.reasoning ?? []).map((r: string, i: number) => (
        <Text key={i} style={styles.reasoningText}>{r}</Text>
      ))}
    </CyberCard>
  );
}

// ═══ FITUR 2: Multi-TF Reading ═════════════════════════════════════════════
function MultiTfResultView({ data }: { data: any[] }) {
  return (
    <View>
      {data.map((pair, i) => {
        const color = pair.direction === 'bullish' ? CYAN : pair.direction === 'bearish' ? MAGENTA : NEUTRAL;
        return (
          <CyberCard key={i} accentColor={color} style={{ marginBottom: 12 }}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>{pair.pairLabel}</Text>
              <CyberBadge label={pair.triggered ? pair.direction?.toUpperCase() : 'BELUM TRIGGER'} color={color} pulsing={pair.triggered} />
            </View>
            <Text style={styles.reasoningText}>{pair.interpretation}</Text>
            <View style={styles.numRow}>
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: CYAN }]}>{pair.higherTF.adx.toFixed(1)}</Text>
                <Text style={styles.statLabel}>{pair.higherTF.tf} · ADX</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: MAGENTA }]}>{pair.lowerTF.adx.toFixed(1)}</Text>
                <Text style={styles.statLabel}>{pair.lowerTF.tf} · ADX</Text>
              </View>
            </View>
            <Text style={styles.tfDetail}>{pair.higherTF.tf}: FI {pair.higherTF.forceIndexValue.toFixed(2)}, RSI {pair.higherTF.rsi.toFixed(1)}</Text>
            <Text style={styles.tfDetail}>{pair.lowerTF.tf}: FI {pair.lowerTF.forceIndexValue.toFixed(2)}, RSI {pair.lowerTF.rsi.toFixed(1)}</Text>
          </CyberCard>
        );
      })}
    </View>
  );
}

// ═══ FITUR 5: Long-Short Score ═════════════════════════════════════════════
function LongShortSideCard({ title, side, max }: { title: string; side: any; max: number }) {
  const grade: string = side?.grade ?? 'Tidak layak';
  const color = grade === 'A+' ? CYAN : grade === 'B' ? AMBER : MAGENTA;
  return (
    <CyberCard accentColor={color} style={{ marginBottom: 12 }}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardTitle}>// {title}</Text>
        <CyberBadge label={grade === 'Tidak layak' ? 'TIDAK LAYAK' : `GRADE ${grade}`} color={color} pulsing={grade === 'A+'} />
      </View>
      <View style={styles.numRow}>
        <CyberBigNumber value={`${side?.score ?? 0}`} label={`DARI MAKS ${max}`} color={color} fontSize={32} />
      </View>
      {(side?.components ?? []).map((c: any) => (
        <View key={c.key} style={{ marginTop: 8 }}>
          <View style={styles.divRow}>
            <Text style={styles.divRowLabel}>{c.label}</Text>
            <CyberBadge label={`${c.points > 0 ? '+' : ''}${c.points}`} color={c.points > 0 ? CYAN : c.points < 0 ? MAGENTA : NEUTRAL} pulsing={false} />
          </View>
          <Text style={styles.tfDetail}>{c.detail}</Text>
        </View>
      ))}
    </CyberCard>
  );
}

function LongShortScoreResultView({ data }: { data: any }) {
  return (
    <View>
      <LongShortSideCard title="SKOR LONG" side={data.long} max={data.maxScore ?? 9} />
      <LongShortSideCard title="SKOR SHORT (kebalikan long)" side={data.short} max={data.maxScore ?? 9} />
      {(data.notes ?? []).map((t: string, i: number) => <Text key={`n${i}`} style={[styles.tfDetail, { fontStyle: 'italic', marginBottom: 6 }]}>{t}</Text>)}
    </View>
  );
}

// ═══ PRICE ACTION: Struktur + SNR kuat + OB / SND / Imbalance ════════════════
const fmtP = (v: number | undefined | null): string =>
  v == null ? '—' : v >= 100 ? v.toFixed(2) : v >= 1 ? v.toFixed(4) : v.toPrecision(4);

function SnrZonesResultView({ data }: { data: any }) {
  const st = data.structure ?? {};
  const bias: string = st.bias ?? 'sideways';
  const color = bias === 'bullish' ? CYAN : bias === 'bearish' ? MAGENTA : bias === 'transition' ? AMBER : NEUTRAL;
  const biasLabel: Record<string, string> = { bullish: 'BULLISH', bearish: 'BEARISH', sideways: 'SIDEWAY', transition: 'TRANSISI' };
  const zoneRow = (key: string, z: any) => (
    <View key={key} style={styles.divRow}>
      <Text style={styles.divRowLabel}>
        {z.kind} {z.side === 'demand' ? 'DEMAND' : 'SUPPLY'} {fmtP(z.low)} – {fmtP(z.high)}
      </Text>
      <CyberBadge label={z.inside ? 'DI DALAM ZONA' : `${z.distancePct.toFixed(2)}%`} color={z.side === 'demand' ? CYAN : MAGENTA} pulsing={z.inside} />
    </View>
  );
  const nv = data.narrative;
  const narrativeBlock = nv ? (
    <CyberCard accentColor={color} style={{ marginBottom: 12 }}>
      <Text style={styles.cardTitle}>// RINGKASAN {data.tf}</Text>
      <Text style={[styles.reasoningText, { marginTop: 0, marginBottom: 10 }]}>{nv.headline}</Text>

      <Text style={styles.divRowLabel}>Yang terjadi</Text>
      {(nv.kejadian ?? []).map((t: string, i: number) => <Text key={`kj${i}`} style={styles.tfDetail}>• {t}</Text>)}

      <Text style={[styles.divRowLabel, { marginTop: 10 }]}>Struktur sekarang</Text>
      {(nv.strukturSekarang ?? []).map((t: string, i: number) => <Text key={`ss${i}`} style={styles.tfDetail}>• {t}</Text>)}

      <Text style={[styles.divRowLabel, { marginTop: 10 }]}>Level terbaru</Text>
      <Text style={styles.tfDetail}>Resistance: {(nv.levelTerbaru?.resistance ?? []).join('  |  ') || 'belum ada'}</Text>
      <Text style={styles.tfDetail}>Support: {(nv.levelTerbaru?.support ?? []).join('  |  ') || 'belum ada'}</Text>

      <Text style={[styles.divRowLabel, { marginTop: 10 }]}>Skenario</Text>
      {(nv.skenario ?? []).map((sc: any, i: number) => (
        <Text key={`sc${i}`} style={styles.tfDetail}>• {sc.nama}{sc.utama ? ' (utama)' : ''} — trigger: {sc.trigger} → target: {sc.target}</Text>
      ))}

      <Text style={[styles.divRowLabel, { marginTop: 10 }]}>Update entry</Text>
      {(nv.entry ?? []).map((e: any, i: number) => (
        <Text key={`en${i}`} style={styles.tfDetail}>• {e.arah} {e.tipe}{e.searahStruktur ? ' (searah struktur)' : ' (lawan struktur)'}: {e.kondisi}. Entry {e.entry}, SL {e.sl}, TP {e.tp}.</Text>
      ))}
      {(nv.catatan ?? []).map((t: string, i: number) => <Text key={`ct${i}`} style={[styles.tfDetail, { fontStyle: 'italic' }]}>{t}</Text>)}
    </CyberCard>
  ) : null;

  return (
    <View>
      {narrativeBlock}
      <CyberCard accentColor={color} style={{ marginBottom: 12 }}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>// STRUKTUR {data.tf} ({data.candlesUsed} candle)</Text>
          <CyberBadge label={biasLabel[bias] ?? bias.toUpperCase()} color={color} pulsing={bias === 'transition'} />
        </View>
        <Text style={[styles.reasoningText, { marginTop: 0 }]}>{st.note}</Text>
        <Text style={styles.tfDetail}>Harga {fmtP(data.currentPrice)} · ATR14 {fmtP(data.atr)}</Text>
        <Text style={styles.tfDetail}>Swing: {(st.swingSequence ?? []).map((s: string) => { const [l, v] = s.split(' '); return `${l} ${fmtP(parseFloat(v!))}`; }).join(' → ') || '—'}</Text>
      </CyberCard>

      <CyberCard accentColor={AMBER} style={{ marginBottom: 12 }}>
        <Text style={styles.cardTitle}>// SNR KUAT (min 2 sentuhan)</Text>
        {(data.resistances ?? []).length === 0 && (data.supports ?? []).length === 0 && <Text style={styles.tfDetail}>Belum ada level dengan 2 sentuhan.</Text>}
        {[...(data.resistances ?? [])].reverse().map((l: any, i: number) => (
          <View key={`r${i}`} style={styles.divRow}>
            <Text style={styles.divRowLabel}>R {fmtP(l.zoneLow)} – {fmtP(l.zoneHigh)} ({l.touches}x)</Text>
            <CyberBadge label={`+${l.distancePct.toFixed(2)}%`} color={MAGENTA} pulsing={false} />
          </View>
        ))}
        {(data.supports ?? []).map((l: any, i: number) => (
          <View key={`s${i}`} style={styles.divRow}>
            <Text style={styles.divRowLabel}>S {fmtP(l.zoneLow)} – {fmtP(l.zoneHigh)} ({l.touches}x)</Text>
            <CyberBadge label={`-${l.distancePct.toFixed(2)}%`} color={CYAN} pulsing={false} />
          </View>
        ))}
      </CyberCard>

      <CyberCard accentColor={CYAN} style={{ marginBottom: 12 }}>
        <Text style={styles.cardTitle}>// ORDER BLOCK</Text>
        {(data.orderBlocks ?? []).length === 0 ? <Text style={styles.tfDetail}>Tidak ada OB valid yang belum termitigasi.</Text>
          : (data.orderBlocks ?? []).map((z: any, i: number) => zoneRow(`ob${i}`, z))}
      </CyberCard>

      <CyberCard accentColor={MAGENTA} style={{ marginBottom: 12 }}>
        <Text style={styles.cardTitle}>// SUPPLY & DEMAND</Text>
        {(data.supplyDemand ?? []).length === 0 ? <Text style={styles.tfDetail}>Tidak ada zona SND yang belum tertembus.</Text>
          : (data.supplyDemand ?? []).map((z: any, i: number) => zoneRow(`snd${i}`, z))}
      </CyberCard>

      <CyberCard accentColor={NEUTRAL} style={{ marginBottom: 12 }}>
        <Text style={styles.cardTitle}>// IMBALANCE (FVG)</Text>
        {(data.imbalances ?? []).length === 0 ? <Text style={styles.tfDetail}>Tidak ada FVG yang belum terisi penuh.</Text>
          : (data.imbalances ?? []).map((z: any, i: number) => (
            <View key={`fvg${i}`} style={styles.divRow}>
              <Text style={styles.divRowLabel}>{z.side === 'bullish' ? 'BULL' : 'BEAR'} {fmtP(z.low)} – {fmtP(z.high)} · terisi {z.filledPct}%</Text>
              <CyberBadge label={z.inside ? 'DI DALAM' : `${z.distancePct.toFixed(2)}%`} color={z.side === 'bullish' ? CYAN : MAGENTA} pulsing={z.inside} />
            </View>
          ))}
      </CyberCard>
    </View>
  );
}

// ═══ FITUR 6: Divergence & Kekuatan Trend ══════════════════════════════════
function DivergenceBadgeRow({ label, div }: { label: string; div: { bullish: boolean; bearish: boolean } }) {
  const status = div.bullish ? 'BULLISH' : div.bearish ? 'BEARISH' : 'NONE';
  const color = div.bullish ? CYAN : div.bearish ? MAGENTA : NEUTRAL;
  return (
    <View style={styles.divRow}>
      <Text style={styles.divRowLabel}>{label}</Text>
      <CyberBadge label={status} color={color} pulsing={div.bullish || div.bearish} />
    </View>
  );
}

function DivergenceTrendResultView({ data }: { data: any }) {
  const ts = data.trendStrength ?? {};
  const oi = data.oiPriceVolumeFunding ?? {};
  const trendColor = ts.adxClassification === 'sangat kuat' ? CYAN : ts.adxClassification === 'kuat' ? AMBER : NEUTRAL;

  const scenarioColor: Record<string, string> = {
    long_baru_masuk: CYAN, short_covering: AMBER, short_baru_masuk: MAGENTA, long_nutup_posisi: AMBER, netral: NEUTRAL,
  };
  const scenarioLabel: Record<string, string> = {
    long_baru_masuk: 'LONG BARU MASUK', short_covering: 'SHORT COVERING',
    short_baru_masuk: 'SHORT BARU MASUK', long_nutup_posisi: 'LONG NUTUP POSISI', netral: 'NETRAL',
  };

  return (
    <View>
      <CyberCard accentColor={MAGENTA} style={{ marginBottom: 12 }}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>// DIVERGENCE</Text>
        </View>
        <DivergenceBadgeRow label="RSI" div={data.rsiDivergence ?? { bullish: false, bearish: false }} />
        <DivergenceBadgeRow label="MACD" div={data.macdDivergence ?? { bullish: false, bearish: false }} />
        <DivergenceBadgeRow label="Volume" div={data.volumeDivergence ?? { bullish: false, bearish: false }} />
        <DivergenceBadgeRow label="Stochastic 5,3,3" div={data.stochasticDivergence ?? { bullish: false, bearish: false }} />
      </CyberCard>

      <CyberCard accentColor={trendColor} style={{ marginBottom: 12 }}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>// KEKUATAN TREND</Text>
          <CyberBadge label={(ts.adxClassification ?? '—').toUpperCase()} color={trendColor} pulsing={ts.adxClassification === 'sangat kuat'} />
        </View>
        <View style={styles.numRow}>
          <CyberBigNumber value={ts.adx?.toFixed(1) ?? '—'} label="ADX(14)" color={trendColor} />
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: ts.forceIndexDirection === 'bullish' ? CYAN : MAGENTA }]}>{ts.forceIndex?.toFixed(2) ?? '—'}</Text>
            <Text style={styles.statLabel}>FORCE INDEX</Text>
          </View>
        </View>
        <Text style={styles.tfDetail}>Volume: {ts.volumeRatio?.toFixed(2) ?? '—'}x MA20 ({ts.volumeTrend ?? '—'})</Text>
        <Text style={styles.tfDetail}>ATR: {ts.atrRatio?.toFixed(2) ?? '—'}x vs 10 candle lalu (volatilitas {ts.volatilityTrend ?? '—'})</Text>
      </CyberCard>

      <CyberCard accentColor={AMBER} style={{ marginBottom: 12 }}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>// OPEN INTEREST + FUNDING</Text>
        </View>
        {oi.d1 ? (
          <View style={{ marginBottom: 10 }}>
            <View style={styles.divRow}>
              <Text style={styles.divRowLabel}>D1</Text>
              <CyberBadge label={scenarioLabel[oi.d1.scenario] ?? oi.d1.scenario} color={scenarioColor[oi.d1.scenario] ?? NEUTRAL} pulsing={false} />
            </View>
            <Text style={styles.reasoningText}>{oi.d1.interpretation}</Text>
            <Text style={styles.tfDetail}>Price {oi.d1.priceChangePct >= 0 ? '+' : ''}{oi.d1.priceChangePct?.toFixed(2)}% · OI {oi.d1.oiChangePct >= 0 ? '+' : ''}{oi.d1.oiChangePct?.toFixed(2)}%</Text>
          </View>
        ) : <Text style={styles.tfDetail}>D1: data gak cukup</Text>}
        {oi.h4 ? (
          <View style={{ marginBottom: 10 }}>
            <View style={styles.divRow}>
              <Text style={styles.divRowLabel}>H4</Text>
              <CyberBadge label={scenarioLabel[oi.h4.scenario] ?? oi.h4.scenario} color={scenarioColor[oi.h4.scenario] ?? NEUTRAL} pulsing={false} />
            </View>
            <Text style={styles.reasoningText}>{oi.h4.interpretation}</Text>
            <Text style={styles.tfDetail}>Price {oi.h4.priceChangePct >= 0 ? '+' : ''}{oi.h4.priceChangePct?.toFixed(2)}% · OI {oi.h4.oiChangePct >= 0 ? '+' : ''}{oi.h4.oiChangePct?.toFixed(2)}%</Text>
          </View>
        ) : <Text style={styles.tfDetail}>H4: data gak cukup</Text>}
        <Text style={[styles.reasoningText, { marginTop: 4 }]}>{oi.fundingInterpretation}</Text>
      </CyberCard>
    </View>
  );
}

// ═══ FITUR 7: BTC Correlation ═══════════════════════════════════════════
function BtcCorrelationResultView({ data }: { data: any }) {
  const phaseColor = (data.phase ?? '').includes('BULLISH') || (data.phase ?? '').includes('SEHAT') ? CYAN
    : (data.phase ?? '').includes('WASPADA') || (data.phase ?? '').includes('TRANSISI') ? AMBER
    : (data.phase ?? '').includes('DOWNTREND') ? MAGENTA
    : NEUTRAL;

  const divRows = (label: string, tf: string, div: { bullish: boolean; bearish: boolean }) => (
    <View style={styles.divRow} key={`${label}-${tf}`}>
      <Text style={styles.divRowLabel}>{label} ({tf})</Text>
      <CyberBadge label={div.bullish ? 'BULLISH' : div.bearish ? 'BEARISH' : 'NONE'} color={div.bullish ? CYAN : div.bearish ? MAGENTA : NEUTRAL} pulsing={div.bullish || div.bearish} />
    </View>
  );

  const strengthBlock = (label: string, s: any) => (
    <View style={{ marginBottom: 10 }}>
      <Text style={[styles.divRowLabel, { marginBottom: 4 }]}>{label} — struktur {(s?.bias ?? '—').toString().toUpperCase()}{s?.structureNote ? ` (${s.structureNote})` : ''}</Text>
      <Text style={styles.tfDetail}>RSI {s?.rsi?.toFixed(1) ?? '—'} · MACD hist {s?.macdHistogram?.toFixed(1) ?? '—'} · ADX {s?.adx?.toFixed(1) ?? '—'} (+DI {s?.plusDI?.toFixed(1) ?? '—'}/-DI {s?.minusDI?.toFixed(1) ?? '—'})</Text>
      <Text style={styles.tfDetail}>EMA26/50/100: {s?.emaAlignment ?? '—'} · Stoch %K {s?.stochK?.toFixed(1) ?? '—'} · Vol {s?.volumeRatio?.toFixed(2) ?? '—'}x · ATR {s?.atrRatio?.toFixed(2) ?? '—'}x</Text>
    </View>
  );

  return (
    <View>
      <CyberCard accentColor={phaseColor} style={{ marginBottom: 12 }}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>// FASE BTC SAAT INI</Text>
        </View>
        <CyberBadge label={data.phase ?? '—'} color={phaseColor} pulsing />
        <Text style={[styles.reasoningText, { marginTop: 8 }]}>{data.phaseDetail}</Text>
        <Text style={[styles.tfDetail, { marginTop: 6 }]}>Harga sekarang: {data.currentPrice?.toFixed(0) ?? '—'}</Text>
      </CyberCard>

      <CyberCard accentColor={ACCENT} style={{ marginBottom: 12 }}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>// KEKUATAN TREND</Text>
        </View>
        {strengthBlock('D1', data.trendStrength?.d1)}
        {strengthBlock('H4', data.trendStrength?.h4)}
      </CyberCard>

      <CyberCard accentColor={MAGENTA} style={{ marginBottom: 12 }}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>// DIVERGENCE (D1 + H4)</Text>
        </View>
        {divRows('RSI', 'D1', data.divergence?.d1?.rsi ?? {})}
        {divRows('MACD', 'D1', data.divergence?.d1?.macd ?? {})}
        {divRows('Volume', 'D1', data.divergence?.d1?.volume ?? {})}
        {divRows('Stochastic', 'D1', data.divergence?.d1?.stochastic ?? {})}
        {divRows('ADX/DI', 'D1', data.divergence?.d1?.adxDi ?? {})}
        {divRows('OI', 'D1', data.divergence?.d1?.openInterest ?? {})}
        <View style={{ height: 8 }} />
        {divRows('RSI', 'H4', data.divergence?.h4?.rsi ?? {})}
        {divRows('MACD', 'H4', data.divergence?.h4?.macd ?? {})}
        {divRows('Volume', 'H4', data.divergence?.h4?.volume ?? {})}
        {divRows('Stochastic', 'H4', data.divergence?.h4?.stochastic ?? {})}
        {divRows('ADX/DI', 'H4', data.divergence?.h4?.adxDi ?? {})}
        {divRows('OI', 'H4', data.divergence?.h4?.openInterest ?? {})}
      </CyberCard>

      <CyberCard accentColor={AMBER} style={{ marginBottom: 12 }}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>// KEY LEVEL D1 (terdekat)</Text>
        </View>
        {(data.keyLevelsD1 ?? []).slice(0, 6).map((lvl: any, idx: number) => (
          <View style={styles.divRow} key={idx}>
            <Text style={styles.divRowLabel}>{lvl.type === 'resistance' ? 'Resistance' : 'Support'}</Text>
            <Text style={[styles.tfDetail, { marginTop: 0 }]}>{lvl.price?.toFixed(0)} ({lvl.touches}x)</Text>
          </View>
        ))}
        <View style={{ height: 10 }} />
        <Text style={[styles.divRowLabel, { marginBottom: 4 }]}>Level Fresh (belum teruji 2x, hati-hati)</Text>
        <View style={styles.divRow}>
          <Text style={styles.tfDetail}>Resistance</Text>
          <Text style={[styles.tfDetail, { marginTop: 0 }]}>{data.nearestLevelsD1?.resistance ? `${data.nearestLevelsD1.resistance.price?.toFixed(0)} (${data.nearestLevelsD1.resistance.touches}x)` : 'gak ada'}</Text>
        </View>
        <View style={styles.divRow}>
          <Text style={styles.tfDetail}>Support</Text>
          <Text style={[styles.tfDetail, { marginTop: 0 }]}>{data.nearestLevelsD1?.support ? `${data.nearestLevelsD1.support.price?.toFixed(0)} (${data.nearestLevelsD1.support.touches}x)` : 'gak ada'}</Text>
        </View>
      </CyberCard>

      <CyberCard accentColor={data.btcGold?.trend === 'bullish' ? CYAN : MAGENTA} style={{ marginBottom: 12 }}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>// BTC / GOLD (proxy PAXG)</Text>
          <CyberBadge label={(data.btcGold?.trend ?? '—').toUpperCase()} color={data.btcGold?.trend === 'bullish' ? CYAN : MAGENTA} pulsing={false} />
        </View>
        <Text style={styles.reasoningText}>{data.btcGold?.interpretation}</Text>
      </CyberCard>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2, marginBottom: 12 },
  inputArea: { flexDirection: 'row', gap: 8 },
  inputBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, height: 40 },
  inputText: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
  analyzeBtn: { paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  analyzeBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptySub: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center' },
  scrollContent: { padding: 16, paddingBottom: 48 },
  tfRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  tfChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  tfChipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, borderWidth: 1, padding: 12, marginTop: 8 },
  errorText: { fontSize: 13, fontFamily: 'Inter_500Medium', flex: 1 },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { color: '#00FFF0', fontSize: 11, fontFamily: 'Courier', letterSpacing: 1.5, fontWeight: '700' },
  numRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4, marginBottom: 8 },
  statBox: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 16, fontFamily: 'Courier', fontWeight: '700' },
  statLabel: { fontSize: 10, color: '#B8AEC9', marginTop: 4, fontWeight: '600', letterSpacing: 0.3 },
  reasoningText: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 6, lineHeight: 19, color: '#D8D0E4' },
  tfDetail: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4, color: '#B8AEC9' },
  divRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  divRowLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#D8D0E4' },
});