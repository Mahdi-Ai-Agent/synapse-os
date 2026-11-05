/**
 * A panel the user moves and resizes on the map (UI-DESIGN "Mind map" → Talking on the map): pure geometry in the
 * map's own pixels. The panel stays whole on the map, so its buttons (at its end side) can always be reached.
 */
export interface Rect { x: number; y: number; w: number; h: number }

export const PANEL_MIN = { w: 300, h: 200 };
/** The gap kept between the panel and the map's edges. */
const EDGE = 8;
const clamp = (v: number, lo: number, hi: number): number => Math.round(Math.min(Math.max(v, lo), Math.max(lo, hi)));

/** The panel within an area of `W` × `H`: at least its smallest size, at most the area, all of it on the map. */
export function clampRect(r: Rect, W: number, H: number): Rect {
  const w = clamp(r.w, PANEL_MIN.w, W - 2 * EDGE);
  const h = clamp(r.h, PANEL_MIN.h, H - 2 * EDGE);
  return { x: clamp(r.x, EDGE, W - w - EDGE), y: clamp(r.y, EDGE, H - h - EDGE), w, h };
}

/** Dragged by its header. */
export function moveRect(start: Rect, dx: number, dy: number, W: number, H: number): Rect {
  return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, W, H);
}

/**
 * Resized from its bottom corner on the end side: the bottom-right in a left-to-right page, the bottom-left in Persian,
 * where the right edge stays put while the left one follows the pointer.
 */
export function resizeRect(start: Rect, dx: number, dy: number, rtl: boolean, W: number, H: number): Rect {
  const h = clamp(start.h + dy, PANEL_MIN.h, H - EDGE - start.y);
  if (rtl) {
    const right = start.x + start.w;
    const w = clamp(start.w - dx, PANEL_MIN.w, right - EDGE);
    return { x: right - w, y: start.y, w, h };
  }
  return { x: start.x, y: start.y, w: clamp(start.w + dx, PANEL_MIN.w, W - EDGE - start.x), h };
}

/** A rect stored earlier, or null when there is none or it is not one. */
export function rectOf(v: unknown): Rect | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const n = (k: string): number | null => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : null);
  const x = n('x'); const y = n('y'); const w = n('w'); const h = n('h');
  return x === null || y === null || w === null || h === null ? null : { x, y, w, h };
}
