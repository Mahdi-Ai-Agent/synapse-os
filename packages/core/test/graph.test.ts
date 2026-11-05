import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/graph';
import { buildIndexFiles } from '../src/index-md';
import { isRetired } from '../src/retired';
import { buildLinkIndex } from '../src/links';
import { scopesOf } from '../src/maps';
import { healNode, nodeRelPath, parseNodeFile, serializeNode, withCompleted } from '../src/node';
import type { VaultNode } from '../src/types';

function mk(path: string, text: string): VaultNode {
  const { node } = parseNodeFile(path, text);
  return healNode(node, { newId: () => `id-${path}`, now: () => '2026-10-31T10:00:00+03:30' }).node;
}

const area = mk('nodes/areas/سلامتی.md', '---\ntype: area\ntitle: سلامتی\nsummary: health area\nstatus: active\n---\n');
const project = mk('nodes/projects/fitness.md', '---\ntype: project\ntitle: برنامه‌ی تناسب اندام\nsummary: fitness plan\narea: "[[سلامتی]]"\nupdated: 2026-10-30T10:00:00+03:30\n---\nOutcome: run 5k.\n');
const person = mk('nodes/people/dr.md', '---\ntype: person\ntitle: دکتر رضایی\nsummary: my doctor\nrelation: doctor\n---\n');
const task = mk('nodes/tasks/call.md', '---\ntype: task\ntitle: تماس با دکتر رضایی\nsummary: call the doctor\nstatus: todo\ndue: 2026-10-30\nproject: "[[برنامه‌ی تناسب اندام]]"\npeople: ["[[دکتر رضایی]]"]\nupdated: 2026-10-31T09:00:00+03:30\n---\nSee [[Missing Note]] and [[سلامتی]].\n');

