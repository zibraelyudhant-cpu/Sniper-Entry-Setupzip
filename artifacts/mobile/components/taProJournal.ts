import { customFetch } from '@workspace/api-client-react';
import type { JournalEntry } from '../app/(tabs)/journal-helpers';

// Skor TA PRO (Fitur 5) -> field Jurnal. INFO SAJA: gagal fetch = field kosong,
// sinyal tetap kesimpen. Dipakai buat analisa nanti: grade vs WIN/LOSE.
export type TaProJournalFields = Pick<JournalEntry,
  'taLongScore' | 'taLongGrade' | 'taShortScore' | 'taShortGrade' | 'taLongPts' | 'taShortPts' | 'taScoreAt'>;

const KEYS = ['structH4', 'structH1', 'oi', 'lsr', 'funding'];

function pts(side: any): string | undefined {
  const comps: any[] = side?.components ?? [];
  if (!comps.length) return undefined;
  // format: structH4:+2|structH1:0|oi:+2|lsr:+1|funding:0 (x = data tidak tersedia)
  return KEYS.map(k => {
    const c = comps.find(x => x.key === k);
    if (!c) return `${k}:x`;
    if (!c.available) return `${k}:x`;
    return `${k}:${c.points > 0 ? '+' : ''}${c.points}`;
  }).join('|');
}

export async function fetchTaProJournalFields(symbol: string): Promise<TaProJournalFields> {
  try {
    const d: any = await customFetch<any>(`/api/technical-analysis-pro/long-short-score?symbol=${encodeURIComponent(symbol)}`);
    if (!d?.long || !d?.short) return {};
    return {
      taLongScore: d.long.score, taLongGrade: d.long.grade,
      taShortScore: d.short.score, taShortGrade: d.short.grade,
      taLongPts: pts(d.long), taShortPts: pts(d.short),
      taScoreAt: Date.now(),
    };
  } catch { return {}; }
}

/** Banyak koin sekaligus (batch kecil biar gak kena rate limit Binance). */
export async function fetchTaProJournalFieldsMany(symbols: string[]): Promise<Map<string, TaProJournalFields>> {
  const out = new Map<string, TaProJournalFields>();
  const uniq = Array.from(new Set(symbols));
  const BATCH = 3;
  for (let i = 0; i < uniq.length; i += BATCH) {
    const chunk = uniq.slice(i, i + BATCH);
    const res = await Promise.all(chunk.map(s => fetchTaProJournalFields(s)));
    chunk.forEach((s, j) => out.set(s, res[j]!));
    if (i + BATCH < uniq.length) await new Promise(r => setTimeout(r, 250));
  }
  return out;
}
