import { Router } from 'express';
import { analyzeTp3 } from '../lib/tp3';

const router = Router();

// GET /api/tp3?symbol=BTCUSDT&side=BUY&entry=..&sl=.. — TP3 SNR H1 (2688 candle), hanya dipanggil layar Analisa (±20 weight, cache 10 menit)
router.get('/tp3', async (req, res) => {
  try {
    const q = req.query as Record<string, unknown>;
    const symbol = String(q['symbol'] ?? '').toUpperCase();
    if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
    const sym = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
    const side = String(q['side'] ?? '').toUpperCase();
    if (side !== 'BUY' && side !== 'SELL') { res.status(400).json({ error: 'side harus BUY / SELL' }); return; }
    const entry = parseFloat(String(q['entry'] ?? '')), sl = parseFloat(String(q['sl'] ?? ''));
    if (![entry, sl].every(x => isFinite(x) && x > 0)) { res.status(400).json({ error: 'entry / sl harus angka > 0' }); return; }
    res.json(await analyzeTp3(sym, side, entry, sl));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
