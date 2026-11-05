const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

export function isRtlText(s: string): boolean {
  return RTL_RE.test(s);
}

/**
 * Direction of the script most of a text's letters are in, or null with no letters or a tie (nothing is forced).
 * A Persian paragraph that opens with a Latin label stays right-to-left this way, unlike the first-strong rule.
 */
/**
 * `dir` for a text field: the UI's direction while it is empty (so the placeholder and the caret start on the UI
 * side), then the text's own direction — a browser resolves `auto` on an empty field to left-to-right.
 */
export function inputDir(value: string, locale: 'fa' | 'en'): 'auto' | 'rtl' | 'ltr' {
  return value.trim() ? 'auto' : locale === 'fa' ? 'rtl' : 'ltr';
}

export function dominantDir(s: string): 'rtl' | 'ltr' | null {
  const rtl = (s.match(/[֐-ࣿיִ-﷿ﹰ-﻿]/g) ?? []).length;
  const ltr = (s.match(/[A-Za-zÀ-ɏ]/g) ?? []).length;
  return rtl > ltr ? 'rtl' : ltr > rtl ? 'ltr' : null;
}

export function todayStr(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function fmtDate(iso: string | null | undefined, locale: 'fa' | 'en', opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Times are always on the 24-hour clock: no AM/PM anywhere (UI-DESIGN "Words").
  const out = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', { hourCycle: 'h23', ...opts }).format(d);
  // ICU joins Persian date parts with a Latin comma; the Persian comma reads right.
  return locale === 'fa' ? out.replace(/,/g, '،') : out;
}

export function fmtDateTime(iso: string | null | undefined, locale: 'fa' | 'en'): string {
  return fmtDate(iso, locale, { dateStyle: 'medium', timeStyle: 'short' });
}

/** The separator between facts in a line: «،» in Persian, where a middle dot beside digits reads as a zero. */
export function sep(locale: 'fa' | 'en'): string {
  return locale === 'fa' ? '، ' : ' · ';
}

export function fmtNum(n: number, locale: 'fa' | 'en'): string {
  return new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(n);
}

export function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** 1234 → "1.2k", 950 → "950". */
export function fmtK(n: number, locale: 'fa' | 'en'): string {
  if (n < 1000) return fmtNum(n, locale);
  const k = n / 1000;
  return `${fmtNum(Math.round(k * 10) / 10, locale)}k`;
}

/** Time of day of an ISO timestamp in the UI locale , always 24-hour ("۱۴:۰۵" / "14:05"). */
export function fmtTime(iso: string | null | undefined, locale: 'fa' | 'en'): string {
  return fmtDate(iso, locale, { timeStyle: 'short' });
}
