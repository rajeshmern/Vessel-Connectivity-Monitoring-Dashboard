import { Router } from 'express';
import { oneOf } from '../lib/query.js';
import { RANGES } from '../lib/time.js';

export function dashboardRoutes({ analytics }) {
  const router = Router();

  router.get('/summary', (req, res) => {
    res.json(analytics.fleetSummary());
  });

  router.get('/trend', (req, res) => {
    const range = oneOf(req.query.range, Object.keys(RANGES), 'range', '24h');
    res.json(analytics.fleetTrend(range));
  });

  return router;
}
