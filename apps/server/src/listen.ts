import type { FastifyInstance } from 'fastify';
import type { Ctx, Listener } from './context';
import { bindsLan, resolveBindHost } from './lan';

const CLOSE_TIMEOUT_MS = 5000;

/**
 * Binds the server (loopback, or all interfaces when `server.lanAccess` is on / `SYNAPSE_HOST` says so) and lets
 * Settings re-bind at runtime: the http.Server is closed (open UIs reconnect their WebSocket) and listens again on
 * the other host without restarting the process.
 */
export async function startListening(app: FastifyInstance, ctx: Ctx): Promise<Listener> {
  const settings = await ctx.settings.get();
  const pinned = ctx.config.host;
  let host = resolveBindHost(pinned, settings.server.lanAccess);
  await app.listen({ host, port: ctx.config.port });
  const boundPort = (): number => {
    const a = app.server.address();
    return a && typeof a === 'object' ? a.port : ctx.config.port;
  };
  let rebinding: Promise<void> | null = null;

  const rebind = async (next: string): Promise<void> => {
    const server = app.server;
    const closed = new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    for (const client of app.websocketServer.clients) client.close(1012, 'rebinding');
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), 250).unref();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`listener did not close within ${CLOSE_TIMEOUT_MS} ms`)), CLOSE_TIMEOUT_MS); })]).finally(() => clearTimeout(timer));
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => { server.off('listening', onListening); reject(err); };
      const onListening = (): void => { server.off('error', onError); resolve(); };
      server.once('error', onError).once('listening', onListening);
      server.listen({ host: next, port: ctx.config.port });
    });
    host = next;
    app.log.info({ host, port: boundPort() }, 'synapse server re-bound');
  };

  const listener: Listener = {
    get host() { return host; },
    get port() { return boundPort(); },
    get lan() { return bindsLan(host); },
    get pinned() { return pinned !== null; },
    async setLanAccess(on) {
      if (pinned !== null) return;
      const next = resolveBindHost(null, on);
      if (next === host) return;
      if (rebinding) await rebinding;
      if (next === host) return;
      rebinding = rebind(next).finally(() => { rebinding = null; });
      await rebinding;
    },
  };
  ctx.listener = listener;
  return listener;
}
