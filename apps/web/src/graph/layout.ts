import { forceCollide, forceLink, forceManyBody, forceSimulation, type CollideForce, type Force, type LinkForce, type ManyBodyForce, type Simulation, type SimNode } from 'd3-force-3d';

/**
 * Force layout with one region per category (spec: docs/UI-DESIGN.md "Living graph"): every node is pulled toward
 * its group's anchor, links inside a group are short and firm, links between groups long and weak, repulsion is local.
 * Anchors sit on a ring around the inbox (Fibonacci sphere in 3D); the regions of a map (UI-DESIGN "Maps") sit on a
 * ring of their own, an island beside the mind map — close when the map is connected to it, far when it is not — and
 * a link between two maps only pulls when they are connected. Seeded jitter keeps the first layout reproducible.
 * Where the user left things — a region they dragged, a node they pinned, every node's place, the room they gave a
 * crowded spot — comes back through `restore()` and leaves through `snapshot()` (the app stores it in
 * `.synapse/layout.json`).
 */

export type Dims = 2 | 3;
export type Point = [number, number, number];

export interface LayoutInput {
  id: string;
  /** Category id, or one of the special group keys. */
  group: string;
  /** The area node at the heart of its category. */
  hub: boolean;
  /** World radius of the drawn node. */
  r: number;
}

export interface LayoutNode extends SimNode, LayoutInput {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /**
   * How much room the node keeps around itself (1 = as laid out; up to `ROOM_MAX` spread, down to `ROOM_MIN`
   * gathered): the spread tool raises it where the map is crowded, the gather tool lowers it (UI-DESIGN "Mind map" →
   * Spreading). It widens or narrows the node's personal space, push and links and loosens or tightens its pull to
   * its region's centre, so the spot opens up or closes in and stays so.
   */
  room?: number;
}

interface LayoutLink { source: string | LayoutNode; target: string | LayoutNode; cross: boolean; bridge: boolean }

export interface Anchor { x: number; y: number; z: number; radius: number }

export interface LayoutSnapshot {
  anchors: Record<string, Point>;
  pins: Record<string, Point>;
  positions: Record<string, Point>;
  /** Node id → its room, for the nodes the spread or gather tool moved off 1. */
  room: Record<string, number>;
  /** Whether the map had settled when this was taken; a save made mid-move settles again on load. */
  settled?: boolean;
}

/** The most room a node can be given: four times its own space. */
export const ROOM_MAX = 4;
/** The least: items gathered well inside their laid-out spacing (the collide force still keeps them apart). */
export const ROOM_MIN = 0.4;
/** One click of the spread tool at the brush's centre multiplies the room by this (less toward its edge). */
const ROOM_STEP = 0.38;
const roomOf = (n: LayoutNode | undefined): number => n?.room ?? 1;
const clampRoom = (v: number): number => Math.min(ROOM_MAX, Math.max(ROOM_MIN, v));

/** The maps on the canvas: which groups each one holds and whether it is connected to the mind map. */
export interface ZoneLayout {
  /** Group id → zone (map) id; groups of the mind map are absent. */
  of: ReadonlyMap<string, string>;
  /** Zones in order; `near` = connected to the mind map, so its island sits close. */
  list: Array<{ id: string; near: boolean }>;
  /** Whether a link between two zones (`mind` or map ids) pulls them together. */
  connected: (a: string, b: string) => boolean;
}

export const INBOX_GROUP = '__inbox';
export const JOURNAL_GROUP = '__journal';
export const UNSORTED_GROUP = '__unsorted';
/** Retired items (archived, dropped, finished long ago): one region off in a corner of the map, switched off. */
export const ARCHIVE_GROUP = '__archive';
/** The mind map's core node sits at the centre of its ring (UI-DESIGN "Maps"). */
export const CORE_GROUP = '__core';
/** Prefix of the one-node group a map's centre forms, at the centre of its island's ring. */
export const MAP_GROUP = 'map:';
export const MIND_ZONE = 'mind';

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** Gap between the mind map's outer edge and a map's island (its outline included), connected or not. */
const ZONE_GAP_NEAR = 150;
const ZONE_GAP_FAR = 360;