describe('links + graph', () => {
  const nodes = [area, project, person, task];
  const links = buildLinkIndex(nodes);
  const graph = buildGraph(nodes, links, '2026-10-31T10:00:00+03:30');

  it('derives typed edges and ghost nodes', () => {
    const kinds = graph.edges.filter((e) => e.source === task.fm.id).map((e) => e.kind).sort();
    expect(kinds).toEqual(['belongs_to', 'link', 'link', 'mentions']);
    const ghost = graph.nodes.find((n) => n.ghost);
    expect(ghost?.title).toBe('Missing Note');
    expect(graph.stats.unresolved).toBe(1);
  });

  it('computes degrees and backlinks', () => {
    const areaNode = graph.nodes.find((n) => n.id === area.fm.id);
    expect(areaNode?.inDegree).toBe(2); // project belongs_to + task link
    expect(links.backlinks.get(person.fm.id)?.has(task.fm.id)).toBe(true);
  });

  it('builds the router and by-type indexes', () => {
    const files = buildIndexFiles(nodes, links, { now: '2026-10-31T10:00:00+03:30', today: '2026-10-31' });
    expect(files.router).toContain('## Areas (1)');
    expect(files.router).toContain('overdue 1');
    expect(files.router).toContain('[[تماس با دکتر رضایی]] — due 2026-10-30 · [[برنامه‌ی تناسب اندام]]');
    expect(files.byType.task).toContain('→ nodes/tasks/call.md');
    expect(files.byType.task).toContain('project:[[برنامه‌ی تناسب اندام]]');
  });

  it('writes one sub-index per category with its members by kind, following the graph assignment', () => {
    const categoryOf = new Map(graph.nodes.filter((n) => n.category && !n.ghost).map((n) => [n.id, n.category as string]));
    const files = buildIndexFiles(nodes, links, { now: '2026-10-31T10:00:00+03:30', today: '2026-10-31', categoryOf });
    expect(Object.keys(files.byArea)).toEqual(['سلامتی.md']);
    const health = files.byArea['سلامتی.md'] ?? '';
    expect(health).toContain('# سلامتی (3)');
    expect(health).toContain('## projects (1)\n- [[برنامه‌ی تناسب اندام]]');
    expect(health).toContain('## tasks (1)\n- [[تماس با دکتر رضایی]]');
    expect(health).toContain('people:[[دکتر رضایی]]');
    expect(files.router).toContain('→ index/by-area/سلامتی.md');
  });

  it('puts an area with a map into that map, resolves connections from either side, and lists maps in the router', () => {
    const character = mk('nodes/maps/character.md', '---\ntype: map\ntitle: کاراکتر من\nsummary: who I am\nrole: character\nconnects: [mind]\ncreated: 2026-10-01T10:00:00+03:30\n---\n');
    const business = mk('nodes/maps/shop.md', '---\ntype: map\ntitle: فروشگاه\nsummary: the shop\nconnects: ["[[کاراکتر من]]"]\ncolor: "#E07A5F"\ncreated: 2026-10-02T10:00:00+03:30\n---\n');
    const voice = mk('nodes/areas/voice.md', '---\ntype: area\ntitle: لحن\nsummary: how I write\nmap: "[[کاراکتر من]]"\n---\n');
    const tone = mk('nodes/notes/tone.md', '---\ntype: note\ntitle: جمله‌های کوتاه\nsummary: short sentences\narea: "[[لحن]]"\n---\n');
    const all = [area, project, person, task, character, business, voice, tone];
    const l = buildLinkIndex(all);
    const g = buildGraph(all, l, '2026-10-31T10:00:00+03:30');
    expect(g.maps.map((m) => [m.title, m.role, m.symbol, m.connects, m.areas, m.size])).toEqual([
      ['کاراکتر من', 'character', 'person', ['mind', business.fm.id], 1, 2],
      ['فروشگاه', null, 'star', [character.fm.id], 0, 0],
    ]);
    // An island's own colour, lower-cased; none means the UI's sequence.
    expect(g.maps.map((m) => m.color)).toEqual([null, '#e07a5f']);
    expect(g.categories.find((c) => c.id === voice.fm.id)?.map).toBe(character.fm.id);
    expect(g.categories.find((c) => c.id === area.fm.id)?.map).toBeNull();
    expect(g.nodes.find((n) => n.id === tone.fm.id)).toMatchObject({ category: voice.fm.id, map: character.fm.id });
    expect(g.nodes.find((n) => n.id === character.fm.id)).toMatchObject({ category: null, map: null });
    expect(g.edges.some((e) => e.source === voice.fm.id && e.target === character.fm.id && e.kind === 'belongs_to')).toBe(true);
    const categoryOf = new Map(g.nodes.filter((n) => n.category && !n.ghost).map((n) => [n.id, n.category as string]));
    const files = buildIndexFiles(all, l, { now: '2026-10-31T10:00:00+03:30', today: '2026-10-31', categoryOf });
    expect(files.router).toContain('## Areas (1)');
    expect(files.router).toContain('## Maps (2)');
    expect(files.router).toContain('- [[کاراکتر من]] — who I am · character (written by /character) · connects: mind\n  - [[لحن]] — how I write · items: 1 → index/by-area/لحن.md');
    expect(files.router).toContain('- [[فروشگاه]] — the shop · connects: [[کاراکتر من]]');
    expect(files.byArea['لحن.md']).toContain('how I write · in map [[کاراکتر من]]');
    expect(files.byType.map).toContain('role:character');
    expect(files.byType.area).toContain('map:[[کاراکتر من]]');
  });

  it('keeps a switched-off map apart from everything without forgetting a connection', () => {
    const shop = mk('nodes/maps/shop.md', '---\ntype: map\ntitle: Shop\nsummary: the shop\nconnects: [mind, "[[Page]]"]\napart: true\ncreated: 2026-10-01T10:00:00+03:30\n---\n');
    const page = mk('nodes/maps/page.md', '---\ntype: map\ntitle: Page\nsummary: the page\nconnects: [mind]\ncreated: 2026-10-02T10:00:00+03:30\n---\n');
    const blog = mk('nodes/maps/blog.md', '---\ntype: map\ntitle: Blog\nsummary: the blog\nconnects: ["[[Shop]]"]\ncreated: 2026-10-03T10:00:00+03:30\n---\n');
    const all = [area, shop, page, blog];
    const l = buildLinkIndex(all);
    const g = buildGraph(all, l, '2026-10-31T10:00:00+03:30');
    expect(g.maps.map((m) => [m.title, m.apart, m.connects, m.kept])).toEqual([
      ['Shop', true, [], ['mind', blog.fm.id, page.fm.id]],
      ['Page', false, ['mind'], ['mind', shop.fm.id]],
      ['Blog', false, [], [shop.fm.id]],
    ]);
    expect(scopesOf(g.maps).map((s) => [s.id, s.maps.map((m) => m.title)])).toEqual([['mind', ['Page']], [shop.fm.id, ['Shop']], [blog.fm.id, ['Blog']]]);
    const files = buildIndexFiles(all, l, { now: '2026-10-31T10:00:00+03:30', today: '2026-10-31' });
    expect(files.router).toContain('- [[Shop]] — the shop · switched off: connected to nothing until the user switches it on (then: mind, [[Page]])');
    expect(files.router).toContain('- [[Page]] — the page · connects: mind');
    expect(files.router).toContain('- [[Blog]] — the blog · connects: [[Shop]] (switched off)');
    // Switched on again (the key removed), every connection counts as it did.
    const on = mk('nodes/maps/shop.md', '---\ntype: map\ntitle: Shop\nsummary: the shop\nconnects: [mind, "[[Page]]"]\ncreated: 2026-10-01T10:00:00+03:30\n---\n');
    const back = [area, on, page, blog];
    const g2 = buildGraph(back, buildLinkIndex(back), '2026-10-31T10:00:00+03:30');
    expect(g2.maps.map((m) => [m.title, m.apart, m.connects])).toEqual([
      ['Shop', false, ['mind', blog.fm.id, page.fm.id]],
      ['Page', false, ['mind', shop.fm.id]],
      ['Blog', false, [shop.fm.id]],
    ]);
    expect(scopesOf(g2.maps)).toHaveLength(1);
  });

  it('keeps archived and dropped nodes out of the files the brain reads to work, in index/archive.md', () => {
    const old = mk('nodes/notes/old.md', '---\ntype: note\ntitle: Old\nsummary: old\nstatus: archived\nupdated: 2026-09-01T10:00:00+03:30\n---\n');
    const fresh = mk('nodes/notes/new.md', '---\ntype: note\ntitle: New\nsummary: new\nstatus: active\n---\n');
    const dropped = mk('nodes/tasks/gone.md', '---\ntype: task\ntitle: Gone\nsummary: gone\nstatus: dropped\n---\n');
    const all = [old, fresh, dropped];
    const files = buildIndexFiles(all, buildLinkIndex(all), { now: '2026-10-31T10:00:00+03:30', today: '2026-10-31' });
    const note = files.byType.note ?? '';
    expect(note).toContain('[[New]]');
    expect(note).not.toContain('[[Old]]');
    expect(note).toContain('Archived: 1 → index/archive.md');
    expect(files.router).toContain('archived: 2 (in index/archive.md');
    expect(files.router).not.toMatch(/Recently updated[\s\S]*\[\[Old\]\]/);
    expect(files.archive).toContain('# Archive (2)');
    expect(files.archive).toContain('## notes (1)\n- [[Old]] — old · archived · updated:2026-09-01 → nodes/notes/old.md');
    expect(files.archive).toContain('## tasks (1)\n- [[Gone]] — gone · dropped');
  });
});

