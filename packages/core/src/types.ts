export const NODE_TYPES = ['note', 'idea', 'task', 'project', 'goal', 'habit', 'area', 'person', 'event', 'journal', 'resource', 'inbox', 'map'] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const TYPE_DIRS: Record<NodeType, string> = {
  note: 'notes',
  idea: 'ideas',
  task: 'tasks',
  project: 'projects',
  goal: 'goals',
  habit: 'habits',
  event: 'events',
  area: 'areas',
  person: 'people',
  journal: 'journal',
  resource: 'resources',
  inbox: 'inbox',
  map: 'maps',
};

/** The mind map itself — every category without a `map` — as it is named in `connects` and in `graph.json` (VAULT-SPEC "Maps"). */
export const MIND_MAP = 'mind';

export const DIR_TYPES: Record<string, NodeType> = Object.fromEntries(
  (Object.entries(TYPE_DIRS) as [NodeType, string][]).map(([t, d]) => [d, t]),
) as Record<string, NodeType>;

export const STATUS_BY_TYPE: Record<NodeType, readonly string[]> = {
  note: ['active', 'archived'],
  idea: ['active', 'archived'],
  resource: ['active', 'doing', 'done', 'archived'],
  area: ['active', 'archived'],
  person: ['active', 'archived'],
  task: ['todo', 'doing', 'done', 'dropped'],
  project: ['active', 'paused', 'done', 'archived'],
  goal: ['active', 'achieved', 'paused', 'dropped'],
  habit: ['active', 'paused', 'archived'],
  event: ['active', 'archived'],
  journal: ['active'],
  inbox: ['new', 'filed'],
  map: ['active', 'archived'],
};

export const DEFAULT_STATUS: Record<NodeType, string> = {
  note: 'active',
  idea: 'active',
  task: 'todo',
  project: 'active',
  goal: 'active',
  habit: 'active',
  event: 'active',
  area: 'active',
  person: 'active',
  journal: 'active',
  resource: 'active',
  inbox: 'new',
  map: 'active',
};

/** Finished work: it stays as history (faded on the map, listed under "Done"); the app records `completed`. */
export const DONE_STATUSES: ReadonlySet<string> = new Set(['done', 'achieved']);
/** Out of sight: hidden from the map by default and listed in the index's trailing "Archived" section. */
export const ARCHIVED_STATUSES: ReadonlySet<string> = new Set(['archived', 'dropped']);
export const CLOSED_STATUSES: ReadonlySet<string> = new Set([...DONE_STATUSES, ...ARCHIVED_STATUSES]);

export const SOURCES = ['capture', 'brain', 'manual', 'import'] as const;
export type NodeSource = (typeof SOURCES)[number];

export const SUMMARY_MAX = 160;

/** Parsed, normalized frontmatter. List fields are always arrays (empty when absent). */
export interface NodeFrontmatter {
  id: string;
  type: NodeType;
  title: string;
  summary: string;
  status: string;
  tags: string[];
  aliases: string[];
  links: string[];
  people: string[];
  area?: string;
  project?: string;
  /** An area's map (`"[[Title]]"`): the space it belongs to beside the mind map (VAULT-SPEC "Maps"); absent = the mind map. */
  map?: string;
  /** A map's connections: `"[[Title]]"` of other maps and `mind` for the mind map; always an array (empty when absent). */
  connects: string[];
  due?: string;
  scheduled?: string;
  /** `YYYY-MM-DD` the item was finished (`done` / `achieved`); kept in step with `status` by `withCompleted`. */
  completed?: string;
  priority?: number;
  date?: string;
  relation?: string;
  url?: string;
  created: string;
  updated: string;
  source?: NodeSource;
  /** Unknown keys, preserved verbatim on write. */
  extra: Record<string, unknown>;
}

export interface VaultNode {
  fm: NodeFrontmatter;
  body: string;
  /** Path relative to the vault root, POSIX separators, e.g. `nodes/tasks/x.md`. */
  path: string;
  mtimeMs: number | null;
}

export interface ParseProblem {
  path: string;
  code: string;
  message: string;
  severity: 'error' | 'warn';
}

