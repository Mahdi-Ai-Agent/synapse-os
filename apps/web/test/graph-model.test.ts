import type { CategoryInfo, MapInfo } from '@synapse/core';
import { describe, expect, it } from 'vitest';
import { autoTone, categoryHue, toneOfHex, zoneHue } from '../src/graph/colors';
import { buildGraphModel, familyTones, groupKey, modelShape, withColorDraft } from '../src/graph/model';
import { ARCHIVE_GROUP, computeAnchors, CORE_GROUP, INBOX_GROUP, JOURNAL_GROUP, MAP_GROUP, UNSORTED_GROUP } from '../src/graph/layout';
import type { UiGraphNode } from '../src/lib/types';

const node = (id: string, type: UiGraphNode['type'], category: string | null, extra: Partial<UiGraphNode> = {}): UiGraphNode => ({
  id, type, title: id, summary: '', status: 'active', tags: [], path: null, created: null, updated: null, due: null, completed: null, priority: null, area: null, project: null,
  inDegree: 0, outDegree: 0, ghost: false, category, categorySource: category ? 'area' : null, map: null, facets: {}, ...extra,
});

describe('graph/model', () => {
  const cats = [
    { id: 'work', title: 'Work', summary: '', status: 'active', color: null, order: 0, size: 3, map: null },
    { id: 'health', title: 'سلامتی', summary: '', status: 'active', color: '#34d399', order: 1, size: 1, map: null },
  ];
  const nodes = [
    node('work', 'area', 'work'), node('p', 'project', 'work'), node('t', 'task', 'work', { status: 'done', project: 'p' }), node('t2', 'task', 'work', { project: 'p' }),
    node('g', 'goal', 'work', { facets: { progress: 40 } }),
    node('health', 'area', 'health'), node('in', 'inbox', null), node('j', 'journal', null), node('lone', 'idea', null),
    node('tag:x', 'tag', null),
  ];
  const edges = [
    { id: 'a', source: 'p', target: 'work', kind: 'belongs_to' as const },
    { id: 'b', source: 't', target: 'p', kind: 'belongs_to' as const },
    { id: 'c', source: 'p', target: 'tag:x', kind: 'tag' as const },
    { id: 'd', source: 't', target: 'tag:x', kind: 'tag' as const },
  ];
  const m = buildGraphModel(nodes, edges, cats, { inbox: 'Inbox', journal: 'Journal', unsorted: 'Unsorted', archive: 'Archive', count: (n) => `${n} items`, connected: 'Linked', apart: 'Apart' });
  const by = (id: string) => m.nodes.find((n) => n.id === id)!;

  it('puts nodes in their category or a special group', () => {
    expect(groupKey({ category: null, type: 'inbox' })).toBe(INBOX_GROUP);
    expect(by('p').group).toBe('work');
    expect(by('in').group).toBe(INBOX_GROUP);
    expect(by('j').group).toBe(JOURNAL_GROUP);
    expect(by('lone').group).toBe(UNSORTED_GROUP);
    expect(by('tag:x').group).toBe('work');
  });

  it('marks hubs, tiers and closed nodes', () => {
    expect(by('work')).toMatchObject({ hub: true, tier: 'hub' });
    expect(by('p').tier).toBe('major');
    expect(by('t').closed).toBe(true);
    expect(by('work').rank).toBeGreaterThan(by('p').rank);
  });

  it('draws progress into the shapes: a goal from its field, a project from its tasks', () => {
    expect(by('g').progress).toBeCloseTo(0.4);
    expect(by('p').progress).toBeCloseTo(0.5);
    expect(by('lone').progress).toBe(-1);
  });

  it('lists present groups with categories first, in order', () => {
    expect(m.groups.map((g) => g.id)).toEqual(['work', 'health', INBOX_GROUP, JOURNAL_GROUP, UNSORTED_GROUP, ARCHIVE_GROUP]);
    // The finished task sits in the archive corner, so its two links to live items are not drawn.
    expect(m.links).toHaveLength(2);
  });

  it('gives members of one category one hue family', () => {
    const [a, b] = [by('work').color, by('p').color];
    const hueOf = (c: number[]) => Math.atan2(c[1]! - c[2]!, c[0]! - c[1]!);
    expect(Math.abs(hueOf(a) - hueOf(b))).toBeLessThan(0.6);
  });

  it('changes its shape when anything but a colour changes', () => {
    const renamed = buildGraphModel(nodes.map((n) => (n.id === 'p' ? { ...n, title: 'Renamed' } : n)), edges, cats, { inbox: 'Inbox', journal: 'Journal', unsorted: 'Unsorted', archive: 'Archive', count: (n) => `${n} items`, connected: 'Linked', apart: 'Apart' });
    expect(modelShape(renamed)).not.toBe(modelShape(m));
  });
});

