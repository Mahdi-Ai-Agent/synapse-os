import { useEffect, useMemo, useRef } from 'react';
import { LivingGraph } from '../graph/engine';
import { buildGraphModel } from '../graph/model';
import { useT } from '../i18n';
import { fmtNum, todayStr } from '../lib/format';
import type { UiGraphNode } from '../lib/types';
import { inArchiveCorner } from '../kinds/meta';
import { useStore } from '../state/store';

/**
 * One place as its own small mind map (UI-DESIGN "Places" → Map): only that category's or island's items, drawn by the
 * same renderer as the mind map, in the current theme. It saves no layout (no `onLayoutChange`), so the mind map's own
 * arrangement is never touched; a click opens the item beside the page.
 */
export function PlaceGraph({ items, hubs }: { items: readonly UiGraphNode[]; hubs: readonly string[] }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const graph = useStore((s) => s.graph);
  const theme = useStore((s) => s.theme);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<LivingGraph | null>(null);
  const today = todayStr();

  const model = useMemo(() => {
    if (!graph) return null;
    const keep = new Set(hubs);
    const nodes = graph.nodes.filter((n) => keep.has(n.id) || items.some((i) => i.id === n.id && !inArchiveCorner(i, today)));
    const ids = new Set(nodes.map((n) => n.id));
    const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    const cats = graph.categories.filter((c) => ids.has(c.id));
    const maps = graph.maps.filter((m) => ids.has(m.id));
    return buildGraphModel(nodes, edges, cats, {
      inbox: t('group.inbox'), journal: t('group.journal'), unsorted: t('group.unsorted'), archive: t('group.archive'),
      count: (n) => t('item.count').replace('{n}', fmtNum(n, locale)), connected: t('maps.on'), apart: t('maps.off'),
    }, maps, today);
  }, [graph, items, hubs, t, locale, today]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: LivingGraph;
    try {
      engine = new LivingGraph(host, { onClick: (id) => { if (!id.startsWith('tag:')) useStore.getState().select(id); } }, {
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches, coarse: window.matchMedia('(pointer: coarse)').matches,
      });
    } catch { return; } // no WebGL: the page's other tabs still work
    engine.setTheme(useStore.getState().theme);
    engineRef.current = engine;
    return () => { engineRef.current = null; engine.dispose(); };
  }, []);
  useEffect(() => { engineRef.current?.setTheme(theme); }, [theme]);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !model) return;
    engine.setData(model.nodes, model.links, model.groups, model.zones);
    if (model.nodes.length) { engine.introFit(1.6); engine.playIntro(); }
  }, [model]);

  return <div ref={hostRef} className="place-graph" dir="ltr" />;
}
