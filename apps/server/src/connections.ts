import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { assertPublic } from './link-preview';

/**
 * Apps connected to Synapse over MCP (docs/ARCHITECTURE.md "MCP connector"): the OAuth clients that registered here
 * (DCR) or describe themselves with a metadata document (CIMD), the grants the owner approved — one per connected
 * app, holding its current access and refresh token — and the personal keys made in Settings. Every token is random
 * and kept only as its SHA-256, in `.synapse/connections.json` (owner-only file); authorization codes live in memory
 * for ten minutes.
 */

export const SCOPES = ['synapse:read', 'synapse:write'] as const;
export type Scope = (typeof SCOPES)[number];
export type AuthMethod = 'none' | 'client_secret_basic' | 'client_secret_post';
export const AUTH_METHODS: readonly AuthMethod[] = ['none', 'client_secret_basic', 'client_secret_post'];

const ACCESS_TTL_MS = 60 * 60_000;
const REFRESH_TTL_MS = 90 * 86_400_000;
const CODE_TTL_MS = 10 * 60_000;
/** The refresh token a rotation replaced still works this long, so a response lost on the way does not disconnect the app. */
const REFRESH_GRACE_MS = 2 * 60_000;
const MAX_CLIENTS = 100;
const MAX_GRANTS = 50;
/** A registered client that never got a token is dropped after a day. */
const UNUSED_CLIENT_MS = 86_400_000;
/** `usedAt` is written at most this often (no file write per request). */
const TOUCH_MS = 10 * 60_000;
const CIMD_TTL_MS = 60 * 60_000;
const CIMD_MAX_BYTES = 32 * 1024;
const CIMD_TIMEOUT_MS = 5000;

/** An OAuth error answered as `{error, error_description}` (RFC 6749 §5.2, RFC 7591 §3.2.2). */
export class OAuthFailure extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); }
}

/**
 * A bad authorization request. `redirect` is set only once the client and its redirect URI are known to be right;
 * before that the error is shown to the owner and never sent anywhere (RFC 6749 §4.1.2.1).
 */
export class AuthorizeFailure extends Error {
  constructor(readonly code: string, message: string, readonly redirect: string | null) { super(message); }
}

export interface ClientInfo {
  id: string;
  name: string;
  redirectUris: string[];
  authMethod: AuthMethod;
  /** `registered`: through `/oauth/register`; `metadata`: its `client_id` is the URL of its own metadata document. */
  source: 'registered' | 'metadata';
}

interface StoredClient {
  id: string;
  name: string;
  redirectUris: string[];
  authMethod: AuthMethod;
  secretHash?: string;
  createdAt: string;
  usedAt?: string;
}

interface StoredGrant {
  id: string;
  kind: 'oauth' | 'key';
  clientId: string | null;
  name: string;
  /** Where the app lives, for Settings: `claude.ai`, `chatgpt.com`, `localhost`… */
  via: string;
  scopes: Scope[];
  resource: string;
  createdAt: string;
  usedAt: string | null;
  access?: { hash: string; expires: number };
  refresh?: { hash: string; expires: number };
  previousRefresh?: { hash: string; until: number };
  key?: { hash: string; hint: string };
}

interface ConnectionsFile { version: 1; clients: StoredClient[]; grants: StoredGrant[] }

interface PendingCode {
  clientId: string;
  redirectUri: string;
  challenge: string;
  scopes: Scope[];
  resource: string;
  name: string;
  via: string;
  expires: number;
}

export interface AuthorizeRequest {
  client: ClientInfo;
  redirectUri: string;
  state: string | null;
  challenge: string;
  scopes: Scope[];
  resource: string;
}

export interface ConnectionView {
  id: string;
  kind: 'oauth' | 'key';
  name: string;
  via: string;
  write: boolean;
  createdAt: string;
  usedAt: string | null;
  /** Last characters of a personal key, to tell keys apart. */
  hint?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface Credentials { id: string; secret: string }

export interface ConnectionsOptions {
  /** Fetches a client's metadata document (CIMD); tests inject one. */
  fetchMetadata?: (url: string) => Promise<unknown>;
  now?: () => number;
}

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const sameHex = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const token = (prefix: string): string => `${prefix}${randomBytes(32).toString('base64url')}`;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const strings = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined);

/** Readable app name from untrusted metadata: no control characters, at most 80 characters. */
export function cleanName(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  return s || fallback;
}

