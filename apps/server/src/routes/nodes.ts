import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { FACET_KEYS, NODE_TYPES, type NodeType } from '@synapse/core';
import type { Ctx } from '../context';

const frontmatterPatch = z.object({
  /** On `PUT`, a different kind moves the file to that kind's folder (VAULT-SPEC "Kinds"). */
  type: z.enum(NODE_TYPES).optional(),
  title: z.string().min(1).optional(),
  summary: z.string().max(160).optional(),
  status: z.string().optional(),
  tags: z.array(z.string()).optional(),
  aliases: z.array(z.string()).optional(),
  links: z.array(z.string()).optional(),
  area: z.string().optional(),
  project: z.string().optional(),
  people: z.array(z.string()).optional(),
  /** An area's map (`"[[Title]]"`, '' for the mind map) and a map's connections (`"[[Title]]"` or `mind`), VAULT-SPEC "Maps". */
  map: z.string().optional(),
  connects: z.array(z.string()).optional(),
  due: z.string().optional(),
  scheduled: z.string().optional(),
  priority: z.number().int().min(1).max(4).optional(),
  date: z.string().optional(),
  relation: z.string().optional(),
  url: z.string().optional(),
  source: z.enum(['capture', 'brain', 'manual', 'import']).optional(),
  color: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).or(z.literal('')).nullable().optional(),
  facets: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean(), z.array(z.string().max(40)).max(1000), z.null()])).optional(),
});

/** Kind fields a node of `type` may carry (VAULT-SPEC "Kinds"); anything else is refused. */
function checkFacets(type: NodeType, facets: Record<string, unknown> | undefined): string | null {
  if (!facets) return null;
  const allowed = new Set(FACET_KEYS[type] ?? []);
  const bad = Object.keys(facets).filter((k) => !allowed.has(k));
  return bad.length ? `fields not allowed for ${type}: ${bad.join(', ')}` : null;
}

export async function nodeRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/nodes/:id', async (req, reply) => {
    const detail = ctx.vault.getDetail(req.params.id);
    if (!detail) return reply.code(404).send({ error: { message: 'node not found' } });
    return detail;
  });

  app.put<{ Params: { id: string } }>('/api/nodes/:id', async (req, reply) => {
    const body = z.object({ frontmatter: frontmatterPatch.optional(), body: z.string().optional() }).parse(req.body ?? {});
    const current = ctx.vault.getNode(req.params.id);
    if (!current) return reply.code(404).send({ error: { message: 'node not found' } });
    const { type, ...frontmatter } = body.frontmatter ?? {};
    const patch = { ...body, frontmatter };
    const facetError = checkFacets(type ?? current.fm.type, frontmatter.facets);
    if (facetError) return reply.code(400).send({ error: { message: facetError } });
    if (type && type !== current.fm.type) {
      // The file moves to another folder: snapshot pending edits first, then commit the move on its own.
      await ctx.git.snapshot('manual: edits');
      const node = await ctx.vault.retypeNode(req.params.id, type, patch);
      await ctx.git.commitChanges(`manual: change kind ${current.fm.title} → ${type}`);
      return ctx.vault.getDetail(node.fm.id) ?? { node };
    }
    const title = frontmatter.title?.trim();
    if (title && title !== current.fm.title) {
      // A rename touches other files: snapshot pending edits first, then commit the rename on its own.
      await ctx.git.snapshot('manual: edits');
      const r = await ctx.vault.renameNode(req.params.id, title, patch);
      await ctx.git.commitChanges(`manual: rename ${current.fm.title} → ${title}`);
      return { ...(ctx.vault.getDetail(r.node.fm.id) ?? { node: r.node }), rewritten: r.rewritten };
    }
    const node = await ctx.vault.updateNode(req.params.id, patch);
    return ctx.vault.getDetail(node.fm.id) ?? { node };
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>('/api/nodes/:id/related', async (req, reply) => {
    if (!ctx.vault.getNode(req.params.id)) return reply.code(404).send({ error: { message: 'node not found' } });
    const limit = Math.min(Number(req.query.limit ?? 8) || 8, 30);
    const dismissed = await ctx.suggestions.dismissedFor(req.params.id);
    return { related: ctx.vault.related(req.params.id, limit, dismissed) };
  });

  app.post<{ Params: { id: string } }>('/api/nodes/:id/related/dismiss', async (req, reply) => {
    const body = z.object({ targetId: z.string().min(1) }).parse(req.body ?? {});
    if (!ctx.vault.getNode(req.params.id) || !ctx.vault.getNode(body.targetId)) return reply.code(404).send({ error: { message: 'node not found' } });
    await ctx.suggestions.dismiss(req.params.id, body.targetId);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/nodes/:id', async (req, reply) => {
    const node = ctx.vault.getNode(req.params.id);
    if (!node) return reply.code(404).send({ error: { message: 'node not found' } });
    await ctx.git.snapshot('manual: edits');
    // A map takes nothing with it: its categories go back to the mind map.
    if (node.fm.type === 'map') await ctx.vault.deleteMap(req.params.id); else await ctx.vault.deleteNode(req.params.id);
    const set = await ctx.git.commitChanges(`manual: delete ${node.fm.title}`);
    return { ok: true, commit: set.commit ?? null };
  });

  app.post<{ Params: { id: string } }>('/api/categories/:id/delete', async (req, reply) => {
    const body = z.object({ moveTo: z.string().min(1).nullable().optional() }).parse(req.body ?? {});
    const area = ctx.vault.getNode(req.params.id);
    if (!area || area.fm.type !== 'area') return reply.code(404).send({ error: { message: 'category not found' } });
    await ctx.git.snapshot('manual: edits');
    const r = await ctx.vault.deleteCategory(req.params.id, body.moveTo ?? null);
    const set = await ctx.git.commitChanges(`manual: delete category ${area.fm.title}`);
    return { ok: true, moved: r.moved.length, commit: set.commit ?? null };
  });

  app.post('/api/nodes', async (req, reply) => {
    const body = frontmatterPatch.extend({ type: z.enum(NODE_TYPES), title: z.string().min(1), body: z.string().optional() }).parse(req.body ?? {});
    const facetError = checkFacets(body.type, body.facets);
    if (facetError) return reply.code(400).send({ error: { message: facetError } });
    const node = await ctx.vault.createNode(body);
    return ctx.vault.getDetail(node.fm.id) ?? { node };
  });

  app.post('/api/capture', async (req) => {
    const body = z.object({ text: z.string().min(1) }).parse(req.body ?? {});
    const node = await ctx.vault.capture(body.text);
    return { node };
  });
}
