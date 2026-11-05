import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../../i18n';
import type { Rgb } from '../../graph/colors';
import { rgbCss } from '../../graph/model';
import { fmtNum, inputDir } from '../../lib/format';
import type { UiGraphNode } from '../../lib/types';
import { useStore } from '../../state/store';
import { TypeIcon } from '../TypeIcon';

/**
 * Search pill at the top of the graph: typing dims everything that does not match, the list under it jumps the
 * camera to a hit. `/` focuses it, arrows move through hits, Enter opens the highlighted one, Escape clears.
 */
export function GraphSearch({ nodes, groupColor, groupOf, onPick, compact }: { nodes: UiGraphNode[]; groupColor: Map<string, Rgb>; groupOf: Map<string, string>; onPick: (id: string) => void; compact: boolean }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const query = useStore((s) => s.filters.query);
  const setFilters = useStore((s) => s.setFilters);
  const graph = useStore((s) => s.graph);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const scored = nodes.filter((n) => n.type !== 'tag').map((n) => {
      const title = n.title.toLowerCase();
      const score = title === q ? 0 : title.startsWith(q) ? 1 : title.includes(q) ? 2 : n.tags.some((tg) => tg.includes(q)) ? 3 : n.summary.toLowerCase().includes(q) ? 4 : 9;
      return { n, score };
    }).filter((x) => x.score < 9).sort((a, b) => a.score - b.score || a.n.title.length - b.n.title.length);
    return scored.slice(0, 8).map((x) => x.n);
  }, [nodes, query]);
  const total = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? nodes.filter((n) => n.title.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q) || n.tags.some((tg) => tg.includes(q))).length : 0;
  }, [nodes, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); inputRef.current?.focus(); setOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => setCursor(0), [query]);

  const pick = (id: string): void => { onPick(id); setOpen(false); inputRef.current?.blur(); };
  const categoryTitle = (n: UiGraphNode): string | undefined => (n.category ? graph?.categories.find((c) => c.id === n.category)?.title : undefined);

  return (
    <div className={`graph-search pointer-events-auto absolute z-30 ${compact ? 'inset-x-3 top-3' : 'start-4 top-4 w-[388px]'}`}>
      <div className="search-pill">
        <Search size={16} className="shrink-0 text-muted" />
        <input
          ref={inputRef}
          value={query}
          dir={inputDir(query, locale)}
          onChange={(e) => { setFilters({ query: e.target.value }); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            else if (e.key === 'Enter' && hits[cursor]) { e.preventDefault(); pick(hits[cursor].id); }
            else if (e.key === 'Escape') { setFilters({ query: '' }); inputRef.current?.blur(); }
          }}
          placeholder={t('graph.search')}
          className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
        />
        {query ? (
          <button onClick={() => setFilters({ query: '' })} className="rounded-full p-1 text-muted hover:text-text" aria-label={t('common.close')}><X size={14} /></button>
        ) : (!compact && <kbd className="kbd">/</kbd>)}
      </div>
      {open && query.trim() && (
        <div className="glass-strong mt-2 overflow-hidden p-1">
          {hits.length === 0 && <div className="px-3 py-2 text-xs text-muted">{t('graph.noHits')}</div>}
          {hits.map((n, i) => {
            const g = groupOf.get(n.id);
            const c = g ? groupColor.get(g) : undefined;
            const cat = categoryTitle(n);
            return (
              <button key={n.id} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(n.id)} onMouseEnter={() => setCursor(i)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start ${i === cursor ? 'bg-panel2' : ''}`}>
                <TypeIcon type={n.ghost ? 'ghost' : n.type} size={14} color={c ? rgbCss(c) : undefined} />
                <span className="min-w-0 flex-1 truncate text-sm text-text utext" dir="auto">{n.title}</span>
                {cat && <span className="max-w-[40%] shrink-0 truncate text-[11px] text-muted utext" dir="auto">{cat}</span>}
              </button>
            );
          })}
          {total > hits.length && <div className="px-3 pb-1.5 pt-1 text-[11px] text-muted">{t('graph.moreHits').replace('{n}', fmtNum(total - hits.length, locale))}</div>}
        </div>
      )}
    </div>
  );
}