/** Deterministic 0..1 from a string (FNV-1a), so the first layout looks the same on every load. */
export function hash01(s: string, salt = 0): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ((h >>> 0) % 100000) / 100000;
}

/** World radius a group of `size` nodes occupies. */
export function groupRadius(size: number): number {
  return 22 + 12 * Math.sqrt(Math.max(1, size));
}

/**
 * Anchor per group: the mind map's groups on a ring around the inbox (`computeRing`), regions the user placed kept
 * where they are; then every map's groups on a ring of their own, an island set down as a whole around the mind map
 * as it really lies — close when the map is connected to it, far when not — and moved out until none of its regions
 * sits on one already there. An island's regions the user placed keep their place too.
 */
export function computeAnchors(order: string[], sizes: ReadonlyMap<string, number>, dims: Dims, zones?: ZoneLayout, placed: ReadonlyMap<string, Point> = new Map()): Map<string, Anchor> {
  if (!order.includes(ARCHIVE_GROUP)) return computeLiveAnchors(order, sizes, dims, zones, placed);
  const out = computeLiveAnchors(order.filter((g) => g !== ARCHIVE_GROUP), sizes, dims, zones, placed);
  // The archive keeps out of the way: past the bottom-left corner of everything else (or where the user put it).
  const radius = groupRadius(sizes.get(ARCHIVE_GROUP) ?? 1);
  const own = placed.get(ARCHIVE_GROUP);
  let minX = 0; let minY = 0;
  for (const a of out.values()) { minX = Math.min(minX, a.x - a.radius); minY = Math.min(minY, a.y - a.radius); }
  out.set(ARCHIVE_GROUP, own ? { x: own[0], y: own[1], z: own[2], radius } : { x: minX - radius - 90, y: minY - radius - 90, z: 0, radius });
  return out;
}

function computeLiveAnchors(order: string[], sizes: ReadonlyMap<string, number>, dims: Dims, zones?: ZoneLayout, placed: ReadonlyMap<string, Point> = new Map()): Map<string, Anchor> {
  const mindGroups = order.filter((g) => !zones?.of.has(g));
  const centre = mindGroups.includes(CORE_GROUP) ? CORE_GROUP : INBOX_GROUP;
  const mind = clearOfPlaced(computeRing(mindGroups, sizes, dims, centre), withoutStaleInbox(placed, centre));
  if (!zones?.list.length) return mind;
  const out = new Map(mind);
  let cx = 0; let cy = 0; let cz = 0;
  for (const a of mind.values()) { cx += a.x; cy += a.y; cz += a.z; }
  if (mind.size) { cx /= mind.size; cy /= mind.size; cz /= mind.size; }
  let mindR = 0;
  for (const a of mind.values()) mindR = Math.max(mindR, Math.hypot(a.x - cx, a.y - cy, a.z - cz) + a.radius);
  const taken: Anchor[] = [...mind.values()];
  const islands = zones.list.filter((z) => order.some((g) => zones.of.get(g) === z.id));
  islands.forEach((z, k) => {
    const sub = computeRing(order.filter((g) => zones.of.get(g) === z.id), sizes, dims, MAP_GROUP + z.id);
    let subR = 0;
    for (const a of sub.values()) subR = Math.max(subR, Math.hypot(a.x, a.y, a.z) + a.radius);
    // Islands start at the top right and go round; a connected map sits close to the mind map.
    const th = Math.PI / 4 - (k / Math.max(1, islands.length)) * Math.PI * 2;
    const dx = Math.cos(th); const dy = Math.sin(th);
    let R = mindR + subR + 50 + (z.near ? ZONE_GAP_NEAR : ZONE_GAP_FAR);
    const collides = (): boolean => [...sub.values()].some((a) => taken.some((o) => Math.hypot(o.x - (cx + dx * R + a.x), o.y - (cy + dy * R + a.y), o.z - (cz + a.z)) < o.radius + a.radius + 36));
    for (let i = 0; i < 80 && collides(); i++) R += 40;
    const island = new Map<string, Anchor>();
    for (const [g, a] of sub) island.set(g, { ...a, x: a.x + cx + dx * R, y: a.y + cy + dy * R, z: a.z + cz });
    for (const [g, a] of clearOfPlaced(island, placed)) { out.set(g, a); taken.push(a); }
  });
  return out;
}

