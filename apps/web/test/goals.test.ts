import { describe, expect, it } from 'vitest';
import { goalPlans } from '../src/lib/goals';
import type { UiGraphNode } from '../src/lib/types';

const n = (id: string, type: string, extra: Partial<UiGraphNode> = {}): UiGraphNode => ({
  id, type, title: id, summary: '', status: type === 'task' ? 'todo' : 'active', tags: [], path: null, created: null, updated: null,
  due: null, completed: null, priority: null, area: null, project: null, inDegree: 0, outDegree: 0, ghost: false, category: null, categorySource: null, map: null, facets: {}, ...extra,
}) as UiGraphNode;

describe('goals with what serves them', () => {
  it('nests a linked project\'s tasks, keeps direct tasks, habits and notes apart, and counts progress from tasks', () => {
    const nodes = [
      n('run', 'goal', { facets: { target: '2027-03-01' } }), n('save', 'goal', { facets: { progress: 60 } }), n('old', 'goal', { status: 'achieved' }),
      n('plan', 'project'), n('t1', 'task', { project: 'plan', status: 'done' }), n('t2', 'task', { project: 'plan' }),
      n('shoes', 'task'), n('jog', 'habit'), n('why', 'note'), n('loose', 'task'),
    ];
    const edges = [{ source: 'run', target: 'plan' }, { source: 'shoes', target: 'run' }, { source: 'run', target: 'jog' }, { source: 'why', target: 'run' }];
    const plans = goalPlans(nodes, edges);
    expect(plans.map((p) => p.goal.id)).toEqual(['run', 'save', 'old']);
    const run = plans[0]!;
    expect(run.projects.map((p) => [p.project.id, p.tasks.map((t) => t.id)])).toEqual([['plan', ['t2', 't1']]]);
    expect(run.tasks.map((t) => t.id)).toEqual(['shoes']);
    expect(run.habits.map((h) => h.id)).toEqual(['jog']);
    expect(run.notes.map((x) => x.id)).toEqual(['why']);
    expect([run.open, run.total, run.progress]).toEqual([2, 3, 33]);
    expect(plans[1]!.progress).toBe(60);
  });
});
