import { buildApp } from './app';
import { loadConfig } from './config';
import { loadDotEnv } from './env';
import { lanAddresses } from './lan';
import { startListening } from './listen';

const envFile = loadDotEnv();
const config = loadConfig();
const { app, ctx } = await buildApp(config);
const listener = await startListening(app, ctx);
app.log.info({
  vault: config.vaultPath, exists: ctx.vault.exists, nodes: ctx.vault.nodeCount, envFile,
  host: listener.host, port: listener.port, lanUrls: listener.lan ? lanAddresses().map((a) => `http://${a}:${listener.port}`) : [],
}, 'synapse server ready');

// The first-run setup (docs/DEPLOY.md): until an account exists, creating it from another device needs this code.
const setupCode = await ctx.auth.currentSetupCode();
if (setupCode) {
  const reachable = config.trustLoopback === false || listener.lan;
  app.log[reachable ? 'warn' : 'info'](`no account yet: open Synapse and create one. setup code: ${setupCode}`);
}

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
