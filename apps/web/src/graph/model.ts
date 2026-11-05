import type { CategoryInfo, MapInfo } from '@synapse/core';
import type { UiGraphEdge, UiGraphNode } from '../lib/types';
import { autoTone, categoryHue, CORE_HUE, familyBaseRgb, familyGlowRgb, familyRgb, groupRgb, oklchToRgb, toneOfHex, zoneHue, zoneRgb, GROUP_HUE, type Rgb, type Tone } from './colors';
import { SHAPE, type GGroup, type GLink, type GNode, type GZone } from './engine';
import { inArchiveCorner } from '../kinds/meta';
import { todayStr } from '../lib/format';
import { ARCHIVE_GROUP, CORE_GROUP, INBOX_GROUP, JOURNAL_GROUP, MAP_GROUP, UNSORTED_GROUP } from './layout';

/** Turns graph data into what the renderer draws: groups, zones (maps), colours, sizes, shapes and label ranks. Pure. */

export const CLOSED = new Set(['done', 'dropped', 'archived', 'filed', 'achieved']);

const BASE_R: Record<string, number> = { area: 9.5, map: 11.5, core: 11, project: 6.6, goal: 6, habit: 4.7, event: 4.5, task: 4.3, idea: 4.8, note: 4.3, person: 4.9, resource: 4.5, journal: 4.1, inbox: 4.4, ghost: 3.1, tag: 3.2 };
/** The core is drawn as the brain (`brain.ts`): its radius is the brain's half-width, and keeps items clear of it. */
const CORE_R = 27;

export interface GraphModel {
  nodes: GNode[];
  links: GLink[];
  groups: GGroup[];
  /** Maps with at least one node on the canvas (UI-DESIGN "Maps"); the mind map is not a zone. */
  zones: GZone[];
  /** Category / group id → signature colour (legend, chips, panels). */
  groupColor: Map<string, Rgb>;
  /** Node id → group id. */
  groupOf: Map<string, string>;
}

export interface GroupTitles {
  inbox: string; journal: string; unsorted: string; archive: string;
  /** "12 items" under a region's name. */
  count: (n: number) => string;
  /** The island switch's text when the map is connected to the mind map, and when it is cut off. */
  connected: string; apart: string;
}

/** A map's centre node forms a one-node group at the heart of its island; the mind map's core likewise. */
export function groupKey(n: Pick<UiGraphNode, 'category' | 'type'> & { id?: string }): string {
  if (n.type === 'map') return MAP_GROUP + (n.id ?? '');
  if (n.type === 'core') return CORE_GROUP;
  if (n.category) return n.category;
  if (n.type === 'inbox') return INBOX_GROUP;
  if (n.type === 'journal') return JOURNAL_GROUP;
  return UNSORTED_GROUP;
}

/**
 * One tone per group (UI-DESIGN "Colour"): a category's own colour first, else its map's (picked or automatic), else
 * its place in the hue sequence; a map's centre group takes its map's tone, the core the interface accent.
 */
export function familyTones(categories: readonly CategoryInfo[], maps: readonly MapInfo[]): Map<string, Tone> {
  const mapTone = new Map(maps.map((m) => [m.id, toneOfHex(m.color) ?? autoTone(zoneHue(m.order, m.role))]));
  const tones = new Map<string, Tone>();
  for (const c of categories) tones.set(c.id, toneOfHex(c.color) ?? (c.map ? mapTone.get(c.map) : undefined) ?? autoTone(categoryHue(c.order)));
  for (const [id, t] of mapTone) tones.set(MAP_GROUP + id, t);
  tones.set(CORE_GROUP, autoTone(CORE_HUE));
  return tones;
}

/** The colour of one category or map while the owner picks it: drawn at once, `saved` once it went to the vault. */
export interface ColorDraft { id: string; color: string | null; saved?: boolean }

/** The list with the draft's colour in place (the same array when the draft is for none of them). */
export function withColorDraft<T extends { id: string; color: string | null }>(list: readonly T[], draft: ColorDraft | null): T[] {
  if (!draft || !list.some((x) => x.id === draft.id)) return list as T[];
  return list.map((x) => (x.id === draft.id ? { ...x, color: draft.color } : x));
}

