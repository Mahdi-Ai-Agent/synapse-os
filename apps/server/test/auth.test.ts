import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createVault } from '@synapse/vault-template';
import { buildApp } from '../src/app';
import { newSetupCode, sameSetupCode, Throttle } from '../src/auth';
import type { Ctx } from '../src/context';

const REMOTE = '203.0.113.7';
const USER = 'owner';
const PASS = 'correct horse battery';
let root = '';
let app: FastifyInstance;
let ctx: Ctx;

const remote = (method: 'GET' | 'POST', url: string, opts: { token?: string; payload?: unknown } = {}) =>
  app.inject({ method, url, remoteAddress: REMOTE, ...(opts.payload !== undefined ? { payload: opts.payload as object } : {}), headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {} });

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-auth-'));
  await createVault(root);
  ({ app, ctx } = await buildApp({ host: null, port: 0, vaultPath: root, webDist: path.join(root, 'no-dist') }, { serveWeb: false, automation: false, isLoopback: (a) => a === '127.0.0.1' }));
});

afterAll(async () => {
  await app.close();
  // The vault's watcher may still write while the folder goes (ENOTEMPTY under load): stop it first.
  await ctx.vault.stop();
  await fs.rm(root, { recursive: true, force: true });
});

describe('setup codes', () => {
  it('ignore case and dashes and never match empty', () => {
    const c = newSetupCode();
    expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(sameSetupCode(c.toLowerCase().replace(/-/g, ''), c)).toBe(true);
    expect(sameSetupCode('', '')).toBe(false);
    expect(sameSetupCode('AAAA-AAAA-AAAA', c === 'AAAA-AAAA-AAAA' ? 'BBBB-BBBB-BBBB' : c)).toBe(false);
  });
});

describe('the throttle', () => {
  it('shuts one client out after its limit and everyone after the total', () => {
    const t = new Throttle(2, 3, 1000);
    t.fail('a', 0); expect(t.wait('a', 0)).toBe(0);
    t.fail('a', 0); expect(t.wait('a', 0)).toBe(1);
    expect(t.wait('b', 0)).toBe(0);
    t.fail('b', 0); expect(t.wait('c', 0)).toBe(1);
    expect(t.wait('a', 1001)).toBe(0);
  });
});

describe('the owner account', () => {
  let token = '';

  it('starts with no account: a remote client must find the setup code', async () => {
    const s = (await remote('GET', '/api/auth/status')).json() as Record<string, unknown>;
    expect(s).toMatchObject({ account: false, authenticated: false, needsCode: true, username: null });
    expect((await remote('GET', '/api/graph')).statusCode).toBe(401);
  });

  it('refuses a setup without the right code', async () => {
    expect((await remote('POST', '/api/auth/setup', { payload: { username: USER, password: PASS } })).statusCode).toBe(403);
    expect((await remote('POST', '/api/auth/setup', { payload: { username: USER, password: PASS, code: 'WRONG-CODE-0000' } })).statusCode).toBe(403);
  });

  it('creates the account with the code, never stores the password, and signs this device in', async () => {
    const code = (await ctx.auth.currentSetupCode())!;
    const short = await remote('POST', '/api/auth/setup', { payload: { username: USER, password: 'short', code } });
    expect(short.statusCode).toBe(400);
    const r = await remote('POST', '/api/auth/setup', { payload: { username: ` ${USER} `, password: PASS, code: code.toLowerCase() } });
    expect(r.statusCode).toBe(200);
    token = (r.json() as { token: string }).token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const file = await fs.readFile(path.join(root, '.synapse', 'auth.json'), 'utf8');
    expect(file).not.toContain(PASS);
    expect(file).not.toContain(token);
    expect((await fs.stat(path.join(root, '.synapse', 'auth.json'))).mode & 0o777).toBe(0o600);
    expect(await ctx.auth.currentSetupCode()).toBeNull();
    expect((await remote('GET', '/api/graph', { token })).statusCode).toBe(200);
    expect((await remote('GET', '/api/auth/status', { token })).json()).toMatchObject({ account: true, authenticated: true, session: true, username: USER });
  });

  it('has only one account', async () => {
    expect((await remote('POST', '/api/auth/setup', { payload: { username: 'other', password: PASS, code: 'ANY' } })).statusCode).toBe(409);
  });

  it('signs in with the username in any case and the right password only', async () => {
    expect((await remote('POST', '/api/auth/login', { payload: { username: USER, password: 'nope nope nope' } })).statusCode).toBe(401);
    expect((await remote('POST', '/api/auth/login', { payload: { username: 'someone', password: PASS } })).statusCode).toBe(401);
    const r = await remote('POST', '/api/auth/login', { payload: { username: USER.toUpperCase(), password: PASS } });
    expect(r.statusCode).toBe(200);
    const second = (r.json() as { token: string }).token;
    expect((await remote('GET', '/api/graph', { token: second })).statusCode).toBe(200);
    expect((await remote('POST', '/api/auth/logout', { token: second })).statusCode).toBe(200);
    expect((await remote('GET', '/api/graph', { token: second })).statusCode).toBe(401);
    expect((await remote('GET', '/api/graph', { token })).statusCode).toBe(200);
  });

  it('lets a session through the WebSocket upgrade', async () => {
    const ws = await app.injectWS(`/ws?token=${token}`);
    ws.terminate();
  });

  it('changes the password only with the current one and signs every device out', async () => {
    expect((await remote('POST', '/api/auth/password', { token, payload: { current: 'wrong wrong', next: 'another long one' } })).statusCode).toBe(403);
    const r = await remote('POST', '/api/auth/password', { token, payload: { current: PASS, next: 'another long one' } });
    expect(r.statusCode).toBe(200);
    const fresh = (r.json() as { token: string }).token;
    expect((await remote('GET', '/api/graph', { token })).statusCode).toBe(401);
    expect((await remote('GET', '/api/graph', { token: fresh })).statusCode).toBe(200);
    expect((await remote('POST', '/api/auth/login', { payload: { username: USER, password: 'another long one' } })).statusCode).toBe(200);
  });

  it('shuts the door after repeated wrong passwords', async () => {
    let last = 0;
    for (let i = 0; i < 9; i++) last = (await app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: '198.51.100.9', payload: { username: USER, password: `guess ${i} guess` } })).statusCode;
    expect(last).toBe(429);
  });

  it('keeps the desktop free on loopback', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/graph', remoteAddress: '127.0.0.1' })).statusCode).toBe(200);
  });
});

describe('caching', () => {
  it('tells browsers and CDNs to keep no API response', async () => {
    for (const url of ['/api/health', '/api/auth/status']) {
      const r = await app.inject({ method: 'GET', url, remoteAddress: REMOTE });
      expect(r.headers['cache-control']).toBe('no-store');
    }
    expect((await remote('GET', '/api/graph')).headers['cache-control']).toBe('no-store');
  });
});

describe('a server that distrusts loopback (the container)', () => {
  it('asks loopback clients to sign in too, and the health check stays public', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-auth-noloop-'));
    await createVault(dir);
    const built = await buildApp({ host: null, port: 0, vaultPath: dir, webDist: path.join(dir, 'no-dist'), trustLoopback: false }, { serveWeb: false, automation: false, isLoopback: () => true });
    try {
      expect((await built.app.inject({ method: 'GET', url: '/api/graph' })).statusCode).toBe(401);
      expect((await built.app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
      expect((await built.app.inject({ method: 'GET', url: '/api/auth/status' })).json()).toMatchObject({ account: false, needsCode: true });
    } finally {
      await built.app.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