describe('graph/model colours', () => {
  const titles = { inbox: 'Inbox', journal: 'Journal', unsorted: 'Unsorted', archive: 'Archive', count: (n: number) => `${n}`, connected: 'Linked', apart: 'Apart' };
  const cat = (id: string, color: string | null, map: string | null, order: number): CategoryInfo => ({ id, title: id, summary: '', status: 'active', color, order, size: 1, map });
  const island = (id: string, color: string | null, order = 0): MapInfo => ({ id, title: id, summary: '', status: 'active', role: null, symbol: 'star', color, connects: ['mind'], apart: false, kept: ['mind'], order, areas: 1, size: 2 });

  it("gives a category its own colour first, then its island's, then its place in the sequence", () => {
    const tones = familyTones([cat('a', null, 'shop', 0), cat('b', '#22d3ee', 'shop', 1), cat('c', null, null, 2)], [island('shop', '#e07a5f')]);
    expect(tones.get('a')).toEqual(toneOfHex('#e07a5f'));
    expect(tones.get('b')).toEqual(toneOfHex('#22d3ee'));
    expect(tones.get('c')).toEqual(autoTone(categoryHue(2)));
    expect(tones.get(MAP_GROUP + 'shop')).toEqual(toneOfHex('#e07a5f'));
    // Without a colour of its own an island keeps its place in the island sequence.
    expect(familyTones([cat('a', null, 'shop', 0)], [island('shop', null, 3)]).get('a')).toEqual(autoTone(zoneHue(3, null)));
  });

  it("recolours an island's centre, regions, items and haze from its colour, and nothing else", () => {
    const nodes = [node('shop', 'map', null), node('a', 'area', 'a', { map: 'shop' }), node('x', 'idea', 'a', { map: 'shop' })];
    const before = buildGraphModel(nodes, [], [cat('a', null, 'shop', 0)], titles, [island('shop', null)]);
    const after = buildGraphModel(nodes, [], [cat('a', null, 'shop', 0)], titles, [island('shop', '#3b82f6')]);
    const colourOf = (mm: typeof before, id: string) => mm.nodes.find((n) => n.id === id)!.color;
    for (const id of ['shop', 'a', 'x']) expect(colourOf(after, id)).not.toEqual(colourOf(before, id));
    expect(after.zones[0]!.glow).not.toEqual(before.zones[0]!.glow);
    expect(after.groups.find((g) => g.id === 'a')!.glow).not.toEqual(before.groups.find((g) => g.id === 'a')!.glow);
    expect(modelShape(after)).toBe(modelShape(before));
  });

  it('puts a colour being picked in place without touching the rest', () => {
    const list = [cat('a', null, null, 0), cat('b', '#22d3ee', null, 1)];
    expect(withColorDraft(list, null)).toBe(list);
    expect(withColorDraft(list, { id: 'elsewhere', color: '#ffffff' })).toBe(list);
    expect(withColorDraft(list, { id: 'a', color: '#ff0000' }).map((c) => c.color)).toEqual(['#ff0000', '#22d3ee']);
    expect(withColorDraft(list, { id: 'b', color: null, saved: true }).map((c) => c.color)).toEqual([null, null]);
    expect(list[0]!.color).toBeNull();
  });
});

describe('graph model: the archive corner', () => {
  const titles = { inbox: 'Inbox', journal: 'Journal', unsorted: 'Unsorted', archive: 'Archive', count: (n: number) => `${n}`, connected: 'Linked', apart: 'Apart' };
  const base = { summary: '', tags: [], path: null, created: null, updated: null, due: null, area: null, project: null, inDegree: 0, outDegree: 0, ghost: false, categorySource: null, map: null, facets: {} };
  const node = (id: string, type: string, status: string, completed: string | null = null, category: string | null = 'a') => ({ ...base, id, type, title: id, status, completed, category }) as never;

  it('puts finished and retired items in a switched-off archive region with no lines to live ones', () => {
    const nodes = [node('a', 'area', 'active', null, 'a'), node('live', 'task', 'todo'), node('old', 'task', 'done', '2026-09-01'), node('fresh', 'task', 'done', '2026-10-25'), node('gone', 'note', 'archived')];
    const edges = [{ id: 'e1', source: 'live', target: 'old', kind: 'link' }, { id: 'e2', source: 'old', target: 'gone', kind: 'link' }, { id: 'e3', source: 'live', target: 'fresh', kind: 'link' }] as never;
    const m = buildGraphModel(nodes, edges, [{ id: 'a', title: 'A', color: null, map: null, order: 0 }] as never, titles, [], '2026-10-31');
    const group = (id: string) => m.nodes.find((n) => n.id === id)!.group;
    // Finished work leaves its category at once (UI-DESIGN "Done and archived"); the brain still reads it for 30 days.
    expect([group('live'), group('fresh'), group('old'), group('gone'), group('a')]).toEqual(['a', ARCHIVE_GROUP, ARCHIVE_GROUP, ARCHIVE_GROUP, 'a']);
    expect(m.groups.find((g) => g.id === ARCHIVE_GROUP)).toMatchObject({ kind: 'archive', title: 'Archive' });
    expect(m.links.map((l) => `${l.source}-${l.target}`).sort()).toEqual(['old-gone']);
  });

  it('keeps the archive in a corner past every other region', () => {
    const order = [CORE_GROUP, 'a', 'b', ARCHIVE_GROUP];
    const sizes = new Map([[CORE_GROUP, 1], ['a', 6], ['b', 6], [ARCHIVE_GROUP, 4]]);
    const anchors = computeAnchors(order, sizes, 2);
    const arc = anchors.get(ARCHIVE_GROUP)!;
    for (const [g, a] of anchors) if (g !== ARCHIVE_GROUP) { expect(arc.x).toBeLessThan(a.x - a.radius); expect(arc.y).toBeLessThan(a.y - a.radius); }
    expect(computeAnchors(order, sizes, 2, undefined, new Map([[ARCHIVE_GROUP, [500, 500, 0]]])).get(ARCHIVE_GROUP)).toMatchObject({ x: 500, y: 500 });
  });
});
