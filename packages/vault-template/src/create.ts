import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addDays,
  buildDerived,
  loadVault,
  newId,
  nodeRelPath,
  pathExists,
  toIsoWithOffset,
  toLocalDate,
  writeDerived,
  writeNodeFile,
  type NodeFrontmatter,
  type VaultNode,
} from '@synapse/core';
import { sampleNodes, type SampleNode } from './sample-data';

export const TEMPLATE_DIR = fileURLToPath(new URL('../template/', import.meta.url));

export interface EngineDefaults {
  model?: string;
  effort?: string;
}

/** `.synapse/settings.json` (app-private, gitignored in the vault). Spec: docs/VAULT-SPEC.md, docs/BRAIN-ENGINES.md. */
export interface VaultSettings {
  engine: string;
  /** Model and effort of the selected engine (mirrors `engines[engine]`). */
  model: string;
  effort: string;
  locale: 'fa' | 'en';
  graph: { showDone: boolean; showTags: boolean; mode: '2d' | '3d' };
  /** Per-engine model/effort defaults, keyed by engine id. */
  engines: Record<string, EngineDefaults>;
  /** API keys pasted in Settings, keyed by provider (`anthropic`, `openai`, `openrouter`); never returned unmasked. */
  apiKeys: Record<string, string>;
  /** `lanAccess`: bind all interfaces so a paired phone can reach the server (docs/ARCHITECTURE.md "Access control"). */
  server: { lanAccess: boolean };
  /** Scheduled brain runs (docs/ARCHITECTURE.md "Automation"): the daily review at a local time, the weekly one on a weekday; null = off. */
  /** Runs that start on their own (ARCHITECTURE "Automation"): the full review and the daily plan at a time, the weekly review on a day. */
  automation: { review: string | null; daily: string | null; weekly: { day: number; time: string } | null };
}

export const DEFAULT_SETTINGS: VaultSettings = {
  engine: 'claude-cli',
  model: 'sonnet',
  effort: 'medium',
  locale: 'fa',
  graph: { showDone: true, showTags: false, mode: '2d' },
  engines: { 'claude-cli': { model: 'sonnet', effort: 'medium' } },
  apiKeys: {},
  server: { lanAccess: false },
  automation: { review: null, daily: null, weekly: null },
};

