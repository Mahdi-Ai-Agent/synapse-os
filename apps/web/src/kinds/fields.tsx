import { CalendarDays, Check, ChevronDown, Copy, Pencil, X } from 'lucide-react';
import { DropdownMenu, Popover } from 'radix-ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { fmtDate, inputDir } from '../lib/format';
import { useStore } from '../state/store';

/*
 * Facts about an item are pills in its header (spec: docs/UI-DESIGN.md "Item details"): a state, a date, a choice,
 * a short text. Each one edits itself in place — a menu, the native date picker, a small popover — and saves at once.
 */

/** A read-only fact. */
export function InfoChip({ icon, children, tone = '', title }: { icon?: ReactNode; children: ReactNode; tone?: string; title?: string }) {
  return <span className={`chip is-static ${tone}`} title={title}>{icon}<span className="min-w-0 truncate utext" dir="auto">{children}</span></span>;
}

export interface ChipOption<T extends string> { value: T; label: string; hint?: string; icon?: ReactNode }

/** One of a few choices (a state, how often, a mood); the menu explains each one when it has a hint. */
export function ChoiceChip<T extends string>({ icon, value, placeholder, currentLabel, options, onChange, clearable = false, tone = '' }: {
  icon?: ReactNode; value: T | undefined; placeholder: string; currentLabel?: string; options: Array<ChipOption<T>>; onChange: (v: T | null) => void; clearable?: boolean; tone?: string;
}) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const current = options.find((o) => o.value === value);
  return (
    <DropdownMenu.Root dir={locale === 'fa' ? 'rtl' : 'ltr'} modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className={`chip ${current ? '' : 'is-empty'} ${tone}`}>
          {current?.icon ?? icon}
          <span className="min-w-0 truncate utext" dir="auto">{currentLabel ?? current?.label ?? placeholder}</span>
          <ChevronDown size={12} className="chip-caret" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" sideOffset={6} align="start" collisionPadding={10}>
          {options.map((o) => (
            <DropdownMenu.Item key={o.value} className={`menu-item ${o.hint ? 'has-hint' : ''}`} onSelect={() => onChange(o.value)}>
              <span className="menu-icon">{o.icon ?? icon}</span>
              <span className="min-w-0 flex-1"><span className="block">{o.label}</span>{o.hint && <span className="menu-hint">{o.hint}</span>}</span>
              {o.value === value && <Check size={14} className="shrink-0 text-accent" />}
            </DropdownMenu.Item>
          ))}
          {clearable && current && (
            <>
              <DropdownMenu.Separator className="menu-sep" />
              <DropdownMenu.Item className="menu-item text-muted" onSelect={() => onChange(null)}><span className="menu-icon"><X size={13} /></span>{t('common.clear')}</DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** A date; a click opens the native picker, the small × clears it. */
export function DateChip({ icon, value, format, placeholder, onSave, tone = '' }: { icon?: ReactNode; value: string | undefined; format: (d: string) => string; placeholder: string; onSave: (v: string | null) => void; tone?: string }) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="chip-host">
      <button type="button" className={`chip ${value ? '' : 'is-empty'} ${tone}`} onClick={() => openPicker(ref.current)}>
        {icon ?? <CalendarDays size={12} />}
        <span>{value ? format(value) : placeholder}</span>
      </button>
      {value && <button type="button" className="chip-x" onClick={() => onSave(null)} aria-label={t('common.clear')} title={t('common.clear')}><X size={10} /></button>}
      <input ref={ref} type="date" value={value ?? ''} onChange={(e) => onSave(e.target.value || null)} className="pointer-events-none absolute inset-0 opacity-0" tabIndex={-1} aria-hidden />
    </span>
  );
}

/** A short free text (a place, a contact); a click opens a small box, Enter or leaving it saves. */
export function TextChip({ icon, value, placeholder, onSave, ltr = false }: { icon?: ReactNode; value: string | undefined; placeholder: string; onSave: (v: string | null) => void; ltr?: boolean }) {
  const locale = useStore((s) => s.locale);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { if (open) setDraft(value ?? ''); }, [open, value]);
  const commit = (): void => {
    setOpen(false);
    const v = draft.trim();
    if (v !== (value ?? '')) onSave(v || null);
  };
  return (
    <Popover.Root open={open} onOpenChange={(o) => { if (!o) commit(); else setOpen(true); }}>
      <Popover.Trigger asChild>
        <button type="button" className={`chip ${value ? '' : 'is-empty'}`}>{icon}<span className="min-w-0 max-w-[12rem] truncate utext" dir={ltr ? 'ltr' : 'auto'}>{value || placeholder}</span></button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover w-64 p-2" sideOffset={6} align="start" collisionPadding={10}>
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} className="field w-full" dir={ltr ? 'ltr' : inputDir(draft, locale)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { setDraft(value ?? ''); setOpen(false); } }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A labelled row in a detail view. */
export function Field({ label, children, icon }: { label: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="field-row">
      <span className="field-label">{icon}{label}</span>
      <span className="field-value">{children}</span>
    </div>
  );
}

/** Text shown as-is; a click turns it into an input that saves on Enter or blur. */
export function InlineText({ value, placeholder, onSave, multiline = false, className = '' }: { value: string; placeholder: string; onSave: (v: string) => void | Promise<void>; multiline?: boolean; className?: string }) {
  const locale = useStore((s) => s.locale);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);
  const commit = (): void => { setEditing(false); if (draft.trim() !== value.trim()) void onSave(draft.trim()); };
  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className={`inline-text ${value ? '' : 'is-empty'} ${className}`}>
        <span className="utext min-w-0 flex-1" dir="auto">{value || placeholder}</span>
        <Pencil size={11} className="inline-pen shrink-0" />
      </button>
    );
  }
  const props = {
    ref, value: draft, dir: inputDir(draft, locale), className: `field w-full ${className}`,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); } if (e.key === 'Escape') { setDraft(value); setEditing(false); } },
  };
  return multiline ? <textarea rows={3} {...props} /> : <input {...props} />;
}

