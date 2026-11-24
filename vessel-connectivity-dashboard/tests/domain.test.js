import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, describeReasons } from '../server/domain/classify.js';
import { imoFromPrefix, isValidImo } from '../server/domain/imo.js';

const reading = (overrides = {}) => ({
  linkUp: true,
  latencyMs: 50,
  downloadMbps: 100,
  uploadMbps: 20,
  packetLossPct: 0.2,
  ...overrides,
});

test('a healthy LEO reading is online', () => {
  assert.equal(classify(reading(), 'LEO').status, 'online');
});

test('the same latency is fine on GEO but degraded on LEO', () => {
  const r = reading({ latencyMs: 650, downloadMbps: 14, uploadMbps: 3, packetLossPct: 0.5 });
  assert.equal(classify(r, 'VSAT_KU').status, 'online');
  assert.equal(classify({ ...r, downloadMbps: 100, uploadMbps: 20 }, 'LEO').status, 'degraded');
});

test('no link means offline, whatever the other numbers say', () => {
  assert.equal(classify(reading({ linkUp: false }), 'LEO').status, 'offline');
});

test('every breached threshold is reported as a reason', () => {
  const { status, reasons } = classify(
    reading({ latencyMs: 300, downloadMbps: 10, packetLossPct: 5 }),
    'LEO',
  );
  assert.equal(status, 'degraded');
  assert.deepEqual(reasons.map((r) => r.metric).sort(), ['download', 'latency', 'packet loss']);
});

test('a reading exactly on the limit is not degraded', () => {
  assert.equal(classify(reading({ latencyMs: 150, downloadMbps: 30, uploadMbps: 5, packetLossPct: 2 }), 'LEO').status, 'online');
});

test('unknown technology throws instead of guessing', () => {
  assert.throws(() => classify(reading(), 'CARRIER_PIGEON'));
});

test('describeReasons includes the value and the limit', () => {
  const { reasons } = classify(reading({ latencyMs: 1240 }), 'LEO');
  assert.match(describeReasons(reasons), /Latency 1,240 ms \(limit 150 ms\)/);
});

test('IMO check digit', () => {
  assert.equal(isValidImo('9074729'), true);
  assert.equal(isValidImo('IMO 9074729'), true);
  assert.equal(isValidImo('9074728'), false);
  assert.equal(isValidImo('907472'), false);
  assert.equal(isValidImo('abcdefg'), false);
  assert.equal(isValidImo(''), false);
});

test('imoFromPrefix always produces a valid number', () => {
  for (let prefix = 900000; prefix < 900500; prefix++) {
    assert.equal(isValidImo(imoFromPrefix(prefix)), true);
  }
});
