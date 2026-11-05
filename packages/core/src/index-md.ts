import { daysBetween } from './dates';
import { mapApart } from './facets';
import { slugify } from './ids';
import { relationTitles } from './node';
import { resolveTitle, type LinkIndex } from './links';
import { isRetired, RETIRE_AFTER_DAYS } from './retired';
import { CLOSED_STATUSES, MIND_MAP, NODE_TYPES, type IndexFiles, type NodeType, type VaultNode } from './types';

const TYPE_LABEL: Record<NodeType, string> = {
  note: 'notes', idea: 'ideas', task: 'tasks', project: 'projects', goal: 'goals', habit: 'habits', area: 'areas',
  person: 'people', event: 'events', journal: 'journal', resource: 'resources', inbox: 'inbox', map: 'maps',
};

const byUpdatedDesc = (a: VaultNode, b: VaultNode): number => (b.fm.updated || '').localeCompare(a.fm.updated || '');
const byCreated = (a: VaultNode, b: VaultNode): number => (a.fm.created || '').localeCompare(b.fm.created || '') || (a.fm.id < b.fm.id ? -1 : a.fm.id > b.fm.id ? 1 : 0);

/** Kind fields worth a word in the index lines (the brain finds "the reel about X" without opening files). */
const LINE_FACETS: Partial<Record<NodeType, string[]>> = { resource: ['kind', 'platform'], goal: ['target', 'progress'], habit: ['cadence'], event: ['mood'], map: ['role'] };

function link(n: VaultNode): string {
  return `[[${n.fm.title}]]`;
}

/** One line per node: what it is and what it touches, so the brain can decide about it without opening the file. */
function lineFor(n: VaultNode): string {
  const parts = [`- ${link(n)} — ${n.fm.summary}`, n.fm.status];
  if (n.fm.due) parts.push(`due:${n.fm.due}`);
  if (n.fm.completed) parts.push(`completed:${n.fm.completed}`);
  if (n.fm.date && n.fm.type !== 'journal') parts.push(`date:${n.fm.date}`);
  for (const k of LINE_FACETS[n.fm.type] ?? []) {
    const v = n.fm.extra[k];
    if (v !== undefined && v !== null && v !== '' && !Array.isArray(v)) parts.push(`${k}:${String(v)}`);
  }
  if (n.fm.scheduled) parts.push(`sched:${n.fm.scheduled}`);
  if (n.fm.tags.length) parts.push(n.fm.tags.map((t) => `#${t}`).join(' '));
  const rel = relationTitles(n.fm);
  if (rel.people.length) parts.push(`people:${rel.people.map((p) => `[[${p}]]`).join(',')}`);
  if (rel.project) parts.push(`project:[[${rel.project}]]`);
  else if (rel.area) parts.push(`area:[[${rel.area}]]`);
  if (rel.map) parts.push(`map:[[${rel.map}]]`);
  if (rel.connects.length) parts.push(`connects:${rel.connects.map((c) => (c === MIND_MAP ? c : `[[${c}]]`)).join(',')}`);
  return `${parts.join(' · ')} → ${n.path}`;
}

/** File name of a category's sub-index under `index/by-area/`. */
export function areaIndexName(areaTitle: string): string {
  return `${slugify(areaTitle)}.md`;
}

export interface IndexOptions {
  now: string;
  today: string;
  /** Node id → category (area) id as the graph assigns it (VAULT-SPEC "Categories"); the by-area files follow it. */
  categoryOf?: ReadonlyMap<string, string>;
}

/** Where the retired nodes are listed: out of every file the brain reads to work (VAULT-SPEC "Index"). */
export const ARCHIVE_INDEX = 'index/archive.md';
const RETIRE_DAYS_TEXT = `${RETIRE_AFTER_DAYS}+ days ago`;
const archivedLine = (n: number): string => `Archived: ${n} → ${ARCHIVE_INDEX} (read it only for the past)`;

/** Lines of a list: the live nodes, and only a count of the retired ones (archived, dropped, finished long ago). */
function listLines(list: VaultNode[], retired: (n: VaultNode) => boolean): string[] {
  const live = list.filter((n) => !retired(n));
  const gone = list.length - live.length;
  const lines = live.map(lineFor);
  if (gone) lines.push('', archivedLine(gone));
  return lines;
}

