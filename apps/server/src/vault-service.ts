import { EventEmitter } from 'node:events';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import {
  areaIndexName,
  buildDerived,
  DEFAULT_STATUS,
  deleteNodeFile,
  linkedNodeIds,
  loadVault,
  newId,
  nodeRelPath,
  normalizeTitle,
  nowIso,
  readNodeText,
  relatedNodes,
  rewriteWikilinks,
  searchNodes,
  STATUS_BY_TYPE,
  stripLinkBrackets,
  withCompleted,
  writeDerived,
  writeNodeFile,
  writeNodeText,
  type Derived,
  type GraphData,
  type NodeFrontmatter,
  type NodeType,
  type ParseProblem,
  type RelatedHit,
  type SearchHit,
  type VaultNode,
} from '@synapse/core';
import { promises as fs } from 'node:fs';
import { createVault, isVault } from '@synapse/vault-template';
import { HttpError } from './context';

export interface NodeDetail {
  node: VaultNode;
  backlinks: Array<{ id: string; title: string; type: string; summary: string }>;
  outgoing: Array<{ target: string; kind: string; resolved: boolean; text: string; title: string | null; type: string | null }>;
}

export type FrontmatterPatch = Partial<Pick<NodeFrontmatter,
  'title' | 'summary' | 'status' | 'tags' | 'aliases' | 'links' | 'area' | 'project' | 'people' | 'map' | 'connects' |
  'due' | 'scheduled' | 'priority' | 'date' | 'relation' | 'url' | 'source'>> & {
  /** Category colour of an area (`#rgb`/`#rrggbb`), kept in the frontmatter's extra keys; null or '' removes it. */
  color?: string | null;
  /** Kind fields (VAULT-SPEC "Kinds"), validated by the route against the node's type; null or '' removes one. */
  facets?: Record<string, string | number | boolean | string[] | null>;
};

/** Kinds an item can be turned into (and from) by hand: the ones with a folder of their own and no special naming. */
const RETYPABLE: ReadonlySet<NodeType> = new Set(['note', 'idea', 'task', 'project', 'goal', 'habit', 'event', 'person', 'resource']);

/**
 * Applies a patch to frontmatter: known keys directly, `color` into the preserved extra keys; `completed` follows a
 * status change (VAULT-SPEC "Status").
 */
function applyPatch(fm: NodeFrontmatter, patch: FrontmatterPatch | undefined, today: string): NodeFrontmatter {
  const { color, facets, ...known } = patch ?? {};
  const next: NodeFrontmatter = { ...fm, ...stripUndefined(known) };
  if (color !== undefined || facets) {
    const extra = { ...fm.extra };
    if (color !== undefined) { if (color) extra['color'] = color; else delete extra['color']; }
    for (const [k, v] of Object.entries(facets ?? {})) {
      if (v === null || v === '' || (Array.isArray(v) && v.length === 0)) delete extra[k]; else extra[k] = v;
    }
    next.extra = extra;
  }
  return withCompleted(next, today);
}

export interface CreateNodeInput extends FrontmatterPatch {
  type: NodeType;
  title: string;
  body?: string;
}

/** Owns the in-memory view of the vault, the derived index, and the file watcher. */
export class VaultService extends EventEmitter {
  exists = false;
  loadedAt: string | null = null;
  private nodes: VaultNode[] = [];
  private byId = new Map<string, VaultNode>();
  private byPath = new Map<string, VaultNode>();
  private derived: Derived | null = null;
  private problems: ParseProblem[] = [];
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private inflight: Promise<void> | null = null;
  private pending = new Set<string>();

  constructor(readonly root: string) {
    super();
  }

  async start(): Promise<void> {
    this.exists = await isVault(this.root);
    if (!this.exists) return;
    await this.rebuildNow('startup');
    this.watch();
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.watcher?.close();
    this.watcher = null;
    // A rebuild under way (and one queued behind it) still writes `index/`: wait, so the caller may remove or replace the folder.
    while (this.inflight) await this.inflight.catch(() => undefined);
  }

