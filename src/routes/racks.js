const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

/**
 * @openapi
 * /api/racks:
 *   post:
 *     summary: Register a rack layout (slots, existing nodes, thermal data)
 *     tags: [Racks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, rows, columns]
 *             properties:
 *               name: { type: string, example: "rack-12" }
 *               rows: { type: integer, example: 6 }
 *               columns: { type: integer, example: 2 }
 *               slots:
 *                 type: array
 *                 description: Optional explicit slot overrides (airflow_zone, reserved, zone_ambient_c). Any (row,col) not listed defaults to an empty cold-aisle slot.
 *                 items:
 *                   type: object
 *                   properties:
 *                     row: { type: integer }
 *                     col: { type: integer }
 *                     airflow_zone: { type: string, enum: [cold_aisle, hot_aisle] }
 *                     reserved: { type: boolean }
 *                     zone_ambient_c: { type: number }
 *               nodes:
 *                 type: array
 *                 description: Existing nodes already occupying slots.
 *                 items:
 *                   type: object
 *                   properties:
 *                     name: { type: string }
 *                     row: { type: integer }
 *                     col: { type: integer }
 *                     thermal_output_watts: { type: number }
 *     responses:
 *       201: { description: Rack created }
 */
router.post('/', requireApiKey('racks:write'), (req, res) => {
  const { name, rows, columns, slots: slotOverrides = [], nodes: initialNodes = [] } = req.body || {};

  if (!name || !Number.isInteger(rows) || !Number.isInteger(columns) || rows <= 0 || columns <= 0) {
    return res.status(400).json({ error: 'name (string), rows (positive int), columns (positive int) are required' });
  }

  const rackId = uuidv4();
  const insertRack = db.prepare('INSERT INTO racks (id, name, rows, columns) VALUES (?, ?, ?, ?)');
  const insertSlot = db.prepare(
    `INSERT INTO slots (id, rack_id, row, col, status, airflow_zone, reserved, zone_ambient_c)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertNode = db.prepare(
    `INSERT INTO nodes (id, slot_id, name, thermal_output_watts, placed_at) VALUES (?, ?, ?, ?, datetime('now'))`
  );
  const markOccupied = db.prepare(`UPDATE slots SET status = 'occupied' WHERE id = ?`);

  const overrideMap = new Map(slotOverrides.map((o) => [`${o.row},${o.col}`, o]));
  const slotIdByCoord = new Map();

  const txn = db.transaction(() => {
    insertRack.run(rackId, name, rows, columns);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const o = overrideMap.get(`${r},${c}`) || {};
        const slotId = uuidv4();
        slotIdByCoord.set(`${r},${c}`, slotId);
        insertSlot.run(
          slotId,
          rackId,
          r,
          c,
          'empty',
          o.airflow_zone === 'hot_aisle' ? 'hot_aisle' : 'cold_aisle',
          o.reserved ? 1 : 0,
          typeof o.zone_ambient_c === 'number' ? o.zone_ambient_c : null
        );
      }
    }

    for (const n of initialNodes) {
      const slotId = slotIdByCoord.get(`${n.row},${n.col}`);
      if (!slotId) throw new Error(`No slot at row=${n.row}, col=${n.col} for node "${n.name}"`);
      const nodeId = uuidv4();
      insertNode.run(nodeId, slotId, n.name, n.thermal_output_watts);
      markOccupied.run(slotId);
    }
  });

  try {
    txn();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  res.status(201).json({ id: rackId, name, rows, columns });
});

/**
 * @openapi
 * /api/racks/{id}:
 *   get:
 *     summary: Fetch current layout state for a rack
 *     tags: [Racks]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Rack layout with slots and nodes }
 *       404: { description: Rack not found }
 */
router.get('/:id', requireApiKey('racks:read'), (req, res) => {
  const rack = db.prepare('SELECT * FROM racks WHERE id = ?').get(req.params.id);
  if (!rack) return res.status(404).json({ error: 'Rack not found' });

  const slots = db.prepare('SELECT * FROM slots WHERE rack_id = ? ORDER BY row, col').all(rack.id);
  const nodes = db
    .prepare(
      `SELECT nodes.* FROM nodes JOIN slots ON nodes.slot_id = slots.id WHERE slots.rack_id = ?`
    )
    .all(rack.id);

  res.json({ ...rack, slots, nodes });
});

module.exports = router;
