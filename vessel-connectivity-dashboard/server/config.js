import path from 'node:path';

function number(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: number('PORT', 3000),
  dbPath: process.env.DB_PATH || path.join(import.meta.dirname, '..', 'data', 'vessels.db'),

  simulator: {
    enabled: process.env.SIMULATOR !== 'off',
    intervalMs: number('SIM_INTERVAL_MS', 15_000),
    // Scales how often vessels change state. 1 is roughly "a real fleet",
    // higher values make demos more eventful.
    volatility: number('SIM_VOLATILITY', 1.5),
  },

  seed: {
    historyDays: number('SEED_HISTORY_DAYS', 7),
    stepMinutes: number('SEED_STEP_MINUTES', 2),
  },

  retentionDays: number('RETENTION_DAYS', 7),
};
