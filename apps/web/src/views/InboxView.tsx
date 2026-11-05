import { AlertCircle, Check, Clock, Loader2, MessageSquareText, RotateCcw, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { useT } from '../i18n';
import { api } from '../lib/api';
import { fmtDateTime, fmtNum, sep } from '../lib/format';
import type { InboxFileState } from '../lib/types';
import { fileInboxItems, type InboxItemRef } from '../state/inbox-filing';
import { queuePosition, useStore } from '../state/store';
import { TypeIcon } from '../components/TypeIcon';
import { Card, Empty } from '../components/ui';

/** Inbox (spec: docs/UI-DESIGN.md "Inbox"): raw captures waiting for the brain to file them into categories. */
export function InboxView({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const graph = useStore((s) => s.graph);
  const select = useStore((s) => s.select);
  const filing = useStore((s) => s.inboxFiling);
  const batch = useStore((s) => s.inboxBatch);
  const queue = useStore((s) => s.queue);
  const setThread = useStore((s) => s.setThread);
  const revealChat = useStore((s) => s.revealChat);
  const setToast = useStore((s) => s.setToast);

  const rows = useMemo(() => {
    const list: InboxItemRef[] = (graph?.nodes ?? []).filter((n) => n.type === 'inbox' && n.path).map((n) => ({ id: n.id, path: n.path ?? '', title: n.title, created: n.created }));
    const known = new Set(list.map((r) => r.path));
    // Items whose file the brain already deleted stay visible until their run settles.
    for (const [path, st] of Object.entries(filing)) if (!known.has(path) && st.status !== 'filed') list.push({ id: st.nodeId, path, title: st.title, created: st.created });
    return list.sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''));
  }, [graph, filing]);

  const inFlight = rows.some((r) => { const st = filing[r.path]; return st?.status === 'queued' || st?.status === 'running'; });
  const openRun = async (threadId: string): Promise<void> => {
    try { setThread(await api.thread(threadId)); revealChat(); } catch (e) { setToast((e as Error).message); }
  };
  const queuedLabel = (st: InboxFileState): string => {
    const ahead = st.runId ? queuePosition(queue, st.runId) ?? st.position ?? 0 : 0;
    return ahead > 0 ? t('inbox.queuedAt').replace('{n}', fmtNum(ahead, locale)) : t('inbox.queued');
  };

  const status = (row: InboxItemRef, st: InboxFileState | undefined) => {
    const fileIt = (
      <button onClick={(e) => { e.stopPropagation(); void fileInboxItems([row]); }} className="btn-soft"><Sparkles size={13} />{t('inbox.fileIt')}</button>
    );
    const showRun = st?.threadId ? (
      <button onClick={(e) => { e.stopPropagation(); void openRun(st.threadId ?? ''); }} className="icon-btn tiny ghost" title={t('inbox.showRun')} aria-label={t('inbox.showRun')}><MessageSquareText size={13} /></button>
    ) : null;
    switch (st?.status) {
      case 'queued': return <span className="flex items-center gap-1.5 text-xs text-muted"><Clock size={13} />{queuedLabel(st)}{showRun}</span>;
      case 'running': return <span className="flex items-center gap-1.5 text-xs text-accent"><Loader2 size={13} className="animate-spin" />{t('inbox.filing')}{showRun}</span>;
      case 'filed': return <span className="flex items-center gap-2 text-xs"><span className="flex items-center gap-1 text-ok"><Check size={13} />{t('inbox.filed')}</span>{fileIt}</span>;
      case 'failed': return (
        <span className="flex items-center gap-2 text-xs">
          <span className="flex items-center gap-1 text-danger" title={st.error}><AlertCircle size={13} />{t('inbox.failed')}</span>
          <button onClick={(e) => { e.stopPropagation(); void fileInboxItems([row]); }} className="btn-soft danger"><RotateCcw size={12} />{t('inbox.retry')}</button>
          {showRun}
        </span>
      );
      default: return fileIt;
    }
  };

  return (
    <div className={embedded ? '' : 'view-body view-wide'}>
      <header className="view-header">
        <div>
          {embedded ? <h2 className="text-base font-semibold text-text">{t('inbox.title')} <span className="font-medium text-muted">{fmtNum(rows.length, locale)}</span></h2>
            : <h1 className="view-title">{t('inbox.title')} <span className="text-base font-medium text-muted">{fmtNum(rows.length, locale)}</span></h1>}
          <p className="view-sub">{t('inbox.hint')}</p>
        </div>
        {batch ? (
          <span className="btn-soft text-accent" title={t('inbox.batchHint')}>
            <Loader2 size={14} className="animate-spin" />
            {t('inbox.fileAll')}{sep(locale)}{t('inbox.progress').replace('{n}', fmtNum(batch.index + 1, locale)).replace('{total}', fmtNum(batch.paths.length, locale))}
          </span>
        ) : rows.length > 1 && (
          <button onClick={() => void fileInboxItems(rows)} disabled={inFlight} title={t('inbox.batchHint')} className="btn-primary"><Sparkles size={14} />{t('inbox.fileAll')}</button>
        )}
      </header>
      <details className="inbox-about mt-4" open={rows.length === 0}>
        <summary>{t('inbox.aboutTitle')}</summary>
        <ul>
          <li>{t('inbox.about1')}</li>
          <li>{t('inbox.about2')}</li>
          <li>{t('inbox.about3')}</li>
        </ul>
      </details>
      {rows.length === 0 && <Card className="mt-4"><Empty>{t('inbox.empty')}</Empty></Card>}
      <ul className="mt-4 space-y-2">
        {rows.map((row) => {
          const st = filing[row.path];
          return (
            <li key={row.path} onClick={() => select(row.id)} className={`inbox-row ${st?.status === 'running' ? 'is-running' : ''}`}>
              <TypeIcon type="inbox" size={16} className="mt-0.5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-text utext" dir="auto">{row.title}</div>
                <div className="mt-0.5 text-[11px] text-muted">{fmtDateTime(row.created, locale)}</div>
              </div>
              <div className="flex shrink-0 items-center">{status(row, st)}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
