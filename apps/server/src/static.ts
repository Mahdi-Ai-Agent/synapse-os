import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from './context';
import { isProtectedPath, queryToken } from './pairing';

/**
 * Serves the built web UI (`apps/web/dist`) from the same origin as the API so a phone opens one URL.
 * SPA fallback: unknown GET paths that accept HTML get `index.html`; `/api/*` and `/ws` are never touched.
 * Returns false (and serves a hint at `/`) when the UI has not been built.
 */
export async function registerWebApp(app: FastifyInstance, ctx: Ctx): Promise<boolean> {
  const dist = ctx.config.webDist;
  if (!existsSync(path.join(dist, 'index.html'))) {
    app.get('/', async (_req, reply) => reply.type('text/plain; charset=utf-8').send(`Synapse: the web UI is not built (${dist}). Run \`pnpm build\` first, or use \`pnpm dev\`.\n`));
    return false;
  }

  await app.register(fastifyStatic, {
    root: dist,
    prefix: '/',
    index: ['index.html'],
    cacheControl: false, // set below per path
    setHeaders(res, filePath) {
      // Vite hashes everything under assets/; the shell files must revalidate so a new build reaches installed apps.
      res.setHeader('cache-control', filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });

  /**
   * The manifest is static except for `start_url`: a paired client asks for it with `?token=` and gets a start URL
   * carrying the token, so a home-screen app (separate storage on iOS) pairs itself on first launch.
   */
  app.get('/manifest.webmanifest', async (req, reply) => {
    const manifest = JSON.parse(await fs.readFile(path.join(dist, 'manifest.webmanifest'), 'utf8')) as Record<string, unknown>;
    const token = queryToken(req.raw.url ?? req.url);
    if (token && (await ctx.pairing.verify(token))) manifest['start_url'] = `/#pair=${token}`;
    return reply.type('application/manifest+json; charset=utf-8').header('cache-control', 'no-cache').send(JSON.stringify(manifest));
  });

  app.setNotFoundHandler(async (req, reply) => {
    const wantsHtml = (req.headers.accept ?? '').includes('text/html');
    if (req.method === 'GET' && wantsHtml && !isProtectedPath(req.url)) return reply.header('cache-control', 'no-cache').sendFile('index.html');
    return reply.code(404).send({ error: { message: `not found: ${req.method} ${req.url.split('?')[0]}` } });
  });
  return true;
}
