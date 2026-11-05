import { BrainCircuit, ChevronDown } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useT } from '../i18n';
import { useStore } from '../state/store';
import { effortLabel, effortsOf, fitEffort } from '../lib/efforts';
import { engineShortName, healthOf } from './EnginePill';

/**
 * Which brain does the next thing (spec: docs/UI-DESIGN.md "Chat" → the brain picker): the engine among the ones
 * that can run now, then its model and effort. The choice is per device and applies to every run — chat, advice,
 * reviews, the insight; the defaults live in Settings.
 */
export function EnginePicker({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const engines = useStore((s) => s.engines);
  const choice = useStore((s) => s.choice);
  const setChoice = useStore((s) => s.setChoice);
  const setView = useStore((s) => s.setView);
  const selected = engines.find((e) => e.selected) ?? engines[0];
  const engine = engines.find((e) => e.id === choice.engine) ?? selected;
  if (!engine) return null;
  const usable = engines.filter((e) => healthOf(e) === 'ok' || e.id === engine.id);
  const health = healthOf(engine);
  const model = choice.model || engine.defaults.model;
  const efforts = effortsOf(engine, model);
  const effort = choice.effort || (efforts.includes(engine.defaults.effort) ? engine.defaults.effort : fitEffort(engine, model, engine.defaults.effort).effort ?? engine.defaults.effort);
  const modelLabel = engine.models.find((m) => m.id === model)?.label ?? model;
  const models = model && !engine.models.some((m) => m.id === model) ? [{ id: model, label: model }, ...engine.models] : engine.models;
  const pickEngine = (id: string): void => { setChoice({ engine: id === selected?.id ? '' : id, model: '', effort: '' }); };
  const dot = health === 'ok' ? 'bg-ok' : health === 'warn' ? 'bg-warn' : health === 'bad' ? 'bg-danger' : 'bg-muted';
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="model-pill" title={t('chat.settings')}>
          <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
          {!compact && <span className="truncate" dir="ltr">{engineShortName(engine.name)}</span>}
          {!compact && <span className="opacity-40">·</span>}
          <span className="truncate" dir="ltr">{modelLabel || '—'}</span>
          {effort && <><span className="opacity-40">·</span><span className="opacity-60">{effortLabel(effort, t)}</span></>}
          <ChevronDown size={13} className="shrink-0 opacity-60" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover w-80" sideOffset={8} align="end" collisionPadding={12}>
          <div className="space-y-2.5 text-xs">
            <label className="block">
              <span className="mb-1 flex items-center gap-1.5 text-muted"><BrainCircuit size={13} />{t('brain.engine')}</span>
              <select value={engine.id} onChange={(e) => pickEngine(e.target.value)} className="field w-full" dir="ltr">
                {usable.map((e) => <option key={e.id} value={e.id}>{engineShortName(e.name)}{e.id === selected?.id ? ` (${t('brain.defaultEngine')})` : ''}{healthOf(e) === 'ok' ? '' : ` — ${t('brain.notReady')}`}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-muted">{t('chat.model')}</span>
              <select value={model} onChange={(e) => setChoice({ model: e.target.value, ...fitEffort(engine, e.target.value, effort) })} className="field w-full" dir="ltr">
                {models.map((m) => <option key={m.id} value={m.id}>{m.label || m.id}</option>)}
              </select>
            </label>
            {efforts.length > 0 && (
              <label className="block">
                <span className="mb-1 block text-muted">{t('chat.effort')}</span>
                <select value={effort} onChange={(e) => setChoice({ effort: e.target.value })} className="field w-full">
                  {efforts.map((e) => <option key={e} value={e}>{effortLabel(e, t)}</option>)}
                </select>
              </label>
            )}
            {health !== 'ok' && <p className="text-[11px] leading-relaxed text-warn">{engine.probe.fix ?? t('brain.notReady')}</p>}
            <p className="text-[11px] leading-relaxed text-muted">{t('brain.pickHint')} <button onClick={() => setView('settings')} className="text-accent hover:underline">{t('nav.settings')}</button></p>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
