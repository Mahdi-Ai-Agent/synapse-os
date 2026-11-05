import type { CategoryInfo } from '@synapse/core';
import { Plus } from 'lucide-react';
import { useT } from '../../i18n';
import type { GraphModel } from '../../graph/model';
import { rgbCss } from '../../graph/model';
import { fmtNum } from '../../lib/format';
import { useStore } from '../../state/store';

/**
 * Category chips beside the search box, like a map's place chips: one per region in its colour. A click opens the
 * category's card and flies the camera there; a second click closes it.
 */
export function CategoryLegend({ model, categories, active, onPick, compact }: { model: GraphModel; categories: CategoryInfo[]; active: string | null; onPick: (g: string | null) => void; compact: boolean }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const openDialog = useStore((s) => s.openDialog);
  const counts = new Map<string, number>();
  for (const n of model.nodes) if (!n.id.startsWith('tag:') && !n.hub) counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
  const order = new Map(categories.map((c) => [c.id, c.order]));
  // The maps' centres and the mind map's core are not places to open from here (the Maps panel and the map cards are).
  const groups = model.groups.filter((g) => g.kind !== 'map' && g.kind !== 'core').sort((a, b) => (a.kind === 'category' ? 0 : 1) - (b.kind === 'category' ? 0 : 1) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return (
    <div className={`graph-legend pointer-events-auto absolute ${compact ? 'inset-x-3 top-[64px]' : 'top-4 end-4 start-[416px]'}`}>
      <div className="legend-scroll flex max-w-full items-center gap-1.5 overflow-x-auto px-1 py-1">
        {groups.map((g) => {
          const on = active === g.id;
          const dim = active !== null && !on;
          return (
            <button key={g.id} onClick={() => onPick(on ? null : g.id)}
              className={`legend-chip ${on ? 'is-on' : ''} ${dim ? 'is-dim' : ''} ${g.kind !== 'category' ? 'is-special' : ''}`}
              style={{ '--chip': rgbCss(g.color) } as React.CSSProperties}>
              <span className="legend-dot" />
              <bdi className="max-w-[11rem] truncate">{g.title}</bdi>
              <span className="text-[10.5px] opacity-60">{fmtNum(counts.get(g.id) ?? 0, locale)}</span>
            </button>
          );
        })}
        <button onClick={() => openDialog({ kind: 'category' })} className="legend-chip is-add" aria-label={t('category.new')} title={t('category.new')}>
          <Plus size={13} />{!compact && <span>{t('category.new')}</span>}
        </button>
      </div>
    </div>
  );
}
