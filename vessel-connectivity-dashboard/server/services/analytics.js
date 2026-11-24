import { notFound } from '../lib/errors.js';
import { DAY, RANGES, iso } from '../lib/time.js';

const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

const mean = (values) => {
  const usable = values.filter((v) => v != null);
  return usable.length ? round2(usable.reduce((a, b) => a + b, 0) / usable.length) : null;
};

/**
 * Read-only queries behind the charts and the dashboard numbers.
 *
 * Availability = share of samples where the vessel was not offline (degraded
 * still counts as reachable). It is computed per time bucket and then
 * averaged, so seeded history (every 2 minutes) and live samples (every
 * 15 seconds) weigh the same.
 */
export function createAnalyticsService(db, { cacheMs = 30_000 } = {}) {
  const vesselExists = db.prepare('SELECT 1 FROM vessels WHERE id = ?');

  const availabilityStmt = db.prepare(`
    SELECT vessel_id, AVG(avail) AS availability FROM (
      SELECT vessel_id,
             CAST(recorded_at / @bucket AS INTEGER) AS b,
             100.0 * SUM(status != 'offline') / COUNT(*) AS avail
      FROM connectivity_samples
      WHERE recorded_at >= @since
      GROUP BY vessel_id, b
    ) GROUP BY vessel_id`);

  const historyStmt = db.prepare(`
    SELECT CAST(recorded_at / @bucket AS INTEGER) * @bucket AS t,
           AVG(latency_ms) AS latency,
           AVG(download_mbps) AS download,
           AVG(upload_mbps) AS upload,
           AVG(packet_loss_pct) AS loss,
           100.0 * SUM(status != 'offline') / COUNT(*) AS availability,
           CASE WHEN SUM(status = 'offline') > 0 THEN 'offline'
                WHEN SUM(status = 'degraded') > 0 THEN 'degraded'
                ELSE 'online' END AS worst
    FROM connectivity_samples
    WHERE vessel_id = @vesselId AND recorded_at >= @since AND recorded_at <= @now
    GROUP BY 1 ORDER BY 1`);

  // Alerts that overlap the window, with the overlap clipped to the window.
  const downtimeStmt = db.prepare(`
    SELECT type,
           COUNT(*) AS incidents,
           COALESCE(SUM(MIN(COALESCE(resolved_at, @now), @now) - MAX(opened_at, @since)), 0) AS durationMs
    FROM alerts
    WHERE vessel_id = @vesselId AND opened_at <= @now AND (resolved_at IS NULL OR resolved_at >= @since)
    GROUP BY type`);

  const fleetBucketsStmt = db.prepare(`
    SELECT CAST(recorded_at / @bucket AS INTEGER) * @bucket AS t,
           COUNT(*) AS n,
           SUM(status = 'online') AS online,
           SUM(status = 'degraded') AS degraded,
           SUM(status = 'offline') AS offline
    FROM connectivity_samples
    WHERE recorded_at >= @since AND recorded_at <= @now
    GROUP BY 1 ORDER BY 1`);

  const countsStmt = db.prepare(`
    SELECT COALESCE(s.status, 'unknown') AS status, COUNT(*) AS n
    FROM vessels v LEFT JOIN vessel_status s ON s.vessel_id = v.id
    GROUP BY 1`);

  const byProviderStmt = db.prepare(`
    SELECT p.id, p.name, COUNT(v.id) AS vessels,
           COALESCE(SUM(s.status = 'online'), 0) AS online,
           COALESCE(SUM(s.status = 'degraded'), 0) AS degraded,
           COALESCE(SUM(s.status = 'offline'), 0) AS offline
    FROM providers p
    JOIN vessels v ON v.provider_id = p.id
    LEFT JOIN vessel_status s ON s.vessel_id = v.id
    GROUP BY p.id ORDER BY vessels DESC, p.name`);

  const byTechnologyStmt = db.prepare(`
    SELECT v.technology, COUNT(*) AS vessels,
           COALESCE(SUM(s.status = 'online'), 0) AS online,
           COALESCE(SUM(s.status = 'degraded'), 0) AS degraded,
           COALESCE(SUM(s.status = 'offline'), 0) AS offline,
           AVG(s.latency_ms) AS latencyMs,
           AVG(s.download_mbps) AS downloadMbps,
           AVG(s.upload_mbps) AS uploadMbps,
           AVG(s.packet_loss_pct) AS packetLossPct
    FROM vessels v LEFT JOIN vessel_status s ON s.vessel_id = v.id
    GROUP BY v.technology ORDER BY vessels DESC`);

  const openAlertsStmt = db.prepare(
    'SELECT type, COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL GROUP BY type',
  );

  let availabilityCache = { at: 0, map: new Map() };

  function availabilityByVessel(now = Date.now()) {
    if (cacheMs > 0 && now - availabilityCache.at < cacheMs) return availabilityCache.map;
    const rows = availabilityStmt.all({ bucket: RANGES['24h'].bucketMs, since: now - DAY });
    const map = new Map(rows.map((r) => [r.vessel_id, round2(r.availability)]));
    availabilityCache = { at: now, map };
    return map;
  }

  function fleetBuckets(rangeKey, now) {
    const range = RANGES[rangeKey];
    return fleetBucketsStmt
      .all({ bucket: range.bucketMs, since: now - range.ms, now })
      .map((r) => ({
        t: iso(r.t),
        onlinePct: round2((100 * r.online) / r.n),
        degradedPct: round2((100 * r.degraded) / r.n),
        offlinePct: round2((100 * r.offline) / r.n),
      }));
  }

  return {
    availabilityByVessel,

    vesselHistory(vesselId, rangeKey, now = Date.now()) {
      if (!vesselExists.get(vesselId)) throw notFound('Vessel');
      const range = RANGES[rangeKey];
      const since = now - range.ms;

      const rows = historyStmt.all({ vesselId, bucket: range.bucketMs, since, now });
      const points = rows.map((r) => ({
        t: iso(r.t),
        latencyMs: round2(r.latency),
        downloadMbps: round2(r.download),
        uploadMbps: round2(r.upload),
        packetLossPct: round2(r.loss),
        availability: round2(r.availability),
        worst: r.worst,
      }));

      const downtime = Object.fromEntries(
        downtimeStmt.all({ vesselId, since, now }).map((r) => [r.type, r]),
      );

      return {
        range: rangeKey,
        bucketSeconds: range.bucketMs / 1000,
        from: iso(since),
        to: iso(now),
        points,
        summary: {
          availability: mean(rows.map((r) => r.availability)),
          avgLatencyMs: mean(rows.map((r) => r.latency)),
          avgDownloadMbps: mean(rows.map((r) => r.download)),
          avgUploadMbps: mean(rows.map((r) => r.upload)),
          avgPacketLossPct: mean(rows.map((r) => r.loss)),
          offlineIncidents: downtime.offline?.incidents ?? 0,
          offlineMs: downtime.offline?.durationMs ?? 0,
          degradedIncidents: downtime.degraded?.incidents ?? 0,
        },
      };
    },

    fleetTrend(rangeKey, now = Date.now()) {
      const range = RANGES[rangeKey];
      const points = fleetBuckets(rangeKey, now);
      return {
        range: rangeKey,
        bucketSeconds: range.bucketMs / 1000,
        points,
        availability: mean(points.map((p) => p.onlinePct + p.degradedPct)),
      };
    },

    fleetSummary(now = Date.now()) {
      const counts = { online: 0, degraded: 0, offline: 0, unknown: 0 };
      for (const { status, n } of countsStmt.all()) counts[status] = n;
      const total = counts.online + counts.degraded + counts.offline + counts.unknown;

      const alerts = { offline: 0, degraded: 0 };
      for (const { type, n } of openAlertsStmt.all()) alerts[type] = n;

      const trend24h = fleetBuckets('24h', now);

      return {
        total,
        ...counts,
        availability24h: mean(trend24h.map((p) => p.onlinePct + p.degradedPct)),
        openAlerts: alerts,
        byProvider: byProviderStmt.all(),
        byTechnology: byTechnologyStmt.all().map((t) => ({
          ...t,
          latencyMs: round2(t.latencyMs),
          downloadMbps: round2(t.downloadMbps),
          uploadMbps: round2(t.uploadMbps),
          packetLossPct: round2(t.packetLossPct),
        })),
        generatedAt: iso(now),
      };
    },
  };
}
