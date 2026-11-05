import { useEffect, useRef } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { Direction, Tooltip } from 'radix-ui';
import { Dialogs } from './components/Dialogs';
import { GraphView } from './components/GraphView';
import { NodePanel } from './components/NodePanel';
import { AuthScreen } from './components/AuthScreen';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { translate, useT } from './i18n';
import { api } from './lib/api';
import { applyFonts, loadFontChoice } from './lib/fonts';
import { refreshThreads } from './lib/brain';
import { useIsMobile } from './lib/media';
import { onUnauthorized } from './lib/pairing';
import type { BrainEvent, BrainMode, BrainQueue, NodeChanges } from './lib/types';
import { brainActivity, TouchMap } from './lib/activity';
import { analysisTitle, placeIdOf, placeRuns } from './lib/places';
import { CORE_ID } from './components/GraphView';
import { recordError } from './lib/diagnostics';
import { layoutEvents, type LayoutSavedEvent } from './lib/layout-sync';
import { connectLive } from './lib/ws';
import { onInboxRunDone, onInboxRunStarted } from './state/inbox-filing';
import { lastThreadId, useStore } from './state/store';
import { PlacesView } from './views/PlacesView';
import { ChatView } from './views/ChatView';
import { GuideView } from './views/GuideView';
import { InboxView } from './views/InboxView';
import { MeView } from './views/MeView';
import { PlanView } from './views/PlanView';
import { GoalsView } from './views/GoalsView';
import { MoreView } from './views/MoreView';
import { SettingsView } from './views/SettingsView';

/** Width of the item panel that opens beside a page (end side). */
const DETAIL_W = 400;

/** "The analysis of … is ready", with See, unless that place's page is the one on screen (UI-DESIGN "Places"). */
function placeReady(id: string, title: string): void {
  const s = useStore.getState();
  if (s.view === 'categories' && s.categoryPage === id) return;
  s.setToast(translate(s.locale, 'places.analysisReady').replace('{name}', title), { label: translate(s.locale, 'coach.see'), run: () => { const st = useStore.getState(); st.setCategoryPage(id); st.setView('categories'); } });
}

/** The app shell (spec: docs/UI-DESIGN.md "Shell"): sidebar on the start side, one page at a time, the item panel beside it. */
/**
 * `#item=<id>`: the link an AI app gives for an item it found over MCP (docs/ARCHITECTURE.md "MCP connector") opens
 * that item on the map; the fragment is dropped once read.
 */
function openItemFromHash(): void {
  const m = /^#item=([^&]+)/.exec(location.hash);
  if (!m?.[1]) return;
  history.replaceState(null, '', location.pathname + location.search);
  const s = useStore.getState();
  s.setView('graph');
  s.select(decodeURIComponent(m[1]));
}

