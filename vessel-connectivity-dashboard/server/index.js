import { createApp } from './app.js';
import { config } from './config.js';
import { openDatabase } from './db/connection.js';
import { seedIfEmpty } from './db/seed.js';
import { createIngestService } from './services/ingest.js';
import { createSimulator } from './services/simulator.js';

const db = openDatabase(config.dbPath);

const started = Date.now();
const seeded = seedIfEmpty(db, {
  historyDays: config.seed.historyDays,
  stepMinutes: config.seed.stepMinutes,
  volatility: config.simulator.volatility,
});
if (seeded) {
  console.log(`Seeded demo fleet with ${config.seed.historyDays} days of history in ${Date.now() - started} ms`);
}

const simulator = createSimulator({
  db,
  ingest: createIngestService(db),
  intervalMs: config.simulator.intervalMs,
  volatility: config.simulator.volatility,
  retentionDays: config.retentionDays,
});
if (config.simulator.enabled) simulator.start();

const app = createApp({ db, simulator, logRequests: true });
const server = app.listen(config.port, () => {
  const sim = config.simulator.enabled ? `every ${config.simulator.intervalMs / 1000}s` : 'off';
  console.log(`Fleet connectivity monitor on http://localhost:${config.port}  (simulator ${sim})`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  simulator.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
