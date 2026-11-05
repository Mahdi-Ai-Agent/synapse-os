import { ArrowUp, MessageCircle, Square } from 'lucide-react';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { startRun } from '../../lib/brain';
import { inputDir } from '../../lib/format';
import { useDraft } from '../../lib/drafts';
import { useStore } from '../../state/store';
import { ScopePick } from '../ScopePick';
import { MicButton } from '../MicButton';

/**
 * Talk to the brain without leaving the map (spec: docs/UI-DESIGN.md "Mind map" → Talking on the map): a message here
 * goes on the current conversation, whose messages and streaming reply float in `MapChat` while new items fly into
 * their regions.
 */
export function TellBar() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const run = useStore((s) => s.run);
  const thread = useStore((s) => s.thread);
  const chatOpen = useStore((s) => s.mapChat.open);
  const setMapChat = useStore((s) => s.setMapChat);
  const [text, setText] = useDraft('map');
  const busy = run !== null && (run.status === 'running' || run.status === 'queued');

  const send = async (): Promise<void> => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setText('');
    setMapChat({ open: true });
    const r = await startRun({ prompt });
    if (!r) setText(prompt);
  };

  return (
    <div className="tell-wrap">
      <div className="tell-bar">
        <span className={`brain-orb small ${busy ? 'is-busy' : ''}`} aria-hidden />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('map.tellPh')} dir={inputDir(text, locale)} className="min-w-0 flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-muted"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        <ScopePick />
        <MicButton value={text} onChange={setText} size={15} />
        {!chatOpen && (thread?.messages.length ?? 0) > 0 && (
          <button onClick={() => setMapChat({ open: true })} className="icon-btn small ghost" aria-label={t('map.chat.show')} title={t('map.chat.show')}><MessageCircle size={15} /></button>
        )}
        {/* The brain reads the message itself: a worry is consult, "write me a post" is make, the rest is chat. */}
        {busy && run ? (
          <button onClick={() => void api.cancel(run.runId)} className="send-btn is-stop" aria-label={t('chat.stop')} title={t('chat.stop')}><Square size={12} fill="currentColor" /></button>
        ) : (
          <button onClick={() => void send()} disabled={!text.trim() || busy} className="send-btn" aria-label={t('chat.send')} title={t('chat.send')}><ArrowUp size={17} strokeWidth={2.4} /></button>
        )}
      </div>
    </div>
  );
}
