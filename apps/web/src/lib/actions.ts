import { CLOSED } from '../graph/model';
import { isRetired } from '../kinds/meta';
import type { UiGraphNode } from './types';
import { daysBetween } from './format';

/** What asks for action (UI-DESIGN "Guide"): open tasks, active projects, goals and habits. */
const ACTIONABLE: Record<string, (n: UiGraphNode) => boolean> = {
  task: (n) => !CLOSED.has(n.status),
  project: (n) => n.status === 'active',
  goal: (n) => n.status === 'active',
  habit: (n) => n.status === 'active',
};
const KIND_ORDER = ['task', 'project', 'goal', 'habit'];

/** Urgent: overdue, due within two days, or priority 1. */
export function isUrgent(n: UiGraphNode, today: string): boolean {
  return n.type === 'task' && (n.priority === 1 || (n.due !== null && daysBetween(today, n.due) <= 2));
}

/** Tasks by priority (none last), then due date; then projects, goals and habits. */
export function byAction(a: UiGraphNode, b: UiGraphNode): number {
  const k = KIND_ORDER.indexOf(a.type) - KIND_ORDER.indexOf(b.type);
  if (k) return k;
  const p = (a.priority ?? 5) - (b.priority ?? 5);
  if (p) return p;
  return (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title);
}

export interface ActionGroup { category: string | null; items: UiGraphNode[]; urgent: number }

/**
 * Everything to act on, by category: the categories with the most urgent items first, then the fullest; items in
 * action order. Retired items (archived, long finished) never count.
 */
export function actionsByCategory(nodes: readonly UiGraphNode[], today: string): ActionGroup[] {
  const groups = new Map<string | null, UiGraphNode[]>();
  for (const n of nodes) {
    const ok = ACTIONABLE[n.type];
    if (!ok || n.ghost || !ok(n) || isRetired(n, today)) continue;
    const key = n.category ?? null;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(n);
  }
  return [...groups.entries()]
    .map(([category, items]) => ({ category, items: items.sort(byAction), urgent: items.filter((n) => isUrgent(n, today)).length }))
    .sort((a, b) => b.urgent - a.urgent || b.items.length - a.items.length || (a.category === null ? 1 : b.category === null ? -1 : 0));
}
