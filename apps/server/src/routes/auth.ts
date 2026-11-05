import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sameSetupCode, Throttle } from '../auth';
import type { Ctx } from '../context';
import { bearerToken } from '../pairing';

/**
 * The owner's account: status, first-run setup, sign-in, sign-out, password change.
 * Spec: docs/ARCHITECTURE.md "Access control". Status, setup and login are public; the rest needs a token.
 */
export async function authRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  const throttle = new Throttle();
  const tokenOf = (req: FastifyRequest): string | null => bearerToken(req.headers.authorization);
  const agentOf = (req: FastifyRequest): string => String(req.headers['user-agent'] ?? '');
  const keyOf = (req: FastifyRequest): string => {
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    return first || req.raw.socket?.remoteAddress || '?';
  };
  const tooMany = (reply: FastifyReply, seconds: number): FastifyReply =>
    reply.code(429).header('retry-after', String(seconds)).send({ error: { message: `too many tries; wait ${Math.ceil(seconds / 60)} min` } });

  app.get('/api/auth/status', async (req) => {
    const account = await ctx.auth.hasAccount();
    const token = tokenOf(req);
    const session = await ctx.auth.verifySession(token);
    const paired = !session && (await ctx.pairing.verify(token));
    const authenticated = req.fromLoopback || session || paired;
    return {
      account,
      authenticated,
      /** This client is signed in with the account (it can sign out). */
      session,
      username: authenticated ? await ctx.auth.username() : null,
      /** The first-run setup asks for the code from the server log unless this client is the desktop or paired. */
      needsCode: !account && !(req.fromLoopback || paired),
    };
  });

  app.post('/api/auth/setup', async (req, reply) => {
    const body = z.object({ username: z.string().max(200), password: z.string().max(1000), code: z.string().max(64).optional() }).parse(req.body ?? {});
    if (await ctx.auth.hasAccount()) return reply.code(409).send({ error: { message: 'an account exists already; sign in instead' } });
    const key = keyOf(req);
    const wait = throttle.wait(key);
    if (wait) return tooMany(reply, wait);
    const code = await ctx.auth.currentSetupCode();
    const allowed = req.fromLoopback || (await ctx.pairing.verify(tokenOf(req))) || Boolean(code && body.code && sameSetupCode(body.code, code));
    if (!allowed) {
      throttle.fail(key);
      return reply.code(403).send({ error: { message: 'wrong setup code: it is in the server log, on the line with "setup code"' } });
    }
    const token = await ctx.auth.create(body.username, body.password, agentOf(req));
    req.log.info('account created');
    return { token, username: await ctx.auth.username() };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ username: z.string().max(200), password: z.string().max(1000) }).parse(req.body ?? {});
    const key = keyOf(req);
    const wait = throttle.wait(key);
    if (wait) return tooMany(reply, wait);
    const token = await ctx.auth.login(body.username, body.password, agentOf(req));
    if (!token) {
      throttle.fail(key);
      return reply.code(401).send({ error: { message: 'wrong username or password' } });
    }
    throttle.clear(key);
    return { token, username: await ctx.auth.username() };
  });

  app.post('/api/auth/logout', async (req) => {
    const token = tokenOf(req);
    if (token) await ctx.auth.revoke(token);
    return { ok: true };
  });

  app.post('/api/auth/password', async (req, reply) => {
    const body = z.object({ current: z.string().max(1000), next: z.string().max(1000) }).parse(req.body ?? {});
    const key = keyOf(req);
    const wait = throttle.wait(key);
    if (wait) return tooMany(reply, wait);
    const token = await ctx.auth.changePassword(body.current, body.next, agentOf(req));
    if (!token) {
      throttle.fail(key);
      return reply.code(403).send({ error: { message: 'the current password is wrong' } });
    }
    // A new password signs everything out: the devices (above) and the apps connected over MCP with their keys.
    await ctx.connections.removeAll();
    return { token };
  });
}
