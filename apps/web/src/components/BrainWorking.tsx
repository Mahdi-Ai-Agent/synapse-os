import type { CSSProperties } from 'react';
import { ZONE_GLYPHS } from '../graph/zoneGlyphs';

/** The brain at work, in the chat and the map's tell bar: its mark breathing while a signal runs out along a synapse and back (UI-DESIGN "Chat"). */
export function BrainWorking({ size = 15 }: { size?: number }) {
  return (
    <span className="brain-working" style={{ '--s': `${size}px` } as CSSProperties} aria-hidden>
      <svg className="brain-working-mark" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: ZONE_GLYPHS['brain'] ?? '' }} />
      <span className="brain-working-wire"><span className="brain-working-pulse" /></span>
    </span>
  );
}
