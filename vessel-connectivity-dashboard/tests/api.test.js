import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { createRng } from '../server/lib/random.js';
import { createSimulator } from '../server/services/simulator.js';
import { createIngestService, seededDb } from './helpers.js';

let server;
let base;
let db;
let simulator;

before(async () => {
  db = seededDb();
  const ingest = createIngestService(db);
  simulator = createSimulator({ db, ingest, intervalMs: 60_000, volatility: 3, rng: createRng(11) });

  // an hour of history so the history endpoints have something to return
  const end = Date.now();
  for (let i = 30; i >= 0; i--) simulator.tick(end - i * 2 * 60_000, 2 * 60_000);

  const app = createApp({ db, simulator, analyticsCacheMs: 0 });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
});

const get = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
};
const send = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const newVessel = (overrides = {}) => ({
  name: 'Test Voyager',
  imoNumber: '9074729',
  callSign: 'tst123',
  vesselType: 'Bulk Carrier',
  flag: 'Panama',
  providerId: 1,
  technology: 'LEO',
  ...overrides,
});

test('meta lists providers, technologies and thresholds', async () => {
  const { status, body } = await get('/api/meta');
  assert.equal(status, 200);
  assert.ok(body.providers.length >= 5);
  const leo = body.technologies.find((t) => t.key === 'LEO');
  assert.equal(leo.thresholds.maxLatencyMs, 150);
});

test('summary counts add up to the fleet size', async () => {
  const { body } = await get('/api/dashboard/summary');
  assert.equal(body.online + body.degraded + body.offline + body.unknown, body.total);
  assert.equal(body.total, 32);
  assert.equal(body.openAlerts.offline, body.offline);
  assert.equal(body.openAlerts.degraded, body.degraded);
});

test('vessel list filters by status, provider, technology and search', async () => {
  const all = (await get('/api/vessels?pageSize=100')).body;
  assert.equal(all.total, 32);

  const leo = (await get('/api/vessels?technology=LEO&pageSize=100')).body;
  assert.ok(leo.total > 0 && leo.items.every((v) => v.technology === 'LEO'));

  const byName = (await get('/api/vessels?search=meridian')).body;
  assert.ok(byName.items.some((v) => v.name === 'Meridian Star'));

  const providerId = all.items[0].provider.id;
  const byProvider = (await get(`/api/vessels?providerId=${providerId}&pageSize=100`)).body;
  assert.ok(byProvider.items.every((v) => v.provider.id === providerId));

  for (const status of ['online', 'degraded', 'offline']) {
    const { body } = await get(`/api/vessels?status=${status}&pageSize=100`);
    assert.ok(body.items.every((v) => v.status === status));
  }
});

test('search treats % and _ as plain characters', async () => {
  const { body } = await get('/api/vessels?search=%25');
  assert.equal(body.total, 0);
});

test('pagination and sorting', async () => {
  const page = (await get('/api/vessels?pageSize=10&page=2&sort=name&order=asc')).body;
  assert.equal(page.items.length, 10);
  assert.equal(page.total, 32);
  const names = page.items.map((v) => v.name.toLowerCase());
  assert.deepEqual(names, [...names].sort());
});

test('default order puts offline vessels first', async () => {
  const { body } = await get('/api/vessels?pageSize=100');
  const rank = { offline: 0, degraded: 1, online: 2, unknown: 3 };
  const ranks = body.items.map((v) => rank[v.status]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

test('bad query values are rejected with 400', async () => {
  assert.equal((await get('/api/vessels?status=sideways')).status, 400);
  assert.equal((await get('/api/vessels?sort=password')).status, 400);
  assert.equal((await get('/api/vessels?pageSize=5000')).status, 400);
});

test('history returns bucketed points and a summary', async () => {
  const { status, body } = await get('/api/vessels/1/history?range=1h');
  assert.equal(status, 200);
  assert.equal(body.range, '1h');
  assert.ok(body.points.length > 5);
  assert.ok(body.summary.availability >= 0 && body.summary.availability <= 100);
  assert.equal((await get('/api/vessels/999/history')).status, 404);
  assert.equal((await get('/api/vessels/1/history?range=1y')).status, 400);
});

test('fleet trend percentages add up to 100', async () => {
  const { body } = await get('/api/dashboard/trend?range=1h');
  assert.ok(body.points.length > 0);
  for (const p of body.points) {
    assert.ok(Math.abs(p.onlinePct + p.degradedPct + p.offlinePct - 100) < 0.1);
  }
});

test('create, update and delete a vessel', async () => {
  const created = await send('POST', '/api/vessels', newVessel());
  assert.equal(created.status, 201);
  assert.equal(created.body.callSign, 'TST123');
  assert.equal(created.body.status, 'unknown');

  const updated = await send('PUT', `/api/vessels/${created.body.id}`, newVessel({ name: 'Renamed Voyager' }));
  assert.equal(updated.status, 200);
  assert.equal(updated.body.name, 'Renamed Voyager');

  assert.equal((await send('DELETE', `/api/vessels/${created.body.id}`)).status, 204);
  assert.equal((await get(`/api/vessels/${created.body.id}`)).status, 404);
});

test('invalid vessel data comes back as field errors', async () => {
  const { status, body } = await send('POST', '/api/vessels', newVessel({ imoNumber: '1234568', name: '', technology: 'X' }));
  assert.equal(status, 422);
  assert.deepEqual(Object.keys(body.error.fields).sort(), ['imoNumber', 'name', 'technology']);
});

test('duplicate IMO is a 409', async () => {
  const first = await send('POST', '/api/vessels', newVessel({ imoNumber: '9321483' }));
  assert.equal(first.status, 201);
  const second = await send('POST', '/api/vessels', newVessel({ imoNumber: '9321483', name: 'Other' }));
  assert.equal(second.status, 409);
});

test('forcing a vessel offline raises an alert that can be acknowledged', async () => {
  const id = 2;
  assert.equal((await send('POST', `/api/simulator/vessels/${id}/force`, { condition: 'down' })).status, 200);
  assert.equal((await get(`/api/vessels/${id}`)).body.status, 'offline');

  const { body } = await get(`/api/alerts?state=active&type=offline&vesselId=${id}`);
  assert.equal(body.total, 1);
  assert.equal(body.items[0].acknowledgedAt, null);

  const acked = await send('POST', `/api/alerts/${body.items[0].id}/acknowledge`);
  assert.equal(acked.status, 200);
  assert.ok(acked.body.acknowledgedAt);

  await send('POST', `/api/simulator/vessels/${id}/force`, { condition: 'good' });
  const resolved = await get(`/api/alerts?state=resolved&vesselId=${id}`);
  assert.ok(resolved.body.items.some((a) => a.type === 'offline' && a.resolvedAt));
});

test('force validates its input', async () => {
  assert.equal((await send('POST', '/api/simulator/vessels/1/force', {})).status, 400);
  assert.equal((await send('POST', '/api/simulator/vessels/1/force', { condition: 'sinking' })).status, 400);
  assert.equal((await send('POST', '/api/simulator/vessels/999/force', { condition: 'down' })).status, 404);
});

test('unknown API routes return JSON 404', async () => {
  const { status, body } = await get('/api/nope');
  assert.equal(status, 404);
  assert.equal(body.error.code, 'not_found');
});

test('malformed JSON is a 400, not a 500', async () => {
  const res = await fetch(`${base}/api/vessels`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{ nope',
  });
  assert.equal(res.status, 400);
});
