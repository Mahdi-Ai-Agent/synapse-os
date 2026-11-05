import { BrainCircuit } from 'lucide-react';
import { useT } from '../i18n';
import type { EngineInfo } from '../lib/types';
import { useStore } from '../state/store';

/** Short engine name for labels: "Claude Code (your subscription)" → "Claude Code". */
export function engineShortName(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, '');
}

export type Health = 'ok' | 'warn' | 'bad' | 'checking';

/** Whether an engine can run now: signed in (CLI engines) or holding an accepted key (API engines). */
export function healthOf(engine: EngineInfo | undefined): Health {
  if (!engine) return 'checking';
  if (engine.auth === 'api-key') return !engine.key ? 'warn' : engine.probe.loggedIn ? 'ok' : 'bad';
  if (!engine.probe.installed) return 'bad';
  return engine.probe.loggedIn ? 'ok' : 'warn';
}

/** The selected brain engine's state in words, with a click through to Settings. */
export function EnginePill() {
  const t = useT();
  const engines = useStore((s) => s.engines);
  const setView = useStore((s) => s.setView);
  const engine = engines.find((e) => e.selected) ?? engines[0];
  const health = healthOf(engine);
  let label = t('engine.checking');
  if (engine) {
    const name = engineShortName(engine.name);
    if (health === 'ok') label = t('engine.ready');
    else if (engine.auth === 'api-key') label = `${name} · ${engine.key ? t('engine.keyRejected') : t('engine.noKey')}`;
    else label = `${name} · ${engine.probe.installed ? t('engine.notLoggedIn') : t('engine.notInstalled')}`;
  }
  const color = health === 'ok' ? 'text-ok' : health === 'warn' ? 'text-warn' : health === 'bad' ? 'text-danger' : 'text-muted';
  return (
    <button onClick={() => setView('settings')} className={`flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] ${color} hover:bg-panel2`} title={engine?.probe.fix ?? engine?.name ?? label}>
      <BrainCircuit size={13} />
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${health === 'ok' ? 'bg-ok' : health === 'warn' ? 'bg-warn' : health === 'bad' ? 'bg-danger' : 'bg-muted'}`} />
      <span dir="auto">{label}</span>
    </button>
  );
}

/** A small dot on the settings icon when the brain needs attention (not installed, not signed in, no key). */
export function EngineDot() {
  const engines = useStore((s) => s.engines);
  const health = healthOf(engines.find((e) => e.selected) ?? engines[0]);
  if (health === 'ok' || health === 'checking') return null;
  return <span className={`engine-dot ${health === 'bad' ? 'bg-danger' : 'bg-warn'}`} />;
}
