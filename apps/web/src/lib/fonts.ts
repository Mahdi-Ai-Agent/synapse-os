import type { Locale } from './types';

/**
 * The three font roles (spec: docs/UI-DESIGN.md "Type"): the interface (IRANSans), headings and map names (Yekan
 * Bakh) and reading text — chat, notes, the map's item names (Vazirmatn). Yekan Bakh and IRANSans are commercial:
 * they are used only when installed on this computer (never bundled); the free Estedad and Vazirmatn ship with the
 * app and stand in otherwise. English puts Inter first for Latin text.
 */
export type FontRole = 'text' | 'display' | 'reading';
export interface FontOption { id: string; label: string; stack: string; commercial: boolean }

const IRANSANS: FontOption = { id: 'iransans', label: 'IRANSans', stack: '"IRANSansX", "IRANSans"', commercial: true };
const YEKAN: FontOption = { id: 'yekanbakh', label: 'Yekan Bakh', stack: '"Yekan Bakh", "YekanBakh"', commercial: true };
const VAZIR: FontOption = { id: 'vazirmatn', label: 'Vazirmatn', stack: '"Vazirmatn"', commercial: false };
const ESTEDAD: FontOption = { id: 'estedad', label: 'Estedad', stack: '"Estedad"', commercial: false };

export const FONT_OPTIONS: Record<FontRole, FontOption[]> = {
  text: [IRANSANS, VAZIR, ESTEDAD],
  display: [YEKAN, ESTEDAD, VAZIR],
  reading: [VAZIR, IRANSANS, ESTEDAD],
};
const DEFAULTS: Record<FontRole, string> = { text: 'iransans', display: 'yekanbakh', reading: 'vazirmatn' };
/** What stands in for each role when the chosen font is not installed. */
const FALLBACK: Record<FontRole, string> = { text: '"Vazirmatn"', display: '"Estedad", "Vazirmatn"', reading: '"Vazirmatn"' };
const CSS_VAR: Record<FontRole, string> = { text: '--font-sans', display: '--font-display', reading: '--font-reading' };
const KEY = 'synapse.fonts';

export type FontChoice = Record<FontRole, string>;

export function loadFontChoice(): FontChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<FontChoice>;
    const pick = (r: FontRole): string => (FONT_OPTIONS[r].some((o) => o.id === raw[r]) ? raw[r]! : DEFAULTS[r]);
    return { text: pick('text'), display: pick('display'), reading: pick('reading') };
  } catch { return { ...DEFAULTS }; }
}

/** Whether a font family is installed: text drawn in it differs in width from the same text in a fallback. */
export function isInstalled(option: FontOption): boolean {
  if (!option.commercial) return true;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return false;
  const sample = 'سیناپس ذهن تو Synapse 1234';
  ctx.font = '32px monospace';
  const base = ctx.measureText(sample).width;
  ctx.font = `32px ${option.stack}, monospace`;
  return Math.abs(ctx.measureText(sample).width - base) > 0.5;
}

export function applyFonts(choice: FontChoice, locale: Locale): void {
  const root = document.documentElement;
  for (const role of Object.keys(CSS_VAR) as FontRole[]) {
    const opt = FONT_OPTIONS[role].find((o) => o.id === choice[role]) ?? FONT_OPTIONS[role][0]!;
    const persian = `${opt.stack}, ${FALLBACK[role]}`;
    const stack = locale === 'en' ? `"Inter", ${persian}` : `${persian}, "Inter"`;
    root.style.setProperty(CSS_VAR[role], `${stack}, system-ui, -apple-system, sans-serif`);
  }
  window.dispatchEvent(new Event('synapse:fonts'));
}

export function saveFontChoice(choice: FontChoice, locale: Locale): void {
  try { localStorage.setItem(KEY, JSON.stringify(choice)); } catch { /* private mode: this session only */ }
  applyFonts(choice, locale);
}
