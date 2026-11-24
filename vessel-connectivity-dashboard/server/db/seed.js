import { imoFromPrefix } from '../domain/imo.js';
import { DAY, MINUTE } from '../lib/time.js';
import { createRng } from '../lib/random.js';
import { createIngestService } from '../services/ingest.js';
import { createSimulator } from '../services/simulator.js';

// All vessel names are made up for the demo.

const PROVIDERS = [
  'Starlink Maritime',
  'Marlink',
  'Inmarsat',
  'Iridium',
  'KVH',
  'Speedcast',
  'Telenor Maritime',
];

// name, type, flag, provider, technology
const FLEET = [
  ['Meridian Star', 'Container Ship', 'Panama', 'Starlink Maritime', 'LEO'],
  ['Nordic Harvest', 'Bulk Carrier', 'Norway', 'Marlink', 'VSAT_KU'],
  ['Pacific Dawn', 'Oil Tanker', 'Marshall Islands', 'Inmarsat', 'VSAT_KA'],
  ['Coral Voyager', 'Container Ship', 'Singapore', 'Starlink Maritime', 'LEO'],
  ['Atlantic Beacon', 'Chemical Tanker', 'Liberia', 'Speedcast', 'VSAT_KU'],
  ['Cape Meridian', 'Bulk Carrier', 'Malta', 'Marlink', 'VSAT_KU'],
  ['Eastern Falcon', 'LNG Carrier', 'Bahamas', 'Inmarsat', 'VSAT_KA'],
  ['Baltic Courier', 'General Cargo', 'Cyprus', 'Iridium', 'LBAND'],
  ['Southern Trader', 'Container Ship', 'Hong Kong', 'KVH', 'VSAT_KU'],
  ['Orion Pioneer', 'Offshore Support', 'Norway', 'Starlink Maritime', 'LEO'],
  ['Harbour Lark', 'Ro-Ro Ferry', 'Malta', 'Telenor Maritime', 'LTE'],
  ['Kestrel Bay', 'Car Carrier', 'Panama', 'Marlink', 'LEO'],
  ['Silver Tern', 'Oil Tanker', 'Liberia', 'Inmarsat', 'VSAT_KA'],
  ['Marlin Express', 'Container Ship', 'Singapore', 'Speedcast', 'VSAT_KU'],
  ['Gannet Point', 'Offshore Support', 'Norway', 'Starlink Maritime', 'LEO'],
  ['Tidewater Grace', 'Bulk Carrier', 'Marshall Islands', 'KVH', 'VSAT_KU'],
  ['Lagoon Spirit', 'Cruise Ship', 'Bahamas', 'Marlink', 'LEO'],
  ['Amber Coast', 'General Cargo', 'Cyprus', 'Iridium', 'LBAND'],
  ['Northern Reach', 'LNG Carrier', 'Norway', 'Inmarsat', 'VSAT_KA'],
  ['Jade Horizon', 'Container Ship', 'Hong Kong', 'Speedcast', 'VSAT_KU'],
  ['Sable Island', 'Chemical Tanker', 'Liberia', 'Marlink', 'VSAT_KU'],
  ['Westerly Wind', 'Bulk Carrier', 'Panama', 'Starlink Maritime', 'LEO'],
  ['Crescent Bay', 'Ro-Ro Ferry', 'Cyprus', 'Telenor Maritime', 'LTE'],
  ['Ivory Tide', 'Car Carrier', 'Singapore', 'KVH', 'VSAT_KU'],
  ['Falcon Ridge', 'Oil Tanker', 'Marshall Islands', 'Speedcast', 'VSAT_KU'],
  ['Polar Guide', 'Offshore Support', 'Norway', 'Iridium', 'LBAND'],
  ['Saffron Sea', 'Container Ship', 'Malta', 'Inmarsat', 'VSAT_KA'],
  ['Windward Isle', 'General Cargo', 'Bahamas', 'Starlink Maritime', 'LEO'],
  ['Granite Cape', 'Bulk Carrier', 'Hong Kong', 'Marlink', 'VSAT_KU'],
  ['Halcyon Bay', 'Cruise Ship', 'Malta', 'Starlink Maritime', 'LEO'],
  ['Redwood Trader', 'Container Ship', 'Liberia', 'KVH', 'VSAT_KU'],
  ['Zephyr Strait', 'Chemical Tanker', 'Singapore', 'Inmarsat', 'VSAT_KA'],
];

