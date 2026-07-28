import { Router } from 'express';
import { fetchUpcomingEconomicEvents } from '../lib/smc';

const router = Router();

router.get('/economic-calendar', async (_req, res) => {
  try {
    const events = await fetchUpcomingEconomicEvents();
    res.json({ events, fetchedAt: Date.now() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;