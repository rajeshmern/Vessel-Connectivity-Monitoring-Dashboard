import { Router } from 'express';
import { STATUSES, TECHNOLOGY_KEYS } from '../domain/technologies.js';
import { intParam, oneOf, pageParams } from '../lib/query.js';
import { RANGES } from '../lib/time.js';

const SORTS = ['name', 'status', 'provider', 'technology', 'latency', 'download', 'upload', 'loss'];

export function vesselRoutes({ vessels, analytics }) {
  const router = Router();

  router.get('/', (req, res) => {
    const { pageSize, offset, page } = pageParams(req.query, { defaultSize: 20, maxSize: 100 });
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';

    const result = vessels.list({
      search: search || undefined,
      status: oneOf(req.query.status, [...STATUSES, 'unknown'], 'status'),
      providerId: intParam(req.query.providerId, 'providerId'),
      technology: oneOf(req.query.technology, TECHNOLOGY_KEYS, 'technology'),
      sort: oneOf(req.query.sort, SORTS, 'sort'),
      order: oneOf(req.query.order, ['asc', 'desc'], 'order', 'asc'),
      offset,
      pageSize,
    });

    res.json({ ...result, page, pageSize });
  });

  router.post('/', (req, res) => {
    res.status(201).json(vessels.create(req.body));
  });

  router.get('/:id', (req, res) => {
    res.json(vessels.get(intParam(req.params.id, 'id')));
  });

  router.put('/:id', (req, res) => {
    res.json(vessels.update(intParam(req.params.id, 'id'), req.body));
  });

  router.delete('/:id', (req, res) => {
    vessels.delete(intParam(req.params.id, 'id'));
    res.status(204).end();
  });

  router.get('/:id/history', (req, res) => {
    const range = oneOf(req.query.range, Object.keys(RANGES), 'range', '24h');
    res.json(analytics.vesselHistory(intParam(req.params.id, 'id'), range));
  });

  return router;
}
