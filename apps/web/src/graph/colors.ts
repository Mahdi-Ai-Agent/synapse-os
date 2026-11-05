/**
 * Colour families in OKLCH (perceptually even lightness and chroma). Spec: docs/UI-DESIGN.md "Colour".
 * Each category and each map's island has one base colour, its tone: a hue from a golden-angle sequence by creation
 * order, or the owner's own `color` with its vividness and lightness. Every member is a shade of that tone chosen by
 * node type, so a region reads as one family and a picked colour carries through all of it.
 */

export type Rgb = [number, number, number];

/** A family's base colour in OKLCH: its signature (chips, its name on the map); every member's shade follows it. */
export interface Tone { l: number; c: number; h: number }

const GOLDEN_ANGLE = 137.508;
const FIRST_HUE = 205;
/** The automatic family's lightness and chroma: what the kinds' shades below are measured against. */
const BASE_L = 0.8;
const BASE_C = 0.15;
/** Lightness a picked colour is held to: lighter washes out under the bloom, darker sinks into the night map. */
export const TONE_L: readonly [number, number] = [0.6, 0.94];

/** Lightness, chroma and hue shift per node type inside an automatic family (dark background, bloom on top). */
const ROLE: Record<string, { l: number; c: number; dh: number }> = {
  area: { l: 0.8, c: 0.17, dh: 0 },
  project: { l: 0.78, c: 0.17, dh: -8 },
  task: { l: 0.83, c: 0.13, dh: 12 },
  idea: { l: 0.9, c: 0.12, dh: -22 },
  note: { l: 0.75, c: 0.11, dh: 20 },
  resource: { l: 0.72, c: 0.13, dh: 32 },
  person: { l: 0.82, c: 0.09, dh: -32 },
  goal: { l: 0.84, c: 0.16, dh: 4 },
  habit: { l: 0.8, c: 0.14, dh: -14 },
  event: { l: 0.86, c: 0.1, dh: 26 },
  ghost: { l: 0.58, c: 0.035, dh: 0 },
  tag: { l: 0.7, c: 0.03, dh: 0 },
};

/** Groups outside categories: their own neutral families; the archive is the dimmest, switched off. */
export const GROUP_HUE: Record<'inbox' | 'journal' | 'unsorted' | 'archive', { h: number; c: number; l: number }> = {
  inbox: { h: 95, c: 0.03, l: 0.93 },
  journal: { h: 70, c: 0.07, l: 0.82 },
  unsorted: { h: 250, c: 0.025, l: 0.72 },
  archive: { h: 255, c: 0.012, l: 0.56 },
};

const wrap = (h: number): number => ((h % 360) + 360) % 360;

function srgbFromLinear(x: number): number {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
}
function linearFromSrgb(x: number): number {
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

/** OKLCH → linear sRGB (may fall outside [0, 1] when out of gamut). */
function oklchToLinear(l: number, c: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const inGamut = (rgb: Rgb): boolean => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** The most chroma sRGB holds at this lightness and hue. */
export function maxChroma(l: number, h: number): number {
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear(l, mid, h))) lo = mid; else hi = mid;
  }
  return lo;
}

/** OKLCH → sRGB in [0, 1], reducing chroma until the colour fits the sRGB gamut. */
export function oklchToRgb(l: number, c: number, h: number): Rgb {
  let lo = 0;
  let hi = c;
  let rgb = oklchToLinear(l, c, h);
  if (!inGamut(rgb)) {
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(l, mid, h))) lo = mid; else hi = mid;
    }
    rgb = oklchToLinear(l, lo, h);
  }
  return rgb.map((v) => Math.min(1, Math.max(0, srgbFromLinear(Math.min(1, Math.max(0, v)))))) as Rgb;
}

/** sRGB hex (`#rgb` / `#rrggbb`) → OKLCH; null for anything else. */
export function hexToOklch(hex: string): { l: number; c: number; h: number } | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  const v = m[1].length === 3 ? m[1].split('').map((ch) => ch + ch).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => linearFromSrgb(parseInt(v.slice(i, i + 2), 16) / 255)) as Rgb;
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.sqrt(A * A + B * B), h: (h + 360) % 360 };
}

export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** The automatic hue of the category at `order`: adding a category never repaints the others. */
export function categoryHue(order: number): number {
  return wrap(FIRST_HUE + order * GOLDEN_ANGLE);
}

