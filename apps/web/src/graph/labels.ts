import { zoneGlyphSvg } from './zoneGlyphs';

/**
 * DOM label layer over the WebGL canvas, placed like a map's names (spec: docs/UI-DESIGN.md "Map-style labels"):
 * region names at overview, item names only once the camera is close enough for them to fit, never overlapping.
 * Candidates arrive sorted by priority; each is tried below its node, then above, and skipped when both collide.
 * Every label is keyed by its item, so it fades in and out instead of jumping between elements.
 */

export interface LabelCandidate {
  id: string;
  text: string;
  x: number;
  y: number;
  /** Node radius on screen, CSS px. */
  r: number;
  tier: 'hub' | 'major' | 'minor';
  color: string;
  /** Always shown (hovered, selected, focused, search hit) even when it overlaps. */
  forced: boolean;
  dim: boolean;
}

export interface RegionLabel {
  id: string;
  text: string;
  /** Small second line (how many items). */
  sub: string;
  x: number;
  /** Centre of the name on screen (the engine places it above or below its cluster). */
  y: number;
  color: string;
  /** 0..1, from the zoom level. */
  opacity: number;
  size: number;
  hot: boolean;
  /** A map's name under its centre node (UI-DESIGN "Maps"). */
  zone?: boolean;
}

/** A map's symbol drawn over its centre node, sized with it. */
export interface GlyphMark { id: string; x: number; y: number; r: number; symbol: string; color: string; opacity: number }
/** An island's switch: a small toggle beside the island (its centre at x, y), upright on its left or right side. */
export interface ToggleMark { id: string; x: number; y: number; vertical: boolean; on: boolean; color: string; title: string; opacity: number }
/** The toggle's size on screen (its long side lies along the island's edge). */
export const TOGGLE_SIZE = { w: 34, h: 20 } as const;

const FONT: Record<LabelCandidate['tier'], { size: number; weight: number }> = {
  hub: { size: 14.5, weight: 700 },
  major: { size: 12.5, weight: 600 },
  minor: { size: 11.5, weight: 500 },
};
const MAX_LABELS = 160;
const PAD = 5;
const FADE_MS = 240;
const TOP_CLEAR = 70;

interface Box { x0: number; y0: number; x1: number; y1: number }
interface Live { el: HTMLDivElement; shownAt: number; hiddenAt: number | null; text: string; cls: string }

interface RegionEl { el: HTMLDivElement; name: HTMLSpanElement; sub: HTMLSpanElement; box: Box | null }
interface GlyphEl { el: HTMLDivElement; symbol: string; size: number }

export class LabelLayer {
  readonly root: HTMLDivElement;
  private live = new Map<string, Live>();
  private free: HTMLDivElement[] = [];
  private regions = new Map<string, RegionEl>();
  private glyphs = new Map<string, GlyphEl>();
  private toggles = new Map<string, HTMLButtonElement>();
  private widths = new Map<string, number>();
  private ctx: CanvasRenderingContext2D | null;
  private family = 'Vazirmatn, system-ui, sans-serif';
  /** Labels shown in the last frame win ties against new ones, so panning does not make them flicker. */
  private shown = new Set<string>();
  private readonly opts: { onZoneToggle?: (map: string) => void };

  constructor(parent: HTMLElement, opts: { onZoneToggle?: (map: string) => void } = {}) {
    this.opts = opts;
    this.root = document.createElement('div');
    this.root.className = 'graph-labels';
    parent.appendChild(this.root);
    this.ctx = document.createElement('canvas').getContext('2d');
    this.readFont();
    void document.fonts?.ready.then(() => { this.readFont(); this.widths.clear(); });
    window.addEventListener('synapse:fonts', this.onFonts);
  }

  private onFonts = (): void => { this.readFont(); void document.fonts?.ready.then(() => this.widths.clear()); };

  /** The label font is the reading font (`--font-reading`, Settings → Appearance). */
  readFont(): void {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--font-reading').trim();
    if (v) this.family = v;
    this.widths.clear();
  }

  private width(text: string, tier: LabelCandidate['tier']): number {
    const key = `${tier}|${text}`;
    const cached = this.widths.get(key);
    if (cached !== undefined) return cached;
    const f = FONT[tier];
    let w = text.length * f.size * 0.55;
    if (this.ctx) { this.ctx.font = `${f.weight} ${f.size}px ${this.family}`; w = this.ctx.measureText(text).width; }
    this.widths.set(key, w);
    return w;
  }

