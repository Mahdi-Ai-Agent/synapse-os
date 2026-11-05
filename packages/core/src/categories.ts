import type { CategoryInfo, CategorySource, GraphEdge, GraphNode, VaultNode } from './types';

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A frontmatter `color` as lower-case `#rgb` / `#rrggbb`; null when it is absent or not a hex colour. */
export function hexColor(raw: unknown): string | null {
  return typeof raw === 'string' && HEX_COLOR.test(raw.trim()) ? raw.trim().toLowerCase() : null;
}

/** Edge weight when a node's category is inferred from its neighbours: a structural relation counts more than a mention. */
const EDGE_WEIGHT: Record<GraphEdge['kind'], number> = { belongs_to: 3, link: 1, mentions: 1 };

/** Types that never join a category region: inbox and journal form their own groups in the UI, a map is a space of regions (VAULT-SPEC.md "Categories", "Maps"). */
const UNCATEGORIZED_TYPES: ReadonlySet<string> = new Set(['inbox', 'journal', 'map']);

const MAX_PROPAGATION_ROUNDS = 6;

export interface CategoryAssignment {
  category: string | null;
  categorySource: CategorySource | null;
}

/**
 * Category of every graph node, decided in this order: an area is its own category; a node with \`area\` takes that
 * area; a node with \`project\` takes the project's category; any other node (ghosts included) takes the category with
 * the largest edge weight among its neighbours, repeated until nothing changes so chains resolve. Inbox and journal
 * nodes stay uncategorized. Ties go to the older category (lower \`order\`), so the result is deterministic.
 */
export function assignCategories(nodes: GraphNode[], edges: GraphEdge[], order: ReadonlyMap<string, number>): Map<string, CategoryAssignment> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const isArea = (id: string): boolean => byId.get(id)?.type === 'area';
  const out = new Map<string, CategoryAssignment>();
  for (const n of nodes) out.set(n.id, { category: null, categorySource: null });

  const ownArea = new Map<string, string>();
  const ownProject = new Map<string, string>();
  const neighbours = new Map<string, Array<{ id: string; weight: number }>>();
  const addNeighbour = (a: string, b: string, weight: number): void => {
    const list = neighbours.get(a);
    if (list) list.push({ id: b, weight }); else neighbours.set(a, [{ id: b, weight }]);
  };
  for (const e of edges) {
    if (e.kind === 'belongs_to') {
      const target = byId.get(e.target);
      if (target?.type === 'area' && !ownArea.has(e.source)) ownArea.set(e.source, e.target);
      if (target?.type === 'project' && !ownProject.has(e.source)) ownProject.set(e.source, e.target);
    }
    addNeighbour(e.source, e.target, EDGE_WEIGHT[e.kind]);
    addNeighbour(e.target, e.source, EDGE_WEIGHT[e.kind]);
  }

  const ordered = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const n of ordered) {
    if (n.type === 'area') out.set(n.id, { category: n.id, categorySource: 'self' });
    else if (!UNCATEGORIZED_TYPES.has(n.type)) {
      const area = ownArea.get(n.id);
      if (area) out.set(n.id, { category: area, categorySource: 'area' });
    }
  }

  for (let round = 0; round < MAX_PROPAGATION_ROUNDS; round++) {
    let changed = false;
    for (const n of ordered) {
      if (UNCATEGORIZED_TYPES.has(n.type) || out.get(n.id)?.category) continue;
      const project = ownProject.get(n.id);
      const viaProject = project ? out.get(project)?.category : null;
      if (viaProject) { out.set(n.id, { category: viaProject, categorySource: 'project' }); changed = true; continue; }
      const votes = new Map<string, number>();
      for (const nb of neighbours.get(n.id) ?? []) {
        const c = isArea(nb.id) ? nb.id : out.get(nb.id)?.category;
        if (c) votes.set(c, (votes.get(c) ?? 0) + nb.weight);
      }
      let best: string | null = null;
      let bestVotes = 0;
      for (const [c, v] of votes) {
        const better = v > bestVotes || (v === bestVotes && best !== null && (order.get(c) ?? Infinity) < (order.get(best) ?? Infinity));
        if (better) { best = c; bestVotes = v; }
      }
      if (best) { out.set(n.id, { category: best, categorySource: 'links' }); changed = true; }
    }
    if (!changed) break;
  }
  return out;
}

/** Areas in creation order (then id: ULIDs sort by creation time within a second), with their frontmatter colour and member counts. */
export function buildCategories(areas: VaultNode[], assignment: ReadonlyMap<string, CategoryAssignment>): CategoryInfo[] {
  const sorted = [...areas].sort((a, b) => (a.fm.created || '').localeCompare(b.fm.created || '') || (a.fm.id < b.fm.id ? -1 : a.fm.id > b.fm.id ? 1 : 0));
  const size = new Map<string, number>();
  for (const a of assignment.values()) if (a.category) size.set(a.category, (size.get(a.category) ?? 0) + 1);
  return sorted.map((a, order) => {
    return { id: a.fm.id, title: a.fm.title, summary: a.fm.summary, status: a.fm.status, color: hexColor(a.fm.extra['color']), order, size: size.get(a.fm.id) ?? 0, map: null };
  });
}

/** Creation-order index of every area, for deterministic tie-breaks before \`buildCategories\` runs. */
export function categoryOrder(areas: VaultNode[]): Map<string, number> {
  const sorted = [...areas].sort((a, b) => (a.fm.created || '').localeCompare(b.fm.created || '') || (a.fm.id < b.fm.id ? -1 : a.fm.id > b.fm.id ? 1 : 0));
  return new Map(sorted.map((a, i) => [a.fm.id, i]));
}
