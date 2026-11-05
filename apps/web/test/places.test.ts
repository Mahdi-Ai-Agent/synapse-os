import { describe, expect, it } from 'vitest';
import { analysisLead, analysisTitle, membersOf, placeIdOf, placeStats, sectionText, spacesOf, treeOf } from '../src/lib/places';
import type { UiGraphNode } from '../src/lib/types';

const n = (id: string, type: string, extra: Partial<UiGraphNode> = {}): UiGraphNode => ({
  id, type, title: id, summary: '', status: type === 'task' ? 'todo' : 'active', tags: [], path: null, created: '2026-10-01T10:00:00+03:30', updated: '2026-10-20T10:00:00+03:30',
  due: null, completed: null, priority: null, area: null, project: null, inDegree: 0, outDegree: 0, ghost: false, category: 'work', categorySource: null, map: null, facets: {}, ...extra,
}) as UiGraphNode;
const cat = (id: string, map: string | null, order: number, status = 'active') => ({ id, title: id, summary: '', status, color: null, order, size: 1, map });
const map = (id: string, order: number, status = 'active') => ({ id, title: id, summary: '', status, role: null, symbol: 'star', color: null, connects: [], apart: false, kept: [], order, areas: 0, size: 0 });

describe('places', () => {
  const today = '2026-11-02';
  const nodes = [
    n('t1', 'task', { due: '2026-11-03' }),
    n('t2', 'task', { status: 'done', completed: '2026-09-01' }),
    n('note', 'note', { updated: '2026-09-01T10:00:00+03:30' }),
    n('shop1', 'idea', { category: 'shop', map: 'biz' }),
    n('loose', 'note', { category: null }),
    n('area', 'area', { category: 'work' }),
  ];

  it('lists the mind map, then each live map, each with its live categories', () => {
    const spaces = spacesOf([cat('work', null, 0), cat('shop', 'biz', 1), cat('old', null, 2, 'archived')] as never, [map('biz', 0), map('gone', 1, 'archived')] as never);
    expect(spaces.map((s) => [s.id, s.categories.map((c) => c.id)])).toEqual([['mind', ['work']], ['map:biz', ['shop']]]);
  });

  it('knows what a place holds and its numbers', () => {
    expect(membersOf('work', nodes, today).map((x) => x.id)).toEqual(['t1', 't2', 'note']);
    expect(membersOf('map:biz', nodes, today).map((x) => x.id)).toEqual(['shop1']);
    expect(membersOf('mind', nodes, today).map((x) => x.id)).toEqual(['t1', 't2', 'note']);
    expect(membersOf('__unsorted', nodes, today).map((x) => x.id)).toEqual(['loose']);
    expect(membersOf('__archive', nodes, today).map((x) => x.id)).toEqual(['t2']);
    expect(placeStats(membersOf('work', nodes, today), today)).toEqual({ items: 2, open: 1, urgent: 1, last: '2026-10-20' });
  });

});

describe('place analyses', () => {
  it('reads what an analysis says in short, also when a model skipped the headings', () => {
    expect(analysisLead('# کار — analysis, 2026-11-02\n\n## In short\nدو پروژه پیش می‌رود.\n\n## Moving\n- [[Synapse app]]\n')).toBe('دو پروژه پیش می‌رود.');
    expect(analysisLead('# کار (Work)\n\n**Two tracks:** the app and the site.\n\nMore.\n')).toBe('**Two tracks:** the app and the site.');
    expect(analysisLead('# Only a title\n')).toBeNull();
    expect(sectionText('## Next steps\n1. Call\n## In short\nx', /^next steps$/i)).toBe('1. Call');
  });

  it('knows a place analysis by its prompt and finds the place it names', () => {
    expect(analysisTitle('[[کار]] → memory/places/کار.md')).toBe('کار');
    expect(analysisTitle('[[پیج عکاسی]] → memory/places/پیج-عکاسی.md')).toBe('پیج عکاسی');
    expect(analysisTitle('[[کار]]')).toBeNull();
    expect(analysisTitle('analyze me')).toBeNull();
    const cats = [cat('work', null, 0)] as never;
    const maps = [map('biz', 0)] as never;
    expect(placeIdOf('work', cats, maps)).toBe('work');
    expect(placeIdOf('biz', cats, maps)).toBe('map:biz');
    expect(placeIdOf('gone', cats, maps)).toBeNull();
  });
});

describe('a place from the whole to its parts', () => {
  it('puts tasks under their project, moments under their person, links under a goal, the rest by kind', () => {
    const today = '2026-11-02';
    const items = [
      n('site', 'project', { title: 'Site' }), n('t1', 'task', { project: 'Site' }), n('t2', 'task'),
      n('g', 'goal'), n('ali', 'person'), n('m', 'event'), n('idea', 'idea'),
      n('old', 'task', { status: 'archived' }),
    ];
    const edges = [{ source: 'g', target: 'site', kind: 'link' }, { source: 'm', target: 'ali', kind: 'mentions' }, { source: 't2', target: 'g', kind: 'link' }];
    const tree = treeOf(items, edges, today);
    expect(tree.branches.map((b) => [b.node.id, b.children.map((c) => c.id)])).toEqual([['g', ['site', 't2']], ['site', ['t1']], ['ali', ['m']]]);
    expect(tree.loose.map((g) => [g.kind, g.items.map((x) => x.id)])).toEqual([['task', ['t2']], ['idea', ['idea']]]);
    expect(tree.retired.map((x) => x.id)).toEqual(['old']);
  });
});
