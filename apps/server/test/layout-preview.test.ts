import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createVault } from '@synapse/vault-template';
import { buildApp } from '../src/app';
import type { Ctx } from '../src/context';
import { isPrivateAddress, LinkPreviewer, parseMeta } from '../src/link-preview';

let root = '';
let app: FastifyInstance;
let ctx: Ctx;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-layout-'));
  await createVault(root);
  ({ app, ctx } = await buildApp({ host: null, port: 0, vaultPath: root, webDist: path.join(root, 'no-dist') }));
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await ctx.vault.stop();
  await fs.rm(root, { recursive: true, force: true });
});

/** A save based on the layout as it stands (the web app always names its base; docs/ARCHITECTURE.md "Layout"). */
async function putNow(payload: Record<string, unknown>): Promise<{ statusCode: number; json: () => unknown }> {
  const rev = ((await app.inject({ method: 'GET', url: '/api/layout' })).json() as { rev: number }).rev;
  return app.inject({ method: 'PUT', url: '/api/layout', payload: { ...payload, base: rev, client: 'test' } });
}

describe('saved layout', () => {
  it('stores anchors, pins and positions, rounded and validated, and resets', async () => {
    const put = await putNow({ anchors: { cat1: [10.123, -5.56] }, positions: { n1: [1, 2, 3], bad: [1] } });
    expect(put.statusCode).toBe(400); // a one-number point is refused by the schema
    const ok = await putNow({ anchors: { cat1: [10.123, -5.56] }, positions: { n1: [1, 2, 3] } });
    expect(ok.statusCode).toBe(200);
    const got = (await app.inject({ method: 'GET', url: '/api/layout' })).json() as { anchors: Record<string, number[]>; positions: Record<string, number[]> };
    expect(got.anchors['cat1']).toEqual([10.1, -5.6, 0]);
    expect(got.positions['n1']).toEqual([1, 2, 3]);
    const file = JSON.parse(await fs.readFile(path.join(root, '.synapse', 'layout.json'), 'utf8')) as { anchors: Record<string, number[]> };
    expect(file.anchors['cat1']).toEqual([10.1, -5.6, 0]);
    await app.inject({ method: 'DELETE', url: '/api/layout' });
    expect(((await app.inject({ method: 'GET', url: '/api/layout' })).json() as { anchors: object }).anchors).toEqual({});
  });

  it('keeps the room the spread tool gave crowded items, capped and rounded, and forgets it on reset', async () => {
    const ok = await putNow({ room: { n1: 2.346, n2: 9, n3: 1, n4: 0.5, n5: 0.1 } });
    expect(ok.statusCode).toBe(200);
    const got = (await app.inject({ method: 'GET', url: '/api/layout' })).json() as { room: Record<string, number> };
    // Spread up to 4, gathered down to 0.4; 1 is the laid-out spacing and is left out.
    expect(got.room).toEqual({ n1: 2.35, n2: 4, n4: 0.5, n5: 0.4 });
    // Saving positions alone keeps the room as it was.
    await putNow({ positions: { n1: [1, 2, 0] } });
    expect(((await app.inject({ method: 'GET', url: '/api/layout' })).json() as { room: Record<string, number> }).room).toEqual({ n1: 2.35, n2: 4, n4: 0.5, n5: 0.4 });
    await app.inject({ method: 'DELETE', url: '/api/layout' });
    expect(((await app.inject({ method: 'GET', url: '/api/layout' })).json() as { room: object }).room).toEqual({});
  });

  it('remembers whether the map was still moving when it was saved', async () => {
    const settled = async (): Promise<unknown> => ((await app.inject({ method: 'GET', url: '/api/layout' })).json() as { settled: unknown }).settled;
    expect(await settled()).toBe(true);
    await putNow({ positions: { n1: [1, 2, 0] }, settled: false });
    expect(await settled()).toBe(false);
    // A save without the flag keeps it; a settled save clears it.
    await putNow({ room: { n1: 2 } });
    expect(await settled()).toBe(false);
    await putNow({ positions: { n1: [1, 2, 0] }, settled: true });
    expect(await settled()).toBe(true);
    expect((await putNow({ settled: 'no' })).statusCode).toBe(400);
  });
});

