import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context';

const point = z.array(z.number()).min(2).max(3);
const pointMap = z.record(z.string().max(200), point);

/** Saved graph layout (`.synapse/layout.json`) and link previews for resource cards (docs/ARCHITECTURE.md). */
export async function layoutRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/api/layout', async () => ctx.layout.get());

  // A save names the copy of the app it comes from and the `rev` its map was based on (docs/ARCHITECTURE.md
  // "Layout"). One based on an older layout is answered `{ok: false, stale: true}` — with a 200, because the CDN in
  // front of a deployment replaces 4xx bodies — and every save that is written is announced as `layout.saved`, so the
  // other open copies take it instead of keeping (and later saving) their older map. A save that names no base comes
  // from a copy of the app older than this rule (still open in a tab, re-saving its map on every live poll): refused
  // the same way, so it cannot put its old map back.
  app.put('/api/layout', async (req) => {
    const body = z.object({
      anchors: pointMap.optional(), pins: pointMap.optional(), positions: pointMap.optional(),
      room: z.record(z.string().max(200), z.number().min(0).max(100)).optional(), settled: z.boolean().optional(),
      base: z.number().int().min(0).optional(), client: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
    }).parse(req.body ?? {});
    const { base, client, ...patch } = body;
    if (base === undefined) return { ok: false, stale: true, rev: (await ctx.layout.get()).rev };
    const { stale, file } = await ctx.layout.put(patch, { base, ...(client ? { client } : {}) });
    if (stale) return { ok: false, stale: true, rev: file.rev };
    ctx.bus.broadcast('layout.saved', { rev: file.rev, client: client ?? null });
    return { ok: true, savedAt: file.savedAt, rev: file.rev };
  });

  app.delete('/api/layout', async () => {
    const file = await ctx.layout.reset();
    ctx.bus.broadcast('layout.saved', { rev: file.rev, client: null });
    return { ok: true, rev: file.rev };
  });

  app.get<{ Querystring: { url?: string } }>('/api/preview', async (req, reply) => {
    const url = z.string().url().max(2000).safeParse(req.query.url ?? '');
    if (!url.success) return reply.code(400).send({ error: { message: 'url must be an http(s) URL' } });
    return ctx.previews.preview(url.data);
  });
}
