import { ArrowUp, AtSign, Check, Compass, Copy, History, Lightbulb, Link2, Loader2, Map as MapIcon, MessageCircleQuestion, MessagesSquare, MoreHorizontal, PenLine, Plus, Send, SquarePen, Square, Trash2, Undo2, UserRound, X, Zap, Heart, Scale, EyeOff, Flag, Wand2 } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { BrainWorking } from '../components/BrainWorking';
import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useT, type TKey } from '../i18n';
import { api } from '../lib/api';
import { newChat, openThread, refreshThreads, startRun } from '../lib/brain';
import { daysBetween, fmtK, fmtNum, fmtTime, inputDir, sep, todayStr } from '../lib/format';
import { useIsMobile } from '../lib/media';
import { useDraft } from '../lib/drafts';
import type { BrainMode, NodeChanges, ThreadMessage, ThreadSummary, TokenUsage, UiGraphNode } from '../lib/types';
import { queuePosition, useStore } from '../state/store';
import { EnginePicker } from '../components/EnginePicker';
import { Markdown } from '../components/Markdown';
import { ScopePick } from '../components/ScopePick';
import { KindCard } from '../kinds/Cards';
import { MicButton } from '../components/MicButton';

const SUGGESTIONS: Array<{ title: TKey; text: TKey; Icon: typeof Lightbulb }> = [
  { title: 'chat.tryTitle1', text: 'chat.try1', Icon: Lightbulb },
  { title: 'chat.tryTitle2', text: 'chat.try2', Icon: Link2 },
  { title: 'chat.tryTitle3', text: 'chat.try3', Icon: Heart },
  { title: 'chat.tryTitle4', text: 'chat.try4', Icon: MessageCircleQuestion },
];
const ADVICE: Array<{ text: TKey; Icon: typeof Lightbulb }> = [
  { text: 'chat.adv1', Icon: Scale },
  { text: 'chat.adv2', Icon: Flag },
  { text: 'chat.adv3', Icon: Compass },
  { text: 'chat.adv4', Icon: EyeOff },
];
const MAKES: Array<{ text: TKey; Icon: typeof Lightbulb }> = [
  { text: 'chat.make1', Icon: Send },
  { text: 'chat.make2', Icon: AtSign },
  { text: 'chat.make3', Icon: PenLine },
  { text: 'chat.make4', Icon: UserRound },
];

/** The orb's tint per mode: periwinkle for chat, amber for consult, green for making. */
const orbClass = (mode: BrainMode | undefined): string => (mode === 'advise' ? 'is-advise' : mode === 'make' ? 'is-make' : '');

/**
 * The chat page (spec: docs/UI-DESIGN.md "Chat"), like ChatGPT or Claude: it opens on a fresh chat — a greeting and
 * the composer in the middle — with the past chats in a column of their own beside it; every reply shows what the
 * brain saved as the cards of their kinds. In consult mode the brain thinks a problem through instead of filing; in
 * make mode it writes something — a post, a caption, a message — in the user's voice from the maps involved.
 */
