import { ChevronDown, Loader2, MessageCircleQuestion, Send, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { api } from '../lib/api';
import { startRun } from '../lib/brain';
import { parseFocus, type Focus, type FocusLine } from '../lib/focus';
import { daysBetween, fmtDate, fmtNum, inputDir, todayStr } from '../lib/format';
import type { Settings, UiGraphNode } from '../lib/types';
import { useStore } from '../state/store';
import { ActCheck } from './ActCheck';
import { TimeField } from './TimeField';
import { Toggle } from './graph/GraphToolbar';
import { Markdown, useResolve } from './Markdown';
import { OpenInChat, useReviewRun } from './ReviewRun';
import { Card, CardTitle, CategoryChip, Empty } from './ui';

/**
 * The full review's focus list (`memory/focus.md`, UI-DESIGN "Guide"), read again whenever a brain run ends (the
 * review writes it; answering one of its questions changes it).
 */
export function useFocus(): { focus: Focus | null | undefined; nodeOf: (l: FocusLine) => UiGraphNode | undefined } {
  const graph = useStore((s) => s.graph);
  const live = useStore((s) => s.run);
  const [focus, setFocus] = useState<Focus | null | undefined>(undefined);
  const ended = live && live.status !== 'running' && live.status !== 'queued' ? live.runId : null;
  useEffect(() => {
    api.memory('focus').then((md) => setFocus(md ? parseFocus(md) : null)).catch(() => setFocus(null));
  }, [ended]);
  const byTitle = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.title.normalize('NFC').toLowerCase(), n])), [graph]);
  const nodeOf = (l: FocusLine): UiGraphNode | undefined => (l.title ? byTitle.get(l.title.normalize('NFC').toLowerCase()) : undefined);
  return { focus, nodeOf };
}

/** The Full review button with its daily time (a missed day is made up for when the app next opens). */
export function ReviewControls({ hasFocus }: { hasFocus: boolean }) {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setToast = useStore((s) => s.setToast);
  const { run, running, busy, threadId } = useReviewRun();
  const auto = settings?.automation ?? { review: null, daily: null, weekly: null };
  const saveTime = async (review: string | null): Promise<void> => {
    if (!settings) return;
    const next: Settings = { ...settings, automation: { ...auto, review } };
    setSettings(next);
    try { setSettings(await api.putSettings({ automation: { review } })); } catch (e) { setToast((e as Error).message); }
  };
  const reviewing = running === 'review';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={() => void run('review', t('focus.run'))} disabled={busy} title={t('focus.runHint')} className="btn-primary">
        {reviewing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{reviewing ? t('focus.running') : hasFocus ? t('focus.rerun') : t('focus.run')}
      </button>
      {reviewing && <OpenInChat threadId={threadId} />}
      <Toggle label={t('focus.daily')} value={auto.review !== null} onChange={(v) => void saveTime(v ? '07:30' : null)} />
      {auto.review !== null && <TimeField value={auto.review} onChange={(v) => void saveTime(v)} label={t('focus.daily')} />}
    </div>
  );
}

/** What the brain suggests spending time on, in its order; this week's and what waits on others fold away below. */
export function PrioritiesCard() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const { focus, nodeOf } = useFocus();
  return (
    <Card accent="var(--color-accent)">
      <CardTitle color="var(--color-accent)">{t('guide.priorities')}</CardTitle>
      {focus?.date && <p className="-mt-1 mb-2 text-[11px] text-muted">{t('focus.from').replace('{date}', fmtDate(focus.date, locale, { weekday: 'long', month: 'long', day: 'numeric' }))}</p>}
      {focus === undefined ? null : !focus || !focus.now.length ? <Empty>{t('focus.empty')}</Empty> : (
        <>
          <FocusList lines={focus.now} nodeOf={nodeOf} numbered />
          {focus.week.length > 0 && (
            <details className="focus-more mt-3">
              <summary><ChevronDown size={13} />{t('focus.week')} <span>{fmtNum(focus.week.length, locale)}</span></summary>
              <FocusList lines={focus.week} nodeOf={nodeOf} />
            </details>
          )}
          {focus.waiting.length > 0 && (
            <details className="focus-more mt-2">
              <summary><ChevronDown size={13} />{t('focus.waiting')} <span>{fmtNum(focus.waiting.length, locale)}</span></summary>
              <FocusList lines={focus.waiting} nodeOf={nodeOf} />
            </details>
          )}
          {focus.review && <p className="mt-3 text-[11.5px] text-muted"><span className="font-semibold">{t('focus.review')}</span> <bdi>{focus.review}</bdi></p>}
        </>
      )}
      <div className="mt-4"><ReviewControls hasFocus={Boolean(focus)} /></div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">{t('focus.dailyHint')}</p>
    </Card>
  );
}

