import net from 'node:net';
import type { FastifyRequest } from 'fastify';

/**
 * The origin other apps reach this server at (docs/ARCHITECTURE.md "MCP connector"): `SYNAPSE_PUBLIC_URL` when set,
 * else the request's own host. A domain name is always `https` (a deployment is only reached over HTTPS,
 * docs/DEPLOY.md), so a proxy or CDN that talks plain HTTP to the container cannot turn the issuer into `http://`;
 * localhost, `.local` names and IP addresses keep the scheme the request came with.
 */
export function publicOrigin(req: FastifyRequest, configured?: string | null): string {
  if (configured) return configured;
  const host = cleanHost(first(req.headers['x-forwarded-host']) ?? req.headers.host);
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  const local = name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local') || net.isIP(name) !== 0;
  const proto = local ? (first(req.headers['x-forwarded-proto']) ?? req.protocol) : 'https';
  return `${proto === 'https' ? 'https' : 'http'}://${host}`;
}

/** The MCP endpoint's URL: the resource every token is issued for. */
export const mcpUrlOf = (origin: string): string => `${origin}/mcp`;

/** A Host header we can put into a URL as it is; anything else reads as `localhost`. */
function cleanHost(raw: string | undefined): string {
  const h = (raw ?? '').trim().toLowerCase();
  return /^[a-z0-9.-]+(:\d{1,5})?$/.test(h) || /^\[[0-9a-f:.]+\](:\d{1,5})?$/.test(h) ? h : 'localhost';
}

function first(v: string | string[] | undefined): string | undefined {
  const s = (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim();
  return s || undefined;
}

/** Hosts a browser on this machine uses for the app; a loopback request naming any other host may be DNS rebinding. */
export function isLoopbackHost(host: string | undefined): boolean {
  const name = (host ?? '').trim().toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return name === 'localhost' || name.endsWith('.localhost') || name === '127.0.0.1' || name === '::1';
}

/** `SYNAPSE_PUBLIC_URL`: an http(s) origin without a path; trailing slashes are dropped. */
export function parsePublicUrl(raw: string | undefined): string | null {
  const s = raw?.trim().replace(/\/+$/, '');
  if (!s) return null;
  let u: URL;
  try { u = new URL(s); } catch { throw new Error(`SYNAPSE_PUBLIC_URL is not a URL: ${s}`); }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.pathname !== '/' || u.search || u.hash || u.username) {
    throw new Error('SYNAPSE_PUBLIC_URL must be an origin such as https://synapse.example.com (no path)');
  }
  return u.origin;
}
