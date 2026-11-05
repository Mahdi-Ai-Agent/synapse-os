import { describe, expect, it } from 'vitest';
import { computeAnchors, CORE_GROUP, INBOX_GROUP, Layout, ROOM_MAX, ROOM_MIN, type LayoutSnapshot, type Point, type ZoneLayout } from '../src/graph/layout';

describe('layout', () => {
  const order = [CORE_GROUP, 'a', 'b', INBOX_GROUP];
  const sizes = new Map([[CORE_GROUP, 1], ['a', 5], ['b', 5], [INBOX_GROUP, 3]]);

  it('an inbox saved at the heart before the core existed takes a ring slot', () => {
    const placed = new Map<string, Point>([[INBOX_GROUP, [0, 0, 0]]]);
    const anchors = computeAnchors(order, sizes, 2, undefined, placed);
    const inbox = anchors.get(INBOX_GROUP)!;
    expect(Math.hypot(inbox.x, inbox.y)).toBeGreaterThan(40);
    expect(anchors.get(CORE_GROUP)).toMatchObject({ x: 0, y: 0 });
  });

  it('an inbox the user placed elsewhere stays where it is', () => {
    const placed = new Map<string, Point>([[INBOX_GROUP, [300, 120, 0]]]);
    const anchors = computeAnchors(order, sizes, 2, undefined, placed);
    expect(anchors.get(INBOX_GROUP)).toMatchObject({ x: 300, y: 120 });
  });

  const core = { id: 'core:mind', group: CORE_GROUP, hub: true, r: 10 };
  const a1 = { id: 'a1', group: 'a', hub: false, r: 4 };
  const b1 = { id: 'b1', group: 'b', hub: false, r: 4 };
  const c1 = { id: 'c1', group: 'c', hub: false, r: 4 };

  it('a new region never moves the ones already placed', () => {
    const layout = new Layout(2);
    layout.setData([core, a1, b1], [], [CORE_GROUP, 'a', 'b']);
    const a = { ...layout.anchors.get('a')! };
    const b = { ...layout.anchors.get('b')! };
    layout.setData([core, a1, b1, c1], [], [CORE_GROUP, 'a', 'b', 'c']);
    expect(layout.anchors.get('a')).toMatchObject({ x: a.x, y: a.y });
    expect(layout.anchors.get('b')).toMatchObject({ x: b.x, y: b.y });
    expect(layout.anchors.has('c')).toBe(true);
  });

  it('a connection change leaves an island where it is', () => {
    const layout = new Layout(2);
    const m = { id: 'm', group: 'map:m', hub: true, r: 10 };
    const input = [core, a1, m, c1];
    const order = [CORE_GROUP, 'a', 'map:m', 'c'];
    const zones = (near: boolean): ZoneLayout => ({ of: new Map([['map:m', 'm'], ['c', 'm']]), list: [{ id: 'm', near }], connected: () => near });
    layout.setData(input, [], order, zones(true));
    const before = { ...layout.anchors.get('map:m')! };
    layout.setData(input, [], order, zones(false));
    expect(layout.anchors.get('map:m')).toMatchObject({ x: before.x, y: before.y });
    expect(layout.anchors.get('c')).toBeDefined();
  });

  it('a refresh that changes nothing does not stir the nodes', () => {
    const layout = new Layout(2);
    layout.setData([core, a1, b1], [], [CORE_GROUP, 'a', 'b']);
    while (layout.tick()) { /* settle */ }
    const x = layout.nodes.map((n) => [n.x, n.y]);
    layout.setData([core, a1, b1], [], [CORE_GROUP, 'a', 'b']);
    expect(layout.settled).toBe(true);
    expect(layout.nodes.map((n) => [n.x, n.y])).toEqual(x);
  });

  it('without a core the inbox keeps the heart', () => {
    const anchors = computeAnchors(['a', 'b', INBOX_GROUP], sizes, 2, undefined, new Map<string, Point>([[INBOX_GROUP, [0, 0, 0]]]));
    expect(anchors.get(INBOX_GROUP)).toMatchObject({ x: 0, y: 0 });
  });
});

