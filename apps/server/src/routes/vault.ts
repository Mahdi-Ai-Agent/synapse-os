import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { EngineId } from '@synapse/brain';
import { createVault, seedSampleVault } from '@synapse/vault-template';
import type { Ctx } from '../context';
import { pickDefaultEffort } from '../settings';
import { DRAFT_KEYS, DRAFT_MAX, DraftsStore } from '../drafts';

export async function vaultRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/api/vault', async () => ({
    exists: ctx.vault.exists,
    path: ctx.config.vaultPath,
    stats: ctx.vault.stats(),
    settings: await ctx.settings.public(),
    busy: ctx.runner.busy,
  }));

  app.post('/api/vault/create', async (req) => {
    const body = z.object({ sample: z.boolean().optional() }).parse(req.body ?? {});
    if (!ctx.vault.exists) {
      if (body.sample) await seedSampleVault(ctx.config.vaultPath);
      else await createVault(ctx.config.vaultPath);
      await ctx.vault.start();
      await ctx.git.ensureRepo();
      await ctx.runner.load();
    }
    return { exists: ctx.vault.exists, path: ctx.config.vaultPath, stats: ctx.vault.stats() };
  });

  /** Erase everything the user put in (Settings → Erase everything); `confirm` is the word the dialog asked for. */
  app.post('/api/vault/reset', async (req, reply) => {
    const body = z.object({ confirm: z.string().max(40) }).parse(req.body ?? {});
    if (!['ERASE', 'پاک کن'].includes(body.confirm.trim())) return reply.code(400).send({ error: { message: 'confirm with the word the dialog asked for' } });
    if (ctx.runner.busy) return reply.code(409).send({ error: { message: 'the brain is busy; wait for the run to finish' } });
    await ctx.vault.eraseAll();
    await ctx.git.reinit();
    ctx.runner.forgetThreads();
    await ctx.layout.reset();
    return { ok: true };
  });

  app.get('/api/graph', async (_req, reply) => {
    const g = ctx.vault.graph;
    if (!g) return reply.code(404).send({ error: { message: 'vault not loaded' } });
    return g;
  });

  app.get<{ Params: { type: string } }>('/api/index/:type', async (req, reply) => {
    const md = ctx.vault.getIndex(req.params.type);
    if (md === undefined) return reply.code(404).send({ error: { message: 'index not found' } });
    return reply.type('text/markdown; charset=utf-8').send(md);
  });

  /** The brain's memory files the UI shows: the owner's profile, the latest insights (`/insight`) and the focus list (`/review`). */
  app.get<{ Params: { name: string } }>('/api/memory/:name', async (req, reply) => {
    if (req.params.name !== 'profile' && req.params.name !== 'insights' && req.params.name !== 'focus') return reply.code(404).send({ error: { message: 'unknown memory file' } });
    const text = await ctx.vault.readMemory(req.params.name);
    if (text === null) return reply.code(404).send({ error: { message: 'not written yet' } });
    return reply.type('text/markdown; charset=utf-8').send(text);
  });

  /**
   * One category's or map's analysis (UI-DESIGN "Places"): `path` is the file `/insight [[Place]] → <path>` writes,
   * `text` its Markdown, null until written.
   */
  app.get<{ Params: { id: string } }>('/api/places/:id/analysis', async (req, reply) => {
    const node = ctx.vault.getNode(req.params.id);
    if (!node || (node.fm.type !== 'area' && node.fm.type !== 'map')) return reply.code(404).send({ error: { message: 'not a category or a map' } });
    return { path: ctx.vault.placeAnalysisPath(node.fm.title), text: await ctx.vault.readPlaceAnalysis(node.fm.title) };
  });

  app.get<{ Querystring: { q?: string; limit?: string } }>('/api/search', async (req) => {
    const q = req.query.q ?? '';
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 100);
    return { q, hits: ctx.vault.search(q, limit) };
  });

  const drafts = new DraftsStore(ctx.vault.root);
  app.get('/api/drafts', async () => ({ drafts: await drafts.all() }));
  app.put<{ Params: { key: string } }>('/api/drafts/:key', async (req, reply) => {
    const key = z.enum(DRAFT_KEYS).safeParse(req.params.key);
    const body = z.object({ text: z.string().max(DRAFT_MAX * 2) }).safeParse(req.body);
    if (!key.success || !body.success) return reply.code(400).send({ error: { message: 'unknown draft or bad text' } });
    await drafts.set(key.data, body.data.text);
    return { ok: true };
  });

  app.get('/api/settings', async () => ctx.settings.public());

  /**
   * `engine` selects the brain; `model`/`effort` set the selected engine's defaults; `engines[id]` sets any engine's;
   * `apiKeys[provider]` stores (string) or removes (null/empty) a key. Stored keys come back masked.
   */
  app.put('/api/settings', async (req, reply) => {
    const patch = z.object({
      engine: z.string().optional(),
      model: z.string().optional(),
      effort: z.string().optional(),
      locale: z.enum(['fa', 'en']).optional(),
      graph: z.object({ showDone: z.boolean().optional(), showTags: z.boolean().optional(), mode: z.enum(['2d', '3d']).optional() }).partial().optional(),
      engines: z.record(z.string(), z.object({ model: z.string().optional(), effort: z.string().optional() })).optional(),
      apiKeys: z.record(z.enum(['anthropic', 'openai', 'openrouter']), z.string().max(512).nullable()).optional(),
      server: z.object({ lanAccess: z.boolean().optional() }).optional(),
      automation: z.object({
        review: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
        daily: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
        weekly: z.object({ day: z.number().int().min(0).max(6), time: z.string().regex(/^\d{2}:\d{2}$/) }).nullable().optional(),
      }).optional(),
    }).parse(req.body ?? {});
    const current = await ctx.settings.get();
    // LAN access is the desktop's call: a paired phone could otherwise lock itself (or others) in or out.
    const lanAccess = patch.server?.lanAccess;
    if (lanAccess !== undefined && lanAccess !== current.server.lanAccess && !req.fromLoopback) {
      return reply.code(403).send({ error: { message: 'LAN access can only be changed from the desktop' } });
    }
    if (patch.engine !== undefined && !ctx.engines.has(patch.engine as EngineId)) {
      return reply.code(400).send({ error: { message: `unknown engine "${patch.engine}"; known: ${[...ctx.engines.keys()].join(', ')}` } });
    }
    const engineId = patch.engine ?? current.engine;
    const engine = ctx.engines.get(engineId as EngineId);
    const engines: Record<string, { model?: string; effort?: string }> = { ...(patch.engines ?? {}) };
    const own: { model?: string; effort?: string } = { ...(current.engines[engineId] ?? {}), ...(engines[engineId] ?? {}) };
    if (patch.model !== undefined) own.model = patch.model;
    if (patch.effort !== undefined) own.effort = patch.effort;
    if (own.model === undefined && engine) own.model = engine.models()[0]?.id ?? '';
    if (own.effort === undefined && engine) own.effort = pickDefaultEffort(engine.efforts());
    engines[engineId] = own;
    const { engines: _e, model: _m, effort: _f, ...rest } = patch;
    await ctx.settings.update({ ...rest, engine: engineId, model: own.model ?? '', effort: own.effort ?? '', engines });
    if (lanAccess !== undefined && ctx.listener && lanAccess !== ctx.listener.lan && !ctx.listener.pinned) {
      // Re-bind after this response is on the wire; the UI's WebSocket reconnects by itself.
      setTimeout(() => { ctx.listener?.setLanAccess(lanAccess).catch((err: unknown) => app.log.error({ err }, 'LAN re-bind failed; restart the server to apply the setting')); }, 100);
    }
    return ctx.settings.public();
  });
}
