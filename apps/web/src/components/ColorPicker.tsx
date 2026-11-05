import { Check } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { hexToOklch, maxChroma, oklchToRgb, pickHex, pickOf, rgbToHex, TONE_L } from '../graph/colors';
import { useT } from '../i18n';
import { api } from '../lib/api';
import { usePalette } from '../lib/categories';
import { useStore } from '../state/store';

/** Quick picks: twelve hues at the families' signature lightness, the look of the automatic colours. */
const SWATCHES = [205, 250, 290, 330, 10, 40, 75, 110, 145, 175, 225, 350].map((h) => rgbToHex(oklchToRgb(0.8, 0.15, h)));

/** The field's own pixels: CSS scales it up, and the colours are smooth, so a small bitmap is enough and redraws at once. */
const FIELD_W = 120;
const FIELD_H = 48;
/** A key or slider step is written this long after the last one; letting go of the pointer writes at once. */
const SETTLE_MS = 450;

interface Pick { h: number; rel: number; l: number }

/** The whole spectrum at lightness `l`: hue across, vividness up (each column up to the most chroma sRGB holds there). */
function drawField(canvas: HTMLCanvasElement, l: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(FIELD_W, FIELD_H);
  for (let x = 0; x < FIELD_W; x++) {
    const h = (x / (FIELD_W - 1)) * 360;
    const max = maxChroma(l, h);
    for (let y = 0; y < FIELD_H; y++) {
      const [r, g, b] = oklchToRgb(l, (1 - y / (FIELD_H - 1)) * max, h);
      const o = (y * FIELD_W + x) * 4;
      img.data[o] = r * 255;
      img.data[o + 1] = g * 255;
      img.data[o + 2] = b * 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * The colour picker of a category or a map (spec: docs/UI-DESIGN.md "Colour"): the whole spectrum as a field — hue
 * across, vividness up — at a brightness the slider sets within what the night map can show, quick picks, the hex
 * code and Automatic (`null`). `onPreview` follows every move so the map recolours at once; `onChange` is the choice.
 */
export function ColorPicker({ value, auto, onPreview, onChange, hint }: {
  value: string | null; auto: string; onPreview?: (c: string | null) => void; onChange: (c: string | null) => void; hint?: string;
}) {
  const t = useT();
  const shown = value ?? auto;
  const [pick, setPick] = useState<Pick>(() => pickOf(shown) ?? { h: 0, rel: 0.6, l: 0.8 });
  const [code, setCode] = useState(shown);
  const pickRef = useRef(pick);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const frame = useRef(0);
  const queued = useRef<Pick | null>(null);
  /** The last colour this picker sent: its echo through the store must not move the mark. */
  const own = useRef<string | null>(null);
  /** A choice not yet handed to `onChange` (undefined: none). */
  const pending = useRef<string | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlers = useRef({ onPreview, onChange });
  useEffect(() => { handlers.current = { onPreview, onChange }; }, [onPreview, onChange]);

  // A colour changed elsewhere (another device, the vault) moves the mark, unless it is this picker's own.
  useEffect(() => {
    if (dragging.current || shown === own.current) return;
    const p = pickOf(shown, pickRef.current.h);
    if (p) { pickRef.current = p; setPick(p); }
    setCode(shown);
  }, [shown]);
  useEffect(() => { if (canvasRef.current) drawField(canvasRef.current, pick.l); }, [pick.l]);

  const flush = useCallback((): void => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (pending.current === undefined) return;
    const c = pending.current;
    pending.current = undefined;
    handlers.current.onChange(c);
  }, []);
  // A choice still waiting is made when the picker closes.
  useEffect(() => () => { cancelAnimationFrame(frame.current); flush(); }, [flush]);

  /** Shows `c` everywhere at once and hands it on: now, after the last step, or (mid-drag) when the pointer lets go. */
  const emit = (c: string | null, settle: 'now' | 'later' | 'drag'): void => {
    own.current = c ?? auto;
    handlers.current.onPreview?.(c);
    pending.current = c;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (settle === 'now') flush();
    else if (settle === 'later') timer.current = setTimeout(flush, SETTLE_MS);
  };
  const place = (p: Pick, settle: 'now' | 'later' | 'drag'): void => {
    pickRef.current = p;
    setPick(p);
    const hex = pickHex(p.h, p.rel, p.l);
    setCode(hex);
    emit(hex, settle);
  };
  const choose = (c: string | null): void => {
    const p = pickOf(c ?? auto, pickRef.current.h);
    if (p) { pickRef.current = p; setPick(p); }
    setCode(c ?? auto);
    emit(c, 'now');
  };

  const at = (e: PointerEvent<HTMLElement>): Pick => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height)));
    return { h: x * 360, rel: 1 - y, l: pickRef.current.l };
  };
  const down = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    dragging.current = true;
    place(at(e), 'drag');
  };
  const move = (e: PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    queued.current = at(e);
    // One recolour per frame however fast the pointer reports.
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; if (queued.current && dragging.current) place(queued.current, 'drag'); });
  };
  /** Letting go chooses where the pointer is; a cancelled touch keeps the last place drawn. */
  const up = (e: PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    dragging.current = false;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    queued.current = null;
    place(e.type === 'pointercancel' ? pickRef.current : at(e), 'now');
  };
  const key = (e: KeyboardEvent<HTMLDivElement>): void => {
    const p = pickRef.current;
    const dh = e.shiftKey ? 15 : 3;
    const dr = e.shiftKey ? 0.15 : 0.04;
    const next = e.key === 'ArrowLeft' ? { ...p, h: (p.h - dh + 360) % 360 } : e.key === 'ArrowRight' ? { ...p, h: (p.h + dh) % 360 }
      : e.key === 'ArrowUp' ? { ...p, rel: Math.min(1, p.rel + dr) } : e.key === 'ArrowDown' ? { ...p, rel: Math.max(0, p.rel - dr) } : null;
    if (!next) return;
    e.preventDefault();
    place(next, 'later');
  };
  /** A typed code the night map can show is kept exactly (a brand colour stays itself); a too dark or too light one is brought into range. */
  const typed = (): void => {
    const raw = code.trim().toLowerCase().replace(/^#?/, '#');
    const hex = /^#[0-9a-f]{3}$/.test(raw) ? `#${[...raw.slice(1)].map((ch) => ch + ch).join('')}` : raw;
    const o = hexToOklch(hex);
    const p = o ? pickOf(hex, pickRef.current.h) : null;
    if (!o || !p) { setCode(shown); return; }
    const out = o.l >= TONE_L[0] && o.l <= TONE_L[1] ? hex : pickHex(p.h, p.rel, p.l);
    setCode(out);
    if (out === shown) return;
    pickRef.current = p;
    setPick(p);
    emit(out, 'now');
  };

  const track = useMemo(() => {
    const stops = [0, 0.5, 1].map((k) => pickHex(pick.h, pick.rel, TONE_L[0] + k * (TONE_L[1] - TONE_L[0])));
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, [pick.h, pick.rel]);
  const current = pickHex(pick.h, pick.rel, pick.l);

  return (
    // The field and the slider run left to right in both languages, like the spectrum itself.
    <div className="space-y-3" dir="ltr">
      <div className="color-field" role="slider" tabIndex={0} aria-label={t('color.field')} aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(pick.h)} aria-valuetext={current}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
        <canvas ref={canvasRef} width={FIELD_W} height={FIELD_H} />
        <span className="color-mark" style={{ left: `${(pick.h / 360) * 100}%`, top: `${(1 - pick.rel) * 100}%`, background: current }} />
      </div>
      <input type="range" className="color-range" min={TONE_L[0]} max={TONE_L[1]} step={0.005} value={pick.l} aria-label={t('color.brightness')}
        style={{ '--track': track } as CSSProperties} onChange={(e) => place({ ...pickRef.current, l: Number(e.target.value) }, 'later')} onPointerUp={flush} />
      <div className="color-swatches">
        <button type="button" onClick={() => choose(null)} className={`swatch small ${value === null ? 'is-on' : ''}`} style={{ background: `conic-gradient(from 0deg, ${auto}, #333 60%, ${auto})` }}
          title={t('category.autoColor')} aria-label={t('category.autoColor')} aria-pressed={value === null}>{value === null && <Check size={12} />}</button>
        {SWATCHES.map((s) => (
          <button key={s} type="button" onClick={() => choose(s)} className={`swatch small ${value === s ? 'is-on' : ''}`} style={{ background: s }} aria-label={s} aria-pressed={value === s}>{value === s && <Check size={12} />}</button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="color-dot" style={{ background: current }} />
        <input className="field color-code" dir="ltr" value={code} spellCheck={false} maxLength={7} aria-label={t('color.code')}
          onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') typed(); }} onBlur={typed} />
        {value === null && <span className="text-[11.5px] text-muted">{t('category.autoColor')}</span>}
      </div>
      {hint && <p className="text-[11px] leading-relaxed text-muted" dir="auto">{hint}</p>}
    </div>
  );
}

/** Picking a category's or a map's colour: drawn on the map at once (`store.colorDraft`), written to the vault when chosen. */
export function useColorEdit(id: string): { preview: (c: string | null) => void; choose: (c: string | null) => void } {
  const setColorDraft = useStore((s) => s.setColorDraft);
  const setToast = useStore((s) => s.setToast);
  return useMemo(() => ({
    preview: (color) => setColorDraft({ id, color }),
    choose: (color) => {
      const g = useStore.getState().graph;
      const holder = g?.categories.find((c) => c.id === id) ?? g?.maps.find((m) => m.id === id);
      if (holder && holder.color === color) { setColorDraft(null); return; }
      setColorDraft({ id, color, saved: true });
      api.updateNode(id, { frontmatter: { color } }).catch((e: unknown) => { setColorDraft(null); setToast((e as Error).message); });
    },
  }), [id, setColorDraft, setToast]);
}

/** A category's or a map's colour button (`children`) and its picker; the map recolours while the owner drags. */
export function ColorPopover({ id, value, hint, align = 'end', children }: { id: string; value: string | null; hint?: string; align?: 'start' | 'center' | 'end'; children: ReactNode }) {
  const t = useT();
  const palette = usePalette();
  const edit = useColorEdit(id);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover w-72" sideOffset={8} align={align} collisionPadding={12}>
          <div className="label">{t('category.color')}</div>
          <ColorPicker value={value} auto={palette.auto(id)} onPreview={edit.preview} onChange={edit.choose} hint={hint} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
