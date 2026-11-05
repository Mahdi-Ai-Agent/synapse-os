import { describe, expect, it } from 'vitest';
import { clampRect, moveRect, PANEL_MIN, rectOf, resizeRect } from '../src/lib/floating';

describe('floating', () => {
  const W = 1200; const H = 800;
  const r = { x: 400, y: 300, w: 480, h: 360 };

  it('moves with the pointer and stays whole on the map', () => {
    expect(moveRect(r, 50, -40, W, H)).toEqual({ x: 450, y: 260, w: 480, h: 360 });
    expect(moveRect(r, 5000, 5000, W, H)).toEqual({ x: W - 480 - 8, y: H - 360 - 8, w: 480, h: 360 });
    expect(moveRect(r, -5000, -5000, W, H)).toEqual({ x: 8, y: 8, w: 480, h: 360 });
  });

  it('resizes from the bottom-right, or the bottom-left in Persian with its right edge kept', () => {
    expect(resizeRect(r, 60, 40, false, W, H)).toEqual({ x: 400, y: 300, w: 540, h: 400 });
    expect(resizeRect(r, -60, 40, true, W, H)).toEqual({ x: 340, y: 300, w: 540, h: 400 });
    const small = resizeRect(r, 2000, -2000, true, W, H);
    expect(small.w).toBe(PANEL_MIN.w);
    expect(small.h).toBe(PANEL_MIN.h);
    expect(small.x + small.w).toBe(r.x + r.w);
    // Pulled past the map's edge: as big as fits, the other edge still where it was.
    const wide = resizeRect(r, -5000, 5000, true, W, H);
    expect(wide).toEqual({ x: 8, y: 300, w: r.x + r.w - 8, h: H - 8 - 300 });
    expect(resizeRect(r, 5000, 0, false, W, H).w).toBe(W - 8 - r.x);
  });

  it('never grows past the map and reads back only real rects', () => {
    expect(clampRect({ x: 0, y: 0, w: 5000, h: 5000 }, W, H)).toEqual({ x: 8, y: 8, w: W - 16, h: H - 16 });
    expect(rectOf({ x: 1, y: 2, w: 300, h: 200 })).toEqual({ x: 1, y: 2, w: 300, h: 200 });
    expect(rectOf({ x: 1, y: 2, w: 300 })).toBeNull();
    expect(rectOf(null)).toBeNull();
  });
});