/**
 * Anchor per group of one space: the centre group (the mind map's core, a map's centre node; the inbox when a vault
 * has no core yet) at the heart, the ordered groups on a ring (flat) or a Fibonacci sphere (3D).
 */
function computeRing(order: string[], sizes: ReadonlyMap<string, number>, dims: Dims, centre: string = INBOX_GROUP): Map<string, Anchor> {
  const out = new Map<string, Anchor>();
  const ring = order.filter((g) => g !== centre);
  const centreR = groupRadius(sizes.get(centre) ?? 0);
  if (sizes.has(centre)) out.set(centre, { x: 0, y: 0, z: 0, radius: centreR });
  const radii = ring.map((g) => groupRadius(sizes.get(g) ?? 1));
  const rMax = Math.max(40, ...radii);
  const k = ring.length;
  if (k === 0) return out;
  if (k === 1) { out.set(ring[0]!, { x: 0, y: sizes.has(centre) ? -(centreR + rMax + 30) : 0, z: 0, radius: radii[0]! }); return out; }
  const ringR = Math.max((1.12 * rMax) / Math.sin(Math.PI / k), centreR + rMax + 40);
  ring.forEach((g, i) => {
    if (dims === 3) {
      const y = 1 - (2 * (i + 0.5)) / k;
      const rad = Math.sqrt(1 - y * y);
      const th = i * GOLDEN;
      const R = ringR * 1.05;
      out.set(g, { x: Math.cos(th) * rad * R, y: y * R, z: Math.sin(th) * rad * R, radius: radii[i]! });
    } else {
      const th = -Math.PI / 2 + (i / k) * Math.PI * 2;
      out.set(g, { x: Math.cos(th) * ringR, y: Math.sin(th) * ringR, z: 0, radius: radii[i]! });
    }
  });
  return out;
}

/**
 * A layout saved before the mind map had a core left the inbox at the heart of the ring; that place is the core's
 * now, so such an inbox takes a ring slot like the other regions.
 */
function withoutStaleInbox(placed: ReadonlyMap<string, Point>, centre: string): ReadonlyMap<string, Point> {
  const inbox = placed.get(INBOX_GROUP);
  if (centre !== CORE_GROUP || !inbox) return placed;
  const core = placed.get(CORE_GROUP);
  if (Math.hypot(inbox[0] - (core?.[0] ?? 0), inbox[1] - (core?.[1] ?? 0), (inbox[2] ?? 0) - (core?.[2] ?? 0)) > 1) return placed;
  const out = new Map(placed);
  out.delete(INBOX_GROUP);
  return out;
}

/**
 * Moves computed anchors off the regions the user placed: a new category's ring slot may sit where a dragged region
 * now is, so it walks outward until it is clear.
 */
function clearOfPlaced(computed: Map<string, Anchor>, placed: ReadonlyMap<string, Point>): Map<string, Anchor> {
  const fixed = [...computed.entries()].filter(([g]) => placed.has(g)).map(([g, a]) => {
    const p = placed.get(g)!;
    return { x: p[0], y: p[1], z: p[2], radius: a.radius };
  });
  const out = new Map<string, Anchor>();
  const taken = [...fixed];
  for (const [g, a] of computed) {
    const p = placed.get(g);
    if (p) { out.set(g, { x: p[0], y: p[1], z: p[2], radius: a.radius }); continue; }
    const len = Math.hypot(a.x, a.y, a.z) || 1;
    const dir = { x: a.x / len, y: a.y / len, z: a.z / len };
    let c = { ...a };
    for (let i = 0; i < 80 && taken.some((o) => Math.hypot(o.x - c.x, o.y - c.y, o.z - c.z) < o.radius + c.radius + 36); i++) {
      c = { ...c, x: c.x + dir.x * 40, y: c.y + dir.y * 40, z: c.z + dir.z * 40 };
      if (len < 1) c.x += 40; // a centred anchor has no direction: walk sideways
    }
    taken.push(c);
    out.set(g, c);
  }
  return out;
}