describe('layout saves from several open copies', () => {
  type Answer = { ok: boolean; stale?: boolean; rev: number };
  const rev = async (): Promise<number> => ((await app.inject({ method: 'GET', url: '/api/layout' })).json() as { rev: number }).rev;
  const put = async (payload: Record<string, unknown>): Promise<Answer> => {
    const res = await app.inject({ method: 'PUT', url: '/api/layout', payload });
    expect(res.statusCode).toBe(200);
    return res.json() as Answer;
  };
  const room = async (): Promise<Record<string, number>> => ((await app.inject({ method: 'GET', url: '/api/layout' })).json() as { room: Record<string, number> }).room;

  it('counts every save and refuses one based on an older layout, with a 200 the CDN passes on', async () => {
    const r0 = await rev();
    expect(await put({ positions: { n1: [1, 2, 0] }, base: r0, client: 'tab-a' })).toMatchObject({ ok: true, rev: r0 + 1 });
    expect(await put({ room: { n1: 2 }, base: r0 + 1, client: 'tab-a' })).toMatchObject({ ok: true, rev: r0 + 2 });
    // A second tab that loaded the map before the spread tries to save its older picture: refused, nothing written.
    expect(await put({ room: {}, positions: { n1: [9, 9, 0] }, base: r0, client: 'tab-b' })).toEqual({ ok: false, stale: true, rev: r0 + 2 });
    expect(await room()).toEqual({ n1: 2 });
    // Once it has taken the newer layout its save goes through.
    expect(await put({ room: { n1: 2, n2: 3 }, base: r0 + 2, client: 'tab-b' })).toMatchObject({ ok: true, rev: r0 + 3 });
    // A save that names no base comes from a copy older than the rule (an old tab still open): refused too.
    expect(await put({ positions: { n1: [5, 5, 0] } })).toEqual({ ok: false, stale: true, rev: r0 + 3 });
    expect(((await app.inject({ method: 'GET', url: '/api/layout' })).json() as { positions: Record<string, number[]> }).positions['n1']).toEqual([1, 2, 0]);
    expect((await app.inject({ method: 'PUT', url: '/api/layout', payload: { client: 'no spaces allowed' } })).statusCode).toBe(400);
  });

  it("lets a copy's own saves still on their way go through, but not past another copy's save", async () => {
    const r0 = await rev();
    expect(await put({ room: { n1: 2 }, base: r0, client: 'tab-a' })).toMatchObject({ ok: true, rev: r0 + 1 });
    // Sent before the answer to the first one came back: still based on r0, and only tab-a saved since.
    expect(await put({ room: { n1: 3 }, base: r0, client: 'tab-a' })).toMatchObject({ ok: true, rev: r0 + 2 });
    expect(await put({ room: { n1: 1.5 }, base: r0 + 2, client: 'tab-b' })).toMatchObject({ ok: true, rev: r0 + 3 });
    expect(await put({ room: { n1: 4 }, base: r0 + 1, client: 'tab-a' })).toMatchObject({ ok: false, stale: true, rev: r0 + 3 });
    expect(await room()).toEqual({ n1: 1.5 });
  });

  it('announces every written save to the other copies, never a refused one, and keeps counting after a reset', async () => {
    const r0 = await rev();
    const seq = ctx.bus.lastSeq;
    await put({ room: { n1: 2 }, base: r0, client: 'tab-a' });
    await put({ room: {}, base: r0, client: 'tab-b' });
    const del = (await app.inject({ method: 'DELETE', url: '/api/layout' })).json() as { rev: number };
    expect(del.rev).toBe(r0 + 2);
    const saved = (ctx.bus.since(seq) ?? []).filter((e) => e.type === 'layout.saved').map((e) => e.payload);
    expect(saved).toEqual([{ rev: r0 + 1, client: 'tab-a' }, { rev: r0 + 2, client: null }]);
    // The copy that still holds the map from before the reset cannot save it back.
    expect(await put({ room: { n1: 2 }, base: r0 + 1, client: 'tab-a' })).toMatchObject({ ok: false, stale: true });
    expect(await room()).toEqual({});
  });
});

