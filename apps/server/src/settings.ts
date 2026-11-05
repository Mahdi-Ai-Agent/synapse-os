import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, type EngineDefaults, type VaultSettings } from '@synapse/vault-template';

/** Settings as served to clients: stored API keys replaced by masked previews. */
export type PublicSettings = Omit<VaultSettings, 'apiKeys'> & { apiKeys: Record<string, string> };

/** Patch accepted by `update`: a `null` or empty key removes it. */
export type SettingsPatch = Partial<Omit<VaultSettings, 'graph' | 'engines' | 'apiKeys' | 'server' | 'automation'>> & {
  graph?: Partial<VaultSettings['graph']>;
  engines?: Record<string, EngineDefaults>;
  apiKeys?: Record<string, string | null>;
  server?: Partial<VaultSettings['server']>;
  automation?: Partial<VaultSettings['automation']>;
};

/** `medium` when the engine offers it, else its first level; '' when it has none. */
export function pickDefaultEffort(efforts: string[]): string {
  return efforts.includes('medium') ? 'medium' : efforts[0] ?? '';
}

export function maskSecret(key: string): string {
  return key.length <= 8 ? '••••' : `${key.slice(0, 7)}…${key.slice(-4)}`;
}

export class SettingsStore {
  private cache: VaultSettings | null = null;
  constructor(private readonly root: string) {}

  private get file(): string {
    return path.join(this.root, '.synapse', 'settings.json');
  }

  async get(): Promise<VaultSettings> {
    if (this.cache) return this.cache;
    let stored: Partial<VaultSettings> = {};
    try { stored = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<VaultSettings>; } catch { /* defaults */ }
    const engines: Record<string, EngineDefaults> = { ...DEFAULT_SETTINGS.engines, ...(stored.engines ?? {}) };
    const engine = stored.engine ?? DEFAULT_SETTINGS.engine;
    // Files written before per-engine defaults existed carry only the top-level model/effort of the selected engine.
    if (!stored.engines && (stored.model || stored.effort)) engines[engine] = { ...(engines[engine] ?? {}), ...(stored.model ? { model: stored.model } : {}), ...(stored.effort ? { effort: stored.effort } : {}) };
    this.cache = {
      ...DEFAULT_SETTINGS,
      ...stored,
      engine,
      graph: { ...DEFAULT_SETTINGS.graph, ...(stored.graph ?? {}) },
      engines,
      apiKeys: { ...(stored.apiKeys ?? {}) },
      server: { ...DEFAULT_SETTINGS.server, ...(stored.server ?? {}) },
      automation: { ...DEFAULT_SETTINGS.automation, ...(stored.automation ?? {}) },
    };
    return this.cache;
  }

  async update(patch: SettingsPatch): Promise<VaultSettings> {
    const current = await this.get();
    const engines: Record<string, EngineDefaults> = { ...current.engines };
    for (const [id, d] of Object.entries(patch.engines ?? {})) engines[id] = { ...(engines[id] ?? {}), ...d };
    const apiKeys: Record<string, string> = { ...current.apiKeys };
    for (const [provider, key] of Object.entries(patch.apiKeys ?? {})) {
      if (key === null || key.trim() === '') delete apiKeys[provider];
      else apiKeys[provider] = key.trim();
    }
    const { graph: _g, engines: _e, apiKeys: _k, server: _s, automation: _a, ...scalars } = patch;
    const next: VaultSettings = {
      ...current, ...scalars, graph: { ...current.graph, ...(patch.graph ?? {}) }, engines, apiKeys,
      server: { ...current.server, ...(patch.server ?? {}) }, automation: { ...current.automation, ...(patch.automation ?? {}) },
    };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    await fs.chmod(this.file, 0o600).catch(() => undefined); // keys live here; the file is also gitignored in the vault
    this.cache = next;
    return next;
  }

  /** Never hands stored keys to clients. */
  async public(): Promise<PublicSettings> {
    const s = await this.get();
    return { ...s, apiKeys: Object.fromEntries(Object.entries(s.apiKeys).map(([p, k]) => [p, maskSecret(k)])) };
  }

  /** Key lookup for the API engines (settings win over the environment; see BRAIN-ENGINES.md). */
  async keyFor(provider: string): Promise<string | undefined> {
    return (await this.get()).apiKeys[provider];
  }

  defaultsFor(settings: VaultSettings, engineId: string): EngineDefaults {
    return settings.engines[engineId] ?? {};
  }
}
