import { useStore } from '../state/store';

/**
 * A 24-hour time ("HH:mm") as two small lists, hour then minute — the app never shows AM/PM (UI-DESIGN "Words"). A
 * minute that is not on the five-minute steps is kept as its own choice.
 */
export function TimeField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  const locale = useStore((s) => s.locale);
  const [h = '00', m = '00'] = value.split(':');
  const num = (n: number): string => (locale === 'fa' ? n.toLocaleString('fa-IR', { minimumIntegerDigits: 2 }) : String(n).padStart(2, '0'));
  const minutes = [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), Number(m)])].sort((a, b) => a - b);
  const set = (hh: string, mm: string): void => onChange(`${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`);
  return (
    <span className="time-field-24" dir="ltr" role="group" aria-label={label}>
      <select value={Number(h)} onChange={(e) => set(e.target.value, m)} aria-label={label}>
        {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{num(i)}</option>)}
      </select>
      <span>:</span>
      <select value={Number(m)} onChange={(e) => set(h, e.target.value)}>
        {minutes.map((i) => <option key={i} value={i}>{num(i)}</option>)}
      </select>
    </span>
  );
}
