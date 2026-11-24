import test from 'node:test';
import assert from 'node:assert/strict';
import { DOWN, GOOD_LEO, SLOW_LEO, createIngestService, firstVessel, seededDb } from './helpers.js';

function setup() {
  const db = seededDb();
  const ingest = createIngestService(db);
  const id = firstVessel(db, 'LEO');
  const alerts = () => db.prepare('SELECT type, resolved_at FROM alerts WHERE vessel_id = ? ORDER BY id').all(id);
  const status = () => db.prepare('SELECT * FROM vessel_status WHERE vessel_id = ?').get(id);
  return { db, ingest, id, alerts, status };
}

test('first good reading creates a status row and no alerts', () => {
  const { ingest, id, alerts, status } = setup();
  ingest.recordSample(id, GOOD_LEO, 1000);
  assert.equal(status().status, 'online');
  assert.equal(alerts().length, 0);
});

test('going degraded opens one warning with the reason', () => {
  const { db, ingest, id, alerts } = setup();
  ingest.recordSample(id, GOOD_LEO, 1000);
  ingest.recordSample(id, SLOW_LEO, 2000);
  assert.equal(alerts().length, 1);
  const alert = db.prepare('SELECT * FROM alerts WHERE vessel_id = ?').get(id);
  assert.equal(alert.type, 'degraded');
  assert.equal(alert.severity, 'warning');
  assert.match(alert.message, /Latency 400 ms/);
});

test('staying degraded does not open duplicate alerts', () => {
  const { ingest, id, alerts } = setup();
  ingest.recordSample(id, GOOD_LEO, 1000);
  for (let i = 0; i < 5; i++) ingest.recordSample(id, SLOW_LEO, 2000 + i);
  assert.equal(alerts().length, 1);
});

test('degraded to offline closes the degraded alert and opens a critical one', () => {
  const { db, ingest, id } = setup();
  ingest.recordSample(id, SLOW_LEO, 1000);
  ingest.recordSample(id, DOWN, 2000);
  const rows = db.prepare('SELECT type, severity, resolved_at FROM alerts WHERE vessel_id = ? ORDER BY id').all(id);
  assert.deepEqual(rows, [
    { type: 'degraded', severity: 'warning', resolved_at: 2000 },
    { type: 'offline', severity: 'critical', resolved_at: null },
  ]);
});

test('recovery resolves everything that was open', () => {
  const { ingest, id, alerts } = setup();
  ingest.recordSample(id, SLOW_LEO, 1000);
  ingest.recordSample(id, DOWN, 2000);
  ingest.recordSample(id, GOOD_LEO, 3000);
  assert.ok(alerts().every((a) => a.resolved_at !== null));
});

test('status_since only moves when the status changes', () => {
  const { ingest, id, status } = setup();
  ingest.recordSample(id, GOOD_LEO, 1000);
  ingest.recordSample(id, GOOD_LEO, 2000);
  assert.equal(status().status_since, 1000);
  ingest.recordSample(id, DOWN, 3000);
  assert.equal(status().status_since, 3000);
  assert.equal(status().latency_ms, null);
});

test('the database refuses a second open alert of the same type', () => {
  const { db, ingest, id } = setup();
  ingest.recordSample(id, DOWN, 1000);
  assert.throws(
    () => db.prepare("INSERT INTO alerts (vessel_id, type, severity, message, opened_at) VALUES (?, 'offline', 'critical', 'x', 1)").run(id),
    /UNIQUE/,
  );
});

test('unknown vessel is rejected', () => {
  const { ingest } = setup();
  assert.throws(() => ingest.recordSample(9999, GOOD_LEO, 1000), /does not exist/);
});

test('pruning removes old samples only', () => {
  const { db, ingest, id } = setup();
  const day = 24 * 60 * 60 * 1000;
  ingest.recordSample(id, GOOD_LEO, 10 * day);
  ingest.recordSample(id, GOOD_LEO, 20 * day);
  const removed = ingest.pruneOlderThan(7, 20 * day);
  assert.equal(removed, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM connectivity_samples').get().n, 1);
});
