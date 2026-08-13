import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export interface MarketStructureV2Result {
  classification: 'bullish_strong' | 'bullish_weak' | 'bearish_strong' | 'bearish_weak' | 'sideways' | 'transition';
  bias: 'bullish' | 'bearish' | 'sideways';
  bullishTotal: number;
  bearishTotal: number;
  sidewaysTotal: number;
  structureBullishScore: number;
  structureBearishScore: number;
  breakQualityLabel: string;
  breakQualityPoints: number;
  bullishRetraceScore: number;
  bearishReboundScore: number;
  rangePosition: number;
  candleCountUsed: number;
  passes: number;
  reasoning: string[];
}

const CLASSIFICATION_META: Record<MarketStructureV2Result['classification'], { label: string; color: string }> = {
  bullish_strong: { label: 'BULLISH KUAT', color: '#22C55E' },
  bullish_weak: { label: 'BULLISH LEMAH', color: '#86EFAC' },
  bearish_strong: { label: 'BEARISH KUAT', color: '#EF4444' },
  bearish_weak: { label: 'BEARISH LEMAH', color: '#FCA5A5' },
  sideways: { label: 'SIDEWAYS', color: '#94A3B8' },
  transition: { label: 'TRANSISI / UNCLEAR', color: '#FBBF24' },
};

/**
 * Card Market Structure V2 — primary gate basis Skill 15M (request user).
 * Dipake di 5 menu skill (technicalSnapshot-style: data.marketStructureV2)
 * DAN Menu 3 Multi-TF (mode compact, 1 per TF). Kalau data null/undefined
 * (misal STRUCTURE_V2_ENABLED dimatiin di backend), komponen gak render apa-apa.
 */
export function MarketStructureV2Card({ data, compact = false }: {
  data?: MarketStructureV2Result | null;
  compact?: boolean;
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  if (!data) return null;

  const meta = CLASSIFICATION_META[data.classification];
  const maxScoreGuess = 11; // structure(6) + breakQuality(2) + retrace(2) + position(1) — buat proporsi bar visual doang

  if (compact) {
    return (
      <View style={[styles.compactBadge, { backgroundColor: `${meta.color}18`, borderColor: meta.color }]}>
        <View style={[styles.compactDot, { backgroundColor: meta.color }]} />
        <Text style={[styles.compactText, { color: meta.color }]}>{meta.label}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable onPress={() => setExpanded(v => !v)}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.mutedForeground }]}>MARKET STRUCTURE V2</Text>
          <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.mutedForeground} />
        </View>

        <View style={[styles.classBadge, { backgroundColor: `${meta.color}18`, borderColor: meta.color }]}>
          <Text style={[styles.classBadgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>

        {/* 3-way score bar — bullish vs bearish vs sideways, proporsi visual doang */}
        <View style={styles.scoreRow}>
          <View style={styles.scoreItem}>
            <Text style={[styles.scoreLabel, { color: colors.bullish }]}>BULLISH</Text>
            <Text style={[styles.scoreValue, { color: colors.bullish }]}>{data.bullishTotal}</Text>
            <View style={[styles.scoreBarTrack, { backgroundColor: colors.border }]}>
              <View style={[styles.scoreBarFill, { width: `${Math.min(100, (data.bullishTotal / maxScoreGuess) * 100)}%`, backgroundColor: colors.bullish }]} />
            </View>
          </View>
          <View style={styles.scoreItem}>
            <Text style={[styles.scoreLabel, { color: colors.bearish }]}>BEARISH</Text>
            <Text style={[styles.scoreValue, { color: colors.bearish }]}>{data.bearishTotal}</Text>
            <View style={[styles.scoreBarTrack, { backgroundColor: colors.border }]}>
              <View style={[styles.scoreBarFill, { width: `${Math.min(100, (data.bearishTotal / maxScoreGuess) * 100)}%`, backgroundColor: colors.bearish }]} />
            </View>
          </View>
          <View style={styles.scoreItem}>
            <Text style={[styles.scoreLabel, { color: '#94A3B8' }]}>SIDEWAYS</Text>
            <Text style={[styles.scoreValue, { color: '#94A3B8' }]}>{data.sidewaysTotal}</Text>
            <View style={[styles.scoreBarTrack, { backgroundColor: colors.border }]}>
              <View style={[styles.scoreBarFill, { width: `${Math.min(100, (data.sidewaysTotal / 9) * 100)}%`, backgroundColor: '#94A3B8' }]} />
            </View>
          </View>
        </View>
      </Pressable>

      {expanded && (
        <View style={styles.detail}>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <DetailRow label="Structure score (bull/bear)" value={`${data.structureBullishScore}/6 — ${data.structureBearishScore}/6`} colors={colors} />
          <DetailRow label="Break quality" value={`${data.breakQualityLabel} (+${data.breakQualityPoints})`} colors={colors} />
          <DetailRow label="Retrace/Rebound score" value={`${data.bullishRetraceScore} — ${data.bearishReboundScore}`} colors={colors} />
          <DetailRow label="Posisi harga di range" value={`${(data.rangePosition * 100).toFixed(0)}%`} colors={colors} />
          <DetailRow label="Candle dipake" value={`${data.candleCountUsed} (${data.passes === 2 ? '2 pass adaptif' : '1 pass'})`} colors={colors} />
          {data.reasoning.length > 0 && (
            <>
              <Text style={[styles.reasoningTitle, { color: colors.mutedForeground }]}>REASONING</Text>
              {data.reasoning.map((r, i) => (
                <Text key={i} style={[styles.reasoningText, { color: colors.mutedForeground }]}>• {r}</Text>
              ))}
            </>
          )}
          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            V2 = penentu utama arah struktur (bisa nge-block sinyal kalau gak sejalan). Sistem lama cuma jadi pembanding (soft-warning) di detail konfirmasi, gak nge-block apapun.
          </Text>
        </View>
      )}
    </View>
  );
}

function DetailRow({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  classBadge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 10 },
  classBadgeText: { fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 },
  scoreRow: { flexDirection: 'row', gap: 10 },
  scoreItem: { flex: 1 },
  scoreLabel: { fontSize: 8, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.3 },
  scoreValue: { fontSize: 14, fontFamily: 'Inter_700Bold', marginTop: 1 },
  scoreBarTrack: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 4 },
  scoreBarFill: { height: '100%', borderRadius: 2 },
  detail: { marginTop: 4 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  detailLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  detailValue: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  reasoningTitle: { fontSize: 9, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5, marginTop: 8, marginBottom: 4 },
  reasoningText: { fontSize: 10, fontFamily: 'Inter_400Regular', lineHeight: 15, marginBottom: 2 },
  note: { fontSize: 9, fontFamily: 'Inter_400Regular', marginTop: 8, fontStyle: 'italic', lineHeight: 13 },
  compactBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' },
  compactDot: { width: 5, height: 5, borderRadius: 2.5 },
  compactText: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },
});