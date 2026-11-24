 

CREATE TABLE IF NOT EXISTS providers (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS vessels (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  imo_number   TEXT NOT NULL UNIQUE,
  call_sign    TEXT,
  vessel_type  TEXT NOT NULL,
  flag         TEXT NOT NULL,
  provider_id  INTEGER NOT NULL REFERENCES providers(id),
  technology   TEXT NOT NULL CHECK (technology IN ('LEO', 'VSAT_KU', 'VSAT_KA', 'LBAND', 'LTE')),
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vessels_provider ON vessels(provider_id);

-- Latest known state, one row per vessel. Kept separate from the sample log
-- so the fleet table does not have to dig through history to show "now".
CREATE TABLE IF NOT EXISTS vessel_status (
  vessel_id         INTEGER PRIMARY KEY REFERENCES vessels(id) ON DELETE CASCADE,
  status            TEXT NOT NULL CHECK (status IN ('online', 'degraded', 'offline')),
  latency_ms        REAL,
  download_mbps     REAL,
  upload_mbps       REAL,
  packet_loss_pct   REAL,
  status_since      INTEGER NOT NULL,
  last_reported_at  INTEGER NOT NULL
);

-- Append-only log of readings. Offline samples carry NULL metrics.
CREATE TABLE IF NOT EXISTS connectivity_samples (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  vessel_id        INTEGER NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  recorded_at      INTEGER NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('online', 'degraded', 'offline')),
  latency_ms       REAL,
  download_mbps    REAL,
  upload_mbps      REAL,
  packet_loss_pct  REAL
);

CREATE INDEX IF NOT EXISTS idx_samples_vessel_time ON connectivity_samples(vessel_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_samples_time ON connectivity_samples(recorded_at);

CREATE TABLE IF NOT EXISTS alerts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  vessel_id        INTEGER NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN ('offline', 'degraded')),
  severity         TEXT NOT NULL CHECK (severity IN ('critical', 'warning')),
  message          TEXT NOT NULL,
  opened_at        INTEGER NOT NULL,
  resolved_at      INTEGER,
  acknowledged_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_alerts_vessel ON alerts(vessel_id, opened_at);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts(resolved_at, opened_at);

-- A vessel can only have one open alert of each type. Enforced here, not just
-- in code, so a bug in the ingest path cannot create duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_one_open
  ON alerts(vessel_id, type) WHERE resolved_at IS NULL;