  /**
   * Erases everything the user put in — nodes, memory, the derived index, the app's runs, layout, previews and
   * dismissed suggestions — and lays the template down again (Settings → Erase everything). Settings and the phone
   * pairing stay; the caller restarts the vault's git history.
   */
  async eraseAll(): Promise<void> {
    await this.replaceAll(async () => undefined);
  }

  /**
   * Removes everything the owner put in (as `eraseAll` does), lets `write` lay other data down (an import, docs/
   * ARCHITECTURE.md "Backup"), puts back what the template needs and reads the vault again.
   */
  async replaceAll(write: () => Promise<void>): Promise<void> {
    await this.stop();
    const rm = (rel: string): Promise<void> => fs.rm(path.join(this.root, rel), { recursive: true, force: true });
    for (const rel of ['nodes', 'memory', 'index', 'AGENTS.md', '.synapse/sessions.json', '.synapse/runtime-context.md', '.synapse/layout.json', '.synapse/previews.json', '.synapse/suggestions.json', '.synapse/cache']) await rm(rel);
    await write();
    await createVault(this.root, { git: false });
    this.pending.clear();
    await this.start();
  }

  private watch(): void {
    if (this.watcher) return;
    this.watcher = chokidar.watch([path.join(this.root, 'nodes'), path.join(this.root, 'memory')], {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });
    this.watcher.on('all', (_event, p) => {
      if (!p.endsWith('.md')) return;
      this.pending.add(path.relative(this.root, p).split(path.sep).join('/'));
      this.scheduleRebuild();
    });
  }

  scheduleRebuild(delayMs = 250, retries = 0): void {
    if (this.timer) clearTimeout(this.timer);
    // A file can vanish between the watcher's event and the read (a kind change moves it); one retry sees the vault as it is.
    this.timer = setTimeout(() => {
      this.rebuildNow('watch').catch((err: unknown) => {
        this.emit('rebuildFailed', err);
        if (retries < 1) this.scheduleRebuild(400, retries + 1);
      });
    }, delayMs);
  }

  /** Full reload + rebuild of everything derived. Cheap for personal vault sizes. */
  async rebuildNow(reason: string): Promise<void> {
    if (this.inflight) await this.inflight;
    this.inflight = (async () => {
      const loaded = await loadVault(this.root);
      this.nodes = loaded.nodes;
      this.problems = loaded.problems;
      this.byId = new Map(this.nodes.map((n) => [n.fm.id, n]));
      this.byPath = new Map(this.nodes.map((n) => [n.path, n]));
      this.derived = buildDerived(this.nodes);
      await writeDerived(this.root, this.derived.index, this.derived.graph);
      this.loadedAt = nowIso();
      const paths = [...this.pending];
      this.pending.clear();
      const ids = paths.map((p) => this.byPath.get(p)?.fm.id).filter((x): x is string => Boolean(x));
      this.emit('changed', { reason, paths, ids });
    })();
    try { await this.inflight; } finally { this.inflight = null; }
  }

  // ---- reads

  get graph(): GraphData | null { return this.derived?.graph ?? null; }
  get problemCount(): number { return this.problems.length; }
  get nodeCount(): number { return this.nodes.length; }

  stats(): Record<string, unknown> {
    const g = this.derived?.graph;
    return g ? { ...g.stats, loadedAt: this.loadedAt, problems: this.problems.length } : { nodes: 0, loadedAt: null };
  }

  listNodes(): VaultNode[] { return this.nodes; }
  getNode(id: string): VaultNode | undefined { return this.byId.get(id); }
  getNodeByPath(p: string): VaultNode | undefined { return this.byPath.get(p); }

  getIndex(type: string): string | undefined {
    if (!this.derived) return undefined;
    if (type === 'INDEX') return this.derived.index.router;
    return this.derived.index.byType[type as NodeType];
  }

