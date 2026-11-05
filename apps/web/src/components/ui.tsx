import { CheckCircle2, Circle } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { usePalette } from '../lib/categories';
import type { UiGraphNode } from '../lib/types';
import { useStore } from '../state/store';

/**
 * Small shared building blocks for the views (spec: docs/UI-DESIGN.md "Visual language"). User text always goes
 * through <bdi>, so an English title in the Persian UI (or the reverse) never flips the row it sits in.
 */

export function Card({ children, className = '', accent }: { children: ReactNode; className?: string; accent?: string }) {
  return (
    <section className={`card ${className}`} style={accent ? ({ '--accent-line': accent } as React.CSSProperties) : undefined}>
      {children}
    </section>
  );
}

export function CardTitle({ children, count, color }: { children: ReactNode; count?: string; color?: string }) {
  // A theme colour (`var(--color-…)`) already suits both themes; an item's or a place's own colour is darkened on light.
  const own = Boolean(color && !color.startsWith('var('));
  return (
    <h3 className={`card-title ${own ? 'is-tinted' : ''}`} style={own ? ({ '--title': color } as CSSProperties) : color ? { color } : undefined}>
      <span>{children}</span>
      {count !== undefined && <span className="card-count">{count}</span>}
    </h3>
  );
}

/** The category of a node as a small coloured chip; clicking it opens the category node. */
export function CategoryChip({ node, small = false }: { node: Pick<UiGraphNode, 'category'>; small?: boolean }) {
  const palette = usePalette();
  const select = useStore((s) => s.select);
  const cat = palette.category(node.category);
  if (!cat) return null;
  return (
    <button onClick={(e) => { e.stopPropagation(); select(cat.id); }} className={`cat-chip ${small ? 'small' : ''}`} style={{ '--chip': palette.group(cat.id) } as React.CSSProperties}>
      <span className="legend-dot" />
      <span className="truncate utext" dir="auto">{cat.title}</span>
    </button>
  );
}

/** A round check for tasks, ringed in the node's category colour. */
export function TaskCheck({ node, onToggle, label }: { node: UiGraphNode; onToggle: () => void; label: string }) {
  const palette = usePalette();
  const done = node.status === 'done';
  return (
    <button onClick={(e) => { e.stopPropagation(); onToggle(); }} className={`task-check ${done ? 'is-done' : ''}`} style={{ '--chip': palette.node(node) } as React.CSSProperties} title={label} aria-label={label}>
      {done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty-note">{children}</p>;
}