function anchorForce(nodes: () => LayoutNode[], anchors: () => Map<string, Anchor>): Force<LayoutNode> {
  const force = (alpha: number): void => {
    const map = anchors();
    for (const n of nodes()) {
      const a = map.get(n.group);
      if (!a) continue;
      // A node given room is held more loosely by its region's centre, so it can stand farther out.
      const k = (n.hub ? 0.34 : 0.07 / roomOf(n)) * alpha;
      n.vx += (a.x - n.x) * k;
      n.vy += (a.y - n.y) * k;
      n.vz += (a.z - n.z) * k;
    }
  };
  return force;
}

const round = (v: number): number => Math.round(v * 10) / 10;
/** A node's push on its neighbours and its personal space, both growing with the room it was given. */
const chargeOf = (n: LayoutNode): number => (n.hub ? -140 : -38) * roomOf(n) ** 1.3;
const collideOf = (n: LayoutNode): number => Math.max(n.r + 1.5, (n.r + 5) * roomOf(n));

export class Layout {
  private sim: Simulation<LayoutNode>;
  private list: LayoutNode[] = [];
  private byId = new Map<string, LayoutNode>();
  private anchorMap = new Map<string, Anchor>();
  /** Region anchors that have a place: dragged, restored from the saved layout, or computed once (they stick). */
  private placed = new Map<string, Point>();
  private lastLinkKey = '';
  /**
   * Saved places, pins and room of nodes not on the map yet: each is used when its node arrives — the first data, or
   * later when a filter shows it — and saved again meanwhile, so a node that is hidden or still loading keeps its place.
   */
  private seeds = new Map<string, Point>();
  private seedPins = new Map<string, Point>();
  private seedRoom = new Map<string, number>();
  /** The saved map was taken mid-move (a spread still opening up when the page closed): settle it fully on load. */
  private restoredMoving = false;
  /** The first `setData` laid the map out from scratch (nothing saved yet): worth saving at once (`takeFresh`). */
  private fresh = false;
  /** The forces whose per-node values depend on `room`, kept so a spread can re-read them. */
  private linkForce: LinkForce<LayoutNode, LayoutLink> | null = null;
  private chargeForce: ManyBodyForce<LayoutNode> | null = null;
  private collideForce: CollideForce<LayoutNode> | null = null;
  private linkDistance: (l: LayoutLink) => number = () => 30;
  private loaded = false;
  private lastGroups: string[] = [];
  private lastZones: ZoneLayout | undefined;
  dims: Dims;

  constructor(dims: Dims = 2) {
    this.dims = dims;
    this.sim = forceSimulation<LayoutNode>([], dims)
      .alphaDecay(0.024)
      .alphaMin(0.0025)
      .velocityDecay(0.34)
      .stop();
  }

  get nodes(): LayoutNode[] { return this.list; }
  get anchors(): Map<string, Anchor> { return this.anchorMap; }
  node(id: string): LayoutNode | undefined { return this.byId.get(id); }
  get alpha(): number { return this.sim.alpha(); }
  get settled(): boolean { return this.sim.alpha() < this.sim.alphaMin(); }

  /** Where the user left the map: applied to the nodes of the next `setData` (or right away to known ones). */
  restore(saved: Partial<LayoutSnapshot>): void {
    this.placed = new Map(Object.entries(saved.anchors ?? {}));
    this.seeds = new Map(Object.entries(saved.positions ?? {}));
    this.seedPins = new Map(Object.entries(saved.pins ?? {}));
    this.seedRoom = new Map(Object.entries(saved.room ?? {}).filter(([, v]) => Number.isFinite(v) && Math.abs(v - 1) > 0.001).map(([id, v]) => [id, clampRoom(v)]));
    this.restoredMoving = saved.settled === false;
    // Nodes already on the map take their saved room at once.
    for (const [id, v] of this.seedRoom) { const n = this.byId.get(id); if (n) n.room = v; }
    if (this.list.length && this.seedRoom.size) this.applyRoom();
  }

