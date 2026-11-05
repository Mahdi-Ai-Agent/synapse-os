import { Archive, Bookmark, CalendarDays, CheckCircle2, Circle, Clock, Flag, Flame, MapPin, Pause, Phone, Play, Plus, Repeat, Target, Users, XCircle, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { CLOSED } from '../graph/model';
import { useT, type TKey } from '../i18n';
import { api } from '../lib/api';
import { usePalette } from '../lib/categories';
import { daysBetween, fmtDate, fmtNum, inputDir, todayStr } from '../lib/format';
import type { NodeDetail, UiGraphNode } from '../lib/types';
import { useStore } from '../state/store';
import { ChipInput, plainTitle } from '../components/ChipInput';
import { TypeIcon } from '../components/TypeIcon';
import { cadenceText, KindCard, streakOf } from './Cards';
import { useVaultIndex } from './data';
import { ChoiceChip, DateChip, Field, InfoChip, InlineText, TextChip } from './fields';
import { CADENCES, DONE, MOOD_EMOJI, MOODS, PLATFORM_STYLE, RELATIONS, RESOURCE_KIND_KEYS, STATUS_OPTIONS, stateHintKey, statusKey, TIMES } from './meta';
import { Avatar, DoneToggle, MediaThumb, OpenLink, ProgressRing, StreakDots } from './widgets';

export type Patch = (frontmatter: Record<string, unknown>) => Promise<void>;
interface KindProps { node: UiGraphNode; detail: NodeDetail; patch: Patch }

/*
 * What depends on the kind in an item's view (spec: docs/UI-DESIGN.md "Item details"): the facts in its header —
 * its state and the few things its kind lives by, as chips that edit in place — and the block under the header that
 * is the thing itself: a goal's ring and slider, a habit's check-in and weeks, a link's preview, a person's moments.
 * Every control saves on its own (kind fields through `facets`), so there is no form and no Save button.
 */

const facet = (patch: Patch, k: string, v: unknown): Promise<void> => patch({ facets: { [k]: v } });
const STATE_ICON: Record<string, LucideIcon> = { todo: Circle, doing: Play, active: Play, paused: Pause, done: CheckCircle2, achieved: CheckCircle2, archived: Archive, dropped: XCircle };

/** The chips of the header: the state first, then the kind's own facts. */
export function KindFacts({ node, detail, patch }: KindProps) {
  switch (node.type) {
    case 'task': return <TaskFacts node={node} detail={detail} patch={patch} />;
    case 'project': return <ProjectFacts node={node} detail={detail} patch={patch} />;
    case 'goal': return <GoalFacts node={node} detail={detail} patch={patch} />;
    case 'habit': return <HabitFacts node={node} detail={detail} patch={patch} />;
    case 'event': return <EventFacts node={node} detail={detail} patch={patch} />;
    case 'person': return <PersonFacts node={node} detail={detail} patch={patch} />;
    case 'resource': return <ResourceFacts node={node} detail={detail} patch={patch} />;
    case 'journal': return <JournalFacts node={node} detail={detail} patch={patch} />;
    case 'note': case 'idea': return <ProjectChip detail={detail} patch={patch} />;
    default: return null;
  }
}

/** The kind's own block under the header. */
export function KindBlock({ node, detail, patch }: KindProps) {
  switch (node.type) {
    case 'task': return <TaskBlock node={node} patch={patch} />;
    case 'project': return <ProjectBlock node={node} detail={detail} patch={patch} />;
    case 'goal': return <GoalBlock node={node} patch={patch} />;
    case 'habit': return <HabitBlock node={node} patch={patch} />;
    case 'event': return <EventBlock node={node} detail={detail} patch={patch} />;
    case 'person': return <PersonBlock node={node} patch={patch} />;
    case 'resource': return <ResourceBlock node={node} patch={patch} />;
    default: return null;
  }
}

/** The item's state as a chip; the menu lists the kind's states with what each one means. */
export function StateChip({ node, patch }: { node: UiGraphNode; patch: Patch }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const options = STATUS_OPTIONS[node.type];
  if (!options) return null;
  // A saved link's "active" means "kept for later", so it gets a bookmark rather than the play mark.
  const iconOf = (s: string): LucideIcon => (node.type === 'resource' && s === 'active' ? Bookmark : STATE_ICON[s] ?? Circle);
  const Icon = iconOf(node.status);
  const finishedOn = DONE.has(node.status) && node.completed ? fmtDate(node.completed, locale, { month: 'long', day: 'numeric' }) : null;
  return (
    <ChoiceChip
      tone={`s-${node.status}`}
      icon={<Icon size={12} />}
      value={node.status}
      placeholder={t('panel.status')}
      currentLabel={finishedOn ? t(node.status === 'achieved' ? 'panel.achievedOn' : 'panel.completedOn').replace('{d}', finishedOn) : undefined}
      options={options.map((s) => { const I = iconOf(s); return { value: s, label: t(statusKey(node.type, s)), hint: t(stateHintKey(node.type, s)), icon: <I size={14} /> }; })}
      onChange={(s) => { if (s) void patch({ status: s }); }}
    />
  );
}

function dayLabel(d: string, locale: 'fa' | 'en'): string {
  return fmtDate(d, locale, { month: 'long', day: 'numeric' });
}

/** Which project a task, note or idea belongs to. */
function ProjectChip({ detail, patch }: { detail: NodeDetail; patch: Patch }) {
  const t = useT();
  const graph = useStore((s) => s.graph);
  const projects = (graph?.nodes ?? []).filter((n) => n.type === 'project' && !n.ghost && !CLOSED.has(n.status));
  const current = plainTitle(detail.node.fm.project ?? '');
  const options = projects.map((p) => ({ value: p.title, label: p.title, icon: <TypeIcon type="project" size={13} /> }));
  if (current && !options.some((o) => o.value === current)) options.unshift({ value: current, label: current, icon: <TypeIcon type="project" size={13} /> });
  if (!options.length) return null;
  return <ChoiceChip icon={<TypeIcon type="project" size={12} />} value={current || undefined} placeholder={t('kind.noProject')} currentLabel={current ? t('kind.inProject').replace('{p}', current) : undefined} options={options} onChange={(v) => void patch({ project: v ? `[[${v}]]` : '' })} clearable />;
}

// ---------------------------------------------------------------- task

function TaskFacts({ node, detail, patch }: KindProps) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const fm = detail.node.fm;
  const late = Boolean(fm.due && !CLOSED.has(node.status) && daysBetween(fm.due, todayStr()) > 0);
  return (
    <>
      <StateChip node={node} patch={patch} />
      <DateChip value={fm.due} tone={late ? 's-late' : ''} format={(d) => t('kind.dueOn').replace('{d}', dayLabel(d, locale))} placeholder={t('kind.noDue')} onSave={(v) => void patch({ due: v ?? '' })} />
      <ChoiceChip icon={<Flag size={12} />} value={fm.priority ? String(fm.priority) : undefined} placeholder={t('kind.noPriority')}
        options={[{ value: '1', label: t('priority.high') }, { value: '2', label: t('priority.medium') }, { value: '3', label: t('priority.low') }]} onChange={(v) => { if (v) void patch({ priority: Number(v) }); }} />
      <ProjectChip detail={detail} patch={patch} />
    </>
  );
}