/** The automatic hue of a map's island (UI-DESIGN "Maps"): gold for the character map, a warm sequence for custom ones. */
export function zoneHue(order: number, role: 'character' | null): number {
  return role === 'character' ? 82 : wrap(20 + order * GOLDEN_ANGLE);
}

/** Hue of the mind map's core node: the interface accent. */
export const CORE_HUE = 272;

/** The signature chroma at the base lightness: a family's vividness is measured against it. */
function refChroma(h: number): number {
  return Math.min(BASE_C, maxChroma(BASE_L, h));
}

/** The automatic family of hue `h`. */
export function autoTone(h: number): Tone {
  return { l: BASE_L, c: refChroma(h), h: wrap(h) };
}

/** The family an own colour sets: its hue, its vividness and its lightness held to `TONE_L`. Null when it is not a hex colour. */
export function toneOfHex(hex: string | null | undefined): Tone | null {
  const o = hex ? hexToOklch(hex) : null;
  return o ? { l: Math.min(TONE_L[1], Math.max(TONE_L[0], o.l)), c: o.c, h: o.h } : null;
}

/** How a family differs from the automatic one: a lightness offset and a chroma scale, carried into every shade. */
function shift(t: Tone): { dl: number; kc: number } {
  return { dl: t.l - BASE_L, kc: Math.min(2.5, t.c / Math.max(1e-4, refChroma(t.h))) };
}

/** Colour of a node of `type` inside the family `t`; closed nodes lose chroma and light. */
export function familyRgb(t: Tone, type: string, closed = false): Rgb {
  const role = ROLE[type] ?? ROLE['note']!;
  const { dl, kc } = shift(t);
  const l = Math.min(0.97, Math.max(0.3, role.l + dl));
  return oklchToRgb(closed ? l * 0.72 : l, role.c * kc * (closed ? 0.35 : 1), wrap(t.h + role.dh));
}

/** The family's signature colour: what the legend chip, the category's name and an own colour's swatch show. */
export function familyBaseRgb(t: Tone): Rgb {
  return oklchToRgb(t.l, t.c, t.h);
}

/** The deeper colour of a family's nebula. */
export function familyGlowRgb(t: Tone): Rgb {
  const { dl, kc } = shift(t);
  return oklchToRgb(0.6 + dl, 0.17 * kc, t.h);
}

/** Colour of a map's haze and name, from its island's tone. */
export function zoneRgb(t: Tone): { color: Rgb; glow: Rgb } {
  const { dl, kc } = shift(t);
  return { color: oklchToRgb(Math.min(0.97, 0.86 + dl), 0.12 * kc, t.h), glow: oklchToRgb(0.7 + dl, 0.15 * kc, t.h) };
}

/** A place in the colour picker — hue, share of the most chroma sRGB holds there, lightness — as a hex colour. */
export function pickHex(h: number, rel: number, l: number): string {
  const hue = wrap(h);
  return rgbToHex(oklchToRgb(l, Math.max(0, Math.min(1, rel)) * maxChroma(l, hue), hue));
}

/** Where a colour sits in the colour picker, its lightness held to `TONE_L`; a grey keeps `hue`. Null when it is not a hex colour. */
export function pickOf(hex: string, hue = 0): { h: number; rel: number; l: number } | null {
  const o = hexToOklch(hex);
  if (!o) return null;
  const l = Math.min(TONE_L[1], Math.max(TONE_L[0], o.l));
  const h = o.c < 0.012 ? wrap(hue) : o.h;
  return { h, rel: Math.min(1, o.c / Math.max(1e-4, maxChroma(l, h))), l };
}

/** Colour of a node in a neutral group (inbox, journal, unsorted, the archive). */
export function groupRgb(group: keyof typeof GROUP_HUE, type: string, closed = false): Rgb {
  const g = GROUP_HUE[group];
  const role = ROLE[type] ?? ROLE['note']!;
  const l = Math.min(0.95, g.l * (role.l / 0.8)) * (closed ? 0.75 : 1);
  return oklchToRgb(l, g.c, g.h);
}

/**
 * The light theme's version of a map colour (UI-DESIGN "Light theme"): the same hue, darker and a little more vivid,
 * so a node or a name stands out on paper as the bright one does on the dark sky.
 */
export function forLight(rgb: Rgb): Rgb {
  const o = hexToOklch(rgbToHex(rgb));
  if (!o) return rgb;
  const l = Math.max(0.3, Math.min(0.64, 0.3 + (o.l - 0.3) * 0.5));
  return oklchToRgb(l, Math.min(o.c * 1.15, maxChroma(l, o.h)), o.h);
}
