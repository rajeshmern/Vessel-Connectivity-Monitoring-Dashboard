import { openDatabase } from '../server/db/connection.js';
import { seedReferenceData } from '../server/db/seed.js';
import { createIngestService } from '../server/services/ingest.js';

export function memoryDb() {
  return openDatabase(':memory:');
}

// Small fixed fleet: enough to test filters without the 4 second history seed.
export function seededDb() {
  const db = memoryDb();
  seedReferenceData(db);
  return db;
}

export const GOOD_LEO = { linkUp: true, latencyMs: 50, downloadMbps: 120, uploadMbps: 20, packetLossPct: 0.3 };
export const SLOW_LEO = { linkUp: true, latencyMs: 400, downloadMbps: 120, uploadMbps: 20, packetLossPct: 0.3 };
export const DOWN = { linkUp: false, latencyMs: null, downloadMbps: null, uploadMbps: null, packetLossPct: null };

export function firstVessel(db, technology = 'LEO') {
  return db.prepare('SELECT id FROM vessels WHERE technology = ? ORDER BY id LIMIT 1').get(technology).id;
}

export { createIngestService };
