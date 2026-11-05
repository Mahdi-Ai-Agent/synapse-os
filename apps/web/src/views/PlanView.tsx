import { ArrowLeft, ArrowRight, CalendarRange, Loader2, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CLOSED } from '../graph/model';
import { useT } from '../i18n';
import { api } from '../lib/api';
import { usePalette } from '../lib/categories';
import { daysBetween, fmtDate, fmtNum, inputDir, todayStr } from '../lib/format';
import type { Settings, UiGraphNode } from '../lib/types';
import { useStore } from '../state/store';
import { EnginePicker } from '../components/EnginePicker';
import { OpenInChat, useReviewRun } from '../components/ReviewRun';
import { Markdown, useResolve } from '../components/Markdown';
import { Toggle } from '../components/graph/GraphToolbar';
import { TimeField } from '../components/TimeField';
import { TypeIcon } from '../components/TypeIcon';
import { Card, CardTitle, Empty } from '../components/ui';
import { daysToBirthday, KindCard } from '../kinds/Cards';

/**
 * The plan page (spec: docs/UI-DESIGN.md "Plan"): today's suggested plan and the weekly review (made on demand or on
 * their own), when they run by themselves, goals, each project's next step, birthdays and the week's finished work.
 */
export function PlanView() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const resolve = useResolve();
  const daily = useLatestReview(DAILY, 1);
  const weekly = useLatestReview(WEEKLY, 10);
  const { run, running, busy, threadId } = useReviewRun();
  return (
    <div className="view-body view-wide">
      <header className="view-header">
        <div>
          <h1 className="view-title">{t('plan.title')}</h1>
          <p className="view-sub">{t('plan.hint')}</p>
        </div>
        <EnginePicker />
      </header>
      <div className="guide-grid mt-6">
      <div className="space-y-4">
        <Card accent="var(--color-accent)">
          <CardTitle color="var(--color-accent)">{t('coach.todayPlan')}</CardTitle>
          {daily ? <div className="reading"><Markdown text={daily.text} resolve={resolve} /></div> : <Empty>{t('coach.noPlan')}</Empty>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => void run('daily', t('today.dailyReview'))} disabled={busy} title={t('today.dailyReviewHint')} className="btn-primary">
              {running === 'daily' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{running === 'daily' ? t('coach.running') : daily ? t('coach.refreshPlan') : t('coach.makePlan')}
            </button>
            {running === 'daily' && <OpenInChat threadId={threadId} />}
          </div>
        </Card>
        <Card>
          <CardTitle>{t('today.weeklyReview')}</CardTitle>
          {weekly ? (
            <>
              <p className="mb-2 text-[11px] text-muted">{fmtDate(weekly.date, locale, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
              <div className="reading"><Markdown text={weekly.text} resolve={resolve} /></div>
            </>
          ) : <Empty>{t('coach.noWeekly')}</Empty>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => void run('weekly', t('today.weeklyReview'))} disabled={busy} title={t('today.weeklyReviewHint')} className="btn-soft">
              {running === 'weekly' ? <Loader2 size={14} className="animate-spin" /> : <CalendarRange size={14} />}{running === 'weekly' ? t('coach.running') : t('today.weeklyReview')}
            </button>
            {running === 'weekly' && <OpenInChat threadId={threadId} />}
          </div>
        </Card>
        <Journal />
      </div>
      <div className="space-y-4">
        <AutomationCard />
        <Goals />
      </div>
      </div>
    </div>
  );
}


/** The reviews on their own: a time for the daily plan, a weekday and time for the weekly review (server-side, ARCHITECTURE "Automation"). */
function AutomationCard() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setToast = useStore((s) => s.setToast);
  const auto = settings?.automation ?? { review: null, daily: null, weekly: null };
  const save = async (patch: Partial<Settings['automation']>): Promise<void> => {
    if (!settings) return;
    const next = { ...settings, automation: { ...auto, ...patch } };
    setSettings(next);
    try { setSettings(await api.putSettings({ automation: patch })); } catch (e) { setToast((e as Error).message); }
  };
  // Weekday names in the UI language, Sunday = 0 as the server counts them.
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', { weekday: 'long' }).format(new Date(2026, 10, 1 + i))), [locale]);
  return (
    <Card>
      <CardTitle>{t('coach.automation')}</CardTitle>
      <div className="space-y-3 text-sm">
        <div className="auto-row">
          <Toggle label={t('coach.autoReview')} value={auto.review !== null} onChange={(v) => void save({ review: v ? '07:30' : null })} />
          {auto.review !== null && <TimeField value={auto.review} onChange={(v) => void save({ review: v })} label={t('coach.autoReview')} />}
        </div>
        <div className="auto-row">
          <Toggle label={t('coach.autoDaily')} value={auto.daily !== null} onChange={(v) => void save({ daily: v ? '08:00' : null })} />
          {auto.daily !== null && <TimeField value={auto.daily} onChange={(v) => void save({ daily: v })} label={t('coach.autoDaily')} />}
        </div>
        <div className="auto-row">
          <Toggle label={t('coach.autoWeekly')} value={auto.weekly !== null} onChange={(v) => void save({ weekly: v ? { day: 6, time: '18:00' } : null })} />
          {auto.weekly && (
            <>
              <select value={auto.weekly.day} onChange={(e) => void save({ weekly: { day: Number(e.target.value), time: auto.weekly?.time ?? '18:00' } })} className="field-inline">
                {days.map((name, i) => <option key={i} value={i}>{name}</option>)}
              </select>
              <span className="text-muted">{t('coach.at')}</span>
              <TimeField value={auto.weekly.time} onChange={(v) => void save({ weekly: { day: auto.weekly?.day ?? 6, time: v } })} label={t('coach.autoWeekly')} />
            </>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted">{t('coach.autoHint')}</p>
      </div>
    </Card>
  );
}

/** Goals and their progress, each active project's next step, birthdays soon and what was finished this week. */
function Goals() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const graph = useStore((s) => s.graph);
  const select = useStore((s) => s.select);
  const palette = usePalette();
  const today = todayStr();
  const Arrow = locale === 'fa' ? ArrowLeft : ArrowRight;
  const g = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    const tasks = nodes.filter((n) => n.type === 'task' && !CLOSED.has(n.status));
    const byDue = (a: UiGraphNode, b: UiGraphNode): number => (a.due ?? '9999').localeCompare(b.due ?? '9999');
    const next = nodes.filter((n) => n.type === 'project' && n.status === 'active').map((p) => ({ project: p, task: tasks.filter((x) => x.project === p.title).sort(byDue)[0] ?? null }));
    const goals = nodes.filter((n) => n.type === 'goal' && n.status === 'active');
    const birthdays: UiGraphNode[] = nodes.filter((n) => { const b = n.type === 'person' ? n.facets['birthday'] : undefined; const d = typeof b === 'string' ? daysToBirthday(b) : null; return d !== null && d <= 21; });
    const finished = nodes.filter((n) => n.completed && daysBetween(n.completed, today) >= 0 && daysBetween(n.completed, today) < 7).sort((a, b) => (b.completed ?? '').localeCompare(a.completed ?? ''));
    return { next, goals, birthdays, finished };
  }, [graph, today]);
  return (
    <>
      {g.goals.length > 0 && (
        <Card>
          <CardTitle count={fmtNum(g.goals.length, locale)}>{t('today.goals')}</CardTitle>
          <div className="space-y-2">{g.goals.map((n) => <KindCard key={n.id} node={n} compact />)}</div>
        </Card>
      )}
      <Card>
        <CardTitle>{t('today.nextActions')}</CardTitle>
        {g.next.length === 0 && <Empty>{t('today.noProjects')}</Empty>}
        <ul className="space-y-1">
          {g.next.map(({ project, task }) => (
            <li key={project.id} className="rounded-xl px-2 py-1.5 hover:bg-panel">
              <button onClick={() => select(project.id)} className="flex w-full items-center gap-2 text-start text-sm text-text">
                <TypeIcon type="project" size={14} color={palette.node(project)} />
                <span className="truncate font-medium utext" dir="auto">{project.title}</span>
              </button>
              {task ? (
                <button onClick={() => select(task.id)} className="mt-0.5 flex w-full items-center gap-1.5 ps-6 text-start text-xs text-muted hover:text-text">
                  <Arrow size={12} className="shrink-0" /><span className="truncate utext" dir="auto">{task.title}</span>
                </button>
              ) : <span className="mt-0.5 block ps-6 text-xs text-muted">{t('today.noNextAction')}</span>}
            </li>
          ))}
        </ul>
      </Card>
      {g.birthdays.length > 0 && (
        <Card>
          <CardTitle>{t('today.birthdays')}</CardTitle>
          <div className="space-y-2">{g.birthdays.map((n) => <KindCard key={n.id} node={n} compact />)}</div>
        </Card>
      )}
      {g.finished.length > 0 && (
        <Card accent="var(--color-ok)">
          <CardTitle count={fmtNum(g.finished.length, locale)} color="var(--color-ok)">{t('today.doneRecently')}</CardTitle>
          <div className="space-y-2">{g.finished.map((n) => <KindCard key={n.id} node={n} compact />)}</div>
        </Card>
      )}
    </>
  );
}

