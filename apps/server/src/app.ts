import { randomBytes } from 'node:crypto';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import { createEngines } from '@synapse/brain';
import { syncAgentLayer } from '@synapse/vault-template';
import { AuthStore } from './auth';
import { Automation } from './automation';
import { BrainRunner, type RunTiming } from './brain-runner';
import { CliSignIns } from './cli-sign-in';
import { ConnectionsStore } from './connections';
import { ServerDiagnostics } from './diagnostics';
import type { ServerConfig } from './config';
import { HttpError, type Ctx } from './context';
import { isLoopbackAddress } from './lan';
import { PairingStore, createAccessGuard, redactUrl, type AccessGuardOptions } from './pairing';
import { LayoutStore } from './layout-store';
import { LinkPreviewer } from './link-preview';
import { authRoutes } from './routes/auth';
import { brainRoutes } from './routes/brain';
import { engineSignInRoutes } from './routes/engine-sign-in';
import { layoutRoutes } from './routes/layout';
import { backupRoutes } from './routes/backup';
import { mcpRoutes } from './routes/mcp';
import { nodeRoutes } from './routes/nodes';
import { oauthRoutes } from './routes/oauth';
import { pairingRoutes } from './routes/pairing';
import { vaultRoutes } from './routes/vault';
import { SettingsStore } from './settings';
import { registerWebApp } from './static';
import { SuggestionsStore } from './suggestions';
import { VaultGit } from './vault-git';
import { VaultService } from './vault-service';
import { Broadcaster } from './ws';

/** A run that waits this long for the engine's first event or first output is recorded in Diagnostics as `SLOW-<run>`. */
const SLOW_START_MS = 20_000;

export interface BuildOptions {
  /** Test hook for the access guard (which remote addresses count as this machine). */
  isLoopback?: AccessGuardOptions['isLoopback'];
  /** Serve `config.webDist` at `/` (default true; tests turn it off). */
  serveWeb?: boolean;
  /** Start the scheduled reviews (default true; tests turn it off). */
  automation?: boolean;
}

/** Cross-origin callers are only the Vite dev server on this machine; the built UI is same-origin and needs no CORS. */
export function isTrustedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host.endsWith('.localhost') || isLoopbackAddress(host.replace(/^\[|\]$/g, ''));
  } catch { return false; }
}