describe('completed follows status', () => {
  const deps = { newId: () => 'id', now: () => '2026-10-31T10:00:00+03:30' };
  it('stamps a finished item with the day of its last edit and drops the stamp when it reopens', () => {
    const done = mk('nodes/tasks/d.md', '---\ntype: task\ntitle: D\nsummary: d\nstatus: done\nupdated: 2026-10-30T10:00:00+03:30\n---\n');
    expect(done.fm.completed).toBe('2026-10-30');
    expect(serializeNode(done)).toContain('completed: 2026-10-30');
    const reopened = healNode({ ...done, fm: { ...done.fm, status: 'todo' } }, deps).node;
    expect(reopened.fm.completed).toBeUndefined();
    expect(withCompleted({ ...done.fm, status: 'achieved', completed: '2026-10-01' }, '2026-10-31').completed).toBe('2026-10-01');
    expect(withCompleted({ ...reopened.fm, status: 'done' }, '2026-10-31').completed).toBe('2026-10-31');
  });
});

describe('node parse/serialize', () => {
  it('fills defaults and reports problems', () => {
    const { node, problems } = parseNodeFile('nodes/notes/x.md', 'plain body only\n');
    expect(node.fm.type).toBe('note');
    expect(node.fm.title).toBe('x');
    expect(node.fm.summary).toBe('plain body only');
    expect(problems.map((p) => p.code)).toEqual(expect.arrayContaining(['no-frontmatter', 'id-missing']));
  });

  it('serializes in canonical order, omitting empty lists', () => {
    const text = serializeNode(task);
    const lines = text.split('\n');
    expect(lines[0]).toBe('---');
    expect(lines[1]).toMatch(/^id: /);
    expect(lines[2]).toBe('type: task');
    expect(text).not.toContain('tags:');
    expect(text).toContain('people:\n  - "[[دکتر رضایی]]"');
  });

  it('builds collision-free relative paths', () => {
    const taken = new Set(['nodes/tasks/تماس-با-دکتر-رضایی.md']);
    expect(nodeRelPath('task', 'تماس با دکتر رضایی', taken)).toBe('nodes/tasks/تماس-با-دکتر-رضایی-2.md');
    expect(nodeRelPath('journal', 'ignored', new Set(), { date: '2026-10-31' })).toBe('nodes/journal/2026-10-31.md');
  });
});

