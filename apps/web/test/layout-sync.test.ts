import { describe, expect, it } from 'vitest';
import { CORE_GROUP, Layout, type LayoutSnapshot, type Point } from '../src/graph/layout';
import { LayoutSync, mergeLayouts, type LayoutIo, type LayoutMap } from '../src/lib/layout-sync';
import type { SavedLayout } from '../src/lib/types';

/** The server as the sync sees it (apps/server `layout-store.ts`): a count of saves, and a stale save refused. */
class FakeServer {
  file: SavedLayout = { anchors: {}, pins: {}, positions: {}, room: {}, settled: true, savedAt: '', rev: 0 };
  log: Array<{ client: string; base: number; keepalive: boolean | 'auto'; ok: boolean }> = [];
  private by: string | null = null;
  private byFrom = 0;

  get rev(): number { return this.file.rev ?? 0; }

  io(): LayoutIo {
    return {
      load: async () => structuredClone(this.file),
      save: async (body, keepalive) => {
        const cur = this.rev;
        const own = this.by === body.client && body.base >= this.byFrom && body.base <= cur;
        if (body.base !== cur && !own) {
          this.log.push({ client: body.client, base: body.base, keepalive, ok: false });
          return { ok: false, stale: true, rev: cur };
        }
        const { base: _base, client, ...layout } = body;
        this.file = { ...structuredClone(layout), savedAt: 'now', rev: cur + 1 };
        if (this.by !== client) { this.by = client; this.byFrom = cur; }
        this.log.push({ client, base: body.base, keepalive, ok: true });
        return { ok: true, rev: cur + 1 };
      },
    };
  }
}

const core = { id: 'core:mind', group: CORE_GROUP, hub: true, r: 10 };
const hub = { id: 'a', group: 'a', hub: true, r: 9 };
const items = Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, group: 'a', hub: false, r: 4 }));
const links = items.map((n) => ({ source: n.id, target: 'a' }));

/** One open copy of the app: its map's layout, settled, and its sync with the server. */
function copy(server: FakeServer, client: string): { layout: Layout; sync: LayoutSync; map: LayoutMap & { dragging: boolean } } {
  const layout = new Layout(2);
  layout.setData([core, hub, ...items], links, [CORE_GROUP, 'a']);
  for (let i = 0; i < 3000 && layout.tick(); i++) { /* settle */ }
  const map = {
    dragging: false,
    layoutSnapshot: () => layout.snapshot(),
    adoptLayout: (saved: Partial<LayoutSnapshot>, reheat?: boolean): boolean => {
      if (map.dragging) return false;
      layout.adopt(saved, reheat);
      return true;
    },
  };
  const sync = new LayoutSync(() => map, server.io(), { client, delayMs: 5 });
  sync.loaded(structuredClone(server.file));
  return { layout, sync, map };
}

const spread = (l: Layout, ids: string[], gather = false): void => {
  l.spread(ids.map((id) => ({ id, f: 1, dir: [1, 0, 0] as Point })), gather, 0);
};

describe('layout sync between open copies', () => {
  it('a spread in one copy reaches the other at once, and the idle copy never saves', async () => {
    const server = new FakeServer();
    const a = copy(server, 'tab-a');
    const b = copy(server, 'tab-b');
    spread(a.layout, ['a0', 'a1']);
    a.sync.changed();
    a.sync.flush();
    await a.sync.idle();
    expect(server.rev).toBe(1);
    expect(Object.keys(server.file.room ?? {}).sort()).toEqual(['a0', 'a1']);
    // The live event: the other copy takes the layout without stirring its map.
    b.sync.remote({ rev: 1, client: 'tab-a' });
    await b.sync.idle();
    expect(b.layout.node('a0')!.room).toBeGreaterThan(1);
    expect(b.layout.node('a5')!.room ?? 1).toBe(1);
    expect(b.layout.node('a0')!.x).toBe(server.file.positions['a0']![0]);
    expect(b.layout.settled).toBe(true);
    expect(b.sync.rev).toBe(1);
    // An older answer arriving late never replaces the layout taken since.
    expect(b.sync.loaded({ anchors: {}, pins: {}, positions: {}, room: {}, savedAt: '', rev: 0 })).toBe(false);
    expect(b.sync.rev).toBe(1);
    // Its own save never went out, and its own event is ignored by the copy that made it.
    expect(server.log.map((s) => s.client)).toEqual(['tab-a']);
    a.sync.remote({ rev: 1, client: 'tab-a' });
    await a.sync.idle();
    expect(a.sync.rev).toBe(1);
  });

  it('a copy that missed a save keeps its own change on top of it instead of writing over it', async () => {
    const server = new FakeServer();
    const a = copy(server, 'tab-a');
    const b = copy(server, 'tab-b');
    spread(a.layout, ['a0']);
    a.sync.changed();
    a.sync.flush();
    await a.sync.idle();
    // b never heard of that save; it gathers another item and saves on the layout it loaded.
    spread(b.layout, ['a5'], true);
    b.sync.changed();
    b.sync.flush();
    await b.sync.idle();
    expect(server.log.map((s) => [s.client, s.ok])).toEqual([['tab-a', true], ['tab-b', false], ['tab-b', true]]);
    expect(server.rev).toBe(2);
    expect(server.file.room!['a0']).toBeGreaterThan(1);
    expect(server.file.room!['a5']).toBeLessThan(1);
    expect(b.layout.node('a0')!.room).toBeGreaterThan(1);
    // And the first copy takes the merged layout.
    a.sync.remote({ rev: 2, client: 'tab-b' });
    await a.sync.idle();
    expect(a.layout.node('a5')!.room).toBeLessThan(1);
    expect(a.sync.rev).toBe(2);
  });

  it('a change waiting to go out is never replaced by a take; a drag in progress holds a take off too', async () => {
    const server = new FakeServer();
    const a = copy(server, 'tab-a');
    const b = copy(server, 'tab-b');
    spread(a.layout, ['a0']);
    a.sync.changed();
    a.sync.flush();
    await a.sync.idle();
    spread(b.layout, ['a3']);
    b.sync.changed();
    b.sync.remote({ rev: 1, client: 'tab-a' });
    await b.sync.idle();
    expect(b.layout.node('a0')!.room ?? 1).toBe(1);
    expect(b.layout.node('a3')!.room).toBeGreaterThan(1);
    b.sync.flush();
    await b.sync.idle();
    expect(server.file.room!['a0']).toBeGreaterThan(1);
    expect(server.file.room!['a3']).toBeGreaterThan(1);
    // While the user drags in the first copy, it does not take the newer layout and stays on its base.
    a.map.dragging = true;
    a.sync.remote({ rev: server.rev, client: 'tab-b' });
    await a.sync.idle();
    expect(a.sync.rev).toBe(1);
    a.map.dragging = false;
    a.sync.remote({ rev: server.rev, client: 'tab-b' });
    await a.sync.idle();
    expect(a.sync.rev).toBe(server.rev);
    expect(a.layout.node('a3')!.room).toBeGreaterThan(1);
  });

  it('leaving sends a waiting change at once with keepalive, past a save of the same copy still on its way', async () => {
    const server = new FakeServer();
    const a = copy(server, 'tab-a');
    spread(a.layout, ['a0']);
    a.sync.changed();
    a.sync.flush();
    // A moment later, before that save is answered, another spread and the page reloads.
    spread(a.layout, ['a1']);
    a.sync.changed();
    a.sync.leave();
    await a.sync.idle();
    expect(server.log.every((s) => s.ok)).toBe(true);
    expect(server.log.some((s) => s.keepalive === true)).toBe(true);
    expect(Object.keys(server.file.room ?? {}).sort()).toEqual(['a0', 'a1']);
    // Nothing waiting: leaving again sends nothing.
    const sent = server.log.length;
    a.sync.leave();
    await a.sync.idle();
    expect(server.log.length).toBe(sent);
  });
});

