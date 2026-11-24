import { isValidImo, normalizeImo } from '../domain/imo.js';
import { isUniqueViolation } from '../db/connection.js';
import { TECHNOLOGY_KEYS, VESSEL_TYPES } from '../domain/technologies.js';
import { conflict, invalid, notFound } from '../lib/errors.js';
import { iso } from '../lib/time.js';

// Whitelist of sortable columns. Nothing from the query string is ever
// interpolated into SQL except through this map.
const SORT_COLUMNS = {
  name: 'v.name COLLATE NOCASE',
  provider: 'p.name COLLATE NOCASE',
  technology: 'v.technology',
  latency: 's.latency_ms',
  download: 's.download_mbps',
  upload: 's.upload_mbps',
  loss: 's.packet_loss_pct',
};

// "Needs attention first" is the default ordering for an operations view.
const STATUS_RANK = `CASE COALESCE(s.status, 'unknown')
  WHEN 'offline' THEN 0 WHEN 'degraded' THEN 1 WHEN 'online' THEN 2 ELSE 3 END`;

const BASE_SELECT = `
  SELECT v.*, p.name AS provider_name,
         COALESCE(s.status, 'unknown') AS status,
         s.latency_ms, s.download_mbps, s.upload_mbps, s.packet_loss_pct,
         s.status_since, s.last_reported_at
  FROM vessels v
  JOIN providers p ON p.id = v.provider_id
  LEFT JOIN vessel_status s ON s.vessel_id = v.id`;

const FROM_JOINS = `
  FROM vessels v
  JOIN providers p ON p.id = v.provider_id
  LEFT JOIN vessel_status s ON s.vessel_id = v.id`;

function toDto(row, availability) {
  const hasMetrics = row.latency_ms != null;
  return {
    id: row.id,
    name: row.name,
    imoNumber: row.imo_number,
    callSign: row.call_sign,
    vesselType: row.vessel_type,
    flag: row.flag,
    provider: { id: row.provider_id, name: row.provider_name },
    technology: row.technology,
    status: row.status,
    metrics: hasMetrics
      ? {
          latencyMs: row.latency_ms,
          downloadMbps: row.download_mbps,
          uploadMbps: row.upload_mbps,
          packetLossPct: row.packet_loss_pct,
        }
      : null,
    statusSince: iso(row.status_since),
    lastReportedAt: iso(row.last_reported_at),
    ...(availability !== undefined && { availability24h: availability }),
  };
}

export function createVesselService(db, analytics) {
  const providerExists = db.prepare('SELECT 1 FROM providers WHERE id = ?');
  const getRow = db.prepare(`${BASE_SELECT} WHERE v.id = ?`);

  const insert = db.prepare(`
    INSERT INTO vessels (name, imo_number, call_sign, vessel_type, flag, provider_id, technology, created_at)
    VALUES (@name, @imoNumber, @callSign, @vesselType, @flag, @providerId, @technology, @createdAt)`);
  const update = db.prepare(`
    UPDATE vessels SET name=@name, imo_number=@imoNumber, call_sign=@callSign, vessel_type=@vesselType,
                       flag=@flag, provider_id=@providerId, technology=@technology
    WHERE id=@id`);
  const remove = db.prepare('DELETE FROM vessels WHERE id = ?');

  function validate(body = {}) {
    const errors = {};
    const text = (v) => (typeof v === 'string' ? v.trim() : '');

    const name = text(body.name);
    if (name.length < 2 || name.length > 80) errors.name = 'Enter a vessel name (2 to 80 characters)';

    const imoNumber = normalizeImo(body.imoNumber);
    if (!isValidImo(imoNumber)) errors.imoNumber = 'Enter a valid 7 digit IMO number';

    const callSign = text(body.callSign).toUpperCase();
    if (callSign && !/^[A-Z0-9]{3,8}$/.test(callSign)) {
      errors.callSign = 'Call sign should be 3 to 8 letters or digits';
    }

    if (!VESSEL_TYPES.includes(body.vesselType)) errors.vesselType = 'Choose a vessel type';

    const flag = text(body.flag);
    if (flag.length < 2 || flag.length > 40) errors.flag = 'Enter the flag state';

    const providerId = Number(body.providerId);
    if (!Number.isInteger(providerId) || !providerExists.get(providerId)) {
      errors.providerId = 'Choose a connectivity provider';
    }

    if (!TECHNOLOGY_KEYS.includes(body.technology)) errors.technology = 'Choose a connectivity technology';

    if (Object.keys(errors).length) throw invalid(errors);

    return {
      name,
      imoNumber,
      callSign: callSign || null,
      vesselType: body.vesselType,
      flag,
      providerId,
      technology: body.technology,
    };
  }

  function guardUnique(fn) {
    try {
      return fn();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict('A vessel with this IMO number already exists', {
          imoNumber: 'This IMO number is already registered',
        });
      }
      throw err;
    }
  }

  return {
    list({ search, status, providerId, technology, sort, order, offset, pageSize }) {
      const where = [];
      const params = {};

      if (search) {
        const escaped = search.replace(/[\\%_]/g, (c) => `\\${c}`);
        params.search = `%${escaped}%`;
        where.push(`(v.name LIKE @search ESCAPE '\\' OR v.imo_number LIKE @search ESCAPE '\\'
                     OR v.call_sign LIKE @search ESCAPE '\\' OR p.name LIKE @search ESCAPE '\\')`);
      }
      if (status) {
        where.push("COALESCE(s.status, 'unknown') = @status");
        params.status = status;
      }
      if (providerId) {
        where.push('v.provider_id = @providerId');
        params.providerId = providerId;
      }
      if (technology) {
        where.push('v.technology = @technology');
        params.technology = technology;
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const dir = order === 'desc' ? 'DESC' : 'ASC';
      let orderSql;
      if (sort === 'status') {
        orderSql = `${STATUS_RANK} ${dir}, v.name COLLATE NOCASE`;
      } else if (SORT_COLUMNS[sort]) {
        const col = SORT_COLUMNS[sort];
        // offline vessels have no metrics; keep them at the bottom either way
        const nullsLast = col.startsWith('s.') ? `${col} IS NULL, ` : '';
        orderSql = `${nullsLast}${col} ${dir}, v.name COLLATE NOCASE`;
      } else {
        orderSql = `${STATUS_RANK}, v.name COLLATE NOCASE`;
      }

      const total = db.prepare(`SELECT COUNT(*) AS n ${FROM_JOINS} ${whereSql}`).get(params).n;
      const rows = db
        .prepare(`${BASE_SELECT} ${whereSql} ORDER BY ${orderSql} LIMIT @limit OFFSET @offset`)
        .all({ ...params, limit: pageSize, offset });

      const availability = analytics.availabilityByVessel();
      return { items: rows.map((r) => toDto(r, availability.get(r.id) ?? null)), total };
    },

    get(id) {
      const row = getRow.get(id);
      if (!row) throw notFound('Vessel');
      return toDto(row, analytics.availabilityByVessel().get(id) ?? null);
    },

    create(body) {
      const data = validate(body);
      const id = guardUnique(() => insert.run({ ...data, createdAt: Date.now() }).lastInsertRowid);
      return this.get(Number(id));
    },

    update(id, body) {
      if (!getRow.get(id)) throw notFound('Vessel');
      const data = validate(body);
      guardUnique(() => update.run({ ...data, id }));
      return this.get(id);
    },

    delete(id) {
      if (remove.run(id).changes === 0) throw notFound('Vessel');
    },
  };
}
