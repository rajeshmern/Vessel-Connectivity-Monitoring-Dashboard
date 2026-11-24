import path from 'node:path';
import express from 'express';
import { STATUSES, TECHNOLOGIES, VESSEL_TYPES } from './domain/technologies.js';
import { HttpError, errorHandler } from './lib/errors.js';
import { alertRoutes } from './routes/alerts.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { simulatorRoutes } from './routes/simulator.js';
import { vesselRoutes } from './routes/vessels.js';
import { createAlertService } from './services/alerts.js';
import { createAnalyticsService } from './services/analytics.js';
import { createVesselService } from './services/vessels.js';

const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public');

export function createApp({ db, simulator, logRequests = false, analyticsCacheMs }) {
  const analytics = createAnalyticsService(db, { cacheMs: analyticsCacheMs });
  const vessels = createVesselService(db, analytics);
  const alerts = createAlertService(db);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  if (logRequests) {
    app.use('/api', (req, res, next) => {
      const started = Date.now();
      res.on('finish', () => {
        console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`);
      });
      next();
    });
  }

  const api = express.Router();

  api.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  // Everything the UI needs to build its filters and forms.
  api.get('/meta', (req, res) => {
    const providers = db.prepare('SELECT id, name FROM providers ORDER BY name').all();
    res.json({
      providers,
      technologies: Object.entries(TECHNOLOGIES).map(([key, t]) => ({
        key,
        label: t.label,
        thresholds: t.thresholds,
      })),
      vesselTypes: VESSEL_TYPES,
      statuses: STATUSES,
    });
  });

  api.use('/vessels', vesselRoutes({ vessels, analytics }));
  api.use('/dashboard', dashboardRoutes({ analytics }));
  api.use('/alerts', alertRoutes({ alerts }));
  api.use('/simulator', simulatorRoutes({ simulator }));

  api.use((req, res, next) => next(new HttpError(404, 'No such API endpoint')));

  app.use('/api', api);
  app.use(express.static(PUBLIC_DIR));
  app.use(errorHandler);

  return app;
}