export function ChatView() {
  const t = useT();
  const thread = useStore((s) => s.thread);
  const run = useStore((s) => s.run);
  const historyOpen = useStore((s) => s.chatHistoryOpen);
  const chatMode = useStore((s) => s.chatMode);
  const isMobile = useIsMobile();
  const listRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const [draft, setDraft] = useDraft('chat');
  const [sheet, setSheet] = useState(false);

  const liveHere = run !== null && thread !== null && run.threadId === thread.id;
  const settled = run !== null && Boolean(thread?.messages.some((m) => m.role === 'brain' && m.runId === run.runId));
  const showLive = liveHere && !settled && (run.status === 'running' || run.status === 'queued' || Boolean(run.text) || run.tools.length > 0 || Boolean(run.error));
  const empty = (!thread || thread.messages.length === 0) && !showLive;
  const advise = chatMode === 'advise';
  const make = chatMode === 'make';

  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [run?.text, run?.tools.length, run?.status, thread?.messages.length, thread?.id]);
  useEffect(() => { stick.current = true; }, [thread?.id]);

  const body = empty ? (
    <div className="chat-empty">
      <div className="chat-col">
        <div className={`brain-orb large mx-auto mb-5 ${orbClass(chatMode)}`} aria-hidden />
        <h1 className="chat-greeting">{advise ? t('chat.adviseGreeting') : make ? t('chat.makeGreeting') : t('chat.greeting')}</h1>
        <p className="chat-greeting-hint">{advise ? t('chat.adviseHint') : make ? t('chat.makeHint') : t('chat.greetingHint')}</p>
        <Composer value={draft} onChange={setDraft} big />
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {advise || make ? (advise ? ADVICE : MAKES).map(({ text, Icon }) => (
            <button key={text} onClick={() => { setDraft(t(text)); useStore.getState().focusComposer(); }} className="suggestion">
              <Icon size={16} className="mt-0.5 shrink-0 text-accent" />
              <span className="min-w-0 text-start text-[13px] leading-relaxed text-text utext" dir="auto">{t(text)}</span>
            </button>
          )) : SUGGESTIONS.map(({ title, text, Icon }) => (
            <button key={text} onClick={() => { setDraft(t(text)); useStore.getState().focusComposer(); }} className="suggestion">
              <Icon size={16} className="mt-0.5 shrink-0 text-accent" />
              <span className="min-w-0 text-start">
                <span className="block text-[13px] font-semibold text-text">{t(title)}</span>
                <span className="block truncate text-xs text-muted utext" dir="auto">{t(text)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  ) : (
    <>
      <div ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140; }}>
        <div className="chat-col pb-6 pt-2">
          {thread?.messages.map((m) => <Message key={m.id} m={m} live={liveHere && run?.runId === m.runId && !settled} />)}
          {showLive && run && <LiveReply />}
        </div>
      </div>
      <div className="chat-dock">
        <div className="chat-col">
          <Composer value={draft} onChange={setDraft} />
          <p className="chat-foot">{t('chat.foot')}</p>
        </div>
      </div>
    </>
  );

  return (
    <div className="chat-page">
      {!isMobile && historyOpen && <ChatHistory />}
      <div className="chat-main">
        <ChatHeader historyOpen={!isMobile && historyOpen} onHistory={() => { if (isMobile) setSheet(true); else useStore.getState().setChatHistoryOpen(!historyOpen); }} />
        {body}
      </div>
      {isMobile && sheet && <div className="item-sheet safe-top fixed inset-0 z-40 flex flex-col"><ChatHistory sheet onClose={() => setSheet(false)} /></div>}
    </div>
  );
}

function ChatHeader({ historyOpen, onHistory }: { historyOpen: boolean; onHistory: () => void }) {
  const t = useT();
  const thread = useStore((s) => s.thread);
  return (
    <header className="chat-head">
      <button onClick={onHistory} className={`icon-btn small ghost ${historyOpen ? 'is-active' : ''}`} aria-label={historyOpen ? t('chat.historyHide') : t('chat.historyShow')} title={historyOpen ? t('chat.historyHide') : t('chat.historyShow')}><History size={16} /></button>
      <div className="min-w-0 flex-1 truncate text-sm font-semibold text-text utext" dir="auto">{thread && thread.messages.length > 0 ? thread.title : ''}</div>
      <EnginePicker />
      <button onClick={newChat} className="icon-btn small ghost" aria-label={t('nav.newChat')} title={t('nav.newChat')}><SquarePen size={16} /></button>
    </header>
  );
}

/** Chats from before the app labelled its own prompts carry the raw filing instruction as their title. */
function threadTitle(title: string, t: (k: TKey) => string): string {
  if (!title) return t('chat.untitled');
  return /^Process the inbox item at nodes\/inbox\//.test(title) ? t('chat.fileInboxLegacy') : title;
}

function groupThreads(threads: ThreadSummary[], today: string): Array<{ key: TKey; items: ThreadSummary[] }> {
  const groups: Array<{ key: TKey; items: ThreadSummary[] }> = [{ key: 'chat.today', items: [] }, { key: 'chat.yesterday', items: [] }, { key: 'chat.earlier', items: [] }, { key: 'chat.older', items: [] }];
  for (const th of threads) {
    const age = daysBetween(th.updatedAt.slice(0, 10), today);
    groups[age <= 0 ? 0 : age === 1 ? 1 : age < 7 ? 2 : 3]!.items.push(th);
  }
  return groups.filter((g) => g.items.length > 0);
}

/** The past chats, by day, in a column beside the chat (a full-screen sheet on the phone). */
function ChatHistory({ sheet = false, onClose }: { sheet?: boolean; onClose?: () => void }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const threads = useStore((s) => s.threads);
  const thread = useStore((s) => s.thread);
  const setOpen = useStore((s) => s.setChatHistoryOpen);
  const groups = useMemo(() => groupThreads(threads, todayStr()), [threads]);
  const close = (): void => { if (onClose) onClose(); else setOpen(false); };
  return (
    <aside className={`chat-history ${sheet ? 'is-sheet' : ''}`} aria-label={t('chat.history')}>
      <div className="chat-history-head">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{t('chat.history')}</span>
        <button onClick={close} className="icon-btn small ghost" aria-label={sheet ? t('common.close') : t('chat.historyHide')} title={sheet ? t('common.close') : t('chat.historyHide')}><X size={16} /></button>
      </div>
      <div className="px-3 pb-2">
        <button onClick={() => { newChat(); onClose?.(); }} className="side-new"><Plus size={17} /><span>{t('nav.newChat')}</span></button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {threads.length === 0 && <p className="px-3 py-2 text-xs text-muted">{t('chat.noHistory')}</p>}
        {groups.map((g) => (
          <div key={g.key}>
            <div className="history-label">{t(g.key)}</div>
            {g.items.map((th) => <HistoryRow key={th.id} th={th} active={thread?.id === th.id} onOpen={() => { void openThread(th.id); onClose?.(); }} />)}
          </div>
        ))}
      </div>
    </aside>
  );
}

/** One past chat: open it, or rename or delete it from its ⋯ menu (UI-DESIGN "Chat"). Delete asks twice. */
function HistoryRow({ th, active, onOpen }: { th: ThreadSummary; active: boolean; onOpen: () => void }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(th.title);
  const [confirming, setConfirming] = useState(false);
  const save = async (): Promise<void> => {
    setEditing(false);
    const next = title.replace(/\s+/g, ' ').trim();
    if (!next || next === th.title) { setTitle(th.title); return; }
    try {
      await api.renameThread(th.id, next);
      const s = useStore.getState();
      if (s.thread?.id === th.id) s.setThread({ ...s.thread, title: next });
      await refreshThreads();
    } catch (e) { useStore.getState().setToast((e as Error).message); setTitle(th.title); }
  };
  const remove = async (): Promise<void> => {
    try {
      await api.deleteThread(th.id);
      const s = useStore.getState();
      if (s.thread?.id === th.id) s.setThread(null);
      await refreshThreads();
      s.setToast(t('chat.threadDeleted'));
    } catch (e) { useStore.getState().setToast((e as Error).message); }
  };
  if (editing) {
    return (
      <div className="history-item">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => void save()} dir={inputDir(title, locale)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void save(); } if (e.key === 'Escape') { setEditing(false); setTitle(th.title); } }}
          className="history-input" aria-label={t('chat.rename')} />
      </div>
    );
  }
  return (
    <div className={`history-item ${active ? 'is-active' : ''}`}>
      <button onClick={onOpen} className={`history-row ${active ? 'is-active' : ''}`} title={th.title}>
        <span className="w-full truncate utext" dir="auto">{threadTitle(th.title, t)}</span>
        <small><bdi>{fmtTime(th.updatedAt, locale)}</bdi>{sep(locale)}<bdi>{t('chat.messages').replace('{n}', fmtNum(th.messageCount, locale))}</bdi></small>
      </button>
      <DropdownMenu.Root onOpenChange={(o) => { if (!o) setConfirming(false); }} dir={locale === 'fa' ? 'rtl' : 'ltr'} modal={false}>
        <DropdownMenu.Trigger asChild>
          <button className="history-more icon-btn tiny ghost" aria-label={t('chat.rowMenu')} title={t('chat.rowMenu')}><MoreHorizontal size={15} /></button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu" align="end" sideOffset={4} collisionPadding={8} onCloseAutoFocus={(e) => e.preventDefault()}>
            <DropdownMenu.Item className="menu-item" onSelect={() => { setTitle(th.title); setEditing(true); }}><PenLine size={14} />{t('chat.rename')}</DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item is-danger" onSelect={(e) => { if (!confirming) { e.preventDefault(); setConfirming(true); return; } void remove(); }}><Trash2 size={14} />{confirming ? t('chat.deleteConfirm') : t('chat.delete')}</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

/** Chat, consult or make: what the next message asks of the brain. */
function ModeSwitch() {
  const t = useT();
  const mode = useStore((s) => s.chatMode);
  const setMode = useStore((s) => s.setChatMode);
  return (
    <span className="mode-switch" role="radiogroup" aria-label={t('chat.modeLabel')}>
      <button type="button" role="radio" aria-checked={mode === 'chat'} onClick={() => setMode('chat')} className={mode === 'chat' ? 'is-on' : ''} title={t('chat.modeHint.chat')}><MessagesSquare size={13} />{t('chat.modeChat')}</button>
      <button type="button" role="radio" aria-checked={mode === 'advise'} onClick={() => setMode('advise')} className={mode === 'advise' ? 'is-on' : ''} title={t('chat.modeHint.advise')}><Compass size={13} />{t('chat.modeAdvise')}</button>
      <button type="button" role="radio" aria-checked={mode === 'make'} onClick={() => setMode('make')} className={mode === 'make' ? 'is-on' : ''} title={t('chat.modeHint.make')}><Wand2 size={13} />{t('chat.modeMake')}</button>
    </span>
  );
}

/** The message box: Enter sends, Shift+Enter breaks the line; "+" adds by hand, the bolt saves to the inbox without the brain. */
export function Composer({ value, onChange, big = false, compact = false, placeholder }: { value: string; onChange: (v: string) => void; big?: boolean; compact?: boolean; placeholder?: string }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const run = useStore((s) => s.run);
  const thread = useStore((s) => s.thread);
  const chatMode = useStore((s) => s.chatMode);
  const focusAt = useStore((s) => s.composerFocusAt);
  const openDialog = useStore((s) => s.openDialog);
  const setToast = useStore((s) => s.setToast);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const busy = run !== null && (run.status === 'running' || run.status === 'queued');

  useEffect(() => { if (focusAt) ref.current?.focus(); }, [focusAt]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, big ? 260 : 220)}px`;
  }, [value, big]);

  const send = async (): Promise<void> => {
    const prompt = value.trim();
    if (!prompt || busy) return;
    onChange('');
    const r = await startRun({ prompt, mode: chatMode });
    if (!r) onChange(prompt);
  };
  const quickSave = async (): Promise<void> => {
    const text = value.trim();
    if (!text) return;
    onChange('');
    try { await api.capture(text); setToast(t('chat.savedToInbox')); } catch (e) { setToast((e as Error).message); onChange(text); }
  };
  const ph = placeholder ?? (thread && thread.messages.length ? t('chat.placeholderReply') : chatMode === 'advise' ? t('chat.placeholderAdvise') : chatMode === 'make' ? t('chat.placeholderMake') : t('chat.placeholder'));

  return (
    <div className={`composer ${big ? 'is-big' : ''} ${compact ? 'is-compact' : ''}`}>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
        placeholder={ph}
        rows={1}
        className="composer-input scroll-thin"
        dir={inputDir(value, locale)}
      />
      <div className="composer-bar">
        {!compact && <ModeSwitch />}
        {!compact && <ScopePick />}
        {!compact && <button onClick={() => openDialog({ kind: 'add' })} className="icon-btn small ghost" title={t('chat.addByHand')} aria-label={t('chat.addByHand')}><Plus size={17} /></button>}
        {!compact && chatMode === 'chat' && <button onClick={() => void quickSave()} disabled={!value.trim()} className="icon-btn small ghost" title={t('chat.quickSave')} aria-label={t('chat.quickSave')}><Zap size={15} /></button>}
        <div className="flex-1" />
        <MicButton value={value} onChange={onChange} />
        {busy ? (
          <button onClick={() => { if (run) void api.cancel(run.runId); }} className="send-btn is-stop" aria-label={t('chat.stop')} title={t('chat.stop')}><Square size={13} fill="currentColor" /></button>
        ) : (
          <button onClick={() => void send()} disabled={!value.trim()} className="send-btn" aria-label={t('chat.send')} title={t('chat.send')}><ArrowUp size={18} strokeWidth={2.4} /></button>
        )}
      </div>
    </div>
  );
}

function useResolve(): (title: string) => string | null {
  const graph = useStore((s) => s.graph);
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const n of graph?.nodes ?? []) if (!n.ghost) map.set(n.title.normalize('NFC').toLowerCase(), n.id);
    return (title: string) => map.get(title.normalize('NFC').toLowerCase()) ?? null;
  }, [graph]);
}

function spend(t: (k: TKey) => string, locale: 'fa' | 'en', costUsd: number | undefined, tokens: TokenUsage | undefined): ReactElement | null {
  if (costUsd !== undefined && costUsd > 0) return <span title={t('chat.cost')} dir="ltr">${costUsd.toFixed(3)}</span>;
  if (tokens && (tokens.input || tokens.output)) return <span title={t('chat.tokens')} dir="ltr">{fmtK(tokens.input, locale)} / {fmtK(tokens.output, locale)}</span>;
  return null;
}

/** What the thread shows for a user message: the app's own label for prompts it wrote (older threads lack `display`). */
function displayOf(m: ThreadMessage, t: (k: TKey) => string): string {
  if (m.display) return m.display;
  if (m.mode === 'capture' && /nodes\/inbox\/\S+\.md/.test(m.text)) return t('chat.fileInboxLegacy');
  return m.text;
}

export function Message({ m, live }: { m: ThreadMessage; live: boolean }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const resolve = useResolve();
  const [copied, setCopied] = useState(false);
  if (m.role === 'user') {
    const label = m.mode && m.mode !== 'chat' ? t(`chat.mode.${m.mode}` as TKey) : null;
    return (
      <motion.div className="msg-user-row" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
        <div className="msg-user">
          {label && <div className="mb-0.5 text-[10.5px] font-semibold opacity-70">{label}</div>}
          <p className="whitespace-pre-wrap" dir="auto">{displayOf(m, t)}</p>
        </div>
      </motion.div>
    );
  }
  return (
    <motion.div className={`msg-brain ${m.isError ? 'is-error' : ''}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: 'easeOut' }}>
      <div className="msg-avatar"><span className={`brain-orb small ${orbClass(m.mode)}`} aria-hidden /></div>
      <div className="msg-brain-body">
        <div className="msg-bubble">
          <div className="reading"><Markdown text={m.text} resolve={resolve} /></div>
          {m.isError && m.runId && <p className="mt-1 font-mono text-[11px] text-muted" dir="ltr">RUN-{m.runId.slice(-8)}</p>}
        </div>
        {!live && <Saved changes={m.changes} />}
        <div className="msg-tools">
          <button onClick={() => { void navigator.clipboard.writeText(m.text); setCopied(true); setTimeout(() => setCopied(false), 1300); }} className="icon-btn tiny ghost" title={t('chat.copy')} aria-label={t('chat.copy')}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>
          <span>{fmtTime(m.at, locale)}</span>
          <span className="ms-auto">{spend(t, locale, m.costUsd, m.tokens)}</span>
        </div>
      </div>
    </motion.div>
  );
}