/** Loopback redirect parts (RFC 8252 §7.3): the port is not compared, CLIs pick a free one on every sign-in. */
function loopback(u: string): { host: string; path: string; query: string } | null {
  try {
    const x = new URL(u);
    if (x.protocol !== 'http:') return null;
    const host = x.hostname.replace(/^\[|\]$/g, '');
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return null;
    return { host, path: x.pathname, query: x.search };
  } catch { return null; }
}

export function sameRedirect(registered: string, given: string): boolean {
  if (registered === given) return true;
  const a = loopback(registered);
  const b = loopback(given);
  return Boolean(a && b && a.host === b.host && a.path === b.path && a.query === b.query);
}

/** Why a redirect URI cannot be registered, or null: https anywhere, http only on loopback, or a native app's own scheme. */
export function redirectProblem(u: string): string | null {
  if (u.length > 2000) return 'the redirect URI is too long';
  let x: URL;
  try { x = new URL(u); } catch { return `not a URL: ${u}`; }
  if (x.hash) return 'a redirect URI cannot have a fragment';
  if (x.protocol === 'https:') return null;
  if (x.protocol === 'http:') return loopback(u) ? null : 'plain http is allowed only for loopback (localhost, 127.0.0.1)';
  if (/^(javascript|data|file|vbscript|about|blob|ws|wss|ftp|mailto|tel):$/.test(x.protocol)) return `the ${x.protocol} scheme is not allowed`;
  return null;
}

/** Host shown in Settings for an app: the metadata document's or the redirect's host, or `localhost` for a CLI. */
function viaOf(client: ClientInfo): string {
  if (client.source === 'metadata') { try { return new URL(client.id).hostname; } catch { /* fall through */ } }
  const first = client.redirectUris[0] ?? '';
  if (loopback(first)) return 'localhost';
  try { const u = new URL(first); return u.protocol === 'https:' ? u.hostname : u.protocol.replace(/:$/, ''); } catch { return '?'; }
}

/** `resource` as clients send it (the MCP URL, sometimes with a slash or as the bare origin), compared without the fragment. */
export function sameResource(given: string, mcpUrl: string): boolean {
  try {
    const u = new URL(given);
    const p = u.pathname.replace(/\/+$/, '');
    const m = new URL(mcpUrl);
    return u.origin === m.origin && (p === m.pathname || p === '');
  } catch { return false; }
}

export function requestedScopes(scope: string | undefined): Scope[] {
  const asked = new Set((scope ?? '').split(/\s+/).filter(Boolean));
  const known = SCOPES.filter((s) => asked.has(s));
  return known.length ? known : [...SCOPES];
}

/** `redirectUri` with `params` added (missing values skipped). */
export function withParams(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return computed.length === challenge.length && timingSafeEqual(Buffer.from(computed), Buffer.from(challenge));
}

