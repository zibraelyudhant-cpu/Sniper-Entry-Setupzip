import { Router } from 'express';
import { db, journalEntriesTable } from '@workspace/db';
import { sql } from 'drizzle-orm';

// ═══════════════════════════════════════════════════════════════════════════
// Jurnal di server (v25, request user 2026-11-11). Tanpa login: server ini dipakai satu orang,
// jadi semua HP berbagi satu jurnal. HP mengirim perubahan (upsert / hapus) di latar belakang,
// dan saat aplikasi dibuka HP mengambil semua lalu menggabungkan per id (updatedAt terbaru menang).
// ═══════════════════════════════════════════════════════════════════════════
const router = Router();

type SyncItem = { id: string; updatedAt: number; deleted?: boolean; data?: unknown };

// POST /api/journal-sync  body: { items: SyncItem[] }  (maks 100 per request)
router.post('/journal-sync', async (req, res) => {
  const items = (req.body as { items?: SyncItem[] })?.items;
  if (!Array.isArray(items)) { res.status(400).json({ error: 'items wajib array' }); return; }
  if (items.length > 100) { res.status(400).json({ error: 'maks 100 item per request' }); return; }
  try {
    let written = 0;
    for (const it of items) {
      if (!it || typeof it.id !== 'string' || !it.id || typeof it.updatedAt !== 'number') continue;
      const deleted = it.deleted === true;
      const data = deleted ? (it.data ?? { id: it.id }) : it.data;
      if (data === undefined || data === null) continue;
      // upsert, hanya menimpa kalau versi yang masuk lebih baru (atau sama dan menandai hapus)
      const r = await db.insert(journalEntriesTable)
        .values({ id: it.id, data, updatedAtMs: it.updatedAt, deleted })
        .onConflictDoUpdate({
          target: journalEntriesTable.id,
          set: { data: sql`excluded.data`, updatedAtMs: sql`excluded.updated_at_ms`, deleted: sql`excluded.deleted`, updatedAt: sql`now()` },
          setWhere: sql`excluded.updated_at_ms > ${journalEntriesTable.updatedAtMs} OR (excluded.updated_at_ms = ${journalEntriesTable.updatedAtMs} AND excluded.deleted = true)`,
        })
        .returning({ id: journalEntriesTable.id });
      written += r.length;
    }
    res.json({ ok: true, received: items.length, written });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /api/journal-sync  -> semua entri (termasuk tanda hapus) untuk digabung di HP
router.get('/journal-sync', async (_req, res) => {
  try {
    const rows = await db.select({ id: journalEntriesTable.id, data: journalEntriesTable.data, updatedAtMs: journalEntriesTable.updatedAtMs, deleted: journalEntriesTable.deleted }).from(journalEntriesTable);
    res.json({ items: rows.map(r => ({ id: r.id, updatedAt: r.updatedAtMs, deleted: r.deleted, data: r.deleted ? undefined : r.data })) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