function TaskBlock({ node, patch }: { node: UiGraphNode; patch: Patch }) {
  const t = useT();
  const palette = usePalette();
  const done = node.status === 'done';
  const toggle = (): void => { void patch({ status: done ? 'todo' : 'done' }); };
  return (
    <div role="button" tabIndex={0} className={`big-check ${done ? 'is-done' : ''}`} onClick={toggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
      <DoneToggle done={done} onToggle={toggle} label={t('kind.markDone')} color={palette.node(node)} />
      <span>{done ? t('kind.doneLabel') : t('kind.markDone')}</span>
    </div>
  );
}

// ---------------------------------------------------------------- project

function ProjectFacts({ node, detail, patch }: KindProps) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const index = useVaultIndex();
  const tasks = index.tasksOf(node.title);
  const done = tasks.filter((x) => x.status === 'done').length;
  const late = Boolean(detail.node.fm.due && !CLOSED.has(node.status) && daysBetween(detail.node.fm.due, todayStr()) > 0);
  return (
    <>
      <StateChip node={node} patch={patch} />
      <DateChip value={detail.node.fm.due} tone={late ? 's-late' : ''} format={(d) => t('kind.dueOn').replace('{d}', dayLabel(d, locale))} placeholder={t('kind.noDue')} onSave={(v) => void patch({ due: v ?? '' })} />
      {tasks.length > 0 && <InfoChip icon={<TypeIcon type="task" size={12} />}>{t('kind.tasksChip').replace('{done}', fmtNum(done, locale)).replace('{total}', fmtNum(tasks.length, locale))}</InfoChip>}
    </>
  );
}

