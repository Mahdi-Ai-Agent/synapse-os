import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { createVault } from '@synapse/vault-template';
import { buildApp } from '../src/app';
import { ConnectionsStore, redirectProblem, sameRedirect, sameResource } from '../src/connections';
import type { Ctx } from '../src/context';
import { basicAuth } from '../src/routes/oauth';

const REMOTE = '203.0.113.7';
const HOST = 'synapse.example.com';
const ORIGIN = `https://${HOST}`;
const MCP = `${ORIGIN}/mcp`;
let root = '';
let app: FastifyInstance;
let ctx: Ctx;
let session = '';

type Headers = Record<string, string>;
const remote = (method: 'GET' | 'POST' | 'DELETE', url: string, opts: { token?: string; payload?: unknown; headers?: Headers; form?: Record<string, string> } = {}): Promise<LightMyRequestResponse> =>
  app.inject({
    method, url, remoteAddress: REMOTE,
    headers: { host: HOST, ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...opts.headers },
    ...(opts.form ? { payload: new URLSearchParams(opts.form).toString() } : opts.payload !== undefined ? { payload: opts.payload as object } : {}),
  });

let rpcId = 0;
/** One JSON-RPC call the way a 2025-era client sends it (each request stands alone: the endpoint is stateless). */
async function rpc(token: string | null, method: string, params: Record<string, unknown> = {}, headers: Headers = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await app.inject({
    method: 'POST', url: '/mcp', remoteAddress: headers['x-remote'] ?? REMOTE,
    headers: { host: HOST, accept: 'application/json, text/event-stream', 'content-type': 'application/json', 'mcp-protocol-version': '2025-06-18', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    payload: { jsonrpc: '2.0', id: ++rpcId, method, params },
  });
  return { status: r.statusCode, body: parseBody(r.body) };
}
/** A JSON body, or the last `data:` message of an SSE answer (2025-era requests are answered as a short event stream). */
function parseBody(raw: string): Record<string, unknown> {
  if (!raw) return {};
  if (!/^(event|data|id):/m.test(raw.split('\n')[0] ?? '')) return JSON.parse(raw) as Record<string, unknown>;
  const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean);
  return data.length ? (JSON.parse(data[data.length - 1]!) as Record<string, unknown>) : {};
}
const initialize = (token: string | null, headers: Headers = {}) =>
  rpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }, headers);
const toolNames = async (token: string): Promise<string[]> => ((await rpc(token, 'tools/list')).body['result'] as { tools: Array<{ name: string }> }).tools.map((t) => t.name).sort();
const call = async (token: string, name: string, args: Record<string, unknown>) => (await rpc(token, 'tools/call', { name, arguments: args })).body['result'] as { content: Array<{ text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

const pkce = (): { verifier: string; challenge: string } => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

/** Registers a public client, approves it on the consent API and redeems the code: an app's whole sign-in. */
async function connect(opts: { write: boolean; name?: string; redirect?: string }): Promise<{ clientId: string; access: string; refresh: string; scope: string }> {
  const redirect = opts.redirect ?? 'https://app.example/callback';
  const reg = await remote('POST', '/oauth/register', { payload: { redirect_uris: [redirect], token_endpoint_auth_method: 'none', client_name: opts.name ?? 'Test app', grant_types: ['authorization_code', 'refresh_token'] } });
  expect(reg.statusCode).toBe(201);
  const clientId = (reg.json() as { client_id: string }).client_id;
  const { verifier, challenge } = pkce();
  const query = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'st8', scope: 'synapse:read synapse:write', resource: MCP }).toString();
  const decided = await remote('POST', '/api/oauth/decide', { token: session, payload: { query, allow: true, write: opts.write } });
  expect(decided.statusCode).toBe(200);
  const back = new URL((decided.json() as { redirect: string }).redirect);
  expect(back.searchParams.get('state')).toBe('st8');
  expect(back.searchParams.get('iss')).toBe(ORIGIN);
  const tok = await remote('POST', '/oauth/token', { form: { grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: redirect, client_id: clientId, code_verifier: verifier, resource: MCP } });
  expect(tok.statusCode).toBe(200);
  const t = tok.json() as { access_token: string; refresh_token: string; scope: string; token_type: string; expires_in: number };
  expect(t.token_type).toBe('Bearer');
  expect(t.expires_in).toBe(3600);
  return { clientId, access: t.access_token, refresh: t.refresh_token, scope: t.scope };
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-mcp-'));
  await createVault(root);
  ({ app, ctx } = await buildApp({ host: null, port: 0, vaultPath: root, webDist: path.join(root, 'no-dist') }, { serveWeb: false, automation: false, isLoopback: (a) => a === '127.0.0.1' }));
  session = await ctx.auth.create('owner', 'correct horse battery', 'test');
  await ctx.vault.createNode({ type: 'area', title: 'Work', summary: 'Work things' });
  await ctx.vault.createNode({ type: 'project', title: 'Website', summary: 'The new site', area: '[[Work]]' });
  await ctx.vault.createNode({ type: 'task', title: 'Write the landing page', summary: 'Hero and pricing', area: '[[Work]]', project: '[[Website]]', due: '2020-01-01' });
  await ctx.vault.createNode({ type: 'note', title: 'سفر شمال', summary: 'برنامه‌ی سفر به رامسر', body: 'جاده‌ی چالوس قشنگ است.\n' });
  await ctx.git.snapshot('test: seed');
});