  snapshot(): LayoutSnapshot {
    const positions: Record<string, Point> = {};
    const pins: Record<string, Point> = {};
    const room: Record<string, number> = {};
    // Nodes not on the map (hidden by a filter, or not loaded yet) keep what was saved for them.
    for (const [id, p] of this.seeds) positions[id] = p;
    for (const [id, p] of this.seedPins) pins[id] = p;
    for (const [id, r] of this.seedRoom) room[id] = r;
    for (const n of this.list) {
      positions[n.id] = [round(n.x), round(n.y), round(n.z)];
      delete pins[n.id];
      delete room[n.id];
      if (n.fx !== null && n.fx !== undefined && !n.hub) pins[n.id] = [round(n.fx), round(n.fy ?? n.y), round(n.fz ?? n.z)];
      if (Math.abs(roomOf(n) - 1) > 0.001) room[n.id] = Math.round(roomOf(n) * 100) / 100;
    }
    const anchors: Record<string, Point> = {};
    for (const [g, p] of this.placed) anchors[g] = [round(p[0]), round(p[1]), round(p[2])];
    for (const [g, a] of this.anchorMap) anchors[g] = [round(a.x), round(a.y), round(a.z)];
    return { anchors, pins, positions, room, settled: this.settled };
  }

  /**
   * Whether the last `setData` laid the map out from scratch; asking forgets it. Such a map may already have settled
   * inside `setData`, so no settle would ever report it: the view saves it right away.
   */
  takeFresh(): boolean { const f = this.fresh; this.fresh = false; return f; }

  /**
   * Takes a layout saved by another open copy of the app (another tab or device; docs/ARCHITECTURE.md "Layout") for
   * the nodes already on the map: their places, pins and room, and the regions' anchors. The saved layout is the
   * whole truth for room and pins (a node it does not name has none); nodes it does not know keep their place. It
   * does not stir the simulation unless asked (`reheat`, when this copy's own changes were merged in), so taking a
   * map never makes it move, settle and save again.
   */
  adopt(saved: Partial<LayoutSnapshot>, reheat = false): void {
    if (!this.list.length) { this.restore(saved); return; }
    const flat = this.dims === 2;
    for (const [g, p] of Object.entries(saved.anchors ?? {})) {
      this.placed.set(g, p);
      const a = this.anchorMap.get(g);
      if (a && flat) { a.x = p[0]; a.y = p[1]; a.z = 0; }
    }
    const positions = saved.positions ?? {};
    const pins = saved.pins ?? {};
    const room = saved.room ?? {};
    // Nodes not on the map take the newer save too, for when they appear.
    this.seeds = new Map(Object.entries(positions).filter(([id]) => !this.byId.has(id)));
    this.seedPins = new Map(Object.entries(pins).filter(([id]) => !this.byId.has(id)));
    this.seedRoom = new Map(Object.entries(room).filter(([id, v]) => !this.byId.has(id) && Number.isFinite(v) && Math.abs(v - 1) > 0.001).map(([id, v]) => [id, clampRoom(v)]));
    for (const n of this.list) {
      const r = room[n.id];
      n.room = r !== undefined && Number.isFinite(r) && Math.abs(r - 1) > 0.001 ? clampRoom(r) : undefined;
      // 3D places are not the user's map: the sphere keeps its own, the room still applies.
      if (!flat) continue;
      const p = positions[n.id];
      if (p) { n.x = p[0]; n.y = p[1]; n.z = 0; n.vx = 0; n.vy = 0; n.vz = 0; }
      const pin = pins[n.id];
      if (pin && !n.hub) { n.fx = pin[0]; n.fy = pin[1]; } else { n.fx = null; n.fy = null; n.fz = null; }
    }
    this.applyRoom();
    if (reheat) this.reheat(0.3);
  }

  private anchorsFor(groupOrder: string[], sizes: Map<string, number>): Map<string, Anchor> {
    // Regions placed on the flat map have no meaning on the sphere: 3D always uses the computed anchors.
    return computeAnchors(groupOrder.filter((g) => sizes.has(g)), sizes, this.dims, this.lastZones, this.dims === 2 ? this.placed : new Map());
  }

