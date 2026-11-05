import { McpServer, type AuthInfo, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  CLOSED_STATUSES,
  daysBetween,
  NODE_TYPES,
  STATUS_BY_TYPE,
  stripLinkBrackets,
  todayLocal,
  type CategoryInfo,
  type GraphData,
  type GraphNode,
  type MapInfo,
  type NodeType,
} from '@synapse/core';
import type { Ctx } from './context';

/**
 * The tools other apps get over MCP (docs/ARCHITECTURE.md "MCP connector"). Reading follows the brain's own order —
 * the index first, then search and lists, then one item at a time; writing goes through `VaultService` and lands as
 * one `mcp(<app>): …` commit per change, so Settings → History can undo it.
 */

export interface McpAccess {
  write: boolean;
  /** The app's name, for commit subjects and journal headings. */
  app: string;
  /** Origin of this server, for item links. */
  origin: string;
}

export function accessOf(auth: AuthInfo | undefined): McpAccess {
  const name = typeof auth?.extra?.['name'] === 'string' ? (auth.extra['name'] as string) : 'MCP';
  return { write: Boolean(auth?.scopes.includes('synapse:write')), app: name, origin: auth?.resource?.origin ?? '' };
}

const WRITABLE = ['note', 'idea', 'task', 'project', 'goal', 'habit', 'event', 'person', 'resource', 'area'] as const;
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD');
const BODY_MAX = 40_000;

const norm = (s: string): string => stripLinkBrackets(s).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const text = (s: string): CallToolResult => ({ content: [{ type: 'text', text: s }] });
const fail = (s: string): CallToolResult => ({ content: [{ type: 'text', text: s }], isError: true });
const json = <T extends Record<string, unknown>>(value: T, lead?: string): CallToolResult => ({
  content: [{ type: 'text', text: (lead ? `${lead}\n` : '') + JSON.stringify(value) }],
  structuredContent: value,
});

function instructions(write: boolean): string {
  return [
    "Synapse is the owner's second brain: a vault of typed items (notes, ideas, tasks, projects, goals, habits, events, people, resources and a journal), grouped into categories, and categories into maps (the mind map and side maps such as the character map).",
    'Start with `overview`; find items with `search`, `list_items` or `agenda`, and read one with `fetch`. Cite items by title and give their url. Never invent items.',
    '`about_owner` describes the owner (profile, character map, insights): use it to personalise answers and to write in their voice.',
    'The owner usually writes Persian; answer in the language they use.',
    write
      ? 'You may also save: `search` first so nothing is added twice, put each item in the best existing category from `overview`, keep summaries under 160 characters. Every change is one undoable step in Synapse.'
      : 'This connection is read-only.',
  ].join('\n');
}

