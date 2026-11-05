import { Mic, MicOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import { joinDictation, recognitionCtor, startDictation, type Dictation } from '../lib/dictation';
import { useStore } from '../state/store';

/**
 * The microphone beside a message box (UI-DESIGN "Chat" → Voice): press, speak, press again; what is said appears in
 * the box as it is recognized, after what was typed. Hidden where the browser has no speech recognition.
 */
export function MicButton({ value, onChange, size = 16 }: { value: string; onChange: (v: string) => void; size?: number }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const setToast = useStore((s) => s.setToast);
  const supported = useMemo(() => recognitionCtor() !== null, []);
  const [on, setOn] = useState(false);
  const dictation = useRef<Dictation | null>(null);
  const before = useRef('');
  const written = useRef('');

  useEffect(() => () => dictation.current?.stop(), []);
  // The box was sent or cleared while listening: stop, so nothing said a moment ago lands in it again.
  useEffect(() => {
    if (on && value === '' && written.current !== '') dictation.current?.stop();
  }, [on, value]);

  if (!supported) return null;
  const toggle = (): void => {
    if (on) { dictation.current?.stop(); return; }
    before.current = value;
    written.current = value;
    const d = startDictation({
      lang: locale === 'fa' ? 'fa-IR' : 'en-US',
      onText: (heard) => { const next = joinDictation(before.current, heard); written.current = next; onChange(next); },
      onEnd: () => { dictation.current = null; setOn(false); },
      onError: (code) => {
        if (code === 'not-allowed' || code === 'service-not-allowed') setToast(t('voice.denied'));
        else if (code !== 'no-speech' && code !== 'aborted') setToast(t('voice.failed').replace('{code}', code));
      },
    });
    if (d) { dictation.current = d; setOn(true); }
  };
  const label = on ? t('voice.stop') : t('voice.start');
  return (
    <button type="button" onClick={toggle} className={`icon-btn small ghost mic-btn ${on ? 'is-on' : ''}`} aria-pressed={on} aria-label={label} title={label}>
      {on ? <MicOff size={size} /> : <Mic size={size} />}
    </button>
  );
}
