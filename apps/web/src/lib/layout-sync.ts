import type { LayoutSnapshot, Point } from '../graph/layout';
import type { LayoutSave, LayoutSaveAnswer, SavedLayout } from './types';

/**
 * One map across every open copy of the app — tabs, the phone, another computer (docs/ARCHITECTURE.md "Layout";
 * UI-DESIGN "Mind map" → Spreading). A copy saves only after its own map changed (a spread, a gather, a drag, a settle
 * after new data); each save names the `rev` it was based on; a save the server refuses as stale is merged with the
 * newer layout and sent again; and a save another copy made (`layout.saved`) is taken at once, unless a change of this
 * copy is still waiting to go out. Before this, every open copy re-saved its own picture of the map on every live
 * poll, so a forgotten tab put a spread made in another one back within half a minute.
 */

/** This copy of the app (one page load): `layout.saved` names the copy that saved, so a copy skips its own saves. */
export const LAYOUT_CLIENT = clientId();

function clientId(): string {
  const bytes = new Uint8Array(12);
  // `getRandomValues` works on plain-HTTP LAN addresses too, where `randomUUID` does not exist.
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

/** A `layout.saved` live event: the save's `rev` and the copy that made it (`null`: the server itself, a reset). */
export interface LayoutSavedEvent { rev: number; client: string | null }

type Listener = (ev: LayoutSavedEvent | null) => void;
const listeners = new Set<Listener>();

/**
 * The live channel's side (`App.tsx`): `saved(event)` for a save another copy made, `saved(null)` after the channel
 * (re)connected, when saves may have been missed.
 */
export const layoutEvents = {
  saved(ev: LayoutSavedEvent | null): void { for (const l of listeners) l(ev); },
  subscribe(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l); }; },
};

const EMPTY: LayoutSnapshot = { anchors: {}, pins: {}, positions: {}, room: {} };

/** A saved layout as the map's own snapshot. */
export function snapshotOf(saved: Partial<SavedLayout>): LayoutSnapshot {
  return {
    anchors: saved.anchors ?? {},
    pins: saved.pins ?? {},
    positions: saved.positions ?? {},
    room: saved.room ?? {},
    ...(saved.settled !== undefined ? { settled: saved.settled } : {}),
  };
}

const samePoint = (a: Point | undefined, b: Point | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1] && (a[2] ?? 0) === (b[2] ?? 0));
const sameRoom = (a: number | undefined, b: number | undefined): boolean => (a ?? 1) === (b ?? 1);

