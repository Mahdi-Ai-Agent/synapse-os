import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createVault } from '@synapse/vault-template';
import { buildApp } from '../src/app';
import type { Ctx } from '../src/context';
import { Broadcaster } from '../src/ws';

let root = '';
let app: FastifyInstance;
let ctx: Ctx;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-live-'));
  await createVault(root);
  ({ app, ctx } = await buildApp({ host: null, port: 0, vaultPath: root, webDist: path.join(root, 'no-dist') }, { serveWeb: false, automation: false }));
});

afterAll(async () => {
  await app.close();
  // The vault's watcher may still write while the folder goes (ENOTEMPTY under load): stop it first.
  await ctx.vault.stop();
  await fs.rm(root, { recursive: true, force: true });
});

describe('the event log', () => {
  it('serves what came after a seq and says when that is gone', () => {
    const bus = new Broadcaster(3);
    bus.broadcast('a', 1); bus.broadcast('b', 2);
    expect(bus.since(0)?.map((e) => e.type)).toEqual(['a', 'b']);
    expect(bus.since(2)).toEqual([]);
    bus.broadcast('c', 3); bus.broadcast('d', 4);
    expect(bus.since(0)).toBeNull();
    expect(bus.since(1)?.map((e) => e.type)).toEqual(['b', 'c', 'd']);
    expect(bus.since(9)).toBeNull();
  });

  it('wakes a waiting poll on the next event', async () => {
    const bus = new Broadcaster();
    const t0 = Date.now();
    const waiting = bus.next(5000);
    setTimeout(() => bus.broadcast('x', null), 50);
    await waiting;
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('GET /api/events', () => {
  const events = async (qs: string) => (await app.inject({ method: 'GET', url: `/api/events?${qs}` })).json() as { epoch: string; seq: number; reset?: boolean; hello?: { queue: unknown }; events: Array<{ type: string; payload: unknown }> };

  it('starts a client off with hello, then hands it what happened since', async () => {
    const first = await events('wait=0');
    expect(first.hello).toBeDefined();
    expect(first.epoch).toBe(ctx.bus.epoch);
    ctx.bus.broadcast('graph.updated', { generatedAt: 'x' });
    const next = await events(`after=${first.seq}&epoch=${first.epoch}&wait=0`);
    expect(next.events.map((e) => e.type)).toEqual(['graph.updated']);
    expect(next.hello).toBeUndefined();
  });

  it('holds a poll over real HTTP until something happens, or until the wait is over', async () => {
    // A real socket: an injected request never shows that Node closes the request (not the response) once it is read.
    const base = await app.listen({ port: 0, host: '127.0.0.1' });
    const get = async (qs: string) => (await fetch(`${base}/api/events?${qs}`)).json() as Promise<{ epoch: string; seq: number; events: Array<{ type: string }> }>;
    const head = await get('wait=0');
    let t0 = Date.now();
    const idle = await get(`after=${head.seq}&epoch=${head.epoch}&wait=1`);
    expect(idle.events).toEqual([]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    t0 = Date.now();
    const pending = get(`after=${head.seq}&epoch=${head.epoch}&wait=5`);
    setTimeout(() => ctx.bus.broadcast('brain.queue', { running: null, queued: [] }), 300);
    const got = await pending;
    expect(got.events.map((e) => e.type)).toEqual(['brain.queue']);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('restarts a client whose seq belongs to another server run', async () => {
    const r = await events('after=5&epoch=feedfacefeed&wait=0');
    expect(r.reset).toBe(true);
    expect(r.hello).toBeDefined();
  });

  it('is behind sign-in like the WebSocket', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/events?wait=0', remoteAddress: '203.0.113.9' })).statusCode).toBe(401);
  });
});

describe('error codes', () => {
  it('gives every response a request id and puts it in error bodies', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/health' });
    expect(ok.headers['x-request-id']).toMatch(/^[0-9a-f]{8}$/);
    const bad = await app.inject({ method: 'POST', url: '/api/engines/claude-cli/sign-in/code', payload: { code: 'x' } });
    expect(bad.statusCode).toBe(409);
    expect((bad.json() as { error: { requestId: string } }).error.requestId).toBe(bad.headers['x-request-id']);
  });

  it('reports the server side for Settings → Diagnostics', async () => {
    const d = (await app.inject({ method: 'GET', url: '/api/diagnostics' })).json() as { startedAt: string; live: { epoch: string }; engines: unknown[]; errors: unknown[] };
    expect(d.live.epoch).toBe(ctx.bus.epoch);
    expect(Array.isArray(d.engines)).toBe(true);
    expect(Array.isArray(d.errors)).toBe(true);
    ctx.diag.record({ code: 'RUN-12345678', message: 'boom' });
    const again = (await app.inject({ method: 'GET', url: '/api/diagnostics' })).json() as { errors: Array<{ code: string }> };
    expect(again.errors[0]?.code).toBe('RUN-12345678');
  });
});
