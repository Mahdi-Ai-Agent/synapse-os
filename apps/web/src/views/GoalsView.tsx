import { ChevronDown, Plus } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { CLOSED } from '../graph/model';
import { useT, type TKey } from '../i18n';
import { api } from '../lib/api';
import { usePalette } from '../lib/categories';
import { fmtDate, fmtNum, inputDir } from '../lib/format';
import { goalPlans, type GoalPlan } from '../lib/goals';
import type { UiGraphNode } from '../lib/types';
import { useStore } from '../state/store';
import { ActCheck } from '../components/ActCheck';
import { TypeIcon } from '../components/TypeIcon';
import { CategoryChip, Empty } from '../components/ui';

/**
 * Goals (spec: docs/UI-DESIGN.md "Goals"): every goal with its progress, target and why, and under it what serves it —
 * its projects with their tasks, its own tasks and habits (ticked here), and the notes and ideas that weigh on it.
 */
export function GoalsView() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const graph = useStore((s) => s.graph);
  const openDialog = useStore((s) => s.openDialog);
  const plans = useMemo(() => goalPlans(graph?.nodes ?? [], graph?.edges ?? []), [graph]);
  const live = plans.filter((p) => p.goal.status === 'active' || p.goal.status === 'paused');
  const past = plans.filter((p) => !live.includes(p));
  return (
    <div className="view-body view-wide">
      <header className="view-header">
        <div>
          <h1 className="view-title">{t('goals.title')}</h1>
          <p className="view-sub">{t('goals.hint')}</p>
        </div>
        <button onClick={() => openDialog({ kind: 'add', type: 'goal' })} className="btn-primary"><Plus size={15} />{t('goals.new')}</button>
      </header>
      {!plans.length && <Empty>{t('goals.empty')}</Empty>}
      <div className="goal-grid mt-6">{live.map((p) => <GoalCard key={p.goal.id} plan={p} />)}</div>
      {past.length > 0 && (
        <details className="focus-more mt-8">
          <summary><ChevronDown size={13} />{t('goals.past')} <span>{fmtNum(past.length, locale)}</span></summary>
          <div className="goal-grid mt-3">{past.map((p) => <GoalCard key={p.goal.id} plan={p} />)}</div>
        </details>
      )}
    </div>
  );
}

function GoalCard({ plan }: { plan: GoalPlan }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const select = useStore((s) => s.select);
  const palette = usePalette();
  const g = plan.goal;
  const color = palette.node(g);
  const target = typeof g.facets['target'] === 'string' ? (g.facets['target'] as string) : null;
  const why = typeof g.facets['why'] === 'string' ? (g.facets['why'] as string) : '';
  const pct = plan.progress;
  const empty = !plan.projects.length && !plan.tasks.length && !plan.habits.length && !plan.notes.length;
  return (
    <article className="goal-card" style={{ '--chip': color, '--pct': `${pct ?? 0}%` } as CSSProperties}>
      <div role="button" tabIndex={0} onClick={() => select(g.id)} onKeyDown={(e) => { if (e.key === 'Enter') select(g.id); }} className="goal-head cursor-pointer">
        <span className="goal-ring"><span>{pct === null ? '—' : `${fmtNum(pct, locale)}٪`}</span></span>
        <span className="min-w-0 flex-1 text-start">
          <span className="goal-title utext" dir="auto">{g.title}</span>
          {(why || g.summary) && <span className="goal-why utext" dir="auto">{why || g.summary}</span>}
          <span className="goal-meta">
            {target && <span>{t('goals.by').replace('{date}', fmtDate(target, locale, { year: 'numeric', month: 'long', day: 'numeric' }))}</span>}
            {plan.total > 0 && <span>{t('goals.openOf').replace('{n}', fmtNum(plan.open, locale)).replace('{all}', fmtNum(plan.total, locale))}</span>}
            {g.status !== 'active' && <span>{t(`status.${g.status}` as TKey)}</span>}
            <CategoryChip node={g} small />
          </span>
        </span>
      </div>
      <div className="goal-parts">
        {plan.projects.map(({ project, tasks }) => (
          <div key={project.id} className="goal-project">
            <Row node={project} />
            {tasks.length > 0 && <ul className="goal-sub">{tasks.map((x) => <li key={x.id}><Row node={x} /></li>)}</ul>}
          </div>
        ))}
        {plan.tasks.length > 0 && <Part title={t('goals.tasks')} items={plan.tasks} />}
        {plan.habits.length > 0 && <Part title={t('goals.habits')} items={plan.habits} />}
        {plan.notes.length > 0 && <Part title={t('goals.notes')} items={plan.notes} />}
        {empty && <p className="branch-empty">{t('goals.nothing')}</p>}
        <AddTask goal={g} />
      </div>
    </article>
  );
}

function Part({ title, items }: { title: string; items: UiGraphNode[] }) {
  return (
    <div>
      <div className="goal-part-title">{title}</div>
      <ul>{items.map((x) => <li key={x.id}><Row node={x} /></li>)}</ul>
    </div>
  );
}

function Row({ node }: { node: UiGraphNode }) {
  const locale = useStore((s) => s.locale);
  const select = useStore((s) => s.select);
  return (
    <div className={`row cursor-pointer ${CLOSED.has(node.status) ? 'is-checked' : ''}`} onClick={() => select(node.id)}>
      <ActCheck node={node} />
      <span className={`min-w-0 flex-1 truncate text-[13px] utext ${node.type === 'project' ? 'font-semibold text-text' : 'text-text'}`} dir="auto">{node.title}</span>
      {node.due && <span className="text-[11px] text-muted">{fmtDate(node.due, locale, { month: 'short', day: 'numeric' })}</span>}
      {node.type === 'project' && <TypeIcon type="project" size={13} className="text-muted" />}
    </div>
  );
}

/** A task for this goal in one line: it is linked to the goal and filed in the goal's category. */
function AddTask({ goal }: { goal: UiGraphNode }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const setToast = useStore((s) => s.setToast);
  const palette = usePalette();
  const [title, setTitle] = useState('');
  const add = async (): Promise<void> => {
    const text = title.trim();
    if (!text) return;
    const cat = palette.category(goal.category ?? null);
    try {
      await api.createNode({ type: 'task', title: text, summary: text.slice(0, 160), source: 'manual', body: `${t('goals.forGoal')} [[${goal.title}]]\n`, ...(cat ? { area: `[[${cat.title}]]` } : {}) });
      setTitle('');
    } catch (e) { setToast((e as Error).message); }
  };
  return (
    <div className="goal-add">
      <Plus size={14} className="shrink-0 text-muted" />
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('goals.addTask')} dir={inputDir(title, locale)}
        onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} />
    </div>
  );
}
