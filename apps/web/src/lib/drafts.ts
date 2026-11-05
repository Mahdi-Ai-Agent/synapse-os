import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { onBeforeLock } from './desktop';

/**
 * A text box whose unsent text survives a reload and the Mac app's lock: it is saved in the vault (`/api/drafts`) a
 * second after typing stops, at once before a lock, and cleared when it is emptied (sending empties it).
 */
let loaded: Promise<Record<string, string>> | null = null;
const latest: Record<string, string> = {};

export function useDraft(key: 'chat' | 'map'): [string, (text: string) => void] {
  const [text, setText] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const value = pending.current;
    if (value === null) return;
    pending.current = null;
    await api.saveDraft(key, value).catch(() => { pending.current ??= value; });
  }, [key]);

  useEffect(() => {
    let alive = true;
    loaded ??= api.drafts().then((r) => r.drafts).catch(() => ({}));
    void loaded.then((d) => {
      const saved = latest[key] ?? d[key];
      if (alive && saved) setText((now) => now || saved);
    });
    const off = onBeforeLock(flush);
    return () => { alive = false; off(); void flush(); };
  }, [key, flush]);

  const update = useCallback((next: string): void => {
    setText(next);
    latest[key] = next;
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, next ? 1000 : 0);
  }, [key, flush]);

  return [text, update];
}
