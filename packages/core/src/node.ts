import { joinFrontmatter, splitFrontmatter } from './frontmatter';
import { slugify } from './ids';
import { stripLinkBrackets } from './wikilinks';
import {
  DEFAULT_STATUS,
  DIR_TYPES,
  DONE_STATUSES,
  MIND_MAP,
  NODE_TYPES,
  SOURCES,
  STATUS_BY_TYPE,
  SUMMARY_MAX,
  TYPE_DIRS,
  type NodeFrontmatter,
  type NodeSource,
  type NodeType,
  type ParseProblem,
  type VaultNode,
} from './types';

const KNOWN_KEYS = new Set([
  'id', 'type', 'title', 'summary', 'status', 'tags', 'aliases', 'links', 'people', 'area', 'project', 'map', 'connects',
  'due', 'scheduled', 'completed', 'priority', 'date', 'relation', 'url', 'created', 'updated', 'source',
]);

const KEY_ORDER = [
  'id', 'type', 'title', 'summary', 'status', 'tags', 'aliases', 'links', 'area', 'project', 'people', 'map', 'connects',
  'due', 'scheduled', 'completed', 'priority', 'date', 'relation', 'url', 'created', 'updated', 'source',
] as const;

function asStringList(v: unknown): string[] {
  if (v === undefined || v === null || v === '') return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => String(x).trim()).filter((x) => x.length > 0);
}

function asString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function asDateString(v: unknown): string | undefined {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = asString(v);
  if (!s) return undefined;
  // Accept full timestamps too; keep the date part for date-only fields.
  return /^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0, 10) : s;
}

export function typeFromPath(relPath: string): NodeType | undefined {
  const m = /^nodes\/([^/]+)\//.exec(relPath.replace(/\\/g, '/'));
  return m?.[1] ? DIR_TYPES[m[1]] : undefined;
}

const DATE_NAME_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Title derived from the file name; a date-named file (journal) keeps its dashes. */
export function titleFromPath(relPath: string): string {
  const base = (relPath.replace(/\\/g, '/').split('/').pop() ?? relPath).replace(/\.md$/i, '');
  return DATE_NAME_RE.test(base) ? base : base.replace(/-/g, ' ').trim();
}

/** Parses one node file. Never throws; problems are reported alongside a best-effort node. */
export function parseNodeFile(
  relPath: string,
  text: string,
  opts: { mtimeMs?: number | null } = {},
): { node: VaultNode; problems: ParseProblem[] } {
  const problems: ParseProblem[] = [];
  const path = relPath.replace(/\\/g, '/');
  const warn = (code: string, message: string): void => { problems.push({ path, code, message, severity: 'warn' }); };
  const error = (code: string, message: string): void => { problems.push({ path, code, message, severity: 'error' }); };

  const { data, body, hasFrontmatter, yamlError, recovered } = splitFrontmatter(text);
  if (!hasFrontmatter) warn('no-frontmatter', 'file has no frontmatter; defaults inferred from path');
  if (yamlError && recovered) warn('yaml-recovered', `frontmatter is not valid YAML (${yamlError.split('\n')[0]}); recovered line by line`);
  else if (yamlError) error('yaml', `frontmatter is not valid YAML: ${yamlError}`);

  const dirType = typeFromPath(path);
  let type = asString(data.type) as NodeType | undefined;
  if (!type || !NODE_TYPES.includes(type)) {
    if (type) error('type', `unknown type "${type}"`);
    type = dirType ?? 'note';
    if (!asString(data.type)) warn('type-missing', `type missing; inferred "${type}" from path`);
  } else if (dirType && dirType !== type) {
    warn('type-dir-mismatch', `type "${type}" but file is under nodes/${TYPE_DIRS[dirType]}/`);
  }

  const title = asString(data.title) ?? titleFromPath(path);
  if (!asString(data.title)) warn('title-missing', 'title missing; derived from file name');

  const firstLine = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0 && !l.startsWith('#')) ?? '';
  let summary = asString(data.summary) ?? '';
  if (!summary) {
    summary = firstLine.slice(0, SUMMARY_MAX);
    warn('summary-missing', 'summary missing; derived from the first body line');
  } else if (summary.length > SUMMARY_MAX) {
    warn('summary-long', `summary is ${summary.length} chars (max ${SUMMARY_MAX})`);
  }

  let status = asString(data.status) ?? DEFAULT_STATUS[type];
  if (!STATUS_BY_TYPE[type].includes(status)) {
    warn('status', `status "${status}" is not valid for ${type}; expected ${STATUS_BY_TYPE[type].join('|')}`);
    status = asString(data.status) ?? DEFAULT_STATUS[type];
  }

  const id = asString(data.id) ?? '';
  if (!id) warn('id-missing', 'id missing; the app will assign one');

  const priorityRaw = data.priority;
  let priority: number | undefined;
  if (priorityRaw !== undefined && priorityRaw !== null && priorityRaw !== '') {
    const n = Number(priorityRaw);
    if (Number.isInteger(n) && n >= 1 && n <= 4) priority = n;
    else warn('priority', `priority must be 1-4, got "${String(priorityRaw)}"`);
  }

  const sourceRaw = asString(data.source);
  const source = sourceRaw && (SOURCES as readonly string[]).includes(sourceRaw) ? (sourceRaw as NodeSource) : undefined;
  if (sourceRaw && !source) warn('source', `unknown source "${sourceRaw}"`);

  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!KNOWN_KEYS.has(k)) extra[k] = v;

  const fm: NodeFrontmatter = {
    id,
    type,
    title,
    summary,
    status,
    tags: asStringList(data.tags).map((t) => t.replace(/^#/, '').toLowerCase()),
    aliases: asStringList(data.aliases),
    links: asStringList(data.links),
    people: asStringList(data.people),
    connects: asStringList(data.connects),
    created: asString(data.created) ?? '',
    updated: asString(data.updated) ?? '',
    extra,
  };
  const area = asString(data.area); if (area) fm.area = area;
  const project = asString(data.project); if (project) fm.project = project;
  const map = asString(data.map); if (map) fm.map = map;
  const due = asDateString(data.due); if (due) fm.due = due;
  const scheduled = asDateString(data.scheduled); if (scheduled) fm.scheduled = scheduled;
  const completed = asDateString(data.completed); if (completed) fm.completed = completed;
  if (priority !== undefined) fm.priority = priority;
  const date = asDateString(data.date); if (date) fm.date = date;
  const relation = asString(data.relation); if (relation) fm.relation = relation;
  const url = asString(data.url); if (url) fm.url = url;
  if (source) fm.source = source;
  if (type === 'journal' && !fm.date) {
    const m = /(\d{4}-\d{2}-\d{2})/.exec(title) ?? /(\d{4}-\d{2}-\d{2})\.md$/.exec(path);
    if (m?.[1]) fm.date = m[1]; else warn('journal-date', 'journal node has no date');
  }

  return { node: { fm, body, path, mtimeMs: opts.mtimeMs ?? null }, problems };
}

/** Frontmatter → plain object in canonical key order, omitting empty lists and undefined values. */
export function frontmatterToData(fm: NodeFrontmatter): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    const v = (fm as unknown as Record<string, unknown>)[key];
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[key] = v;
  }
  for (const [k, v] of Object.entries(fm.extra)) if (!(k in out)) out[k] = v;
  return out;
}

