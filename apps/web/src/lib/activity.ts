/**
 * What the brain touches while it works, straight from the run's tool events to the map (UI-DESIGN "Living graph"
 * → The brain at work): the WebSocket handler announces node ids, the map draws the signals.
 */
type Listener = (ids: string[], kind: 'read' | 'write') => void;
const listeners = new Set<Listener>();

export const brainActivity = {
  touch(ids: string[], kind: 'read' | 'write'): void { for (const l of listeners) l(ids, kind); },
  subscribe(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l); }; },
};

interface PathNode { id: string; path: string | null }

/**
 * Turns a tool's touched paths into map ids: an item by its file; the core for the index, memory, a folder or a search
 * across the vault. A file the brain writes that is not on the map yet (a new item) lights the core now and is
 * remembered for two minutes, so its own signal comes once it appears (`arrived`).
 */
export class TouchMap {
  private pending = new Map<string, number>();
  constructor(private readonly coreId: string, private readonly ttlMs = 120_000) {}

  ids(paths: string[], kind: 'read' | 'write', nodes: readonly PathNode[], now = Date.now()): string[] {
    const byPath = new Map(nodes.filter((n) => n.path).map((n) => [n.path as string, n.id]));
    const out = new Set<string>();
    for (const rel of paths) {
      const id = rel.startsWith('nodes/') ? byPath.get(rel) : undefined;
      if (id) { out.add(id); continue; }
      if (kind === 'write' && /^nodes\/.+\.md$/.test(rel)) this.pending.set(rel, now + this.ttlMs);
      out.add(this.coreId);
    }
    return [...out];
  }

  /** The items whose files the brain was writing and that are on the map now. */
  arrived(nodes: readonly PathNode[], now = Date.now()): string[] {
    if (!this.pending.size) return [];
    const out: string[] = [];
    for (const n of nodes) {
      const until = n.path ? this.pending.get(n.path) : undefined;
      if (until === undefined) continue;
      this.pending.delete(n.path as string);
      if (until > now) out.push(n.id);
    }
    for (const [p, until] of this.pending) if (until <= now) this.pending.delete(p);
    return out;
  }
}
