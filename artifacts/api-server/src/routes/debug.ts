import { Router } from 'express';
import { emaCheck } from '../lib/smc';

const router = Router();

// GET /api/debug/ema-check?symbol=BTCUSDT — EMA800/1120 M15 & EMA50/200 H1 versi lama vs baru (v25)
router.get('/debug/ema-check', async (req, res) => {
  try {
    const raw = String(req.query['symbol'] ?? 'BTCUSDT').toUpperCase();
    const symbol = raw.endsWith('USDT') ? raw : `${raw}USDT`;
    res.json(await emaCheck(symbol));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

export default router;