describe('layout spread', () => {
  const core = { id: 'core:mind', group: CORE_GROUP, hub: true, r: 10 };
  const hub = { id: 'a', group: 'a', hub: true, r: 9 };
  const items = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, group: 'a', hub: false, r: 4 }));
  const links = items.map((n) => ({ source: n.id, target: 'a' }));
  const settle = (l: Layout): void => { for (let i = 0; i < 3000 && l.tick(); i++) { /* settle */ } };
  /** Mean distance from each item to its nearest neighbour: how crowded the region is. */
  const meanGap = (l: Layout): number => {
    const pts = l.nodes.filter((n) => n.group === 'a' && !n.hub);
    let sum = 0;
    for (const p of pts) { let best = Infinity; for (const q of pts) if (q !== p) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y)); sum += best; }
    return sum / pts.length;
  };

  it('opens a crowded spot and keeps it open; gathering closes it again and on below the laid-out spacing', () => {
    const l = new Layout(2);
    l.setData([core, hub, ...items], links, [CORE_GROUP, 'a']);
    settle(l);
    const before = meanGap(l);
    const hits = items.map((n) => ({ id: n.id, f: 1, dir: [1, 0, 0] as Point }));
    for (let k = 0; k < 3; k++) { l.spread(hits, false, 2); settle(l); }
    const opened = meanGap(l);
    expect(opened).toBeGreaterThan(before * 1.5);
    // It stays open: a refresh with the same data stirs nothing.
    l.setData([core, hub, ...items], links, [CORE_GROUP, 'a']);
    expect(l.settled).toBe(true);
    for (let k = 0; k < 6; k++) { l.spread(hits, true, 2); settle(l); }
    expect(meanGap(l)).toBeLessThan(opened * 0.8);
    // Gathering goes on past the spacing the map was laid out with, down to ROOM_MIN, and never overlaps items.
    for (let k = 0; k < 6; k++) { l.spread(hits, true, 2); settle(l); }
    expect(meanGap(l)).toBeLessThan(before * 0.85);
    expect(l.nodes.filter((n) => !n.hub).every((n) => (n.room ?? 1) >= ROOM_MIN && (n.room ?? 1) < 1)).toBe(true);
    const pts = l.nodes.filter((n) => n.group === 'a' && !n.hub);
    for (const p of pts) for (const q of pts) if (p !== q) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(p.r + q.r);
    // It stays gathered: a refresh with the same data stirs nothing.
    l.setData([core, hub, ...items], links, [CORE_GROUP, 'a']);
    expect(l.settled).toBe(true);
  });

  it('saves gathered room and whether the map was still moving, and settles a mid-move save fully on load', () => {
    const l = new Layout(2);
    l.setData([core, hub, ...items], links, [CORE_GROUP, 'a']);
    settle(l);
    l.spread(items.map((n) => ({ id: n.id, f: 1, dir: [1, 0, 0] as Point })), true, 0);
    const moving = l.snapshot();
    expect(moving.settled).toBe(false);
    expect(Object.values(moving.room).every((v) => v < 1)).toBe(true);
    const again = new Layout(2);
    again.restore(moving);
    again.setData([core, hub, ...items], links, [CORE_GROUP, 'a']);
    expect(again.node('a0')!.room).toBeLessThan(1);
    expect(again.alpha).toBeGreaterThan(0.25);
    settle(l);
    const still = l.snapshot();
    expect(still.settled).toBe(true);
    const calm = new Layout(2);
    calm.restore(still);
    calm.setData([core, hub, ...items], links, [CORE_GROUP, 'a']);
    expect(calm.alpha).toBeLessThan(0.1);
  });

  it('gives most room at the brush centre, caps it, saves and restores it, and re-arranging forgets it', () => {
    const l = new Layout(2);
    l.setData([core, hub, ...items], links, [CORE_GROUP, 'a']);
    l.spread([{ id: 'a0', f: 1, dir: [1, 0, 0] }, { id: 'a1', f: 0.2, dir: [0, 1, 0] }], false, 0);
    const r0 = l.node('a0')!.room!; const r1 = l.node('a1')!.room!;
    expect(r0).toBeGreaterThan(r1);
    expect(r1).toBeGreaterThan(1);
    for (let k = 0; k < 20; k++) l.spread([{ id: 'a0', f: 1, dir: [1, 0, 0] }], false, 0);
    expect(l.node('a0')!.room).toBe(ROOM_MAX);
    const snap = l.snapshot();
    expect(snap.room['a0']).toBe(ROOM_MAX);
    expect(snap.room['a5']).toBeUndefined();
    const again = new Layout(2);
    again.restore(snap);
    again.setData([core, hub, ...items], links, [CORE_GROUP, 'a']);
    expect(again.node('a0')!.room).toBe(ROOM_MAX);
    again.rearrange();
    expect(again.snapshot().room).toEqual({});
  });
});

