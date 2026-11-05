import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SCOPES } from '../connections';
import type { Ctx } from '../context';
import { accessOf, buildMcpServer } from '../mcp-tools';
import { bearerToken } from '../pairing';
import { mcpUrlOf, publicOrigin } from '../public-url';

/**
 * The MCP endpoint (docs/ARCHITECTURE.md "MCP connector"): Streamable HTTP at `/mcp`, stateless, for 2026-07-28 and
 * 2025-era clients alike (the SDK serves both). Every request presents a token from `/oauth/token` or a personal
 * key; a desktop app on this machine may call without one (`req.fromLoopback`: the access guard's loopback check,
 * which also demands a loopback Host header so a web page cannot reach it through DNS rebinding). Without a token
 * the answer is the `401` challenge that starts an app's sign-in.
 */
export async function mcpRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  const handler = createMcpHandler(({ authInfo }) => buildMcpServer(ctx, accessOf(authInfo)), {
    responseMode: 'json',
    onerror: (err) => app.log.warn({ err: err.message }, 'mcp request failed'),
  });
  app.addHook('onClose', async () => { await handler.close(); });

  const challenge = (reply: FastifyReply, origin: string, invalid: boolean): FastifyReply => {
    const parts = [`resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`, `scope="${SCOPES.join(' ')}"`];
    if (invalid) parts.push('error="invalid_token"', 'error_description="the token is not valid or has expired"');
    return reply.code(401).header('www-authenticate', `Bearer ${parts.join(', ')}`)
      .send({ error: { message: 'connect this app to Synapse first: your AI app opens the Synapse sign-in when you add it' } });
  };

  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    handler: async (req, reply) => {
      const origin = publicOrigin(req, ctx.config.publicUrl);
      const resource = mcpUrlOf(origin);
      const presented = bearerToken(req.headers.authorization);
      let auth: AuthInfo | null = null;
      if (presented) auth = await ctx.connections.verifyAccess(presented, resource);
      else if (req.fromLoopback) {
        auth = { token: 'loopback', clientId: 'loopback', scopes: [...SCOPES], expiresAt: Math.floor(Date.now() / 1000) + 3600, resource: new URL(resource), extra: { name: 'local app' } };
      }
      if (!auth) return challenge(reply, origin, Boolean(presented));
      const res = await handler.fetch(toRequest(req, resource), { authInfo: auth });
      reply.code(res.status);
      res.headers.forEach((value, name) => { if (!HOP.has(name)) reply.header(name, value); });
      return reply.send(res.body ? Readable.fromWeb(res.body as unknown as NodeReadableStream) : '');
    },
  });
}

const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'upgrade']);

/** The Fastify request as the web-standard `Request` the SDK's handler takes (the JSON body was parsed already). */
function toRequest(req: FastifyRequest, url: string): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || HOP.has(k) || k === 'host') continue;
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else headers.set(k, String(v));
  }
  const init: RequestInit = { method: req.method, headers };
  if (req.method === 'POST') init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
  return new Request(url, init);
}
