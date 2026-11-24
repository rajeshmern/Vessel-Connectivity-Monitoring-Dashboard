import { TECHNOLOGIES } from '../domain/technologies.js';
import { HOUR } from '../lib/time.js';
import { clamp, createRng, gaussian } from '../lib/random.js';

// Each vessel's link is in one of three conditions. Changes between them are
// a simple Markov chain. Rates are "per hour" at volatility 1; with these
// numbers the fleet settles around 85% healthy, 10% degraded, 5% down.
const RATES = {
  good: { impaired: 0.25, down: 0.05 },
  impaired: { good: 2.0, down: 0.1 },
  down: { good: 1.2 },
};

const IMPAIRMENTS = [
  ['latency', 0.3],
  ['throughput', 0.3],
  ['loss', 0.2],
  ['mixed', 0.2],
];

function pickImpairment(rng) {
  let roll = rng();
  for (const [kind, weight] of IMPAIRMENTS) {
    if (roll < weight) return kind;
    roll -= weight;
  }
  return 'latency';
}

function probability(ratePerHour, dtMs, volatility) {
  return 1 - Math.exp((-ratePerHour * volatility * dtMs) / HOUR);
}

// Crews stream more in the evening, so throughput dips a little around 19:30 UTC.
function eveningFactor(ts) {
  const d = new Date(ts);
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  return 1 - 0.18 * Math.exp(-((hour - 19.5) ** 2) / 8);
}

const round = (n, places) => Number(n.toFixed(places));

/**
 * Generates the numbers for one reading. Impaired readings are built from the
 * technology's own thresholds so that the classifier (not the simulator)
 * ends up deciding they are degraded.
 */
export function buildReading(model, technology, ts, rng) {
  if (model.state === 'down') {
    return { linkUp: false, latencyMs: null, downloadMbps: null, uploadMbps: null, packetLossPct: null };
  }

  const { baseline, thresholds: t } = TECHNOLOGIES[technology];
  const evening = eveningFactor(ts);

  let latency = baseline.latencyMs * (1 + gaussian(rng) * 0.07);
  let download = baseline.downMbps * model.quality * evening * (1 + gaussian(rng) * 0.1);
  let upload = baseline.upMbps * model.quality * (1 + gaussian(rng) * 0.1);
  let loss = baseline.lossPct * (0.6 + rng() * 0.8);

  if (model.state === 'impaired') {
    const kind = model.impairment;
    if (kind === 'latency' || kind === 'mixed') {
      latency = t.maxLatencyMs * (1.15 + rng() * 0.8);
    }
    if (kind === 'throughput' || kind === 'mixed') {
      download = t.minDownMbps * (0.25 + rng() * 0.5);
      upload = t.minUpMbps * (0.25 + rng() * 0.5);
    }
    if (kind === 'loss' || kind === 'mixed') {
      loss = t.maxLossPct * (1.3 + rng() * 2.2);
    }
  }

  return {
    linkUp: true,
    latencyMs: round(Math.max(latency, 5), 0),
    downloadMbps: round(Math.max(download, 0.01), 2),
    uploadMbps: round(Math.max(upload, 0.01), 2),
    packetLossPct: round(clamp(loss, 0, 100), 2),
  };
}

const STATE_FROM_STATUS = { online: 'good', degraded: 'impaired', offline: 'down' };

export function createSimulator({
  db,
  ingest,
  intervalMs = 15_000,
  volatility = 1,
  retentionDays = 7,
  rng = createRng(),
  now = Date.now,
}) {
  const listVessels = db.prepare('SELECT id, technology FROM vessels');
  const getVessel = db.prepare('SELECT id, technology FROM vessels WHERE id = ?');
  const getStatus = db.prepare('SELECT status FROM vessel_status WHERE vessel_id = ?');

  const models = new Map();
  let timer = null;
  let tickCount = 0;
  let lastTickAt = null;

  // A vessel we have not seen this run picks up where the database left off,
  // so restarting the server does not reset every vessel to "online".
  function modelFor(vessel) {
    let model = models.get(vessel.id);
    if (!model) {
      const status = getStatus.get(vessel.id)?.status;
      const state = STATE_FROM_STATUS[status] ?? 'good';
      model = {
        state,
        impairment: pickImpairment(rng),
        qualityBase: 0.85 + rng() * 0.2,
        quality: 1,
        hold: 0,
      };
      model.quality = model.qualityBase;
      models.set(vessel.id, model);
    }
    return model;
  }

  function advance(model, dtMs) {
    // Terminal quality drifts slowly around this vessel's own normal.
    model.quality = clamp(
      model.quality + 0.15 * (model.qualityBase - model.quality) + gaussian(rng) * 0.02,
      0.78,
      1.15,
    );

    if (model.hold > 0) {
      model.hold -= 1;
      return;
    }

    const options = Object.entries(RATES[model.state]);
    let roll = rng();
    for (const [next, rate] of options) {
      const p = probability(rate, dtMs, volatility);
      if (roll < p) {
        model.state = next;
        if (next === 'impaired') model.impairment = pickImpairment(rng);
        return;
      }
      roll -= p;
    }
  }

  function step(vessel, ts, dtMs) {
    const model = modelFor(vessel);
    if (dtMs > 0) advance(model, dtMs);
    ingest.recordSample(vessel.id, buildReading(model, vessel.technology, ts, rng), ts);
  }

  const tickAll = db.transaction((ts, dtMs) => {
    for (const vessel of listVessels.all()) step(vessel, ts, dtMs);
  });

  function tick(ts = now(), dtMs = intervalMs) {
    tickAll(ts, dtMs);
    tickCount += 1;
    lastTickAt = ts;

    // Roughly once an hour of simulated time.
    if (tickCount % Math.max(1, Math.round(HOUR / dtMs)) === 0) {
      ingest.pruneOlderThan(retentionDays, ts);
    }
  }

  return {
    tick,

    start() {
      if (timer) return;
      timer = setInterval(() => {
        try {
          tick();
        } catch (err) {
          console.error('[simulator] tick failed', err);
        }
      }, intervalMs);
    },

    stop() {
      clearInterval(timer);
      timer = null;
    },

    // Demo helper: put a vessel into a condition right now and keep it there
    // for a few ticks before the random process takes over again.
    // `record: false` only sets the model and leaves the sample to the next tick.
    force(vesselId, condition, holdTicks = 8, { record = true } = {}) {
      const vessel = getVessel.get(vesselId);
      if (!vessel) return false;
      const model = modelFor(vessel);
      model.state = condition;
      if (condition === 'impaired') model.impairment = pickImpairment(rng);
      model.hold = holdTicks;
      if (record) step(vessel, now(), 0);
      return true;
    },

    status() {
      return { running: timer !== null, intervalMs, volatility, tickCount, lastTickAt };
    },
  };
}
