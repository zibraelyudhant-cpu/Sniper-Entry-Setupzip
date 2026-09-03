import { Router } from 'express';
import { db, signalFollowupsTable } from '@workspace/db';
import { eq, inArray, and, lte } from 'drizzle-orm';

const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
const router = Router();

const FOLLOWUP_DELAY_MS = 60 * 60 * 1000; // 1 jam (request user)
const SIGNIFICANT_ATR_RATIO = 0.5; // pergerakan >= 0.5x ATR struktur = signifikan (keputusan diambil sepihak, konsisten basis ATR-relative dipake di seluruh sistem SL/TP)

/**
 * POST /api/journal/register-followup — mobile Journal DAFTARIN sinyal yang
 * BARU RESOLVE (SL/TP kena) ke sini. Server bakal cek harga 1 jam kemudian
 * via background worker (checkPendingFollowups, dipanggil scheduled interval
 * di index.ts). idempotent — kalau journalEntryId udah pernah didaftarin,
 * di-skip (bukan error), biar mobile bisa retry aman tanpa duplikat.
 */
router.post('/journal/register-followup', async (req, res) => {
  const body = req.body as {
    journalEntryId: string;
    symbol: string;
    bias: 'bullish' | 'bearish';
    sourceMenu: string;
    sourceSkill: string;
    resolvedStatus: 'win_tp1' | 'win_tp2' | 'lose';
    resolvedPrice: number;
    resolvedAt: number; // unix ms
    atrStrukturAtSignal?: number;
  };

  if (!body.journalEntryId || !body.symbol || !body.bias || !body.resolvedStatus || body.resolvedPrice === undefined || !body.resolvedAt) {
    res.status(400).json({ error: 'journalEntryId, symbol, bias, resolvedStatus, resolvedPrice, resolvedAt required' });
    return;
  }

  try {
    const existing = await db.select().from(signalFollowupsTable).where(eq(signalFollowupsTable.journalEntryId, body.journalEntryId)).limit(1);
    if (existing.length > 0) {
      res.json({ status: 'already_registered' });
      return;
    }

    await db.insert(signalFollowupsTable).values({
      journalEntryId: body.journalEntryId,
      symbol: body.symbol.toUpperCase(),
      bias: body.bias,
      sourceMenu: body.sourceMenu,
      sourceSkill: body.sourceSkill,
      resolvedStatus: body.resolvedStatus,
      resolvedPrice: body.resolvedPrice,
      resolvedAt: new Date(body.resolvedAt),
      atrStrukturAtSignal: body.atrStrukturAtSignal ?? null,
      isPending: true,
    });

    res.json({ status: 'registered' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/journal/followups?ids=id1,id2,id3 — mobile Journal FETCH hasil
 * followup buat entry-entry yang udah didaftarin. Return array (yang belum
 * checkedAt bakal null di field verdict-nya — mobile UI tampilin "masih
 * dipantau").
 */
router.get('/journal/followups', async (req, res) => {
  const idsParam = req.query['ids'] as string | undefined;
  if (!idsParam) {
    res.status(400).json({ error: 'ids required (comma-separated)' });
    return;
  }
  const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean);
  if (ids.length === 0) {
    res.json({ followups: [] });
    return;
  }

  try {
    const rows = await db.select().from(signalFollowupsTable).where(inArray(signalFollowupsTable.journalEntryId, ids));
    res.json({ followups: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * Hitung verdict berdasarkan bias, resolvedStatus, dan pergerakan harga.
 * Logic PERSIS sesuai skenario yang diminta user:
 * - LOSE + market BENERAN lanjut ke arah bias asli (>= 0.5x ATR) = struktur
 *   BENAR, SL cuma prematur/ketat (kandidat: perlonggar SL atau tunggu
 *   konfirmasi lebih matang sebelum entry)
 * - LOSE + market BALIK lagi searah bias asli / diem = struktur SALAH BACA,
 *   perlu evaluasi cara analisa struktur & area entry (SIS user)
 * - WIN TP2 + market TERUS lanjut searah (>= 0.5x ATR) = RR kekonservatifan,
 *   momentum masih ada — kandidat naikin RR default ke 1:3
 * - WIN TP2 + momentum udah habis/balik = RR udah pas, TP2 tepat waktu
 * - Pergerakan < 0.5x ATR di semua kasus = noise, gak cukup data buat verdict
 */
function computeFollowupVerdict(
  bias: 'bullish' | 'bearish',
  resolvedStatus: 'win_tp1' | 'win_tp2' | 'lose',
  priceChangeAtrRatio: number, // udah signed: positif = naik, negatif = turun
  hoursElapsed: number, // FIX: selisih jam ASLI dari resolvedAt sampe dicek — sinyal lama bisa jauh lebih dari 1 jam
): { verdict: string; verdictNote: string } {
  const dirMult = bias === 'bullish' ? 1 : -1;
  const movedTowardBias = priceChangeAtrRatio * dirMult; // positif = market lanjut SEARAH bias asli
  const isSignificant = Math.abs(priceChangeAtrRatio) >= SIGNIFICANT_ATR_RATIO;

  // Label waktu dinamis — "1 jam" cuma akurat kalau genuinely ~1 jam. Sinyal
  // LAMA (didaftarkan belakangan, resolvedAt udah lama) bakal langsung lolos
  // cutoff begitu didaftar, TAPI harga yang diambil itu HARGA SEKARANG, bukan
  // genuinely harga di 1 jam pasca-resolve — jujur kasih tau di teksnya.
  const timeLabel = hoursElapsed <= 1.5
    ? '1 jam kemudian'
    : hoursElapsed < 24
    ? `${hoursElapsed.toFixed(1)} jam kemudian (sinyal lama, bukan cek 1-jam-presisi)`
    : `${(hoursElapsed / 24).toFixed(1)} hari kemudian (sinyal lama, bukan cek 1-jam-presisi)`;

  if (!isSignificant) {
    return {
      verdict: 'noise_gak_signifikan',
      verdictNote: `Pergerakan ${timeLabel} cuma ${Math.abs(priceChangeAtrRatio).toFixed(2)}x ATR (di bawah threshold ${SIGNIFICANT_ATR_RATIO}x) — belum cukup signifikan buat disimpulkan, kemungkinan besar market lagi konsolidasi/sideways.`,
    };
  }

  if (resolvedStatus === 'lose') {
    if (movedTowardBias > 0) {
      return {
        verdict: 'struktur_benar_sl_prematur',
        verdictNote: `LOSE, TAPI ${timeLabel} market BENERAN lanjut ${bias === 'bullish' ? 'naik' : 'turun'} searah bias asli (${movedTowardBias.toFixed(2)}x ATR). Struktur/arah bacaan KEMUNGKINAN BESAR BENAR — SL kena duluan sebelum harga "confirm" ke arah yang benar. Kandidat evaluasi: SL terlalu ketat, atau perlu tunggu konfirmasi lebih matang sebelum entry (area entry-nya yang perlu dikembangkan).`,
      };
    } else {
      return {
        verdict: 'struktur_salah_konfirmasi',
        verdictNote: `LOSE, dan ${timeLabel} market TIDAK lanjut ke arah bias asli (malah balik/diam, ${movedTowardBias.toFixed(2)}x ATR). Ini KONFIRMASI struktur/bacaan arah KEMUNGKINAN BESAR SALAH, bukan cuma SL yang ketat. Perlu evaluasi cara analisa struktur market-nya.`,
      };
    }
  }

  // win_tp1 / win_tp2
  if (movedTowardBias > 0) {
    return {
      verdict: 'momentum_lanjut_rr_konservatif',
      verdictNote: `WIN, dan ${timeLabel} market TERUS lanjut ${bias === 'bullish' ? 'naik' : 'turun'} searah bias (${movedTowardBias.toFixed(2)}x ATR) — momentum masih ada saat TP kena. Kandidat: RR default kekonservatifan, TP kepotong duluan padahal momentum masih lanjut. Pertimbangkan naikin RR ke 1:3 buat kondisi/pola serupa.`,
    };
  } else {
    return {
      verdict: 'momentum_habis_rr_pas',
      verdictNote: `WIN, dan ${timeLabel} momentum udah habis/berbalik (${movedTowardBias.toFixed(2)}x ATR). TP di titik yang tepat — RR sekarang udah pas buat kondisi ini, gak perlu diperbesar.`,
    };
  }
}

/**
 * Dipanggil scheduled interval (lihat index.ts) — scan followup yang PENDING
 * dan udah lewat 1 jam dari resolvedAt, fetch harga sekarang, hitung verdict,
 * update row. EXPORTED biar bisa dipanggil dari index.ts.
 */
export async function checkPendingFollowups(): Promise<{ checked: number; errors: number }> {
  const cutoff = new Date(Date.now() - FOLLOWUP_DELAY_MS);
  const pending = await db.select().from(signalFollowupsTable).where(
    and(eq(signalFollowupsTable.isPending, true), lte(signalFollowupsTable.resolvedAt, cutoff))
  );

  let checked = 0, errors = 0;
  for (const row of pending) {
    try {
      const res = await fetch(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/price?symbol=${row.symbol}`);
      if (!res.ok) { errors++; continue; }
      const data = await res.json() as { price: string };
      const checkPrice1h = parseFloat(data.price);
      const priceChangePct = ((checkPrice1h - row.resolvedPrice) / row.resolvedPrice) * 100;
      const atr = row.atrStrukturAtSignal;
      const priceChangeAtrRatio = atr && atr > 0
        ? ((checkPrice1h - row.resolvedPrice) / atr) // signed
        : 0; // gak ada ATR tersimpan (sinyal lama sebelum fitur ini ada) — fallback 0, verdict bakal 'noise'

      // FIX (ketemu pas review — sinyal LAMA yang resolvedAt-nya udah lama
      // banget bakal langsung lolos syarat "udah lewat 1 jam" begitu
      // didaftarkan, TAPI harga yang diambil itu HARGA SEKARANG, bukan
      // genuinely harga 1 jam setelah resolve): hitung selisih jam ASLI,
      // kasih tau di verdictNote kalau ini BUKAN cek 1-jam-presisi.
      const hoursElapsed = (Date.now() - row.resolvedAt.getTime()) / (1000 * 60 * 60);

      const { verdict, verdictNote } = computeFollowupVerdict(
        row.bias as 'bullish' | 'bearish', row.resolvedStatus as 'win_tp1' | 'win_tp2' | 'lose', priceChangeAtrRatio, hoursElapsed
      );

      await db.update(signalFollowupsTable).set({
        checkedAt: new Date(),
        checkPrice1h,
        priceChangePct,
        priceChangeAtrRatio,
        verdict,
        verdictNote,
        isPending: false,
      }).where(eq(signalFollowupsTable.id, row.id));
      checked++;
    } catch {
      errors++;
    }
  }
  return { checked, errors };
}

export default router;