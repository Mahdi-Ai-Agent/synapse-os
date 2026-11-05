import { useStore } from '../state/store';
import { en, type TKey } from './en';
import { fa } from './fa';

const dict = { fa, en } as const;

export function translate(locale: 'fa' | 'en', key: TKey): string {
  return dict[locale][key] ?? en[key] ?? key;
}

const bound = new Map<'fa' | 'en', (key: TKey) => string>();

/**
 * The translator for the UI language — one function per language, so memos and effects that list `t` keep still
 * between renders. A new function on every render once rebuilt the map's model on every live poll, and every open
 * copy of the app re-saved its layout with it.
 */
export function useT(): (key: TKey) => string {
  const locale = useStore((s) => s.locale);
  let t = bound.get(locale);
  if (!t) { t = (key) => translate(locale, key); bound.set(locale, t); }
  return t;
}

export type { TKey };
