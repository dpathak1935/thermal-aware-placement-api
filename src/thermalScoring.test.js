const {
  optimizePlacement,
  neighborHeatSum,
  airflowPenalty,
  verticalStackPenalty,
  zoneHeadroomDeficit,
  DEFAULT_WEIGHTS,
} = require('./thermalScoring');

// Helper to build a simple 3x3 grid of slots, all empty/cold-aisle by default
function makeGrid({ rows = 3, cols = 3, overrides = {} } = {}) {
  const slots = [];
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = `s${n++}`;
      slots.push({
        id,
        row: r,
        col: c,
        status: 'empty',
        airflow_zone: 'cold_aisle',
        reserved: false,
        zone_ambient_c: null,
        ...(overrides[id] || {}),
      });
    }
  }
  return slots;
}

describe('neighborHeatSum', () => {
  it('sums heat of orthogonal neighbors only (not diagonal)', () => {
    const slots = makeGrid();
    const slotIndex = new Map(slots.map((s) => [`${s.row},${s.col}`, s]));
    // node in slot (0,1) = above target (1,1); node in diagonal (0,0) should NOT count
    const nodes = [
      { slot_id: 's1', thermal_output_watts: 100 }, // (0,1) - above (1,1)
      { slot_id: 's0', thermal_output_watts: 999 }, // (0,0) - diagonal, excluded
    ];
    const nodeBySlot = new Map(nodes.map((n) => [n.slot_id, n]));
    const target = slots.find((s) => s.row === 1 && s.col === 1); // s4
    const sum = neighborHeatSum(target, slotIndex, nodeBySlot);
    expect(sum).toBe(100);
  });

  it('returns 0 when no neighbors are occupied', () => {
    const slots = makeGrid();
    const slotIndex = new Map(slots.map((s) => [`${s.row},${s.col}`, s]));
    const target = slots[4];
    expect(neighborHeatSum(target, slotIndex, new Map())).toBe(0);
  });
});

describe('airflowPenalty', () => {
  it('penalizes hot-aisle slots more than cold-aisle', () => {
    expect(airflowPenalty({ airflow_zone: 'hot_aisle' })).toBeGreaterThan(
      airflowPenalty({ airflow_zone: 'cold_aisle' })
    );
  });
});

describe('verticalStackPenalty', () => {
  it('penalizes a slot sitting above a high-heat node', () => {
    const slots = makeGrid();
    const slotIndex = new Map(slots.map((s) => [`${s.row},${s.col}`, s]));
    const target = slots.find((s) => s.row === 0 && s.col === 0); // s0, above s3 (row 1, col 0)
    const nodeBySlot = new Map([['s3', { slot_id: 's3', thermal_output_watts: 500 }]]);
    const penalty = verticalStackPenalty(target, slotIndex, nodeBySlot);
    expect(penalty).toBeGreaterThan(0);
  });

  it('is 0 for the bottom row (nothing below to stack heat from)', () => {
    const slots = makeGrid();
    const slotIndex = new Map(slots.map((s) => [`${s.row},${s.col}`, s]));
    const bottom = slots.find((s) => s.row === 2 && s.col === 0);
    expect(verticalStackPenalty(bottom, slotIndex, new Map())).toBe(0);
  });
});

describe('zoneHeadroomDeficit', () => {
  it('returns 0 when ambient is below threshold', () => {
    expect(zoneHeadroomDeficit({ zone_ambient_c: 20 }, 27)).toBe(0);
  });

  it('returns the delta when ambient exceeds threshold', () => {
    expect(zoneHeadroomDeficit({ zone_ambient_c: 30 }, 27)).toBe(3);
  });

  it('returns 0 when no ambient reading is provided (absence is not risk)', () => {
    expect(zoneHeadroomDeficit({ zone_ambient_c: null }, 27)).toBe(0);
  });
});

describe('optimizePlacement — integration', () => {
  it('throws on empty slot list', () => {
    expect(() => optimizePlacement({ slots: [], nodes: [] })).toThrow();
  });

  it('throws when a weight is missing/invalid', () => {
    const slots = makeGrid();
    expect(() =>
      optimizePlacement({ slots, nodes: [], weights: { w1: 0.4, w2: 0.2, w3: 0.3 } })
    ).toThrow();
  });

  it('prunes reserved and occupied slots as hard constraints', () => {
    const slots = makeGrid({
      overrides: {
        s0: { reserved: true },
        s1: { status: 'occupied' },
      },
    });
    const result = optimizePlacement({ slots, nodes: [] });
    expect(result.prunedCount).toBe(2);
    expect(result.consideredCount).toBe(slots.length - 2);
    expect(result.recommended.slot_id).not.toBe('s0');
    expect(result.recommended.slot_id).not.toBe('s1');
  });

  it('returns null recommendation when every slot is pruned', () => {
    const slots = makeGrid().map((s) => ({ ...s, reserved: true }));
    const result = optimizePlacement({ slots, nodes: [] });
    expect(result.recommended).toBeNull();
    expect(result.alternatives).toEqual([]);
  });

  it('recommends the lowest-cost slot, away from an existing hot node', () => {
    // Place a hot node at (1,1) (center). The center-adjacent slots should
    // score worse than a corner slot far from it.
    const slots = makeGrid();
    const nodes = [{ slot_id: 's4', thermal_output_watts: 500 }]; // s4 = (1,1) center
    const result = optimizePlacement({ slots, nodes, weights: DEFAULT_WEIGHTS });

    // Corner s0 (0,0) is not orthogonally adjacent to center and not directly
    // above it, so it should score lower (better) than the neighbors of s4.
    const corner = result.alternatives.concat(result.recommended).find((r) => r.slot_id === 's0');
    const neighborOfHot = [...result.alternatives, result.recommended].find((r) =>
      ['s1', 's3', 's5', 's7'].includes(r.slot_id)
    );
    expect(corner.cost).toBeLessThanOrEqual(neighborOfHot.cost);
  });

  it('returns at most 2 alternatives, sorted ascending by cost', () => {
    const slots = makeGrid();
    const result = optimizePlacement({ slots, nodes: [] });
    expect(result.alternatives.length).toBeLessThanOrEqual(2);
    const costs = [result.recommended.cost, ...result.alternatives.map((a) => a.cost)];
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i]).toBeGreaterThanOrEqual(costs[i - 1]);
    }
  });
});
