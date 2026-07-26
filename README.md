# Thermal-Aware Node Placement Optimization API

Converts a browser-based thermal-aware placement algorithm into a standalone,
reusable backend service. Given a rack layout and a new node's thermal
profile, the API returns the optimal slot(s) to place it in, ranked by
thermal risk score — with every recommendation explainable (cost + factor
breakdown) and persisted to a queryable history.

## Problem

Data centres physically place new server/compute nodes into rack slots
without a systematic way to evaluate thermal risk. Manual placement leads to
hotspot clustering, which increases cooling load, raises failure risk, and
shortens hardware lifespan. This API turns that decision into a scored,
explainable, and auditable API call.

## Quickstart

```bash
npm install
npm test          # runs Jest unit tests on the scoring engine
npm start         # starts the server on :3000
```

Then open `http://localhost:3000/docs` for interactive Swagger UI.

### 1. Issue an API key

```bash
curl -X POST http://localhost:3000/api/auth/keys \
  -H "Content-Type: application/json" \
  -d '{"owner":"demo-user","scopes":["racks:read","racks:write","optimize:run","placements:read"]}'
```

Save the returned `api_key` — it's shown once.

### 2. Register a rack

```bash
curl -X POST http://localhost:3000/api/racks \
  -H "Content-Type: application/json" -H "x-api-key: YOUR_KEY" \
  -d '{
    "name": "rack-12",
    "rows": 6,
    "columns": 2,
    "nodes": [{ "name": "gpu-node-01", "row": 2, "col": 0, "thermal_output_watts": 500 }]
  }'
```

### 3. Get a placement recommendation

```bash
curl -X POST http://localhost:3000/api/optimize/thermal \
  -H "Content-Type: application/json" -H "x-api-key: YOUR_KEY" \
  -d '{
    "rack_id": "RACK_ID_FROM_STEP_2",
    "new_node": { "name": "gpu-node-04", "thermal_output_watts": 450 },
    "weights": { "w1": 0.4, "w2": 0.2, "w3": 0.3, "w4": 0.1 }
  }'
```

## Architecture

```
Client (Swagger UI / curl / future provisioning system)
        |
        v
  Express app (src/app.js)
        |
        +-- middleware/auth.js       (API-key auth, hashed storage, scoped)
        |
        +-- routes/authKeys.js       -> POST /api/auth/keys
        +-- routes/racks.js          -> POST/GET /api/racks
        +-- routes/optimize.js       -> POST /api/optimize/thermal
        +-- routes/placements.js     -> GET /api/placements[/:id]
        |
        +-- thermalScoring.js        (pure, dependency-free scoring engine)
        |
        v
  SQLite (better-sqlite3, src/db/schema.sql)
```

The scoring engine (`src/thermalScoring.js`) has zero dependencies on
Express or the database — it's pure functions over plain objects, which is
what makes it directly unit-testable and portable back into a browser
context if needed.

## Algorithm & complexity

**Cost function** (weighted sum, weights configurable per request):

```
cost(slot) = w1 * neighbor_heat_sum
           + w2 * airflow_penalty
           + w3 * vertical_stack_penalty
           + w4 * zone_headroom_deficit
```

- **neighbor_heat_sum** — total thermal output (W) of nodes in the 4
  orthogonal neighbor slots (up/down/left/right within the rack)
- **airflow_penalty** — flat penalty for hot-aisle-facing slots vs cold-aisle
- **vertical_stack_penalty** — heat rises, so a slot directly above a
  high-heat node is penalized proportionally to that node's output
- **zone_headroom_deficit** — how far the zone's current ambient reading
  exceeds a configurable safe threshold (0 if no reading is provided —
  absence of data isn't treated as risk)

**Complexity:** O(n) per `/api/optimize/thermal` request, where n = number of
slots in the rack.

1. Build a `(row,col) -> slot` index and a `slot_id -> node` index once, both
   O(n).
2. **Prune** hard-constraint slots (occupied, reserved) *before* scoring —
   these never enter the cost calculation.
3. **Score** each remaining candidate in O(1) (fixed 4-neighbor lookup + 1
   below-lookup + 2 field reads), so scoring all candidates is O(n).
4. **Sort** candidates by cost — O(n log n), dominates overall complexity for
   large racks but is still fast at the stated scale (< 300ms up to 200
   slots).

This is a greedy candidate-scoring approach, not a search/optimization
algorithm with backtracking — appropriate here because slots don't interact
combinatorially (placing node A in slot X doesn't change the *validity* of
placing node B in slot Y within the same request), so independent scoring +
sort is both correct and efficient.

## Data model

See `src/db/schema.sql`. Tables: `racks`, `slots`, `nodes`, `placements`,
`api_keys`. Every `/api/optimize/thermal` call writes a row to `placements`
with the full breakdown and weights used — decisions are never computed and
discarded.

## Migration path (SQLite → MSSQL/Postgres)

Dev uses SQLite (`better-sqlite3`) for zero-setup local development. The
schema in `src/db/schema.sql` avoids SQLite-specific features (no `AUTOINCREMENT`
reliance, UUIDs as TEXT primary keys, ISO datetime strings) specifically so it
maps cleanly to MSSQL or Postgres later: swap `src/db/index.js`'s connection
for `mssql`/`pg`, translate the `CREATE TABLE` statements (mostly 1:1 — `TEXT`
→ `NVARCHAR`/`VARCHAR`, `REAL` → `FLOAT`), and the route/scoring layers don't
change at all since they only depend on `better-sqlite3`'s `.prepare().run()/.get()/.all()`
being replaced with an equivalent driver call.

## Auth

Every endpoint except `/health`, `/docs`, and `POST /api/auth/keys` requires
an `x-api-key` header. Keys are scoped (`racks:read`, `racks:write`,
`optimize:run`, `placements:read`, or `*`) and stored as SHA-256 hashes only
— the raw key is shown once at creation time and cannot be retrieved again.

## Testing

`src/thermalScoring.test.js` covers each cost factor in isolation
(neighbor sum, airflow penalty, vertical stacking, headroom deficit) plus
integration tests on `optimizePlacement()`: hard-constraint pruning, the
all-slots-blocked edge case, weight validation, and that a hot existing node
correctly pushes recommendations toward slots away from it.

```bash
npm test
```

## Out of scope (this submission)

- Real-time IoT sensor integration (thermal profile is submitted as input)
- Multi-objective scoring combining power/network/cooling
- Multi-tenant auth beyond single-owner scoped keys

See the PRD's §8 "Future Expansion" for the planned path to each of these.

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js + Express |
| Database | SQLite (`better-sqlite3`), portable schema |
| Auth | Custom scoped API-key middleware, SHA-256 hashed |
| Docs | Swagger / OpenAPI (`swagger-jsdoc` + `swagger-ui-express`) |
| Testing | Jest |
