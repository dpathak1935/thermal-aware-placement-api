const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireApiKey } = require('../middleware/auth');
const { optimizePlacement, DEFAULT_WEIGHTS } = require('../thermalScoring');

const router = express.Router();

/**
 * @openapi
 * /api/optimize/thermal:
 *   post:
 *     summary: Given a new node's thermal profile, return ranked slot recommendations
 *     tags: [Optimize]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rack_id, new_node]
 *             properties:
 *               rack_id: { type: string }
 *               new_node:
 *                 type: object
 *                 required: [name, thermal_output_watts]
 *                 properties:
 *                   name: { type: string, example: "gpu-node-04" }
 *                   thermal_output_watts: { type: number, example: 450 }
 *               weights:
 *                 type: object
 *                 properties:
 *                   w1: { type: number }
 *                   w2: { type: number }
 *                   w3: { type: number }
 *                   w4: { type: number }
 *     responses:
 *       200: { description: Ranked recommendation with score breakdown, persisted to placement history }
 *       404: { description: Rack not found }
 */
router.post('/thermal', requireApiKey('optimize:run'), (req, res) => {
  const { rack_id, new_node, weights = DEFAULT_WEIGHTS } = req.body || {};

  if (!rack_id) return res.status(400).json({ error: 'rack_id is required' });
  if (!new_node || !new_node.name || typeof new_node.thermal_output_watts !== 'number') {
    return res.status(400).json({ error: 'new_node.name and new_node.thermal_output_watts are required' });
  }

  const rack = db.prepare('SELECT * FROM racks WHERE id = ?').get(rack_id);
  if (!rack) return res.status(404).json({ error: 'Rack not found' });

  const slots = db.prepare('SELECT * FROM slots WHERE rack_id = ?').all(rack_id).map((s) => ({
    id: s.id,
    row: s.row,
    col: s.col,
    status: s.status,
    airflow_zone: s.airflow_zone,
    reserved: !!s.reserved,
    zone_ambient_c: s.zone_ambient_c,
  }));
  const nodes = db
    .prepare(`SELECT nodes.* FROM nodes JOIN slots ON nodes.slot_id = slots.id WHERE slots.rack_id = ?`)
    .all(rack_id);

  let result;
  try {
    result = optimizePlacement({ slots, nodes, weights });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!result.recommended) {
    return res.status(409).json({ error: 'No open slots available in this rack (all occupied or reserved).' });
  }

  const slotLabelById = new Map(slots.map((s) => [s.id, `${rack.name}-slot-${s.row}-${s.col}`]));

  const placementId = uuidv4();
  const responseBody = {
    recommended_slot: slotLabelById.get(result.recommended.slot_id),
    cost: result.recommended.cost,
    breakdown: result.recommended.breakdown,
    alternatives: result.alternatives.map((a) => ({
      slot: slotLabelById.get(a.slot_id),
      cost: a.cost,
    })),
    meta: {
      considered_slots: result.consideredCount,
      pruned_slots: result.prunedCount,
      complexity: 'O(n) over open slots, n = considered_slots + pruned_slots',
    },
  };

  db.prepare(
    `INSERT INTO placements (id, rack_id, node_name, recommended_slot_id, cost, breakdown_json, weights_json, alternatives_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    placementId,
    rack_id,
    new_node.name,
    result.recommended.slot_id,
    result.recommended.cost,
    JSON.stringify(result.recommended.breakdown),
    JSON.stringify(weights),
    JSON.stringify(responseBody.alternatives)
  );

  res.json({ placement_id: placementId, ...responseBody });
});

module.exports = router;