  /** A file of the brain's `memory/` (the owner's profile, the latest insights), or null when not written yet. */
  async readMemory(name: 'profile' | 'insights' | 'focus'): Promise<string | null> {
    try { return await readNodeText(this.root, `memory/${name}.md`); } catch { return null; }
  }

  /** A place's analysis, `memory/places/<slug>.md` (the slug of its sub-index file). */
  /** The file one place's analysis lives in (`/insight [[Place]] → <path>`, VAULT-SPEC "memory/places"). */
  placeAnalysisPath(title: string): string {
    return `memory/places/${areaIndexName(title)}`;
  }

  /** One place's analysis without frontmatter (a model may add one anyway); null until it is written. */
  async readPlaceAnalysis(title: string): Promise<string | null> {
    let text: string;
    try { text = await readNodeText(this.root, this.placeAnalysisPath(title)); } catch { return null; }
    return text.replace(/^---\r?\n[\s\S]*?\r?\n---[^\n]*(\r?\n|$)/, '').trim() || null;
  }

  getDetail(id: string): NodeDetail | undefined {
    const node = this.byId.get(id);
    if (!node || !this.derived) return undefined;
    const links = this.derived.links;
    const backlinks = [...(links.backlinks.get(id) ?? [])].map((sid) => this.byId.get(sid)).filter((n): n is VaultNode => Boolean(n))
      .map((n) => ({ id: n.fm.id, title: n.fm.title, type: n.fm.type, summary: n.fm.summary }));
    const outgoing = (links.outgoing.get(id) ?? []).map((l) => {
      const t = this.byId.get(l.target);
      return { target: l.target, kind: l.kind, resolved: l.resolved, text: l.text, title: t?.fm.title ?? null, type: t?.fm.type ?? null };
    });
    return { node, backlinks, outgoing };
  }

  search(q: string, limit = 20): SearchHit[] {
    return this.derived ? searchNodes(this.derived.search, q, limit) : [];
  }

  /** Lexically similar nodes that are not linked yet (VAULT-SPEC "Related"); `exclude` adds dismissed ids. */
  related(id: string, limit = 8, exclude: ReadonlySet<string> = new Set()): RelatedHit[] {
    const node = this.byId.get(id);
    if (!node || !this.derived) return [];
    const skip = new Set<string>([...linkedNodeIds(this.derived.links, id), ...exclude]);
    return relatedNodes(this.derived.search, node, limit, { exclude: skip });
  }

  resolveTitle(text: string): VaultNode | undefined {
    return this.derived?.links.byKey.get(stripLinkBrackets(text).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase());
  }

  // ---- writes (always through here; never from routes)

  async updateNode(id: string, patch: { frontmatter?: FrontmatterPatch; body?: string }): Promise<VaultNode> {
    const node = this.byId.get(id);
    if (!node) throw new Error(`node not found: ${id}`);
    const now = nowIso();
    const fm: NodeFrontmatter = { ...applyPatch(node.fm, patch.frontmatter, now.slice(0, 10)), updated: now };
    const next: VaultNode = { ...node, fm, body: patch.body ?? node.body };
    await writeNodeFile(this.root, next);
    await this.rebuildNow('api');
    return this.byId.get(id) ?? next;
  }

