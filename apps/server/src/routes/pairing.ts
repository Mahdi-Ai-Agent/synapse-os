import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context';
import { lanAddresses } from '../lan';

/** Phone pairing: LAN URLs for everyone, the token (and rotation) only for the desktop. Spec: docs/ARCHITECTURE.md "Access control". */
export async function pairingRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/api/pairing', async (req) => {
    const settings = await ctx.settings.get();
    const port = ctx.listener?.port ?? ctx.config.port;
    const urls = lanAddresses().map((a) => `http://${a}:${port}`);
    const base = {
      lanAccess: settings.server.lanAccess,
      /** What the process is actually bound to right now (differs from `lanAccess` when `SYNAPSE_HOST` pins it). */
      bound: ctx.listener ? { host: ctx.listener.host, lan: ctx.listener.lan, pinned: ctx.listener.pinned } : null,
      port,
      urls,
      fromLoopback: req.fromLoopback,
    };
    if (!req.fromLoopback) return { ...base, token: null, createdAt: null, pairUrls: [] as string[] };
    const p = await ctx.pairing.get();
    return { ...base, token: p.token, createdAt: p.createdAt, pairUrls: urls.map((u) => `${u}/#pair=${p.token}`) };
  });

  app.post('/api/pairing/rotate', async (req, reply) => {
    if (!req.fromLoopback) return reply.code(403).send({ error: { message: 'the pairing token can only be rotated from the desktop' } });
    if (ctx.pairing.pinnedByEnv) return reply.code(409).send({ error: { message: 'the pairing token is set by SYNAPSE_PAIR_TOKEN; change it there and redeploy' } });
    const p = await ctx.pairing.rotate();
    return { token: p.token, createdAt: p.createdAt };
  });
}
