import { describe, expect, it } from 'vitest';
import { planReach } from '../src/graph/arcs';

describe('graph/arcs', () => {
  it('runs the hops one after another, out from the brain edge, and brings the answer back in reverse', () => {
    const p = planReach([200, 90, 60], 27, 10, 0.3, false);
    expect(p.legs).toHaveLength(3);
    expect(p.legs[0]!.t0).toBeCloseTo(10.3);
    expect(p.legs[0]!.u0).toBeGreaterThan(0);
    expect(p.legs[1]!.u0).toBe(0);
    for (let k = 1; k < 3; k++) expect(p.legs[k]!.t0).toBeCloseTo(p.legs[k - 1]!.t0 + p.legs[k - 1]!.dur);
    expect(p.arrive).toBeCloseTo(p.legs[2]!.t0 + p.legs[2]!.dur);
    // The answer leaves the item after a moment there, from the last hop inward.
    expect(p.legs[2]!.back0).toBeCloseTo(p.arrive + 0.45);
    expect(p.legs[1]!.back0).toBeCloseTo(p.legs[2]!.back0 + p.legs[2]!.backDur);
    expect(p.legs[0]!.back0).toBeCloseTo(p.legs[1]!.back0 + p.legs[1]!.backDur);
    expect(p.edgeHome).toBeGreaterThan(p.legs[0]!.back0);
    expect(p.edgeHome).toBeLessThan(p.legs[0]!.back0 + p.legs[0]!.backDur);
    expect(p.end).toBeGreaterThan(p.edgeHome);
  });

  it('waits longer at an item it writes than at one it reads', () => {
    const read = planReach([150], 27, 0, 0.3, false);
    const write = planReach([150], 27, 0, 0.3, true);
    expect(write.legs[0]!.back0 - write.arrive).toBeGreaterThan(read.legs[0]!.back0 - read.arrive);
  });
});