describe('a save without an answer', () => {
  it('goes out again in a moment and is merged if another copy saved meanwhile', async () => {
    const server = new FakeServer();
    const a = copy(server, 'tab-a');
    const io = server.io();
    let offline = true;
    const sync = new LayoutSync(() => ({ layoutSnapshot: () => a.layout.snapshot(), adoptLayout: (saved, reheat) => { a.layout.adopt(saved, reheat); return true; } }), {
      load: io.load,
      save: async (body, keepalive) => { if (offline) throw Object.assign(new Error('the server did not answer'), { status: 0 }); return io.save(body, keepalive); },
    }, { client: 'phone', delayMs: 5, retryMs: 20 });
    sync.loaded(structuredClone(server.file));
    spread(a.layout, ['a2']);
    sync.changed();
    sync.flush();
    await sync.idle();
    expect(server.rev).toBe(0);
    // Meanwhile another copy spreads elsewhere; then the phone is back online.
    const b = copy(server, 'tab-b');
    spread(b.layout, ['a6']);
    b.sync.changed();
    b.sync.flush();
    await b.sync.idle();
    offline = false;
    await new Promise((r) => setTimeout(r, 60));
    await sync.idle();
    expect(server.file.room!['a2']).toBeGreaterThan(1);
    expect(server.file.room!['a6']).toBeGreaterThan(1);
  });
});

describe('mergeLayouts', () => {
  const p = (x: number): Point => [x, 0, 0];
  const base: LayoutSnapshot = { anchors: { g1: p(1), g2: p(2) }, pins: { n9: p(9) }, positions: { n1: p(10), n2: p(20), n3: p(30) }, room: { n1: 2, n2: 2 } };

  it("keeps this copy's room, pins and anchors where it changed them and takes the rest from the newer layout", () => {
    // This copy spread n3, gathered n2 back to 1, unpinned n9 and dragged region g1.
    const mine: LayoutSnapshot = { anchors: { g1: p(5), g2: p(2) }, pins: {}, positions: { n1: p(11), n2: p(21), n3: p(31) }, room: { n1: 2, n3: 3 } };
    // Meanwhile another copy gathered n1, pinned n4 and dragged g2.
    const theirs: LayoutSnapshot = { anchors: { g1: p(1), g2: p(7) }, pins: { n9: p(9), n4: p(4) }, positions: { n1: p(12), n2: p(22), n3: p(32), n4: p(40) }, room: { n1: 0.5, n2: 2 }, settled: true };
    const { merged, own } = mergeLayouts(base, mine, theirs);
    expect(own).toBe(true);
    expect(merged.room).toEqual({ n1: 0.5, n3: 3 });
    expect(merged.pins).toEqual({ n4: p(4) });
    expect(merged.anchors).toEqual({ g1: p(5), g2: p(7) });
    // Places come from the newer layout, but the items this copy changed keep theirs.
    expect(merged.positions).toEqual({ n1: p(12), n2: p(21), n3: p(31), n4: p(40) });
    expect(merged.settled).toBe(false);
  });

  it('with nothing of its own the newer layout simply becomes the copy\'s', () => {
    const theirs: LayoutSnapshot = { anchors: { g1: p(3), g2: p(2) }, pins: {}, positions: { n1: p(1) }, room: { n2: 4 }, settled: true };
    const { merged, own } = mergeLayouts(base, { ...base, positions: { n1: p(99) } }, theirs);
    expect(own).toBe(false);
    expect(merged).toEqual(theirs);
  });
});