/** A line for today's journal. */
function Journal() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const graph = useStore((s) => s.graph);
  const setToast = useStore((s) => s.setToast);
  const [entry, setEntry] = useState('');
  const today = todayStr();
  const addJournal = async (): Promise<void> => {
    const text = entry.trim();
    if (!text) return;
    const now = new Date();
    const stamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    try {
      const existing = graph?.nodes.find((n) => n.type === 'journal' && n.title === today);
      if (existing) {
        const d = await api.node(existing.id);
        await api.updateNode(existing.id, { body: `${d.node.body.replace(/\s*$/, '')}\n\n## ${stamp}\n${text}\n` });
      } else {
        await api.createNode({ type: 'journal', title: today, summary: text.slice(0, 160), date: today, body: `## ${stamp}\n${text}\n` });
      }
      setEntry('');
      setToast(t('today.journalSaved'));
    } catch (e) { setToast((e as Error).message); }
  };
  return (
    <Card>
      <CardTitle>{t('today.journal')}</CardTitle>
      <textarea value={entry} onChange={(e) => setEntry(e.target.value)} placeholder={t('today.writeJournal')} rows={3} className="field w-full resize-none" dir={inputDir(entry, locale)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void addJournal(); }} />
      <div className="mt-2 flex justify-end"><button onClick={() => void addJournal()} disabled={!entry.trim()} className="btn-primary">{t('today.add')}</button></div>
    </Card>
  );
}