/** Everything the renderer lays out and names, colours left out: an equal shape means only colours changed (`engine.setColors`). */
export function modelShape(m: Pick<GraphModel, 'nodes' | 'links' | 'groups' | 'zones'>): string {
  return JSON.stringify([
    m.nodes.map((n) => [n.id, n.title, n.group, n.hub, n.r, n.shape, n.closed, n.progress, n.rank, n.tier]),
    m.links.map((l) => [l.source, l.target, l.kind]),
    m.groups.map((g) => [g.id, g.title, g.kind, g.sub, g.map]),
    m.zones.map((z) => [z.id, z.title, z.sub, z.role, z.symbol, z.connects, z.switchOn, z.switchOff]),
  ]);
}

export function nodeRadius(type: string, degree: number): number {
  const base = BASE_R[type] ?? 4.3;
  return Math.min(type === 'area' || type === 'map' || type === 'core' ? 17 : 13, base + 0.95 * Math.sqrt(degree));
}

export function buildGraphModel(nodes: UiGraphNode[], edges: UiGraphEdge[], categories: CategoryInfo[], titles: GroupTitles, maps: MapInfo[] = [], today = todayStr()): GraphModel {
  // One tone per map (UI-DESIGN "Maps"): every region and item of an island shares it, like the members of a category.
  const tone = familyTones(categories, maps);
  const degree = new Map<string, number>();
  for (const e of edges) { degree.set(e.source, (degree.get(e.source) ?? 0) + 1); degree.set(e.target, (degree.get(e.target) ?? 0) + 1); }

  const groupOf = new Map<string, string>();
  // Retired items leave their category for the archive corner (UI-DESIGN "Done and archived"); regions stay where they are.
  const hubKinds = new Set(['area', 'map', 'core']);
  for (const n of nodes) if (n.type !== 'tag') groupOf.set(n.id, !hubKinds.has(n.type) && !n.ghost && inArchiveCorner(n, today) ? ARCHIVE_GROUP : groupKey(n));
  // A project's progress is the share of its tasks that are done (its card shows the same bar).
  const taskStats = new Map<string, { done: number; total: number }>();
  for (const n of nodes) {
    if (n.type !== 'task' || !n.project) continue;
    const s = taskStats.get(n.project) ?? { done: 0, total: 0 };
    s.total++;
    if (n.status === 'done') s.done++;
    taskStats.set(n.project, s);
  }
  const progressOf = (n: UiGraphNode, kind: string, closed: boolean): number => {
    if (kind === 'goal') return closed ? 1 : Math.max(0, Math.min(1, Number(n.facets['progress'] ?? 0) / 100));
    if (kind === 'project') { const s = taskStats.get(n.title); return closed ? 1 : s && s.total ? s.done / s.total : -1; }
    return -1;
  };
  // Client-side tag nodes join the group most of their tagged nodes live in.
  const tagVotes = new Map<string, Map<string, number>>();
  for (const e of edges) {
    if (e.kind !== 'tag') continue;
    const g = groupOf.get(e.source);
    if (!g) continue;
    const m = tagVotes.get(e.target) ?? new Map<string, number>();
    m.set(g, (m.get(g) ?? 0) + 1);
    tagVotes.set(e.target, m);
  }
  for (const n of nodes) {
    if (n.type !== 'tag') continue;
    const votes = [...(tagVotes.get(n.id) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]);
    groupOf.set(n.id, votes[0]?.[0] ?? UNSORTED_GROUP);
  }

  const out: GNode[] = nodes.map((n) => {
    const group = groupOf.get(n.id) ?? UNSORTED_GROUP;
    const closed = CLOSED.has(n.status);
    const t = tone.get(group);
    const kind = n.ghost ? 'ghost' : n.type;
    const color = group === ARCHIVE_GROUP ? groupRgb('archive', kind, true) : t ? familyRgb(t, kind === 'map' || kind === 'core' ? 'area' : kind, closed)
      : groupRgb(group === INBOX_GROUP ? 'inbox' : group === JOURNAL_GROUP ? 'journal' : 'unsorted', kind, closed);
    const deg = degree.get(n.id) ?? 0;
    const hub = n.type === 'area' || n.type === 'map' || n.type === 'core';
    const tier: GNode['tier'] = hub ? 'hub' : n.type === 'project' || n.type === 'goal' || deg >= 4 ? 'major' : 'minor';
    return {
      id: n.id,
      title: n.title,
      group,
      hub,
      r: kind === 'core' ? CORE_R : nodeRadius(kind, deg),
      color,
      shape: SHAPE[kind] ?? 0,
      closed: closed && !n.ghost,
      progress: progressOf(n, kind, closed),
      rank: (tier === 'hub' ? (n.type === 'area' ? 3000 : 3500) : tier === 'major' ? 1000 : 0) + deg * 10 + (closed ? -500 : 0) + (n.ghost ? -800 : 0),
      tier,
    };
  });

  const present = new Set(out.map((n) => n.group));
  const members = new Map<string, number>();
  for (const n of out) if (!n.hub && n.id.indexOf('tag:') !== 0) members.set(n.group, (members.get(n.group) ?? 0) + 1);
  const groups: GGroup[] = [];
  const groupColor = new Map<string, Rgb>();
  for (const c of [...categories].sort((a, b) => a.order - b.order)) {
    const t = tone.get(c.id) ?? autoTone(categoryHue(c.order));
    const color = familyBaseRgb(t);
    groupColor.set(c.id, color);
    if (present.has(c.id)) groups.push({ id: c.id, title: c.title, color, glow: familyGlowRgb(t), kind: 'category', sub: titles.count(members.get(c.id) ?? 0), map: c.map });
  }
  // Each map's centre node is a group of its own at the island's heart, as is the mind map's core.
  for (const m of [...maps].sort((a, b) => a.order - b.order)) {
    const id = MAP_GROUP + m.id;
    const { color, glow } = zoneRgb(tone.get(id)!);
    groupColor.set(id, color);
    if (present.has(id)) groups.push({ id, title: m.title, color, glow, kind: 'map', sub: '', map: m.id });
  }
  const core = tone.get(CORE_GROUP)!;
  groupColor.set(CORE_GROUP, familyBaseRgb(core));
  if (present.has(CORE_GROUP)) groups.push({ id: CORE_GROUP, title: '', color: familyBaseRgb(core), glow: familyGlowRgb(core), kind: 'core', sub: '', map: null });
  const specials: Array<[string, 'inbox' | 'journal' | 'unsorted' | 'archive', string]> = [[INBOX_GROUP, 'inbox', titles.inbox], [JOURNAL_GROUP, 'journal', titles.journal], [UNSORTED_GROUP, 'unsorted', titles.unsorted], [ARCHIVE_GROUP, 'archive', titles.archive]];
  for (const [id, kind, title] of specials) {
    const color = groupRgb(kind, 'area');
    groupColor.set(id, color);
    const g = GROUP_HUE[kind];
    if (present.has(id)) groups.push({ id, title, color, glow: oklchToRgb(g.l * 0.62, g.c * 1.4, g.h), kind, sub: titles.count(members.get(id) ?? 0), map: null });
  }

  // One zone per map on the canvas; its item count is what its regions hold.
  const zoneMembers = new Map<string, number>();
  for (const g of groups) if (g.map && g.kind === 'category') zoneMembers.set(g.map, (zoneMembers.get(g.map) ?? 0) + (members.get(g.id) ?? 0));
  const zones: GZone[] = [...maps].sort((a, b) => a.order - b.order).filter((m) => present.has(MAP_GROUP + m.id) || zoneMembers.has(m.id)).map((m) => {
    const { color, glow } = zoneRgb(tone.get(MAP_GROUP + m.id)!);
    return { id: m.id, title: m.title, color, glow, sub: titles.count(zoneMembers.get(m.id) ?? 0), role: m.role, symbol: m.symbol, connects: m.connects, switchOn: titles.connected, switchOff: titles.apart };
  });

  const ids = new Set(out.map((n) => n.id));
  // The archive is switched off: no line runs from it to anything still live.
  const archived = (id: string): boolean => groupOf.get(id) === ARCHIVE_GROUP;
  const links: GLink[] = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && archived(e.source) === archived(e.target)).map((e) => ({ source: e.source, target: e.target, kind: e.kind }));
  return { nodes: out, links, groups, zones, groupColor, groupOf };
}

export function rgbCss(c: Rgb, a = 1): string {
  return `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;
}