export default function App() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const view = useStore((s) => s.view);
  const vault = useStore((s) => s.vault);
  const selectedId = useStore((s) => s.selectedId);
  const toast = useStore((s) => s.toast);
  const live = useStore((s) => s.live);
  const setToast = useStore((s) => s.setToast);
  const setView = useStore((s) => s.setView);
  const unauthorized = useStore((s) => s.unauthorized);
  const isMobile = useIsMobile();
  const graphTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A 401 means this device is not signed in (docs/ARCHITECTURE.md "Access control"): show the sign-in screen, not broken views.
  useEffect(() => onUnauthorized(() => useStore.getState().setUnauthorized(true)), []);

  // `more` is the phone's fifth tab; the desktop has the sidebar instead.
  useEffect(() => { if (!isMobile && view === 'more') setView('settings'); }, [isMobile, view, setView]);
  // Keep the shell inside the visual viewport so the composer stays above the on-screen keyboard (100dvh ignores it).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!isMobile || !vv) return;
    const root = document.documentElement;
    const update = (): void => { root.style.setProperty('--app-height', `${Math.round(vv.height)}px`); window.scrollTo(0, 0); };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); root.style.removeProperty('--app-height'); };
  }, [isMobile]);

  useEffect(() => {
    document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
    applyFonts(loadFontChoice(), locale);
  }, [locale]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), useStore.getState().toastAction ? 7000 : 3500);
    return () => clearTimeout(id);
  }, [toast, setToast]);

  useEffect(() => {
    const s = useStore.getState();
    const load = async (): Promise<void> => {
      try {
        const v = await api.vault();
        s.setVault(v);
        if (!v.exists) return;
        s.setSettings(v.settings);
        s.setLocale(v.settings.locale);
        const [g, e, th] = await Promise.all([api.graph(), api.engines(), api.threads()]);
        s.setGraph(g);
        s.setEngines(e.engines, e.place);
        s.setThreads(th.threads);
        // The conversation open when the app was last left goes on (only New chat starts another).
        const last = lastThreadId();
        if (last && !useStore.getState().thread && th.threads.some((x) => x.id === last)) {
          api.thread(last).then((t) => { if (!useStore.getState().thread) useStore.getState().setThread(t); }).catch(() => undefined);
        }
        openItemFromHash();
      } catch (err) { s.setToast((err as Error).message); }
    };
    void load();
    window.addEventListener('hashchange', openItemFromHash);
    return () => window.removeEventListener('hashchange', openItemFromHash);
  }, []);

  useEffect(() => {
    if (unauthorized) return;
    const touches = new TouchMap(CORE_ID);
    const refreshGraph = (): void => {
      if (graphTimer.current) clearTimeout(graphTimer.current);
      graphTimer.current = setTimeout(() => {
        api.graph().then((g) => {
          useStore.getState().setGraph(g);
          // An item the brain just wrote is on the map now: its signal goes once the map has it.
          const arrived = touches.arrived(g.nodes);
          if (arrived.length) setTimeout(() => brainActivity.touch(arrived, 'write'), 450);
        }).catch(() => undefined);
      }, 200);
    };
    const dispose = connectLive((m) => {
      const s = useStore.getState();
      switch (m.type) {
        case 'hello': {
          const p = m.payload as { queue?: BrainQueue };
          if (p.queue) s.setQueue(p.queue);
          refreshGraph();
          // (Re)connected: saves another copy made meanwhile may have been missed.
          layoutEvents.saved(null);
          break;
        }
        case 'graph.updated': refreshGraph(); break;
        case 'layout.saved': layoutEvents.saved(m.payload as LayoutSavedEvent); break;
        case 'brain.queue': s.setQueue(m.payload as BrainQueue); break;
        case 'brain.started': {
          const p = m.payload as { runId: string; threadId: string; mode: BrainMode };
          s.setRun((prev) => (prev && prev.runId === p.runId ? { ...prev, status: 'running' } : { runId: p.runId, threadId: p.threadId, mode: p.mode, status: 'running', text: '', tools: [] }));
          onInboxRunStarted(p.runId);
          break;
        }
        case 'brain.event': {
          const p = m.payload as { runId: string; threadId: string; event: BrainEvent; touched?: { paths: string[]; kind: 'read' | 'write' } };
          // What the tool touched becomes a signal on the map (lib/activity.ts `TouchMap`).
          if (p.touched?.paths.length) {
            const ids = touches.ids(p.touched.paths, p.touched.kind, s.graph?.nodes ?? []);
            if (ids.length) brainActivity.touch(ids, p.touched.kind);
          }
          s.setRun((prev) => {
            const base = prev && prev.runId === p.runId ? prev : { runId: p.runId, threadId: p.threadId, mode: 'chat' as BrainMode, status: 'running' as const, text: '', tools: [] };
            const ev = p.event;
            switch (ev.type) {
              case 'text_delta': return { ...base, text: base.text + ev.text, notice: undefined };
              case 'tool_use': return { ...base, tools: [...base.tools, { id: ev.id, summary: ev.summary }], notice: undefined };
              case 'notice': return { ...base, notice: ev.message };
              case 'tool_result': return { ...base, tools: base.tools.map((x) => (x.id === ev.toolUseId ? { ...x, ok: ev.ok } : x)) };
              case 'result': return { ...base, text: base.text || ev.text, costUsd: ev.costUsd, tokens: ev.tokens, ...(ev.isError ? { status: 'error' as const, error: ev.text } : {}) };
              case 'error': return { ...base, status: 'error', error: ev.message };
              default: return base;
            }
          });
          break;
        }
        case 'brain.changes': {
          const p = m.payload as NodeChanges & { runId: string };
          s.setHighlight(p);
          s.setRun((prev) => (prev && prev.runId === p.runId ? { ...prev, changes: { created: p.created, updated: p.updated, deleted: p.deleted, commit: p.commit } } : prev));
          refreshGraph();
          break;
        }
        case 'brain.done': {
          const p = m.payload as { runId: string; threadId: string; ok: boolean; error?: string; message?: { mode?: BrainMode } };
          if (!p.ok && p.error && p.error !== 'cancelled') recordError({ code: `RUN-${p.runId.slice(-8)}`, message: p.error });
          s.setRun((prev) => (prev && prev.runId === p.runId ? { ...prev, status: p.ok ? 'done' : 'error', error: p.error ?? prev.error } : prev));
          onInboxRunDone(p.runId, p.ok, p.error);
          // A review or an insight that finished while its page is not open (scheduled, or started there and left): say so.
          const mode = p.message?.mode;
          const place = placeRuns.get(p.runId);
          if (place) {
            placeRuns.delete(p.runId);
            if (p.ok) placeReady(place.id, place.title);
          } else if (p.ok && mode === 'insight') {
            // Started in another open copy or before a reload: the thread says whether it was one place's analysis.
            api.thread(p.threadId).then((th) => {
              const st = useStore.getState();
              const title = analysisTitle(th.messages.find((x) => x.role === 'user' && x.runId === p.runId)?.text ?? '');
              const id = title ? placeIdOf(title, st.graph?.categories ?? [], st.graph?.maps ?? []) : null;
              if (title) { if (id) placeReady(id, title); return; }
              if (st.view !== 'coach') st.setToast(translate(st.locale, 'coach.insightReady'), { label: translate(st.locale, 'coach.see'), run: () => { useStore.getState().setView('me'); } });
            }).catch(() => undefined);
          } else if (p.ok && (mode === 'daily' || mode === 'weekly' || mode === 'review') && s.view !== 'coach') {
            const key = mode === 'daily' ? 'coach.ready' : mode === 'weekly' ? 'coach.weeklyReady' : 'focus.ready';
            s.setToast(translate(s.locale, key), { label: translate(s.locale, 'coach.see'), run: () => { useStore.getState().setView(mode === 'review' ? 'coach' : 'plan'); } });
          }
          // The character map was built or rebuilt: offer to see it on the mind map.
          if (p.ok && mode === 'character') {
            s.setToast(translate(s.locale, 'maps.characterReady'), { label: translate(s.locale, 'coach.see'), run: () => {
              const st = useStore.getState();
              const m = st.graph?.maps.find((x) => x.role === 'character');
              st.setView('graph');
              if (m) setTimeout(() => useStore.getState().requestFly([], undefined, m.id), 120);
            } });
          }
          // Only the open chat follows the run; another chat's reply (inbox sorting) lands in its own thread.
          if (s.thread && s.thread.id === p.threadId) api.thread(p.threadId).then((th) => useStore.getState().setThread(th)).catch(() => undefined);
          void refreshThreads();
          setTimeout(() => { api.engines().then((e) => useStore.getState().setEngines(e.engines, e.place)).catch(() => undefined); }, 1500);
          break;
        }
        default: break;
      }
    }, (st) => useStore.getState().setLive(st));
    return dispose;
  }, [unauthorized]);

  if (unauthorized) return <AuthScreen />;
  if (!vault) return <div className="flex h-full items-center justify-center text-muted">{t('common.loading')}</div>;
  if (!vault.exists) return <NoVault />;

  const dir = locale === 'fa' ? 'rtl' : 'ltr';
  const page = (
    <>
      {view === 'chat' && <ChatView />}
      {(view === 'coach' || view === 'today') && <Scroll><GuideView /></Scroll>}
      {view === 'goals' && <Scroll><GoalsView /></Scroll>}
      {view === 'plan' && <Scroll><PlanView /></Scroll>}
      {view === 'inbox' && <Scroll><InboxView /></Scroll>}
      {view === 'me' && <Scroll><MeView /></Scroll>}
      {view === 'categories' && <PlacesView />}
      {view === 'settings' && <Scroll><SettingsView /></Scroll>}
      {view === 'more' && <Scroll><MoreView /></Scroll>}
    </>
  );

  if (isMobile) {
    return (
      <Direction.Provider dir={dir}>
        <MotionConfig reducedMotion="user">
          <Tooltip.Provider delayDuration={400}>
            <div className="safe-top flex h-full flex-col bg-bg">
              <main className="relative min-h-0 flex-1 overflow-hidden">
                <GraphView compact active={view === 'graph'} />
                {view !== 'graph' && <div className="absolute inset-0 flex flex-col bg-bg">{page}</div>}
              </main>
              <TabBar />
              {selectedId && <NodePanel sheet />}
              <Dialogs />
              {(live.mode === 'offline' || live.mode === 'connecting') && <Offline bottom={84} />}
              <Toast bottom={88} />
            </div>
          </Tooltip.Provider>
        </MotionConfig>
      </Direction.Provider>
    );
  }

  return (
    <Direction.Provider dir={dir}>
      <MotionConfig reducedMotion="user">
        <Tooltip.Provider delayDuration={350}>
          <div className="app-shell">
            <Sidebar />
            <main className="app-main">
              <GraphView active={view === 'graph'} />
              {view !== 'graph' && (
                <div className="page-layer">
                  <motion.div key={view} className="page-body" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: 'easeOut' }}>{page}</motion.div>
                  <AnimatePresence>
                    {selectedId && (
                      <motion.aside key="detail" className="detail-panel" style={{ width: DETAIL_W }}
                        initial={{ opacity: 0, x: dir === 'rtl' ? -24 : 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir === 'rtl' ? -16 : 16 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}>
                        <NodePanel />
                      </motion.aside>
                    )}
                  </AnimatePresence>
                </div>
              )}
              {(live.mode === 'offline' || live.mode === 'connecting') && <Offline bottom={20} />}
            </main>
            <Dialogs />
            <Toast bottom={24} />
          </div>
        </Tooltip.Provider>
      </MotionConfig>
    </Direction.Provider>
  );
}

