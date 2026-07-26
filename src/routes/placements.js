const express = require('express');
const db = require('../db');
const { requireApiKey } = require('../middleware/auth');

const router = express.Router();

/**
 * @openapi
 * /api/placements:
 *   get:
 *     summary: List placement history
 *     tags: [Placements]
 *     parameters:
 *       - in: query
 *         name: rack_id
 *         schema: { type: string }
 *         description: Optional filter by rack
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200: { description: List of past placement decisions }
 */
router.get('/', requireApiKey('placements:read'), (req, res) => {
  const { rack_id, limit = 50 } = req.query;
  let rows;
  if (rack_id) {
    rows = db
      .prepare('SELECT * FROM placements WHERE rack_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(rack_id, Number(limit));
  } else {
    rows = db.prepare('SELECT * FROM placements ORDER BY created_at DESC LIMIT ?').all(Number(limit));
  }
  res.json(
    rows.map((r) => ({
      id: r.id,
      rack_id: r.rack_id,
      node_name: r.node_name,
      recommended_slot_id: r.recommended_slot_id,
      cost: r.cost,
      created_at: r.created_at,
    }))
  );
});

/**
 * @openapi
 * /api/placements/{id}:
 *   get:
 *     summary: Fetch one past placement decision, with full score breakdown
 *     tags: [Placements]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Full placement record }
 *       404: { description: Not found }
 */
router.get('/:id', requireApiKey('placements:read'), (req, res) => {
  const row = db.prepare('SELECT * FROM placements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Placement not found' });

  res.json({
    id: row.id,
    rack_id: row.rack_id,
    node_name: row.node_name,
    recommended_slot_id: row.recommended_slot_id,
    cost: row.cost,
    breakdown: JSON.parse(row.breakdown_json),
    weights: JSON.parse(row.weights_json),
    alternatives: JSON.parse(row.alternatives_json),
    created_at: row.created_at,
  });
});

module.exports = router;
