export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

// Ranges the history endpoints accept. `bucketMs` is how wide each point on
// the chart is. Seeded history is sampled every 2 minutes, so the smallest
// bucket is 2 minutes to avoid empty buckets in the 1h view.
export const RANGES = {
  '1h': { ms: HOUR, bucketMs: 2 * MINUTE },
  '6h': { ms: 6 * HOUR, bucketMs: 5 * MINUTE },
  '24h': { ms: DAY, bucketMs: 15 * MINUTE },
  '7d': { ms: 7 * DAY, bucketMs: HOUR },
};