  /**
   * Replaces the data while keeping every known node where it was. Returns the ids that are new since the last call
   * (none on the first load). New nodes start next to a linked node, or inside their group, so they visibly arrive.
   */
  setData(input: LayoutInput[], links: Array<{ source: string; target: string }>, groupOrder: string[], zones?: ZoneLayout): string[] {
    const sizes = new Map<string, number>();
    for (const n of input) sizes.set(n.group, (sizes.get(n.group) ?? 0) + 1);
    this.lastGroups = groupOrder;
    this.lastZones = zones;
    const before = this.anchorMap;
    this.anchorMap = this.anchorsFor(groupOrder, sizes);
    // A region keeps its place once it has one: a connection change, a new category or a grown region never moves
    // what is already on the map; only a group that is new finds a slot (UI-DESIGN "Maps", "Regions").
    let anchorsChanged = before.size !== this.anchorMap.size;
    for (const [g, a] of this.anchorMap) {
      if (this.dims === 2 && !this.placed.has(g)) this.placed.set(g, [a.x, a.y, a.z]);
      const b = before.get(g);
      if (!b || Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > 0.5) anchorsChanged = true;
    }
    const groupOf = new Map(input.map((n) => [n.id, n.group]));
    const zoneOf = (id: string): string => zones?.of.get(groupOf.get(id) ?? '') ?? MIND_ZONE;
    const neighbour = new Map<string, string>();
    for (const l of links) {
      if (!neighbour.has(l.source)) neighbour.set(l.source, l.target);
      if (!neighbour.has(l.target)) neighbour.set(l.target, l.source);
    }
    const born: string[] = [];
    const next: LayoutNode[] = [];
    const nextById = new Map<string, LayoutNode>();
    let seeded = 0;
    for (const n of input) {
      const prev = this.byId.get(n.id);
      if (prev) { Object.assign(prev, n); next.push(prev); nextById.set(n.id, prev); continue; }
      const seed = this.seeds.get(n.id);
      this.seeds.delete(n.id);
      let node: LayoutNode;
      if (seed) {
        seeded++;
        node = { ...n, x: seed[0], y: seed[1], z: this.dims === 3 ? seed[2] : 0, vx: 0, vy: 0, vz: 0 };
      } else {
        const a = this.anchorMap.get(n.group) ?? { x: 0, y: 0, z: 0, radius: 40 };
        const nb = neighbour.get(n.id);
        const near = nb ? this.byId.get(nb) ?? nextById.get(nb) : undefined;
        const ang = hash01(n.id, 1) * Math.PI * 2;
        const dist = near ? 6 + hash01(n.id, 2) * 8 : n.hub ? 0 : a.radius * (0.25 + 0.6 * hash01(n.id, 2));
        const base = near ?? a;
        node = {
          ...n,
          x: base.x + Math.cos(ang) * dist,
          y: base.y + Math.sin(ang) * dist,
          z: this.dims === 3 ? base.z + (hash01(n.id, 3) - 0.5) * a.radius * 0.8 : 0,
          vx: 0, vy: 0, vz: 0,
        };
        if (this.loaded) born.push(n.id);
      }
      const pin = this.seedPins.get(n.id);
      if (pin && !n.hub) { node.fx = pin[0]; node.fy = pin[1]; if (this.dims === 3) node.fz = pin[2]; }
      const room = this.seedRoom.get(n.id);
      if (room) node.room = room;
      this.seedPins.delete(n.id);
      this.seedRoom.delete(n.id);
      next.push(node);
      nextById.set(n.id, node);
    }
    const prevCount = this.list.length;
    this.list = next;
    this.byId = nextById;

    // A link between two maps that are not connected does not pull (the islands stay apart); a bridge between
    // connected maps pulls a little more than a link between regions.
    const simLinks: LayoutLink[] = links
      .filter((l) => nextById.has(l.source) && nextById.has(l.target))
      .map((l) => ({ source: l.source, target: l.target, cross: groupOf.get(l.source) !== groupOf.get(l.target), bridge: zoneOf(l.source) !== zoneOf(l.target) }))
      .filter((l) => !l.bridge || !zones || zones.connected(zoneOf(l.source as string), zoneOf(l.target as string)));
    const linkKey = simLinks.map((l) => `${l.source as string}>${l.target as string}`).sort().join('|');
    const linksChanged = linkKey !== this.lastLinkKey;
    this.lastLinkKey = linkKey;
    const nodeOf = (n: string | LayoutNode): LayoutNode | undefined => (typeof n === 'object' ? n : nextById.get(n));
    // Inside a region a link is as long as its two nodes need, longer where they were given room.
    this.linkDistance = (l) => (l.bridge ? 150 : l.cross ? 110 : (22 + (nodeOf(l.source)?.r ?? 4) + (nodeOf(l.target)?.r ?? 4)) * Math.sqrt(roomOf(nodeOf(l.source)) * roomOf(nodeOf(l.target))));
    this.sim.nodes(this.list);
    this.linkForce = forceLink<LayoutNode, LayoutLink>(simLinks)
      .id((n) => n.id)
      .distance(this.linkDistance)
      .strength((l) => (l.bridge ? 0.02 : l.cross ? 0.012 : 0.45));
    this.chargeForce = forceManyBody<LayoutNode>().strength(chargeOf).distanceMax(170);
    this.collideForce = forceCollide<LayoutNode>(collideOf).iterations(2);
    this.sim.force('link', this.linkForce);
    this.sim.force('charge', this.chargeForce);
    this.sim.force('collide', this.collideForce);
    this.sim.force('anchor', anchorForce(() => this.list, () => this.anchorMap));

    // The first data with nodes decides between the saved map and a fresh layout; data with none (the page before the
    // vault answered) decides nothing, and every saved place waits for its node.
    if (!this.loaded && !next.length) return born;
    if (!this.loaded) {
      this.loaded = true;
      if (seeded >= this.list.length * 0.6) {
        // A saved map: settle gently from where the user left it instead of laying it out again, or fully when it
        // was saved mid-move (a spread or a gather still under way), so its room has its whole effect.
        this.sim.alpha(this.restoredMoving ? 0.3 : 0.06);
      } else {
        this.sim.alpha(1);
        const started = performance.now();
        for (let i = 0; i < 320 && performance.now() - started < 260; i++) this.sim.tick();
        this.fresh = true;
      }
    } else if (born.length) {
      this.sim.alpha(Math.max(this.sim.alpha(), 0.45));
    } else if (anchorsChanged || linksChanged || this.list.length !== prevCount) {
      // Something changed under the nodes: settle again, gently. A refresh that changes nothing moves nothing.
      this.sim.alpha(Math.max(this.sim.alpha(), 0.12));
    }
    return born;
  }