function Scroll({ children }: { children: React.ReactNode }) {
  return <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>;
}

/** The live channel is down (or still coming up): what is wrong, with its code; a click opens Settings → Diagnostics. */
function Offline({ bottom }: { bottom: number }) {
  const t = useT();
  const live = useStore((s) => s.live);
  const setView = useStore((s) => s.setView);
  return (
    <button className="offline-pill" style={{ bottom }} onClick={() => setView('settings')} title={t('diag.title')}>
      {live.mode === 'offline' ? t('live.offline') : t('ws.offline')}
      {live.code && <span className="ms-1.5 font-mono opacity-80" dir="ltr">{live.code}</span>}
    </button>
  );
}

function Toast({ bottom }: { bottom: number }) {
  const toast = useStore((s) => s.toast);
  const action = useStore((s) => s.toastAction);
  const setToast = useStore((s) => s.setToast);
  if (!toast) return null;
  return (
    <div className="toast fade-in" style={{ bottom }}>
      <span><bdi>{toast}</bdi></span>
      {action && <button onClick={() => { action.run(); setToast(null); }} className="toast-action">{action.label}</button>}
    </div>
  );
}

function NoVault() {
  const t = useT();
  const vault = useStore((s) => s.vault);
  const setToast = useStore((s) => s.setToast);
  const create = async (sample: boolean): Promise<void> => {
    try { await api.createVault(sample); location.reload(); } catch (e) { setToast((e as Error).message); }
  };
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="glass max-w-md p-6 text-center">
        <h1 className="font-display text-2xl font-bold">{t('app.title')}</h1>
        <p className="mt-2 text-sm text-muted">{t('vault.missingHint')}</p>
        <p className="mt-3 font-mono text-xs text-muted" dir="ltr">{vault?.path}</p>
        <div className="mt-5 flex flex-col gap-2">
          <button onClick={() => void create(true)} className="btn-primary justify-center">{t('vault.createSample')}</button>
          <button onClick={() => void create(false)} className="btn-ghost justify-center">{t('vault.create')}</button>
        </div>
      </div>
    </div>
  );
}
