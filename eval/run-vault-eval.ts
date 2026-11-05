import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeCliEngine, hasUrl, MODE_HINT, replyLanguage, replyLanguageLine, replyReminder, WEB_HINT, type BrainEvent, type BrainMode, type ReplyLanguage } from '@synapse/brain';
import { kindFromUrl, normalizeTitle, stripLinkBrackets, SUMMARY_MAX, splitFrontmatter } from '@synapse/core';
import { git, seedSampleVault } from '@synapse/vault-template';

interface Expect {
  skill?: string;
  files_changed?: boolean;
  summary_changed?: string;
  /** Every node created by the run (note, idea, task, project, resource) carries an `area` that resolves to an area node. */
  categorized?: boolean;
  /** The run created at least one new area (category). */
  new_area?: boolean;
  /** Types that must appear among the created nodes. */
  created_types?: string[];
  /** Types that must not appear among the created nodes (e.g. no task for a feeling). */
  absent_types?: string[];
  /** Types that must appear among the created or modified nodes (an existing habit may be updated instead of duplicated). */
  touched_types?: string[];
  /** An existing node (by title) must end the run with this status and/or these frontmatter values (a status update, not a new node). */
  node_state?: { title: string; status?: string; fields?: Record<string, string | number> };
  /** The reply must (or must not) ask the user something (a clarifying turn before filing). */
  asks?: boolean;
  /** Title of a habit whose `checkins` must contain today's date after the run. */
  checkin?: string;
  /** A created resource must have this kind (its own `kind`, or the one derived from its URL). */
  resource_kind?: string;
  /** For each type, some created node of it must sit in one of these areas (by title) — a note in the character map, a task in the mind map. */
  created_in?: Record<string, string[]>;
  /** Some created node of each type must sit in a category of a map created in this run (a new island, not the mind map). */
  in_new_map?: string[];
  /** The reply must contain at least one of these strings (a question that names the choice it asks about). */
  reply_includes_any?: string[];
  /** Vault-relative files the run must have written, each containing these headings (e.g. the review's `memory/focus.md`). */
  wrote?: Record<string, string[]>;
  /** The reply's language by its own letters ([[links]] and code aside; BRAIN-ENGINES "Reply language"). */
  reply_language?: ReplyLanguage;
  /** The language of the lines in the `wrote` files, their headings aside (those stay English by spec). */
  wrote_language?: ReplyLanguage;
}
/**
 * `mode` writes a runtime context like the server's (Now, mode hint, web hint) and lets a URL in the prompt enable WebFetch.
 * `display` marks a prompt the app writes for a button (what the chat shows instead): as on the server, its reply follows
 * the UI language (fa) rather than the prompt's letters.
 */
interface Case { id: string; prompt: string; display?: string; mode?: BrainMode; expect: Expect; max_turns?: number }

/** The reply language the server would give this case (BRAIN-ENGINES "Reply language"). */
const caseLanguage = (c: Case): ReplyLanguage => (c.display ? 'fa' : replyLanguage(c.prompt, 'fa'));

const CATEGORIZED_TYPES = new Set(['note', 'idea', 'task', 'project', 'resource', 'goal', 'habit', 'event']);

/** Frontmatter of the files the run added under nodes/ (untracked in the vault's git). */
async function createdNodes(vault: string): Promise<Array<{ rel: string; data: Record<string, unknown> }>> {
  // quotePath off: Persian file names would otherwise come back as octal escapes.
  const status = await git(vault, ['-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all']);
  const rels = status.stdout.split('\n').filter((l) => l.startsWith('?? nodes/') && l.endsWith('.md')).map((l) => l.slice(3).trim());
  return Promise.all(rels.map(async (rel) => ({ rel, data: splitFrontmatter(await fs.readFile(path.join(vault, rel), 'utf8')).data })));
}

/** Normalized titles and aliases of every area file in the vault after the run. */
async function areaKeys(vault: string): Promise<Set<string>> {
  const dir = path.join(vault, 'nodes', 'areas');
  const keys = new Set<string>();
  for (const f of await fs.readdir(dir).catch(() => [] as string[])) {
    if (!f.endsWith('.md')) continue;
    const { data } = splitFrontmatter(await fs.readFile(path.join(dir, f), 'utf8'));
    if (typeof data['title'] === 'string') keys.add(normalizeTitle(data['title']));
    if (Array.isArray(data['aliases'])) for (const a of data['aliases']) if (typeof a === 'string') keys.add(normalizeTitle(a));
  }
  return keys;
}

/** Like the server's: the reply language always (BRAIN-ENGINES "Reply language"), the mode and web hints for mode cases. */
async function writeContext(vault: string, c: Case): Promise<string | undefined> {
  const file = path.join(vault, '.synapse', 'runtime-context.md');
  const lines = ['# Runtime context (written by the eval harness)', `- Now: ${new Date().toISOString()}`, '- UI language: fa', replyLanguageLine(caseLanguage(c))];
  if (c.mode) lines.push(`- Mode: ${c.mode} → ${MODE_HINT[c.mode]}`);
  if (c.mode && hasUrl(c.prompt)) lines.push(`- Web: ${WEB_HINT}`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, lines.join('\n') + '\n', 'utf8');
  return file;
}

