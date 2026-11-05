const pad = (n: number): string => String(n).padStart(2, '0');

/** ISO 8601 with the local UTC offset, e.g. `2026-10-31T14:05:00+03:30`. */
export function toIsoWithOffset(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function nowIso(): string {
  return toIsoWithOffset(new Date());
}

/** Local calendar date `YYYY-MM-DD`. */
export function toLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayLocal(): string {
  return toLocalDate(new Date());
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Whole days from `fromDate` to `toDate` (both `YYYY-MM-DD`); negative when `toDate` is earlier. */
export function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.UTC(Number(fromDate.slice(0, 4)), Number(fromDate.slice(5, 7)) - 1, Number(fromDate.slice(8, 10)));
  const b = Date.UTC(Number(toDate.slice(0, 4)), Number(toDate.slice(5, 7)) - 1, Number(toDate.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}
