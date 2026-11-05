import { CLOSED } from '../graph/model';
import type { UiGraphNode } from './types';

/**
 * Every goal with what serves it (UI-DESIGN "Goals"): the projects and habits linked to it (the brain links them,
 * VAULT-SPEC "Goals and habits"), each project's tasks, tasks linked to it directly, and the notes, ideas and moments
 * that weigh on it (decisions, thoughts). Progress is the goal's own when it has one, else the share of its tasks done.
 */
export interface GoalPlan {
  goal: UiGraphNode;
  projects: Array<{ project: UiGraphNode; tasks: UiGraphNode[] }>;
  tasks: UiGraphNode[];
  habits: UiGraphNode[];
  notes: UiGraphNode[];
  progress: number | null;
  open: number;
  total: number;
}

const NOTE_KINDS = new Set(['note', 'idea', 'event', 'resource']);
const LIVE_GOAL = new Set(['active', 'paused']);

const byOpenThenDue = (a: UiGraphNode, b: UiGraphNode): number =>
  (CLOSED.has(a.status) ? 1 : 0) - (CLOSED.has(b.status) ? 1 : 0) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title);

export function goalPlans(nodes: readonly UiGraphNode[], edges: readonly { source: string; target: string }[]): GoalPlan[] {
  const byId = new Map(nodes.filter((n) => !n.ghost).map((n) => [n.id, n]));
  const plans: GoalPlan[] = [];
  for (const goal of nodes.filter((n) => n.type === 'goal' && !n.ghost)) {
    const linked = new Map<string, UiGraphNode>();
    for (const e of edges) {
      const other = e.source === goal.id ? e.target : e.target === goal.id ? e.source : null;
      const n = other ? byId.get(other) : undefined;
      if (n && n.id !== goal.id && n.type !== 'goal') linked.set(n.id, n);
    }
    const list = [...linked.values()];
    const projects = list.filter((n) => n.type === 'project').sort(byOpenThenDue)
      .map((project) => ({ project, tasks: nodes.filter((n) => n.type === 'task' && n.project === project.title).sort(byOpenThenDue) }));
    const inProjects = new Set(projects.flatMap((p) => p.tasks.map((t) => t.id)));
    const tasks = list.filter((n) => n.type === 'task' && !inProjects.has(n.id)).sort(byOpenThenDue);
    const habits = list.filter((n) => n.type === 'habit').sort(byOpenThenDue);
    const notes = list.filter((n) => NOTE_KINDS.has(n.type)).sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''));
    const all = [...projects.flatMap((p) => p.tasks), ...tasks];
    const open = all.filter((t) => !CLOSED.has(t.status)).length;
    const own = typeof goal.facets['progress'] === 'number' ? (goal.facets['progress'] as number) : null;
    const progress = own ?? (all.length ? Math.round(((all.length - open) / all.length) * 100) : null);
    plans.push({ goal, projects, tasks, habits, notes, progress, open, total: all.length });
  }
  // Goals still on their way first, the nearest target first; reached and dropped ones after.
  return plans.sort((a, b) => (LIVE_GOAL.has(a.goal.status) ? 0 : 1) - (LIVE_GOAL.has(b.goal.status) ? 0 : 1)
    || String(a.goal.facets['target'] ?? '9999').localeCompare(String(b.goal.facets['target'] ?? '9999')) || a.goal.title.localeCompare(b.goal.title));
}
