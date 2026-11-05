import type { MapInfo } from '@synapse/core';
import { ChevronRight, ChevronLeft, Loader2, Plus, Sparkles } from 'lucide-react';
import { useT } from '../../i18n';
import { api } from '../../lib/api';
import { startRun } from '../../lib/brain';
import { fmtNum } from '../../lib/format';
import { connectionPatches, MIND, useMaps } from '../../lib/maps';
import { useStore } from '../../state/store';
import { ZoneGlyph } from '../ZoneGlyph';
import { Toggle } from './GraphToolbar';

/**
 * The maps on the canvas (spec: docs/UI-DESIGN.md "Maps"): the mind map, the character map the brain builds, and the
 * custom ones — each shown or hidden, each connected to the others or not — plus the way to a new map.
 */
export function MapsPanel() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const graph = useStore((s) => s.graph);
  const hidden = useStore((s) => s.filters.hiddenMaps);
  const toggleMap = useStore((s) => s.toggleMap);
  const openDialog = useStore((s) => s.openDialog);
  const select = useStore((s) => s.select);
  const setToast = useStore((s) => s.setToast);
  const run = useStore((s) => s.run);
  const { maps, character, color } = useMaps();
  const building = run !== null && run.mode === 'character' && (run.status === 'running' || run.status === 'queued');
  const mindCount = (graph?.nodes ?? []).filter((n) => !n.map && n.type !== 'map' && n.type !== 'area' && !n.ghost).length;
  const Chevron = locale === 'fa' ? ChevronLeft : ChevronRight;

  const build = async (): Promise<void> => {
    const r = await startRun({ prompt: '/character', mode: 'character', display: t('maps.buildCharacter'), newThread: true });
    if (r) setToast(t('maps.building'));
  };

  return (
    <div>
      <div className="text-xs font-semibold text-text">{t('maps.title')}</div>
      <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{t('maps.hint')}</p>
      <div className="mt-3 space-y-2">
        <div className="maps-row">
          <span className="legend-dot" style={{ '--chip': '#8f9fff' } as React.CSSProperties} />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-text">{t('maps.mind')}</span>
          <span className="text-[10.5px] text-muted">{t('item.count').replace('{n}', fmtNum(mindCount, locale))}</span>
        </div>
        {maps.map((m) => (
          <MapRow key={m.id} map={m} color={color(m.id)} shown={!hidden.has(m.id)} onShow={() => toggleMap(m.id)} onOpen={() => select(m.id)} Chevron={Chevron}
            action={m.role === 'character' ? (
              <button onClick={() => void build()} disabled={building} className="btn-soft h-7 px-2 text-[11px]">
                {building ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}{t('maps.rebuild')}
              </button>
            ) : null} />
        ))}
        {!character && (
          <div className="maps-row is-missing">
            <span className="legend-dot" style={{ '--chip': color('') } as React.CSSProperties} />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] text-text">{t('maps.character')}</div>
              <div className="text-[11px] leading-relaxed text-muted">{t('maps.characterMissing')}</div>
            </div>
            <button onClick={() => void build()} disabled={building} className="btn-primary h-8 px-2.5 text-[11.5px]">
              {building ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}{building ? t('maps.building') : t('maps.build')}
            </button>
          </div>
        )}
      </div>
      <button onClick={() => openDialog({ kind: 'map' })} className="btn-soft mt-3 w-full justify-center"><Plus size={14} />{t('maps.new')}</button>
    </div>
  );
}

function MapRow({ map, color, shown, onShow, onOpen, action, Chevron }: { map: MapInfo; color: string; shown: boolean; onShow: () => void; onOpen: () => void; action: React.ReactNode; Chevron: typeof ChevronRight }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  return (
    <div className="maps-row is-map" style={{ '--chip': color } as React.CSSProperties}>
      <div className="flex items-center gap-2">
        <ZoneGlyph symbol={map.symbol} size={15} color={color} />
        <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-1 text-start text-[12.5px] text-text hover:text-accent" title={t('maps.open')}>
          <span className="truncate utext" dir="auto">{map.title}</span>
          <Chevron size={12} className="shrink-0 opacity-60" />
        </button>
        <span className="text-[10.5px] text-muted">{t('item.count').replace('{n}', fmtNum(Math.max(0, map.size - map.areas), locale))}</span>
        <Toggle label="" value={shown} onChange={onShow} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[10.5px] text-muted">{t('maps.connections')}</span>
        <MapConnections map={map} />
        {action}
      </div>
    </div>
  );
}

/** Chips for what a map is connected to — the mind map and every other map — each a toggle written to the vault. */
export function MapConnections({ map }: { map: MapInfo }) {
  const t = useT();
  const setToast = useStore((s) => s.setToast);
  const { maps, connected, paused } = useMaps();
  const targets: Array<{ id: string; title: string }> = [{ id: MIND, title: t('maps.mind') }, ...maps.filter((m) => m.id !== map.id).map((m) => ({ id: m.id, title: m.title }))];
  const toggle = async (id: string): Promise<void> => {
    try {
      for (const p of connectionPatches(maps, map, id, !connected(map.id, id))) await api.updateNode(p.id, { frontmatter: p.frontmatter });
    } catch (e) { setToast((e as Error).message); }
  };
  return (
    <>
      {targets.map((x) => {
        const on = connected(map.id, x.id);
        // Kept while one of the two islands is switched off: it comes back with the switch (or with a press here).
        const waits = !on && paused(map.id, x.id);
        return (
          <button key={x.id} onClick={() => void toggle(x.id)} className={`chip-toggle h-6 px-2 py-0 text-[11px] ${on ? 'is-on' : waits ? 'is-paused' : ''}`} title={on ? t('maps.disconnect') : waits ? t('maps.paused') : t('maps.connect')} aria-pressed={on}>
            <span className="truncate utext" dir="auto">{x.title}</span>
          </button>
        );
      })}
    </>
  );
}
