import path from 'node:path';
import { AsyncQueue } from '../async-queue';
import type { KeyCheck } from '../providers/anthropic';
import { runToolLoop, type ChatProvider } from '../tool-loop';
import type { BrainEngine, BrainEvent, BrainRunRequest, EngineProbe, KeyLookup, KeyProvider, ModelOption } from '../types';

/** What differs between the API-key engines; the loop, probing and key handling are shared here. */
export interface ApiEngineSpec {
  id: 'anthropic-api' | 'openai-api' | 'openrouter';
  name: string;
  keyEnv: string;
  keyProvider: KeyProvider;
  models: ModelOption[];
  efforts: string[];
  missingKeyFix: string;
  rejectedKeyFix: string;
  makeProvider(key: string): ChatProvider;
  verifyKey(key: string): Promise<KeyCheck>;
  listModels(key: string): Promise<ModelOption[]>;
}

const PROBE_TTL_MS = 10 * 60_000;

export function maskKey(key: string): string {
  return key.length <= 8 ? '••••' : `${key.slice(0, 7)}…${key.slice(-4)}`;
}

/** Static defaults first (in order), then every fetched model not already listed. */
export function mergeModels(defaults: ModelOption[], fetched: ModelOption[]): ModelOption[] {
  const seen = new Set(defaults.map((m) => m.id));
  return [...defaults, ...fetched.filter((m) => !seen.has(m.id))];
}

export class ApiEngine implements BrainEngine {
  readonly auth = 'api-key' as const;
  readonly id: ApiEngineSpec['id'];
  readonly name: string;
  readonly keyEnv: string;
  private probeCache: EngineProbe | null = null;
  private probedKey = '';
  private fetched: ModelOption[] | null = null;

  constructor(private readonly spec: ApiEngineSpec, private readonly lookup?: KeyLookup) {
    this.id = spec.id;
    this.name = spec.name;
    this.keyEnv = spec.keyEnv;
  }

  models(): ModelOption[] {
    return this.fetched ? mergeModels(this.spec.models, this.fetched) : this.spec.models;
  }

  efforts(): string[] {
    return this.spec.efforts;
  }

  /** Settings (pasted in the UI) win over the environment so a pasted key takes effect without a restart. */
  async resolveKey(): Promise<{ key: string; source: 'settings' | 'env' } | null> {
    const stored = (await this.lookup?.(this.spec.keyProvider))?.trim();
    if (stored) return { key: stored, source: 'settings' };
    const env = process.env[this.spec.keyEnv]?.trim();
    if (env) return { key: env, source: 'env' };
    return null;
  }

  async probe(force = false): Promise<EngineProbe> {
    const checkedAt = new Date().toISOString();
    const found = await this.resolveKey();
    if (!found) {
      this.probeCache = null;
      return { installed: true, loggedIn: false, fix: this.spec.missingKeyFix, detail: `no key (${this.spec.keyEnv} or Settings)`, checkedAt };
    }
    if (!force && this.probeCache && this.probedKey === found.key && Date.now() - Date.parse(this.probeCache.checkedAt) < PROBE_TTL_MS) return this.probeCache;
    const check = await this.spec.verifyKey(found.key);
    const probe: EngineProbe = { installed: true, loggedIn: check.ok, checkedAt, detail: `key from ${found.source} (${maskKey(found.key)})${check.detail ? ` · ${check.detail}` : ''}` };
    if (!check.ok) probe.fix = this.spec.rejectedKeyFix;
    this.probeCache = probe;
    this.probedKey = found.key;
    return probe;
  }

  async fetchModels(): Promise<ModelOption[]> {
    const found = await this.resolveKey();
    if (!found) throw new Error(this.spec.missingKeyFix);
    this.fetched = await this.spec.listModels(found.key);
    return this.models();
  }

  run(req: BrainRunRequest, signal?: AbortSignal): AsyncIterable<BrainEvent> {
    const queue = new AsyncQueue<BrainEvent>();
    void this.start(req, queue, signal);
    return queue;
  }

  private async start(req: BrainRunRequest, queue: AsyncQueue<BrainEvent>, signal?: AbortSignal): Promise<void> {
    const found = await this.resolveKey();
    if (!found) { queue.push({ type: 'error', message: this.spec.missingKeyFix }); queue.close(); return; }
    const model = req.model || this.spec.models[0]?.id || '';
    await runToolLoop(
      { provider: this.spec.makeProvider(found.key), request: req, model, sessionsDir: path.join(req.cwd, '.synapse', 'engine-sessions', this.id), ...(signal ? { signal } : {}) },
      queue,
    );
  }
}