/** Per key: this copy's value where it changed it since `base` (noted in `own`), the newer layout's otherwise. */
function merge3<T>(base: Record<string, T>, mine: Record<string, T>, theirs: Record<string, T>, same: (a: T | undefined, b: T | undefined) => boolean, own: Set<string>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
    const changed = !same(base[k], mine[k]);
    if (changed) own.add(k);
    const v = changed ? mine[k] : theirs[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * The three-way merge of a refused save: what this copy changed since the layout its save was based on (`base`) —
 * an item's room or pin, a region's anchor — stays; everything else comes from the newer layout (`theirs`), the items'
 * places too, except those whose room or pin this copy changed. `own` says whether anything of this copy's is kept:
 * then the merged map settles and is saved again; otherwise the newer layout simply becomes this copy's.
 */
export function mergeLayouts(base: LayoutSnapshot, mine: LayoutSnapshot, theirs: LayoutSnapshot): { merged: LayoutSnapshot; own: boolean } {
  const items = new Set<string>();
  const groups = new Set<string>();
  const room = merge3(base.room, mine.room, theirs.room, sameRoom, items);
  const pins = merge3(base.pins, mine.pins, theirs.pins, samePoint, items);
  const anchors = merge3(base.anchors, mine.anchors, theirs.anchors, samePoint, groups);
  const positions: Record<string, Point> = { ...theirs.positions };
  for (const [id, p] of Object.entries(mine.positions)) if (items.has(id) || !positions[id]) positions[id] = p;
  const own = items.size > 0 || groups.size > 0;
  return { merged: { anchors, pins, positions, room, settled: own ? false : theirs.settled !== false }, own };
}

/** What the sync needs from the map (`LivingGraph`). */
export interface LayoutMap {
  layoutSnapshot(): LayoutSnapshot | null;
  /** False while the user drags: their own save follows, and is merged then. */
  adoptLayout(saved: Partial<LayoutSnapshot>, reheat?: boolean): boolean;
}

/** What the sync needs from the server (`lib/api.ts`). */
export interface LayoutIo {
  load(): Promise<SavedLayout>;
  save(body: LayoutSave, keepalive: boolean | 'auto'): Promise<LayoutSaveAnswer>;
}

/**
 * The map's saves and the other copies' saves, one at a time: saves and takes run in a queue, so an answer is always
 * read against the layout the save was based on. `changed` waits a moment so a burst of changes is one save; `leave`
 * sends a waiting change at once (`keepalive`) when the page is hidden or closes.
 */
export class LayoutSync {
  /** The layout this copy last loaded, took or saved, and its `rev`: what the next save is based on. */
  private base: { rev: number; snap: LayoutSnapshot } = { rev: 0, snap: EMPTY };
  private pending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();

  private readonly client: string;
  private readonly delayMs: number;
  private readonly retryMs: number;

  /** `client` names this copy in its saves (`LAYOUT_CLIENT`; tests give each copy its own). */
  constructor(private readonly map: () => LayoutMap | null, private readonly io: LayoutIo, options: { client?: string; delayMs?: number; retryMs?: number } = {}) {
    this.client = options.client ?? LAYOUT_CLIENT;
    this.delayMs = options.delayMs ?? 1200;
    this.retryMs = options.retryMs ?? 4000;
  }

  /** The `rev` the next save is based on. */
  get rev(): number { return this.base.rev; }

  /**
   * The layout the map starts from (`GET /api/layout` before the first layout). False when a newer one was taken
   * meanwhile (a reconnect's check answered first): then the map keeps that one.
   */
  loaded(saved: SavedLayout): boolean {
    const rev = saved.rev ?? 0;
    if (rev < this.base.rev) return false;
    this.base = { rev, snap: snapshotOf(saved) };
    return true;
  }

  /** The map changed (a spread, a gather, a drag, a settle): it is saved after a short pause. */
  changed(): void {
    this.pending = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  /** Sends a waiting change now, after any save or take still on its way. */
  flush(): void {
    this.stopTimer();
    if (!this.pending) return;
    this.pending = false;
    this.enqueue(() => this.save());
  }

  /**
   * The page is hidden, closing or reloading, or the map goes away: a waiting change goes out at once with
   * `keepalive`, ahead of the queue, so an unload cannot cancel it (the server lets it pass this copy's own saves still
   * on their way); its answer, if the page is still there, is read in turn.
   */
  leave(): void {
    this.stopTimer();
    if (!this.pending) return;
    this.pending = false;
    const snap = this.map()?.layoutSnapshot();
    if (!snap) return;
    const sent = this.io.save({ ...snap, base: this.base.rev, client: this.client }, true);
    this.enqueue(() => this.answer(sent, snap));
  }

  /** Another copy saved (`layout.saved`), or the live channel (re)connected (`null`): take the newer layout. */
  remote(ev: LayoutSavedEvent | null): void {
    if (ev && (ev.client === this.client || ev.rev <= this.base.rev)) return;
    this.enqueue(() => this.take());
  }

  /** Resolves once every save and take queued so far is done (tests). */
  idle(): Promise<void> { return this.queue; }

  private stopTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private enqueue(op: () => Promise<void>): void {
    this.queue = this.queue.then(op).catch(() => undefined);
  }

  private async save(): Promise<void> {
    const snap = this.map()?.layoutSnapshot();
    if (!snap) return;
    try {
      await this.answer(this.io.save({ ...snap, base: this.base.rev, client: this.client }, 'auto'), snap);
    } catch (err) {
      // No answer (offline, the server restarting): the change waits and goes out again in a moment — refused as
      // stale then if another copy saved meanwhile, and merged.
      if ((err as { status?: unknown }).status !== 0) return;
      this.pending = true;
      this.stopTimer();
      this.timer = setTimeout(() => this.flush(), this.retryMs);
    }
  }

  private async answer(sent: Promise<LayoutSaveAnswer>, snap: LayoutSnapshot, tries = 0): Promise<void> {
    const r = await sent;
    if (r.ok) {
      if (typeof r.rev === 'number' && r.rev > this.base.rev) this.base = { rev: r.rev, snap };
      return;
    }
    if (!r.stale) return;
    // Another copy saved since this copy's map was loaded: keep this copy's own changes on top of the newer layout.
    const theirs = await this.io.load();
    const map = this.map();
    if (!map) return;
    const newer = snapshotOf(theirs);
    const { merged, own } = mergeLayouts(this.base.snap, map.layoutSnapshot() ?? snap, newer);
    if (!map.adoptLayout(merged, own)) { this.pending = true; return; }
    this.base = { rev: theirs.rev ?? 0, snap: newer };
    if (!own || tries >= 2) return;
    const again = map.layoutSnapshot();
    if (again) await this.answer(this.io.save({ ...again, base: this.base.rev, client: this.client }, 'auto'), again, tries + 1);
  }

  private async take(): Promise<void> {
    // A change of this copy goes out first; should the server refuse it, it is merged with the newer layout then.
    if (this.pending) return;
    const theirs = await this.io.load();
    const rev = theirs.rev ?? 0;
    if (rev <= this.base.rev || this.pending) return;
    if (!this.map()?.adoptLayout(snapshotOf(theirs), false)) return;
    this.base = { rev, snap: snapshotOf(theirs) };
  }
}