  /** Makes the forces read every node's room again (d3 caches per-node strengths and radii). */
  private applyRoom(): void {
    this.linkForce?.distance(this.linkDistance);
    this.chargeForce?.strength(chargeOf);
    this.collideForce?.radius(collideOf);
  }

  /**
   * The spread and gather tools (UI-DESIGN "Mind map" → Spreading): the nodes under the brush get more room — `f` is
   * 1 at the brush's centre and fades to 0 at its edge — or less when gathering, down to well inside their laid-out
   * spacing, and a push along `dir` (away from the click, toward it when gathering) so they start moving at once.
   * Pinned nodes keep their place. Returns how many nodes changed their room.
   */
  spread(hits: Array<{ id: string; f: number; dir: Point }>, gather: boolean, kick: number): number {
    let changed = 0;
    for (const h of hits) {
      const n = this.byId.get(h.id);
      if (!n) continue;
      const before = roomOf(n);
      const k = 1 + ROOM_STEP * h.f;
      n.room = clampRoom(gather ? before / k : before * k);
      if (Math.abs(n.room - before) > 0.001) changed++;
      const pinned = n.fx !== null && n.fx !== undefined;
      if (!n.hub && !pinned) {
        const s = (gather ? -1 : 1) * kick * h.f;
        n.vx += h.dir[0] * s; n.vy += h.dir[1] * s; if (this.dims === 3) n.vz += h.dir[2] * s;
      }
    }
    if (hits.length) { this.applyRoom(); this.reheat(0.3); }
    return changed;
  }

  /** One simulation step while the layout is still moving; false once it has settled. */
  tick(): boolean {
    if (this.settled) return false;
    this.sim.tick();
    return true;
  }