export function buildMcpServer(ctx: Ctx, access: McpAccess): McpServer {
  const server = new McpServer({ name: 'synapse', title: 'Synapse', version: '0.1.0' }, { instructions: instructions(access.write) });
  const urlOf = (id: string): string => `${access.origin}/#item=${encodeURIComponent(id)}`;
  const graph = (): GraphData | null => (ctx.vault.exists ? ctx.vault.graph : null);
  const noVault = fail('This Synapse has no vault yet: open Synapse and create one first.');
  const cats = (g: GraphData): Map<string, CategoryInfo> => new Map(g.categories.map((c) => [c.id, c]));
  const findNode = (g: GraphData, ref: string): GraphNode | undefined => {
    const byId = g.nodes.find((n) => n.id === ref && !n.ghost);
    if (byId) return byId;
    const hit = ctx.vault.resolveTitle(ref);
    return hit ? g.nodes.find((n) => n.id === hit.fm.id) : undefined;
  };
  const findCategory = (g: GraphData, ref: string): CategoryInfo | undefined => g.categories.find((c) => c.id === ref || norm(c.title) === norm(ref));
  const findMap = (g: GraphData, ref: string): MapInfo | undefined => g.maps.find((m) => m.id === ref || norm(m.title) === norm(ref));
  const lineOf = (n: GraphNode, c: Map<string, CategoryInfo>): string => {
    const bits = [n.type, n.status, n.category ? c.get(n.category)?.title : null, n.due ? `due ${n.due}` : null].filter(Boolean).join(' · ');
    return `- ${n.title} (id ${n.id}) — ${bits}${n.summary && n.summary !== n.title ? ` — ${n.summary}` : ''}`;
  };

  server.registerTool('overview', {
    title: 'Overview of the vault',
    description: "Start here. The owner's index of their Synapse vault: maps and categories, how many items of each kind, active projects, open tasks with due dates and recent items, each with its id. Read it before searching or opening items.",
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    if (!graph()) return noVault;
    const index = ctx.vault.getIndex('INDEX') ?? '';
    const today = todayLocal();
    const weekday = new Date(`${today}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
    return text(`Today is ${weekday} ${today}. Open an item in Synapse at ${access.origin}/#item=<id>.\n\n${index}`);
  });

  server.registerTool('search', {
    title: 'Search the vault',
    description: "Search the owner's items by words, in Persian or English: titles, summaries, tags and text. Returns matches with id, title, url, kind, status, category and summary; read one with `fetch`.",
    inputSchema: z.object({
      query: z.string().min(1).max(300).describe('Words to look for'),
      kind: z.enum(NODE_TYPES).optional().describe('Only items of this kind'),
      limit: z.number().int().min(1).max(50).optional().describe('At most this many results (default 10)'),
    }),
    outputSchema: z.object({
      results: z.array(z.object({ id: z.string(), title: z.string(), url: z.string(), kind: z.string(), status: z.string(), category: z.string().nullable(), summary: z.string() })),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ query, kind, limit }) => {
    const g = graph();
    if (!g) return noVault;
    const c = cats(g);
    const want = limit ?? 10;
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const results = ctx.vault.search(query, Math.min(want * 4, 200))
      .filter((h) => !kind || h.type === kind)
      .slice(0, want)
      .map((h) => {
        const n = byId.get(h.id);
        return { id: h.id, title: h.title, url: urlOf(h.id), kind: h.type, status: h.status, category: n?.category ? c.get(n.category)?.title ?? null : null, summary: h.summary };
      });
    return json({ results }, results.length ? undefined : 'Nothing matched; try other words, or `list_items`.');
  });

  server.registerTool('fetch', {
    title: 'Open an item',
    description: 'Open one item in full: its kind, status, dates, category, people, links and backlinks, and its whole text.',
    inputSchema: z.object({ id: z.string().min(1).max(300).describe('The item id from search or a list (or its exact title)') }),
    outputSchema: z.object({ id: z.string(), title: z.string(), url: z.string(), text: z.string(), metadata: z.record(z.string(), z.unknown()) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ id }) => {
    const g = graph();
    if (!g) return noVault;
    const n = findNode(g, id);
    const detail = n ? ctx.vault.getDetail(n.id) : undefined;
    if (!n || !detail) return fail(`No item with the id or title "${id}". Use \`search\` to find it.`);
    const c = cats(g);
    const fm = detail.node.fm;
    const body = detail.node.body.length > BODY_MAX ? `${detail.node.body.slice(0, BODY_MAX)}\n\n[… the rest of the text is cut off]` : detail.node.body;
    const metadata: Record<string, unknown> = {
      kind: fm.type, status: fm.status, summary: fm.summary,
      category: n.category ? c.get(n.category)?.title ?? null : null,
      map: n.map ? g.maps.find((m) => m.id === n.map)?.title ?? null : null,
      tags: fm.tags, people: fm.people.map(stripLinkBrackets), project: fm.project ? stripLinkBrackets(fm.project) : null,
      due: fm.due ?? null, scheduled: fm.scheduled ?? null, priority: fm.priority ?? null, date: fm.date ?? null, completed: fm.completed ?? null,
      url: fm.url ?? null, created: fm.created, updated: fm.updated, facets: n.facets,
      links: detail.outgoing.filter((l) => l.resolved && l.title).map((l) => ({ id: l.target, title: l.title, kind: l.type })),
      backlinks: detail.backlinks.map((b) => ({ id: b.id, title: b.title, kind: b.type })),
    };
    return json({ id: fm.id, title: fm.title, url: urlOf(fm.id), text: body, metadata });
  });

  server.registerTool('list_items', {
    title: 'List items',
    description: 'List items by kind, category, map, status or tag, most recently changed first. Done and archived items are left out unless asked for.',
    inputSchema: z.object({
      kind: z.enum(NODE_TYPES).optional(),
      category: z.string().max(200).optional().describe('A category title or id (see `overview`)'),
      map: z.string().max(200).optional().describe('A map title or id'),
      status: z.string().max(40).optional(),
      tag: z.string().max(60).optional(),
      include_closed: z.boolean().optional().describe('Also list done, achieved, archived and dropped items'),
      limit: z.number().int().min(1).max(200).optional().describe('Default 40'),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (q) => {
    const g = graph();
    if (!g) return noVault;
    const c = cats(g);
    const category = q.category ? findCategory(g, q.category) : undefined;
    if (q.category && !category) return fail(`No category "${q.category}". Categories: ${g.categories.map((x) => x.title).join(', ')}.`);
    const map = q.map ? findMap(g, q.map) : undefined;
    if (q.map && !map) return fail(`No map "${q.map}". Maps: ${g.maps.map((x) => x.title).join(', ') || 'none besides the mind map'}.`);
    const tag = q.tag ? norm(q.tag.replace(/^#/, '')) : null;
    const items = g.nodes
      .filter((n) => !n.ghost && (q.kind ? n.type === q.kind : n.type !== 'inbox'))
      .filter((n) => !category || n.category === category.id)
      .filter((n) => !map || n.map === map.id || n.id === map.id)
      .filter((n) => !q.status || n.status === q.status)
      .filter((n) => !tag || n.tags.some((t) => norm(t) === tag))
      .filter((n) => q.include_closed || q.status || !CLOSED_STATUSES.has(n.status))
      .sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
    const shown = items.slice(0, q.limit ?? 40);
    if (!shown.length) return text('No items match.');
    return text(`${items.length} item(s)${items.length > shown.length ? `, the ${shown.length} most recent` : ''}:\n${shown.map((n) => lineOf(n, c)).join('\n')}`);
  });

  server.registerTool('agenda', {
    title: "What's on the owner's plate",
    description: 'Overdue tasks, tasks due today and in the next days, work in progress, active projects with their next task, active habits and goals, birthdays soon and what was finished this week.',
    inputSchema: z.object({ days: z.number().int().min(1).max(60).optional().describe('How far ahead to look (default 7)') }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ days }) => {
    const g = graph();
    if (!g) return noVault;
    const c = cats(g);
    const today = todayLocal();
    const ahead = days ?? 7;
    const live = g.nodes.filter((n) => !n.ghost);
    const tasks = live.filter((n) => n.type === 'task' && !CLOSED_STATUSES.has(n.status));
    const byDue = (a: GraphNode, b: GraphNode): number => (a.due ?? '9999').localeCompare(b.due ?? '9999');
    const overdue = tasks.filter((n) => n.due && daysBetween(n.due, today) > 0).sort(byDue);
    const dueToday = tasks.filter((n) => n.due === today);
    const upcoming = tasks.filter((n) => n.due && daysBetween(today, n.due) > 0 && daysBetween(today, n.due) <= ahead).sort(byDue);
    const doing = tasks.filter((n) => n.status === 'doing' && !overdue.includes(n) && !dueToday.includes(n) && !upcoming.includes(n));
    const projects = live.filter((n) => n.type === 'project' && n.status === 'active');
    const habits = live.filter((n) => n.type === 'habit' && n.status === 'active');
    const goals = live.filter((n) => n.type === 'goal' && n.status === 'active');
    const finished = live.filter((n) => n.completed && daysBetween(n.completed, today) >= 0 && daysBetween(n.completed, today) < 7);
    const birthdays = live.flatMap((n) => {
      const b = n.type === 'person' ? n.facets['birthday'] : undefined;
      const m = typeof b === 'string' ? /(\d{2})-(\d{2})$/.exec(b) : null;
      if (!m) return [];
      const md = `${m[1]}-${m[2]}`;
      let next = `${today.slice(0, 4)}-${md}`;
      if (daysBetween(today, next) < 0) next = `${Number(today.slice(0, 4)) + 1}-${md}`;
      const d = daysBetween(today, next);
      return d <= Math.max(ahead, 21) ? [`- ${n.title} (id ${n.id}) — birthday ${next}${d === 0 ? ' (today)' : ` (in ${d} days)`}`] : [];
    });
    const section = (title: string, lines: string[]): string => (lines.length ? `## ${title}\n${lines.join('\n')}\n` : '');
    const out = [
      `Today is ${today}.`,
      section('Overdue', overdue.map((n) => lineOf(n, c))),
      section('Due today', dueToday.map((n) => lineOf(n, c))),
      section(`Due in the next ${ahead} days`, upcoming.map((n) => lineOf(n, c))),
      section('In progress', doing.map((n) => lineOf(n, c))),

      section('Active projects and their next task', projects.map((p) => {
        const next = tasks.filter((t) => t.project === p.title).sort(byDue)[0];
        return `${lineOf(p, c)}\n  next: ${next ? `${next.title} (id ${next.id})${next.due ? ` due ${next.due}` : ''}` : 'no open task'}`;
      })),
      section('Active habits', habits.map((n) => lineOf(n, c))),
      section('Active goals', goals.map((n) => `${lineOf(n, c)}${n.facets['progress'] !== undefined ? ` — progress ${String(n.facets['progress'])}` : ''}`)),
      section('Birthdays soon', birthdays),
      section('Finished in the last 7 days', finished.map((n) => lineOf(n, c))),
    ].filter(Boolean);
    return text(out.length > 1 ? out.join('\n') : `Today is ${today}. Nothing is due and nothing is in progress.`);
  });

  server.registerTool('about_owner', {
    title: 'About the owner',
    description: "Who the owner is, as their vault shows them: their profile, the character map (traits, values, concerns and voice, with evidence) and the latest insights. Use it to personalise answers and to write in the owner's voice.",
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const g = graph();
    if (!g) return noVault;
    const [profile, insights] = await Promise.all([ctx.vault.readMemory('profile'), ctx.vault.readMemory('insights')]);
    const character = g.maps.find((m) => m.role === 'character');
    let charText = '';
    if (character) {
      const areas = g.categories.filter((a) => a.map === character.id);
      charText = areas.map((a) => {
        const items = g.nodes.filter((n) => n.category === a.id && n.id !== a.id && !n.ghost && !CLOSED_STATUSES.has(n.status));
        return `### ${a.title}\n${items.map((n) => `- ${n.title}${n.summary && n.summary !== n.title ? ` — ${n.summary}` : ''}`).join('\n') || '(empty)'}`;
      }).join('\n\n');
    }
    const parts = [
      profile ? `## Profile\n${profile.trim()}` : '',
      character ? `## Character map: ${character.title}\n${charText || '(no categories yet)'}` : '## Character map\nNot built yet (Synapse builds it with /character).',
      insights ? `## Insights\n${insights.trim().slice(0, 12_000)}` : '',
    ].filter(Boolean);
    return text(parts.join('\n\n'));
  });

  if (!access.write) return server;

  /** One change, one commit: pending edits are set apart first; while the brain runs, its own commit takes the change. */
  const commit = async (subject: string, change: () => Promise<void>): Promise<void> => {
    const quiet = !ctx.runner.busy;
    if (quiet) await ctx.git.snapshot('manual: edits');
    await change();
    if (quiet) await ctx.git.commitChanges(`mcp(${access.app}): ${subject}`);
  };
  const statusProblem = (kind: NodeType, status: string | undefined): string | null =>
    status && !STATUS_BY_TYPE[kind].includes(status) ? `A ${kind} can be ${STATUS_BY_TYPE[kind].join(', ')}; not "${status}".` : null;

  server.registerTool('add_item', {
    title: 'Add an item',
    description: 'Save something new as a typed item: a note, idea, task, project, goal, habit, event, person, resource, or a new category (kind "area"). Search first so nothing is added twice, and put it in the best existing category from `overview`.',
    inputSchema: z.object({
      kind: z.enum(WRITABLE),
      title: z.string().min(1).max(120).describe('Short and unique: other items link to it by title'),
      summary: z.string().max(160).optional().describe('One line, at most 160 characters'),
      body: z.string().max(20_000).optional().describe('Markdown; link other items as [[Title]]'),
      category: z.string().max(200).optional().describe('An existing category title or id'),
      project: z.string().max(120).optional().describe('Title of the project it belongs to'),
      people: z.array(z.string().max(120)).max(20).optional().describe('Names of people it mentions'),
      tags: z.array(z.string().max(40)).max(20).optional(),
      status: z.string().max(40).optional(),
      due: DATE.optional().describe('Tasks and goals: when it is due'),
      scheduled: DATE.optional().describe('Tasks: the day planned to work on it'),
      priority: z.number().int().min(1).max(4).optional().describe('1 = highest'),
      date: DATE.optional().describe('Events: the day it happened'),
      url: z.string().url().max(2000).optional().describe('Resources: the link'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    const g = graph();
    if (!g) return noVault;
    const bad = statusProblem(a.kind, a.status);
    if (bad) return fail(bad);
    const existing = ctx.vault.resolveTitle(a.title);
    if (existing) return fail(`An item called "${existing.fm.title}" exists already (id ${existing.fm.id}, ${existing.fm.type}). Use \`update_item\`, or pick another title.`);
    const category = a.category && a.kind !== 'area' ? findCategory(g, a.category) : undefined;
    if (a.category && a.kind !== 'area' && !category) return fail(`No category "${a.category}". Categories: ${g.categories.map((x) => x.title).join(', ')}.`);
    const missing = [...(a.project && !ctx.vault.resolveTitle(a.project) ? [a.project] : []), ...(a.people ?? []).filter((p) => !ctx.vault.resolveTitle(p))];
    let id = '';
    await commit(`add ${a.title}`, async () => {
      const node = await ctx.vault.createNode({
        type: a.kind, title: a.title, source: 'capture',
        ...(a.summary ? { summary: a.summary } : {}), ...(a.body ? { body: a.body.endsWith('\n') ? a.body : `${a.body}\n` } : {}),
        ...(category ? { area: `[[${category.title}]]` } : {}), ...(a.project ? { project: `[[${stripLinkBrackets(a.project)}]]` } : {}),
        ...(a.people?.length ? { people: a.people.map((p) => `[[${stripLinkBrackets(p)}]]`) } : {}),
        ...(a.tags?.length ? { tags: a.tags.map((t) => t.replace(/^#/, '')) } : {}),
        ...(a.status ? { status: a.status } : {}), ...(a.due ? { due: a.due } : {}), ...(a.scheduled ? { scheduled: a.scheduled } : {}),
        ...(a.priority ? { priority: a.priority } : {}), ...(a.date ? { date: a.date } : {}), ...(a.url ? { url: a.url } : {}),
      });
      id = node.fm.id;
    });
    const note = missing.length ? ` Not in the vault yet (shown as placeholders until added): ${missing.join(', ')}.` : '';
    return json({ id, title: a.title, url: urlOf(id), kind: a.kind, category: category?.title ?? null }, `Saved.${note}`);
  });

  server.registerTool('update_item', {
    title: 'Change an item',
    description: 'Change an existing item: its status (for example mark a task done), due or scheduled date, priority, summary, tags or category, or add text at the end of it. Its title and existing text stay as they are.',
    inputSchema: z.object({
      id: z.string().min(1).max(300).describe('The item id (or its exact title)'),
      status: z.string().max(40).optional(),
      due: DATE.optional(),
      scheduled: DATE.optional(),
      priority: z.number().int().min(1).max(4).optional(),
      summary: z.string().max(160).optional(),
      tags: z.array(z.string().max(40)).max(20).optional().describe('Replaces the tags'),
      category: z.string().max(200).optional().describe('Move it to this existing category (title or id)'),
      append: z.string().max(20_000).optional().describe('Markdown added at the end of its text'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    const g = graph();
    if (!g) return noVault;
    const n = findNode(g, a.id);
    const node = n ? ctx.vault.getNode(n.id) : undefined;
    if (!n || !node) return fail(`No item with the id or title "${a.id}". Use \`search\` to find it.`);
    const bad = statusProblem(node.fm.type, a.status);
    if (bad) return fail(bad);
    const category = a.category ? findCategory(g, a.category) : undefined;
    if (a.category && !category) return fail(`No category "${a.category}". Categories: ${g.categories.map((x) => x.title).join(', ')}.`);
    const fm = {
      ...(a.status ? { status: a.status } : {}), ...(a.due ? { due: a.due } : {}), ...(a.scheduled ? { scheduled: a.scheduled } : {}),
      ...(a.priority ? { priority: a.priority } : {}), ...(a.summary ? { summary: a.summary } : {}),
      ...(a.tags ? { tags: a.tags.map((t) => t.replace(/^#/, '')) } : {}), ...(category ? { area: `[[${category.title}]]` } : {}),
    };
    if (!Object.keys(fm).length && !a.append) return fail('Nothing to change: give a status, a date, a summary, tags, a category or text to append.');
    const body = a.append ? `${node.body.replace(/\s*$/, '')}\n\n${a.append.trim()}\n` : undefined;
    await commit(`update ${node.fm.title}`, async () => { await ctx.vault.updateNode(node.fm.id, { frontmatter: fm, ...(body !== undefined ? { body } : {}) }); });
    const after = ctx.vault.getNode(node.fm.id);
    return json({ id: node.fm.id, title: node.fm.title, url: urlOf(node.fm.id), status: after?.fm.status ?? node.fm.status }, 'Changed.');
  });

  server.registerTool('write_journal', {
    title: 'Write in the journal',
    description: "Add an entry to the owner's journal for today (or another day): a timestamped section in that day's journal item, created when missing.",
    inputSchema: z.object({ text: z.string().min(1).max(10_000).describe('Markdown'), date: DATE.optional().describe('Default: today') }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    if (!graph()) return noVault;
    const day = a.date ?? todayLocal();
    const now = new Date();
    const stamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const entry = `## ${stamp} — ${access.app}\n${a.text.trim()}\n`;
    const existing = ctx.vault.listNodes().find((n) => n.fm.type === 'journal' && (n.fm.date === day || n.fm.title === day));
    let id = existing?.fm.id ?? '';
    await commit(`journal ${day}`, async () => {
      if (existing) await ctx.vault.updateNode(existing.fm.id, { body: `${existing.body.replace(/\s*$/, '')}\n\n${entry}` });
      else id = (await ctx.vault.createNode({ type: 'journal', title: day, date: day, summary: a.text.trim().split('\n')[0]!.slice(0, 160), body: entry, source: 'capture' })).fm.id;
    });
    return json({ id, title: day, url: urlOf(id) }, 'Written.');
  });

  return server;
}
