import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT, type TKey } from '../i18n';
import { api } from '../lib/api';
import { startRun } from '../lib/brain';
import { fmtDate, fmtNum, todayStr } from '../lib/format';
import { Expand, Shrink, X } from 'lucide-react';
import { isCoarsePointer } from '../lib/media';
import type { MapInfo } from '@synapse/core';
import type { UiGraphEdge, UiGraphNode } from '../lib/types';
import { useStore } from '../state/store';
import { LivingGraph, type CamPose } from '../graph/engine';
import { buildGraphModel, modelShape, rgbCss, withColorDraft, type GraphModel } from '../graph/model';
import { DONE, isRetired } from '../kinds/meta';
import { brainActivity } from '../lib/activity';
import { layoutEvents, LayoutSync } from '../lib/layout-sync';
import { MIND, switchPatches } from '../lib/maps';
import { CategoryCard } from './graph/CategoryCard';
import { CategoryLegend } from './graph/CategoryLegend';
import { GraphSearch } from './graph/GraphSearch';
import { GraphToolbar } from './graph/GraphToolbar';
import { NodeMenu, type MenuState } from './graph/NodeMenu';
import { MapChat } from './graph/MapChat';
import { TellBar } from './graph/TellBar';
import { NodePanel } from './NodePanel';
import { TypeIcon } from './TypeIcon';

/** Width of the start-side panel a category or an item opens on the map. */
export const PLACE_W = 388;

/** The mind map's core node (UI-DESIGN "Maps"): client-side, at the centre of the mind map's ring. */
export const CORE_ID = 'core:mind';

/**
 * The structure the canvas draws on top of the vault's edges (UI-DESIGN "Maps"): the mind map's core — the brain —
 * with a link to each of its categories, each map's link to the core when it is connected to the mind map, and a link
 * between two connected maps. The area → map links come from the vault itself. Nothing here is a node or an edge in
 * files. The brain is there as soon as the vault holds anything, even before the mind map has a category of its own.
 */
function withStructure(nodes: UiGraphNode[], edges: UiGraphEdge[], maps: MapInfo[], coreTitle: string, coreSummary: string): { nodes: UiGraphNode[]; edges: UiGraphEdge[] } {
  const ids = new Set(nodes.map((n) => n.id));
  const mindAreas = nodes.filter((n) => n.type === 'area' && !n.map);
  const extra: UiGraphEdge[] = [];
  const out = [...nodes];
  const hasCore = nodes.length > 0;
  if (hasCore) {
    out.push({
      id: CORE_ID, type: 'core', title: coreTitle, summary: coreSummary, status: 'active', tags: [], path: null, created: null, updated: null,
      due: null, completed: null, priority: null, area: null, project: null, inDegree: mindAreas.length, outDegree: 0, ghost: false, category: null, categorySource: null, map: null, facets: {},
    });
    for (const a of mindAreas) extra.push({ id: `${a.id}->${CORE_ID}:belongs_to`, source: a.id, target: CORE_ID, kind: 'belongs_to' });
  }
  const seen = new Set<string>();
  for (const m of maps) {
    if (!ids.has(m.id)) continue;
    for (const c of m.connects) {
      if (c === MIND) { if (hasCore) extra.push({ id: `${m.id}->${CORE_ID}:link`, source: m.id, target: CORE_ID, kind: 'link' }); continue; }
      if (!ids.has(c)) continue;
      const key = [m.id, c].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      extra.push({ id: `${m.id}->${c}:link`, source: m.id, target: c, kind: 'link' });
    }
  }
  return { nodes: out, edges: [...edges, ...extra] };
}

