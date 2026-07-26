-- Thermal-Aware Placement API — schema
-- SQLite for dev; column types chosen to be portable to Postgres/MSSQL later
-- (see README "Migration path" section).

CREATE TABLE IF NOT EXISTS racks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  rows        INTEGER NOT NULL,
  columns     INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS slots (
  id            TEXT PRIMARY KEY,
  rack_id       TEXT NOT NULL REFERENCES racks(id) ON DELETE CASCADE,
  row           INTEGER NOT NULL,
  col           INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'empty' CHECK (status IN ('empty', 'occupied')),
  airflow_zone  TEXT NOT NULL DEFAULT 'cold_aisle' CHECK (airflow_zone IN ('cold_aisle', 'hot_aisle')),
  reserved      INTEGER NOT NULL DEFAULT 0,       -- boolean 0/1
  zone_ambient_c REAL,                            -- current ambient reading of the zone, optional
  UNIQUE (rack_id, row, col)
);

CREATE TABLE IF NOT EXISTS nodes (
  id                    TEXT PRIMARY KEY,
  slot_id               TEXT REFERENCES slots(id) ON DELETE SET NULL,
  name                  TEXT NOT NULL,
  thermal_output_watts  REAL NOT NULL,
  placed_at             TEXT
);

CREATE TABLE IF NOT EXISTS placements (
  id                   TEXT PRIMARY KEY,
  rack_id              TEXT NOT NULL REFERENCES racks(id) ON DELETE CASCADE,
  node_name            TEXT NOT NULL,
  recommended_slot_id  TEXT,
  cost                 REAL NOT NULL,
  breakdown_json       TEXT NOT NULL,   -- JSON blob: {neighbor_heat_sum, airflow_penalty, ...}
  weights_json         TEXT NOT NULL,   -- JSON blob: {w1,w2,w3,w4}
  alternatives_json    TEXT NOT NULL,   -- JSON array of {slot, cost}
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
  id            TEXT PRIMARY KEY,
  key_prefix    TEXT NOT NULL,     -- first 8 chars shown to user for identification
  key_hash      TEXT NOT NULL,     -- sha256 hash of full key, never store plaintext
  owner         TEXT NOT NULL,
  scopes        TEXT NOT NULL,     -- comma-separated e.g. "racks:read,racks:write,optimize:run"
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT,
  revoked_at    TEXT,
  last_used_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_slots_rack_id ON slots(rack_id);
CREATE INDEX IF NOT EXISTS idx_nodes_slot_id ON nodes(slot_id);
CREATE INDEX IF NOT EXISTS idx_placements_rack_id ON placements(rack_id);
