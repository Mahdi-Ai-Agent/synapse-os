import type { FastifyInstance } from 'fastify';
import type { EngineId } from '@synapse/brain';
import { z } from 'zod';
import type { Ctx } from '../context';
import type { SettingsPatch } from '../settings';
import { BackupError, buildExport, countsOf, exportFileName, keepSafetyCopy, layoutOf, readExport, writeImport, type ReadExport } from '../backup';

const MAX_FILE = 256 * 1024 * 1024;

/** The preferences an export may carry; anything else in the manifest is ignored. */
const portableSettings = z.object({
  locale: z.enum(['fa', 'en']),
  graph: z.object({ showDone: z.boolean(), showTags: z.boolean(), mode: z.enum(['2d', '3d']) }).partial(),
  engine: z.string().max(40),
  engines: z.record(z.string().max(40), z.object({ model: z.string().max(80), effort: z.string().max(20) }).partial()),
}).partial();

/** Export and import of everything the owner put in (docs/ARCHITECTURE.md "Backup"). */
export async function backupRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/api/export', async (_req, reply) => {
    const { zip, manifest } = await buildExport(ctx.vault.root, await ctx.settings.get());
    return reply
      .header('content-type', 'application/zip')
      .header('content-disposition', `attachment; filename="${exportFileName(manifest.exportedAt)}"`)
      .send(Buffer.from(zip));
  });

  // The export arrives as the request body itself.
  app.addContentTypeParser(['application/zip', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: MAX_FILE }, (_req, body, done) => done(null, body));

  /**
   * `?check=1` only reads the file and says what it holds (the confirmation shows it); otherwise everything here is
   * replaced by it: a copy of what is here first goes to `.synapse/backups/` and into the vault's history, then the
   * items, memory, chats, layout, dismissed suggestions and preferences of the file take its place. API keys, the
   * account, pairing, connected apps and schedules stay as they are here.
   */
  app.post('/api/import', { bodyLimit: MAX_FILE }, async (req, reply) => {
    const q = z.object({ check: z.enum(['1', 'true']).optional() }).parse(req.query ?? {});
    if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ error: { message: 'send the export file as application/zip' } });
    let read: ReadExport;
    try { read = readExport(new Uint8Array(req.body)); } catch (err) {
      if (err instanceof BackupError) return reply.code(400).send({ error: { message: err.message } });
      throw err;
    }
    const counts = countsOf(read);
    if (q.check) return { ok: true, check: true, exportedAt: read.manifest.exportedAt, counts };
    if (ctx.runner.busy) return reply.code(409).send({ error: { message: 'the brain is busy; wait for the run to finish' } });

    const before = await buildExport(ctx.vault.root, await ctx.settings.get());
    const safetyCopy = await keepSafetyCopy(ctx.vault.root, before.zip);
    await ctx.git.snapshot('manual: edits');
    await ctx.vault.replaceAll(() => writeImport(ctx.vault.root, read));

    const prefs = portableSettings.safeParse(read.manifest.settings ?? {});
    if (prefs.success) {
      const p = prefs.data;
      const patch: SettingsPatch = {};
      if (p.locale) patch.locale = p.locale;
      if (p.graph) patch.graph = p.graph;
      if (p.engines) patch.engines = Object.fromEntries(Object.entries(p.engines).filter(([id]) => ctx.engines.has(id as EngineId)));
      // The file's engine is chosen only if this machine has it; its model and effort come along.
      const engine = p.engine ? ctx.engines.get(p.engine as EngineId) : undefined;
      if (engine && (await engine.probe()).installed) {
        const d = { ...(await ctx.settings.get()).engines[engine.id], ...(p.engines?.[engine.id] ?? {}) };
        patch.engine = engine.id;
        if (d.model) patch.model = d.model;
        if (d.effort) patch.effort = d.effort;
      }
      await ctx.settings.update(patch);
    }
    ctx.runner.forgetThreads();
    await ctx.runner.load();
    ctx.suggestions.forget();
    await ctx.layout.reset();
    const layout = layoutOf(read);
    const saved = layout ? (await ctx.layout.put(layout)).file : await ctx.layout.get();
    ctx.bus.broadcast('layout.saved', { rev: saved.rev, client: null });
    const commit = await ctx.git.snapshot(`import: ${counts.items} items, ${counts.chats} chats (exported ${read.manifest.exportedAt.slice(0, 10)})`);
    return { ok: true, exportedAt: read.manifest.exportedAt, counts, commit, safetyCopy };
  });
}
