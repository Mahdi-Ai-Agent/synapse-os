import { CalendarDays, ChevronDown, Flame, MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import { CLOSED } from '../graph/model';
import { useT, type TKey } from '../i18n';
import { api } from '../lib/api';
import { usePalette } from '../lib/categories';
import { daysBetween, fmtDate, fmtNum, todayStr } from '../lib/format';
import type { UiGraphNode } from '../lib/types';
import { useStore } from '../state/store';
import { TypeIcon } from '../components/TypeIcon';
import { useVaultIndex } from './data';
import { MOOD_EMOJI, relationKey, statusKey } from './meta';
import { Avatar, DoneToggle, MediaThumb, ProgressRing, StreakDots } from './widgets';

/**
 * One card per kind (spec: docs/UI-DESIGN.md "Kinds"): a person shows who they are to you, a goal its progress, a
 * habit this week's check-ins, a moment its day and mood, a link its preview. Clicking opens the item.
 */
export function KindCard({ node, compact = false, onOpen }: { node: UiGraphNode; compact?: boolean; onOpen?: (id: string) => void }) {
  const select = useStore((s) => s.select);
  const palette = usePalette();
  const color = palette.node(node);
  const open = (): void => (onOpen ? onOpen(node.id) : select(node.id));
  const Body = BODIES[node.ghost ? 'ghost' : node.type] ?? GenericBody;
  return (
    <div role="button" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open(); }}
      className={`kind-card kind-${node.type} ${compact ? 'is-compact' : ''} ${CLOSED.has(node.status) ? 'is-closed' : ''}`} style={{ '--cat': color } as React.CSSProperties}>
      <Body node={node} color={color} compact={compact} />
    </div>
  );
}

type BodyProps = { node: UiGraphNode; color: string; compact: boolean };

function Title({ node, children }: { node: UiGraphNode; children?: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="kind-title utext" dir="auto">{node.title}</div>
      {children}
    </div>
  );
}

function Summary({ node, lines = 1 }: { node: UiGraphNode; lines?: number }) {
  if (!node.summary) return null;
  return <div className={`kind-summary utext ${lines > 1 ? 'line-clamp-2' : 'truncate'}`} dir="auto">{node.summary}</div>;
}

function KindLabel({ type }: { type: string }) {
  const t = useT();
  return <span className="kind-label"><TypeIcon type={type} size={12} />{t(`type.${type}` as TKey)}</span>;
}

function GenericBody({ node, color, compact }: BodyProps) {
  return (
    <div className="flex items-start gap-3">
      <span className="kind-icon" style={{ color }}><TypeIcon type={node.ghost ? 'ghost' : node.type} size={16} /></span>
      <Title node={node}>{!compact && <Summary node={node} lines={2} />}</Title>
    </div>
  );
}

function TaskBody({ node, color }: BodyProps) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const setToast = useStore((s) => s.setToast);
  const today = todayStr();
  const toggle = async (): Promise<void> => {
    try { await api.updateNode(node.id, { frontmatter: { status: node.status === 'done' ? 'todo' : 'done' } }); } catch (e) { setToast((e as Error).message); }
  };
  const late = node.due && daysBetween(node.due, today) > 0 && node.status !== 'done';
  return (
    <div className="flex items-start gap-3">
      <DoneToggle done={node.status === 'done'} onToggle={() => void toggle()} label={t('kind.markDone')} color={color} />
      <Title node={node}>
        <Summary node={node} />
        {node.due && <div className={`kind-meta ${late ? 'text-danger' : ''}`}><CalendarDays size={11} />{fmtDate(node.due, locale, { month: 'short', day: 'numeric' })}</div>}
      </Title>
    </div>
  );
}