afterAll(async () => {
  await app.close();
  // The vault's watcher may still write while the folder goes (ENOTEMPTY under load): stop it first.
  await ctx.vault.stop();
  await fs.rm(root, { recursive: true, force: true });
});

describe('connections helpers', () => {
  it('matches loopback redirects on any port and nothing else loosely', () => {
    expect(sameRedirect('http://localhost/callback', 'http://localhost:53123/callback')).toBe(true);
    expect(sameRedirect('http://127.0.0.1/callback', 'http://127.0.0.1:9/callback')).toBe(true);
    expect(sameRedirect('http://localhost/callback', 'http://127.0.0.1:9/callback')).toBe(false);
    expect(sameRedirect('https://app.example/cb', 'https://app.example:444/cb')).toBe(false);
    expect(sameRedirect('https://app.example/cb', 'https://app.example/cb?x=1')).toBe(false);
  });
  it('allows https, loopback http and app schemes as redirects', () => {
    expect(redirectProblem('https://claude.ai/api/mcp/auth_callback')).toBeNull();
    expect(redirectProblem('http://127.0.0.1:3118/callback')).toBeNull();
    expect(redirectProblem('cursor://anysphere.cursor-mcp/oauth/callback')).toBeNull();
    expect(redirectProblem('http://evil.example/cb')).toMatch(/loopback/);
    expect(redirectProblem('javascript:alert(1)')).toMatch(/not allowed/);
    expect(redirectProblem('https://app.example/cb#x')).toMatch(/fragment/);
  });
  it('takes the MCP URL with a slash or as the bare origin as the same resource', () => {
    expect(sameResource(`${MCP}/`, MCP)).toBe(true);
    expect(sameResource(ORIGIN, MCP)).toBe(true);
    expect(sameResource('https://other.example/mcp', MCP)).toBe(false);
  });
  it('reads Basic client credentials', () => {
    expect(basicAuth(`Basic ${Buffer.from('id:se%3Acret').toString('base64')}`)).toEqual({ id: 'id', secret: 'se:cret' });
    expect(basicAuth('Bearer x')).toBeNull();
  });
});

