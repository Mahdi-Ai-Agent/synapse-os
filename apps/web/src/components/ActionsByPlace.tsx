import { useMemo } from 'react';
import { useT } from '../i18n';
import { actionsByCategory, isUrgent } from '../lib/actions';

import { usePalette } from '../lib/categories';
import { daysBetween, fmtDate, fmtNum, todayStr } from '../lib/format';
import type { UiGraphNode } from '../lib/types';
import { useStore } from '../state/store';
import { ActCheck } from './ActCheck';
import { Card, CardTitle, Empty } from './ui';

/**
 * Everything to act on, by category (UI-DESIGN "Guide"): open tasks, active projects, goals and habits, the
 * categories with urgent things first and each one's items in action order (priority, then due date).
 */
export function ActionsByPlace({ nodes, title }: { nodes?: readonly UiGraphNode[]; title?: string } = {}) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const graph = useStore((s) => s.graph);
  const select = useStore((s) => s.select);
  const palette = usePalette();
  const today = todayStr();
  const groups = useMemo(() => actionsByCategory(nodes ?? graph?.nodes ?? [], today), [nodes, graph, today]);
  const total = groups.reduce((s, g) => s + g.items.length, 0);

  return (
    <Card>
      <CardTitle count={fmtNum(total, locale)}>{title ?? t('actions.title')}</CardTitle>
      {!groups.length && <Empty>{t('actions.empty')}</Empty>}
      <div className="space-y-1.5">
        {groups.map((g, gi) => {
          const color = palette.group(g.category);
          const name = g.category ? palette.category(g.category)?.title ?? t('group.unsorted') : t('group.unsorted');
          return (
            <details key={g.category ?? '—'} className="actions-group" open={gi < 2} style={{ '--cat': color } as React.CSSProperties}>
              <summary>
                <span className="cat-orb small" />
                <span className="min-w-0 flex-1 truncate utext" dir="auto">{name}</span>
                {g.urgent > 0 && <span className="actions-urgent">{t('actions.urgent').replace('{n}', fmtNum(g.urgent, locale))}</span>}
                <span className="text-[11px] text-muted">{fmtNum(g.items.length, locale)}</span>
              </summary>
              <ul className="mt-1 space-y-0.5">
                {g.items.map((n) => (
                  <li key={n.id}>
                    <div className="row cursor-pointer" onClick={() => select(n.id)}>
                      <ActCheck node={n} />
                      <div className="min-w-0 flex-1 truncate text-sm text-text utext" dir="auto">{n.title}</div>
                      <div className="flex shrink-0 items-center gap-2">
                        {n.priority !== null && <span className={`prio-chip p${n.priority}`}>{t('actions.priority').replace('{n}', fmtNum(n.priority, locale))}</span>}
                        {n.due && <span className={`text-[11px] ${isUrgent(n, today) && daysBetween(n.due, today) >= 0 ? 'text-danger' : 'text-muted'}`}>{fmtDate(n.due, locale, { month: 'short', day: 'numeric' })}</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </Card>
  );
}
