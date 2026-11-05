import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Throttle } from '../auth';
import { AUTH_METHODS, AuthorizeFailure, OAuthFailure, SCOPES, type Credentials } from '../connections';
import type { Ctx } from '../context';
import { mcpUrlOf, publicOrigin } from '../public-url';

/**
 * Synapse as the OAuth 2.1 authorization server of its own MCP endpoint (docs/ARCHITECTURE.md "MCP connector"):
 * discovery (RFC 9728, RFC 8414), client registration (RFC 7591) beside client metadata documents, the consent page's
 * API, the token and revocation endpoints, and Settings → Connections. Discovery, registration and tokens are public;
 * the consent and Settings calls sit under `/api/` behind the owner's sign-in.
 */
export async function oauthRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  const originOf = (req: FastifyRequest): string => publicOrigin(req, ctx.config.publicUrl);
  const throttle = new Throttle(30, 300);
  const keyOf = (req: FastifyRequest): string => {
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    return first || req.raw.socket?.remoteAddress || '?';
  };
  const slowDown = (reply: FastifyReply, seconds: number): FastifyReply =>
    reply.code(429).header('retry-after', String(seconds)).send({ error: 'temporarily_unavailable', error_description: `too many requests; wait ${Math.ceil(seconds / 60)} min` });

  const resourceMetadata = async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const origin = originOf(req);
    return reply.header('access-control-allow-origin', '*').send({
      resource: mcpUrlOf(origin),
      authorization_servers: [origin],
      scopes_supported: [...SCOPES],
      bearer_methods_supported: ['header'],
      resource_name: 'Synapse',
    });
  };
  app.get('/.well-known/oauth-protected-resource', resourceMetadata);
  app.get('/.well-known/oauth-protected-resource/mcp', resourceMetadata);

  const serverMetadata = async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const origin = originOf(req);
    return reply.header('access-control-allow-origin', '*').send({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      scopes_supported: [...SCOPES],
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: [...AUTH_METHODS],
      revocation_endpoint_auth_methods_supported: [...AUTH_METHODS],
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  };
  app.get('/.well-known/oauth-authorization-server', serverMetadata);
  app.get('/.well-known/oauth-authorization-server/mcp', serverMetadata);

  app.post('/oauth/register', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const key = keyOf(req);
    const wait = throttle.wait(key);
    if (wait) return slowDown(reply, wait);
    throttle.fail(key); // every registration counts: an app registers once per connection
    try {
      return await reply.code(201).send(await ctx.connections.register(asRecord(req.body)));
    } catch (e) { return oauthError(reply, e); }
  });

  // The token and revocation endpoints take form bodies (RFC 6749 §4.1.3); the parser stays inside this scope.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(String(body))));
    });
    scope.post('/oauth/token', async (req, reply) => {
      reply.header('cache-control', 'no-store').header('pragma', 'no-cache');
      const key = keyOf(req);
      const wait = throttle.wait(key);
      if (wait) return slowDown(reply, wait);
      try {
        return await ctx.connections.token(asRecord(req.body), basicAuth(req.headers.authorization), mcpUrlOf(originOf(req)));
      } catch (e) {
        throttle.fail(key);
        return oauthError(reply, e);
      }
    });
    scope.post('/oauth/revoke', async (req, reply) => {
      const t = asRecord(req.body)['token'];
      if (typeof t === 'string' && t) await ctx.connections.revokeToken(t);
      return reply.code(200).send({});
    });
  });

  // ---- the consent page (`/oauth/authorize`, served by the web app) asks these behind the owner's sign-in

  const decision = z.object({ query: z.string().max(16_384), allow: z.boolean().optional(), write: z.boolean().optional() });
  const check = async (req: FastifyRequest, query: string) => {
    const origin = originOf(req);
    const q = Object.fromEntries(new URLSearchParams(query.replace(/^\?/, '')));
    return { origin, request: await ctx.connections.checkAuthorize(q, mcpUrlOf(origin), origin) };
  };
  const refuse = (reply: FastifyReply, e: unknown): FastifyReply => {
    if (e instanceof AuthorizeFailure) return reply.code(400).send({ error: { message: e.message, code: e.code, ...(e.redirect ? { redirect: e.redirect } : {}) } });
    throw e;
  };

  app.post('/api/oauth/request', async (req, reply) => {
    const body = decision.parse(req.body ?? {});
    try {
      const { request } = await check(req, body.query);
      const target = new URL(request.redirectUri);
      const local = target.protocol === 'http:';
      return {
        app: request.client.name,
        /** Where the answer goes: the host the owner must recognise (MCP authorization, "Localhost redirect URI risks"). */
        returnsTo: local ? 'localhost' : target.protocol === 'https:' ? target.hostname : target.protocol.replace(/:$/, ''),
        local,
        write: request.scopes.includes('synapse:write'),
        owner: await ctx.auth.username(),
      };
    } catch (e) { return refuse(reply, e); }
  });

  app.post('/api/oauth/decide', async (req, reply) => {
    const body = decision.parse(req.body ?? {});
    try {
      const { origin, request } = await check(req, body.query);
      const redirect = ctx.connections.decide(request, body.allow === true, body.write === true, origin);
      if (body.allow) req.log.info({ app: request.client.name, write: body.write === true }, 'mcp app connected');
      return { redirect };
    } catch (e) { return refuse(reply, e); }
  });

  // ---- Settings → Connections

  app.get('/api/connections', async (req) => ({ mcpUrl: mcpUrlOf(originOf(req)), connections: await ctx.connections.list() }));

  app.post('/api/connections/keys', async (req) => {
    const body = z.object({ name: z.string().min(1).max(80), write: z.boolean() }).parse(req.body ?? {});
    return ctx.connections.createKey(body.name, body.write);
  });

  app.delete<{ Params: { id: string } }>('/api/connections/:id', async (req, reply) => {
    if (!(await ctx.connections.remove(req.params.id))) return reply.code(404).send({ error: { message: 'no such connection' } });
    return { ok: true };
  });
}

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** `Authorization: Basic` client credentials, each form-encoded before base64 (RFC 6749 §2.3.1). */
export function basicAuth(header: string | undefined): Credentials | null {
  const m = header ? /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header) : null;
  if (!m?.[1]) return null;
  const raw = Buffer.from(m[1], 'base64').toString('utf8');
  const i = raw.indexOf(':');
  if (i < 0) return null;
  try {
    const dec = (s: string): string => decodeURIComponent(s.replace(/\+/g, ' '));
    return { id: dec(raw.slice(0, i)), secret: dec(raw.slice(i + 1)) };
  } catch { return null; }
}

function oauthError(reply: FastifyReply, e: unknown): FastifyReply {
  if (!(e instanceof OAuthFailure)) throw e;
  if (e.status === 401) reply.header('www-authenticate', 'Basic realm="synapse"');
  return reply.code(e.status).send({ error: e.code, error_description: e.message });
}