describe('layout taken from another copy', () => {
  const core = { id: 'core:mind', group: CORE_GROUP, hub: true, r: 10 };
  const hub = { id: 'a', group: 'a', hub: true, r: 9 };
  const items = Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, group: 'a', hub: false, r: 4 }));
  const links = items.map((n) => ({ source: n.id, target: 'a' }));
  const settled = (): Layout => {
    const l = new Layout(2);
    l.setData([core, hub, ...items], links, [CORE_GROUP, 'a']);
    for (let i = 0; i < 3000 && l.tick(); i++) { /* settle */ }
    return l;
  };
  const settle = (l: Layout): void => { for (let i = 0; i < 3000 && l.tick(); i++) { /* settle */ } };

  it("takes the other copy's places, room, pins and anchors without stirring the map", () => {
    const other = settled();
    other.spread([{ id: 'a0', f: 1, dir: [1, 0, 0] }], false, 0);
    other.pin('a2', 40, 40, 0);
    settle(other);
    const saved = other.snapshot();
    const l = settled();
    l.spread([{ id: 'a4', f: 1, dir: [1, 0, 0] }], false, 0);
    l.pin('a3', -40, -40, 0);
    settle(l);
    l.adopt(saved);
    expect(l.settled).toBe(true);
    expect(l.node('a0')!.room).toBe(saved.room['a0']);
    // The saved layout is the whole truth for room and pins: what it does not name has none.
    expect(l.node('a4')!.room ?? 1).toBe(1);
    expect(l.isPinned('a3')).toBe(false);
    expect(l.isPinned('a2')).toBe(true);
    for (const n of l.nodes) expect([n.x, n.y]).toEqual([saved.positions[n.id]![0], saved.positions[n.id]![1]]);
    expect(l.snapshot().room).toEqual(saved.room);
    // With this copy's own changes merged in, the map settles again around them.
    l.adopt(saved, true);
    expect(l.alpha).toBeGreaterThanOrEqual(0.3);
  });

  it('asks to be saved once when laid out from scratch, never when restored', () => {
    const fresh = new Layout(2);
    fresh.setData([core, hub, ...items], links, [CORE_GROUP, 'a']);
    expect(fresh.takeFresh()).toBe(true);
    expect(fresh.takeFresh()).toBe(false);
    const restored = new Layout(2);
    restored.restore(fresh.snapshot());
    restored.setData([core, hub, ...items], links, [CORE_GROUP, 'a']);
    expect(restored.takeFresh()).toBe(false);
  });
});

describe('layout restored before its data', () => {
  const core = { id: 'core:mind', group: CORE_GROUP, hub: true, r: 10 };
  const hub = { id: 'a', group: 'a', hub: true, r: 9 };
  const items = Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, group: 'a', hub: false, r: 4 }));
  const links = items.map((n) => ({ source: n.id, target: 'a' }));
  const all = [core, hub, ...items];
  const order = [CORE_GROUP, 'a'];
  const settle = (l: Layout): void => { for (let i = 0; i < 3000 && l.tick(); i++) { /* settle */ } };
  /** A settled map with a spread spot, as saved. */
  const saved = (): LayoutSnapshot => {
    const l = new Layout(2);
    l.setData(all, links, order);
    settle(l);
    l.spread([{ id: 'a0', f: 1, dir: [1, 0, 0] }, { id: 'a1', f: 1, dir: [1, 0, 0] }], false, 0);
    settle(l);
    return l.snapshot();
  };
  const without = (id: string) => [all.filter((n) => n.id !== id), links.filter((x) => x.source !== id)] as const;

  it('keeps the saved map when the first data has no items (the page before the vault answered)', () => {
    const s = saved();
    const l = new Layout(2);
    l.restore(s);
    l.setData([], [], order);
    l.setData(all, links, order);
    expect(l.takeFresh()).toBe(false);
    expect(l.node('a0')!.room).toBe(s.room['a0']);
    for (const n of l.nodes) expect([n.x, n.y]).toEqual([s.positions[n.id]![0], s.positions[n.id]![1]]);
  });

  it('a node hidden by a filter keeps its place and room in every save, and gets them back when shown', () => {
    const s = saved();
    const l = new Layout(2);
    l.restore(s);
    l.setData(...without('a0'), order);
    settle(l);
    const snap = l.snapshot();
    expect(snap.positions['a0']).toEqual(s.positions['a0']);
    expect(snap.room['a0']).toBe(s.room['a0']);
    l.setData(all, links, order);
    expect([l.node('a0')!.x, l.node('a0')!.y]).toEqual([s.positions['a0']![0], s.positions['a0']![1]]);
    expect(l.node('a0')!.room).toBe(s.room['a0']);
  });

  it("takes another copy's newer place for a hidden node, and re-arranging forgets hidden ones", () => {
    const s = saved();
    const l = new Layout(2);
    l.restore(s);
    l.setData(...without('a0'), order);
    l.adopt({ ...s, positions: { ...s.positions, a0: [123, -45, 0] }, room: { ...s.room, a0: 3 } });
    expect(l.snapshot().positions['a0']).toEqual([123, -45, 0]);
    expect(l.snapshot().room['a0']).toBe(3);
    l.rearrange();
    expect(l.snapshot().positions['a0']).toBeUndefined();
    expect(l.snapshot().room['a0']).toBeUndefined();
  });
});