describe('discovery', () => {
  it('serves the protected resource and authorization server metadata for the public origin', async () => {
    for (const url of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
      const r = await remote('GET', url);
      expect(r.statusCode).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.json()).toMatchObject({ resource: MCP, authorization_servers: [ORIGIN], scopes_supported: ['synapse:read', 'synapse:write'] });
    }
    const m = (await remote('GET', '/.well-known/oauth-authorization-server')).json() as Record<string, unknown>;
    expect(m).toMatchObject({
      issuer: ORIGIN, authorization_endpoint: `${ORIGIN}/oauth/authorize`, token_endpoint: `${ORIGIN}/oauth/token`, registration_endpoint: `${ORIGIN}/oauth/register`,
      code_challenge_methods_supported: ['S256'], client_id_metadata_document_supported: true, authorization_response_iss_parameter_supported: true,
    });
    expect(m['token_endpoint_auth_methods_supported']).toContain('none');
  });
  it('keeps the scheme of a local address and is https for every domain name', async () => {
    const local = (await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource', remoteAddress: REMOTE, headers: { host: '192.168.1.4:4317' } })).json() as { resource: string };
    expect(local.resource).toBe('http://192.168.1.4:4317/mcp');
    const proxied = (await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource', remoteAddress: REMOTE, headers: { host: 'internal:4317', 'x-forwarded-host': 'mind.example.org', 'x-forwarded-proto': 'http' } })).json() as { resource: string };
    expect(proxied.resource).toBe('https://mind.example.org/mcp');
  });
});

describe('the MCP endpoint without a connection', () => {
  it('answers 401 with the challenge that starts an app sign-in', async () => {
    const r = await remote('POST', '/mcp', { payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    expect(r.statusCode).toBe(401);
    expect(r.headers['www-authenticate']).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
    expect(r.headers['www-authenticate']).not.toContain('invalid_token');
    const bad = await remote('POST', '/mcp', { token: `syn_at_${'x'.repeat(43)}`, payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.headers['www-authenticate']).toContain('error="invalid_token"');
  });
  it('serves an app on this machine without a token, but not through a foreign Host (DNS rebinding)', async () => {
    const ok = await initialize(null, { 'x-remote': '127.0.0.1', host: '127.0.0.1:4317' });
    expect(ok.status).toBe(200);
    expect((ok.body['result'] as { serverInfo: { name: string } }).serverInfo.name).toBe('synapse');
    const rebound = await initialize(null, { 'x-remote': '127.0.0.1', host: 'evil.example:4317' });
    expect(rebound.status).toBe(401);
  });
});

describe('connecting an app (OAuth 2.1, registered public client)', () => {
  it('refuses bad registrations', async () => {
    const r = await remote('POST', '/oauth/register', { payload: { redirect_uris: ['http://evil.example/cb'], token_endpoint_auth_method: 'none' } });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: 'invalid_redirect_uri' });
    const m = await remote('POST', '/oauth/register', { payload: { redirect_uris: ['https://app.example/cb'], token_endpoint_auth_method: 'private_key_jwt' } });
    expect(m.json()).toMatchObject({ error: 'invalid_client_metadata' });
  });

  it('shows the consent page only to the signed-in owner, with the app and where the answer goes', async () => {
    const reg = (await remote('POST', '/oauth/register', { payload: { redirect_uris: ['https://app.example/callback'], token_endpoint_auth_method: 'none', client_name: 'Test‮ app' } })).json() as { client_id: string };
    const query = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://app.example/callback', code_challenge: pkce().challenge, code_challenge_method: 'S256' }).toString();
    expect((await remote('POST', '/api/oauth/request', { payload: { query } })).statusCode).toBe(401);
    const r = await remote('POST', '/api/oauth/request', { token: session, payload: { query } });
    expect(r.json()).toEqual({ app: 'Test app', returnsTo: 'app.example', local: false, write: true, owner: 'owner' });
    const wrong = await remote('POST', '/api/oauth/request', { token: session, payload: { query: query.replace('app.example', 'evil.example') } });
    expect(wrong.statusCode).toBe(400);
    expect((wrong.json() as { error: { redirect?: string } }).error.redirect).toBeUndefined();
    const noPkce = await remote('POST', '/api/oauth/request', { token: session, payload: { query: query.replace(/&code_challenge=[^&]+/, '') } });
    expect((noPkce.json() as { error: { redirect: string } }).error.redirect).toMatch(/^https:\/\/app\.example\/callback\?error=invalid_request/);
    const denied = await remote('POST', '/api/oauth/decide', { token: session, payload: { query, allow: false } });
    expect((denied.json() as { redirect: string }).redirect).toContain('error=access_denied');
  });

  it('redeems a code once, with the right PKCE verifier, and a second use ends the connection', async () => {
    const redirect = 'https://app.example/callback';
    const reg = (await remote('POST', '/oauth/register', { payload: { redirect_uris: [redirect], token_endpoint_auth_method: 'none' } })).json() as { client_id: string };
    const { verifier, challenge } = pkce();
    const query = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    const code = () => remote('POST', '/api/oauth/decide', { token: session, payload: { query, allow: true, write: false } }).then((r) => new URL((r.json() as { redirect: string }).redirect).searchParams.get('code')!);
    const c1 = await code();
    const wrongVerifier = await remote('POST', '/oauth/token', { form: { grant_type: 'authorization_code', code: c1, redirect_uri: redirect, client_id: reg.client_id, code_verifier: pkce().verifier } });
    expect(wrongVerifier.json()).toMatchObject({ error: 'invalid_grant' });
    const c2 = await code();
    const form = { grant_type: 'authorization_code', code: c2, redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier };
    const ok = await remote('POST', '/oauth/token', { form });
    expect(ok.statusCode).toBe(200);
    const access = (ok.json() as { access_token: string }).access_token;
    expect((await initialize(access)).status).toBe(200);
    const again = await remote('POST', '/oauth/token', { form });
    expect(again.json()).toMatchObject({ error: 'invalid_grant' });
    expect((await initialize(access)).status).toBe(401);
  });

  it('gives a read-and-write connection every tool and a read-only one only the reading tools', async () => {
    const rw = await connect({ write: true });
    expect(rw.scope).toBe('synapse:read synapse:write');
    expect(await toolNames(rw.access)).toEqual(['about_owner', 'add_item', 'agenda', 'fetch', 'list_items', 'overview', 'search', 'update_item', 'write_journal']);
    const ro = await connect({ write: false, name: 'Reader' });
    expect(ro.scope).toBe('synapse:read');
    expect(await toolNames(ro.access)).toEqual(['about_owner', 'agenda', 'fetch', 'list_items', 'overview', 'search']);
    const init = (await initialize(ro.access)).body['result'] as { instructions: string };
    expect(init.instructions).toContain('read-only');
  });

  it('rotates the refresh token, honours the previous one briefly and ends with Disconnect', async () => {
    const c = await connect({ write: false, name: 'Rotator' });
    const refresh = (t: string) => remote('POST', '/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: t, client_id: c.clientId } });
    const r1 = await refresh(c.refresh);
    expect(r1.statusCode).toBe(200);
    const t1 = r1.json() as { access_token: string; refresh_token: string };
    expect(t1.refresh_token).not.toBe(c.refresh);
    expect((await initialize(c.access)).status).toBe(401);
    expect((await initialize(t1.access_token)).status).toBe(200);
    expect((await refresh(c.refresh)).statusCode).toBe(200); // the replaced token still works within the grace period
    expect((await refresh('syn_rt_unknown')).json()).toMatchObject({ error: 'invalid_grant' });
    const list = (await remote('GET', '/api/connections', { token: session })).json() as { mcpUrl: string; connections: Array<{ id: string; name: string; via: string; write: boolean }> };
    expect(list.mcpUrl).toBe(MCP);
    const mine = list.connections.find((x) => x.name === 'Rotator')!;
    expect(mine).toMatchObject({ via: 'app.example', write: false });
    expect((await remote('DELETE', `/api/connections/${mine.id}`, { token: session })).statusCode).toBe(200);
    const latest = (await refresh(t1.refresh_token)).json() as { error?: string };
    expect(latest.error).toBe('invalid_grant');
  });
});

describe('apps that describe themselves (client metadata documents)', () => {
  const CODE_ID = 'https://claude.ai/oauth/claude-code-client-metadata';
  const docs: Record<string, unknown> = {
    [CODE_ID]: { client_id: CODE_ID, client_name: 'Claude Code', redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' },
    'https://chatgpt.com/oauth/client.json': { client_id: 'https://chatgpt.com/oauth/client.json', client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'], token_endpoint_auth_method: 'private_key_jwt', token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'] },
    'https://jwt.example/client.json': { client_id: 'https://jwt.example/client.json', redirect_uris: ['https://jwt.example/cb'], token_endpoint_auth_method: 'private_key_jwt' },
    'https://liar.example/client.json': { client_id: 'https://someone.else/client.json', redirect_uris: ['https://liar.example/cb'] },
  };
  let original: ConnectionsStore;
  beforeAll(() => {
    original = ctx.connections;
    ctx.connections = new ConnectionsStore(root, { fetchMetadata: async (url) => { if (!(url in docs)) throw new Error('HTTP 404'); return docs[url]; } });
  });
  afterAll(() => { ctx.connections = original; });

  const ask = (clientId: string, redirect: string, challenge: string) => new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', resource: MCP }).toString();

  it('signs Claude Code in through a loopback redirect on any port', async () => {
    const { verifier, challenge } = pkce();
    const query = ask(CODE_ID, 'http://localhost:53123/callback', challenge);
    expect((await remote('POST', '/api/oauth/request', { token: session, payload: { query } })).json()).toMatchObject({ app: 'Claude Code', returnsTo: 'localhost', local: true });
    const back = new URL(((await remote('POST', '/api/oauth/decide', { token: session, payload: { query, allow: true, write: true } })).json() as { redirect: string }).redirect);
    expect(back.origin).toBe('http://localhost:53123');
    const tok = await remote('POST', '/oauth/token', { form: { grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: 'http://localhost:53123/callback', client_id: CODE_ID, code_verifier: verifier } });
    expect(tok.statusCode).toBe(200);
    expect((await initialize((tok.json() as { access_token: string }).access_token)).status).toBe(200);
  });

  it('takes ChatGPT as a public client although it prefers private_key_jwt', async () => {
    const id = 'https://chatgpt.com/oauth/client.json';
    const { verifier, challenge } = pkce();
    const query = ask(id, 'https://chatgpt.com/connector_platform_oauth_redirect', challenge);
    expect((await remote('POST', '/api/oauth/request', { token: session, payload: { query } })).json()).toMatchObject({ app: 'ChatGPT', returnsTo: 'chatgpt.com' });
    const back = new URL(((await remote('POST', '/api/oauth/decide', { token: session, payload: { query, allow: true } })).json() as { redirect: string }).redirect);
    const tok = await remote('POST', '/oauth/token', { form: { grant_type: 'authorization_code', code: back.searchParams.get('code')!, client_id: id, code_verifier: verifier, resource: MCP } });
    expect(tok.json()).toMatchObject({ scope: 'synapse:read' });
  });

  it('refuses documents it cannot trust, without redirecting', async () => {
    for (const id of ['https://jwt.example/client.json', 'https://liar.example/client.json', 'https://missing.example/client.json']) {
      const r = await remote('POST', '/api/oauth/request', { token: session, payload: { query: ask(id, 'https://x.example/cb', pkce().challenge) } });
      expect(r.statusCode).toBe(400);
      expect(r.json()).toMatchObject({ error: { code: 'invalid_client' } });
      expect((r.json() as { error: { redirect?: string } }).error.redirect).toBeUndefined();
    }
  });
});

describe('the tools', () => {
  let token = '';
  beforeAll(async () => { token = (await connect({ write: true, name: 'Claude' })).access; });

  it('starts from the index and finds items in both languages', async () => {
    const o = await call(token, 'overview', {});
    expect(o.content[0]!.text).toContain('Today is');
    expect(o.content[0]!.text).toContain(`${ORIGIN}/#item=<id>`);
    expect(o.content[0]!.text).toContain('Work');
    const s = await call(token, 'search', { query: 'رامسر' });
    const results = (s.structuredContent as { results: Array<{ title: string; url: string; kind: string }> }).results;
    expect(results[0]).toMatchObject({ title: 'سفر شمال', kind: 'note' });
    expect(results[0]!.url).toMatch(new RegExp(`^${ORIGIN}/#item=`));
    const none = await call(token, 'search', { query: 'zzzqqq' });
    expect(none.content[0]!.text).toContain('Nothing matched');
  });

  it('opens an item by id or title with its links', async () => {
    const f = await call(token, 'fetch', { id: 'Write the landing page' });
    const v = f.structuredContent as { title: string; metadata: Record<string, unknown> };
    expect(v.title).toBe('Write the landing page');
    expect(v.metadata).toMatchObject({ kind: 'task', category: 'Work', project: 'Website', due: '2020-01-01' });
    expect((await call(token, 'fetch', { id: 'nope' })).isError).toBe(true);
  });

  it('lists and shows the agenda', async () => {
    const l = await call(token, 'list_items', { category: 'Work' });
    expect(l.content[0]!.text).toContain('Write the landing page');
    expect((await call(token, 'list_items', { category: 'Nope' })).isError).toBe(true);
    const a = await call(token, 'agenda', {});
    expect(a.content[0]!.text).toMatch(/## Overdue\n- Write the landing page/);
    expect(a.content[0]!.text).toContain('## Active projects and their next task');
  });

  it('adds, changes and journals, one undoable commit each', async () => {
    const added = await call(token, 'add_item', { kind: 'idea', title: 'A podcast about notes', summary: 'Weekly, short', category: 'Work', people: ['Sara'] });
    expect(added.isError).toBeUndefined();
    expect(added.content[0]!.text).toContain('Sara');
    const id = (added.structuredContent as { id: string }).id;
    expect(ctx.vault.getNode(id)?.fm).toMatchObject({ type: 'idea', area: '[[Work]]', people: ['[[Sara]]'], source: 'capture' });
    expect((await call(token, 'add_item', { kind: 'idea', title: 'a podcast about NOTES' })).isError).toBe(true);
    expect((await call(token, 'add_item', { kind: 'task', title: 'Bad status', status: 'finished' })).isError).toBe(true);

    const task = ctx.vault.listNodes().find((n) => n.fm.title === 'Write the landing page')!;
    const changed = await call(token, 'update_item', { id: task.fm.id, status: 'done', append: 'Shipped on Friday.' });
    expect(changed.structuredContent).toMatchObject({ status: 'done' });
    expect(ctx.vault.getNode(task.fm.id)?.body).toContain('Shipped on Friday.');

    const j = await call(token, 'write_journal', { text: 'Talked with Sara about the podcast.' });
    const journal = ctx.vault.getNode((j.structuredContent as { id: string }).id)!;
    expect(journal.fm.type).toBe('journal');
    expect(journal.body).toMatch(/^## \d{2}:\d{2} — Claude\nTalked with Sara/);
    await call(token, 'write_journal', { text: 'Second entry.' });
    expect(ctx.vault.getNode(journal.fm.id)!.body).toContain('Second entry.');

    const subjects = (await ctx.git.log(10)).map((c) => c.subject);
    expect(subjects).toEqual(expect.arrayContaining(['mcp(Claude): add A podcast about notes', 'mcp(Claude): update Write the landing page', `mcp(Claude): journal ${journal.fm.date}`]));
  });

  it('reads the owner: profile and the character map when there is one', async () => {
    const a = await call(token, 'about_owner', {});
    expect(a.content[0]!.text).toContain('Character map');
  });
});

describe('personal keys', () => {
  it('work as a bearer token, read-only unless asked, until deleted', async () => {
    const r = await remote('POST', '/api/connections/keys', { token: session, payload: { name: 'n8n', write: false } });
    const { key, connection } = r.json() as { key: string; connection: { id: string; kind: string; hint: string } };
    expect(key).toMatch(/^syn_key_/);
    expect(connection).toMatchObject({ kind: 'key', hint: key.slice(-4) });
    expect(await toolNames(key)).not.toContain('add_item');
    await remote('DELETE', `/api/connections/${connection.id}`, { token: session });
    expect((await initialize(key)).status).toBe(401);
  });

  it('all end when the password changes', async () => {
    const c = await connect({ write: false, name: 'Before' });
    const r = await remote('POST', '/api/auth/password', { token: session, payload: { current: 'correct horse battery', next: 'another long password' } });
    session = (r.json() as { token: string }).token;
    expect((await initialize(c.access)).status).toBe(401);
    expect(((await remote('GET', '/api/connections', { token: session })).json() as { connections: unknown[] }).connections).toEqual([]);
  });
});

describe('the connections file', () => {
  it('keeps only hashes of tokens, owner-only', async () => {
    await connect({ write: false, name: 'Hashes' });
    const file = path.join(root, '.synapse', 'connections.json');
    const raw = await fs.readFile(file, 'utf8');
    expect(raw).not.toMatch(/syn_(at|rt|key|secret)_/);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });
});
