import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createVault } from '@synapse/vault-template';
import { buildApp } from '../src/app';
import type { Ctx } from '../src/context';
import { allowedPath, MANIFEST } from '../src/backup';

interface Instance { root: string; app: FastifyInstance; ctx: Ctx }

async function instance(name: string, setup: (root: string) => Promise<void>): Promise<Instance> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `synapse-backup-${name}-`));
  await createVault(root);
  await setup(root);
  const { app, ctx } = await buildApp({ host: null, port: 0, vaultPath: root, webDist: path.join(root, 'no-dist') }, { serveWeb: false, automation: false });
  await app.ready();
  return { root, app, ctx };
}

const sessions = (title: string): string => JSON.stringify({ threads: [{ id: `t-${title}`, title, engineId: 'claude-cli', engineSessionId: 'session-on-that-machine', createdAt: '2026-11-01T10:00:00+03:30', updatedAt: '2026-11-01T10:05:00+03:30', messages: [{ id: 'm1', role: 'user', text: title, at: '2026-11-01T10:00:00+03:30' }] }] });

let source: Instance;
let target: Instance;
let zip: Buffer;

beforeAll(async () => {
  source = await instance('source', async (root) => {
    await fs.writeFile(path.join(root, '.synapse', 'sessions.json'), sessions('سلام از سرور'), 'utf8');
  });
  await source.ctx.vault.createNode({ type: 'area', title: 'سلامتی', summary: 'بدن و ذهن' });
  await source.ctx.vault.createNode({ type: 'task', title: 'Morning walk', summary: 'Thirty minutes', area: '[[سلامتی]]' });
  await fs.writeFile(path.join(source.root, 'memory', 'profile.md'), '# Profile\n\nThe owner, from the server.\n', 'utf8');
  await source.ctx.settings.update({ locale: 'en', graph: { showTags: true }, engines: { 'claude-cli': { model: 'opus', effort: 'max' } }, apiKeys: { openrouter: 'sk-or-source-secret-123456' } });
  await source.ctx.auth.create('owner', 'correct horse battery', 'test');
  const rev = (await source.app.inject({ method: 'GET', url: '/api/layout' })).json() as { rev: number };
  await source.app.inject({ method: 'PUT', url: '/api/layout', payload: { positions: { a: [1, 2, 0] }, room: { a: 2.5 }, settled: true, base: rev.rev, client: 'source' } });

  target = await instance('target', async (root) => {
    await fs.writeFile(path.join(root, '.synapse', 'sessions.json'), sessions('old chat here'), 'utf8');
  });
  await target.ctx.vault.createNode({ type: 'note', title: 'Only on the Mac', summary: 'Should be gone after the import' });
  await target.ctx.settings.update({ apiKeys: { anthropic: 'sk-ant-target-secret-654321' } });
  await target.ctx.auth.create('mac-owner', 'another long password', 'test');
  for (let i = 0; i < 3; i++) {
    const r = (await target.app.inject({ method: 'GET', url: '/api/layout' })).json() as { rev: number };
    await target.app.inject({ method: 'PUT', url: '/api/layout', payload: { positions: { b: [i, 0, 0] }, base: r.rev, client: 'mac' } });
  }
});

afterAll(async () => {
  for (const x of [source, target]) {
    await x.app.close();
    await x.ctx.vault.stop();
    await fs.rm(x.root, { recursive: true, force: true });
  }
});

