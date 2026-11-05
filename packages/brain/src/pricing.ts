import type { TokenUsage } from './types';

/** List prices in USD per million tokens (Anthropic and OpenAI first-party rates as of 2026-10; estimates, not invoices). */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

const ANTHROPIC: Record<string, ModelPrice> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

const OPENAI: Record<string, ModelPrice> = {
  'gpt-6-astra': { input: 10, output: 50 },
  'gpt-6.1-sol': { input: 2, output: 10 },
  'gpt-6.1-terra': { input: 1, output: 5 },
  'gpt-6-luna': { input: 0.1, output: 0.5 },
  'gpt-5.5': { input: 5, output: 30, cacheRead: 0.5 },
  'gpt-5.4': { input: 2.5, output: 15, cacheRead: 0.25 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, output: 1.25, cacheRead: 0.02 },
};

const TABLES: Record<'anthropic' | 'openai', Record<string, ModelPrice>> = { anthropic: ANTHROPIC, openai: OPENAI };

/** Exact id first, then the longest table key the id starts with (dated snapshots, `-latest` aliases). */
export function priceOf(provider: 'anthropic' | 'openai', model: string): ModelPrice | undefined {
  const table = TABLES[provider];
  const exact = table[model];
  if (exact) return exact;
  let best: string | null = null;
  for (const key of Object.keys(table)) {
    if (model.startsWith(key) && (best === null || key.length > best.length)) best = key;
  }
  return best ? table[best] : undefined;
}

/** Cache reads default to 10 % and cache writes to 125 % of the input price when the table has no explicit rate. */
export function costFor(price: ModelPrice | undefined, t: TokenUsage): number | undefined {
  if (!price) return undefined;
  const cacheRead = price.cacheRead ?? price.input * 0.1;
  const cacheWrite = price.cacheWrite ?? price.input * 1.25;
  const usd = (t.input * price.input + t.output * price.output + (t.cacheRead ?? 0) * cacheRead + (t.cacheWrite ?? 0) * cacheWrite) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}
