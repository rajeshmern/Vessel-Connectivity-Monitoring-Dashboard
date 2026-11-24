import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../server/lib/random.js';
import { createSimulator } from '../server/services/simulator.js';
import { createIngestService, seededDb } from './helpers.js';

function setup(seed = 1) {
  const db = seededDb();
  const ingest = createIngestService(db);
  const sim = createSimulator({ db, ingest, intervalMs: 60_000, volatility: 3, rng: createRng(seed) });
  return { db, sim };
}

test('a tick writes one sample per vessel and a status row for each', () => {
  const { db, sim } = setup();
  sim.tick(1_000_000, 60_000);
  const vessels = db.prepare('SELECT COUNT(*) n FROM vessels').get().n;
  assert.equal(db.prepare('SELECT COUNT(*) n FROM connectivity_samples').get().n, vessels);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM vessel_status').get().n, vessels);
});

test('the same seed produces the same fleet', () => {
  const run = () => {
    const { db, sim } = setup(42);
    for (let i = 0; i < 50; i++) sim.tick(1_000_000 + i * 60_000, 60_000);
    return db.prepare('SELECT vessel_id, status, latency_ms FROM vessel_status ORDER BY vessel_id').all();
  };
  assert.deepEqual(run(), run());
});

test('over time the fleet visits every status and open alerts match current status', () => {
  const { db, sim } = setup(5);
  const seen = new Set();
  for (let i = 0; i < 600; i++) {
    sim.tick(1_000_000 + i * 60_000, 60_000);
    for (const { status } of db.prepare('SELECT DISTINCT status FROM vessel_status').all()) seen.add(status);
  }
  assert.deepEqual([...seen].sort(), ['degraded', 'offline', 'online']);

  // Invariant: a vessel has an open alert exactly when it is not online.
  const mismatches = db
    .prepare(`
      SELECT s.vessel_id FROM vessel_status s
      LEFT JOIN alerts a ON a.vessel_id = s.vessel_id AND a.resolved_at IS NULL
      GROUP BY s.vessel_id
      HAVING (s.status = 'online') != (COUNT(a.id) = 0)`)
    .all();
  assert.equal(mismatches.length, 0);
});

test('force() puts a vessel in the requested condition straight away', () => {
  const { db, sim } = setup();
  sim.tick(1_000_000, 60_000);
  const id = db.prepare('SELECT id FROM vessels ORDER BY id LIMIT 1').get().id;

  sim.force(id, 'down', 5);
  assert.equal(db.prepare('SELECT status FROM vessel_status WHERE vessel_id = ?').get(id).status, 'offline');

  sim.force(id, 'impaired', 5);
  assert.equal(db.prepare('SELECT status FROM vessel_status WHERE vessel_id = ?').get(id).status, 'degraded');

  sim.force(id, 'good', 5);
  assert.equal(db.prepare('SELECT status FROM vessel_status WHERE vessel_id = ?').get(id).status, 'online');
});

test('force() on a vessel that does not exist returns false', () => {
  const { sim } = setup();
  assert.equal(sim.force(12345, 'down'), false);
});