/**
 * The review's questions: what it would not decide without the owner. An answer goes to the brain in a chat of its
 * own, which applies it and takes the question off the list.
 */
export function QuestionsCard() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const { focus } = useFocus();
  const asked = focus?.asked ?? [];
  return (
    <Card accent="var(--color-warn)">
      <CardTitle color="var(--color-warn)" count={asked.length ? fmtNum(asked.length, locale) : undefined}>{t('guide.questions')}</CardTitle>
      <p className="-mt-1 mb-3 text-[11.5px] leading-relaxed text-muted">{t('guide.questionsHint')}</p>
      {asked.length ? <div className="space-y-3">{asked.map((q) => <Question key={q} text={q} />)}</div> : <Empty>{t('guide.noQuestions')}</Empty>}
    </Card>
  );
}

function Question({ text }: { text: string }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const setToast = useStore((s) => s.setToast);
  const resolve = useResolve();
  const [answer, setAnswer] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const send = async (): Promise<void> => {
    const a = answer.trim();
    if (!a) return;
    const prompt = `The full review asked me: «${text}»\nMy answer: ${a}\n\nApply my answer to the vault (update or create the items it concerns), then remove this question from "## Asked of you" in memory/focus.md.`;
    const r = await startRun({ prompt, mode: 'chat', display: `${t('guide.answerLabel')}: ${a}`, newThread: true, aside: true });
    if (r) { setSent(r.threadId); setAnswer(''); setToast(t('guide.answerSent')); }
  };
  return (
    <div className="question">
      <div className="flex gap-2">
        <MessageCircleQuestion size={16} className="mt-0.5 shrink-0 text-warn" />
        <div className="reading min-w-0 flex-1 text-[13.5px]"><Markdown text={text} resolve={resolve} /></div>
      </div>
      {sent ? <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">{t('guide.answered')}<OpenInChat threadId={sent} /></div> : (
        <div className="question-answer">
          <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={1} placeholder={t('guide.answerPh')} dir={inputDir(answer, locale)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <button onClick={() => void send()} disabled={!answer.trim()} className="icon-btn small" aria-label={t('guide.answerSend')} title={t('guide.answerSend')}><Send size={15} /></button>
        </div>
      )}
    </div>
  );
}

export function FocusList({ lines, nodeOf, numbered = false }: { lines: FocusLine[]; nodeOf: (l: FocusLine) => UiGraphNode | undefined; numbered?: boolean }) {
  const locale = useStore((s) => s.locale);
  const select = useStore((s) => s.select);
  const today = todayStr();
  return (
    <ol className="space-y-0.5">
      {lines.map((l, i) => {
        const n = nodeOf(l);
        return (
          <li key={i}>
            <div className={`row ${n ? 'cursor-pointer' : ''}`} onClick={() => { if (n) select(n.id); }}>
              {numbered && <span className="focus-num">{(i + 1).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US')}</span>}
              {n && <ActCheck node={n} />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-text utext" dir="auto">{n ? n.title : l.text}</div>
                {l.why && <div className="truncate text-xs text-muted utext" dir="auto">{l.why}</div>}
              </div>
              {n && (
                <div className="flex shrink-0 items-center gap-2">
                  <CategoryChip node={n} small />
                  {n.due && <span className={`text-[11px] ${daysBetween(n.due, today) > 0 ? 'text-danger' : 'text-muted'}`}>{fmtDate(n.due, locale, { month: 'short', day: 'numeric' })}</span>}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