const CALL_SIGN_PREFIX = {
  Panama: '3E',
  Norway: 'LA',
  'Marshall Islands': 'V7',
  Singapore: '9V',
  Liberia: 'A8',
  Malta: '9H',
  Bahamas: 'C6',
  Cyprus: '5B',
  'Hong Kong': 'VR',
};

const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function seedReferenceData(db, rng = createRng(2026)) {
  const insertProvider = db.prepare('INSERT INTO providers (name) VALUES (?)');
  const insertVessel = db.prepare(`
    INSERT INTO vessels (name, imo_number, call_sign, vessel_type, flag, provider_id, technology, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  const providerIds = new Map();
  for (const name of PROVIDERS) providerIds.set(name, Number(insertProvider.run(name).lastInsertRowid));

  const usedImos = new Set();
  const createdAt = Date.now();
  for (const [name, type, flag, provider, technology] of FLEET) {
    let imo;
    do {
      imo = imoFromPrefix(900000 + Math.floor(rng() * 80000));
    } while (usedImos.has(imo));
    usedImos.add(imo);

    const suffix = Array.from({ length: 3 }, () => ALNUM[Math.floor(rng() * ALNUM.length)]).join('');
    const callSign = `${CALL_SIGN_PREFIX[flag]}${suffix}`;

    insertVessel.run(name, imo, callSign, type, flag, providerIds.get(provider), technology, createdAt);
  }
}

 
export function backfillHistory(
  db,
  { days, stepMinutes, volatility, now = Date.now(), rng = createRng(7), incidents = [] },
) {
  const stepMs = stepMinutes * MINUTE;
  const end = Math.floor(now / stepMs) * stepMs;
  const start = end - days * DAY;

  let clock = start;
  const ingest = createIngestService(db);
  const sim = createSimulator({
    db,
    ingest,
    intervalMs: stepMs,
    volatility,
    retentionDays: days + 1,
    rng,
    now: () => clock,
  });

 
  const scripted = new Map();
  for (const { vesselId, condition, minutesAgo } of incidents) {
    const at = end - Math.round((minutesAgo * MINUTE) / stepMs) * stepMs;
    scripted.set(at, [...(scripted.get(at) ?? []), { vesselId, condition }]);
  }
  const holdTicks = Math.ceil((days * DAY) / stepMs); // stays put until the end

 
  db.transaction(() => {
    for (let ts = start; ts <= end; ts += stepMs) {
      clock = ts;
      for (const { vesselId, condition } of scripted.get(ts) ?? []) {
        sim.force(vesselId, condition, holdTicks, { record: false });
      }
      sim.tick(ts, stepMs);
    }
  })();
}

// Vessels that start the demo with a problem, and how long ago it began.
const DEMO_INCIDENTS = [
  { name: 'Atlantic Beacon', condition: 'down', minutesAgo: 36 },
  { name: 'Eastern Falcon', condition: 'impaired', minutesAgo: 20 },
  { name: 'Orion Pioneer', condition: 'impaired', minutesAgo: 8 },
];

export function seedIfEmpty(db, { historyDays, stepMinutes, volatility }) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM vessels').get();
  if (n > 0) return false;

  seedReferenceData(db);
  if (historyDays > 0) {
    const findVessel = db.prepare('SELECT id FROM vessels WHERE name = ?');
    const incidents = DEMO_INCIDENTS.map(({ name, ...rest }) => ({ vesselId: findVessel.get(name).id, ...rest }));
    backfillHistory(db, { days: historyDays, stepMinutes, volatility, incidents });
  }
  return true;
}
