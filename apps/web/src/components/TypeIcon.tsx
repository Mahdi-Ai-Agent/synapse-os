import type { ReactNode } from 'react';

/**
 * The glyph of a kind (spec: docs/UI-DESIGN.md "Shapes"): the same silhouette the map draws for it (`graph/shaders.ts`
 * `shape()`), so a chip, a card, the legend and a dot on the map all say "goal" with the one target, "moment" with the
 * one triangle. Filled with `currentColor`; ring shapes are strokes.
 */
const GLYPHS: Record<string, ReactNode> = {
  note: <circle cx="12" cy="12" r="9" />,
  project: <polygon points="12,2.4 20.3,7.2 20.3,16.8 12,21.6 3.7,16.8 3.7,7.2" />,
  task: <rect x="4" y="4" width="16" height="16" rx="5" />,
  idea: <path d="M12 1.8 L14.5 9.5 L22.2 12 L14.5 14.5 L12 22.2 L9.5 14.5 L1.8 12 L9.5 9.5 Z" />,
  person: <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="4.4" />,
  resource: <rect x="6.2" y="3" width="11.6" height="18" rx="2.6" />,
  journal: <polygon points="12,2.2 21.8,12 12,21.8 2.2,12" />,
  area: (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="10.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="14 7.6" strokeLinecap="round" />
    </>
  ),
  inbox: (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="10.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3.5 3.6" />
    </>
  ),
  ghost: <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeDasharray="3.3 3.4" />,
  tag: <rect x="6" y="6" width="12" height="12" rx="3" />,
  goal: (
    <>
      <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" strokeWidth="3.2" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  habit: <polygon points="12,2.8 21.1,9.4 17.6,20.2 6.4,20.2 2.9,9.4" />,
  // A map: a centre like a category's, with a second orbit.
  map: (
    <>
      <circle cx="12" cy="12" r="5.2" />
      <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="11 6" strokeLinecap="round" />
      <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="7 9" strokeLinecap="round" />
    </>
  ),
  // The mind map's core: the same centre, filled.
  core: (
    <>
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="12 6.5" strokeLinecap="round" />
      <circle cx="12" cy="12" r="11.2" fill="none" stroke="currentColor" strokeWidth="1.1" strokeDasharray="8 9" strokeLinecap="round" />
    </>
  ),
  event: <path d="M12 3.4 L21.4 19.6 L2.6 19.6 Z" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />,
};

/** The icon of a kind: the shape its items have on the map. */
export function TypeIcon({ type, size = 14, className = '', color }: { type: string; size?: number; className?: string; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={`shrink-0 ${className}`} style={color ? { color } : undefined} aria-hidden>
      {GLYPHS[type] ?? GLYPHS['note']}
    </svg>
  );
}
