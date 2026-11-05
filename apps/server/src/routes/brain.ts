import { existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiEngine, BRAIN_MODES, maskKey, type EngineId } from '@synapse/brain';
import type { Ctx } from '../context';
import { pickDefaultEffort } from '../settings';

export async function brainRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get<{ Querystring: { force?: string } }>('/api/engines', async (req) => {
    const force = req.query.force === '1' || req.query.force === 'true';
    const settings = await ctx.settings.get();
    const list = await Promise.all(
      [...ctx.engines.values()].map(async (e) => {
        const defaults = ctx.settings.defaultsFor(settings, e.id);
        const key = e instanceof ApiEngine ? await e.resolveKey() : null;
        return {
          id: e.id,
          name: e.name,
          auth: e.auth,
          keyEnv: e.keyEnv ?? null,
          key: key ? { source: key.source, masked: maskKey(key.key) } : null,
          probe: await e.probe(force),
          models: e.models(),
          efforts: e.efforts(),
          canFetchModels: typeof e.fetchModels === 'function',
          /** The app can run this CLI's own sign-in (Settings → Brain). */
          signIn: e.signIn?.flow ?? null,
          defaults: { model: defaults.model ?? e.models()[0]?.id ?? '', effort: defaults.effort ?? pickDefaultEffort(e.efforts()) },
          selected: e.id === settings.engine,
        };
      }),
    );
    // On the owner's own computer the CLIs are the ones its desktop apps sign in (Settings shows them so); in a container
    // they are signed in from the app (docs/BRAIN-ENGINES.md "On a desktop").
    const place = ctx.config.trustLoopback === false || existsSync('/.dockerenv') ? 'server' : 'desktop';
    return { engines: list, busy: ctx.runner.busy, place };
  });

  app.get<{ Params: { id: string }; Querystring: { refresh?: string } }>('/api/engines/:id/models', async (req, reply) => {
    const engine = ctx.engines.get(req.params.id as EngineId);
    if (!engine) return reply.code(404).send({ error: { message: `unknown engine "${req.params.id}"` } });
    if (!engine.fetchModels) return { models: engine.models(), live: false };
    try {
      return { models: await engine.fetchModels(), live: true };
    } catch (err) {
      return reply.code(502).send({ error: { message: err instanceof Error ? err.message : String(err) } });
    }
  });

  app.post('/api/brain/run', async (req, reply) => {
    const body = z.object({
      prompt: z.string().min(1),
      mode: z.enum(BRAIN_MODES).default('chat'),
      threadId: z.string().optional(),
      engine: z.string().optional(),
      model: z.string().optional(),
      effort: z.string().optional(),
      focusId: z.string().optional(),
      view: z.string().optional(),
      locale: z.enum(['fa', 'en']).optional(),
      inboxPath: z.string().regex(/^nodes\/inbox\/[^/]+\.md$/).optional(),
      display: z.string().max(200).optional(),
      scope: z.string().max(64).optional(),
    }).parse(req.body ?? {});
    if (!ctx.vault.exists) return reply.code(409).send({ error: { message: 'vault not found' } });
    if (body.engine !== undefined && !ctx.engines.has(body.engine as EngineId)) {
      return reply.code(400).send({ error: { message: `unknown engine "${body.engine}"; known: ${[...ctx.engines.keys()].join(', ')}` } });
    }
    const { engine, ...rest } = body;
    const r = await ctx.runner.start({ ...rest, ...(engine ? { engine: engine as EngineId } : {}) });
    return reply.code(202).send(r);
  });

  app.post<{ Params: { runId: string } }>('/api/brain/cancel/:runId', async (req) => ({ cancelled: ctx.runner.cancel(req.params.runId) }));

  app.get('/api/brain/queue', async () => ctx.runner.queueState());

  app.get<{ Params: { runId: string } }>('/api/brain/runs/:runId', async (req, reply) => {
    const r = ctx.runner.getRun(req.params.runId);
    if (!r) return reply.code(404).send({ error: { message: 'run not found' } });
    return r;
  });

  app.get('/api/threads', async () => ({ threads: ctx.runner.listThreads() }));

  app.get<{ Params: { id: string } }>('/api/threads/:id', async (req, reply) => {
    const t = ctx.runner.getThread(req.params.id);
    if (!t) return reply.code(404).send({ error: { message: 'thread not found' } });
    return t;
  });

  app.patch<{ Params: { id: string } }>('/api/threads/:id', async (req) => {
    const body = z.object({ title: z.string().max(400) }).parse(req.body ?? {});
    const t = await ctx.runner.renameThread(req.params.id, body.title);
    return { id: t.id, title: t.title };
  });

  app.delete<{ Params: { id: string } }>('/api/threads/:id', async (req) => {
    await ctx.runner.deleteThread(req.params.id);
    return { ok: true };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/history', async (req) => ({ commits: await ctx.git.log(Math.min(Number(req.query.limit ?? 50) || 50, 200)) }));

  app.post<{ Params: { commit: string } }>('/api/history/undo/:commit', async (req, reply) => {
    if (!/^[0-9a-f]{7,40}$/i.test(req.params.commit)) return reply.code(400).send({ error: { message: 'bad commit hash' } });
    const r = await ctx.git.revert(req.params.commit);
    await ctx.vault.rebuildNow('undo');
    if (!r.ok) return reply.code(409).send({ error: { message: r.error ?? 'revert failed' } });
    return r;
  });
}
