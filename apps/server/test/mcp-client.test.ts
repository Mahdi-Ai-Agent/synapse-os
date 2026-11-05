import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client, StreamableHTTPClientTransport, UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/client';
import { createVault } from '@synapse/vault-template';
import { buildApp } from '../src/app';
import type { Ctx } from '../src/context';

/** The official MCP client against a real socket: discovery, registration, the owner's consent, tokens, then tools. */

type Info = Parameters<NonNullable<OAuthClientProvider['saveClientInformation']>>[0];
type Tokens = Parameters<OAuthClientProvider['saveTokens']>[0];

class MemoryProvider implements OAuthClientProvider {
  info: Info | undefined;
  saved: Tokens | undefined;
  verifier = '';
  authorizationUrl: URL | null = null;
  get redirectUrl(): string { return 'http://127.0.0.1:9/callback'; }
  get clientMetadata() {
    return { client_name: 'SDK client', redirect_uris: ['http://127.0.0.1:9/callback'], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
  }
  clientInformation(): Info | undefined { return this.info; }
  saveClientInformation(i: Info): void { this.info = i; }
  tokens(): Tokens | undefined { return this.saved; }
  saveTokens(t: Tokens): void { this.saved = t; }
  redirectToAuthorization(url: URL): void { this.authorizationUrl = url; }
  saveCodeVerifier(v: string): void { this.verifier = v; }
  codeVerifier(): string { return this.verifier; }
}

let root = '';
let app: FastifyInstance;
let ctx: Ctx;
let base = '';
let session = '';

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-mcp-client-'));
  await createVault(root);
  // Every client counts as remote here, so the SDK has to sign in like an app on another machine.
  ({ app, ctx } = await buildApp({ host: null, port: 0, vaultPath: root, webDist: path.join(root, 'no-dist') }, { serveWeb: false, automation: false, isLoopback: () => false }));
  session = await ctx.auth.create('owner', 'correct horse battery', 'test');
  await ctx.vault.createNode({ type: 'area', title: 'Health', summary: 'Body and mind' });
  await ctx.vault.createNode({ type: 'habit', title: 'Morning walk', summary: 'Thirty minutes before work', area: '[[Health]]' });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app.close();
  // The vault's watcher may still write while the folder goes (ENOTEMPTY under load): stop it first, like the other suites.
  await ctx.vault.stop();
  await fs.rm(root, { recursive: true, force: true });
});

describe('the official MCP client', () => {
  it('signs in with OAuth, then lists and calls the tools', async () => {
    const provider = new MemoryProvider();
    const url = new URL(`${base}/mcp`);
    const first = new StreamableHTTPClientTransport(url, { authProvider: provider });
    await expect(new Client({ name: 'sdk-test', version: '1.0.0' }).connect(first)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(provider.info?.client_id).toMatch(/^syn_client_/);
    expect(provider.authorizationUrl?.pathname).toBe('/oauth/authorize');

    // The owner's browser: the consent page posts the query it was opened with.
    const res = await fetch(`${base}/api/oauth/decide`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: provider.authorizationUrl!.search, allow: true, write: true }),
    });
    const callback = new URL(((await res.json()) as { redirect: string }).redirect);
    await first.finishAuth(callback.searchParams);
    expect(provider.saved?.access_token).toMatch(/^syn_at_/);

    const client = new Client({ name: 'sdk-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['overview', 'search', 'fetch', 'add_item']));
    const found = await client.callTool({ name: 'search', arguments: { query: 'walk' } });
    expect(JSON.stringify(found.structuredContent)).toContain('Morning walk');
    const added = await client.callTool({ name: 'add_item', arguments: { kind: 'note', title: 'From the SDK', category: 'Health' } });
    expect(added.isError).toBeFalsy();
    expect(ctx.vault.listNodes().some((n) => n.fm.title === 'From the SDK')).toBe(true);
    await client.close();
  });
});
