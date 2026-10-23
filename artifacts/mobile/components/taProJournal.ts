import type { JournalEntry } from '../app/(tabs)/journal-helpers';

// Skor TA PRO (Fitur 5) -> field Jurnal. Skor DIHITUNG SERVER SAAT SINYAL DIBUAT (field `taPro`
// di hasil scan/analisa) lalu dibawa apa adanya ke sini, jadi Journal = persis kondisi pas sinyal.
// Tidak ada fetch ulang saat simpan. Kalau sinyal belum punya `taPro` (mis. data lama), field kosong.
export type TaProJournalFields = Pick<JournalEntry,
  'taLongScore' | 'taLongGrade' | 'taShortScore' | 'taShortGrade' | 'taLongPts' | 'taShortPts' | 'taScoreAt'>;

export function taProFieldsFromSnapshot(snap: any): TaProJournalFields {
  if (!snap?.long || !snap?.short) return {};
  return {
    taLongScore: snap.long.score, taLongGrade: snap.long.grade, taLongPts: snap.long.pts,
    taShortScore: snap.short.score, taShortGrade: snap.short.grade, taShortPts: snap.short.pts,
    taScoreAt: snap.at,
  };
}