  /**
   * Changes an item's kind (VAULT-SPEC "Kinds"): the file moves to the new kind's folder under the same id and
   * title, so links keep resolving; a status the new kind does not know becomes its default. Kind fields the new
   * kind does not use stay in the frontmatter untouched. The caller (route) wraps it in one vault commit.
   */
  async retypeNode(id: string, type: NodeType, patch: { frontmatter?: FrontmatterPatch; body?: string } = {}): Promise<VaultNode> {
    const node = this.byId.get(id);
    if (!node) throw new HttpError(404, `node not found: ${id}`);
    if (!RETYPABLE.has(type) || !RETYPABLE.has(node.fm.type)) throw new HttpError(400, `cannot turn a ${node.fm.type} into a ${type}`);
    const now = nowIso();
    const fm: NodeFrontmatter = { ...applyPatch(node.fm, patch.frontmatter, now.slice(0, 10)), type, updated: now };
    if (!STATUS_BY_TYPE[type].includes(fm.status)) fm.status = DEFAULT_STATUS[type];
    const taken = new Set(this.nodes.filter((n) => n.fm.id !== id).map((n) => n.path));
    const relPath = nodeRelPath(type, fm.title, taken);
    await writeNodeFile(this.root, { ...node, fm: withCompleted(fm, now.slice(0, 10)), body: patch.body ?? node.body, path: relPath });
    if (relPath !== node.path) await deleteNodeFile(this.root, node.path);
    await this.rebuildNow('api');
    return this.byId.get(id) ?? node;
  }

  /**
   * Renames a node (VAULT-SPEC "Renames"): rewrites `[[Old]]` links — body and quoted frontmatter — in every file that
   * resolves to it, adds the old title to `aliases`, applies the rest of `patch`. The file name is kept; the caller
   * (route) wraps the operation in a vault git commit. Returns the paths whose links were rewritten.
   */
  async renameNode(id: string, newTitle: string, patch: { frontmatter?: FrontmatterPatch; body?: string } = {}): Promise<{ node: VaultNode; rewritten: string[] }> {
    const node = this.byId.get(id);
    if (!node || !this.derived) throw new HttpError(404, `node not found: ${id}`);
    const title = newTitle.trim();
    if (!title) throw new HttpError(400, 'title must not be empty');
    const old = node.fm.title;
    const clash = this.derived.links.byKey.get(normalizeTitle(title));
    if (clash && clash.fm.id !== id && normalizeTitle(clash.fm.title) === normalizeTitle(title)) {
      throw new HttpError(409, `another node is already titled "${clash.fm.title}" (${clash.path})`);
    }
    const rewritten: string[] = [];
    for (const sid of this.derived.links.backlinks.get(id) ?? []) {
      const src = this.byId.get(sid);
      if (!src || sid === id) continue;
      const r = rewriteWikilinks(await readNodeText(this.root, src.path), old, title);
      if (r.count === 0) continue;
      await writeNodeText(this.root, src.path, r.text);
      rewritten.push(src.path);
    }
    const aliases = [...(patch.frontmatter?.aliases ?? node.fm.aliases)];
    if (normalizeTitle(old) !== normalizeTitle(title) && !aliases.some((a) => normalizeTitle(a) === normalizeTitle(old))) aliases.push(old);
    const now = nowIso();
    const fm: NodeFrontmatter = { ...applyPatch(node.fm, patch.frontmatter, now.slice(0, 10)), title, aliases, updated: now };
    const body = rewriteWikilinks(patch.body ?? node.body, old, title).text;
    const next: VaultNode = { ...node, fm, body };
    await writeNodeFile(this.root, next);
    await this.rebuildNow('api');
    return { node: this.byId.get(id) ?? next, rewritten };
  }

  async createNode(input: CreateNodeInput): Promise<VaultNode> {
    const now = nowIso();
    const { type, title, body, color, facets, ...rest } = input;
    const taken = new Set(this.nodes.map((n) => n.path));
    const fm: NodeFrontmatter = {
      id: newId(), type, title: title.trim(), summary: (rest.summary ?? title).trim().slice(0, 160),
      status: rest.status ?? defaultStatus(type), tags: rest.tags ?? [], aliases: rest.aliases ?? [], links: rest.links ?? [],
      people: rest.people ?? [], connects: rest.connects ?? [], created: now, updated: now, source: rest.source ?? 'manual',
      extra: { ...(color ? { color } : {}), ...Object.fromEntries(Object.entries(facets ?? {}).filter(([, v]) => v !== null && v !== '')) },
      ...stripUndefined({ area: rest.area, project: rest.project, map: rest.map, due: rest.due, scheduled: rest.scheduled, priority: rest.priority, date: rest.date, relation: rest.relation, url: rest.url }),
    };
    if (type === 'journal' && !fm.date) fm.date = now.slice(0, 10);
    const relPath = nodeRelPath(type, fm.title, taken, { date: fm.date, stamp: stamp(now) });
    const node: VaultNode = { fm: withCompleted(fm, now.slice(0, 10)), body: body ?? '', path: relPath, mtimeMs: null };
    await writeNodeFile(this.root, node);
    await this.rebuildNow('api');
    return this.byId.get(fm.id) ?? node;
  }