export function LiveReply() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const run = useStore((s) => s.run);
  const queue = useStore((s) => s.queue);
  const resolve = useResolve();
  if (!run) return null;
  const busy = run.status === 'running' || run.status === 'queued';
  const ahead = run.status === 'queued' ? queuePosition(queue, run.runId) ?? run.position ?? 1 : 0;
  return (
    <div className="msg-brain">
      <div className="msg-avatar"><span className={`brain-orb small ${busy ? 'is-busy' : ''} ${orbClass(run.mode)}`} aria-hidden /></div>
      <div className="msg-brain-body">
        <div className="msg-bubble">
        {busy && !run.text && (
          <div className="thinking"><BrainWorking />{ahead > 0 ? t('chat.queuedAt').replace('{n}', fmtNum(ahead, locale)) : t('chat.thinking')}{run.tools.length > 0 && <span className="opacity-60">{sep(locale)}{t('chat.steps').replace('{n}', fmtNum(run.tools.length, locale))}</span>}{run.notice && <span className="opacity-60">· <bdi>{run.notice}</bdi></span>}</div>
        )}
        {run.text && <div className="reading"><Markdown text={run.text} resolve={resolve} /></div>}
        {busy && run.text && <span className="typing-dot" />}
        {run.error && <p className="mt-1 text-xs text-danger"><bdi>{run.error}</bdi> <span className="font-mono opacity-70" dir="ltr">RUN-{run.runId.slice(-8)}</span></p>}
        </div>
        <Saved changes={run.changes} />
      </div>
    </div>
  );
}