function ProjectBody({ node, color }: BodyProps) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const index = useVaultIndex();
  const tasks = index.tasksOf(node.title);
  const done = tasks.filter((x) => x.status === 'done').length;
  const next = tasks.filter((x) => !CLOSED.has(x.status)).sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))[0];
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  return (
    <div>
      <div className="flex items-start gap-3">
        <span className="kind-icon" style={{ color }}><TypeIcon type="project" size={16} /></span>
        <Title node={node}><Summary node={node} /></Title>
        <span className="pill shrink-0 text-[10.5px] text-muted">{t(statusKey('project', node.status))}</span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="bar"><span style={{ width: `${pct}%`, background: color }} /></span>
        <span className="shrink-0 text-[11px] text-muted">{fmtNum(done, locale)}/{fmtNum(tasks.length, locale)}</span>
      </div>
      {next && <div className="kind-meta mt-2"><span className="opacity-70">{t('kind.next')}:</span><span className="min-w-0 truncate utext" dir="auto">{next.title}</span></div>}
    </div>
  );
}

function GoalBody({ node, color }: BodyProps) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const progress = Number(node.facets['progress'] ?? 0);
  const target = node.facets['target'] as string | undefined;
  const why = node.facets['why'] as string | undefined;
  return (
    <div className="flex items-center gap-3">
      <ProgressRing value={progress} color={color} />
      <Title node={node}>
        {why ? <div className="kind-summary truncate utext" dir="auto">{why}</div> : <Summary node={node} />}
        {target && <div className="kind-meta"><CalendarDays size={11} />{t('kind.until')} {fmtDate(target, locale, { year: 'numeric', month: 'short', day: 'numeric' })}</div>}
      </Title>
    </div>
  );
}

function HabitBody({ node, color }: BodyProps) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const setToast = useStore((s) => s.setToast);
  const today = todayStr();
  const checkins = (node.facets['checkins'] as string[] | undefined) ?? [];
  const streak = streakOf(checkins, today);
  const toggleToday = async (): Promise<void> => {
    const set = new Set(checkins);
    if (set.has(today)) set.delete(today); else set.add(today);
    try { await api.updateNode(node.id, { frontmatter: { facets: { checkins: [...set].sort() } } }); } catch (e) { setToast((e as Error).message); }
  };
  return (
    <div>
      <div className="flex items-start gap-3">
        <DoneToggle done={checkins.includes(today)} onToggle={() => void toggleToday()} label={t('kind.doneToday')} color={color} />
        <Title node={node}>
          <div className="kind-meta">{cadenceText(node, t)}{streak > 0 && <span className="streak-count"><Flame size={11} />{fmtNum(streak, locale)}</span>}</div>
        </Title>
      </div>
      <div className="mt-3"><StreakDots checkins={checkins} today={today} color={color} onToggleToday={() => void toggleToday()} /></div>
    </div>
  );
}

function EventBody({ node, color, compact }: BodyProps) {
  const locale = useStore((s) => s.locale);
  const index = useVaultIndex();
  const date = node.facets['date'] as string | undefined;
  const mood = node.facets['mood'] as string | undefined;
  const place = node.facets['place'] as string | undefined;
  const people = index.peopleOf(node.id);
  const palette = usePalette();
  return (
    <div className="flex items-start gap-3">
      <span className="event-date" style={{ borderColor: color }}>
        {date ? <><b>{fmtDate(date, locale, { day: 'numeric' })}</b><small>{fmtDate(date, locale, { month: 'short' })}</small></> : <TypeIcon type="event" size={16} />}
      </span>
      <Title node={node}>
        {!compact && <Summary node={node} lines={2} />}
        <div className="kind-meta">
          {mood && <span className="text-sm leading-none">{MOOD_EMOJI[mood]}</span>}
          {place && <span className="flex min-w-0 items-center gap-1"><MapPin size={11} /><span className="truncate utext" dir="auto">{place}</span></span>}
          {people.length > 0 && <span className="flex -space-x-1.5 rtl:space-x-reverse">{people.slice(0, 4).map((p) => <Avatar key={p.id} name={p.title} color={palette.node(p)} size={18} />)}</span>}
        </div>
      </Title>
    </div>
  );
}

function PersonBody({ node, color }: BodyProps) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const index = useVaultIndex();
  const relation = node.facets['relation'] as string | undefined;
  const birthday = node.facets['birthday'] as string | undefined;
  const moments = index.momentsOf(node.id);
  const soon = birthday ? daysToBirthday(birthday) : null;
  return (
    <div className="flex items-center gap-3">
      <Avatar name={node.title} color={color} />
      <Title node={node}>
        <div className="kind-meta">
          {relation && <span>{relationKey(relation) ? t(relationKey(relation)!) : <bdi>{relation}</bdi>}</span>}
          {soon !== null && soon <= 30 && <span className="text-warn">🎂 {soon === 0 ? t('kind.birthdayToday') : t('kind.birthdayIn').replace('{n}', fmtNum(soon, locale))}</span>}
          {moments.length > 0 && <span>{t('kind.moments').replace('{n}', fmtNum(moments.length, locale))}</span>}
        </div>
        <Summary node={node} />
      </Title>
    </div>
  );
}

