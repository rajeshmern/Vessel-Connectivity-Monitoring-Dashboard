import { notFound } from '../lib/errors.js';
import { iso } from '../lib/time.js';

const SELECT = `
  SELECT a.*, v.name AS vessel_name, v.imo_number
  FROM alerts a JOIN vessels v ON v.id = a.vessel_id`;

function toDto(row, now) {
  return {
    id: row.id,
    vesselId: row.vessel_id,
    vesselName: row.vessel_name,
    vesselImo: row.imo_number,
    type: row.type,
    severity: row.severity,
    message: row.message,
    state: row.resolved_at == null ? 'active' : 'resolved',
    openedAt: iso(row.opened_at),
    resolvedAt: iso(row.resolved_at),
    acknowledgedAt: iso(row.acknowledged_at),
    durationMs: (row.resolved_at ?? now) - row.opened_at,
  };
}

export function createAlertService(db) {
  const getRow = db.prepare(`${SELECT} WHERE a.id = ?`);
  const acknowledge = db.prepare('UPDATE alerts SET acknowledged_at = COALESCE(acknowledged_at, ?) WHERE id = ?');

  return {
    list({ state = 'active', type, vesselId, offset = 0, pageSize = 20 }, now = Date.now()) {
      const where = [];
      const params = {};

      if (state === 'active') where.push('a.resolved_at IS NULL');
      if (state === 'resolved') where.push('a.resolved_at IS NOT NULL');
      if (type) {
        where.push('a.type = @type');
        params.type = type;
      }
      if (vesselId) {
        where.push('a.vessel_id = @vesselId');
        params.vesselId = vesselId;
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      // Active: worst first, then newest. Everything else: newest first.
      const orderSql =
        state === 'active'
          ? "CASE a.severity WHEN 'critical' THEN 0 ELSE 1 END, a.opened_at DESC"
          : 'a.opened_at DESC';

      const total = db.prepare(`SELECT COUNT(*) AS n FROM alerts a ${whereSql}`).get(params).n;
      const rows = db
        .prepare(`${SELECT} ${whereSql} ORDER BY ${orderSql} LIMIT @limit OFFSET @offset`)
        .all({ ...params, limit: pageSize, offset });

      return { items: rows.map((r) => toDto(r, now)), total };
    },

    acknowledge(id, now = Date.now()) {
      if (!getRow.get(id)) throw notFound('Alert');
      acknowledge.run(now, id);
      return toDto(getRow.get(id), now);
    },
  };
}