  /** The region whose name is under a screen point, if any. */
  hitRegion(x: number, y: number): string | null {
    for (const [id, r] of this.regions) {
      const b = r.box;
      if (b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return id;
    }
    return null;
  }

  update(items: LabelCandidate[], regions: RegionLabel[], w: number, h: number): void {
    const now = performance.now();
    const placed: Box[] = [];
    const overlaps = (b: Box): boolean => placed.some((p) => b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0);

    // ---- region names (the "countries"): above their region, clear of the map chrome
    const seen = new Set<string>();
    for (const r of regions) {
      const entry = this.regionEl(r.id);
      if (r.opacity <= 0.02) { entry.el.style.display = 'none'; entry.box = null; seen.add(r.id); continue; }
      const nameW = r.text.length * r.size * 0.56 + 24;
      // A map's name hangs under its centre node; a region's name stays clear of the map chrome.
      const y = r.zone ? r.y : Math.min(h - 70, Math.max(84, r.y));
      const box: Box = r.zone
        ? { x0: r.x - nameW / 2, y0: y, x1: r.x + nameW / 2, y1: y + r.size * 1.4 }
        : { x0: r.x - nameW / 2, y0: y - r.size * 0.95, x1: r.x + nameW / 2, y1: y + r.size * 1.25 };
      seen.add(r.id);
      if (!r.zone && overlaps(box)) { entry.el.style.display = 'none'; entry.box = null; continue; }
      placed.push(box);
      entry.box = box;
      if (entry.name.textContent !== r.text) entry.name.textContent = r.text;
      if (entry.sub.textContent !== r.sub) entry.sub.textContent = r.sub;
      entry.el.style.transform = r.zone ? `translate3d(${Math.round(r.x)}px, ${Math.round(y)}px, 0) translate(-50%, 0)` : `translate3d(${Math.round(r.x)}px, ${Math.round(y)}px, 0) translate(-50%, -50%)`;
      entry.el.style.opacity = r.opacity.toFixed(3);
      entry.el.style.setProperty('--region', r.color);
      entry.el.style.fontSize = `${r.size.toFixed(1)}px`;
      entry.el.classList.toggle('is-hot', r.hot);
      entry.el.classList.toggle('is-zone', Boolean(r.zone));
      entry.el.style.display = '';
    }
    for (const [id, entry] of this.regions) {
      if (!seen.has(id)) { entry.el.remove(); this.regions.delete(id); }
    }

    // ---- item names: forced first, then what was shown last frame, then by rank
    const sorted = [...items].sort((a, b) => Number(b.forced) - Number(a.forced) || Number(this.shown.has(b.id)) - Number(this.shown.has(a.id)));
    const visible = new Set<string>();
    let count = 0;
    for (const c of sorted) {
      if (count >= MAX_LABELS) break;
      if (c.x < -80 || c.x > w + 80 || c.y < -30 || c.y > h + 30) continue;
      // The band under the search box and the chips stays clear unless the label is forced.
      if (!c.forced && c.y < TOP_CLEAR) continue;
      const f = FONT[c.tier];
      const tw = this.width(c.text, c.tier);
      const lh = f.size * 1.4;
      const below: Box = { x0: c.x - tw / 2 - PAD, y0: c.y + c.r + 3, x1: c.x + tw / 2 + PAD, y1: c.y + c.r + 3 + lh };
      let box: Box | null = below;
      if (overlaps(below)) {
        const above: Box = { x0: below.x0, y0: c.y - c.r - 3 - lh, x1: below.x1, y1: c.y - c.r - 3 };
        box = !overlaps(above) ? above : c.forced ? below : null;
      }
      if (!box) continue;
      placed.push(box);
      visible.add(c.id);
      count++;
      const cls = `graph-label tier-${c.tier}${c.dim ? ' dim' : ''}${c.forced ? ' forced' : ''}`;
      let lv = this.live.get(c.id);
      if (!lv) {
        const el = this.free.pop() ?? this.make();
        lv = { el, shownAt: now, hiddenAt: null, text: '', cls: '' };
        this.live.set(c.id, lv);
      }
      if (lv.hiddenAt !== null) { lv.hiddenAt = null; lv.shownAt = now; }
      if (lv.text !== c.text) { lv.el.textContent = c.text; lv.text = c.text; }
      // A new label starts transparent and gains `is-in` a frame later, so the opacity transition runs.
      const want = now - lv.shownAt > 16 ? `${cls} is-in` : cls;
      if (lv.cls !== want) { lv.el.className = want; lv.cls = want; }
      lv.el.style.transform = `translate3d(${Math.round(box.x0 + PAD)}px, ${Math.round(box.y0)}px, 0)`;
      lv.el.style.setProperty('--label-accent', c.color);
      lv.el.style.display = '';
    }
    for (const [id, lv] of this.live) {
      if (visible.has(id)) continue;
      if (lv.hiddenAt === null) {
        lv.hiddenAt = now;
        const cls = lv.cls.replace(' is-in', '');
        lv.el.className = cls; lv.cls = cls;
      } else if (now - lv.hiddenAt > FADE_MS) {
        lv.el.style.display = 'none';
        this.free.push(lv.el);
        this.live.delete(id);
      }
    }
    this.shown = visible;
  }

  private make(): HTMLDivElement {
    const el = document.createElement('div');
    el.dir = 'auto';
    this.root.appendChild(el);
    return el;
  }

  private regionEl(id: string): RegionEl {
    let entry = this.regions.get(id);
    if (!entry) {
      const el = document.createElement('div');
      el.className = 'graph-region-label';
      const name = document.createElement('span');
      name.className = 'region-name';
      name.dir = 'auto';
      const sub = document.createElement('span');
      sub.className = 'region-sub';
      el.append(name, sub);
      this.root.appendChild(el);
      entry = { el, name, sub, box: null };
      this.regions.set(id, entry);
    }
    return entry;
  }

  /** A map's symbol over its centre node, sized with the node; hidden while the node is too small to carry it. */
  updateGlyphs(marks: GlyphMark[]): void {
    const seen = new Set<string>();
    for (const m of marks) {
      seen.add(m.id);
      let g = this.glyphs.get(m.id);
      if (!g) {
        const el = document.createElement('div');
        el.className = 'hub-glyph';
        this.root.appendChild(el);
        g = { el, symbol: '', size: 0 };
        this.glyphs.set(m.id, g);
      }
      const size = Math.round(m.r * 1.15);
      if (size < 8) { g.el.style.display = 'none'; continue; }
      if (g.symbol !== m.symbol || g.size !== size) { g.el.innerHTML = zoneGlyphSvg(m.symbol, size); g.symbol = m.symbol; g.size = size; }
      g.el.style.transform = `translate3d(${Math.round(m.x - size / 2)}px, ${Math.round(m.y - size / 2)}px, 0)`;
      g.el.style.opacity = m.opacity.toFixed(2);
      g.el.style.color = m.color;
      g.el.style.display = '';
    }
    for (const [id, g] of this.glyphs) if (!seen.has(id)) { g.el.remove(); this.glyphs.delete(id); }
  }

  /**
   * Each island's switch: a small toggle in the map's colour set permanently beside the island on its open side, a
   * real button in the DOM so the canvas under it never sees the press (UI-DESIGN "Maps"). Lit while the map is
   * linked to the mind map; upright on the island's left or right, flat above or below it.
   */
  updateToggles(marks: ToggleMark[]): void {
    const seen = new Set<string>();
    for (const m of marks) {
      seen.add(m.id);
      let el = this.toggles.get(m.id);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'zone-toggle';
        el.dataset['zone'] = m.id;
        el.setAttribute('role', 'switch');
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        const id = m.id;
        el.addEventListener('click', (e) => { e.stopPropagation(); this.opts.onZoneToggle?.(id); });
        this.root.appendChild(el);
        this.toggles.set(m.id, el);
      }
      el.classList.toggle('is-on', m.on);
      el.setAttribute('aria-checked', String(m.on));
      if (el.title !== m.title) { el.title = m.title; el.setAttribute('aria-label', m.title); }
      el.style.transform = `translate3d(${Math.round(m.x - TOGGLE_SIZE.w / 2)}px, ${Math.round(m.y - TOGGLE_SIZE.h / 2)}px, 0)${m.vertical ? ' rotate(-90deg)' : ''}`;
      el.style.opacity = m.opacity.toFixed(2);
      el.style.setProperty('--region', m.color);
      el.style.display = '';
    }
    for (const [id, el] of this.toggles) if (!seen.has(id)) { el.remove(); this.toggles.delete(id); }
  }

  clear(): void {
    for (const lv of this.live.values()) { lv.el.style.display = 'none'; this.free.push(lv.el); }
    this.live.clear();
    for (const r of this.regions.values()) { r.el.style.display = 'none'; r.box = null; }
    for (const g of this.glyphs.values()) g.el.style.display = 'none';
    for (const el of this.toggles.values()) el.style.display = 'none';
    this.shown.clear();
  }

  dispose(): void { window.removeEventListener('synapse:fonts', this.onFonts); this.root.remove(); }
}