  reheat(alpha = 0.3): void { this.sim.alpha(Math.max(this.sim.alpha(), alpha)); }

  setDims(dims: Dims, groupOrder: string[]): void {
    if (dims === this.dims) return;
    this.dims = dims;
    this.sim.numDimensions(dims);
    const sizes = new Map<string, number>();
    for (const n of this.list) sizes.set(n.group, (sizes.get(n.group) ?? 0) + 1);
    this.anchorMap = this.anchorsFor(groupOrder, sizes);
    for (const n of this.list) {
      if (dims === 3) n.z = (hash01(n.id, 3) - 0.5) * 60; else { n.z = 0; n.vz = 0; n.fz = null; }
    }
    this.sim.alpha(0.9);
  }

  pin(id: string, x: number, y: number, z: number): void {
    const n = this.byId.get(id);
    if (!n) return;
    n.fx = x; n.fy = y; if (this.dims === 3) n.fz = z;
    this.reheat(0.12);
  }

  unpin(id: string): void {
    const n = this.byId.get(id);
    if (!n) return;
    n.fx = null; n.fy = null; n.fz = null;
    this.reheat(0.2);
  }

  isPinned(id: string): boolean {
    const n = this.byId.get(id);
    return Boolean(n && n.fx !== null && n.fx !== undefined);
  }

  /** Moves a whole region (its anchor and every node in it) by a world-space offset: dragging a category's hub. */
  moveGroup(group: string, dx: number, dy: number, dz = 0): void {
    const a = this.anchorMap.get(group);
    if (!a) return;
    a.x += dx; a.y += dy; a.z += this.dims === 3 ? dz : 0;
    this.placed.set(group, [a.x, a.y, a.z]);
    for (const n of this.list) {
      if (n.group !== group) continue;
      n.x += dx; n.y += dy; if (this.dims === 3) n.z += dz;
      if (n.fx !== null && n.fx !== undefined) { n.fx += dx; n.fy = (n.fy ?? n.y) + dy; if (this.dims === 3) n.fz = (n.fz ?? n.z) + dz; }
    }
    this.reheat(0.04);
  }

  /** Forgets every placed region and pin and lays the map out from scratch. */
  rearrange(): void {
    this.placed.clear();
    this.seeds.clear();
    this.seedPins.clear();
    this.seedRoom.clear();
    const sizes = new Map<string, number>();
    for (const n of this.list) sizes.set(n.group, (sizes.get(n.group) ?? 0) + 1);
    this.anchorMap = computeAnchors(this.lastGroups.filter((g) => sizes.has(g)), sizes, this.dims, this.lastZones);
    for (const n of this.list) {
      n.fx = null; n.fy = null; n.fz = null;
      n.room = 1;
      const a = this.anchorMap.get(n.group) ?? { x: 0, y: 0, z: 0, radius: 40 };
      const ang = hash01(n.id, 1) * Math.PI * 2;
      const dist = n.hub ? 0 : a.radius * (0.25 + 0.6 * hash01(n.id, 2));
      n.x = a.x + Math.cos(ang) * dist; n.y = a.y + Math.sin(ang) * dist; n.z = this.dims === 3 ? a.z : 0;
      n.vx = 0; n.vy = 0; n.vz = 0;
    }
    this.applyRoom();
    this.sim.alpha(1);
    for (let i = 0; i < 200; i++) this.sim.tick();
  }

  /** Median distance from a node to its nearest neighbour (world units): how dense the map is, for label levels. */
  spacing(sample = 400): number {
    const pts = this.list;
    if (pts.length < 2) return 30;
    const step = Math.max(1, Math.floor(pts.length / sample));
    const d: number[] = [];
    for (let i = 0; i < pts.length; i += step) {
      const a = pts[i]!;
      let best = Infinity;
      for (const b of pts) {
        if (b === a) continue;
        const dd = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
        if (dd < best) best = dd;
      }
      d.push(Math.sqrt(best));
    }
    d.sort((x, y) => x - y);
    return Math.max(8, d[Math.floor(d.length / 2)] ?? 30);
  }
}
