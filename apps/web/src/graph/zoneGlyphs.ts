/**
 * The marks at the centre of a map's island (UI-DESIGN "Maps"): minimal line icons, one per core `MAP_SYMBOLS`
 * value, as SVG inner markup on a 24×24 grid. Shared by the DOM label layer (`labels.ts`) and React (`ZoneGlyph`).
 */
export const ZONE_GLYPHS: Record<string, string> = {
  // The mind map's core wears the brain (not a map symbol; `MAP_SYMBOLS` never lists it).
  brain: '<path d="M12 4.5c-1.4-1.6-4.2-1-4.6 1.4-2.3.2-3.1 3.2-1.4 4.6-1.6 1.6-.6 4.4 1.6 4.6.2 2.3 3 3.2 4.4 1.4 1.4 1.8 4.2.9 4.4-1.4 2.2-.2 3.2-3 1.6-4.6 1.7-1.4.9-4.4-1.4-4.6-.4-2.4-3.2-3-4.6-1.4z"/><path d="M12 4.5v12M7.6 9.6c1.3-.2 2.3.5 2.6 1.5M16.4 9.6c-1.3-.2-2.3.5-2.6 1.5M9.2 14c.8-.5 1.7-.4 2.4.2M14.8 14c-.8-.5-1.7-.4-2.4.2"/>',
  person: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z"/>',
  briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2M3.5 12.5h17"/>',
  store: '<path d="M3.5 9.5 5 4.5h14l1.5 5M3.5 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0M5 12v7.5h14V12M10 19.5v-5h4v5"/>',
  camera: '<path d="M4 8.5h3.2l1.6-2.5h6.4l1.6 2.5H20a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18v-8A1.5 1.5 0 0 1 4 8.5z"/><circle cx="12" cy="13.5" r="3.2"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17"/>',
  book: '<path d="M4.5 5.5A2 2 0 0 1 6.5 3.5H19v15H6.5a2 2 0 0 0-2 2z"/><path d="M4.5 18.5a2 2 0 0 1 2-2H19"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4 4 0 0 1 12 7.6 4 4 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  music: '<path d="M9 18.5V6l10-2v12.5"/><circle cx="6.5" cy="18.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  code: '<path d="m8 8-4.5 4L8 16M16 8l4.5 4L16 16M13.5 5l-3 14"/>',
};

export const ZONE_SYMBOLS = Object.keys(ZONE_GLYPHS).filter((s) => s !== 'brain');

/** Full SVG markup of a glyph (stroke icons in `currentColor`). */
export function zoneGlyphSvg(symbol: string, size: number): string {
  const inner = ZONE_GLYPHS[symbol] ?? ZONE_GLYPHS['star']!;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