/** Builds `INDEX.md` (router), `by-type/<type>.md` and `by-area/<area>.md` contents per VAULT-SPEC. */
export function buildIndexFiles(
  nodes: VaultNode[],
  links: LinkIndex,
  opts: IndexOptions,
): IndexFiles {
  const retired = (n: VaultNode): boolean => isRetired(n.fm.status, n.fm.completed, opts.today);
  const real = nodes.filter((n) => n.fm.type !== 'inbox');
  const inbox = nodes.filter((n) => n.fm.type === 'inbox').sort(byUpdatedDesc);
  const byType = new Map<NodeType, VaultNode[]>();
  for (const t of NODE_TYPES) byType.set(t, []);
  for (const n of nodes) byType.get(n.fm.type)?.push(n);
  for (const list of byType.values()) list.sort(byUpdatedDesc);

  const tasks = byType.get('task') ?? [];
  const openTasks = tasks.filter((t) => !CLOSED_STATUSES.has(t.fm.status));
  const overdue = openTasks.filter((t) => t.fm.due && daysBetween(t.fm.due, opts.today) > 0);
  const dueToday = openTasks.filter((t) => t.fm.due === opts.today);
  const doing = openTasks.filter((t) => t.fm.status === 'doing');
  const projects = (byType.get('project') ?? []).filter((p) => p.fm.status === 'active');
  const areas = byType.get('area') ?? [];
  // An area with a `map` belongs to that map's space (VAULT-SPEC "Maps"); the others make up the mind map.
  const mapOf = new Map<string, VaultNode>();
  for (const a of areas) {
    const title = relationTitles(a.fm).map;
    const m = title ? resolveTitle(links, title) : undefined;
    if (m && m.fm.type === 'map') mapOf.set(a.fm.id, m);
  }
  const maps = [...(byType.get('map') ?? [])].sort(byCreated);
  const areaLine = (a: VaultNode, indent = ''): string => {
    const projs = (byType.get('project') ?? []).filter((p) => relationTitles(p.fm).area === a.fm.title && p.fm.status === 'active').length;
    const open = openTasks.filter((t) => relationTitles(t.fm).area === a.fm.title).length;
    const members = opts.categoryOf ? [...opts.categoryOf.values()].filter((c) => c === a.fm.id).length - 1 : nodes.filter((n) => relationTitles(n.fm).area === a.fm.title).length;
    const counts = projs || open ? `projects: ${projs} · open tasks: ${open}` : `items: ${Math.max(0, members)}`;
    return `${indent}- ${link(a)} — ${a.fm.summary} · ${counts} → index/by-area/${areaIndexName(a.fm.title)}`;
  };

  const counts = NODE_TYPES.filter((t) => t !== 'inbox').map((t) => `${TYPE_LABEL[t]} ${byType.get(t)?.length ?? 0}`).join(' · ');
  const archived = real.filter(retired).length;
  const out: string[] = [];
  out.push(`# Vault index (generated ${opts.now}; do not edit)`);
  out.push('');
  out.push(`Nodes: ${real.length} (${counts}) · inbox: ${inbox.length} · archived: ${archived} (in ${ARCHIVE_INDEX}, read only for the past) · unresolved links: ${links.unresolved.size}`);
  out.push('');

  const mindAreas = areas.filter((a) => !mapOf.has(a.fm.id) && !retired(a));
  out.push(`## Areas (${mindAreas.length}) — the mind map's categories; each has a sub-index with every item in it, one line each`);
  for (const a of mindAreas) out.push(areaLine(a));
  out.push('');

  if (maps.length) {
    out.push(`## Maps (${maps.length}) — spaces beside the mind map, each with its own categories; file into a map's categories, link across maps only where they connect`);
    for (const m of maps) {
      const rel = relationTitles(m.fm);
      const bits = [`- ${link(m)} — ${m.fm.summary}`];
      if (m.fm.extra['role'] === 'character') bits.push('character (written by /character)');
      if (m.fm.status === 'archived') bits.push('archived');
      // A switched-off map (VAULT-SPEC "Maps") is connected to nothing, and nothing connects to it, until it is on again.
      const off = (title: string): boolean => { const t = resolveTitle(links, title); return Boolean(t && t.fm.type === 'map' && mapApart(t.fm.extra['apart'])); };
      const named = rel.connects.map((c) => (c === MIND_MAP ? c : `[[${c}]]${off(c) ? ' (switched off)' : ''}`));
      if (mapApart(m.fm.extra['apart'])) bits.push(`switched off: connected to nothing until the user switches it on${named.length ? ` (then: ${named.join(', ')})` : ''}`);
      else bits.push(`connects: ${named.length ? named.join(', ') : 'nothing'}`);
      out.push(bits.join(' · '));
      for (const a of areas) if (mapOf.get(a.fm.id)?.fm.id === m.fm.id && !retired(a)) out.push(areaLine(a, '  '));
    }
    out.push('');
  }

  out.push(`## Active projects (${projects.length})`);
  for (const p of projects) {
    const rel = relationTitles(p.fm);
    const mine = openTasks.filter((t) => relationTitles(t.fm).project === p.fm.title);
    const next = mine.sort((a, b) => (a.fm.due ?? '9999').localeCompare(b.fm.due ?? '9999'))[0];
    const bits = [`- ${link(p)} — ${p.fm.summary}`];
    if (rel.area) bits.push(`area: [[${rel.area}]]`);
    bits.push(`open tasks: ${mine.length}`);
    if (next) bits.push(`next: ${link(next)}`);
    out.push(bits.join(' · '));
  }
  out.push('');

  const goals = (byType.get('goal') ?? []).filter((g) => g.fm.status === 'active');
  out.push(`## Active goals (${goals.length})`);
  for (const g of goals) {
    const bits = [`- ${link(g)} — ${g.fm.summary}`];
    if (g.fm.extra['progress'] !== undefined) bits.push(`progress ${String(g.fm.extra['progress'])}%`);
    if (g.fm.extra['target']) bits.push(`target ${String(g.fm.extra['target'])}`);
    out.push(bits.join(' · '));
  }
  out.push('');

  const habits = (byType.get('habit') ?? []).filter((h) => h.fm.status === 'active');
  out.push(`## Habits (${habits.length})`);
  for (const h of habits) out.push(`- ${link(h)} — ${h.fm.summary}${h.fm.extra['cadence'] ? ` · ${String(h.fm.extra['cadence'])}` : ''}`);
  out.push('');

  out.push(`## Tasks: open ${openTasks.length} (overdue ${overdue.length}, due today ${dueToday.length}, doing ${doing.length}) → index/by-type/task.md`);
  const urgent = [...overdue, ...dueToday].slice(0, 10);
  for (const t of urgent) {
    const rel = relationTitles(t.fm);
    const bits = [`- ${link(t)} — due ${t.fm.due}`];
    if (rel.project) bits.push(`[[${rel.project}]]`);
    out.push(bits.join(' · '));
  }
  out.push('');

  out.push(`## Inbox (${inbox.length}) → nodes/inbox/`);
  for (const i of inbox.slice(0, 10)) out.push(`- ${link(i)} — ${i.fm.summary}`);
  out.push('');

  out.push('## Recently updated (10)');
  for (const n of real.filter((x) => !retired(x)).sort(byUpdatedDesc).slice(0, 10)) out.push(`- ${link(n)} (${n.fm.type}) — ${n.fm.summary}`);
  out.push('');

  out.push('## Sub-indexes');
  out.push(
    `- ${NODE_TYPES.filter((t) => t !== 'inbox').map((t) => `index/by-type/${t}.md (${byType.get(t)?.length ?? 0})`).join(' · ')}`,
  );
  out.push('');

  // What was archived or dropped, by kind: the brain opens it only to answer about the past.
  const archivedNodes = real.filter(retired);
  const archive = [`# Archive (${archivedNodes.length}) — generated ${opts.now}; do not edit`, '', `What was archived or dropped, and what was finished ${RETIRE_DAYS_TEXT}: out of the brain's daily reading, kept for the past. Read it only when the user asks about something old, finished or archived.`, ''];
  for (const t of NODE_TYPES) {
    const list = archivedNodes.filter((n) => n.fm.type === t).sort(byUpdatedDesc);
    if (list.length) archive.push(`## ${TYPE_LABEL[t]} (${list.length})`, ...list.map((n) => `${lineFor(n).replace(/ → /, ` · updated:${(n.fm.updated || '').slice(0, 10)} → `)}`), '');
  }
  const files: IndexFiles = { router: out.join('\n'), byType: {}, byArea: {}, archive: archive.join('\n') };
  for (const t of NODE_TYPES) {
    const list = byType.get(t) ?? [];
    files.byType[t] = [`# ${TYPE_LABEL[t]} (${list.length}) — generated ${opts.now}; do not edit`, '', ...listLines(list, retired), ''].join('\n');
  }
  // One file per category: what it holds, by kind, so filing and linking inside it read one short file.
  for (const a of areas) {
    const members = nodes.filter((n) => n.fm.id !== a.fm.id && n.fm.type !== 'inbox' && n.fm.type !== 'area' && n.fm.type !== 'map'
      && (opts.categoryOf ? opts.categoryOf.get(n.fm.id) === a.fm.id : relationTitles(n.fm).area === a.fm.title));
    const inMap = mapOf.get(a.fm.id);
    const lines = [`# ${a.fm.title} (${members.length}) — generated ${opts.now}; do not edit`, '', `${a.fm.summary}${inMap ? ` · in map ${link(inMap)}` : ''}`, ''];
    for (const t of NODE_TYPES) {
      const list = members.filter((n) => n.fm.type === t && !retired(n)).sort(byUpdatedDesc);
      if (!list.length) continue;
      lines.push(`## ${TYPE_LABEL[t]} (${list.length})`, ...list.map(lineFor), '');
    }
    const gone = members.filter(retired).length;
    if (gone) lines.push(archivedLine(gone), '');
    files.byArea[areaIndexName(a.fm.title)] = lines.join('\n');
  }
  return files;
}