describe('export', () => {
  it('is one zip with every item, memory, chat and the layout, and no secret', async () => {
    const res = await source.app.inject({ method: 'GET', url: '/api/export' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="synapse-\d{4}-\d{2}-\d{2}\.zip"$/);
    expect(res.headers['cache-control']).toBe('no-store');
    zip = res.rawPayload;
    const files = unzipSync(new Uint8Array(zip));
    const names = Object.keys(files);
    const manifest = JSON.parse(strFromU8(files[MANIFEST]!)) as { format: string; version: number; counts: { items: number; chats: number }; settings: Record<string, unknown> };
    expect(manifest).toMatchObject({ format: 'synapse-export', version: 1, counts: { items: 2, chats: 1 } });
    expect(manifest.settings).toMatchObject({ locale: 'en', engine: 'claude-cli', engines: { 'claude-cli': { model: 'opus', effort: 'max' } } });
    expect(JSON.stringify(manifest)).not.toContain('sk-or-source');
    // Items exactly as they are on disk.
    for (const node of source.ctx.vault.graph!.nodes) {
      const onDisk = await fs.readFile(path.join(source.root, node.path!));
      expect(Buffer.from(files[node.path!]!).equals(onDisk)).toBe(true);
    }
    expect(strFromU8(files['memory/profile.md']!)).toContain('from the server');
    expect(names).toEqual(expect.arrayContaining(['.synapse/sessions.json', '.synapse/layout.json']));
    for (const secret of ['.synapse/settings.json', '.synapse/auth.json', '.synapse/pairing.json', '.synapse/connections.json']) expect(names).not.toContain(secret);
    expect(names.some((n) => n.startsWith('index/') || n.startsWith('.git') || n === 'AGENTS.md' || n.startsWith('.claude/'))).toBe(false);
    expect(Buffer.from(zip).toString('latin1')).not.toContain('sk-or-source');
  });
});

describe('import', () => {
  it('says what a file holds without changing anything when asked to check', async () => {
    const res = await target.app.inject({ method: 'POST', url: '/api/import?check=1', headers: { 'content-type': 'application/zip' }, payload: zip });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, check: true, counts: { items: 2, chats: 1 } });
    expect(target.ctx.vault.graph!.nodes.map((n) => n.title)).toContain('Only on the Mac');
  });

  it('replaces everything with the file and keeps this machine\'s keys, account and a copy of what was here', async () => {
    const seq = target.ctx.bus.lastSeq;
    const revBefore = ((await target.app.inject({ method: 'GET', url: '/api/layout' })).json() as { rev: number }).rev;
    const res = await target.app.inject({ method: 'POST', url: '/api/import', headers: { 'content-type': 'application/zip' }, payload: zip });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; counts: { items: number; chats: number }; commit: string | null; safetyCopy: string };
    expect(body).toMatchObject({ ok: true, counts: { items: 2, chats: 1 } });
    // The items are the server's, byte for byte, and the Mac's own are gone.
    const titles = target.ctx.vault.graph!.nodes.map((n) => n.title).sort();
    expect(titles).toEqual(['Morning walk', 'سلامتی']);
    for (const node of source.ctx.vault.graph!.nodes) {
      expect((await fs.readFile(path.join(target.root, node.path!))).equals(await fs.readFile(path.join(source.root, node.path!)))).toBe(true);
    }
    expect(await fs.readFile(path.join(target.root, 'memory', 'profile.md'), 'utf8')).toContain('from the server');
    // The chats are the server's, without its engine session.
    const threads = (await target.app.inject({ method: 'GET', url: '/api/threads' })).json() as { threads: Array<{ id: string; title: string }> };
    expect(threads.threads.map((t) => t.title)).toEqual(['سلام از سرور']);
    const thread = (await target.app.inject({ method: 'GET', url: `/api/threads/${threads.threads[0]!.id}` })).json() as Record<string, unknown>;
    expect(thread['engineSessionId']).toBeUndefined();
    // The layout is the server's, its count goes on here, and the open copies hear of it.
    const layout = (await target.app.inject({ method: 'GET', url: '/api/layout' })).json() as { rev: number; room: Record<string, number>; positions: Record<string, number[]> };
    expect(layout.room).toEqual({ a: 2.5 });
    expect(Object.keys(layout.positions)).toEqual(['a']);
    expect(layout.rev).toBeGreaterThan(revBefore);
    const saved = (target.ctx.bus.since(seq) ?? []).filter((e) => e.type === 'layout.saved');
    expect(saved.at(-1)?.payload).toEqual({ rev: layout.rev, client: null });
    // Preferences come along; this machine's key and account stay.
    const settings = await target.ctx.settings.get();
    expect(settings).toMatchObject({ locale: 'en', graph: { showTags: true }, engines: { 'claude-cli': { model: 'opus', effort: 'max' } } });
    expect(settings.apiKeys).toEqual({ anthropic: 'sk-ant-target-secret-654321' });
    const login = await target.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'mac-owner', password: 'another long password' } });
    expect(login.statusCode).toBe(200);
    // What was here is kept: a zip in .synapse/backups and the vault's history.
    const safety = unzipSync(new Uint8Array(await fs.readFile(path.join(target.root, body.safetyCopy))));
    expect(Object.keys(safety).some((n) => n.includes('only-on-the-mac'))).toBe(true);
    expect(body.commit).toMatch(/^[0-9a-f]{40}$/);
    const history = (await target.app.inject({ method: 'GET', url: '/api/history' })).json() as { commits: Array<{ subject: string }> };
    expect(history.commits[0]?.subject).toMatch(/^import: 2 items, 1 chats/);
    expect(history.commits.some((c) => c.subject === 'manual: edits' || c.subject.startsWith('manual: create'))).toBe(true);
  });

  it('refuses what is not an export and never writes outside the vault', async () => {
    const post = (payload: Buffer | string, type = 'application/zip'): Promise<{ statusCode: number; body: string }> =>
      target.app.inject({ method: 'POST', url: '/api/import', headers: { 'content-type': type }, payload });
    expect((await post('not a zip at all')).statusCode).toBe(400);
    expect((await post(Buffer.from(zipSync({ 'nodes/x.md': strToU8('# x') })))).body).toContain('synapse-export.json is missing');
    const newer = zipSync({ [MANIFEST]: strToU8(JSON.stringify({ format: 'synapse-export', version: 99, exportedAt: '2030-01-01', counts: {}, settings: {} })) });
    expect((await post(Buffer.from(newer))).body).toContain('newer Synapse');
    const evil = zipSync({
      [MANIFEST]: strToU8(JSON.stringify({ format: 'synapse-export', version: 1, exportedAt: '2026-11-02T00:00:00+00:00', counts: {}, settings: {} })),
      '../escaped.md': strToU8('outside'),
      'nodes/../../escaped2.md': strToU8('outside'),
      '.synapse/auth.json': strToU8('{"users":[]}'),
      'nodes/notes/kept.md': strToU8('---\ntitle: Kept\nsummary: kept\ntype: note\n---\nbody\n'),
    });
    const res = await post(Buffer.from(evil));
    expect(res.statusCode).toBe(200);
    await expect(fs.access(path.join(path.dirname(target.root), 'escaped.md'))).rejects.toThrow();
    await expect(fs.access(path.join(target.root, '..', '..', 'escaped2.md'))).rejects.toThrow();
    // The account was not replaced by the file's.
    const login = await target.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'mac-owner', password: 'another long password' } });
    expect(login.statusCode).toBe(200);
    expect(target.ctx.vault.graph!.nodes.map((n) => n.title)).toEqual(['Kept']);
  });

  it('waits while the brain is at work', async () => {
    Object.defineProperty(target.ctx.runner, 'busy', { get: () => true, configurable: true });
    try {
      const res = await target.app.inject({ method: 'POST', url: '/api/import', headers: { 'content-type': 'application/zip' }, payload: zip });
      expect(res.statusCode).toBe(409);
    } finally {
      delete (target.ctx.runner as unknown as Record<string, unknown>)['busy'];
    }
  });

  it('knows which paths an export may hold', () => {
    for (const ok of ['nodes/tasks/a.md', 'nodes/x/y/z.md', 'memory/profile.md', '.synapse/sessions.json', '.synapse/layout.json']) expect(allowedPath(ok)).toBe(true);
    for (const bad of ['../a.md', 'nodes/../a', '/etc/passwd', 'nodes\\a.md', 'nodes', 'AGENTS.md', '.synapse/settings.json', '.synapse/auth.json', 'index/INDEX.md', '.git/config', 'nodes//a.md']) expect(allowedPath(bad)).toBe(false);
  });
});
