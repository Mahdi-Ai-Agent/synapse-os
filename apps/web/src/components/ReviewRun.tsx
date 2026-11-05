import { MessageSquareText } from 'lucide-react';
import { useT } from '../i18n';
import { api } from '../lib/api';
import { startRun } from '../lib/brain';
import type { BrainMode, RunStart } from '../lib/types';
import { useStore } from '../state/store';

/**
 * Runs a review in a chat of its own without leaving the page, the open conversation left as it is; the page
 * refreshes when the journal changes.
 */
export function useReviewRun(): { run: (mode: BrainMode, label: string, prompt?: string) => Promise<RunStart | null>; running: BrainMode | null; busy: boolean; threadId: string | null } {
  const live = useStore((s) => s.run);
  const busy = live !== null && (live.status === 'running' || live.status === 'queued');
  /** `label` is what the chat shows; `prompt`, when given, is what the brain gets (`[[Place]]` for one place's analysis). */
  const run = async (mode: BrainMode, label: string, prompt?: string): Promise<RunStart | null> => {
    if (busy) return null;
    return startRun({ prompt: prompt ?? label, mode, display: label, newThread: true, aside: true });
  };
  return { run, running: busy ? live.mode : null, busy, threadId: live?.threadId ?? null };
}

export function OpenInChat({ threadId }: { threadId: string | null }) {
  const t = useT();
  const setThread = useStore((s) => s.setThread);
  const revealChat = useStore((s) => s.revealChat);
  if (!threadId) return null;
  return <button onClick={() => { void api.thread(threadId).then((th) => { setThread(th); revealChat(); }); }} className="btn-soft"><MessageSquareText size={14} />{t('coach.inChat')}</button>;
}
