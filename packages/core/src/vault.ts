import { todayLocal, nowIso } from './dates';
import { buildGraph } from './graph';
import { newId } from './ids';
import { buildIndexFiles } from './index-md';
import { buildLinkIndex, type LinkIndex } from './links';
import { healNode } from './node';
import { buildSearchIndex, type SearchIndex } from './search';
import type { GraphData, IndexFiles, ParseProblem, VaultNode } from './types';
import { readVaultNodes, writeNodeFile } from './vault-fs';

export interface LoadedVault {
  nodes: VaultNode[];
  problems: ParseProblem[];
  /** Relative paths of files rewritten because `id`/`created`/`updated` were missing. */
  healed: string[];
}

/** Reads all nodes; with `heal` (default true) fills missing ids/timestamps and writes those files back. */
export async function loadVault(
  root: string,
  opts: { heal?: boolean; newId?: () => string; now?: () => string } = {},
): Promise<LoadedVault> {
  const { nodes, problems } = await readVaultNodes(root);
  const healed: string[] = [];
  if (opts.heal ?? true) {
    const deps = { newId: opts.newId ?? newId, now: opts.now ?? nowIso };
    const broken = new Set(problems.filter((p) => p.code === 'yaml').map((p) => p.path));
    const recovered = new Set(problems.filter((p) => p.code === 'yaml-recovered').map((p) => p.path));
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n) continue;
      // Never rewrite a file whose frontmatter could not be parsed at all: healing would replace the
      // original YAML with derived defaults. Recovered files are normalized back to valid YAML.
      if (broken.has(n.path)) continue;
      const r = healNode(n, deps);
      if (r.changed || recovered.has(n.path)) {
        nodes[i] = r.node;
        await writeNodeFile(root, r.node);
        healed.push(r.node.path);
      }
    }
  }
  return { nodes, problems, healed };
}

export interface Derived {
  links: LinkIndex;
  graph: GraphData;
  index: IndexFiles;
  search: SearchIndex;
}

/** Everything the app derives from the node list, in one pass. */
export function buildDerived(nodes: VaultNode[], opts: { now?: string; today?: string } = {}): Derived {
  const now = opts.now ?? nowIso();
  const today = opts.today ?? todayLocal();
  const links = buildLinkIndex(nodes);
  const graph = buildGraph(nodes, links, now);
  // The category sub-indexes follow the graph's assignment, inferred memberships included (VAULT-SPEC "Categories").
  const categoryOf = new Map<string, string>();
  for (const n of graph.nodes) if (n.category && !n.ghost) categoryOf.set(n.id, n.category);
  return {
    links,
    graph,
    index: buildIndexFiles(nodes, links, { now, today, categoryOf }),
    search: buildSearchIndex(nodes),
  };
}