async function fetchJson(url: string): Promise<unknown> {
  const u = new URL(url);
  await assertPublic(u);
  const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(CIMD_TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    size += value.length;
    if (size > CIMD_MAX_BYTES) { await reader.cancel(); throw new Error('the metadata document is too large'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export class ConnectionsStore {
  private cache: ConnectionsFile | undefined;
  private writing: Promise<void> = Promise.resolve();
  private codes = new Map<string, PendingCode>();
  /** Codes already exchanged, to revoke the grant when one comes back (RFC 6749 §4.1.2). */
  private spent = new Map<string, { grantId: string; until: number }>();
  private metadata = new Map<string, { client: ClientInfo; until: number }>();
  private readonly fetchMetadata: (url: string) => Promise<unknown>;
  private readonly now: () => number;

  constructor(private readonly root: string, opts: ConnectionsOptions = {}) {
    this.fetchMetadata = opts.fetchMetadata ?? fetchJson;
    this.now = opts.now ?? Date.now;
  }

  get file(): string {
    return path.join(this.root, '.synapse', 'connections.json');
  }

  private async load(): Promise<ConnectionsFile> {
    if (this.cache) return this.cache;
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<ConnectionsFile>;
      this.cache = { version: 1, clients: Array.isArray(raw.clients) ? raw.clients : [], grants: Array.isArray(raw.grants) ? raw.grants : [] };
    } catch { this.cache = { version: 1, clients: [], grants: [] }; }
    return this.cache;
  }

  /** Reads happen after this resolves and in the same tick as the write that follows, so no update is lost. */
  private async ready(): Promise<void> { await this.load(); }

  /** Writes are queued and atomic (temp file + rename); the cache changes at once. */
  private save(f: ConnectionsFile): Promise<void> {
    this.cache = f;
    this.writing = this.writing.catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(f, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
      await fs.rename(tmp, this.file);
      await fs.chmod(this.file, 0o600).catch(() => undefined);
    });
    return this.writing;
  }

  private iso(): string { return new Date(this.now()).toISOString(); }

  // ---- clients

  /** Dynamic client registration (RFC 7591): the client describes itself and gets an id (and a secret if it asks for one). */
  async register(meta: Record<string, unknown>): Promise<Record<string, unknown>> {
    const uris = strings(meta['redirect_uris']);
    if (!uris || !uris.length || uris.length > 10) throw new OAuthFailure('invalid_redirect_uri', 'redirect_uris must list 1 to 10 URIs');
    for (const u of uris) { const p = redirectProblem(u); if (p) throw new OAuthFailure('invalid_redirect_uri', p); }
    const method = str(meta['token_endpoint_auth_method']) ?? 'client_secret_basic';
    if (!(AUTH_METHODS as readonly string[]).includes(method)) throw new OAuthFailure('invalid_client_metadata', `token_endpoint_auth_method ${method} is not supported; use one of ${AUTH_METHODS.join(', ')}`);
    const grants = strings(meta['grant_types']) ?? ['authorization_code'];
    if (!grants.includes('authorization_code') || grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) throw new OAuthFailure('invalid_client_metadata', 'grant_types may hold only authorization_code and refresh_token');
    const responses = strings(meta['response_types']) ?? ['code'];
    if (responses.some((r) => r !== 'code')) throw new OAuthFailure('invalid_client_metadata', 'response_types may hold only code');

    await this.ready();
    const f = this.cache!;
    const now = this.now();
    const used = new Set(f.grants.map((g) => g.clientId));
    let clients = f.clients.filter((c) => used.has(c.id) || c.usedAt || now - Date.parse(c.createdAt) < UNUSED_CLIENT_MS);
    if (clients.length >= MAX_CLIENTS) {
      const spare = clients.filter((c) => !used.has(c.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!spare) throw new OAuthFailure('invalid_client_metadata', 'too many apps are connected; disconnect some in Synapse → Settings', 400);
      clients = clients.filter((c) => c !== spare);
    }
    const id = token('syn_client_');
    const secret = method === 'none' ? null : token('syn_secret_');
    const client: StoredClient = { id, name: cleanName(meta['client_name'], 'An app'), redirectUris: uris, authMethod: method as AuthMethod, createdAt: this.iso(), ...(secret ? { secretHash: sha(secret) } : {}) };
    await this.save({ ...f, clients: [...clients, client] });
    return {
      client_id: id,
      client_id_issued_at: Math.floor(now / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: client.name,
      redirect_uris: uris,
      grant_types: grants,
      response_types: ['code'],
      token_endpoint_auth_method: method,
    };
  }

  /** A registered client by id, or one described by the metadata document its https `client_id` points at. */
  async resolveClient(clientId: string): Promise<ClientInfo | null> {
    if (clientId.startsWith('https://')) return this.metadataClient(clientId);
    const c = (await this.load()).clients.find((x) => x.id === clientId);
    return c ? { id: c.id, name: c.name, redirectUris: c.redirectUris, authMethod: c.authMethod, source: 'registered' } : null;
  }

  private async metadataClient(url: string): Promise<ClientInfo> {
    const hit = this.metadata.get(url);
    if (hit && hit.until > this.now()) return hit.client;
    let doc: Record<string, unknown>;
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.username || u.password || u.hash) throw new Error('the client id must be a plain https URL');
      const raw = await this.fetchMetadata(url);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('the metadata document is not a JSON object');
      doc = raw as Record<string, unknown>;
    } catch (e) {
      throw new AuthorizeFailure('invalid_client', `the app's metadata at ${url} could not be read: ${(e as Error).message}`, null);
    }
    if (doc['client_id'] !== url) throw new AuthorizeFailure('invalid_client', `the metadata document at ${url} names another client_id`, null);
    const uris = strings(doc['redirect_uris']);
    if (!uris?.length || uris.length > 20 || uris.some((u) => redirectProblem(u))) throw new AuthorizeFailure('invalid_client', `the metadata document at ${url} has no usable redirect_uris`, null);
    const methods = strings(doc['token_endpoint_auth_methods_supported']) ?? (str(doc['token_endpoint_auth_method']) ? [str(doc['token_endpoint_auth_method'])!] : ['none']);
    if (!methods.includes('none')) throw new AuthorizeFailure('invalid_client', 'this app signs in only with private_key_jwt, which Synapse does not support; it can register as a public client instead', null);
    const client: ClientInfo = { id: url, name: cleanName(doc['client_name'], new URL(url).hostname), redirectUris: uris, authMethod: 'none', source: 'metadata' };
    if (this.metadata.size > 50) this.metadata.clear();
    this.metadata.set(url, { client, until: this.now() + CIMD_TTL_MS });
    return client;
  }

  // ---- authorization

  /** Checks an authorization request (the consent page's query) before the owner sees it. */
  async checkAuthorize(q: Record<string, string | undefined>, mcpUrl: string, issuer: string): Promise<AuthorizeRequest> {
    const clientId = q['client_id']?.trim();
    if (!clientId) throw new AuthorizeFailure('invalid_request', 'client_id is missing', null);
    const client = await this.resolveClient(clientId);
    if (!client) throw new AuthorizeFailure('invalid_client', 'this app is not registered with this Synapse; add it again', null);
    const redirectUri = q['redirect_uri']?.trim() || (client.redirectUris.length === 1 ? client.redirectUris[0]! : '');
    if (!redirectUri || !client.redirectUris.some((r) => sameRedirect(r, redirectUri))) throw new AuthorizeFailure('invalid_request', 'the redirect_uri is not one this app registered', null);
    const state = q['state'] ?? null;
    const back = (code: string, message: string): AuthorizeFailure =>
      new AuthorizeFailure(code, message, withParams(redirectUri, { error: code, error_description: message, state, iss: issuer }));
    if (q['response_type'] !== 'code') throw back('unsupported_response_type', 'only response_type=code is supported');
    const challenge = q['code_challenge'] ?? '';
    if (q['code_challenge_method'] !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) throw back('invalid_request', 'PKCE with code_challenge_method=S256 is required');
    const resource = q['resource']?.trim();
    if (resource && !sameResource(resource, mcpUrl)) throw back('invalid_target', `this server issues tokens only for ${mcpUrl}`);
    return { client, redirectUri, state, challenge, scopes: requestedScopes(q['scope']), resource: mcpUrl };
  }

  /** The owner's answer: the redirect back to the app, with a one-time code or `access_denied`. */
  decide(req: AuthorizeRequest, allow: boolean, write: boolean, issuer: string): string {
    if (!allow) return withParams(req.redirectUri, { error: 'access_denied', error_description: 'the owner declined', state: req.state, iss: issuer });
    const code = token('syn_code_');
    const scopes: Scope[] = write && req.scopes.includes('synapse:write') ? ['synapse:read', 'synapse:write'] : ['synapse:read'];
    const now = this.now();
    for (const [k, v] of this.codes) if (v.expires <= now) this.codes.delete(k);
    this.codes.set(sha(code), { clientId: req.client.id, redirectUri: req.redirectUri, challenge: req.challenge, scopes, resource: req.resource, name: req.client.name, via: viaOf(req.client), expires: now + CODE_TTL_MS });
    return withParams(req.redirectUri, { code, state: req.state, iss: issuer });
  }

  // ---- tokens

  /** The token endpoint (RFC 6749 §3.2): `authorization_code` with PKCE, and `refresh_token` with rotation. */
  async token(body: Record<string, unknown>, basic: Credentials | null, mcpUrl: string): Promise<TokenResponse> {
    const grantType = str(body['grant_type']);
    const clientId = basic?.id ?? str(body['client_id']);
    if (!clientId) throw new OAuthFailure('invalid_client', 'client_id is missing', 401);
    if (basic && str(body['client_id']) && str(body['client_id']) !== basic.id) throw new OAuthFailure('invalid_client', 'two different client ids', 401);
    let client: ClientInfo | null;
    try { client = await this.resolveClient(clientId); } catch (e) { throw new OAuthFailure('invalid_client', (e as Error).message, 401); }
    if (!client) throw new OAuthFailure('invalid_client', 'unknown client; add the app again', 401);
    await this.authenticate(client, body, basic);
    const resource = str(body['resource']);
    if (resource && !sameResource(resource, mcpUrl)) throw new OAuthFailure('invalid_target', `this server issues tokens only for ${mcpUrl}`);
    if (grantType === 'authorization_code') return this.redeem(client, body, mcpUrl);
    if (grantType === 'refresh_token') return this.refresh(client, body);
    throw new OAuthFailure('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
  }

  private async authenticate(client: ClientInfo, body: Record<string, unknown>, basic: Credentials | null): Promise<void> {
    if (body['client_assertion'] !== undefined) throw new OAuthFailure('invalid_client', 'private_key_jwt is not supported; sign in as a public client', 401);
    if (client.authMethod === 'none') return;
    const secret = basic?.secret ?? str(body['client_secret']);
    const stored = (await this.load()).clients.find((c) => c.id === client.id);
    if (!secret || !stored?.secretHash || !sameHex(sha(secret), stored.secretHash)) throw new OAuthFailure('invalid_client', 'client authentication failed', 401);
  }

  private async redeem(client: ClientInfo, body: Record<string, unknown>, mcpUrl: string): Promise<TokenResponse> {
    const code = str(body['code']);
    if (!code) throw new OAuthFailure('invalid_request', 'code is missing');
    const key = sha(code);
    const now = this.now();
    const pending = this.codes.get(key);
    if (!pending) {
      const spent = this.spent.get(key);
      if (spent && spent.until > now) await this.remove(spent.grantId);
      throw new OAuthFailure('invalid_grant', 'the code is unknown, used or expired; sign in again');
    }
    this.codes.delete(key);
    if (pending.expires <= now) throw new OAuthFailure('invalid_grant', 'the code expired; sign in again');
    if (pending.clientId !== client.id) throw new OAuthFailure('invalid_grant', 'the code was issued to another app');
    const redirect = str(body['redirect_uri']);
    if (redirect && redirect !== pending.redirectUri) throw new OAuthFailure('invalid_grant', 'redirect_uri differs from the one in the authorization request');
    if (!pkceMatches(str(body['code_verifier']) ?? '', pending.challenge)) throw new OAuthFailure('invalid_grant', 'the PKCE code_verifier does not match');

    const access = token('syn_at_');
    const refresh = token('syn_rt_');
    await this.ready();
    const f = this.cache!;
    const grant: StoredGrant = {
      id: randomBytes(9).toString('base64url'), kind: 'oauth', clientId: client.id, name: pending.name, via: pending.via,
      scopes: pending.scopes, resource: pending.resource || mcpUrl, createdAt: this.iso(), usedAt: this.iso(),
      access: { hash: sha(access), expires: now + ACCESS_TTL_MS }, refresh: { hash: sha(refresh), expires: now + REFRESH_TTL_MS },
    };
    let grants = [...f.grants, grant];
    if (grants.length > MAX_GRANTS) {
      const oldest = grants.filter((g) => g.kind === 'oauth' && g !== grant).sort((a, b) => (a.usedAt ?? a.createdAt).localeCompare(b.usedAt ?? b.createdAt))[0];
      if (oldest) grants = grants.filter((g) => g !== oldest);
    }
    const clients = f.clients.map((c) => (c.id === client.id ? { ...c, usedAt: this.iso() } : c));
    for (const [k, v] of this.spent) if (v.until <= now) this.spent.delete(k);
    this.spent.set(key, { grantId: grant.id, until: pending.expires });
    await this.save({ ...f, clients, grants });
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope: grant.scopes.join(' ') };
  }

  private async refresh(client: ClientInfo, body: Record<string, unknown>): Promise<TokenResponse> {
    const presented = str(body['refresh_token']);
    if (!presented) throw new OAuthFailure('invalid_request', 'refresh_token is missing');
    const h = sha(presented);
    const now = this.now();
    await this.ready();
    const f = this.cache!;
    const grant = f.grants.find((g) => g.kind === 'oauth' && g.clientId === client.id && ((g.refresh && sameHex(g.refresh.hash, h)) || (g.previousRefresh && g.previousRefresh.until > now && sameHex(g.previousRefresh.hash, h))));
    if (!grant?.refresh) throw new OAuthFailure('invalid_grant', 'the refresh token is not valid; connect the app again');
    if (grant.refresh.expires <= now) {
      await this.save({ ...f, grants: f.grants.filter((g) => g !== grant) });
      throw new OAuthFailure('invalid_grant', 'the connection expired; connect the app again');
    }
    const asked = str(body['scope']);
    if (asked && asked.split(/\s+/).some((s) => !(grant.scopes as string[]).includes(s))) throw new OAuthFailure('invalid_scope', 'the refresh token does not cover that scope');
    const current = sameHex(grant.refresh.hash, h);
    const access = token('syn_at_');
    const refresh = token('syn_rt_');
    const next: StoredGrant = {
      ...grant, usedAt: this.iso(),
      access: { hash: sha(access), expires: now + ACCESS_TTL_MS },
      refresh: { hash: sha(refresh), expires: now + REFRESH_TTL_MS },
      previousRefresh: current ? { hash: grant.refresh.hash, until: now + REFRESH_GRACE_MS } : grant.previousRefresh!,
    };
    await this.save({ ...f, grants: f.grants.map((g) => (g === grant ? next : g)) });
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope: grant.scopes.join(' ') };
  }

  /** Token revocation (RFC 7009): an access or refresh token ends its connection; unknown tokens are not an error. */
  async revokeToken(presented: string): Promise<void> {
    const h = sha(presented);
    await this.ready();
    const f = this.cache!;
    const grant = f.grants.find((g) => (g.access && sameHex(g.access.hash, h)) || (g.refresh && sameHex(g.refresh.hash, h)));
    if (grant) await this.save({ ...f, grants: f.grants.filter((g) => g !== grant) });
  }

  // ---- the MCP endpoint

  /** The bearer token of an MCP request: a live access token for this resource or a personal key, else null. */
  async verifyAccess(presented: string, mcpUrl: string): Promise<AuthInfo | null> {
    if (!/^syn_(at|key)_[A-Za-z0-9_-]{40,}$/.test(presented)) return null;
    const h = sha(presented);
    const now = this.now();
    await this.ready();
    const f = this.cache!;
    const grant = f.grants.find((g) => (g.access && sameHex(g.access.hash, h)) || (g.key && sameHex(g.key.hash, h)));
    if (!grant) return null;
    let expiresAt: number;
    if (grant.kind === 'key') expiresAt = Math.floor((now + ACCESS_TTL_MS) / 1000);
    else {
      if (!grant.access || grant.access.expires <= now || !sameResource(grant.resource, mcpUrl)) return null;
      expiresAt = Math.floor(grant.access.expires / 1000);
    }
    if (!grant.usedAt || now - Date.parse(grant.usedAt) > TOUCH_MS) void this.save({ ...f, grants: f.grants.map((g) => (g === grant ? { ...g, usedAt: this.iso() } : g)) });
    return { token: presented, clientId: grant.clientId ?? `key:${grant.id}`, scopes: [...grant.scopes], expiresAt, resource: new URL(mcpUrl), extra: { grantId: grant.id, name: grant.name } };
  }

  // ---- Settings

  async list(): Promise<ConnectionView[]> {
    return (await this.load()).grants
      .map((g) => ({ id: g.id, kind: g.kind, name: g.name, via: g.via, write: g.scopes.includes('synapse:write'), createdAt: g.createdAt, usedAt: g.usedAt, ...(g.key ? { hint: g.key.hint } : {}) }))
      .sort((a, b) => (b.usedAt ?? b.createdAt).localeCompare(a.usedAt ?? a.createdAt));
  }

  /** A personal key for apps that take a bearer token instead of signing in; returned once, kept as its hash. */
  async createKey(name: string, write: boolean): Promise<{ key: string; connection: ConnectionView }> {
    await this.ready();
    const f = this.cache!;
    if (f.grants.length >= MAX_GRANTS) throw new OAuthFailure('invalid_request', 'too many connections; remove some first');
    const key = token('syn_key_');
    const grant: StoredGrant = {
      id: randomBytes(9).toString('base64url'), kind: 'key', clientId: null, name: cleanName(name, 'Key'), via: 'key',
      scopes: write ? ['synapse:read', 'synapse:write'] : ['synapse:read'], resource: '', createdAt: this.iso(), usedAt: null,
      key: { hash: sha(key), hint: key.slice(-4) },
    };
    await this.save({ ...f, grants: [...f.grants, grant] });
    const connection = (await this.list()).find((c) => c.id === grant.id)!;
    return { key, connection };
  }

  /** Disconnects one app or deletes one key; its tokens stop working at once. */
  async remove(id: string): Promise<boolean> {
    await this.ready();
    const f = this.cache!;
    if (!f.grants.some((g) => g.id === id)) return false;
    await this.save({ ...f, grants: f.grants.filter((g) => g.id !== id) });
    return true;
  }

  /** Every connection and key ends (a new password signs everything out). */
  async removeAll(): Promise<void> {
    await this.ready();
    const f = this.cache!;
    this.codes.clear();
    if (f.grants.length) await this.save({ ...f, grants: [] });
  }
}
