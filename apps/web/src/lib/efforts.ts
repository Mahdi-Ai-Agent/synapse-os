import type { TKey } from '../i18n';
import type { EngineInfo } from './types';

/** The efforts the app has words for, in order (docs/BRAIN-ENGINES.md). */
const KNOWN = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

/** An effort in the UI language ("max" → «حداکثر»); one the app does not know stays as the vendor names it. */
export function effortLabel(effort: string, t: (k: TKey) => string): string {
  return KNOWN.includes(effort) ? t(`effort.${effort}` as TKey) : effort;
}

/** The efforts a model takes: its own list when the engine has one per model (Codex), else the engine's. */
export function effortsOf(engine: EngineInfo, modelId: string): string[] {
  return engine.models.find((m) => m.id === modelId)?.efforts ?? engine.efforts;
}

/**
 * When another model is picked: the effort stays if that model takes it, else becomes the model's own starting one,
 * else its first. `{}` means no change.
 */
export function fitEffort(engine: EngineInfo, modelId: string, effort: string): { effort?: string } {
  const m = engine.models.find((x) => x.id === modelId);
  const allowed = m?.efforts ?? engine.efforts;
  if (!allowed.length || allowed.includes(effort)) return {};
  const next = m?.defaultEffort && allowed.includes(m.defaultEffort) ? m.defaultEffort : allowed[0];
  return next ? { effort: next } : {};
}
