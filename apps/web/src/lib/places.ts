import type { CategoryInfo, MapInfo } from '@synapse/core';
import { CLOSED } from '../graph/model';
import { isRetired } from '../kinds/meta';
import { isUrgent } from './actions';
import { daysBetween } from './format';
import type { UiGraphNode } from './types';

/**
 * Categories and islands as places (UI-DESIGN "Places"): the mind map and each map with its categories, what a place
 * holds, its numbers and its timeline. Pure: the page draws what these say.
 */
export const MIND = 'mind';
export const MAP_PLACE = 'map:';
export const SPECIAL_PLACES = ['__inbox', '__journal', '__unsorted', '__archive'] as const;

export interface Space { id: string; mapId: string | null; categories: CategoryInfo[] }

/** Analysis runs of one place started in this copy (run id → the page and its name), so their end says the right thing. */
export const placeRuns = new Map<string, { id: string; title: string }>();

/** The text under one `## Heading` of a Markdown file. */
export function sectionText(md: string, heading: RegExp): string | null {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => /^##\s/.test(l) && heading.test(l.replace(/^##\s*/, '').trim()));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  const text = lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
  return text || null;
}

/** What a place's analysis says in short: its In short section, else its first paragraph (a model may skip the headings). */
export function analysisLead(md: string): string | null {
  const own = sectionText(md, /^in short$/i);
  if (own) return own;
  return md.replace(/^#\s.*$/m, '').split(/\n\s*\n/).map((p) => p.trim()).find((p) => p !== '' && !p.startsWith('#')) ?? null;
}

/** The place an analysis prompt names (`[[Title]] → memory/places/<file>.md`, UI-DESIGN "Places"); null for any other prompt. */
export function analysisTitle(prompt: string): string | null {
  return /^\[\[([^\]]+)\]\]\s*→\s*memory\/places\//.exec(prompt.trim())?.[1] ?? null;
}

/** The page of the category or the map with this title (a category first); null when neither exists. */
export function placeIdOf(title: string, categories: readonly CategoryInfo[], maps: readonly MapInfo[]): string | null {
  const cat = categories.find((c) => c.title === title);
  if (cat) return cat.id;
  const map = maps.find((m) => m.title === title);
  return map ? MAP_PLACE + map.id : null;
}

/** The mind map first, then every live map in its order, each with its live categories. */
export function spacesOf(categories: readonly CategoryInfo[], maps: readonly MapInfo[]): Space[] {
  const live = categories.filter((c) => c.status !== 'archived').sort((a, b) => a.order - b.order);
  return [
    { id: MIND, mapId: null, categories: live.filter((c) => !c.map) },
    ...maps.filter((m) => m.status !== 'archived').sort((a, b) => a.order - b.order).map((m) => ({ id: MAP_PLACE + m.id, mapId: m.id, categories: live.filter((c) => c.map === m.id) })),
  ];
}

const HUBS = new Set(['area', 'map', 'core']);

/** What a place holds: a category's items, a map's or the mind map's items in its categories, or a special group's. */
export function membersOf(place: string, nodes: readonly UiGraphNode[], today: string): UiGraphNode[] {
  const items = nodes.filter((n) => !n.ghost && !HUBS.has(n.type) && n.type !== 'tag');
  if (place === MIND) return items.filter((n) => n.category !== null && n.map === null);
  if (place.startsWith(MAP_PLACE)) { const id = place.slice(MAP_PLACE.length); return items.filter((n) => n.map === id); }
  if (place === '__inbox') return items.filter((n) => n.type === 'inbox');
  if (place === '__journal') return items.filter((n) => n.type === 'journal');
  if (place === '__unsorted') return items.filter((n) => n.category === null && n.type !== 'inbox' && n.type !== 'journal');
  if (place === '__archive') return items.filter((n) => isRetired(n, today));
  return items.filter((n) => n.category === place);
}

export interface PlaceStats { items: number; open: number; urgent: number; last: string | null }

export function placeStats(items: readonly UiGraphNode[], today: string): PlaceStats {
  const live = items.filter((n) => !isRetired(n, today));
  const open = live.filter((n) => n.type === 'task' && !CLOSED.has(n.status));
  const last = items.reduce<string | null>((m, n) => { const d = (n.updated ?? n.created ?? '').slice(0, 10); return d && (!m || d > m) ? d : m; }, null);
  return { items: live.length, open: open.length, urgent: open.filter((n) => isUrgent(n, today)).length, last };
}

/** A larger item with what it holds: a project's tasks, a goal's linked work, a person's moments. */
export interface PlaceBranch { node: UiGraphNode; children: UiGraphNode[] }
/** A place from the whole to its parts (UI-DESIGN "Places"): the larger items with theirs, the rest by kind, the retired apart. */
export interface PlaceTree { branches: PlaceBranch[]; loose: Array<{ kind: string; items: UiGraphNode[] }>; retired: UiGraphNode[] }

const BRANCH_KINDS = ['goal', 'project', 'person'];
const LOOSE_ORDER = ['task', 'habit', 'idea', 'event', 'note', 'resource', 'journal', 'inbox'];
const GOAL_PARTS = new Set(['project', 'task', 'habit', 'idea', 'note', 'resource']);
const PERSON_PARTS = new Set(['event', 'note', 'idea']);

/** Open things first (by due date), then the rest by their last change. */
function partOrder(a: UiGraphNode, b: UiGraphNode): number {
  const ca = CLOSED.has(a.status) ? 1 : 0; const cb = CLOSED.has(b.status) ? 1 : 0;
  if (ca !== cb) return ca - cb;
  return (a.due ?? '9999').localeCompare(b.due ?? '9999') || (b.updated ?? '').localeCompare(a.updated ?? '');
}

export function treeOf(items: readonly UiGraphNode[], edges: readonly { source: string; target: string; kind: string }[], today: string): PlaceTree {
  const live = items.filter((n) => !isRetired(n, today));
  const retired = items.filter((n) => isRetired(n, today));
  const here = new Map(live.map((n) => [n.id, n]));
  const placed = new Set<string>();
  const linked = (id: string): UiGraphNode[] => {
    const out: UiGraphNode[] = [];
    for (const e of edges) {
      const other = e.source === id ? e.target : e.target === id ? e.source : null;
      const n = other ? here.get(other) : undefined;
      if (n && n.id !== id) out.push(n);
    }
    return out;
  };
  const branches: PlaceBranch[] = [];
  for (const kind of BRANCH_KINDS) {
    for (const node of live.filter((n) => n.type === kind).sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''))) {
      let children: UiGraphNode[];
      if (kind === 'project') children = live.filter((n) => n.type !== 'project' && n.project === node.title);
      else if (kind === 'goal') children = linked(node.id).filter((n) => GOAL_PARTS.has(n.type));
      else children = edges.filter((e) => e.kind === 'mentions' && e.target === node.id).map((e) => here.get(e.source)).filter((n): n is UiGraphNode => Boolean(n && PERSON_PARTS.has(n.type)));
      children = [...new Map(children.map((c) => [c.id, c])).values()].sort(partOrder);
      // A project's tasks and a person's moments live under them; a goal only points at its work, which stays in place.
      if (kind !== 'goal') for (const c of children) placed.add(c.id);
      branches.push({ node, children });
    }
  }
  const loose = LOOSE_ORDER.map((kind) => ({ kind, items: live.filter((n) => n.type === kind && !placed.has(n.id)).sort(partOrder) })).filter((g) => g.items.length);
  return { branches, loose, retired };
}
