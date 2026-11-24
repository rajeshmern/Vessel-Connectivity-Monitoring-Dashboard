import { classify, describeReasons } from '../domain/classify.js';
import { DAY } from '../lib/time.js';

/**
 * Every reading, whether it comes from the simulator or (later) a real
 * provider adapter, goes through recordSample(). It classifies the reading,
 * stores it, updates the vessel's current state and opens/closes alerts.
 */
export function createIngestService(db) {
  const getVessel = db.prepare('SELECT id, technology FROM vessels WHERE id = ?');
  const getStatus = db.prepare('SELECT status FROM vessel_status WHERE vessel_id = ?');

  const insertSample = db.prepare(`
    INSERT INTO connectivity_samples
      (vessel_id, recorded_at, status, latency_ms, download_mbps, upload_mbps, packet_loss_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);

  const upsertStatus = db.prepare(`
    INSERT INTO vessel_status
      (vessel_id, status, latency_ms, download_mbps, upload_mbps, packet_loss_pct, status_since, last_reported_at)
    VALUES (@vesselId, @status, @latency, @download, @upload, @loss, @ts, @ts)
    ON CONFLICT(vessel_id) DO UPDATE SET
      status = excluded.status,
      latency_ms = excluded.latency_ms,
      download_mbps = excluded.download_mbps,
      upload_mbps = excluded.upload_mbps,
      packet_loss_pct = excluded.packet_loss_pct,
      last_reported_at = excluded.last_reported_at,
      status_since = CASE WHEN vessel_status.status = excluded.status
                          THEN vessel_status.status_since
                          ELSE excluded.status_since END`);

  const resolveOpenAlerts = db.prepare(
    'UPDATE alerts SET resolved_at = ? WHERE vessel_id = ? AND resolved_at IS NULL AND type != ?',
  );
  const resolveAllOpenAlerts = db.prepare(
    'UPDATE alerts SET resolved_at = ? WHERE vessel_id = ? AND resolved_at IS NULL',
  );
  const openAlert = db.prepare(`
    INSERT OR IGNORE INTO alerts (vessel_id, type, severity, message, opened_at)
    VALUES (?, ?, ?, ?, ?)`);

  const pruneSamples = db.prepare('DELETE FROM connectivity_samples WHERE recorded_at < ?');

  function syncAlerts(vesselId, status, reasons, ts) {
    if (status === 'online') {
      resolveAllOpenAlerts.run(ts, vesselId);
      return;
    }
    // degraded -> offline (or back) closes the old alert before opening the new one
    resolveOpenAlerts.run(ts, vesselId, status);

    if (status === 'offline') {
      openAlert.run(vesselId, 'offline', 'critical', 'No connectivity reported from the vessel', ts);
    } else {
      openAlert.run(vesselId, 'degraded', 'warning', describeReasons(reasons), ts);
    }
  }

  const record = db.transaction((vesselId, reading, ts) => {
    const vessel = getVessel.get(vesselId);
    if (!vessel) throw new Error(`Vessel ${vesselId} does not exist`);

    const { status, reasons } = classify(reading, vessel.technology);
    const previous = getStatus.get(vesselId)?.status;

    const latency = reading.linkUp ? reading.latencyMs : null;
    const download = reading.linkUp ? reading.downloadMbps : null;
    const upload = reading.linkUp ? reading.uploadMbps : null;
    const loss = reading.linkUp ? reading.packetLossPct : null;

    insertSample.run(vesselId, ts, status, latency, download, upload, loss);
    upsertStatus.run({ vesselId, status, latency, download, upload, loss, ts });

    // Only touch alerts when something actually changed.
    const changed = previous !== status;
    if (changed) syncAlerts(vesselId, status, reasons, ts);

    return { status, previous, changed };
  });

  return {
    recordSample: (vesselId, reading, ts = Date.now()) => record(vesselId, reading, ts),

    // Raw samples are kept for a limited time; alerts are kept forever.
    pruneOlderThan(days, now = Date.now()) {
      return pruneSamples.run(now - days * DAY).changes;
    },
  };
}