/** A date shown in the UI calendar (Persian in fa); a click opens the native picker. */
export function DateField({ value, onSave, placeholder }: { value: string | undefined; onSave: (v: string | null) => void; placeholder: string }) {
  const locale = useStore((s) => s.locale);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="relative inline-flex items-center gap-2">
      <button type="button" className={`inline-text ${value ? '' : 'is-empty'}`} onClick={() => openPicker(ref.current)}>
        <CalendarDays size={12} className="shrink-0 opacity-70" />
        <span>{value ? fmtDate(value, locale, { year: 'numeric', month: 'long', day: 'numeric' }) : placeholder}</span>
      </button>
      <input ref={ref} type="date" value={value ?? ''} onChange={(e) => onSave(e.target.value || null)} className="pointer-events-none absolute inset-0 opacity-0" tabIndex={-1} aria-hidden />
    </span>
  );
}

/** One-of-many choice as a row of pills. */
export function Segmented<T extends string>({ value, options, onChange }: { value: T | undefined; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <span className="segmented">
      {options.map((o) => <button key={o.value} type="button" onClick={() => onChange(o.value)} className={value === o.value ? 'is-on' : ''}>{o.label}</button>)}
    </span>
  );
}

export function CopyText({ value }: { value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="inline-text" onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1400); }} title={t('settings.copy')}>
      <span className="utext" dir="auto">{value}</span>
      {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} className="opacity-60" />}
    </button>
  );
}

/** Opens a date input's native picker (Chrome, Safari 16+), or focuses it where `showPicker` is missing. */
function openPicker(el: HTMLInputElement | null): void {
  if (!el) return;
  const withPicker = el as HTMLInputElement & { showPicker?: () => void };
  try { if (withPicker.showPicker) { withPicker.showPicker(); return; } } catch { /* not allowed here: fall back */ }
  el.focus();
  el.click();
}
