/**
 * thermalScoring.js
 * ------------------
 * Standalone thermal-cost scoring module — ported out of the browser-based
 * placement UI so it can run headless behind the API.
 *
 * Complexity: O(n) per optimize() call, where n = number of open (non-reserved,
 * non-occupied) slots in the rack. For each candidate slot we do O(1) work to
 * look up its (up to 4) orthogonal neighbors via a row/col index built once in
 * O(n) — no nested scan of the full slot list per candidate. Hard-constraint
 * slots (reserved, occupied) are pruned before scoring, not after.
 *
 * DEFAULT_SAFE_THRESHOLD_C is the ambient temperature (Celsius) above which a
 * zone is considered to have zero thermal headroom.
 */

const DEFAULT_WEIGHTS = { w1: 0.4, w2: 0.2, w3: 0.3, w4: 0.1 };
const DEFAULT_SAFE_THRESHOLD_C = 27; // ASHRAE-style recommended max cold-aisle intake temp

/**
 * Build a lookup map of "row,col" -> slot for O(1) neighbor access.
 */
function indexSlots(slots) {
  const map = new Map();
  for (const s of slots) map.set(`${s.row},${s.col}`, s);
  return map;
}

/**
 * Build a lookup map of slot_id -> node (for slots that are occupied).
 */
function indexNodesBySlot(nodes) {
  const map = new Map();
  for (const n of nodes) {
    if (n.slot_id) map.set(n.slot_id, n);
  }
  return map;
}

/**
 * Sum of thermal output (watts) of nodes in the four orthogonal neighbor
 * slots: same rack, one row above, one row below, one col left, one col right.
 * ("Same rack" is implicit — we only ever index slots within the rack being
 * scored, so all neighbors returned are already rack-local.)
 */
function neighborHeatSum(slot, slotIndex, nodeBySlot) {
  const deltas = [
    [-1, 0], // above
    [1, 0],  // below
    [0, -1], // left
    [0, 1],  // right
  ];
  let sum = 0;
  for (const [dr, dc] of deltas) {
    const neighbor = slotIndex.get(`${slot.row + dr},${slot.col + dc}`);
    if (!neighbor) continue;
    const node = nodeBySlot.get(neighbor.id);
    if (node) sum += node.thermal_output_watts;
  }
  return sum;
}

/**
 * Cold-aisle-facing slots are preferred (lower penalty). Hot-aisle slots are
 * penalized because they're already receiving exhaust air, not intake air.
 */
function airflowPenalty(slot) {
  return slot.airflow_zone === 'hot_aisle' ? 10 : 0;
}

/**
 * Heat rises, so a slot directly above a high-heat node is penalized more
 * than a slot beside it. We look one row *below* the candidate (row + 1,
 * same column) since heat from that node rises into the candidate slot.
 * Penalty scales with the heat source's output, normalized to a 0-10 band
 * against a 1000W reference ceiling (typical high-density GPU node draw).
 */
function verticalStackPenalty(slot, slotIndex, nodeBySlot) {
  const below = slotIndex.get(`${slot.row + 1},${slot.col}`);
  if (!below) return 0;
  const node = nodeBySlot.get(below.id);
  if (!node) return 0;
  const REFERENCE_CEILING_WATTS = 1000;
  return Math.min(10, (node.thermal_output_watts / REFERENCE_CEILING_WATTS) * 10);
}

/**
 * Zone thermal headroom deficit: how far the zone's current ambient reading
 * is above the safe threshold. 0 if at/below threshold or no reading provided
 * (we don't penalize slots with unknown ambient — absence isn't risk).
 */
function zoneHeadroomDeficit(slot, safeThresholdC) {
  if (slot.zone_ambient_c == null) return 0;
  return Math.max(0, slot.zone_ambient_c - safeThresholdC);
}

/**
 * Score a single candidate slot. Returns { cost, breakdown }.
 */
function scoreSlot(slot, { slotIndex, nodeBySlot, weights, safeThresholdC }) {
  const neighbor_heat_sum = neighborHeatSum(slot, slotIndex, nodeBySlot);
  const airflow_penalty = airflowPenalty(slot);
  const vertical_stack_penalty = verticalStackPenalty(slot, slotIndex, nodeBySlot);
  const zone_headroom_deficit = zoneHeadroomDeficit(slot, safeThresholdC);

  const cost =
    weights.w1 * neighbor_heat_sum +
    weights.w2 * airflow_penalty +
    weights.w3 * vertical_stack_penalty +
    weights.w4 * zone_headroom_deficit;

  return {
    cost: round2(cost),
    breakdown: {
      neighbor_heat_sum: round2(neighbor_heat_sum),
      airflow_penalty: round2(airflow_penalty),
      vertical_stack_penalty: round2(vertical_stack_penalty),
      zone_headroom_deficit: round2(zone_headroom_deficit),
    },
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Main entry point.
 *
 * @param {Object} params
 * @param {Array} params.slots - all slots in the rack (row, col, status, airflow_zone, reserved, zone_ambient_c, id)
 * @param {Array} params.nodes - all currently-placed nodes (slot_id, thermal_output_watts)
 * @param {Object} [params.weights] - {w1,w2,w3,w4}, defaults to DEFAULT_WEIGHTS
 * @param {number} [params.safeThresholdC] - defaults to DEFAULT_SAFE_THRESHOLD_C
 * @returns {Object} { recommended, alternatives, consideredCount, prunedCount }
 *   recommended: { slot_id, cost, breakdown } | null if no open slots
 *   alternatives: next-best candidates (up to 2), same shape, sorted ascending by cost
 */
function optimizePlacement({ slots, nodes, weights = DEFAULT_WEIGHTS, safeThresholdC = DEFAULT_SAFE_THRESHOLD_C }) {
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new Error('slots must be a non-empty array');
  }
  validateWeights(weights);

  const slotIndex = indexSlots(slots);
  const nodeBySlot = indexNodesBySlot(nodes || []);

  // Hard-constraint pruning: reserved corridors and already-occupied slots
  // are eliminated before any scoring work happens (not filtered after).
  const candidates = slots.filter((s) => s.status !== 'occupied' && !s.reserved);
  const prunedCount = slots.length - candidates.length;

  if (candidates.length === 0) {
    return { recommended: null, alternatives: [], consideredCount: 0, prunedCount };
  }

  const scored = candidates.map((slot) => {
    const { cost, breakdown } = scoreSlot(slot, { slotIndex, nodeBySlot, weights, safeThresholdC });
    return { slot_id: slot.id, cost, breakdown };
  });

  scored.sort((a, b) => a.cost - b.cost);

  return {
    recommended: scored[0],
    alternatives: scored.slice(1, 3), // up to 2 runner-ups
    consideredCount: scored.length,
    prunedCount,
  };
}

function validateWeights(weights) {
  for (const key of ['w1', 'w2', 'w3', 'w4']) {
    if (typeof weights[key] !== 'number' || Number.isNaN(weights[key])) {
      throw new Error(`weights.${key} must be a number`);
    }
  }
}

module.exports = {
  optimizePlacement,
  scoreSlot,
  neighborHeatSum,
  airflowPenalty,
  verticalStackPenalty,
  zoneHeadroomDeficit,
  DEFAULT_WEIGHTS,
  DEFAULT_SAFE_THRESHOLD_C,
};
