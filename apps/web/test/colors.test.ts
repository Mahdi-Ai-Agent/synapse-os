import { describe, expect, it } from 'vitest';
import { autoTone, categoryHue, familyBaseRgb, familyRgb, hexToOklch, oklchToRgb, pickHex, pickOf, rgbToHex, TONE_L, toneOfHex, type Rgb } from '../src/graph/colors';

const KINDS = ['area', 'project', 'task', 'idea', 'note', 'resource', 'person', 'goal', 'habit', 'event'];
const near = (a: Rgb, b: Rgb, tol: number): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tol);
const chroma = (rgb: Rgb): number => hexToOklch(rgbToHex(rgb))!.c;

describe('graph/colors', () => {
  it('round-trips sRGB through OKLCH', () => {
    for (const hex of ['#22d3ee', '#fbbf24', '#7c9cff', '#ffffff', '#101418']) {
      const o = hexToOklch(hex);
      expect(o).not.toBeNull();
      expect(rgbToHex(oklchToRgb(o!.l, o!.c, o!.h))).toBe(hex);
    }
  });

  it('keeps every family colour inside the sRGB gamut, own colours included', () => {
    const tones = [...Array.from({ length: 24 }, (_, i) => autoTone(i * 15)), ...['#ff0000', '#00ff00', '#0000ff', '#000000', '#ffffff', '#e07a5f'].map((h) => toneOfHex(h)!)];
    for (const t of tones) for (const type of KINDS) for (const closed of [false, true]) {
      expect(familyRgb(t, type, closed).every((v) => v >= 0 && v <= 1)).toBe(true);
    }
  });

  it('spreads category hues by the golden angle', () => {
    const hues = [0, 1, 2, 3, 4].map((i) => categoryHue(i));
    for (let i = 0; i < hues.length; i++) for (let j = i + 1; j < hues.length; j++) {
      const d = Math.abs(hues[i]! - hues[j]!);
      expect(Math.min(d, 360 - d)).toBeGreaterThan(35);
    }
  });

  it('draws a quick-pick colour like the automatic family of its hue', () => {
    // Categories coloured from the swatches before own colours carried their vividness keep their look.
    for (const h of [205, 250, 290, 330, 10, 40, 75, 110, 145, 175, 225, 350]) {
      const own = toneOfHex(rgbToHex(oklchToRgb(0.8, 0.15, h)))!;
      for (const type of KINDS) expect(near(familyRgb(own, type), familyRgb(autoTone(h), type), 3 / 255)).toBe(true);
    }
  });

  it('carries an own colour through every shade: its hue, its vividness, its lightness', () => {
    const own = toneOfHex('#e07a5f')!;
    expect(rgbToHex(familyBaseRgb(own))).toBe('#e07a5f');
    expect(Math.abs(hexToOklch(rgbToHex(familyRgb(own, 'project')))!.h - own.h)).toBeLessThan(12);
    expect(chroma(familyRgb(toneOfHex('#ff2d55')!, 'project'))).toBeGreaterThan(chroma(familyRgb(toneOfHex('#f4c6cf')!, 'project')) * 2);
    const grey = familyRgb(toneOfHex('#8a8a8a')!, 'project');
    expect(Math.max(...grey) - Math.min(...grey)).toBeLessThan(0.02);
    const light = toneOfHex('#d6e4ff')!;
    const deep = toneOfHex('#3b5bdb')!;
    expect(hexToOklch(rgbToHex(familyRgb(light, 'task')))!.l).toBeGreaterThan(hexToOklch(rgbToHex(familyRgb(deep, 'task')))!.l);
  });

  it('holds a picked lightness to what the night map can show', () => {
    expect(toneOfHex('#000000')!.l).toBe(TONE_L[0]);
    expect(toneOfHex('#ffffff')!.l).toBe(TONE_L[1]);
    expect(pickOf('#050505')!.l).toBe(TONE_L[0]);
  });

  it('round-trips a place in the colour picker', () => {
    for (const [h, rel, l] of [[30, 1, 0.7], [200, 0.6, 0.8], [300, 0.5, 0.9], [120, 0.8, 0.62]] as const) {
      const p = pickOf(pickHex(h, rel, l))!;
      expect(Math.abs(p.h - h)).toBeLessThan(3);
      expect(Math.abs(p.rel - rel)).toBeLessThan(0.04);
      expect(Math.abs(p.l - l)).toBeLessThan(0.01);
    }
    expect(pickOf('#808080', 123)!.h).toBe(123); // a grey keeps the hue the picker had
  });

  it('rejects malformed colours', () => {
    expect(hexToOklch('teal')).toBeNull();
    expect(hexToOklch('#12345')).toBeNull();
    expect(toneOfHex('teal')).toBeNull();
    expect(toneOfHex(null)).toBeNull();
    expect(pickOf('#12')).toBeNull();
  });
});
