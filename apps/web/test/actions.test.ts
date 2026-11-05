import { describe, expect, it } from 'vitest';
import { actionsByCategory, byAction, isUrgent } from '../src/lib/actions';
import type { UiGraphNode } from '../src/lib/types';

const n = (id: string, type: string, status: string, extra: Partial<UiGraphNode> = {}): UiGraphNode => ({
  id, type, title: id, summary: '', status, tags: [], path: null, created: null, updated: null, due: null, completed: null, priority: null,
  area: null, project: null, inDegree: 0, outDegree: 0, ghost: false, category: 'work', categorySource: null, map: null, facets: {}, ...extra,
}) as UiGraphNode;

describe('actions', () => {
  const today = '2026-11-02';
  it('lists what asks for action by category, the most urgent categories first', () => {
    const nodes = [
      n('later', 'task', 'todo', { priority: 3 }),
      n('soon', 'task', 'todo', { due: '2026-11-03' }),
      n('p1', 'task', 'doing', { priority: 1, category: 'health' }),
      n('proj', 'project', 'active'),
      n('goal', 'goal', 'active', { category: null }),
      n('done', 'task', 'done', { completed: '2026-11-01' }),
      n('old', 'task', 'dropped'),
      n('note', 'note', 'active'),
    ];
    const groups = actionsByCategory(nodes, today);
    expect(groups.map((g) => [g.category, g.items.map((x) => x.id), g.urgent])).toEqual([
      ['work', ['later', 'soon', 'proj'], 1],
      ['health', ['p1'], 1],
      [null, ['goal'], 0],
    ]);
  });
  it('orders tasks by priority then due date, and calls overdue, near or priority-1 tasks urgent', () => {
    const a = n('a', 'task', 'todo', { priority: 2, due: '2026-12-01' });
    const b = n('b', 'task', 'todo', { priority: 2, due: '2026-11-10' });
    const c = n('c', 'task', 'todo');
    expect([a, c, b].sort(byAction).map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(isUrgent(n('x', 'task', 'todo', { due: '2026-10-30' }), today)).toBe(true);
    expect(isUrgent(n('y', 'task', 'todo', { due: '2026-11-20' }), today)).toBe(false);
    expect(isUrgent(n('z', 'task', 'todo', { priority: 1 }), today)).toBe(true);
  });
});