  /** Fast raw capture into `nodes/inbox/` without the brain. */
  async capture(text: string): Promise<VaultNode> {
    const first = text.trim().split('\n').find((l) => l.trim().length) ?? 'capture';
    return this.createNode({ type: 'inbox', title: first.trim().slice(0, 60), summary: first.trim().slice(0, 160), body: text.trim() + '\n', source: 'capture' });
  }

  async deleteNode(id: string): Promise<VaultNode> {
    const node = this.byId.get(id);
    if (!node) throw new HttpError(404, `node not found: ${id}`);
    await deleteNodeFile(this.root, node.path);
    await this.rebuildNow('api');
    return node;
  }

  /**
   * Deletes a category (an area node, VAULT-SPEC "Categories"): every node whose own `area` points at it moves to
   * `moveTo` (another area's id) or loses its `area` (null); then the area file goes. Nodes that only inferred the
   * category follow by themselves on the next rebuild. The caller (route) wraps it in one vault commit.
   */
  async deleteCategory(id: string, moveTo: string | null): Promise<{ node: VaultNode; moved: string[] }> {
    const area = this.byId.get(id);
    if (!area || area.fm.type !== 'area') throw new HttpError(404, `category not found: ${id}`);
    const target = moveTo ? this.byId.get(moveTo) : undefined;
    if (moveTo && (!target || target.fm.type !== 'area' || target.fm.id === id)) throw new HttpError(400, `not a category to move to: ${moveTo}`);
    const moved: string[] = [];
    for (const n of [...this.nodes]) {
      if (n.fm.id === id || !n.fm.area) continue;
      if (this.resolveTitle(n.fm.area)?.fm.id !== id) continue;
      const fm: NodeFrontmatter = { ...n.fm, updated: nowIso() };
      if (target) fm.area = `[[${target.fm.title}]]`; else delete fm.area;
      await writeNodeFile(this.root, { ...n, fm });
      moved.push(n.fm.id);
    }
    await deleteNodeFile(this.root, area.path);
    await this.rebuildNow('api');
    return { node: area, moved };
  }

  /** Deletes a map: its categories lose their `map` and return to the mind map (VAULT-SPEC "Maps"); their items stay. */
  async deleteMap(id: string): Promise<{ node: VaultNode; moved: string[] }> {
    const map = this.byId.get(id);
    if (!map || map.fm.type !== 'map') throw new HttpError(404, `map not found: ${id}`);
    const moved: string[] = [];
    for (const n of [...this.nodes]) {
      if (n.fm.type !== 'area' || !n.fm.map || this.resolveTitle(n.fm.map)?.fm.id !== id) continue;
      const { map: _drop, ...rest } = n.fm;
      await writeNodeFile(this.root, { ...n, fm: { ...rest, updated: nowIso() } });
      moved.push(n.fm.id);
    }
    await deleteNodeFile(this.root, map.path);
    await this.rebuildNow('api');
    return { node: map, moved };
  }
}

function defaultStatus(type: NodeType): string {
  return type === 'task' ? 'todo' : type === 'inbox' ? 'new' : 'active';
}

function stamp(iso: string): string {
  return iso.slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2');
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
