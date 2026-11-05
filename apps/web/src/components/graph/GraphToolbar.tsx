import { Box, Captions, CaptionsOff, Clock, Expand, Layers, LayoutDashboard, Maximize2, Minus, Pause, Play, Plus, Shrink, SlidersHorizontal, Square, Type, X } from 'lucide-react';
import { useState } from 'react';
import { Popover } from 'radix-ui';
import { useT, type TKey } from '../../i18n';
import { api } from '../../lib/api';
import { fmtDate, fmtNum } from '../../lib/format';
import { MAP_NAMES, useStore } from '../../state/store';
import { TypeIcon } from '../TypeIcon';
import { IconButton } from './IconButton';
import { MapsPanel } from './MapsPanel';

const TYPES = ['area', 'goal', 'project', 'habit', 'task', 'idea', 'event', 'person', 'resource', 'note', 'journal', 'inbox', 'ghost'] as const;

/** The map's toolbar on the end edge, like a map's zoom buttons: framing, zoom, flat/3D, names, the spread tool, maps, filters, time-lapse, re-arrange. */
export function GraphToolbar({ onFit, onZoom, onRearrange, cutoffDate, compact }: { onFit: () => void; onZoom: (k: number) => void; onRearrange: () => void; cutoffDate: string | null; compact: boolean }) {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const mode3d = useStore((s) => s.mode3d);
  const setMode3d = useStore((s) => s.setMode3d);
  const mapNames = useStore((s) => s.mapNames);
  const setMapNames = useStore((s) => s.setMapNames);
  const spreadTool = useStore((s) => s.spreadTool);
  const setSpreadTool = useStore((s) => s.setSpreadTool);
  const filters = useStore((s) => s.filters);
  const timelapse = useStore((s) => s.timelapse);
  const setTimelapse = useStore((s) => s.setTimelapse);
  const dir = locale === 'fa' ? 'right' : 'left';
  const [confirming, setConfirming] = useState(false);
  // The archive corner shows by default; hiding it is a filter like the rest.
  const filtered = filters.hiddenTypes.size > 0 || !filters.showDone || !filters.showArchived || filters.orphansOnly || Boolean(filters.tag);
  // The names switch steps through every name → only regions' and islands' → none (UI-DESIGN "Map-style labels").
  const nextNames = MAP_NAMES[(MAP_NAMES.indexOf(mapNames) + 1) % MAP_NAMES.length]!;
  const namesLabel = t(mapNames === 'all' ? 'graph.hideNames' : mapNames === 'places' ? 'graph.hideAllNames' : 'graph.showAllNames');

  return (
    <div className={`graph-toolbar pointer-events-auto absolute end-4 flex flex-col gap-1.5 ${compact ? 'top-[112px]' : 'bottom-5'}`}>
      <IconButton label={t('graph.fit')} side={dir} onClick={onFit}><Maximize2 size={16} /></IconButton>
      {!compact && <IconButton label={t('graph.zoomIn')} side={dir} onClick={() => onZoom(0.75)}><Plus size={16} /></IconButton>}
      {!compact && <IconButton label={t('graph.zoomOut')} side={dir} onClick={() => onZoom(1.33)}><Minus size={16} /></IconButton>}
      <IconButton label={mode3d ? t('graph.view2d') : t('graph.view3d')} side={dir} active={mode3d} onClick={() => setMode3d(!mode3d)}>{mode3d ? <Square size={15} /> : <Box size={16} />}</IconButton>
      <IconButton label={namesLabel} side={dir} active={mapNames !== 'all'} aria-pressed={mapNames === 'all' ? false : mapNames === 'places' ? 'mixed' : true} onClick={() => setMapNames(nextNames)}>
        {mapNames === 'all' ? <Captions size={16} /> : mapNames === 'places' ? <Type size={16} /> : <CaptionsOff size={16} />}
      </IconButton>
      <IconButton label={spreadTool === 'spread' ? t('graph.spreadStop') : t('graph.spread')} side={dir} active={spreadTool === 'spread'} aria-pressed={spreadTool === 'spread'} onClick={() => setSpreadTool(spreadTool === 'spread' ? null : 'spread')}><Expand size={16} /></IconButton>
      <IconButton label={spreadTool === 'gather' ? t('graph.gatherStop') : t('graph.gather')} side={dir} active={spreadTool === 'gather'} aria-pressed={spreadTool === 'gather'} onClick={() => setSpreadTool(spreadTool === 'gather' ? null : 'gather')}><Shrink size={16} /></IconButton>
      <Popover.Root>
        <Popover.Trigger asChild>
          <IconButton label={t('maps.title')} side={dir} active={filters.hiddenMaps.size > 0}><Layers size={16} /></IconButton>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side={dir} align="end" sideOffset={10} collisionPadding={12} className="popover w-80">
            <MapsPanel />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Popover.Root>
        <Popover.Trigger asChild>
          <IconButton label={t('graph.filters')} side={dir} active={filtered}><SlidersHorizontal size={16} /></IconButton>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side={dir} align="end" sideOffset={10} collisionPadding={12} className="popover w-72">
            <FiltersPanel />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Popover.Root>
        <Popover.Trigger asChild>
          <IconButton label={t('graph.timelapse')} side={dir} active={timelapse.playing || timelapse.cutoff < 1}><Clock size={16} /></IconButton>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side={dir} align="end" sideOffset={10} collisionPadding={12} className="popover w-72">
            <div className="text-xs font-semibold text-text">{t('graph.timelapse')}</div>
            <p className="mt-1 text-xs text-muted">{t('graph.timelapseHint')}</p>
            <div className="mt-3 flex items-center gap-2">
              <button className="icon-btn small" aria-label={timelapse.playing ? t('graph.pause') : t('graph.play')}
                onClick={() => setTimelapse({ playing: !timelapse.playing, cutoff: timelapse.playing || timelapse.cutoff < 1 ? timelapse.cutoff : 0 })}>
                {timelapse.playing ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <input type="range" min={0} max={1} step={0.005} value={timelapse.cutoff} className="flex-1" onChange={(e) => setTimelapse({ cutoff: Number(e.target.value), playing: false })} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted">
              <span>{cutoffDate ? fmtDate(cutoffDate, locale, { dateStyle: 'medium' }) : t('graph.timelapseAll')}</span>
              {timelapse.cutoff < 1 && <button className="text-accent" onClick={() => setTimelapse({ cutoff: 1, playing: false })}>{t('graph.timelapseReset')}</button>}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Popover.Root open={confirming} onOpenChange={setConfirming}>
        <Popover.Trigger asChild>
          <IconButton label={t('graph.rearrange')} side={dir}><LayoutDashboard size={16} /></IconButton>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side={dir} align="end" sideOffset={10} collisionPadding={12} className="popover w-64">
            <p className="text-xs leading-relaxed text-text">{t('graph.rearrangeConfirm')}</p>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="btn-ghost h-8 text-xs">{t('common.cancel')}</button>
              <button onClick={() => { setConfirming(false); onRearrange(); }} className="btn-primary h-8 text-xs">{t('graph.rearrange')}</button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

function FiltersPanel() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const graph = useStore((s) => s.graph);
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const toggleType = useStore((s) => s.toggleType);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setToast = useStore((s) => s.setToast);
  const counts: Record<string, number> = { ...(graph?.stats.byType ?? {}), ghost: graph?.stats.unresolved ?? 0 };
  const showTags = settings?.graph.showTags ?? false;
  const setShowTags = async (v: boolean): Promise<void> => {
    if (!settings) return;
    setSettings({ ...settings, graph: { ...settings.graph, showTags: v } });
    try { setSettings(await api.putSettings({ graph: { ...settings.graph, showTags: v } })); } catch (e) { setToast((e as Error).message); }
  };
  return (
    <div>
      <div className="text-xs font-semibold text-text">{t('graph.types')}</div>
      <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{t('graph.shapesHint')}</p>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {TYPES.filter((ty) => (counts[ty] ?? 0) > 0).map((ty) => {
          const on = !filters.hiddenTypes.has(ty);
          return (
            <button key={ty} onClick={() => toggleType(ty)} className={`chip-toggle ${on ? 'is-on' : ''}`}>
              <TypeIcon type={ty} size={13} />
              <span className="truncate">{t(`type.${ty}` as TKey)}</span>
              <span className="ms-auto text-[10px] opacity-70">{fmtNum(counts[ty] ?? 0, locale)}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 space-y-2 border-t border-line pt-3 text-xs">
        <Toggle label={t('graph.showDone')} value={filters.showDone} onChange={(v) => setFilters({ showDone: v })} />
        <Toggle label={t('graph.showArchived')} value={filters.showArchived} onChange={(v) => setFilters({ showArchived: v })} />
        <Toggle label={t('graph.orphans')} value={filters.orphansOnly} onChange={(v) => setFilters({ orphansOnly: v })} />
        <Toggle label={t('graph.showTags')} value={showTags} onChange={(v) => void setShowTags(v)} />
      </div>
      {filters.tag && (
        <button onClick={() => setFilters({ tag: null })} className="mt-3 inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:text-text">
          #{filters.tag}<X size={11} />
        </button>
      )}
    </div>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-muted hover:text-text">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)} className={`switch ${value ? 'is-on' : ''}`}><span /></button>
    </label>
  );
}