function ResourceBody({ node, compact }: BodyProps) {
  const t = useT();
  const url = node.facets['url'] as string | undefined;
  const kind = node.facets['kind'] as string | undefined;
  return (
    <div className={compact ? 'flex items-center gap-3' : ''}>
      <MediaThumb url={url} image={node.facets['image'] as string | undefined} platform={node.facets['platform'] as string | undefined} kind={kind} />
      <div className={compact ? 'min-w-0 flex-1' : 'mt-2.5'}>
        <div className="kind-title line-clamp-2 utext" dir="auto">{node.title}</div>
        {!compact && <Summary node={node} />}
        <div className="kind-meta"><span className={`status-dot s-${node.status}`} />{t(statusKey('resource', node.status))}</div>
      </div>
    </div>
  );
}

function JournalBody({ node, color }: BodyProps) {
  const locale = useStore((s) => s.locale);
  const mood = node.facets['mood'] as string | undefined;
  const date = (node.facets['date'] as string | undefined) ?? node.title;
  return (
    <div className="flex items-start gap-3">
      <span className="kind-icon" style={{ color }}><TypeIcon type="journal" size={16} /></span>
      <div className="min-w-0 flex-1">
        <div className="kind-title">{fmtDate(date, locale, { weekday: 'long', month: 'long', day: 'numeric' })} {mood && MOOD_EMOJI[mood]}</div>
        <Summary node={node} lines={2} />
      </div>
    </div>
  );
}

/** Finished or archived items of a place, folded away under a count (UI-DESIGN "Done and archived"), newest first. */
export function FoldedCards({ title, items }: { title: string; items: UiGraphNode[] }) {
  const locale = useStore((s) => s.locale);
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => (b.completed ?? b.updated ?? '').localeCompare(a.completed ?? a.updated ?? ''));
  return (
    <details className="folded">
      <summary><ChevronDown size={13} className="more-chevron" />{title}<span className="folded-count">{fmtNum(items.length, locale)}</span></summary>
      <div className="mt-2 space-y-1.5">{sorted.map((n) => <KindCard key={n.id} node={n} compact />)}</div>
    </details>
  );
}

const BODIES: Record<string, (p: BodyProps) => ReactNode> = {
  task: TaskBody, project: ProjectBody, goal: GoalBody, habit: HabitBody, event: EventBody, person: PersonBody,
  resource: ResourceBody, journal: JournalBody,
};

export function streakOf(checkins: readonly string[], today: string): number {
  const days = new Set(checkins);
  const d = new Date(`${today}T12:00:00`);
  if (!days.has(today)) d.setDate(d.getDate() - 1);
  let n = 0;
  for (;;) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!days.has(key)) return n;
    n++;
    d.setDate(d.getDate() - 1);
  }
}

export function cadenceText(node: UiGraphNode, t: (k: TKey) => string): string {
  const cadence = node.facets['cadence'] as string | undefined;
  const time = node.facets['time'] as string | undefined;
  const c = cadence ? (['daily', 'weekdays', 'weekly', '3/week'].includes(cadence) ? t(`cadence.${cadence}` as TKey) : cadence) : '';
  const tm = time ? (['morning', 'afternoon', 'evening', 'night'].includes(time) ? t(`time.${time}` as TKey) : time) : '';
  return [c, tm].filter(Boolean).join(' · ');
}

/** Days until the next birthday (`YYYY-MM-DD` or `MM-DD`), 0 = today. */
export function daysToBirthday(birthday: string): number | null {
  const m = /(\d{2})-(\d{2})$/.exec(birthday);
  if (!m) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]));
  if (next < today) next = new Date(now.getFullYear() + 1, Number(m[1]) - 1, Number(m[2]));
  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}
