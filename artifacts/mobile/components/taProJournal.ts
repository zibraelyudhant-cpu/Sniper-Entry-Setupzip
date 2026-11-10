import type { JournalEntry } from '../app/(tabs)/journal-helpers';

// Skor TA PRO (Fitur 5) -> field Jurnal. Skor DIHITUNG SERVER SAAT SINYAL DIBUAT (field `taPro`
// di hasil scan/analisa) lalu dibawa apa adanya ke sini, jadi Journal = persis kondisi pas sinyal.
// Tidak ada fetch ulang saat simpan. Kalau sinyal belum punya `taPro` (mis. data lama), field kosong.
// v4 (2026-11-11): + maksimal & persen per sisi, sisi searah sinyal, angka mentah.
export type TaProJournalFields = Partial<Pick<JournalEntry,
  'taLongScore' | 'taLongGrade' | 'taShortScore' | 'taShortGrade' | 'taLongPts' | 'taShortPts' | 'taScoreAt' | 'taScoreVer' | 'taMaxScore'
  | 'taLongMax' | 'taLongPct' | 'taShortMax' | 'taShortPct' | 'taSignalSide'
  | 'taRawFundingPct' | 'taRawLsr' | 'taRawOiChgPct' | 'taRawPriceChg24hPct'
  | 'taRawLongDistSrAtr' | 'taRawLongDistEmaAtr' | 'taRawShortDistSrAtr' | 'taRawShortDistEmaAtr'>>;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function taProFieldsFromSnapshot(snap: any, bias?: 'bullish' | 'bearish'): TaProJournalFields {
  if (!snap?.long || !snap?.short) return {};
  const lr = snap.long.raw ?? {}, sr = snap.short.raw ?? {};
  return {
    taLongScore: snap.long.score, taLongGrade: snap.long.grade, taLongPts: snap.long.pts,
    taShortScore: snap.short.score, taShortGrade: snap.short.grade, taShortPts: snap.short.pts,
    taScoreAt: snap.at,
    taScoreVer: typeof snap.v === 'number' ? snap.v : 1, // 1 = H4+H1, 2 = H4+M30+lokasi H4, 3 = D1+H1+lokasi H4, 4 = maks 8 + grade persen
    taMaxScore: typeof snap.maxScore === 'number' ? snap.maxScore : 9,
    taLongMax: num(snap.long.max), taLongPct: num(snap.long.pct), taShortMax: num(snap.short.max), taShortPct: num(snap.short.pct),
    taSignalSide: bias === 'bullish' ? 'LONG' : bias === 'bearish' ? 'SHORT' : undefined,
    taRawFundingPct: num(lr.fundingPct), taRawLsr: num(lr.lsr), taRawOiChgPct: num(lr.oiChgPct), taRawPriceChg24hPct: num(lr.priceChg24hPct),
    taRawLongDistSrAtr: num(lr.distSrAtr), taRawLongDistEmaAtr: num(lr.distEmaAtr), taRawShortDistSrAtr: num(sr.distSrAtr), taRawShortDistEmaAtr: num(sr.distEmaAtr),
  };
}
