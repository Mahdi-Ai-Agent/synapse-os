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
const ids: Record<string, string> = {};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-places-'));
  await createVault(root);
  ({ app, ctx } = await buildApp({ host: null, port: 0, vaultPath: root, webDist: path.join(root, 'no-dist') }));
  await app.ready();
  ids['area'] = (await ctx.vault.createNode({ type: 'area', title: 'Side business' })).fm.id;
  ids['map'] = (await ctx.vault.createNode({ type: 'map', title: 'پیج عکاسی' })).fm.id;
  ids['note'] = (await ctx.vault.createNode({ type: 'note', title: 'Pricing idea' })).fm.id;
});

afterAll(async () => {
  await app.close();
  await ctx.vault.stop();
  await fs.rm(root, { recursive: true, force: true });
});

const analysis = async (id: string) => app.inject({ method: 'GET', url: `/api/places/${encodeURIComponent(id)}/analysis` });

describe('place analysis route', () => {
  it('names the file a category or a map is analysed into, before anything is written', async () => {
    expect((await analysis(ids['area']!)).json()).toEqual({ path: 'memory/places/side-business.md', text: null });
    expect((await analysis(ids['map']!)).json()).toEqual({ path: 'memory/places/پیج-عکاسی.md', text: null });
  });

  it('refuses what is not a category or a map', async () => {
    expect((await analysis(ids['note']!)).statusCode).toBe(404);
    expect((await analysis('nothing-here')).statusCode).toBe(404);
  });

  it('serves the written analysis without the frontmatter a model may add', async () => {
    await fs.mkdir(path.join(root, 'memory', 'places'), { recursive: true });
    await fs.writeFile(path.join(root, 'memory', 'places', 'side-business.md'), '---\ntype: note\n---\n# Side business — analysis, 2026-11-02\n\n## In short\nMoving.\n', 'utf8');
    const got = (await analysis(ids['area']!)).json() as { path: string; text: string | null };
    expect(got.text).toBe('# Side business — analysis, 2026-11-02\n\n## In short\nMoving.');
    // A file that is only frontmatter counts as not written.
    await fs.writeFile(path.join(root, 'memory', 'places', 'پیج-عکاسی.md'), '---\ntype: note\n---\n', 'utf8');
    expect(((await analysis(ids['map']!)).json() as { text: string | null }).text).toBeNull();
  });
});

describe('focus memory route', () => {
  it('serves memory/focus.md once the full review wrote it', async () => {
    await fs.rm(path.join(root, 'memory', 'focus.md'), { force: true });
    expect((await app.inject({ method: 'GET', url: '/api/memory/focus' })).statusCode).toBe(404);
    await fs.writeFile(path.join(root, 'memory', 'focus.md'), '# Focus — 2026-11-02\n\n## Now\n1. [[Pricing idea]] — first\n', 'utf8');
    const res = await app.inject({ method: 'GET', url: '/api/memory/focus' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('## Now');
    expect((await app.inject({ method: 'GET', url: '/api/memory/secrets' })).statusCode).toBe(404);
  });
});

describe('drafts route', () => {
  it('keeps what was being typed per box, and forgets it once emptied', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/drafts' })).json()).toEqual({ drafts: {} });
    expect((await app.inject({ method: 'PUT', url: '/api/drafts/chat', payload: { text: 'نیمه‌کاره' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/drafts' })).json()).toEqual({ drafts: { chat: 'نیمه‌کاره' } });
    expect(JSON.parse(await fs.readFile(path.join(root, '.synapse', 'drafts.json'), 'utf8'))).toEqual({ chat: 'نیمه‌کاره' });
    await app.inject({ method: 'PUT', url: '/api/drafts/chat', payload: { text: '  ' } });
    expect((await app.inject({ method: 'GET', url: '/api/drafts' })).json()).toEqual({ drafts: {} });
    expect((await app.inject({ method: 'PUT', url: '/api/drafts/other', payload: { text: 'x' } })).statusCode).toBe(400);
  });
});