export async function buildApp(config: ServerConfig, options: BuildOptions = {}): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  const app = Fastify({
    // Request ids are short and random, and every response carries its own (`x-request-id`): an error code the user
    // reads off the screen finds the matching log line (docs/ARCHITECTURE.md "Diagnostics").
    genReqId: () => randomBytes(4).toString('hex'),
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      // The pairing token travels as `?token=` on WebSocket upgrades: keep it out of the request log.
      serializers: { req: (req) => ({ method: req.method, url: redactUrl(req.url ?? ''), remoteAddress: req.socket?.remoteAddress }) },
    },
  });
  await app.register(cors, { origin: (origin, cb) => cb(null, isTrustedOrigin(origin)) });
  await app.register(websocket);

  const vault = new VaultService(config.vaultPath);
  await vault.start();
  const git = new VaultGit(config.vaultPath);
  if (vault.exists) {
    await git.ensureRepo();
    // The vault's agent layer (skills, rules, hooks) ships with the app; keep existing vaults current.
    const synced = await syncAgentLayer(config.vaultPath);
    if (synced.length) { app.log.info({ synced }, 'vault agent layer updated from the template'); await git.snapshot('manual: update agent layer'); }
  }
  const settings = new SettingsStore(config.vaultPath);
  const suggestions = new SuggestionsStore(config.vaultPath);
  const pairing = new PairingStore(config.vaultPath, config.pairToken ?? null);
  const auth = new AuthStore(config.vaultPath);
  const connections = new ConnectionsStore(config.vaultPath);
  const layout = new LayoutStore(config.vaultPath);
  const previews = new LinkPreviewer(config.vaultPath);
  const engines = createEngines({ keys: (provider) => settings.keyFor(provider) });
  const runner = new BrainRunner(vault, git, engines, settings, { privateSessions: config.privateSessions === true });
  if (vault.exists) await runner.load();
  const automation = new Automation(config.vaultPath, settings, runner, engines, (msg, data) => app.log.info(data ?? {}, msg));
  if (vault.exists && (options.automation ?? true)) automation.start(config.automationDelayMs ?? 0);
  const bus = new Broadcaster();
  if (vault.exists) await pairing.get(); // the token exists from the first start on, so Settings → Phone is stable
  const signIns = new CliSignIns();
  const diag = new ServerDiagnostics();
  const ctx: Ctx = { config, vault, git, settings, suggestions, pairing, auth, connections, layout, previews, engines, signIns, runner, bus, diag, listener: null };

  // Access control (docs/ARCHITECTURE.md): loopback passes (unless the config distrusts it), every other client
  // presents a signed-in session or the pairing token.
  app.decorateRequest('fromLoopback', false);
  app.addHook('onRequest', createAccessGuard({ pairing, sessions: auth, trustLoopback: config.trustLoopback ?? true, ...(options.isLoopback ? { isLoopback: options.isLoopback } : {}) }));

  // Nothing under /api (nor MCP, OAuth or its discovery) may be kept by a browser or by a CDN in front of the server:
  // some cache JSON unless told not to, and a stale account status or sign-in state breaks the way in
  // (docs/ARCHITECTURE.md "Access control").
  app.addHook('onSend', async (req, reply, payload) => {
    const url = req.raw.url ?? '';
    if (url.startsWith('/api/') || url.startsWith('/mcp') || url.startsWith('/oauth/') || url.startsWith('/.well-known/')) reply.header('cache-control', 'no-store');
    reply.header('x-request-id', req.id);
    return payload;
  });

  vault.on('changed', (payload: unknown) => {
    bus.broadcast('vault.changed', payload);
    bus.broadcast('graph.updated', { generatedAt: vault.graph?.generatedAt ?? null });
  });
  runner.on('started', (p: unknown) => {
    bus.broadcast('brain.started', p);
    const s = p as { runId?: string; engine?: string; model?: string; mode?: string };
    app.log.info({ runId: s.runId, engine: s.engine, model: s.model, mode: s.mode }, 'brain run started');
  });
  runner.on('event', (p: unknown) => {
    bus.broadcast('brain.event', p);
    const e = p as { runId?: string; event?: { type?: string; message?: string } };
    if (e.event?.type === 'notice') app.log.warn({ runId: e.runId }, `brain engine notice: ${e.event.message ?? ''}`);
  });
  runner.on('changes', (p: unknown) => bus.broadcast('brain.changes', p));
  runner.on('done', (p: unknown) => {
    bus.broadcast('brain.done', p);
    const d = p as { runId?: string; ok?: boolean; error?: string; timing?: RunTiming };
    const short = (d.runId ?? '').slice(-8);
    app.log.info({ runId: d.runId, ok: d.ok, error: d.error, ...d.timing }, 'brain run finished');
    if (d.ok === false && d.error !== 'cancelled') diag.record({ code: `RUN-${short}`, message: d.error ?? 'the run failed' });
    // A slow start is the CLI, the network or the vendor before the model answered — not the vault; name the part that waited.
    const t = d.timing;
    if (t && (t.firstEventMs === undefined ? t.totalMs : t.firstEventMs) >= SLOW_START_MS) {
      diag.record({ code: `SLOW-${short}`, message: `the engine took ${Math.round((t.firstEventMs ?? t.totalMs) / 1000)} s to start${t.firstOutputMs !== undefined ? ` and ${Math.round(t.firstOutputMs / 1000)} s to its first output` : ''}${t.lastNotice ? ` (last notice: ${t.lastNotice})` : ''}` });
    } else if (t?.firstOutputMs !== undefined && t.firstOutputMs - (t.firstEventMs ?? 0) >= SLOW_START_MS) {
      diag.record({ code: `SLOW-${short}`, message: `the engine started in ${Math.round((t.firstEventMs ?? 0) / 1000)} s but its first output came after ${Math.round(t.firstOutputMs / 1000)} s${t.lastNotice ? ` (last notice: ${t.lastNotice})` : ''}` });
    }
  });
  runner.on('queue', (p: unknown) => bus.broadcast('brain.queue', p));

  app.setErrorHandler((err, req, reply) => {
    const path = (req.raw.url ?? '').split('?')[0];
    if (err instanceof ZodError) return reply.code(400).send({ error: { message: 'invalid request', issues: err.issues, requestId: req.id } });
    if (err instanceof HttpError) return reply.code(err.status).send({ error: { message: err.message, requestId: req.id } });
    const e = err as { statusCode?: number; message?: string };
    const status = typeof e.statusCode === 'number' ? e.statusCode : 500;
    if (status >= 500) { app.log.error(err); diag.record({ code: `HTTP-${status}`, message: e.message ?? String(err), requestId: req.id, ...(path ? { path } : {}) }); }
    return reply.code(status).send({ error: { message: e.message ?? String(err), requestId: req.id } });
  });

  // Polled every few seconds by the container's health check: answered without a request log line.
  app.get('/api/health', { logLevel: 'warn' }, async () => ({ ok: true, vault: vault.exists, clients: bus.size, busy: runner.busy }));
  const hello = (): Record<string, unknown> => ({ vault: vault.exists, generatedAt: vault.graph?.generatedAt ?? null, queue: runner.queueState() });
  app.get('/ws', { websocket: true }, (socket) => {
    bus.add(socket);
    socket.send(JSON.stringify({ type: 'hello', payload: hello() }));
  });

  /**
   * The same events over plain HTTP for a client whose WebSocket a proxy or CDN blocks (docs/ARCHITECTURE.md
   * "Live events"): without `after` (or after a server restart) the answer starts the client off with `hello`; with
   * it, the events after `after`, held up to `wait` seconds when there are none yet.
   */
  app.get('/api/events', async (req, reply) => {
    const q = z.object({ after: z.coerce.number().int().min(0).optional(), epoch: z.string().max(40).optional(), wait: z.coerce.number().min(0).max(30).default(25) }).parse(req.query);
    const head = { epoch: bus.epoch, seq: bus.lastSeq };
    if (q.after === undefined || q.epoch !== bus.epoch) return { ...head, reset: q.after !== undefined, hello: hello(), events: [] };
    let events = bus.since(q.after);
    if (events === null) return { ...head, reset: true, hello: hello(), events: [] };
    if (!events.length && q.wait > 0) {
      // The response's own 'close' (not the request's, which fires once the request is read) says the client left.
      const gone = new AbortController();
      reply.raw.on('close', () => { if (!reply.raw.writableFinished) gone.abort(); });
      await bus.next(q.wait * 1000, gone.signal);
      events = bus.since(q.after) ?? [];
    }
    return { epoch: bus.epoch, seq: bus.lastSeq, events: events.map((e) => ({ seq: e.seq, type: e.type, payload: e.payload })) };
  });

  /** Settings → Diagnostics: the server's side of a report the user can copy. */
  app.get('/api/diagnostics', async () => ({
    startedAt: diag.startedAt,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    trustLoopback: config.trustLoopback ?? true,
    live: { websocketClients: bus.size, lastSeq: bus.lastSeq, epoch: bus.epoch },
    busy: runner.busy,
    engines: await Promise.all([...engines.values()].map(async (e) => {
      const p = await e.probe();
      return { id: e.id, installed: p.installed, loggedIn: p.loggedIn, version: p.version ?? null, selected: e.id === (await settings.get()).engine };
    })),
    errors: diag.recent(),
  }));

  await vaultRoutes(app, ctx);
  await nodeRoutes(app, ctx);
  await brainRoutes(app, ctx);
  await engineSignInRoutes(app, ctx);
  await pairingRoutes(app, ctx);
  await authRoutes(app, ctx);
  await layoutRoutes(app, ctx);
  await backupRoutes(app, ctx);
  await oauthRoutes(app, ctx);
  await mcpRoutes(app, ctx);
  if (options.serveWeb ?? true) {
    const served = await registerWebApp(app, ctx);
    if (!served) app.log.warn({ webDist: config.webDist }, 'web UI not built; `/` serves a hint (run `pnpm build`)');
  }

  // A run still at work is cancelled and allowed to finish: its partial edits are committed, so Undo covers them, and the
  // engine's child process ends with it instead of editing a vault that is about to close (the Mac app's lock).
  app.addHook('onClose', async () => { automation.stop(); signIns.dispose(); await runner.stopAll(); await vault.stop(); });
  return { app, ctx };
}
