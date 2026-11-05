import { api } from '../lib/api';
import { translate } from '../i18n';
import type { InboxFileState } from '../lib/types';
import { useStore } from './store';

export interface InboxItemRef { id: string; path: string; title: string; created: string | null }

/** The brain files the item and marks it; the server deletes consumed inbox files after the run (CLI engines cannot delete). */
const filePrompt = (path: string): string => `Process the inbox item at ${path}: file its content into proper nodes, then set \`status: filed\` in that inbox file's frontmatter. Do not delete it; the app removes filed inbox files after the run.`;

const pending = (i: InboxItemRef): InboxFileState => ({ status: 'queued', nodeId: i.id, title: i.title, created: i.created });
const inFlight = (st: InboxFileState | undefined): boolean => st?.status === 'queued' || st?.status === 'running';

/**
 * "File it" on one item, or "File all": a batch runs its items one after another in one brain thread
 * (the server queue is single-flight anyway; sequential starts keep the conversation readable).
 * A retried item reuses its earlier thread so the failed attempt and the retry read as one conversation.
 */
export async function fileInboxItems(items: InboxItemRef[]): Promise<void> {
  const s = useStore.getState();
  const todo = items.filter((i) => i.path && !inFlight(s.inboxFiling[i.path]));
  const first = todo[0];
  if (!first) return;
  if (todo.length === 1) { await startRun(first, s.inboxFiling[first.path]?.threadId); return; }
  s.setInboxBatch({ paths: todo.map((i) => i.path), index: 0 });
  s.patchInboxFiling(Object.fromEntries(todo.map((i) => [i.path, pending(i)])));
  await startRun(first, undefined);
}

async function startRun(item: InboxItemRef, threadId: string | undefined): Promise<void> {
  const s = useStore.getState();
  const base: InboxFileState = { ...pending(item), ...(threadId ? { threadId } : {}) };
  s.patchInboxFiling({ [item.path]: base });
  try {
    const display = translate(s.locale, 'inbox.fileDisplay').replace('{title}', item.title);
    const r = await api.run({ prompt: filePrompt(item.path), mode: 'capture', view: 'inbox', locale: s.locale, inboxPath: item.path, display, ...(threadId ? { threadId } : {}) });
    const st = useStore.getState();
    st.patchInboxFiling({ [item.path]: { ...base, status: r.queued ? 'queued' : 'running', runId: r.runId, threadId: r.threadId, position: r.position } });
    st.setRun((prev) => (prev && prev.runId === r.runId ? prev : { runId: r.runId, threadId: r.threadId, mode: 'capture', status: r.queued ? 'queued' : 'running', position: r.position, text: '', tools: [] }));
    const batch = st.inboxBatch;
    if (batch && !batch.threadId && batch.paths.includes(item.path)) st.setInboxBatch({ ...batch, threadId: r.threadId });
    // The run's WS events may have landed before this response: catch up from the live run state.
    const live = useStore.getState().run;
    if (live && live.runId === r.runId) {
      if (live.status === 'running') onInboxRunStarted(r.runId);
      else if (live.status === 'done') onInboxRunDone(r.runId, true);
      else if (live.status === 'error' || live.status === 'cancelled') onInboxRunDone(r.runId, false, live.error);
    }
  } catch (e) {
    const message = (e as Error).message;
    useStore.getState().patchInboxFiling({ [item.path]: { ...base, status: 'failed', error: message } });
    useStore.getState().setToast(message);
    advanceBatch(item.path, message);
  }
}

/** `brain.started` for a run that files an inbox item. */
export function onInboxRunStarted(runId: string): void {
  const s = useStore.getState();
  const hit = Object.entries(s.inboxFiling).find(([, st]) => st.runId === runId);
  if (hit && hit[1].status === 'queued') s.patchInboxFiling({ [hit[0]]: { ...hit[1], status: 'running' } });
}

/** `brain.done` for a run that files an inbox item; continues the batch when one is running. */
export function onInboxRunDone(runId: string, ok: boolean, error?: string): void {
  const s = useStore.getState();
  const hit = Object.entries(s.inboxFiling).find(([, st]) => st.runId === runId);
  if (!hit) return;
  const [path, st] = hit;
  if (st.status === 'filed' || st.status === 'failed') return; // already settled
  const gone = s.graph !== null && !s.graph.nodes.some((n) => n.path === path);
  if (ok && gone) s.removeInboxFiling([path]);
  else s.patchInboxFiling({ [path]: { ...st, status: ok ? 'filed' : 'failed', ...(ok ? {} : { error: error ?? 'failed' }) } });
  advanceBatch(path, ok ? undefined : error ?? 'failed');
}

function advanceBatch(path: string, error: string | undefined): void {
  const s = useStore.getState();
  const batch = s.inboxBatch;
  if (!batch || batch.paths[batch.index] !== path) return;
  if (error === 'cancelled') { // the user stopped the run: the rest of the batch goes back to idle
    s.removeInboxFiling(batch.paths.slice(batch.index + 1));
    s.setInboxBatch(null);
    return;
  }
  for (let next = batch.index + 1; next < batch.paths.length; next++) {
    const p = batch.paths[next] as string;
    const entry = s.inboxFiling[p];
    if (!entry || entry.status !== 'queued') continue; // pruned or already handled
    s.setInboxBatch({ ...batch, index: next });
    void startRun({ id: entry.nodeId, path: p, title: entry.title, created: entry.created }, batch.threadId);
    return;
  }
  s.setInboxBatch(null);
}
