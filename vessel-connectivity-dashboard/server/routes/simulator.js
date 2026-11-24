import { Router } from 'express';
import { intParam, oneOf } from '../lib/query.js';
import { badRequest, notFound } from '../lib/errors.js';

// Controls for the demo data generator. A real deployment would not expose these.
export function simulatorRoutes({ simulator }) {
  const router = Router();

  router.get('/', (req, res) => res.json(simulator.status()));

  router.post('/pause', (req, res) => {
    simulator.stop();
    res.json(simulator.status());
  });

  router.post('/resume', (req, res) => {
    simulator.start();
    res.json(simulator.status());
  });

  router.post('/vessels/:id/force', (req, res) => {
    const id = intParam(req.params.id, 'id');
    const condition = oneOf(req.body?.condition, ['good', 'impaired', 'down'], 'condition');
    if (!condition) throw badRequest('condition is required: good, impaired or down');
    const holdTicks = intParam(req.body?.holdTicks, 'holdTicks', { min: 0, max: 60, fallback: 8 });

    if (!simulator.force(id, condition, holdTicks)) throw notFound('Vessel');
    res.json({ ok: true, vesselId: id, condition, holdTicks });
  });

  return router;
}
