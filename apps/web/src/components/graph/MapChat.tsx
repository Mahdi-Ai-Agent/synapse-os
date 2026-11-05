import { MessageCircle, Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useT } from '../../i18n';
import { clampRect, moveRect, resizeRect, type Rect } from '../../lib/floating';
import { useStore } from '../../state/store';
import { LiveReply, Message } from '../../views/ChatView';

/**
 * The conversation on the map (UI-DESIGN "Mind map" → Talking on the map): the current chat's messages and the reply
 * as it streams, in a panel the user drags anywhere on the map by its header, resizes from its corner and puts back
 * above the tell bar with one button. It stays open while the user visits other pages; only its own button starts a
 * new conversation. On a phone it stays docked.
 */
export function MapChat({ dock, compact }: { dock: CSSProperties; compact: boolean }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const thread = useStore((s) => s.thread);
  const run = useStore((s) => s.run);
  const { open, rect } = useStore((s) => s.mapChat);
  const setMapChat = useStore((s) => s.setMapChat);
  const panel = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const [area, setArea] = useState({ w: 0, h: 0 });
  // While the pointer moves the panel it lives here; the store gets it when the pointer lets go.
  const [moving, setMoving] = useState<Rect | null>(null);
  const rtl = locale === 'fa';

  useEffect(() => {
    const host = panel.current?.parentElement;
    if (!host) return;
    const measure = (): void => setArea({ w: host.clientWidth, h: host.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [open]);

  const liveHere = run !== null && thread !== null && run.threadId === thread.id;
  const settled = run !== null && Boolean(thread?.messages.some((m) => m.role === 'brain' && m.runId === run.runId));
  const showLive = liveHere && !settled && (run.status === 'running' || run.status === 'queued' || Boolean(run.text) || run.tools.length > 0 || Boolean(run.error));

  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight });
  }, [run?.text, run?.tools.length, run?.status, thread?.messages.length, thread?.id, open]);
  useEffect(() => { stick.current = true; }, [thread?.id]);

  if (!open) return null;
  const placed = !compact && (moving ?? rect) ? clampRect((moving ?? rect)!, area.w || 1200, area.h || 800) : null;

  /** Where the panel is now, in the map's pixels (it may still be docked above the bar). */
  const current = (): Rect | null => {
    const el = panel.current;
    const host = el?.parentElement;
    if (!el || !host) return null;
    const a = el.getBoundingClientRect(); const b = host.getBoundingClientRect();
    return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
  };
  const follow = (e: ReactPointerEvent<HTMLElement>, next: (start: Rect, dx: number, dy: number) => Rect): void => {
    if (compact || e.button !== 0) return;
    const start = current();
    if (!start) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX; const y0 = e.clientY;
    let last = start;
    const onMove = (ev: PointerEvent): void => { last = next(start, ev.clientX - x0, ev.clientY - y0); setMoving(last); };
    const onUp = (): void => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      setMoving(null);
      setMapChat({ rect: last });
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };
  const W = area.w || 1200; const H = area.h || 800;
  const startMove = (e: ReactPointerEvent<HTMLElement>): void => {
    if ((e.target as HTMLElement).closest('button')) return;
    follow(e, (s, dx, dy) => moveRect(s, dx, dy, W, H));
  };
  const startResize = (e: ReactPointerEvent<HTMLElement>): void => follow(e, (s, dx, dy) => resizeRect(s, dx, dy, rtl, W, H));
  const newConversation = (): void => {
    const s = useStore.getState();
    s.setThread(null);
    if (s.run && s.run.status !== 'running' && s.run.status !== 'queued') s.setRun(null);
  };

  // A panel the user placed keeps physical pixels (the map's own coordinates), like the map canvas it floats on.
  const style: CSSProperties = placed ? { left: placed.x, top: placed.y, width: placed.w, height: placed.h } : dock;
  const empty = !thread?.messages.length && !showLive;
  return (
    <div ref={panel} className={`map-chat ${placed ? '' : 'is-docked'}`} style={style} role="dialog" aria-label={t('map.chat.title')}>
      <div className={`map-chat-head ${moving ? 'is-moving' : ''} ${compact ? 'is-fixed' : ''}`} onPointerDown={startMove} title={compact ? undefined : t('map.chat.drag')}>
        <span className={`brain-orb tiny ${run && (run.status === 'running' || run.status === 'queued') ? 'is-busy' : ''}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-text utext" dir="auto">{thread?.title || t('map.chat.title')}</span>
        <button onClick={newConversation} className="icon-btn tiny ghost" title={t('map.chat.new')} aria-label={t('map.chat.new')}><Plus size={14} /></button>
        <button onClick={() => useStore.getState().revealChat()} className="icon-btn tiny ghost" title={t('map.continue')} aria-label={t('map.continue')}><MessageCircle size={13} /></button>
        {rect && !compact && <button onClick={() => setMapChat({ rect: null })} className="icon-btn tiny ghost" title={t('map.chat.reset')} aria-label={t('map.chat.reset')}><RotateCcw size={13} /></button>}
        <button onClick={() => setMapChat({ open: false })} className="icon-btn tiny ghost" title={t('map.dismiss')} aria-label={t('map.dismiss')}><X size={14} /></button>
      </div>
      <div ref={list} className="map-chat-body scroll-thin" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; }}>
        {empty ? <p className="map-chat-empty">{t('map.chat.empty')}</p> : (
          <>
            {thread?.messages.map((m) => <Message key={m.id} m={m} live={liveHere && run?.runId === m.runId && !settled} />)}
            {showLive && <LiveReply />}
          </>
        )}
      </div>
      {!compact && <div className="map-chat-resize" onPointerDown={startResize} title={t('map.chat.resize')} aria-hidden />}
    </div>
  );
}