export type EdgeKind = 'link' | 'belongs_to' | 'mentions';

export interface GraphNode {
  id: string;
  type: NodeType | 'ghost';
  title: string;
  summary: string;
  status: string;
  tags: string[];
  path: string | null;
  created: string | null;
  updated: string | null;
  due: string | null;
  /** When a done / achieved item was finished (`YYYY-MM-DD`); null while open. */
  completed: string | null;
  /** A task's priority, 1 (highest) to 4 (VAULT-SPEC "Fields"; set by the user or the full review); null when none. */
  priority: number | null;
  area: string | null;
  project: string | null;
  inDegree: number;
  outDegree: number;
  ghost: boolean;
  /** Id of the area node this node belongs to (spec: VAULT-SPEC.md "Categories"); null for inbox, journal and unsorted nodes. */
  category: string | null;
  /** How `category` was decided: the node is the area, its own `area`, its project's area, or the majority of its links. */
  categorySource: CategorySource | null;
  /** Id of the map the node's category belongs to (VAULT-SPEC "Maps"); null on the mind map, for map nodes and uncategorized nodes. */
  map: string | null;
  /** Kind-specific fields the UI shows on cards (VAULT-SPEC "Kinds"): validated, with derived values filled in. */
  facets: NodeFacets;
}

export type FacetValue = string | number | string[];
export type NodeFacets = Record<string, FacetValue>;

export type CategorySource = 'self' | 'area' | 'project' | 'links';

/** One category = one `area` node, with what the UI needs to place and colour its region. */
export interface CategoryInfo {
  id: string;
  title: string;
  summary: string;
  status: string;
  /** Optional `color` from the area's frontmatter (`#rgb` / `#rrggbb`); the UI derives a hue when it is absent. */
  color: string | null;
  /** Stable position by creation time (then id): the UI's hue sequence and region placement follow it. */
  order: number;
  /** Nodes whose `category` is this area, the area itself included. */
  size: number;
  /** Id of the map this category belongs to; null on the mind map. */
  map: string | null;
}

/** One map = one `map` node (VAULT-SPEC "Maps"): a space of categories beside the mind map, connected to other maps or not. */
export interface MapInfo {
  id: string;
  title: string;
  summary: string;
  status: string;
  /** `character` for the one map the brain builds about the owner; null for a custom map. */
  role: 'character' | null;
  /** The mark at the centre of its island (`MAP_SYMBOLS`): its own `symbol`, else `person` for the character map, `star` otherwise. */
  symbol: string;
  /** Optional `color` from the map's frontmatter (`#rgb` / `#rrggbb`): the island's base colour; null = the UI's own sequence. */
  color: string | null;
  /**
   * Maps this one is connected to right now: other map ids and `mind` for the mind map (either side listing the other
   * connects both). Empty while the map is switched off, and a switched-off map counts for no other map.
   */
  connects: string[];
  /** Switched off by the user (`apart: true`): cut off from the mind map and every other map, its connections kept. */
  apart: boolean;
  /** Every connection as written on either side, paused ones included: what `connects` holds once both sides are on. */
  kept: string[];
  /** Stable position by creation time (then id). */
  order: number;
  /** Categories in this map. */
  areas: number;
  /** Nodes whose category is in this map, the areas included. */
  size: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
}

export interface GraphStats {
  nodes: number;
  edges: number;
  byType: Record<string, number>;
  unresolved: number;
  orphans: number;
}

export interface GraphData {
  generatedAt: string;
  stats: GraphStats;
  nodes: GraphNode[];
  edges: GraphEdge[];
  categories: CategoryInfo[];
  maps: MapInfo[];
}

export interface IndexFiles {
  /** Content of `index/INDEX.md`. */
  router: string;
  /** Content of `index/by-type/<type>.md`, keyed by type. */
  byType: Partial<Record<NodeType, string>>;
  /** Content of `index/by-area/<file>`, keyed by file name: one category's items, one line each (VAULT-SPEC "Index"). */
  byArea: Record<string, string>;
  /** Content of `index/archive.md`: the archived and dropped nodes, which no other index file lists. */
  archive: string;
}
