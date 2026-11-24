import { Router } from 'express';
import { intParam, oneOf, pageParams } from '../lib/query.js';

export function alertRoutes({ alerts }) {
  const router = Router();

  router.get('/', (req, res) => {
    const { page, pageSize, offset } = pageParams(req.query, { defaultSize: 20, maxSize: 100 });
    const result = alerts.list({
      state: oneOf(req.query.state, ['active', 'resolved', 'all'], 'state', 'active'),
      type: oneOf(req.query.type, ['offline', 'degraded'], 'type'),
      vesselId: intParam(req.query.vesselId, 'vesselId'),
      offset,
      pageSize,
    });
    res.json({ ...result, page, pageSize });
  });

  router.post('/:id/acknowledge', (req, res) => {
    res.json(alerts.acknowledge(intParam(req.params.id, 'id')));
  });

  return router;
}
