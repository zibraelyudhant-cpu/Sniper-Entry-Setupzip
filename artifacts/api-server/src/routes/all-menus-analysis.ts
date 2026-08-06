import { Router } from 'express';
import { analyzeAllMenus } from '../lib/smc';

const router = Router();

// GET /api/all-menus-analysis?symbol=BTCUSDT — analisa 1 koin di SEMUA menu
// sekaligus. Search-only, gak ada endpoint scan sendiri.
router.get('/all-menus-analysis', async (req, res) => {
  const symbol = req.query['symbol'] as string;
  if (!symbol) { res.status(400).json({ error: 'symbol required' }); return; }
  const normalized = symbol.toUpperCase().endsWith('USDT')
    ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
  try {
    const result = await analyzeAllMenus(normalized);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;