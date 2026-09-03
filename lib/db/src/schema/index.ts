// Export your models here. Add one export per file
// export * from "./posts";
//
// Each model/table should ideally be split into different files.
// Each model/table should define a Drizzle table, insert schema, and types:
//
//   import { pgTable, text, serial } from "drizzle-orm/pg-core";
//   import { createInsertSchema } from "drizzle-zod";
//   import { z } from "zod/v4";
//
//   export const postsTable = pgTable("posts", {
//     id: serial("id").primaryKey(),
//     title: text("title").notNull(),
//   });
//
//   export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true });
//   export type InsertPost = z.infer<typeof insertPostSchema>;
//   export type Post = typeof postsTable.$inferSelect;

import { pgTable, text, serial, real, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Signal Followups — request user, Menu Journal "AI Agent" yang analisa
 * OTOMATIS 1 jam SETELAH sinyal resolve (SL/TP kena): apakah market
 * BENERAN lanjut ke arah bias (struktur/entry kita udah benar, cuma
 * ke-SL duluan karena noise/terlalu ketat), atau BENERAN berbalik
 * (validasi struktur kita emang salah baca), atau — buat WIN TP2 —
 * apakah momentum MASIH LANJUT (kandidat naikin RR default).
 *
 * Server-side (BUKAN AsyncStorage mobile) karena background worker
 * butuh proses yang SELALU NYALA — mobile app gak reliable buat itu
 * (bisa ditutup/di-background OS kapan aja). Mobile Journal REGISTER
 * sinyal yang baru resolve ke sini, lalu FETCH hasilnya belakangan.
 */
export const signalFollowupsTable = pgTable("signal_followups", {
  id: serial("id").primaryKey(),
  journalEntryId: text("journal_entry_id").notNull().unique(), // link ke JournalEntry.id di mobile AsyncStorage
  symbol: text("symbol").notNull(),
  bias: text("bias").notNull(), // 'bullish' | 'bearish'
  sourceMenu: text("source_menu").notNull(),
  sourceSkill: text("source_skill").notNull(),

  resolvedStatus: text("resolved_status").notNull(), // 'win_tp1' | 'win_tp2' | 'lose'
  resolvedPrice: real("resolved_price").notNull(), // exitPrice pas SL/TP kena
  resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull(),

  // Basis threshold "signifikan" — ATR struktur DARI SINYAL ASLI (technicalSnapshot),
  // BUKAN ATR real-time saat followup — biar konsisten sama kondisi pas entry.
  atrStrukturAtSignal: real("atr_struktur_at_signal"),

  // Diisi background worker SETELAH 1 jam berlalu dari resolvedAt
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  checkPrice1h: real("check_price_1h"),
  priceChangePct: real("price_change_pct"), // (checkPrice1h - resolvedPrice) / resolvedPrice * 100
  priceChangeAtrRatio: real("price_change_atr_ratio"), // |checkPrice1h - resolvedPrice| / atrStrukturAtSignal — basis "signifikan" (request user, threshold 0.5x ATR)

  // Verdict computed otomatis oleh worker — lihat computeFollowupVerdict di route
  verdict: text("verdict"), // 'struktur_benar_sl_prematur' | 'struktur_salah_konfirmasi' | 'momentum_lanjut_rr_konservatif' | 'momentum_habis_rr_pas' | 'noise_gak_signifikan'
  verdictNote: text("verdict_note"), // penjelasan human-readable

  isPending: boolean("is_pending").notNull().default(true), // false setelah checkedAt terisi
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSignalFollowupSchema = createInsertSchema(signalFollowupsTable).omit({ id: true, createdAt: true });
export type InsertSignalFollowup = z.infer<typeof insertSignalFollowupSchema>;
export type SignalFollowup = typeof signalFollowupsTable.$inferSelect;