/** Client-side tag nodes (`tag:<name>`) and `tag` edges for the nodes shown; tags are not nodes in files. */
function withTagNodes(nodes: UiGraphNode[], edges: UiGraphEdge[]): { nodes: UiGraphNode[]; edges: UiGraphEdge[] } {
  const count = new Map<string, number>();
  const tagEdges: UiGraphEdge[] = [];
  for (const n of nodes) {
    if (n.ghost) continue;
    for (const tag of n.tags) {
      count.set(tag, (count.get(tag) ?? 0) + 1);
      tagEdges.push({ id: `${n.id}->tag:${tag}:tag`, source: n.id, target: `tag:${tag}`, kind: 'tag' });
    }
  }
  const tagNodes: UiGraphNode[] = [...count.entries()].map(([tag, inDegree]) => ({
    id: `tag:${tag}`, type: 'tag', title: `#${tag}`, summary: '', status: 'active', tags: [], path: null, created: null, updated: null,
    due: null, completed: null, priority: null, area: null, project: null, inDegree, outDegree: 0, ghost: false, category: null, categorySource: null, map: null, facets: {},
  }));
  return { nodes: [...nodes, ...tagNodes], edges: [...edges, ...tagEdges] };
}

/** Nodes within `depth` links of `id`. */
function neighbourhood(id: string, depth: number, edges: UiGraphEdge[]): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source))!.push(e.target);
    (adj.get(e.target) ?? adj.set(e.target, []).get(e.target))!.push(e.source);
  }
  const keep = new Set([id]);
  let frontier = [id];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const n of frontier) for (const nb of adj.get(n) ?? []) if (!keep.has(nb)) { keep.add(nb); next.push(nb); }
    frontier = next;
  }
  return keep;
}

/**
 * The mind map (spec: docs/UI-DESIGN.md "Mind map"): the WebGL engine plus its chrome, laid out like a map app —
 * search and category chips along the top, the place panel on the start side, zoom controls on the end side, a
 * tell-the-brain bar at the bottom. It stays mounted behind every page so the camera and the layout survive
 * navigation, and pauses while hidden.
 */
