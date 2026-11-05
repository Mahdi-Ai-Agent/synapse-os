import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { seedSampleVault } from '@synapse/vault-template';
import { buildApp } from '../src/app';
import type { Ctx } from '../src/context';

let root = '';
let app: FastifyInstance;
let ctx: Ctx;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-reset-'));
  await seedSampleVault(root);
  ({ app, ctx } = await buildApp({ host: null, port: 0, vaultPath: root, webDist: path.join(root, 'no-dist') }));
  await fs.writeFile(path.join(root, '.synapse', 'sessions.json'), '{"threads":[]}');
});

afterAll(async () => {
  await app.close();
  // The vault's watcher may still write while the folder goes (ENOTEMPTY under load): stop it first.
  await ctx.vault.stop();
  await fs.rm(root, { recursive: true, force: true });
});

describe('erase everything', () => {
  it('refuses without the word', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/vault/reset', payload: { confirm: 'nope' } });
    expect(r.statusCode).toBe(400);
    expect(ctx.vault.nodeCount).toBeGreaterThan(0);
  });

  it('empties the vault, keeps the agent layer and the settings, restarts the history', async () => {
    expect(ctx.vault.nodeCount).toBeGreaterThan(0);
    const r = await app.inject({ method: 'POST', url: '/api/vault/reset', payload: { confirm: 'ERASE' } });
    expect(r.statusCode).toBe(200);
    expect(ctx.vault.exists).toBe(true);
    expect(ctx.vault.nodeCount).toBe(0);
    await expect(fs.access(path.join(root, 'AGENTS.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, 'memory', 'profile.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, '.synapse', 'settings.json'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, '.synapse', 'sessions.json'))).rejects.toThrow();
    const layout = await fs.readFile(path.join(root, '.synapse', 'layout.json'), 'utf8').catch(() => null);
    expect(layout === null || Object.keys((JSON.parse(layout) as { anchors: object }).anchors).length === 0).toBe(true);
    expect((await ctx.git.log()).length).toBe(1);
    const g = await app.inject({ method: 'GET', url: '/api/graph' });
    expect((g.json() as { nodes: unknown[] }).nodes.length).toBe(0);
  });
});