/** What a reply saved: the items as their own cards, with "show on the map" and undo. */
export function Saved({ changes, compact = false }: { changes: NodeChanges | undefined; compact?: boolean }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const graph = useStore((s) => s.graph);
  const setView = useStore((s) => s.setView);
  const select = useStore((s) => s.select);
  const requestFly = useStore((s) => s.requestFly);
  const setRun = useStore((s) => s.setRun);
  const setToast = useStore((s) => s.setToast);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  if (!changes || (!changes.created.length && !changes.updated.length && !changes.deleted.length)) return null;
  const byId = new Map<string, UiGraphNode>((graph?.nodes ?? []).map((n) => [n.id, n]));
  const created = changes.created.map((id) => byId.get(id)).filter((n): n is UiGraphNode => Boolean(n));
  const updated = changes.updated.map((id) => byId.get(id)).filter((n): n is UiGraphNode => Boolean(n));
  const gone = changes.created.length + changes.updated.length - created.length - updated.length;
  const ids = [...created, ...updated].map((n) => n.id);
  const undo = async (): Promise<void> => {
    if (!changes.commit) return;
    setUndoing(true);
    try {
      await api.undo(changes.commit);
      setUndone(true);
      setToast(t('chat.undone'));
      setRun((r) => (r && r.changes?.commit === changes.commit ? { ...r, changes: { ...changes, commit: undefined } } : r));
    } catch (e) { setToast((e as Error).message); } finally { setUndoing(false); }
  };
  const showOnMap = (): void => {
    setView('graph');
    if (ids.length === 1) select(ids[0]!);
    requestFly(ids);
  };
  const cards = [...created, ...updated];
  return (
    <div className="saved">
      <div className="saved-head">
        <span className="saved-badge"><Check size={12} strokeWidth={3} /></span>
        <span>
          {changes.created.length > 0 && t('chat.saved').replace('{n}', fmtNum(changes.created.length, locale))}
          {changes.created.length > 0 && changes.updated.length > 0 && ' · '}
          {changes.updated.length > 0 && t('chat.updated').replace('{n}', fmtNum(changes.updated.length, locale))}
          {!changes.created.length && !changes.updated.length && changes.deleted.length > 0 && t('chat.deleted')}
        </span>
        <span className="flex-1" />
        {ids.length > 0 && <button onClick={showOnMap} className="saved-action"><MapIcon size={13} />{t('chat.showOnMap')}</button>}
        {changes.commit && !undone && ids.length > 0 && <button onClick={() => void undo()} disabled={undoing} className="saved-action"><Undo2 size={13} />{t('chat.undo')}</button>}
      </div>
      {cards.length > 0 && (
        <div className={`grid gap-2 ${compact ? '' : 'sm:grid-cols-2'}`}>
          {cards.slice(0, 6).map((n) => <KindCard key={n.id} node={n} compact />)}
        </div>
      )}
      {gone > 0 && <p className="mt-1 text-[11px] text-muted">{t('chat.nodeGone')}</p>}
    </div>
  );
}
