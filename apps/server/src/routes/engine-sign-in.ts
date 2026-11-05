import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BrainEngine, EngineId } from '@synapse/brain';
import { HttpError, type Ctx } from '../context';

/**
 * Signing a vendor CLI in and out from Settings (docs/BRAIN-ENGINES.md "Sign-in from the app"); the CLI keeps the
 * credentials. Spec of the routes: docs/ARCHITECTURE.md.
 */
export async function engineSignInRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  const engineOf = (id: string): BrainEngine => {
    const e = ctx.engines.get(id as EngineId);
    if (!e) throw new HttpError(404, `unknown engine "${id}"`);
    return e;
  };

  app.post<{ Params: { id: string } }>('/api/engines/:id/sign-in', async (req) => ctx.signIns.start(engineOf(req.params.id)));

  app.get<{ Params: { id: string } }>('/api/engines/:id/sign-in', async (req) => ({ signIn: ctx.signIns.state(engineOf(req.params.id).id) }));

  app.post<{ Params: { id: string } }>('/api/engines/:id/sign-in/code', async (req) => {
    const body = z.object({ code: z.string().max(2000) }).parse(req.body ?? {});
    return ctx.signIns.paste(engineOf(req.params.id).id, body.code);
  });

  app.delete<{ Params: { id: string } }>('/api/engines/:id/sign-in', async (req) => {
    ctx.signIns.cancel(engineOf(req.params.id).id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/engines/:id/sign-out', async (req, reply) => {
    const engine = engineOf(req.params.id);
    if (ctx.runner.busy) return reply.code(409).send({ error: { message: 'the brain is busy; sign out when the run has finished' } });
    return { probe: await ctx.signIns.signOut(engine) };
  });
}
