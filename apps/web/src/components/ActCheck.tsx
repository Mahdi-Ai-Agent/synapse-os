import { CheckCircle2, Circle } from 'lucide-react';
import { useT } from '../i18n';
import { api } from '../lib/api';
import { usePalette } from '../lib/categories';
import { todayStr } from '../lib/format';
import type { UiGraphNode } from '../lib/types';
import { ARCHIVED } from '../kinds/meta';
import { useStore } from '../state/store';
import { TypeIcon } from './TypeIcon';

/**
 * A tick only where ticking means something (UI-DESIGN "Guide"): a task is done, a habit was done today. Anything
 * else — a goal, a person, a moment — keeps its kind's icon; it is handled by opening it, not by a tick.
 */
export function canCheck(n: UiGraphNode): boolean {
  return (n.type === 'task' && !ARCHIVED.has(n.status)) || (n.type === 'habit' && n.status === 'active');
}

export function isChecked(n: UiGraphNode, today = todayStr()): boolean {
  if (n.type === 'habit') return ((n.facets['checkins'] as string[] | undefined) ?? []).includes(today);
  return n.status === 'done';
}

export function ActCheck({ node }: { node: UiGraphNode }) {
  const t = useT();
  const palette = usePalette();
  const setToast = useStore((s) => s.setToast);
  const color = palette.node(node);
  if (!canCheck(node)) return <span className="act-icon"><TypeIcon type={node.type} size={15} color={color} /></span>;
  const today = todayStr();
  const done = isChecked(node, today);
  const label = node.type === 'habit' ? t('kind.doneToday') : t('status.done');
  const toggle = async (): Promise<void> => {
    try {
      if (node.type === 'habit') {
        const set = new Set((node.facets['checkins'] as string[] | undefined) ?? []);
        if (done) set.delete(today); else set.add(today);
        await api.updateNode(node.id, { frontmatter: { facets: { checkins: [...set].sort() } } });
      } else {
        await api.updateNode(node.id, { frontmatter: { status: done ? 'todo' : 'done' } });
      }
    } catch (e) { setToast((e as Error).message); }
  };
  return (
    <button onClick={(e) => { e.stopPropagation(); void toggle(); }} className={`task-check ${done ? 'is-done' : ''}`} style={{ '--chip': color } as React.CSSProperties} title={label} aria-label={label} aria-pressed={done}>
      {done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
    </button>
  );
}
