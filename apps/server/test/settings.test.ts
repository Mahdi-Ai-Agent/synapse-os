import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SettingsStore, maskSecret } from '../src/settings';

let root = '';

beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-settings-')); });
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('SettingsStore', () => {
  it('seeds per-engine defaults from a legacy file and merges patches', async () => {
    await fs.mkdir(path.join(root, '.synapse'), { recursive: true });
    await fs.writeFile(path.join(root, '.synapse', 'settings.json'), JSON.stringify({ engine: 'claude-cli', model: 'opus', effort: 'high', locale: 'fa', graph: { showDone: false } }));
    const store = new SettingsStore(root);
    const s = await store.get();
    expect(s.engines).toEqual({ 'claude-cli': { model: 'opus', effort: 'high' } });
    expect(s.graph).toEqual({ showDone: false, showTags: false, mode: '2d' });
    expect(s.apiKeys).toEqual({});
    const next = await store.update({ engines: { 'codex-cli': { model: 'gpt-6.1-sol' } }, graph: { showTags: true } });
    expect(next.engines).toEqual({ 'claude-cli': { model: 'opus', effort: 'high' }, 'codex-cli': { model: 'gpt-6.1-sol' } });
    expect(next.graph).toEqual({ showDone: false, showTags: true, mode: '2d' });
    const again = await store.update({ engines: { 'codex-cli': { effort: 'high' } } });
    expect(again.engines['codex-cli']).toEqual({ model: 'gpt-6.1-sol', effort: 'high' });
  });

  it('stores keys privately, masks them for clients, removes them on null, and keeps the file owner-only', async () => {
    const store = new SettingsStore(root);
    await store.update({ apiKeys: { anthropic: ' sk-ant-api03-1234567890abcdef ', openai: 'short' } });
    expect(await store.keyFor('anthropic')).toBe('sk-ant-api03-1234567890abcdef');
    const pub = await store.public();
    expect(pub.apiKeys).toEqual({ anthropic: 'sk-ant-…cdef', openai: '••••' });
    expect(JSON.stringify(pub)).not.toContain('1234567890');
    const raw = JSON.parse(await fs.readFile(path.join(root, '.synapse', 'settings.json'), 'utf8')) as { apiKeys: Record<string, string> };
    expect(raw.apiKeys['anthropic']).toBe('sk-ant-api03-1234567890abcdef');
    const mode = (await fs.stat(path.join(root, '.synapse', 'settings.json'))).mode & 0o777;
    expect(mode).toBe(0o600);
    await store.update({ apiKeys: { openai: null, anthropic: '' } });
    expect((await store.get()).apiKeys).toEqual({});
    expect(await store.keyFor('anthropic')).toBeUndefined();
    expect(maskSecret('sk-or-v1-abcdefghijklmnop')).toBe('sk-or-v…mnop');
  });

  it('reloads from disk into a fresh store with the same shape', async () => {
    const fresh = new SettingsStore(root);
    const s = await fresh.get();
    expect(s.engine).toBe('claude-cli');
    expect(s.engines['codex-cli']).toEqual({ model: 'gpt-6.1-sol', effort: 'high' });
    expect(fresh.defaultsFor(s, 'openrouter')).toEqual({});
  });
});
