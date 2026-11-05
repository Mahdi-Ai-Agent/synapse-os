import { ZONE_GLYPHS } from '../graph/zoneGlyphs';

/** The mark of a map (UI-DESIGN "Maps"): the same line icon the island's centre carries, for panels, rows and pickers. */
export function ZoneGlyph({ symbol, size = 16, className = '', color }: { symbol: string; size?: number; className?: string; color?: string }) {
  const inner = ZONE_GLYPHS[symbol] ?? ZONE_GLYPHS['star']!;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} style={color ? { color } : undefined} aria-hidden dangerouslySetInnerHTML={{ __html: inner }} />
  );
}