export function git(root: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', ['-c', 'user.name=Synapse', '-c', 'user.email=synapse@localhost', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err) => resolve({ code: null, stdout, stderr: String(err) }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

export async function isVault(dir: string): Promise<boolean> {
  return (await pathExists(path.join(dir, 'AGENTS.md'))) && (await pathExists(path.join(dir, 'nodes')));
}

/** Template files owned by the app and refreshed in existing vaults; `memory/` and `nodes/` belong to the user. */
const AGENT_LAYER_SKIP = new Set(['memory', 'nodes']);

async function walkFiles(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (!rel && AGENT_LAYER_SKIP.has(e.name)) continue;
    if (e.isDirectory()) out.push(...(await walkFiles(path.join(dir, e.name), r)));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/**
 * Brings an existing vault's agent layer (AGENTS.md, CLAUDE.md, .claude/**, .gitignore) up to date with the
 * shipped template; user data under `memory/` and `nodes/` is never touched. Returns the relative paths written.
 */
export async function syncAgentLayer(dest: string): Promise<string[]> {
  const written: string[] = [];
  for (const rel of await walkFiles(TEMPLATE_DIR)) {
    const src = path.join(TEMPLATE_DIR, rel);
    const target = path.join(dest, rel);
    const next = await fs.readFile(src);
    let current: Buffer | null = null;
    try { current = await fs.readFile(target); } catch { /* missing */ }
    if (current && current.equals(next)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, next);
    written.push(rel);
  }
  return written;
}

/** Copies the template into `dest` (idempotent; an existing vault gets its agent layer synced), writes default settings, initializes git. */
export async function createVault(dest: string, opts: { git?: boolean } = {}): Promise<{ created: boolean; path: string }> {
  const already = await isVault(dest);
  if (!already) {
    await fs.mkdir(dest, { recursive: true });
    await fs.cp(TEMPLATE_DIR, dest, { recursive: true, force: false, errorOnExist: false });
  } else {
    await syncAgentLayer(dest);
  }
  const appDir = path.join(dest, '.synapse');
  await fs.mkdir(path.join(appDir, 'cache'), { recursive: true });
  const settingsPath = path.join(appDir, 'settings.json');
  if (!(await pathExists(settingsPath))) await fs.writeFile(settingsPath, JSON.stringify(DEFAULT_SETTINGS, null, 2) + '\n', 'utf8');
  if (opts.git ?? true) {
    if (!(await pathExists(path.join(dest, '.git')))) {
      await git(dest, ['init', '-q', '-b', 'main']);
      await git(dest, ['add', '-A']);
      await git(dest, ['commit', '-q', '-m', 'seed: vault template']);
    }
  }
  return { created: !already, path: dest };
}

/** Rebuilds `index/` from the node files (healing missing ids/timestamps on the way). */
export async function rebuildDerived(root: string): Promise<{ nodes: VaultNode[]; problems: number; healed: string[] }> {
  const loaded = await loadVault(root);
  const derived = buildDerived(loaded.nodes);
  await writeDerived(root, derived.index, derived.graph);
  return { nodes: loaded.nodes, problems: loaded.problems.length, healed: loaded.healed };
}

function sampleToNode(s: SampleNode, now: Date, taken: Set<string>): VaultNode {
  const created = addDays(now, -s.createdDaysAgo);
  created.setHours(9 + (s.title.length % 9), (s.summary.length * 7) % 60, 0, 0);
  const updated = s.updatedDaysAgo === undefined ? created : addDays(now, -s.updatedDaysAgo);
  if (s.updatedDaysAgo !== undefined) updated.setHours(10 + (s.title.length % 8), (s.summary.length * 3) % 60, 0, 0);
  const today = toLocalDate(now);
  const date = s.type === 'journal' ? toLocalDate(addDays(now, s.dateOffset ?? 0)) : undefined;
  const title = s.type === 'journal' ? (date as string) : s.title;
  const fm: NodeFrontmatter = {
    id: newId(),
    type: s.type,
    title,
    summary: s.summary,
    status: s.status ?? (s.type === 'task' ? 'todo' : s.type === 'inbox' ? 'new' : 'active'),
    tags: s.tags ?? [],
    aliases: s.aliases ?? [],
    links: (s.links ?? []).map((t) => `[[${t}]]`),
    people: (s.people ?? []).map((t) => `[[${t}]]`),
    connects: (s.connects ?? []).map((t) => (t === 'mind' ? t : `[[${t}]]`)),
    created: toIsoWithOffset(created),
    updated: toIsoWithOffset(updated),
    extra: {},
  };
  if (s.area) fm.area = `[[${s.area}]]`;
  if (s.project) fm.project = `[[${s.project}]]`;
  if (s.map) fm.map = `[[${s.map}]]`;
  if (s.dueOffset !== undefined) fm.due = toLocalDate(addDays(now, s.dueOffset));
  if (s.scheduledOffset !== undefined) fm.scheduled = toLocalDate(addDays(now, s.scheduledOffset));
  if (s.priority !== undefined) fm.priority = s.priority;
  if (date) fm.date = date;
  if (s.relation) fm.relation = s.relation;
  if (s.url) fm.url = s.url;
  if (s.source) fm.source = s.source;
  if (s.eventDateOffset !== undefined) fm.date = toLocalDate(addDays(now, s.eventDateOffset));
  if (s.extra) Object.assign(fm.extra, s.extra);
  if (s.targetOffset !== undefined) fm.extra['target'] = toLocalDate(addDays(now, s.targetOffset));
  if (s.checkinOffsets) fm.extra['checkins'] = s.checkinOffsets.map((o) => toLocalDate(addDays(now, o))).sort();
  const stamp = `${today.replace(/-/g, '')}-${String(created.getHours()).padStart(2, '0')}${String(created.getMinutes()).padStart(2, '0')}${String(taken.size % 60).padStart(2, '0')}`;
  const relPath = nodeRelPath(s.type, title, taken, { date, stamp });
  taken.add(relPath);
  return { fm, body: s.body, path: relPath, mtimeMs: null };
}

/**
 * Creates the vault (if needed) and writes the sample nodes. With `reset`, existing nodes are removed first; with
 * `addMissing`, only sample nodes whose title the vault lacks are added (existing files and ids stay untouched).
 */
export async function seedSampleVault(dest: string, opts: { reset?: boolean; addMissing?: boolean } = {}): Promise<{ path: string; written: number; skipped: boolean }> {
  await createVault(dest);
  const nodesDir = path.join(dest, 'nodes');
  const existing = (await loadVault(dest, { heal: false })).nodes;
  if (existing.length && opts.addMissing && !opts.reset) {
    const have = new Set(existing.map((n) => n.fm.title.normalize('NFC').toLowerCase()));
    const taken = new Set(existing.map((n) => n.path));
    const now = new Date();
    const fresh = sampleNodes.filter((s) => s.type !== 'journal' && !have.has(s.title.normalize('NFC').toLowerCase())).map((s) => sampleToNode(s, now, taken));
    for (const n of fresh) await writeNodeFile(dest, n);
    await rebuildDerived(dest);
    if (fresh.length) { await git(dest, ['add', '-A']); await git(dest, ['commit', '-q', '-m', 'seed: sample data for new kinds']); }
    return { path: dest, written: fresh.length, skipped: fresh.length === 0 };
  }
  if (existing.length && !opts.reset) {
    await rebuildDerived(dest);
    return { path: dest, written: 0, skipped: true };
  }
  if (existing.length) {
    for (const n of existing) await fs.rm(path.join(dest, n.path), { force: true });
  }
  await fs.mkdir(nodesDir, { recursive: true });
  const now = new Date();
  const taken = new Set<string>();
  const nodes = sampleNodes.map((s) => sampleToNode(s, now, taken));
  for (const n of nodes) await writeNodeFile(dest, n);
  await rebuildDerived(dest);
  await git(dest, ['add', '-A']);
  await git(dest, ['commit', '-q', '-m', 'seed: sample data']);
  return { path: dest, written: nodes.length, skipped: false };
}