describe('saving the layout at once from several places', () => {
  it('keeps every save and ends with the last one', async () => {
    const { LayoutStore } = await import('../src/layout-store');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-layout-race-'));
    const store = new LayoutStore(dir);
    const saves = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => store.put({ anchors: { a: [i, 0, 0] } })));
    expect(saves.every((r) => r.status === 'fulfilled')).toBe(true);
    const onDisk = JSON.parse(await fs.readFile(path.join(dir, '.synapse', 'layout.json'), 'utf8')) as { anchors: Record<string, number[]> };
    expect(onDisk.anchors['a']?.[0]).toBe(11);
    expect((await fs.readdir(path.join(dir, '.synapse'))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('kind fields through the node API', () => {
  it('writes allowed fields into the frontmatter and refuses others', async () => {
    const created = (await app.inject({ method: 'POST', url: '/api/nodes', payload: { type: 'habit', title: 'Stretch', facets: { cadence: 'daily', checkins: ['2026-10-30'] } } })).json() as { node: { fm: { id: string; extra: Record<string, unknown> } } };
    const id = created.node.fm.id;
    expect(created.node.fm.extra).toMatchObject({ cadence: 'daily', checkins: ['2026-10-30'] });
    const bad = await app.inject({ method: 'PUT', url: `/api/nodes/${id}`, payload: { frontmatter: { facets: { mood: 'great' } } } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'PUT', url: `/api/nodes/${id}`, payload: { frontmatter: { facets: { checkins: ['2026-10-30', '2026-10-31'], time: null } } } });
    expect(ok.statusCode).toBe(200);
    const file = await fs.readFile(path.join(root, ctx.vault.getNode(id)!.path), 'utf8');
    expect(file).toContain('cadence: daily');
    expect(file).toMatch(/checkins:\n\s+- "?2026-10-30"?\n\s+- "?2026-10-31"?/);
    const node = ctx.vault.graph!.nodes.find((n) => n.id === id)!;
    expect(node.facets['checkins']).toEqual(['2026-10-30', '2026-10-31']);
  });
});

describe('link previews', () => {
  it('refuses private and loopback addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.4', '172.20.0.1', '169.254.1.1', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.0.2']) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '151.101.1.1', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false);
  });

  it('reads Open Graph tags, resolving a relative image', () => {
    const html = '<html><head><title>Fallback</title><meta property="og:title" content="Thinking in React &amp; you"><meta property="og:image" content="/img/cover.png"><meta name="description" content="Plan your UI"></head></html>';
    expect(parseMeta(html, 'https://react.dev/learn/x')).toEqual({ title: 'Thinking in React & you', image: 'https://react.dev/img/cover.png', description: 'Plan your UI' });
  });

  it('caches previews and marks failures', async () => {
    let calls = 0;
    const previewer = new LinkPreviewer(root, async () => { calls++; return { text: '<meta property="og:title" content="Hello"><meta property="og:image" content="https://cdn.example/i.jpg">', finalUrl: 'https://example.com/a' }; });
    const first = await previewer.preview('https://example.com/a');
    expect(first).toMatchObject({ ok: true, title: 'Hello', image: 'https://cdn.example/i.jpg', platform: 'web', kind: 'article' });
    await previewer.preview('https://example.com/a');
    expect(calls).toBe(1);
    const failing = new LinkPreviewer(root, async () => { throw new Error('offline'); });
    expect(await failing.preview('https://www.instagram.com/reel/abc/')).toMatchObject({ ok: false, platform: 'instagram', kind: 'reel' });
  });
});
