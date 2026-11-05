import type { BrainMode, RunStart } from './types';
import { api } from './api';
import { scopesOf } from './maps';
import { useStore } from '../state/store';

/**
 * Starts a brain run from anywhere in the app (chat, the map's tell bar, the add dialog, reviews) and wires the
 * live state: the run, the thread it belongs to and the recent-chats list. Model and effort come from the chat's
 * picker, falling back to the engine's defaults on the server; the scope (UI-DESIGN "Scopes") goes along whenever
 * some map is cut off from the mind map.
 */
/**
 * Starts a brain run on the open conversation, or on a new one (`newThread`). A run started `aside` (a review from the
 * guide, plan or a place's page) keeps its own chat and leaves the open conversation as it is (UI-DESIGN "Chat" → One conversation).
 */
export async function startRun(input: { prompt: string; mode?: BrainMode; display?: string; focusId?: string; newThread?: boolean; aside?: boolean }): Promise<RunStart | null> {
  const s = useStore.getState();
  const mode = input.mode ?? 'chat';
  const scopes = scopesOf(s.graph?.maps ?? []);
  const scope = scopes.length > 1 ? (scopes.some((x) => x.id === s.scope) ? s.scope : 'mind') : undefined;
  try {
    const r = await api.run({
      prompt: input.prompt, mode, display: input.display, focusId: input.focusId ?? s.selectedId ?? undefined,
      threadId: input.newThread ? undefined : s.thread?.id, view: s.view, locale: s.locale, ...(scope ? { scope } : {}),
      ...(s.choice.engine ? { engine: s.choice.engine } : {}), ...(s.choice.model ? { model: s.choice.model } : {}), ...(s.choice.effort ? { effort: s.choice.effort } : {}),
    });
    s.setRun((prev) => (prev && prev.runId === r.runId ? prev : { runId: r.runId, threadId: r.threadId, mode, status: r.queued ? 'queued' : 'running', position: r.position, text: '', tools: [] }));
    if (!input.aside && (!s.thread || s.thread.id !== r.threadId)) s.setThread(await api.thread(r.threadId));
    void refreshThreads();
    return r;
  } catch (e) {
    s.setToast((e as Error).message);
    return null;
  }
}

/** Reloads the recent-chats list in the sidebar. */
export async function refreshThreads(): Promise<void> {
  try { useStore.getState().setThreads((await api.threads()).threads); } catch { /* the list keeps its last state */ }
}

/** Opens a past chat in the chat page. */
export async function openThread(id: string): Promise<void> {
  const s = useStore.getState();
  try { s.setThread(await api.thread(id)); s.revealChat(); } catch (e) { s.setToast((e as Error).message); }
}

/** Starts a fresh chat (the next message creates its thread). */
export function newChat(): void {
  const s = useStore.getState();
  s.setThread(null);
  if (s.run && s.run.status !== 'running' && s.run.status !== 'queued') s.setRun(null);
  s.revealChat();
  s.focusComposer();
}
