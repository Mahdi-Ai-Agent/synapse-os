import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createVault } from '@synapse/vault-template';
import { buildApp } from '../src/app';
import type { Ctx } from '../src/context';

let root = '';
let app: FastifyInstance;
let ctx: Ctx;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-threads-'));
  await createVault(root);
  const now = new Date().toISOString();
  const thread = (id: string, title: string) => ({ id, title, engineId: 'claude-cli', createdAt: now, updatedAt: now, messages: [{ id: `${id}-m`, role: 'user', text: title, at: now, mode: 'chat' }] });
  await fs.writeFile(path.join(root, '.synapse', 'sessions.json'), JSON.stringify({ threads: [thread('t1', 'سلام'), thread('t2', 'planning')] }));
  ({ app, ctx } = await buildApp({ host: null, port: 0, vaultPath: root, webDist: path.join(root, 'no-dist') }, { serveWeb: false, automation: false }));
});

afterAll(async () => {
  await app.close();
  // The vault's watcher may still write while the folder goes (ENOTEMPTY under load): stop it first.
  await ctx.vault.stop();
  await fs.rm(root, { recursive: true, force: true });
});

describe('chats: rename and delete', () => {
  it('renames a chat and keeps it renamed on disk', async () => {
    const r = await app.inject({ method: 'PATCH', url: '/api/threads/t1', payload: { title: '  گفتگوی   اول  ' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: 't1', title: 'گفتگوی اول' });
    const saved = JSON.parse(await fs.readFile(path.join(root, '.synapse', 'sessions.json'), 'utf8')) as { threads: Array<{ id: string; title: string }> };
    expect(saved.threads.find((t) => t.id === 't1')?.title).toBe('گفتگوی اول');
  });

  it('refuses an empty title and an unknown chat', async () => {
    expect((await app.inject({ method: 'PATCH', url: '/api/threads/t1', payload: { title: '   ' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/threads/nope', payload: { title: 'x' } })).statusCode).toBe(404);
  });

  it('deletes a chat', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/threads/t2' })).statusCode).toBe(200);
    const list = (await app.inject({ method: 'GET', url: '/api/threads' })).json() as { threads: Array<{ id: string }> };
    expect(list.threads.map((t) => t.id)).toEqual(['t1']);
    expect((await app.inject({ method: 'DELETE', url: '/api/threads/t2' })).statusCode).toBe(404);
  });
});
