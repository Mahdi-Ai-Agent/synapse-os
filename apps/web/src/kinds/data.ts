import type { GraphData, UiGraphNode } from '../lib/types';
import { useStore } from '../state/store';

export interface VaultIndex {
  byId: Map<string, UiGraphNode>;
  /** Event nodes that list a person in \`people\` (person id → events, newest first). */
  momentsOf: (personId: string) => UiGraphNode[];
  /** People listed on a node (event/task/… id → person nodes). */
  peopleOf: (id: string) => UiGraphNode[];
  /** Tasks whose \`project\` is this project's title. */
  tasksOf: (projectTitle: string) => UiGraphNode[];
  /** Nodes linked to or from a node, any kind. */
  linkedTo: (id: string) => UiGraphNode[];
}

const cache = new WeakMap<GraphData, VaultIndex>();
const EMPTY: GraphData = { generatedAt: '', stats: { nodes: 0, edges: 0, byType: {}, unresolved: 0, orphans: 0 }, nodes: [], edges: [], categories: [], maps: [] };

/** Lookups the kind cards and details share, computed once per graph for every card on screen. */
export function useVaultIndex(): VaultIndex {
  const graph = useStore((s) => s.graph) ?? EMPTY;
  let index = cache.get(graph);
  if (!index) { index = buildIndex(graph); cache.set(graph, index); }
  return index;
}

function buildIndex(graph: GraphData): VaultIndex {
  const nodes: UiGraphNode[] = graph.nodes;
  const byId = new Map<string, UiGraphNode>(nodes.map((n) => [n.id, n]));
  const people = new Map<string, string[]>();
  const moments = new Map<string, string[]>();
  const links = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    (links.get(e.source) ?? links.set(e.source, new Set()).get(e.source))!.add(e.target);
    (links.get(e.target) ?? links.set(e.target, new Set()).get(e.target))!.add(e.source);
    if (e.kind !== 'mentions') continue;
    (people.get(e.source) ?? people.set(e.source, []).get(e.source))!.push(e.target);
    if (byId.get(e.source)?.type === 'event') (moments.get(e.target) ?? moments.set(e.target, []).get(e.target))!.push(e.source);
  }
  const tasks = new Map<string, UiGraphNode[]>();
  for (const n of nodes) if (n.type === 'task' && n.project) (tasks.get(n.project) ?? tasks.set(n.project, []).get(n.project))!.push(n);
  const pick = (ids: Iterable<string> | undefined): UiGraphNode[] => [...(ids ?? [])].map((id) => byId.get(id)).filter((n): n is UiGraphNode => Boolean(n));
  const dateOf = (n: UiGraphNode): string => String(n.facets['date'] ?? n.created ?? '');
  return {
    byId,
    momentsOf: (id) => pick(moments.get(id)).sort((a, b) => dateOf(b).localeCompare(dateOf(a))),
    peopleOf: (id) => pick(people.get(id)),
    tasksOf: (title) => tasks.get(title) ?? [],
    linkedTo: (id) => pick(links.get(id)).filter((n) => !n.ghost),
  };
}
