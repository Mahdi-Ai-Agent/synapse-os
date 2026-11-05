import { assignCategories, buildCategories, categoryOrder } from './categories';
import { facetsOf } from './facets';
import { buildMaps } from './maps';
import { relationTitles } from './node';
import type { LinkIndex } from './links';
import type { GraphData, GraphEdge, GraphNode, VaultNode } from './types';

export function buildGraph(nodes: VaultNode[], links: LinkIndex, generatedAt: string): GraphData {
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const edges: GraphEdge[] = [];

  for (const [sourceId, list] of links.outgoing) {
    for (const l of list) {
      edges.push({ id: `${sourceId}->${l.target}:${l.kind}`, source: sourceId, target: l.target, kind: l.kind });
      outDegree.set(sourceId, (outDegree.get(sourceId) ?? 0) + 1);
      inDegree.set(l.target, (inDegree.get(l.target) ?? 0) + 1);
    }
  }

  const graphNodes: GraphNode[] = nodes.map((n) => {
    const rel = relationTitles(n.fm);
    return {
      id: n.fm.id,
      type: n.fm.type,
      title: n.fm.title,
      summary: n.fm.summary,
      status: n.fm.status,
      tags: n.fm.tags,
      path: n.path,
      created: n.fm.created || null,
      updated: n.fm.updated || null,
      due: n.fm.due ?? null,
      completed: n.fm.completed ?? null,
      priority: n.fm.priority ?? null,
      area: rel.area ?? null,
      project: rel.project ?? null,
      inDegree: inDegree.get(n.fm.id) ?? 0,
      outDegree: outDegree.get(n.fm.id) ?? 0,
      ghost: false,
      category: null,
      categorySource: null,
      map: null,
      facets: facetsOf(n.fm),
    };
  });

  for (const [id, g] of links.unresolved) {
    graphNodes.push({
      id,
      type: 'ghost',
      title: g.text,
      summary: '',
      status: 'ghost',
      tags: [],
      path: null,
      created: null,
      updated: null,
      due: null,
      completed: null,
      priority: null,
      area: null,
      project: null,
      inDegree: inDegree.get(id) ?? 0,
      outDegree: 0,
      ghost: true,
      category: null,
      categorySource: null,
      map: null,
      facets: {},
    });
  }

  const areas = nodes.filter((n) => n.fm.type === 'area');
  const assignment = assignCategories(graphNodes, edges, categoryOrder(areas));
  for (const n of graphNodes) {
    const a = assignment.get(n.id);
    if (a) { n.category = a.category; n.categorySource = a.categorySource; }
  }
  // A node is in the map its category belongs to (VAULT-SPEC "Maps"); the mind map is `null`.
  const categories = buildCategories(areas, assignment);
  const { maps, mapOfArea } = buildMaps(nodes.filter((n) => n.fm.type === 'map'), areas, categories, graphNodes);
  for (const c of categories) c.map = mapOfArea.get(c.id) ?? null;
  for (const n of graphNodes) n.map = n.category ? mapOfArea.get(n.category) ?? null : null;

  const byType: Record<string, number> = {};
  for (const n of nodes) byType[n.fm.type] = (byType[n.fm.type] ?? 0) + 1;
  const orphans = graphNodes.filter((n) => !n.ghost && n.inDegree === 0 && n.outDegree === 0).length;

  return {
    generatedAt,
    stats: { nodes: nodes.length, edges: edges.length, byType, unresolved: links.unresolved.size, orphans },
    nodes: graphNodes,
    edges,
    categories,
    maps,
  };
}
