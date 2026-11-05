import { useMemo } from 'react';
import { CLOSED } from '../graph/model';
import { useT, type TKey } from '../i18n';
import { daysBetween, fmtDate, fmtNum, todayStr } from '../lib/format';
import type { UiGraphNode } from '../lib/types';
import { useStore } from '../state/store';
import { ActCheck, isChecked } from '../components/ActCheck';
import { ActionsByPlace } from '../components/ActionsByPlace';
import { PrioritiesCard, QuestionsCard } from '../components/FocusCard';
import { Card, CardTitle, CategoryChip, Empty } from '../components/ui';

/**
 * The guide (spec: docs/UI-DESIGN.md "Guide"): four things only, each in its own place — what needs you now, the
 * brain's priorities, the brain's questions to you, and what to handle in each category. Plans, the inbox and what the
 * brain sees in you have pages of their own.
 */
export function GuideView() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  return (
    <div className="view-body view-wide">
      <header className="view-header">
        <div>
          <h1 className="view-title">{t('guide.title')}</h1>
          <p className="view-sub">{fmtDate(todayStr(), locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
      </header>
      <div className="guide-grid mt-6">
        <div className="space-y-4">
          <NowCard />
          <PrioritiesCard />
        </div>
        <div className="space-y-4">
          <QuestionsCard />
          <ActionsByPlace title={t('guide.byPlace')} />
        </div>
      </div>
    </div>
  );
}

type Why = 'overdue' | 'today' | 'doing' | 'habit';
const WHY_KEY: Record<Why, TKey> = { overdue: 'guide.overdue', today: 'guide.dueToday', doing: 'guide.doing', habit: 'guide.habitToday' };

/** Overdue and due-today tasks, what is in progress, and today's habits — one list, each row saying why it is here. */
function NowCard() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const graph = useStore((s) => s.graph);
  const select = useStore((s) => s.select);
  const today = todayStr();
  const rows = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    const open = nodes.filter((n) => n.type === 'task' && !CLOSED.has(n.status));
    const byDue = (a: UiGraphNode, b: UiGraphNode): number => (a.due ?? '9999').localeCompare(b.due ?? '9999');
    const out: Array<{ n: UiGraphNode; why: Why }> = [];
    for (const n of open.filter((x) => x.due && daysBetween(x.due, today) > 0).sort(byDue)) out.push({ n, why: 'overdue' });
    for (const n of open.filter((x) => x.due === today)) out.push({ n, why: 'today' });
    for (const n of open.filter((x) => x.status === 'doing' && !out.some((r) => r.n.id === x.id))) out.push({ n, why: 'doing' });
    for (const n of nodes.filter((x) => x.type === 'habit' && x.status === 'active')) out.push({ n, why: 'habit' });
    return out;
  }, [graph, today]);
  const left = rows.filter((r) => !isChecked(r.n, today)).length;
  return (
    <Card accent="var(--color-danger)">
      <CardTitle color="var(--color-danger)" count={rows.length ? fmtNum(left, locale) : undefined}>{t('guide.now')}</CardTitle>
      {!rows.length ? <Empty>{t('guide.nothingNow')}</Empty> : (
        <ul className="space-y-0.5">
          {rows.map(({ n, why }) => (
            <li key={`${why}-${n.id}`}>
              <div className={`row cursor-pointer ${isChecked(n, today) ? 'is-checked' : ''}`} onClick={() => select(n.id)}>
                <ActCheck node={n} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-text utext" dir="auto">{n.title}</div>
                  {n.summary && <div className="truncate text-xs text-muted utext" dir="auto">{n.summary}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`why-chip why-${why}`}>{t(WHY_KEY[why])}</span>
                  <CategoryChip node={n} small />
                  {n.due && why !== 'habit' && <span className={`text-[11px] ${why === 'overdue' ? 'text-danger' : 'text-muted'}`}>{fmtDate(n.due, locale, { month: 'short', day: 'numeric' })}</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