function ProjectBlock({ node, detail }: KindProps) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const setToast = useStore((s) => s.setToast);
  const palette = usePalette();
  const index = useVaultIndex();
  const [draft, setDraft] = useState('');
  const tasks = index.tasksOf(node.title).sort((a, b) => Number(CLOSED.has(a.status)) - Number(CLOSED.has(b.status)) || (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  const done = tasks.filter((x) => x.status === 'done').length;
  const color = palette.node(node);
  const area = detail.node.fm.area;
  const addTask = async (): Promise<void> => {
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    try { await api.createNode({ type: 'task', title, summary: title, project: `[[${node.title}]]`, ...(area ? { area } : {}), source: 'manual' }); } catch (e) { setToast((e as Error).message); }
  };
  return (
    <div className="detail-block">
      <div className="flex items-center gap-3">
        <ProgressRing value={tasks.length ? Math.round((done / tasks.length) * 100) : 0} color={color} size={52} />
        <div className="text-sm text-muted">{t('kind.tasksDone').replace('{done}', fmtNum(done, locale)).replace('{total}', fmtNum(tasks.length, locale))}</div>
      </div>
      <div className="space-y-1.5">
        {tasks.map((x) => <KindCard key={x.id} node={x} compact />)}
        <form onSubmit={(e) => { e.preventDefault(); void addTask(); }} className="add-inline">
          <Plus size={14} className="shrink-0 text-muted" />
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('kind.addTask')} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" dir={inputDir(draft, locale)} />
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- goal

function GoalFacts({ node, patch }: KindProps) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const progress = Number(node.facets['progress'] ?? 0);
  return (
    <>
      <StateChip node={node} patch={patch} />
      <DateChip icon={<Target size={12} />} value={node.facets['target'] as string | undefined} format={(d) => t('kind.untilDate').replace('{d}', dayLabel(d, locale))} placeholder={t('kind.noTarget')} onSave={(v) => void facet(patch, 'target', v)} />
      <InfoChip>{t('kind.progressChip').replace('{n}', fmtNum(progress, locale))}</InfoChip>
    </>
  );
}

function GoalBlock({ node, patch }: { node: UiGraphNode; patch: Patch }) {
  const t = useT();
  const palette = usePalette();
  const index = useVaultIndex();
  const [progress, setProgress] = useState<number | null>(null);
  const value = progress ?? Number(node.facets['progress'] ?? 0);
  const helpers = index.linkedTo(node.id).filter((n) => n.type === 'project' || n.type === 'habit' || n.type === 'task');
  const commit = (): void => { if (progress !== null) { void facet(patch, 'progress', progress); setProgress(null); } };
  return (
    <div className="detail-block">
      <div className="flex items-center gap-4">
        <ProgressRing value={value} color={palette.node(node)} size={64} />
        <input type="range" min={0} max={100} step={5} value={value} className="flex-1" aria-label={t('kind.progressChip').replace('{n}', String(value))}
          onChange={(e) => setProgress(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} />
      </div>
      <div className="why-line">
        <span className="why-label">{t('kind.why')}</span>
        <InlineText value={String(node.facets['why'] ?? '')} placeholder={t('kind.whyPh')} onSave={(v) => facet(patch, 'why', v || null)} className="reading" />
      </div>
      {helpers.length > 0 && (
        <div>
          <div className="section-title">{t('kind.helpsGoal')}</div>
          <div className="space-y-1.5">{helpers.map((n) => <KindCard key={n.id} node={n} compact />)}</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- habit

function HabitFacts({ node, patch }: KindProps) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const streak = streakOf((node.facets['checkins'] as string[] | undefined) ?? [], todayStr());
  return (
    <>
      <StateChip node={node} patch={patch} />
      <ChoiceChip icon={<Repeat size={12} />} value={node.facets['cadence'] as string | undefined} placeholder={t('kind.noCadence')} options={CADENCES.map((c) => ({ value: c, label: t(`cadence.${c}` as TKey) }))} onChange={(v) => void facet(patch, 'cadence', v)} />
      <ChoiceChip icon={<Clock size={12} />} value={node.facets['time'] as string | undefined} placeholder={t('kind.noTime')} options={TIMES.map((c) => ({ value: c, label: t(`time.${c}` as TKey) }))} onChange={(v) => void facet(patch, 'time', v)} clearable />
      {streak > 0 && <InfoChip icon={<Flame size={12} className="text-[#fb923c]" />}>{t('kind.streakChip').replace('{n}', fmtNum(streak, locale))}</InfoChip>}
    </>
  );
}

function HabitBlock({ node, patch }: { node: UiGraphNode; patch: Patch }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const palette = usePalette();
  const today = todayStr();
  const checkins = (node.facets['checkins'] as string[] | undefined) ?? [];
  const doneToday = checkins.includes(today);
  const streak = streakOf(checkins, today);
  const toggle = (): Promise<void> => {
    const set = new Set(checkins);
    if (set.has(today)) set.delete(today); else set.add(today);
    return facet(patch, 'checkins', [...set].sort());
  };
  const color = palette.node(node);
  return (
    <div className="detail-block">
      <button type="button" onClick={() => void toggle()} className={`checkin-btn ${doneToday ? 'is-done' : ''}`} style={{ '--chip': color } as React.CSSProperties}>
        {doneToday ? t('kind.checkedIn') : t('kind.checkIn')}
      </button>
      <div className="flex items-center gap-3 text-sm text-muted">
        <span className="streak-count big"><Flame size={15} />{fmtNum(streak, locale)}</span>
        <span>{t('kind.streakDays')}</span>
        <span className="ms-auto">{cadenceText(node, t)}</span>
      </div>
      <div className="space-y-1.5">
        {[21, 14, 7, 0].map((offset) => (
          <StreakDots key={offset} checkins={checkins} today={shiftDate(today, -offset)} color={color} markToday={offset === 0} onToggleToday={offset === 0 ? () => void toggle() : undefined} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- moment (event)

function MoodChip({ value, onChange }: { value: string | undefined; onChange: (m: string | null) => void }) {
  const t = useT();
  return (
    <ChoiceChip value={value} placeholder={t('kind.setMood')} clearable
      options={MOODS.map((m) => ({ value: m, label: t(`mood.${m}` as TKey), icon: <span className="text-[15px] leading-none">{MOOD_EMOJI[m]}</span> }))} onChange={onChange} />
  );
}

function EventFacts({ node, detail, patch }: KindProps) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  return (
    <>
      <DateChip value={detail.node.fm.date} format={(d) => fmtDate(d, locale, { year: 'numeric', month: 'long', day: 'numeric' })} placeholder={t('kind.setDate')} onSave={(v) => void patch({ date: v ?? '' })} />
      <TextChip icon={<MapPin size={12} />} value={node.facets['place'] as string | undefined} placeholder={t('kind.setPlace')} onSave={(v) => void facet(patch, 'place', v)} />
      <MoodChip value={node.facets['mood'] as string | undefined} onChange={(m) => void facet(patch, 'mood', m)} />
    </>
  );
}

function EventBlock({ detail, patch }: KindProps) {
  const t = useT();
  const graph = useStore((s) => s.graph);
  const personTitles = (graph?.nodes ?? []).filter((n) => n.type === 'person').map((n) => n.title);
  return (
    <div className="detail-block">
      <Field label={t('kind.with')} icon={<Users size={12} />}>
        <ChipInput values={detail.node.fm.people.map(plainTitle)} onChange={(people) => void patch({ people: people.map((p) => `[[${plainTitle(p)}]]`) })} suggestions={personTitles} placeholder={t('panel.addPerson')} />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------- person

function PersonFacts({ node, patch }: KindProps) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const relation = node.facets['relation'] as string | undefined;
  const options = RELATIONS.map((r) => ({ value: r, label: t(`relation.${r}` as TKey) }));
  if (relation && !options.some((o) => o.value === relation)) options.unshift({ value: relation as typeof RELATIONS[number], label: relation });
  return (
    <>
      <ChoiceChip icon={<Users size={12} />} value={relation as typeof RELATIONS[number] | undefined} placeholder={t('kind.relation')} options={options} onChange={(v) => void patch({ relation: v ?? '' })} clearable />
      <DateChip value={node.facets['birthday'] as string | undefined} format={(d) => `${t('kind.birthday')}: ${fmtDate(d, locale, { month: 'long', day: 'numeric' })}`} placeholder={t('kind.birthday')} onSave={(v) => void facet(patch, 'birthday', v)} />
      <TextChip icon={<Phone size={12} />} value={node.facets['contact'] as string | undefined} placeholder={t('kind.contactPh')} onSave={(v) => void facet(patch, 'contact', v)} ltr />
    </>
  );
}

function PersonBlock({ node, patch }: { node: UiGraphNode; patch: Patch }) {
  const t = useT();
  const palette = usePalette();
  const index = useVaultIndex();
  const moments = index.momentsOf(node.id);
  return (
    <div className="detail-block">
      <div className="flex items-center gap-3">
        <Avatar name={node.title} color={palette.node(node)} size={56} />
        <div className="min-w-0 flex-1">
          <span className="why-label">{t('kind.met')}</span>
          <InlineText value={String(node.facets['met'] ?? '')} placeholder={t('kind.metPh')} onSave={(v) => facet(patch, 'met', v || null)} />
        </div>
      </div>
      <div>
        <div className="section-title">{t('kind.momentsWith')}</div>
        {moments.length === 0 ? <p className="text-xs text-muted">{t('kind.noMoments')}</p> : <div className="space-y-1.5">{moments.map((m) => <KindCard key={m.id} node={m} compact />)}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- link (resource)

function ResourceFacts({ node, patch }: KindProps) {
  const t = useT();
  const platform = node.facets['platform'] as string | undefined;
  const style = platform ? PLATFORM_STYLE[platform] : undefined;
  return (
    <>
      <StateChip node={node} patch={patch} />
      <ChoiceChip icon={<TypeIcon type="resource" size={12} />} value={String(node.facets['kind'] ?? 'other')} placeholder={t('kind.what')} options={RESOURCE_KIND_KEYS.map((k) => ({ value: k, label: t(`rkind.${k}` as TKey) }))} onChange={(v) => { if (v) void facet(patch, 'kind', v); }} />
      {style && platform !== 'web' && <InfoChip>{style.label}</InfoChip>}
    </>
  );
}

function ResourceBlock({ node, patch }: { node: UiGraphNode; patch: Patch }) {
  const url = node.facets['url'] as string | undefined;
  return (
    <div className="detail-block">
      <MediaThumb url={url} image={node.facets['image'] as string | undefined} platform={node.facets['platform'] as string | undefined} kind={node.facets['kind'] as string | undefined} large />
      <div className="flex items-center gap-2">
        {url && <OpenLink url={url} />}
        <div className="min-w-0 flex-1"><InlineText value={url ?? ''} placeholder="https://…" onSave={(v) => patch({ url: v })} className="text-[12px] text-muted" /></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- journal

function JournalFacts({ node, detail, patch }: KindProps) {
  const locale = useStore((s) => s.locale);
  const date = detail.node.fm.date;
  return (
    <>
      {date && <InfoChip icon={<CalendarDays size={12} />}>{fmtDate(date, locale, { weekday: 'long', month: 'long', day: 'numeric' })}</InfoChip>}
      <MoodChip value={node.facets['mood'] as string | undefined} onChange={(m) => void facet(patch, 'mood', m)} />
    </>
  );
}

function shiftDate(d: string, n: number): string {
  const x = new Date(`${d}T12:00:00`);
  x.setDate(x.getDate() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