const today = (): string => {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Frontmatter `summary` of a vault file, or null when the file is missing / has no valid frontmatter. */
async function readSummary(vault: string, rel: string): Promise<{ summary: string | null; yamlError?: string }> {
  try {
    const { data, yamlError } = splitFrontmatter(await fs.readFile(path.join(vault, rel), 'utf8'));
    return { summary: typeof data['summary'] === 'string' ? data['summary'] : null, ...(yamlError ? { yamlError } : {}) };
  } catch { return { summary: null }; }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const cases = (JSON.parse(await fs.readFile(path.join(here, 'vault-cases.json'), 'utf8')) as { cases: Case[] }).cases;
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const model = process.env['SYNAPSE_EVAL_MODEL'] ?? 'sonnet';

const engine = new ClaudeCliEngine();
const probe = await engine.probe(true);
if (!probe.installed || !probe.loggedIn) {
  console.error(JSON.stringify({ error: 'claude not ready', probe }, null, 2));
  process.exit(2);
}

const results: unknown[] = [];
let failed = 0;
for (const c of cases) {
  if (only.length && !only.includes(c.id)) continue;
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), `synapse-eval-${c.id}-`));
  await seedSampleVault(vault, { reset: true });
  const summaryPath = c.expect.summary_changed?.replace('{today}', today());
  const before = summaryPath ? await readSummary(vault, summaryPath) : null;
  const events: BrainEvent[] = [];
  const started = Date.now();
  const contextFile = await writeContext(vault, c);
  const allowWeb = Boolean(c.mode) && hasUrl(c.prompt);
  const prompt = `${c.prompt}${replyReminder(caseLanguage(c))}`;
  for await (const ev of engine.run({ prompt, cwd: vault, model, effort: 'low', maxTurns: c.max_turns ?? 10, allowWeb, ...(contextFile ? { systemAppendFile: contextFile } : {}) })) events.push(ev);
  const skills = events.filter((e) => e.type === 'tool_use' && e.name === 'Skill').map((e) => (e.type === 'tool_use' ? e.summary.replace('Skill /', '') : ''));
  const status = await git(vault, ['status', '--porcelain']);
  const filesChanged = status.stdout.trim().length > 0;
  const result = events.find((e) => e.type === 'result');
  const error = events.find((e) => e.type === 'error');
  const checks: Record<string, boolean | null> = {};
  if (c.expect.skill) checks['skill'] = skills.length ? skills.includes(c.expect.skill) : null;
  if (c.expect.files_changed !== undefined) checks['files_changed'] = filesChanged === c.expect.files_changed;
  if (c.expect.asks !== undefined) checks['asks'] = /[?؟]/.test(result?.type === 'result' ? result.text : '') === c.expect.asks;
  if (c.expect.reply_includes_any) { const text = result?.type === 'result' ? result.text : ''; checks['reply_includes_any'] = c.expect.reply_includes_any.some((x) => text.includes(x)); }
  // The fallback is the other language, so a text with no letters at all never passes.
  const inLanguage = (text: string, want: ReplyLanguage): boolean => replyLanguage(text, want === 'fa' ? 'en' : 'fa') === want;
  if (c.expect.reply_language) checks['reply_language'] = inLanguage(result?.type === 'result' ? result.text : '', c.expect.reply_language);
  if (c.expect.wrote) {
    const texts = await Promise.all(Object.keys(c.expect.wrote).map((rel) => fs.readFile(path.join(vault, rel), 'utf8').catch(() => null)));
    checks['wrote'] = Object.values(c.expect.wrote).every((headings, i) => { const text = texts[i]; return typeof text === 'string' && headings.every((h) => text.includes(h)); });
    const want = c.expect.wrote_language;
    if (want) checks['wrote_language'] = texts.every((text) => typeof text === 'string' && inLanguage(text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n'), want));
  }
  const after = summaryPath ? await readSummary(vault, summaryPath) : null;
  if (summaryPath && before && after) {
    // The node must still parse (quoted summary), carry a non-empty summary within the limit, and that summary must have changed.
    checks['summary_changed'] = !after.yamlError && typeof after.summary === 'string' && after.summary.length > 0 && after.summary.length <= SUMMARY_MAX && after.summary !== before.summary;
  }
  const created = c.expect.categorized || c.expect.new_area || c.expect.created_types || c.expect.absent_types || c.expect.resource_kind || c.expect.created_in || c.expect.in_new_map ? await createdNodes(vault) : [];
  const createdTypes = created.map((n) => String(n.data['type'] ?? '?'));
  if (c.expect.categorized) {
    const areas = await areaKeys(vault);
    const needing = created.filter((n) => CATEGORIZED_TYPES.has(String(n.data['type'])));
    checks['categorized'] = needing.length > 0 && needing.every((n) => typeof n.data['area'] === 'string' && areas.has(normalizeTitle(stripLinkBrackets(n.data['area'] as string))));
  }
  if (c.expect.new_area) checks['new_area'] = createdTypes.includes('area');
  if (c.expect.created_types) checks['created_types'] = c.expect.created_types.every((t) => createdTypes.includes(t));
  if (c.expect.absent_types) checks['absent_types'] = !c.expect.absent_types.some((t) => createdTypes.includes(t));
  if (c.expect.touched_types) {
    const status = await git(vault, ['-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all']);
    const rels = status.stdout.split('\n').map((l) => l.slice(3).trim()).filter((p) => p.startsWith('nodes/') && p.endsWith('.md'));
    const types = await Promise.all(rels.map(async (rel) => String(splitFrontmatter(await fs.readFile(path.join(vault, rel), 'utf8').catch(() => '')).data['type'] ?? '')));
    checks['touched_types'] = c.expect.touched_types.every((t) => types.includes(t));
  }
  if (c.expect.resource_kind) {
    checks['resource_kind'] = created.some((n) => n.data['type'] === 'resource' && (String(n.data['kind'] ?? '') || (typeof n.data['url'] === 'string' ? kindFromUrl(n.data['url']) : '')) === c.expect.resource_kind);
  }
  if (c.expect.created_in) {
    checks['created_in'] = Object.entries(c.expect.created_in).every(([type, areas]) => {
      const allowed = new Set(areas.map(normalizeTitle));
      return created.some((n) => n.data['type'] === type && typeof n.data['area'] === 'string' && allowed.has(normalizeTitle(stripLinkBrackets(n.data['area']))));
    });
  }
  if (c.expect.in_new_map) {
    const maps = new Set(created.filter((n) => n.data['type'] === 'map' && typeof n.data['title'] === 'string').map((n) => normalizeTitle(n.data['title'] as string)));
    const islandAreas = new Set(created.filter((n) => n.data['type'] === 'area' && typeof n.data['map'] === 'string' && maps.has(normalizeTitle(stripLinkBrackets(n.data['map'] as string)))).map((n) => normalizeTitle(String(n.data['title'] ?? ''))));
    checks['in_new_map'] = maps.size > 0 && c.expect.in_new_map.every((type) => created.some((n) => n.data['type'] === type && typeof n.data['area'] === 'string' && islandAreas.has(normalizeTitle(stripLinkBrackets(n.data['area'] as string)))));
  }
  if (c.expect.node_state) {
    const want = c.expect.node_state;
    let ok: boolean | null = null;
    for (const dir of await fs.readdir(path.join(vault, 'nodes')).catch(() => [] as string[])) {
      for (const f of await fs.readdir(path.join(vault, 'nodes', dir)).catch(() => [] as string[])) {
        if (!f.endsWith('.md')) continue;
        const { data } = splitFrontmatter(await fs.readFile(path.join(vault, 'nodes', dir, f), 'utf8'));
        if (normalizeTitle(String(data['title'] ?? '')) !== normalizeTitle(want.title)) continue;
        ok = (!want.status || data['status'] === want.status) && Object.entries(want.fields ?? {}).every(([k, v]) => String(data[k]) === String(v));
      }
    }
    checks['node_state'] = ok;
  }
  if (c.expect.checkin) {
    const dir = path.join(vault, 'nodes', 'habits');
    let ok = false;
    for (const f of await fs.readdir(dir).catch(() => [] as string[])) {
      const { data } = splitFrontmatter(await fs.readFile(path.join(dir, f), 'utf8'));
      if (normalizeTitle(String(data['title'] ?? '')) !== normalizeTitle(c.expect.checkin)) continue;
      const list = Array.isArray(data['checkins']) ? data['checkins'].map((d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d))) : [];
      ok = list.includes(today());
    }
    checks['checkin'] = ok;
  }
  const values = Object.values(checks);
  const verdict = error ? 'error' : values.some((v) => v === false) ? 'fail' : values.some((v) => v === null) ? 'unobserved' : 'pass';
  if (verdict === 'fail' || verdict === 'error') failed++;
  results.push({ id: c.id, verdict, skillsFired: skills, filesChanged, checks, ...(created.length ? { created: created.map((n) => `${n.rel} (${String(n.data['type'])}, area: ${String(n.data['area'] ?? '-')}${n.data['kind'] ? `, kind: ${String(n.data['kind'])}` : ''}${n.data['url'] ? `, url: ${String(n.data['url'])}` : ''})`) } : {}), seconds: Math.round((Date.now() - started) / 1000),
    ...(summaryPath ? { summaryPath, summaryBefore: before?.summary, summaryAfter: after?.summary, yamlError: after?.yamlError } : {}),
    costUsd: result && result.type === 'result' ? result.costUsd : undefined, error: error && error.type === 'error' ? error.message : undefined,
    output: result && result.type === 'result' ? result.text.slice(0, 400) : '' });
  console.error(`${c.id}: ${verdict} (skills: ${skills.join(',') || '-'}; files changed: ${filesChanged})`);
  await fs.rm(vault, { recursive: true, force: true });
}
const summary = { model, total: results.length, failed, results };
await fs.writeFile(path.join(here, 'last-run.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exit(failed ? 1 : 0);