describe('journal nodes and broken frontmatter', () => {
  it('keeps a date-named file title and infers the journal date from the file name', () => {
    const { node, problems } = parseNodeFile('nodes/journal/2026-10-31.md', '## 08:15\nran lightly\n');
    expect(node.fm.title).toBe('2026-10-31');
    expect(node.fm.date).toBe('2026-10-31');
    expect(problems.map((p) => p.code)).not.toContain('journal-date');
  });

  it('recovers an unquoted colon in a value, and reports unrecoverable YAML as an error', () => {
    const recovered = parseNodeFile('nodes/notes/x.md', '---\ntype: note\ntitle: x\nsummary: a: b\n---\nbody\n');
    expect(recovered.node.fm.summary).toBe('a: b');
    expect(recovered.problems.map((p) => p.code)).toContain('yaml-recovered');
    const broken = parseNodeFile('nodes/notes/y.md', '---\n- just: [a list\n{ nope\n---\nbody\n');
    expect(broken.problems.some((p) => p.code === 'yaml' && p.severity === 'error')).toBe(true);
  });
});

describe('retired', () => {
  it('retires finished work after 30 days, out of the daily index and into the archive', () => {
    const recent = mk('nodes/tasks/recent.md', '---\ntype: task\ntitle: Recent\nsummary: r\nstatus: done\ncompleted: 2026-10-20\n---\n');
    const long = mk('nodes/tasks/long.md', '---\ntype: task\ntitle: Long ago\nsummary: l\nstatus: done\ncompleted: 2026-09-15\n---\n');
    const open = mk('nodes/tasks/open.md', '---\ntype: task\ntitle: Open\nsummary: o\nstatus: todo\n---\n');
    const all = [recent, long, open];
    const files = buildIndexFiles(all, buildLinkIndex(all), { now: '2026-10-31T10:00:00+03:30', today: '2026-10-31' });
    expect(files.byType.task).toContain('[[Recent]]');
    expect(files.byType.task).not.toContain('[[Long ago]]');
    expect(files.archive).toContain('[[Long ago]] — l · done · completed:2026-09-15');
    expect(isRetired('done', '2026-10-01', '2026-10-31')).toBe(true);
    expect(isRetired('done', '2026-10-02', '2026-10-31')).toBe(false);
    expect(isRetired('achieved', null, '2026-10-31')).toBe(false);
    expect(isRetired('dropped', null, '2026-10-31')).toBe(true);
    expect(isRetired('active', null, '2026-10-31')).toBe(false);
  });
});
