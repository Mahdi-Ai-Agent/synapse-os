import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createVault } from '@synapse/vault-template';
import { buildApp, isTrustedOrigin } from '../src/app';
import type { Ctx } from '../src/context';
import { isLoopbackAddress, lanAddresses, resolveBindHost } from '../src/lan';
import { PairingStore, bearerToken, isProtectedPath, redactUrl } from '../src/pairing';

const REMOTE = '192.168.1.50';
let root = '';
let webDist = '';
let app: FastifyInstance;
let ctx: Ctx;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-pairing-'));
  await createVault(root);
  webDist = path.join(root, 'web-dist');
  await fs.mkdir(path.join(webDist, 'assets'), { recursive: true });
  await fs.writeFile(path.join(webDist, 'index.html'), '<!doctype html><title>Synapse test shell</title>');
  await fs.writeFile(path.join(webDist, 'assets', 'app-abc123.js'), 'console.log(1)');
  await fs.writeFile(path.join(webDist, 'manifest.webmanifest'), JSON.stringify({ name: 'Synapse', start_url: '/', display: 'standalone' }));
  ({ app, ctx } = await buildApp({ host: null, port: 0, vaultPath: root, webDist }));
});

afterAll(async () => {
  await app.close();
  // The vault's watcher may still write while the folder goes (ENOTEMPTY under load): stop it first.
  await ctx.vault.stop();
  await fs.rm(root, { recursive: true, force: true });
});

describe('lan', () => {
  it('recognizes the three loopback spellings and nothing else', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('127.0.0.2')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress(REMOTE)).toBe(false);
    expect(isLoopbackAddress('::ffff:192.168.1.5')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(isLoopbackAddress('')).toBe(false);
  });

  it('lists reachable IPv4 addresses, private and physical first', () => {
    const iface = (address: string, internal = false, family: 'IPv4' | 'IPv6' = 'IPv4'): os.NetworkInterfaceInfo =>
      ({ address, netmask: '255.255.255.0', family, mac: '00:00:00:00:00:00', internal, cidr: `${address}/24` } as os.NetworkInterfaceInfo);
    expect(lanAddresses({
      lo0: [iface('127.0.0.1', true)],
      utun3: [iface('198.18.0.1')],
      en0: [iface('192.168.1.4'), iface('fe80::1', false, 'IPv6')],
      en1: [iface('169.254.10.2')],
    })).toEqual(['192.168.1.4', '198.18.0.1']);
    expect(resolveBindHost(null, false)).toBe('127.0.0.1');
    expect(resolveBindHost(null, true)).toBe('0.0.0.0');
    expect(resolveBindHost('::', false)).toBe('::');
  });

  it('only trusts cross-origin callers on this machine', () => {
    expect(isTrustedOrigin(undefined)).toBe(true);
    expect(isTrustedOrigin('http://127.0.0.1:5173')).toBe(true);
    expect(isTrustedOrigin('http://localhost:5173')).toBe(true);
    expect(isTrustedOrigin('http://[::1]:5173')).toBe(true);
    expect(isTrustedOrigin('http://192.168.1.4:4317')).toBe(false);
    expect(isTrustedOrigin('https://evil.example')).toBe(false);
    expect(isTrustedOrigin('not a url')).toBe(false);
  });
});

describe('pairing helpers', () => {
  it('parses bearer headers, protected paths and redacts tokens from URLs', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer   abc ')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
    expect(isProtectedPath('/api/graph')).toBe(true);
    expect(isProtectedPath('/api')).toBe(true);
    expect(isProtectedPath('/ws?token=x')).toBe(true);
    expect(isProtectedPath('/')).toBe(false);
    expect(isProtectedPath('/apix')).toBe(false);
    expect(isProtectedPath('/assets/app.js')).toBe(false);
    expect(redactUrl('/ws?token=SECRET&x=1')).toBe('/ws?token=[redacted]&x=1');
    expect(redactUrl('/manifest.webmanifest?token=SECRET')).toBe('/manifest.webmanifest?token=[redacted]');
    expect(redactUrl('/api/graph')).toBe('/api/graph');
  });
});

