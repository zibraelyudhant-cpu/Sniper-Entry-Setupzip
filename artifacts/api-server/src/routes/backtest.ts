import { Router } from 'express';
import { runBacktest } from '../lib/smc';

const router = Router();

// POST /api/backtest
router.post('/backtest', async (req, res) => {
  const { symbol, period, menu } = req.body as {
    symbol: string;
    period: '1m' | '3m' | '6m' | '1y';
    menu: 'sniper' | 'breakout' | 'both';
  };

  if (!symbol || !period || !menu) {
    res.status(400).json({ error: 'symbol, period, dan menu required' });
    return;
  }

  const normalized = symbol.toUpperCase().endsWith('USDT')
    ? symbol.toUpperCase()
    : `${symbol.toUpperCase()}USDT`;

  try {
    const result = await runBacktest(normalized, period, menu);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;