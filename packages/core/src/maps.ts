import { hexColor } from './categories';
import { mapApart, mapSymbol } from './facets';
import { relationTitles } from './node';
import { normalizeTitle } from './wikilinks';
import { MIND_MAP, type CategoryInfo, type GraphNode, type MapInfo, type VaultNode } from './types';

/**
 * Maps (VAULT-SPEC "Maps"): a `map` node is a space of categories beside the mind map — the character map the brain
 * builds about the owner, a business, a page. An area joins a map through its `map` relation; everything in that
 * area is in the map. Connections (`connects`) are read from either side, so one toggle links two maps. A map switched
 * off (`apart: true`) keeps its connections as written but none of them counts until it is switched on again.
 */

const byCreation = (a: VaultNode, b: VaultNode): number =>
  (a.fm.created || '').localeCompare(b.fm.created || '') || (a.fm.id < b.fm.id ? -1 : a.fm.id > b.fm.id ? 1 : 0);

export interface MapAssignment {
  maps: MapInfo[];
  /** Area id → map id, for every area whose `map` resolves to a map node. */
  mapOfArea: Map<string, string>;
}

/** Resolves every area's `map` and every map's `connects` by title (or alias), and counts what each map holds. */
export function buildMaps(mapNodes: VaultNode[], areas: VaultNode[], categories: CategoryInfo[], nodes: GraphNode[]): MapAssignment {
  const sorted = [...mapNodes].sort(byCreation);
  const idByKey = new Map<string, string>();
  for (const m of sorted) {
    idByKey.set(normalizeTitle(m.fm.title), m.fm.id);
    for (const alias of m.fm.aliases) if (!idByKey.has(normalizeTitle(alias))) idByKey.set(normalizeTitle(alias), m.fm.id);
  }
  const resolve = (title: string): string | undefined => (title === MIND_MAP ? MIND_MAP : idByKey.get(normalizeTitle(title)));

  const mapOfArea = new Map<string, string>();
  for (const a of areas) {
    const title = relationTitles(a.fm).map;
    const id = title ? resolve(title) : undefined;
    if (id && id !== MIND_MAP) mapOfArea.set(a.fm.id, id);
  }

  // A connection named on either map counts for both, unless either side is switched off: then it waits, kept.
  const apart = new Set(sorted.filter((m) => mapApart(m.fm.extra['apart'])).map((m) => m.fm.id));
  const kept = new Map<string, Set<string>>(sorted.map((m) => [m.fm.id, new Set<string>()]));
  for (const m of sorted) {
    for (const target of relationTitles(m.fm).connects) {
      const id = resolve(target);
      if (!id || id === m.fm.id) continue;
      kept.get(m.fm.id)?.add(id);
      if (id !== MIND_MAP) kept.get(id)?.add(m.fm.id);
    }
  }
  const mindFirst = (a: string, b: string): number => (a === MIND_MAP ? -1 : b === MIND_MAP ? 1 : a.localeCompare(b));

  const areaCount = new Map<string, number>();
  for (const c of categories) { const id = mapOfArea.get(c.id); if (id) areaCount.set(id, (areaCount.get(id) ?? 0) + 1); }
  const size = new Map<string, number>();
  for (const n of nodes) {
    const id = n.category ? mapOfArea.get(n.category) : undefined;
    if (id) size.set(id, (size.get(id) ?? 0) + 1);
  }

  const maps: MapInfo[] = sorted.map((m, order) => ({
    id: m.fm.id,
    title: m.fm.title,
    summary: m.fm.summary,
    status: m.fm.status,
    role: m.fm.extra['role'] === 'character' ? 'character' : null,
    symbol: mapSymbol(m.fm.extra['role'] === 'character' ? 'character' : null, m.fm.extra['symbol']),
    color: hexColor(m.fm.extra['color']),
    connects: [...(kept.get(m.fm.id) ?? [])].filter((c) => !apart.has(m.fm.id) && !apart.has(c)).sort(mindFirst),
    apart: apart.has(m.fm.id),
    kept: [...(kept.get(m.fm.id) ?? [])].sort(mindFirst),
    order,
    areas: areaCount.get(m.fm.id) ?? 0,
    size: size.get(m.fm.id) ?? 0,
  }));
  return { maps, mapOfArea };
}

/** True when the two maps (`mind` or map ids) are connected; a map is always connected to itself. */
export function mapsConnected(maps: readonly MapInfo[], a: string, b: string): boolean {
  if (a === b) return true;
  const find = (id: string): MapInfo | undefined => maps.find((m) => m.id === id);
  return Boolean(find(a)?.connects.includes(b) || find(b)?.connects.includes(a));
}

/**
 * A scope a run works in (UI-DESIGN "Scopes"): the core — the mind map plus every map connected to it, directly or
 * through another map — or one group of maps cut off from the mind map. `id` is `mind` for the core, else the first
 * map of the group by creation order. The web app mirrors this in `lib/maps.ts`.
 */
export interface MapScope { id: string; core: boolean; maps: MapInfo[] }

export function scopesOf(maps: readonly MapInfo[]): MapScope[] {
  const live = [...maps].filter((m) => m.status !== 'archived').sort((a, b) => a.order - b.order);
  const ids = new Set(live.map((m) => m.id));
  const adj = new Map<string, Set<string>>([[MIND_MAP, new Set()]]);
  for (const m of live) adj.set(m.id, new Set());
  for (const m of live) for (const c of m.connects) {
    if (c !== MIND_MAP && !ids.has(c)) continue;
    adj.get(m.id)!.add(c);
    adj.get(c)!.add(m.id);
  }
  const seen = new Set<string>();
  const component = (start: string): Set<string> => {
    const out = new Set<string>([start]);
    const queue = [start];
    while (queue.length) for (const next of adj.get(queue.shift()!) ?? []) if (!out.has(next)) { out.add(next); queue.push(next); }
    return out;
  };
  const core = component(MIND_MAP);
  for (const id of core) seen.add(id);
  const scopes: MapScope[] = [{ id: MIND_MAP, core: true, maps: live.filter((m) => core.has(m.id)) }];
  for (const m of live) {
    if (seen.has(m.id)) continue;
    const group = component(m.id);
    for (const id of group) seen.add(id);
    scopes.push({ id: m.id, core: false, maps: live.filter((x) => group.has(x.id)) });
  }
  return scopes;
}
