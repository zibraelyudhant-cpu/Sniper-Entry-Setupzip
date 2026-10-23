import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { customFetch } from '@workspace/api-client-react';

const CYAN = '#00FFF0';
const MAGENTA = '#FF00E5';
const AMBER = '#FFD700';
const NEUTRAL = '#5B6478';

interface Props {
  symbol?: string | null;
  bias?: 'bullish' | 'bearish' | null; // arah sinyal menu (cuma buat nandain sisi yang searah)
}

const gradeColor = (g?: string) => (g === 'A+' ? CYAN : g === 'B' ? AMBER : MAGENTA);
const gradeText = (g?: string) => (g === 'A+' ? 'A+' : g === 'B' ? 'B' : 'Tidak layak');

/**
 * Info-only (BUKAN filter, gak nge-block sinyal): nampilin Skor Long/Short
 * Technical Analysis PRO (Fitur 5) di detail koin, supaya gak perlu cek manual
 * ke menu TA PRO. Fetch sendiri per koin pas detail dibuka.
 */
export function TaProScoreCard({ symbol, bias }: Props) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['ta-pro-score-card', symbol],
    queryFn: () => customFetch<any>(`/api/technical-analysis-pro/long-short-score?symbol=${encodeURIComponent(symbol ?? '')}`),
    enabled: !!symbol,
    staleTime: 60_000,
  });
  if (!symbol) return null;

  const side = (title: 'LONG' | 'SHORT', s: any) => {
    const highlight = (title === 'LONG' && bias === 'bullish') || (title === 'SHORT' && bias === 'bearish');
    const c = gradeColor(s?.grade);
    return (
      <View style={[styles.side, { borderColor: highlight ? c : `${NEUTRAL}55`, backgroundColor: highlight ? `${c}14` : 'transparent' }]}>
        <Text style={styles.sideTitle}>{title}{highlight ? ' • searah sinyal' : ''}</Text>
        <Text style={[styles.score, { color: c }]}>{s?.score ?? 0}<Text style={styles.max}> / {data?.maxScore ?? 9}</Text></Text>
        <Text style={[styles.grade, { color: c }]}>{gradeText(s?.grade)}</Text>
      </View>
    );
  };

  return (
    <View style={styles.card}>
      <Pressable onPress={() => setOpen(o => !o)} style={styles.header}>
        <Text style={styles.title}>TA PRO • SKOR (info)</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={14} color={NEUTRAL} />
      </Pressable>
      {isLoading ? <ActivityIndicator color={AMBER} style={{ marginVertical: 8 }} />
        : isError || !data ? <Text style={styles.detail}>Skor belum bisa dimuat.</Text>
        : (
          <>
            <View style={styles.row}>{side('LONG', data.long)}{side('SHORT', data.short)}</View>
            {open && ['long', 'short'].map(k => (
              <View key={k} style={{ marginTop: 8 }}>
                <Text style={styles.sideTitle}>{k === 'long' ? 'RINCIAN LONG' : 'RINCIAN SHORT'}</Text>
                {(data[k]?.components ?? []).map((c: any) => (
                  <Text key={`${k}-${c.key}`} style={styles.detail}>{c.points > 0 ? '+' : ''}{c.points}  {c.label}: {c.detail}</Text>
                ))}
              </View>
            ))}
            <Text style={[styles.detail, { marginTop: 6 }]}>Hanya informasi, tidak memblokir sinyal. Ketuk judul untuk rincian.</Text>
          </>
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: `${NEUTRAL}55`, borderRadius: 12, padding: 10, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.03)' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  title: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: NEUTRAL, letterSpacing: 0.8 },
  row: { flexDirection: 'row', gap: 8 },
  side: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 8, alignItems: 'center' },
  sideTitle: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: NEUTRAL, letterSpacing: 0.6 },
  score: { fontSize: 24, fontFamily: 'Inter_700Bold', marginTop: 2 },
  max: { fontSize: 11, color: NEUTRAL, fontFamily: 'Inter_400Regular' },
  grade: { fontSize: 12, fontFamily: 'Inter_700Bold', marginTop: 2 },
  detail: { fontSize: 10, fontFamily: 'Inter_400Regular', color: NEUTRAL, marginTop: 2 },
});