describe('PairingStore', () => {
  it('generates a base64url token once, keeps the file owner-only and verifies in constant time', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-pairing-store-'));
    try {
      const store = new PairingStore(dir);
      const p = await store.get();
      expect(p.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect((await fs.stat(path.join(dir, '.synapse', 'pairing.json'))).mode & 0o777).toBe(0o600);
      expect(await new PairingStore(dir).get()).toEqual(p);
      expect(await store.verify(p.token)).toBe(true);
      expect(await store.verify(p.token.slice(0, -1))).toBe(false);
      expect(await store.verify(`${p.token}x`)).toBe(false);
      expect(await store.verify('')).toBe(false);
      expect(await store.verify(null)).toBe(false);
      const rotated = await store.rotate();
      expect(rotated.token).not.toBe(p.token);
      expect(await store.verify(p.token)).toBe(false);
      expect(await store.verify(rotated.token)).toBe(true);
      expect((await fs.stat(path.join(dir, '.synapse', 'pairing.json'))).mode & 0o777).toBe(0o600);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('access guard over the API', () => {
  it('lets loopback in without a token and rejects other addresses until they present it', async () => {
    const token = (await ctx.pairing.get()).token;
    expect((await app.inject({ method: 'GET', url: '/api/graph' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/graph', remoteAddress: '::1' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/graph', remoteAddress: '::ffff:127.0.0.1' })).statusCode).toBe(200);

    const denied = await app.inject({ method: 'GET', url: '/api/graph', remoteAddress: REMOTE });
    expect(denied.statusCode).toBe(401);
    expect(denied.headers['content-type']).toContain('application/json');
    expect(denied.headers['www-authenticate']).toContain('Bearer');
    expect(denied.json()).toMatchObject({ error: { message: expect.stringContaining('sign in') } });
    expect(JSON.stringify(denied.json())).not.toContain(token);

    expect((await app.inject({ method: 'GET', url: '/api/graph', remoteAddress: REMOTE, headers: { authorization: `Bearer ${token}x` } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/api/graph?token=${token}`, remoteAddress: REMOTE })).statusCode).toBe(401); // query tokens are for the WebSocket only
    expect((await app.inject({ method: 'GET', url: '/api/graph', remoteAddress: REMOTE, headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/capture', remoteAddress: REMOTE, payload: { text: 'hi' } })).statusCode).toBe(401);
  });

  it('never trusts X-Forwarded-For', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/graph', remoteAddress: REMOTE, headers: { 'x-forwarded-for': '127.0.0.1' } });
    expect(r.statusCode).toBe(401);
  });

  it('takes loopback for the desktop only when the Host is a loopback name too (DNS rebinding)', async () => {
    // The desktop's own names; the Vite dev proxy sends 127.0.0.1:<port> on /api and keeps the browser's Host on /ws.
    for (const host of ['localhost:4317', '127.0.0.1:4317', '[::1]:4317', 'synapse.localhost:4317', 'localhost:5173']) {
      expect((await app.inject({ method: 'GET', url: '/api/graph', headers: { host } })).statusCode, host).toBe(200);
    }
    // A page whose own domain resolves to 127.0.0.1 arrives on a loopback socket, but its Host names that domain.
    for (const host of ['evil.example:4317', 'evil.example', '127.0.0.1.nip.io:4317', 'localhost.evil.example:4317']) {
      for (const url of ['/api/graph', '/api/pairing']) {
        const r = await app.inject({ method: 'GET', url, headers: { host } });
        expect(r.statusCode, `${host} ${url}`).toBe(401);
        expect(r.headers['www-authenticate']).toContain('Bearer');
      }
    }
    const rebound = { host: 'evil.example:4317' };
    expect((await app.inject({ method: 'POST', url: '/api/capture', headers: rebound, payload: { text: 'hi' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/pairing/rotate', headers: rebound })).statusCode).toBe(401);
    // The public way in does not take it for the desktop either, so it cannot claim the account without the setup code.
    expect((await app.inject({ method: 'GET', url: '/api/auth/status' })).json()).toMatchObject({ authenticated: true, needsCode: false });
    expect((await app.inject({ method: 'GET', url: '/api/auth/status', headers: rebound })).json()).toMatchObject({ authenticated: false, needsCode: true });
    expect((await app.inject({ method: 'POST', url: '/api/auth/setup', headers: rebound, payload: { username: 'owner', password: 'correct horse battery' } })).statusCode).toBe(403);
    expect(await ctx.auth.hasAccount()).toBe(false);
  });

  it('leaves LAN clients as they were: the token decides, and a loopback Host alone opens nothing', async () => {
    const token = (await ctx.pairing.get()).token;
    for (const host of ['192.168.1.4:4317', 'localhost:4317', '127.0.0.1:4317']) {
      expect((await app.inject({ method: 'GET', url: '/api/graph', remoteAddress: REMOTE, headers: { host } })).statusCode, host).toBe(401);
      expect((await app.inject({ method: 'GET', url: '/api/graph', remoteAddress: REMOTE, headers: { host, authorization: `Bearer ${token}` } })).statusCode, host).toBe(200);
    }
    // A token works whatever the Host names (a deployment's own domain); a rebinding page has none to send.
    expect((await app.inject({ method: 'GET', url: '/api/graph', headers: { host: 'evil.example:4317', authorization: `Bearer ${token}` } })).statusCode).toBe(200);
  });

  it('hands the token and rotation only to the desktop', async () => {
    const before = (await ctx.pairing.get()).token;
    const phone = await app.inject({ method: 'GET', url: '/api/pairing', remoteAddress: REMOTE, headers: { authorization: `Bearer ${before}` } });
    expect(phone.statusCode).toBe(200);
    expect(phone.json()).toMatchObject({ fromLoopback: false, token: null, pairUrls: [] });
    expect(JSON.stringify(phone.json())).not.toContain(before);

    const desktop = await app.inject({ method: 'GET', url: '/api/pairing' });
    expect(desktop.statusCode).toBe(200);
    const info = desktop.json() as { token: string; pairUrls: string[]; urls: string[]; lanAccess: boolean; fromLoopback: boolean };
    expect(info.fromLoopback).toBe(true);
    expect(info.token).toBe(before);
    expect(info.lanAccess).toBe(false);
    expect(info.pairUrls).toEqual(info.urls.map((u) => `${u}/#pair=${before}`));

    expect((await app.inject({ method: 'POST', url: '/api/pairing/rotate', remoteAddress: REMOTE, headers: { authorization: `Bearer ${before}` } })).statusCode).toBe(403);
    const rotated = await app.inject({ method: 'POST', url: '/api/pairing/rotate' });
    expect(rotated.statusCode).toBe(200);
    const after = (rotated.json() as { token: string }).token;
    expect(after).not.toBe(before);
    expect((await app.inject({ method: 'GET', url: '/api/graph', remoteAddress: REMOTE, headers: { authorization: `Bearer ${before}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/graph', remoteAddress: REMOTE, headers: { authorization: `Bearer ${after}` } })).statusCode).toBe(200);
  });

  it('lets only the desktop change LAN access', async () => {
    const token = (await ctx.pairing.get()).token;
    const phone = await app.inject({ method: 'PUT', url: '/api/settings', remoteAddress: REMOTE, headers: { authorization: `Bearer ${token}` }, payload: { server: { lanAccess: true } } });
    expect(phone.statusCode).toBe(403);
    expect((await ctx.settings.get()).server.lanAccess).toBe(false);
    const desktop = await app.inject({ method: 'PUT', url: '/api/settings', payload: { server: { lanAccess: true } } });
    expect(desktop.statusCode).toBe(200);
    expect((desktop.json() as { server: { lanAccess: boolean } }).server.lanAccess).toBe(true);
    expect((await ctx.settings.get()).server.lanAccess).toBe(true);
    // A phone may re-send the current value (no change) and other settings freely.
    expect((await app.inject({ method: 'PUT', url: '/api/settings', remoteAddress: REMOTE, headers: { authorization: `Bearer ${token}` }, payload: { server: { lanAccess: true }, locale: 'en' } })).statusCode).toBe(200);
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { server: { lanAccess: false }, locale: 'fa' } });
  });
});

describe('access guard over the WebSocket', () => {
  it('rejects an upgrade from an unknown address without ?token= and accepts it with one', async () => {
    await expect(app.injectWS('/ws')).rejects.toThrow(/401/);
    const token = (await ctx.pairing.get()).token;
    await expect(app.injectWS(`/ws?token=${token}x`)).rejects.toThrow(/401/);
    // The hello frame arrives before the promise settles, so the listener goes on in onInit.
    const messages: string[] = [];
    const ws = await app.injectWS(`/ws?token=${token}`, {}, { onInit: (w) => { w.on('message', (d) => messages.push(String(d))); } });
    await new Promise((r) => setTimeout(r, 50));
    expect(ws.readyState).toBe(ws.OPEN);
    expect(JSON.parse(messages[0] ?? '{}')).toMatchObject({ type: 'hello' });
    ws.terminate();
  });

  /**
   * A `/ws` upgrade over a real socket from 127.0.0.1; `host` replaces the Host header (`127.0.0.1:<port>` by default).
   * `agent: false` opens a new connection each time: a pooled keep-alive socket of a refused upgrade is one the server
   * has already closed.
   */
  const upgrade = async (url: string, host?: string): Promise<{ status: number; hello: string }> => {
    if (!app.server.listening) await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: url, agent: false, headers: { ...(host ? { host } : {}), connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' } });
      req.on('upgrade', (res, socket, head) => {
        // When it arrives with the answer, the first frame is the server's hello: 0x81 (FIN + text), a short length, the JSON.
        const frame = Buffer.from(head);
        const hello = frame.length > 2 && frame[0] === 0x81 ? frame.subarray(2, 2 + (frame[1] ?? 0)).toString('utf8') : '';
        socket.destroy();
        resolve({ status: res.statusCode ?? 0, hello });
      });
      req.on('response', (res) => { res.resume(); resolve({ status: res.statusCode ?? 0, hello: '' }); });
      req.on('error', reject);
      req.end();
    });
  };

  it('accepts a loopback upgrade without a token over a real socket', async () => {
    const direct = await upgrade('/ws');
    expect(direct.status).toBe(101);
    if (direct.hello) expect(JSON.parse(direct.hello)).toMatchObject({ type: 'hello' });
    // Through the Vite dev proxy, which keeps the browser's Host on /ws.
    expect((await upgrade('/ws', 'localhost:5173')).status).toBe(101);
  });

  it('rejects a loopback upgrade that names a foreign Host (DNS rebinding) unless it brings the token', async () => {
    expect((await upgrade('/ws', 'evil.example:4317')).status).toBe(401);
    expect((await upgrade('/ws', '127.0.0.1.nip.io:4317')).status).toBe(401);
    const token = (await ctx.pairing.get()).token;
    expect((await upgrade(`/ws?token=${token}`, 'evil.example:4317')).status).toBe(101);
  });
});

describe('static web app', () => {
  it('serves the shell to anyone, falls back to index.html for app routes, keeps /api 404s JSON', async () => {
    const home = await app.inject({ method: 'GET', url: '/', remoteAddress: REMOTE });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('Synapse test shell');
    expect(home.headers['cache-control']).toBe('no-cache');
    const asset = await app.inject({ method: 'GET', url: '/assets/app-abc123.js', remoteAddress: REMOTE });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    const route = await app.inject({ method: 'GET', url: '/today', remoteAddress: REMOTE, headers: { accept: 'text/html,*/*' } });
    expect(route.statusCode).toBe(200);
    expect(route.body).toContain('Synapse test shell');
    const missingAsset = await app.inject({ method: 'GET', url: '/assets/nope.js', headers: { accept: '*/*' } });
    expect(missingAsset.statusCode).toBe(404);
    const api = await app.inject({ method: 'GET', url: '/api/nope', headers: { accept: 'text/html' } });
    expect(api.statusCode).toBe(404);
    expect(api.headers['content-type']).toContain('application/json');
  });

  it('personalizes the manifest start_url only for a valid token', async () => {
    const token = (await ctx.pairing.get()).token;
    const plain = await app.inject({ method: 'GET', url: '/manifest.webmanifest', remoteAddress: REMOTE });
    expect(plain.statusCode).toBe(200);
    expect(plain.headers['content-type']).toContain('application/manifest+json');
    expect((plain.json() as { start_url: string }).start_url).toBe('/');
    expect((await app.inject({ method: 'GET', url: '/manifest.webmanifest?token=nope', remoteAddress: REMOTE })).json()).toMatchObject({ start_url: '/' });
    expect((await app.inject({ method: 'GET', url: `/manifest.webmanifest?token=${token}`, remoteAddress: REMOTE })).json()).toMatchObject({ start_url: `/#pair=${token}`, display: 'standalone' });
  });
});

describe('a pairing token pinned by the environment', () => {
  it('is the token, verifies, and cannot be rotated', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-pin-'));
    const store = new PairingStore(dir, 'a'.repeat(43));
    expect(store.pinnedByEnv).toBe(true);
    expect((await store.get()).token).toBe('a'.repeat(43));
    expect(await store.verify('a'.repeat(43))).toBe(true);
    expect(await store.verify('b'.repeat(43))).toBe(false);
    await expect(store.rotate()).rejects.toThrow();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
