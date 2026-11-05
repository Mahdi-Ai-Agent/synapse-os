import type { MapInfo } from '@synapse/core';
import { useMemo } from 'react';
import { autoTone, toneOfHex, zoneHue, zoneRgb } from '../graph/colors';
import { rgbCss, withColorDraft } from '../graph/model';
import { useStore } from '../state/store';

/** The mind map's id in `connects` and in `graph.maps[].connects` (core `MIND_MAP`). */
export const MIND = 'mind';

export interface MapsInfo {
  maps: MapInfo[];
  character: MapInfo | undefined;
  byId: (id: string | null | undefined) => MapInfo | undefined;
  /** Signature colour of a map's outline and name (UI-DESIGN "Maps"). */
  color: (id: string) => string;
  /** Whether two maps (`mind` or ids) are connected. */
  connected: (a: string, b: string) => boolean;
  /** Whether a connection between two maps is kept but waits, because one of them is switched off. */
  paused: (a: string, b: string) => boolean;
}

/** The vault's maps as the graph lists them (VAULT-SPEC "Maps"), with their colours. */
export function useMaps(): MapsInfo {
  const maps = useStore((s) => s.graph?.maps);
  const draft = useStore((s) => s.colorDraft);
  return useMemo(() => {
    const list = withColorDraft([...(maps ?? [])].sort((a, b) => a.order - b.order), draft);
    const byId = new Map(list.map((m) => [m.id, m]));
    const connected = (a: string, b: string): boolean => a === b || Boolean(byId.get(a)?.connects.includes(b)) || Boolean(byId.get(b)?.connects.includes(a));
    return {
      maps: list,
      character: list.find((m) => m.role === 'character'),
      byId: (id) => (id ? byId.get(id) : undefined),
      color: (id) => { const m = byId.get(id); return rgbCss(zoneRgb(toneOfHex(m?.color) ?? autoTone(zoneHue(m?.order ?? 0, m?.role ?? null))).color); },
      connected,
      paused: (a, b) => !connected(a, b) && (Boolean(byId.get(a)?.kept.includes(b)) || Boolean(byId.get(b)?.kept.includes(a))),
    };
  }, [maps, draft]);
}

/** A scope a run works in (UI-DESIGN "Scopes"): the core (`mind`, the mind map plus every map connected to it) or one group of maps cut off from it. */
export interface MapScope { id: string; core: boolean; maps: MapInfo[] }

/** Mirrors core `scopesOf` (the server's copy) over the graph's resolved connections, without pulling core's runtime into the bundle. */
export function scopesOf(maps: readonly MapInfo[]): MapScope[] {
  const live = [...maps].filter((m) => m.status !== 'archived').sort((a, b) => a.order - b.order);
  const ids = new Set(live.map((m) => m.id));
  const adj = new Map<string, Set<string>>([[MIND, new Set()]]);
  for (const m of live) adj.set(m.id, new Set());
  for (const m of live) for (const c of m.connects) {
    if (c !== MIND && !ids.has(c)) continue;
    adj.get(m.id)!.add(c);
    adj.get(c)!.add(m.id);
  }
  const component = (start: string): Set<string> => {
    const out = new Set<string>([start]);
    const queue = [start];
    while (queue.length) for (const next of adj.get(queue.shift()!) ?? []) if (!out.has(next)) { out.add(next); queue.push(next); }
    return out;
  };
  const seen = component(MIND);
  const scopes: MapScope[] = [{ id: MIND, core: true, maps: live.filter((m) => seen.has(m.id)) }];
  for (const m of live) {
    if (seen.has(m.id)) continue;
    const group = component(m.id);
    for (const id of group) seen.add(id);
    scopes.push({ id: m.id, core: false, maps: live.filter((x) => group.has(x.id)) });
  }
  return scopes;
}

/** The scopes the vault offers right now: one core, plus one per group of maps cut off from the mind map. */
export function useScopes(): MapScope[] {
  const maps = useStore((s) => s.graph?.maps);
  return useMemo(() => scopesOf(maps ?? []), [maps]);
}

/** `connects` as written in a map's frontmatter: `mind`, or `"[[Title]]"` for another map. */
function ref(maps: MapInfo[], id: string): string | null {
  if (id === MIND) return MIND;
  const m = maps.find((x) => x.id === id);
  return m ? `[[${m.title}]]` : null;
}

/** One write to a map node (`api.updateNode`): its `connects` as written and/or its switch (`apart`, null removes it). */
export interface MapPatch { id: string; frontmatter: { connects?: string[]; facets?: { apart: true | null } } }

/** Every connection a map has, paused ones included, as frontmatter refs, without `without`. */
function written(maps: MapInfo[], m: MapInfo, without?: string): string[] {
  return m.kept.filter((c) => c !== without).map((c) => ref(maps, c)).filter((c): c is string => c !== null);
}

/**
 * The island's switch (VAULT-SPEC "Maps"): off marks the map `apart` — cut off from everything while every connection
 * stays written — and on clears the mark, so each connection comes back as it was. On means linked to the mind map,
 * so a map that never had that link gets it.
 */
export function switchPatches(maps: MapInfo[], a: MapInfo, on: boolean): MapPatch[] {
  if (!on) return [{ id: a.id, frontmatter: { facets: { apart: true } } }];
  const frontmatter: MapPatch['frontmatter'] = {};
  if (a.apart) frontmatter.facets = { apart: null };
  if (!a.kept.includes(MIND)) frontmatter.connects = [MIND, ...written(maps, a)];
  return frontmatter.facets || frontmatter.connects ? [{ id: a.id, frontmatter }] : [];
}

/**
 * The writes that connect or disconnect two maps (the connection chips). A connection counts from either side, so
 * connecting writes it on one map — and switches both maps on, each bringing back what it kept — while disconnecting
 * removes it from both sides, kept or live.
 */
export function connectionPatches(maps: MapInfo[], a: MapInfo, b: string, on: boolean): MapPatch[] {
  const other = maps.find((m) => m.id === b);
  if (on) {
    const add = ref(maps, b);
    if (!add) return [];
    const out: MapPatch[] = [{ id: a.id, frontmatter: { connects: [...written(maps, a, b), add], ...(a.apart ? { facets: { apart: null } } : {}) } }];
    if (other?.apart) out.push({ id: other.id, frontmatter: { facets: { apart: null } } });
    return out;
  }
  const out: MapPatch[] = [{ id: a.id, frontmatter: { connects: written(maps, a, b) } }];
  if (other) out.push({ id: other.id, frontmatter: { connects: written(maps, other, a.id) } });
  return out;
}