/**
 * The last section of a journal body whose heading matches `label` (reviews are appended under `## HH:mm — Daily
 * review`). A bold label right after a list would read as the list's last item in Markdown, so a blank line is put
 * before every bold or heading line (older reviews were written without them).
 */
function sectionOf(body: string, label: RegExp): { heading: string; text: string } | null {
  const lines = body.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (/^##\s/.test(lines[i] ?? '') && label.test(lines[i] ?? '')) start = i;
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^##\s/.test(lines[i] ?? '')) { end = i; break; }
  const tidy = lines.slice(start + 1, end).join('\n').trim().replace(/([^\n])\n(\*\*|#{1,6}\s)/g, '$1\n\n$2');
  return { heading: (lines[start] ?? '').replace(/^##\s*/, ''), text: tidy };
}

/** The newest review of a kind across the last journal nodes. */
function useLatestReview(label: RegExp, maxNodes: number): { date: string; heading: string; text: string } | null {
  const graph = useStore((s) => s.graph);
  const journals = useMemo(() => (graph?.nodes ?? []).filter((n) => n.type === 'journal').sort((a, b) => b.title.localeCompare(a.title)).slice(0, maxNodes), [graph, maxNodes]);
  const [found, setFound] = useState<{ date: string; heading: string; text: string } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const j of journals) {
        try {
          const d = await api.node(j.id);
          const s = sectionOf(d.node.body, label);
          if (s) { if (alive) setFound({ date: j.title, ...s }); return; }
        } catch { /* skip */ }
      }
      if (alive) setFound(null);
    })();
    return () => { alive = false; };
  }, [journals, label]);
  return found;
}

const DAILY = /daily review|مرور روزانه/i;
const WEEKLY = /weekly review|مرور هفتگی/i;