export function serializeNode(node: VaultNode): string {
  return joinFrontmatter(frontmatterToData(node.fm), node.body);
}

/**
 * Keeps `completed` in step with `status` (VAULT-SPEC "Status"): a done or achieved item gets the day it was
 * finished (`today`, or the day of its last edit when healing older files); an item opened again loses it.
 */
export function withCompleted(fm: NodeFrontmatter, today: string): NodeFrontmatter {
  if (DONE_STATUSES.has(fm.status)) return fm.completed ? fm : { ...fm, completed: today };
  if (!fm.completed) return fm;
  const { completed: _drop, ...rest } = fm;
  return rest;
}

/** Fills `id`, `created`, `updated` when missing and settles `completed`. Returns whether anything changed. */
export function healNode(
  node: VaultNode,
  deps: { newId: () => string; now: () => string },
): { node: VaultNode; changed: boolean } {
  let changed = false;
  let fm = { ...node.fm };
  if (!fm.id) { fm.id = deps.newId(); changed = true; }
  if (!fm.created) { fm.created = fm.updated || deps.now(); changed = true; }
  if (!fm.updated) { fm.updated = fm.created; changed = true; }
  const settled = withCompleted(fm, (fm.updated || deps.now()).slice(0, 10));
  if (settled !== fm) { fm = settled; changed = true; }
  return { node: { ...node, fm }, changed };
}

/** Relation targets of a node (`area`, `project`, `people`, an area's `map`, a map's `connects`) as plain titles (`connects` keeps `mind` as is). */
export function relationTitles(fm: NodeFrontmatter): { area?: string; project?: string; map?: string; people: string[]; connects: string[] } {
  const r: { area?: string; project?: string; map?: string; people: string[]; connects: string[] } = {
    people: fm.people.map(stripLinkBrackets),
    connects: fm.connects.map((c) => (c === MIND_MAP ? c : stripLinkBrackets(c))),
  };
  if (fm.area) r.area = stripLinkBrackets(fm.area);
  if (fm.project) r.project = stripLinkBrackets(fm.project);
  if (fm.map) r.map = stripLinkBrackets(fm.map);
  return r;
}

/**
 * Relative path for a new node. Journal nodes use their date; inbox nodes a timestamp prefix.
 * `taken` holds existing relative paths so collisions get a `-2`, `-3`… suffix.
 */
export function nodeRelPath(
  type: NodeType,
  title: string,
  taken: ReadonlySet<string> = new Set(),
  opts: { date?: string; stamp?: string } = {},
): string {
  const dir = `nodes/${TYPE_DIRS[type]}`;
  let base: string;
  if (type === 'journal' && opts.date) base = opts.date;
  else if (type === 'inbox' && opts.stamp) base = `${opts.stamp}-${slugify(title)}`;
  else base = slugify(title);
  let candidate = `${dir}/${base}.md`;
  let n = 2;
  while (taken.has(candidate)) candidate = `${dir}/${base}-${n++}.md`;
  return candidate;
}
