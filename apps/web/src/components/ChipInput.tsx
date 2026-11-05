import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { useT } from '../i18n';
import { inputDir } from '../lib/format';
import { useStore } from '../state/store';

const FIELD = 'mt-1 w-full rounded-lg border border-line bg-transparent px-2 py-1 outline-none focus-within:border-accent focus:border-accent';

function key(s: string): string {
  return s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Strips `[[ ]]` so a pasted wikilink and a plain title mean the same thing. */
export function plainTitle(v: string): string {
  return v.trim().replace(/^\[\[|\]\]$/g, '').trim();
}

/** Text input with native suggestions (datalist); free text stays allowed, so a value may name a node that does not exist yet. */
export function ComboInput({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) {
  const listId = useId();
  return (
    <>
      <input list={listId} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={FIELD} dir="auto" />
      <datalist id={listId}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </>
  );
}

/**
 * Chips plus an input. Enter, `,` or leaving the field adds the typed value; Backspace on an empty input removes the
 * last chip. Suggestions are drawn by the component itself (a native datalist swallows Enter while its popup is open).
 */
export function ChipInput({ values, onChange, suggestions = [], placeholder }: { values: string[]; onChange: (v: string[]) => void; suggestions?: string[]; placeholder?: string }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const taken = new Set(values.map(key));
  const q = key(text);
  const matches = q ? suggestions.filter((s) => !taken.has(key(s)) && key(s).includes(q)).slice(0, 6) : [];
  const add = (raw: string): void => {
    const v = plainTitle(raw);
    setText(''); setActive(0);
    if (!v || values.some((x) => key(x) === key(v))) return;
    onChange([...values, v]);
  };
  const remove = (i: number): void => onChange(values.filter((_, idx) => idx !== i));
  return (
    <div className="relative">
      <div className={`${FIELD} flex flex-wrap items-center gap-1`}>
        {values.map((v, i) => (
          <span key={`${v}-${i}`} className="flex items-center gap-1 rounded-md bg-panel2 px-1.5 py-0.5 text-xs text-text" dir="auto">
            {v}
            <button type="button" onClick={() => remove(i)} className="text-muted hover:text-danger" title={t('panel.remove')}><X size={11} /></button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => { setText(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(matches[active] ?? text); }
            else if (e.key === 'ArrowDown' && matches.length) { e.preventDefault(); setActive((a) => (a + 1) % matches.length); }
            else if (e.key === 'ArrowUp' && matches.length) { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); }
            else if (e.key === 'Escape') setText('');
            else if (e.key === 'Backspace' && !text && values.length) remove(values.length - 1);
          }}
          onBlur={() => add(text)}
          placeholder={values.length ? undefined : placeholder}
          className="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted"
          dir={inputDir(text, locale)}
        />
      </div>
      {matches.length > 0 && (
        <ul className="glass absolute inset-x-0 top-full z-20 mt-1 max-h-40 overflow-y-auto p-1 text-sm" role="listbox">
          {matches.map((s, i) => (
            <li key={s}>
              <button type="button" role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => add(s)} className={`block w-full rounded-md px-2 py-1 text-start ${i === active ? 'bg-panel2 text-text' : 'text-muted hover:text-text'}`} dir="auto">{s}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
