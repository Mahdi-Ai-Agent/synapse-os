import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nowIso } from '@synapse/core';

export type Point = [number, number, number];

/**
 * Where the user left the graph (UI-DESIGN "Living graph"): region anchors they dragged, nodes they pinned, the
 * last position of every node and the room the spread and gather tools gave nodes, in
 * \`<vault>/.synapse/layout.json\` (app-private, gitignored), so a reload or another device shows the same map.
 */
export interface LayoutFile {
  version: 1;
  /** Counts every save (docs/ARCHITECTURE.md "Layout"): a save based on an older one is refused, never written over it. */
  rev: number;
  savedAt: string;
  anchors: Record<string, Point>;
  pins: Record<string, Point>;
  positions: Record<string, Point>;
  /** Node id → room (0.4–4, UI-DESIGN "Mind map" → Spreading); nodes at 1 are left out. */
  room: Record<string, number>;
  /** False when the positions were saved while the map was still moving (the web app settles it again on load). */
  settled: boolean;
}

const EMPTY = (rev = 0): LayoutFile => ({ version: 1, rev, savedAt: '', anchors: {}, pins: {}, positions: {}, room: {}, settled: true });

export type LayoutPatch = { anchors?: unknown; pins?: unknown; positions?: unknown; room?: unknown; settled?: unknown };

/**
 * Who saves (`client`: one open copy of the app) and which save its map was based on (`base`, the `rev` it last
 * loaded or saved). Without `base` a save always goes through (older clients).
 */
export interface SaveFrom { base?: number; client?: string }

/** `stale`: the save was based on an older layout and was not written; `file` is the layout as it stands. */
export interface SaveResult { stale: boolean; file: LayoutFile }

/** The most and the least room the spread and gather tools give a node (web `layout.ts` `ROOM_MAX`, `ROOM_MIN`). */
const ROOM_MAX = 4;
const ROOM_MIN = 0.4;

function rooms(v: unknown, limit: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object') return out;
  let n = 0;
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (n >= limit) break;
    const r = Number(raw);
    if (!Number.isFinite(r) || r <= 0 || Math.abs(r - 1) < 0.005) continue;
    out[k.slice(0, 200)] = Math.round(Math.min(ROOM_MAX, Math.max(ROOM_MIN, r)) * 100) / 100;
    n++;
  }
  return out;
}

function points(v: unknown, limit: number): Record<string, Point> {
  const out: Record<string, Point> = {};
  if (!v || typeof v !== 'object') return out;
  let n = 0;
  for (const [k, p] of Object.entries(v as Record<string, unknown>)) {
    if (n >= limit) break;
    if (!Array.isArray(p) || p.length < 2) continue;
    const [x, y, z = 0] = p.map(Number);
    if (![x, y, z].every((c) => Number.isFinite(c) && Math.abs(c as number) < 1e6)) continue;
    out[k.slice(0, 200)] = [Math.round((x as number) * 10) / 10, Math.round((y as number) * 10) / 10, Math.round((z as number) * 10) / 10];
    n++;
  }
  return out;
}

export class LayoutStore {
  private cache: LayoutFile | null = null;
  /** The copy that wrote the last saves in a row and the `rev` before the first of them (kept in memory only). */
  private by: string | null = null;
  private byFrom = 0;
  constructor(private readonly root: string) {}

  get file(): string { return path.join(this.root, '.synapse', 'layout.json'); }

  async get(): Promise<LayoutFile> {
    if (this.cache) return this.cache;
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<LayoutFile>;
      const rev = Number.isSafeInteger(raw.rev) && (raw.rev as number) >= 0 ? (raw.rev as number) : 0;
      this.cache = { version: 1, rev, savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '', anchors: points(raw.anchors, 500), pins: points(raw.pins, 20000), positions: points(raw.positions, 20000), room: rooms(raw.room, 20000), settled: raw.settled !== false };
    } catch { this.cache = EMPTY(); }
    return this.cache;
  }

  private writing: Promise<unknown> = Promise.resolve();

  /**
   * Replaces the parts given (anchors, pins, positions, room, settled); validates and rounds every value. Saves run one after
   * another, each through its own temp file: two at once shared one and the second rename failed (`HTTP-500` on
   * `/api/layout`).
   *
   * A save that names its `base` is written only when nothing was saved since that one — or when every save since came
   * from the same `client` (its own earlier saves, still on their way when it sent this one). Otherwise it is `stale`:
   * an open copy of the app that missed newer saves would put its older picture of the map over them (a second tab
   * undid a spread made in the first one; docs/ARCHITECTURE.md "Layout").
   */
  put(patch: LayoutPatch, from: SaveFrom = {}): Promise<SaveResult> {
    const next = this.writing.catch(() => undefined).then(() => this.write(patch, from));
    this.writing = next;
    return next;
  }

  private async write(patch: LayoutPatch, from: SaveFrom): Promise<SaveResult> {
    const cur = await this.get();
    const client = from.client ?? null;
    if (from.base !== undefined && from.base !== cur.rev) {
      const ownSaves = client !== null && this.by === client && from.base >= this.byFrom && from.base <= cur.rev;
      if (!ownSaves) return { stale: true, file: cur };
    }
    const next: LayoutFile = {
      version: 1,
      rev: cur.rev + 1,
      savedAt: nowIso(),
      anchors: patch.anchors === undefined ? cur.anchors : points(patch.anchors, 500),
      pins: patch.pins === undefined ? cur.pins : points(patch.pins, 20000),
      positions: patch.positions === undefined ? cur.positions : points(patch.positions, 20000),
      room: patch.room === undefined ? cur.room : rooms(patch.room, 20000),
      settled: patch.settled === undefined ? cur.settled : patch.settled !== false,
    };
    await this.save(next);
    if (client === null || this.by !== client) { this.by = client; this.byFrom = cur.rev; }
    return { stale: false, file: next };
  }

  private async save(next: LayoutFile): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(next) + '\n', 'utf8');
      await fs.rename(tmp, this.file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    this.cache = next;
  }

  /** Forgets everything; the count goes on, so a copy that still holds the old map cannot save it back unnoticed. */
  reset(): Promise<LayoutFile> {
    const next = this.writing.catch(() => undefined).then(async () => {
      const cur = await this.get();
      const empty = { ...EMPTY(cur.rev + 1), savedAt: nowIso() };
      await this.save(empty);
      this.by = null;
      this.byFrom = cur.rev;
      return empty;
    });
    this.writing = next;
    return next;
  }
}