export function GraphView({ active = true, compact = false }: { active?: boolean; compact?: boolean }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const graph = useStore((s) => s.graph);
  const filters = useStore((s) => s.filters);
  const settings = useStore((s) => s.settings);
  const selectedId = useStore((s) => s.selectedId);
  const placeGroup = useStore((s) => s.placeGroup);
  const focusId = useStore((s) => s.focusId);
  const focusDepth = useStore((s) => s.focusDepth);
  const timelapse = useStore((s) => s.timelapse);
  const setTimelapse = useStore((s) => s.setTimelapse);
  const highlight = useStore((s) => s.highlight);
  const isolateGroup = useStore((s) => s.isolateGroup);
  const mode3d = useStore((s) => s.mode3d);
  const flyRequest = useStore((s) => s.flyRequest);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<LivingGraph | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const hoverRef = useRef<string | null>(null);
  const modelRef = useRef<GraphModel | null>(null);
  const fittedRef = useRef(false);
  const flownRef = useRef<Set<string>>(new Set());
  const flyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasSelect = useRef<string | null>(null);
  /** Where the camera was before a category or an item was opened, so stepping back out returns there (UI-DESIGN "Mind map"). */
  /** Where to come back to, per level: a category (place), an item or a map (item), a camera-only flight such as the core's (view). */
  const navRef = useRef<{ place?: CamPose | null; item?: CamPose | null; view?: CamPose | null }>({});
  const menuRef = useRef<MenuState | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [failed, setFailed] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  /** The map was hidden behind another page: the ignition plays again when it comes back (UI-DESIGN "Living graph"). */
  const awayRef = useRef(false);

  /**
   * The map's saves and the other open copies' saves (`lib/layout-sync.ts`, docs/ARCHITECTURE.md "Layout"): a change
   * waits a moment so a burst of them is one save; a copy never saves a map it did not change, and takes the one
   * another copy saved.
   */
  const syncRef = useRef<LayoutSync | null>(null);
  if (!syncRef.current) syncRef.current = new LayoutSync(() => engineRef.current, { load: api.layout, save: (body, keepalive) => api.putLayout(body, { keepalive }) });
  const saveLayout = useCallback((): void => { syncRef.current?.changed(); }, []);
  // A save still waiting goes out when the page is hidden or closed (a refresh, another tab or app) and when the map
  // goes away, so a spread or a drag a moment before is never lost (UI-DESIGN "Mind map" → Spreading); coming back,
  // and on every saved layout another copy announces, the newer map is taken.
  useEffect(() => {
    const sync = syncRef.current;
    if (!sync) return;
    const visibility = (): void => { if (document.visibilityState === 'hidden') sync.leave(); else sync.remote(null); };
    const leaving = (): void => sync.leave();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', leaving);
    const off = layoutEvents.subscribe((ev) => sync.remote(ev));
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', leaving);
      off();
      if (flyTimer.current) clearTimeout(flyTimer.current);
      sync.leave();
    };
  }, []);
  useEffect(() => { menuRef.current = menu; }, [menu]);

  /** Keeps the camera's goal as the place to come back to — once per level, before the flight in. */
  const remember = useCallback((level: 'place' | 'item' | 'view'): void => {
    const nav = navRef.current;
    if (nav[level] === undefined) nav[level] = engineRef.current?.cameraPose() ?? null;
  }, []);
  const flyBack = useCallback((level: 'place' | 'item' | 'view'): void => {
    const nav = navRef.current;
    const pose = nav[level];
    nav[level] = undefined;
    if (level === 'place') nav.item = undefined;
    const engine = engineRef.current;
    if (pose && engine && !engine.movedSince(pose)) engine.flyToPose(pose);
  }, []);
  /** One step back — item → category card → nothing — and the camera returns with it unless the user moved it since. */
  const back = useCallback((): void => {
    const s = useStore.getState();
    if (s.selectedId) { s.select(null); flyBack('item'); }
    else if (s.placeGroup) { s.openPlace(null); flyBack('place'); }
    else if (s.focusId) s.setFocus(null);
    else flyBack('view'); // after a core click: the camera alone comes back
  }, [flyBack]);
  const closePlace = useCallback((): void => { useStore.getState().openPlace(null); flyBack('place'); }, [flyBack]);

  // ---- engine lifecycle (mounted once; callbacks read fresh state from the store)
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: LivingGraph;
    try {
      engine = new LivingGraph(host, {
        onHover: (id) => { hoverRef.current = id; setHover(id); },
        onClick: (id) => {
          const s = useStore.getState();
          setMenu(null);
          if (id.startsWith('tag:')) { s.setFilters({ tag: s.filters.tag === tag(id) ? null : tag(id) }); return; }
          remember('item');
          canvasSelect.current = id;
          s.select(id);
          engineRef.current?.flyToNode(id, 'reveal');
        },
        onGroupClick: (group) => {
          setMenu(null);
          const s = useStore.getState();
          remember('place');
          navRef.current.item = undefined;
          s.openPlace(group);
          engineRef.current?.flyToGroup(group);
        },
        // A map's centre or name opens the map itself (its card in the panel) and frames its island, remembering
        // where the camera was like a category click does: an empty-map click or Escape glides back.
        onZoneClick: (map) => {
          setMenu(null);
          const s = useStore.getState();
          remember('item');
          canvasSelect.current = map;
          s.select(map);
          const ids = new Set((s.graph?.nodes ?? []).filter((n) => n.map === map).map((n) => n.id));
          if (ids.size) engineRef.current?.frameNodes(1.1, ids);
        },
        // The island's switch: off cuts the map off from everything — the mind map and every other map — while its
        // connections stay written; on brings every one of them back (VAULT-SPEC "Maps", written to the vault).
        onZoneToggle: (map) => {
          const s = useStore.getState();
          const maps = s.graph?.maps ?? [];
          const m = maps.find((x) => x.id === map);
          if (!m) return;
          const patches = switchPatches(maps, m, !m.connects.includes(MIND));
          void (async () => {
            try { for (const p of patches) await api.updateNode(p.id, { frontmatter: p.frontmatter }); } catch (e) { s.setToast((e as Error).message); }
          })();
        },
        onDoubleClick: (id) => {
          if (id.startsWith('tag:')) return;
          const s = useStore.getState();
          s.setFocus(id, Math.max(1, s.focusDepth));
          engineRef.current?.flyToNode(id, true);
        },
        onContextMenu: (id, x, y) => { if (!id.startsWith('tag:') && !id.startsWith('core:')) setMenu({ id, x, y }); },
        // The mind map's core: frame the mind map itself, and remember where the camera was so an empty-map click
        // or Escape brings it back.
        onCoreClick: () => {
          const s = useStore.getState();
          remember('view');
          const ids = new Set((s.graph?.nodes ?? []).filter((n) => !n.map && n.type !== 'map').map((n) => n.id));
          ids.add(CORE_ID);
          engineRef.current?.frameNodes(1.1, ids);
        },
        // A click on empty map closes an open menu, else steps back out of the item or the category.
        onBackgroundClick: () => { if (menuRef.current) { setMenu(null); return; } back(); },
        onLayoutChange: saveLayout,
        onFrame: () => {
          const id = hoverRef.current;
          const card = cardRef.current;
          if (!card) return;
          const pos = id ? engineRef.current?.screenOf(id) : null;
          if (!pos) { card.style.opacity = '0'; return; }
          const w = card.offsetWidth; const h = card.offsetHeight;
          const W = host.clientWidth;
          let x = pos.x + pos.r + 14;
          if (x + w > W - 12) x = pos.x - pos.r - 14 - w;
          const y = Math.max(12, Math.min(host.clientHeight - h - 12, pos.y - h / 2));
          card.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
          card.style.opacity = '1';
        },
      }, { reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches, coarse: isCoarsePointer() });
    } catch {
      setFailed(true);
      return;
    }
    engineRef.current = engine;
    engine.setTheme(useStore.getState().theme);
    // Where the user left the map comes back before the first layout (docs/ARCHITECTURE.md "/api/layout").
    api.layout().then((saved) => { if (syncRef.current?.loaded(saved) !== false) engine.restoreLayout(saved); }).catch(() => undefined).finally(() => setLayoutReady(true));
    // Dev builds expose the engine so browser tests can find node positions (never in production bundles).
    if (import.meta.env.DEV) Object.assign(window, { __synapseGraph: engine });
    return () => { engine.dispose(); engineRef.current = null; };
  }, [saveLayout, remember, back]);

  useEffect(() => { engineRef.current?.setPaused(!active); }, [active]);
  useEffect(() => {
    if (!active) { awayRef.current = true; return; }
    if (!awayRef.current || !fittedRef.current) return;
    awayRef.current = false;
    // Back on the map page: a frame later, so the engine runs again before the ignition starts.
    const id = setTimeout(() => engineRef.current?.playIntro({ camera: true }), 40);
    return () => clearTimeout(id);
  }, [active]);
  useEffect(() => { engineRef.current?.setDims(mode3d ? 3 : 2); }, [mode3d]);
  // The toolbar's names switch and spread tool (UI-DESIGN "Mind map").
  const mapNames = useStore((s) => s.mapNames);
  const spreadTool = useStore((s) => s.spreadTool);
  useEffect(() => { engineRef.current?.setNames(mapNames); }, [mapNames]);
  const theme = useStore((s) => s.theme);
  useEffect(() => { engineRef.current?.setTheme(theme); }, [theme]);
  useEffect(() => { engineRef.current?.setSpread(active ? spreadTool : null); }, [spreadTool, active]);

  // The place panel covers the start side: the camera centres in what is left.
  const panelOpen = active && !compact && Boolean(selectedId || placeGroup);
  useEffect(() => {
    const inset = panelOpen ? PLACE_W + 28 : 0;
    engineRef.current?.setViewInsets(locale === 'fa' ? 0 : inset, locale === 'fa' ? inset : 0);
  }, [panelOpen, locale]);

  // ---- time-lapse
  const createdDates = useMemo(() => (graph?.nodes ?? []).map((n) => n.created).filter((d): d is string => Boolean(d)).sort(), [graph]);
  const cutoffDate = useMemo(() => {
    if (timelapse.cutoff >= 1 || !createdDates.length) return null;
    const idx = Math.max(0, Math.min(createdDates.length - 1, Math.floor(timelapse.cutoff * (createdDates.length - 1))));
    return createdDates[idx] ?? null;
  }, [timelapse.cutoff, createdDates]);
  useEffect(() => {
    if (!timelapse.playing) return;
    const id = setInterval(() => {
      const cur = useStore.getState().timelapse.cutoff;
      if (cur >= 1) setTimelapse({ playing: false, cutoff: 1 }); else setTimelapse({ cutoff: Math.min(1, cur + 0.015) });
    }, 110);
    return () => clearInterval(id);
  }, [timelapse.playing, setTimelapse]);

  // ---- visible data (filters hide; focus, search and the place panel only dim)
  const showTags = settings?.graph.showTags ?? false;
  const visible = useMemo(() => {
    if (!graph) return { nodes: [] as UiGraphNode[], edges: [] as UiGraphEdge[] };
    const today = todayStr();
    const showDone = filters.showDone && (settings?.graph.showDone ?? true);
    // A map node is the centre of its island; a hidden map takes its centre and its regions along.
    let nodes: UiGraphNode[] = graph.nodes.filter((n) =>
      (n.type !== 'map' || !filters.hiddenMaps.has(n.id)) &&
      (!n.map || !filters.hiddenMaps.has(n.map)) &&
      !filters.hiddenTypes.has(n.ghost ? 'ghost' : n.type) &&
      // A retired item shows in the archive corner while the archive is shown; other finished work follows Done.
      (isRetired(n, today) ? filters.showArchived && n.type !== 'area' && n.type !== 'map' : showDone || !DONE.has(n.status)) &&
      (!filters.tag || n.tags.includes(filters.tag)) &&
      (!cutoffDate || n.ghost || (n.created ?? '') <= cutoffDate));
    let ids = new Set(nodes.map((n) => n.id));
    let edges: UiGraphEdge[] = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    if (filters.orphansOnly) {
      const linked = new Set<string>();
      for (const e of edges) { linked.add(e.source); linked.add(e.target); }
      nodes = nodes.filter((n) => !linked.has(n.id));
      ids = new Set(nodes.map((n) => n.id));
      edges = [];
    }
    const structured = withStructure(nodes, edges, graph.maps, t('type.core'), t('maps.mindSummary'));
    return showTags ? withTagNodes(structured.nodes, structured.edges) : structured;
  }, [graph, filters.hiddenTypes, filters.showDone, filters.showArchived, filters.tag, filters.orphansOnly, filters.hiddenMaps, cutoffDate, settings, showTags, t]);

  // A colour being picked (UI-DESIGN "Colour") is drawn at once, before the vault has it.
  const colorDraft = useStore((s) => s.colorDraft);
  const model = useMemo(() => buildGraphModel(visible.nodes, visible.edges, withColorDraft(graph?.categories ?? [], colorDraft), {
    inbox: t('group.inbox'), journal: t('group.journal'), unsorted: t('group.unsorted'), archive: t('group.archive'),
    count: (n) => t('item.count').replace('{n}', fmtNum(n, locale)),
    connected: t('maps.on'), apart: t('maps.off'),
  }, withColorDraft(graph?.maps ?? [], colorDraft)), [visible, graph?.categories, graph?.maps, colorDraft, t, locale]);

  const shapeRef = useRef<{ engine: LivingGraph | null; shape: string }>({ engine: null, shape: '' });
  useEffect(() => {
    const engine = engineRef.current;
    // Not before the vault's data is here: a map laid out without its items would be saved over the user's own.
    if (!engine || !layoutReady || !graph) return;
    modelRef.current = model;
    // Only colours changed: recolour in place, so a colour can be dragged across the spectrum smoothly.
    const shape = modelShape(model);
    if (shapeRef.current.engine === engine && shapeRef.current.shape === shape) engine.setColors(model.nodes, model.groups, model.zones);
    else { shapeRef.current = { engine, shape }; engine.setData(model.nodes, model.links, model.groups, model.zones); }
    // Nothing is saved here: a refresh that moves the map saves once it settles (`onLayoutChange`), one that changes
    // nothing saves nothing — an idle copy of the app never writes its picture of the map over a newer one.
    if (!fittedRef.current && model.nodes.length) { fittedRef.current = true; engine.introFit(2.2); engine.playIntro(); }
  }, [model, layoutReady, graph]);

  // ---- view state
  const matchIds = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    if (!q) return null;
    return new Set(visible.nodes.filter((n) => n.title.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q) || n.tags.some((tg) => tg.includes(q))).map((n) => n.id));
  }, [filters.query, visible.nodes]);
  const focusIds = useMemo(() => (focusId && focusDepth > 0 ? neighbourhood(focusId, focusDepth, visible.edges) : null), [focusId, focusDepth, visible.edges]);
  const hl = highlight && highlight.until > now ? highlight : null;
  useEffect(() => {
    if (!highlight) return;
    const ms = highlight.until - Date.now();
    const id = setTimeout(() => setNow(Date.now()), Math.max(0, ms) + 50);
    return () => clearTimeout(id);
  }, [highlight]);

  useEffect(() => {
    engineRef.current?.setView({
      selectedId, focusId, focusIds, matchIds,
      created: hl?.created ?? new Set(), updated: hl?.updated ?? new Set(),
      isolateGroup,
    });
  }, [selectedId, focusId, focusIds, matchIds, hl, isolateGroup]);

  // Opening a category or an item from anywhere (a chip, a card, a search hit) marks where to come back to.
  useEffect(() => {
    if (!active) return;
    if (placeGroup) remember('place'); else navRef.current.place = undefined;
  }, [placeGroup, active, remember]);
  useEffect(() => {
    if (!active) return;
    if (selectedId) remember('item'); else navRef.current.item = undefined;
  }, [selectedId, active, remember]);

  // An item picked outside the canvas (a card in the place panel, a search hit): bring it into view.
  useEffect(() => {
    if (!active || !selectedId) return;
    if (canvasSelect.current === selectedId) { canvasSelect.current = null; return; }
    const id = setTimeout(() => engineRef.current?.flyToNode(selectedId, 'reveal'), 60);
    return () => clearTimeout(id);
  }, [selectedId, active]);

  // New items from a brain run: once they are on the map, glide over to them.
  useEffect(() => {
    if (!hl || !active) return;
    const fresh = [...hl.created].filter((id) => !flownRef.current.has(id) && visible.nodes.some((n) => n.id === id));
    if (!fresh.length) return;
    for (const id of fresh) flownRef.current.add(id);
    // A ref'd timer: later re-renders (a second graph refresh) must not cancel the flight.
    if (flyTimer.current) clearTimeout(flyTimer.current);
    flyTimer.current = setTimeout(() => {
      flyTimer.current = null;
      const engine = engineRef.current;
      if (!engine) return;
      if (fresh.length === 1) engine.flyToNode(fresh[0]!, true); else engine.frameNodes(1.4, new Set(fresh));
    }, 900);
  }, [hl, visible.nodes, active]);

  // The brain at work: the core spins up while a run is live, and every node the brain touches gets its signal.
  const working = useStore((s) => s.run !== null && (s.run.status === 'running' || s.run.status === 'queued'));
  useEffect(() => { engineRef.current?.setWorking(working); }, [working]);
  useEffect(() => brainActivity.subscribe((ids, kind) => engineRef.current?.signal(ids, kind)), []);

  useEffect(() => {
    if (!flyRequest) return;
    const engine = engineRef.current;
    if (!engine) return;
    // Wait a frame when the map was hidden a moment ago, so the camera starts from its real size.
    const id = setTimeout(() => {
      if (flyRequest.group) engine.flyToGroup(flyRequest.group);
      else if (flyRequest.map) {
        const ids = new Set((useStore.getState().graph?.nodes ?? []).filter((n) => n.map === flyRequest.map).map((n) => n.id));
        if (ids.size) engine.frameNodes(1.2, ids);
      } else if (flyRequest.ids.length === 1) engine.flyToNode(flyRequest.ids[0]!, 'reveal');
      else if (flyRequest.ids.length) engine.frameNodes(1.2, new Set(flyRequest.ids));
    }, 80);
    return () => clearTimeout(id);
  }, [flyRequest]);

  // ---- keyboard (map page only, never while typing)
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      // A menu or popover that just closed on Escape has claimed the key (radix prevents its default).
      if (e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const engine = engineRef.current;
      if (!engine) return;
      const s = useStore.getState();
      const step = 60;
      if (e.key === 'Escape') {
        if (s.spreadTool) s.setSpreadTool(null);
        else if (menu) setMenu(null);
        else if (s.filters.query) s.setFilters({ query: '' });
        else back();
      } else if (e.key === 'ArrowLeft') engine.panBy(step, 0);
      else if (e.key === 'ArrowRight') engine.panBy(-step, 0);
      else if (e.key === 'ArrowUp') engine.panBy(0, step);
      else if (e.key === 'ArrowDown') engine.panBy(0, -step);
      else if (e.key === '+' || e.key === '=') engine.zoomBy(0.8);
      else if (e.key === '-') engine.zoomBy(1.25);
      else if (e.key === 'f' || e.key === 'F') engine.fit();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, menu, back]);

  const onFit = useCallback(() => engineRef.current?.fit(), []);
  const onZoom = useCallback((k: number) => engineRef.current?.zoomBy(k), []);
  const onRearrange = useCallback(() => {
    engineRef.current?.rearrange();
    // Saved like any other change, so every open copy takes the new arrangement and none puts the old one back.
    saveLayout();
    useStore.getState().setToast(t('graph.rearranged'));
  }, [t, saveLayout]);
  const onPickGroup = useCallback((g: string | null) => {
    if (!g) { closePlace(); return; }
    remember('place');
    navRef.current.item = undefined;
    useStore.getState().openPlace(g);
    engineRef.current?.flyToGroup(g);
  }, [closePlace, remember]);
  const onPickResult = useCallback((id: string) => {
    remember('item');
    canvasSelect.current = id;
    useStore.getState().select(id);
    engineRef.current?.flyToNode(id, 'reveal');
  }, [remember]);

  const hoverNode = hover ? visible.nodes.find((n) => n.id === hover) : undefined;
  const hoverGroup = hover ? modelRef.current?.groupOf.get(hover) : undefined;
  const hoverColor = hoverGroup ? modelRef.current?.groupColor.get(hoverGroup) : undefined;
  const hoverCategory = hoverNode?.category ? graph?.categories.find((c) => c.id === hoverNode.category) : undefined;
  const rtl = locale === 'fa';

  return (
    <div className="graph-stage absolute inset-0 overflow-hidden" onClick={() => setMenu(null)}>
      <div ref={hostRef} dir="ltr" className="graph-host absolute inset-0" />
      <div className="graph-vignette pointer-events-none absolute inset-0" />
      {failed && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-muted">{t('graph.noWebgl')}</div>}
      {graph && graph.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="max-w-sm text-center">
            <div className="font-display text-lg font-bold text-text">{t('graph.empty')}</div>
            <div className="mt-1 text-sm text-muted">{t('graph.emptyHint')}</div>
          </div>
        </div>
      )}

      <div className={`graph-card pointer-events-none absolute top-0 z-20 w-64 ${hoverNode && !menu ? '' : 'hidden'}`} ref={cardRef} style={{ left: 0, opacity: 0 }}>
        {hoverNode && (
          <div className="glass-strong p-3" style={hoverColor ? { borderColor: rgbCss(hoverColor, 0.45) } : undefined}>
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <TypeIcon type={hoverNode.ghost ? 'ghost' : hoverNode.type} size={13} color={hoverColor ? rgbCss(hoverColor) : undefined} />
              <span>{t(`type.${hoverNode.ghost ? 'ghost' : hoverNode.type}` as TKey)}</span>
              {hoverCategory && hoverNode.type !== 'area' && (
                <span className="ms-auto flex min-w-0 items-center gap-1">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: hoverColor ? rgbCss(hoverColor) : undefined }} />
                  <span className="truncate utext" dir="auto">{hoverCategory.title}</span>
                </span>
              )}
            </div>
            <div className="mt-1.5 text-sm font-semibold leading-snug text-text"><bdi>{hoverNode.title}</bdi></div>
            {hoverNode.summary && hoverNode.summary !== hoverNode.title && <div className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted utext" dir="auto">{hoverNode.summary}</div>}
            {hoverNode.due && <div className="mt-1.5 text-[11px] text-warn">{t('panel.due')}: {fmtDate(hoverNode.due, locale)}</div>}
            {hoverNode.type === 'area' && !mode3d && <div className="mt-1.5 text-[11px] text-accent">{t('graph.dragHint')}</div>}
          </div>
        )}
      </div>

      {active && (
        <div className="graph-chrome pointer-events-none absolute inset-0">
          <GraphSearch nodes={visible.nodes.filter((n) => n.type !== 'core')} groupColor={model.groupColor} groupOf={model.groupOf} onPick={onPickResult} compact={compact} />
          <CategoryLegend model={model} categories={graph?.categories ?? []} active={placeGroup} onPick={onPickGroup} compact={compact} />
          <GraphToolbar onFit={onFit} onZoom={onZoom} onRearrange={onRearrange} cutoffDate={cutoffDate} compact={compact} />
          {spreadTool && (
            <div className="pointer-events-none absolute inset-x-0 mx-auto flex w-fit justify-center px-3" style={{ top: compact ? 112 : 72 }}>
              <div className="spread-hint pointer-events-auto">
                {spreadTool === 'gather' ? <Shrink size={14} className="shrink-0 text-accent" /> : <Expand size={14} className="shrink-0 text-accent" />}
                <span>{spreadTool === 'gather' ? t(isCoarsePointer() ? 'graph.gatherHintTouch' : 'graph.gatherHint') : t(isCoarsePointer() ? 'graph.spreadHintTouch' : 'graph.spreadHint')}</span>
                <button onClick={() => useStore.getState().setSpreadTool(null)} className="icon-btn small" aria-label={t(spreadTool === 'gather' ? 'graph.gatherStop' : 'graph.spreadStop')}><X size={13} /></button>
              </div>
            </div>
          )}
          <MapChat compact={compact} dock={compact ? { insetInline: 12, bottom: 78, height: '46vh' } : { insetInlineStart: panelOpen ? PLACE_W + 32 : 16, insetInlineEnd: 72, bottom: 88 }} />
          <div className="tell-host pointer-events-none absolute bottom-5" style={compact ? { insetInline: 12, bottom: 12 } : { insetInlineStart: panelOpen ? PLACE_W + 32 : 16, insetInlineEnd: 72 }}>
            <TellBar />
          </div>
          {!compact && (
            <AnimatePresence>
              {panelOpen && (
                <motion.aside key="place" className="place-panel pointer-events-auto" style={{ width: PLACE_W }}
                  initial={{ opacity: 0, x: rtl ? 28 : -28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: rtl ? 20 : -20 }} transition={{ type: 'spring', stiffness: 360, damping: 34 }}>
                  {selectedId ? <NodePanel onBack={placeGroup ? back : undefined} onClose={back} /> : placeGroup ? <CategoryCard group={placeGroup} onClose={closePlace} /> : null}
                </motion.aside>
              )}
            </AnimatePresence>
          )}
          {compact && placeGroup && !selectedId && (
            <div className="item-sheet safe-top pointer-events-auto fixed inset-0 z-40 flex flex-col"><CategoryCard group={placeGroup} onClose={closePlace} /></div>
          )}
        </div>
      )}
      {menu && (
        <NodeMenu
          menu={menu}
          node={visible.nodes.find((n) => n.id === menu.id) ?? null}
          pinned={engineRef.current?.isPinned(menu.id) ?? false}
          onClose={() => setMenu(null)}
          onRelease={() => { engineRef.current?.unpin(menu.id); saveLayout(); }}
          onFocus={() => { useStore.getState().setFocus(menu.id, Math.max(1, useStore.getState().focusDepth)); engineRef.current?.flyToNode(menu.id, true); }}
          onShowGroup={() => { const g = modelRef.current?.groupOf.get(menu.id); if (g) onPickGroup(g); }}
          onLink={(title) => { void startRun({ prompt: `/link ${title}`, display: `/link ${title}`, focusId: menu.id }); }}
        />
      )}
    </div>
  );
}

const tag = (id: string): string => id.slice(4);
