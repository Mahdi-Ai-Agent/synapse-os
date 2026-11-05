import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isLoopbackAddress } from './lan';
import { isLoopbackHost } from './public-url';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Set by the access guard: the request came from this machine — a loopback socket (when trusted) that names a
     * loopback `Host` — so it needs no pairing token.
     */
    fromLoopback: boolean;
  }
}

export interface Pairing {
  token: string;
  createdAt: string;
}

const sha256 = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();

/**
 * The one secret a phone presents: a 32-byte base64url token in `.synapse/pairing.json` (owner-only file),
 * generated on first use and rotatable from the desktop. Model: docs/ARCHITECTURE.md "Access control".
 */
export class PairingStore {
  private cache: Pairing | null = null;
  /** `pinned`: the token comes from `SYNAPSE_PAIR_TOKEN` (docs/DEPLOY.md) and cannot be rotated here. */
  constructor(private readonly root: string, private readonly pinned: string | null = null) {}

  get pinnedByEnv(): boolean { return this.pinned !== null; }

  get file(): string {
    return path.join(this.root, '.synapse', 'pairing.json');
  }

  async get(): Promise<Pairing> {
    if (this.pinned) return { token: this.pinned, createdAt: 'env' };
    if (this.cache) return this.cache;
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<Pairing>;
      if (typeof raw.token === 'string' && /^[A-Za-z0-9_-]{32,}$/.test(raw.token)) {
        this.cache = { token: raw.token, createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString() };
        await fs.chmod(this.file, 0o600).catch(() => undefined);
        return this.cache;
      }
    } catch { /* missing or unreadable: generate below */ }
    return this.rotate();
  }

  /** Replaces the token; every paired phone has to scan the QR code again. */
  async rotate(): Promise<Pairing> {
    if (this.pinned) throw new Error('the pairing token is set by SYNAPSE_PAIR_TOKEN; change it there and redeploy');
    const next: Pairing = { token: randomBytes(32).toString('base64url'), createdAt: new Date().toISOString() };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    await fs.chmod(this.file, 0o600).catch(() => undefined);
    this.cache = next;
    return next;
  }

  /** Constant-time comparison; hashing both sides first hides the length of the presented value. */
  async verify(presented: string | null | undefined): Promise<boolean> {
    if (!presented) return false;
    const { token } = await this.get();
    return timingSafeEqual(sha256(presented), sha256(token));
  }
}

/** Only the API and the WebSocket need a token; the static app shell is public code. */
/** API paths anyone may call: the health check and the way in (status, first-run setup, sign-in). */
const PUBLIC_API = new Set(['/api/health', '/api/auth/status', '/api/auth/setup', '/api/auth/login']);

export function isProtectedPath(url: string): boolean {
  const p = url.split('?')[0] ?? url;
  if (PUBLIC_API.has(p)) return false;
  return p === '/ws' || p === '/api' || p.startsWith('/api/');
}

export function bearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  const m = value ? /^Bearer\s+(\S+)\s*$/i.exec(value) : null;
  return m?.[1] ?? null;
}

export function queryToken(url: string): string | null {
  try {
    return new URL(url, 'http://local').searchParams.get('token');
  } catch { return null; }
}

/** `?token=…` never reaches the logs (request serializer and anything else that prints a URL). */
export function redactUrl(url: string): string {
  return url.replace(/([?&]token=)[^&#]*/gi, '$1[redacted]');
}

export interface AccessGuardOptions {
  pairing: PairingStore;
  /** Devices signed in with the owner's account (`auth.ts`). */
  sessions?: { verifySession(token: string | null | undefined): Promise<boolean> };
  /** False where loopback may be a proxy on the same host (a container): then loopback presents a token too. */
  trustLoopback?: boolean;
  /** Injectable for tests; production uses the socket's remote address (never `X-Forwarded-For`). */
  isLoopback?: (remoteAddress: string | undefined) => boolean;
}

/**
 * `onRequest` hook, for the API and the WebSocket upgrade alike. Loopback clients (the desktop) pass unless
 * `trustLoopback` is off, and only when their `Host` is a loopback name too: a web page whose own domain resolves to
 * 127.0.0.1 (DNS rebinding) arrives on a loopback socket but names its domain. Everyone else presents a signed-in
 * session or the pairing token: `Authorization: Bearer <token>` on the API, `?token=` on the WebSocket upgrade
 * (browsers cannot set upgrade headers).
 */
export function createAccessGuard(opts: AccessGuardOptions): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const isLoopback = opts.isLoopback ?? isLoopbackAddress;
  const trust = opts.trustLoopback ?? true;
  return async (req, reply) => {
    req.fromLoopback = trust && isLoopback(req.raw.socket?.remoteAddress ?? undefined) && isLoopbackHost(req.headers.host);
    const url = req.raw.url ?? req.url;
    if (req.fromLoopback || !isProtectedPath(url)) return;
    const presented = req.ws ? queryToken(url) : bearerToken(req.headers.authorization);
    if (opts.sessions && (await opts.sessions.verifySession(presented))) return;
    if (await opts.pairing.verify(presented)) return;
    await reply.code(401).header('www-authenticate', 'Bearer realm="synapse"').send({ error: { message: 'sign in required: open Synapse and sign in (or pair this device from the desktop)', requestId: req.id } });
  };
}
