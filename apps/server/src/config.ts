import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePublicUrl } from './public-url';

export interface ServerConfig {
  /** Bind host from `SYNAPSE_HOST`; `null` follows the `server.lanAccess` setting (loopback unless enabled). */
  host: string | null;
  port: number;
  vaultPath: string;
  /** Built web UI served at `/` (`pnpm build`); `SYNAPSE_WEB_DIST` overrides. */
  webDist: string;
  /** `SYNAPSE_PAIR_TOKEN`: pins the pairing token (a server in the cloud, docs/DEPLOY.md); null = the token in the vault. */
  pairToken?: string | null;
  /** `SYNAPSE_TRUST_LOOPBACK=false`: loopback clients sign in too (a container behind a proxy; the image sets it). */
  trustLoopback?: boolean;
  /** `SYNAPSE_PUBLIC_URL`: the origin other apps reach this server at (MCP and OAuth); null = the request's own host. */
  publicUrl?: string | null;
  /**
   * `SYNAPSE_PRIVATE_SESSIONS=1` (the protected Mac app): CLI brains keep no vendor transcripts and get the recent
   * conversation from the vault instead (docs/BRAIN-ENGINES.md "Protected desktop CLI sessions").
   */
  privateSessions?: boolean;
  /** `SYNAPSE_AUTOMATION_DELAY_MS`: wait this long after start before the first scheduled-run check (the Mac app). */
  automationDelayMs?: number;
}

const expandHome = (p: string): string => path.resolve(p.replace(/^~(?=$|\/)/, os.homedir()));

export const DEFAULT_WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const raw = env['SYNAPSE_VAULT'] ?? path.join(os.homedir(), 'Synapse', 'vault');
  const host = env['SYNAPSE_HOST']?.trim();
  const pairToken = env['SYNAPSE_PAIR_TOKEN']?.trim() || null;
  if (pairToken && !/^[A-Za-z0-9_-]{32,}$/.test(pairToken)) throw new Error('SYNAPSE_PAIR_TOKEN must be at least 32 characters of A-Z a-z 0-9 _ -');
  const trust = env['SYNAPSE_TRUST_LOOPBACK']?.trim().toLowerCase();
  return {
    pairToken,
    publicUrl: parsePublicUrl(env['SYNAPSE_PUBLIC_URL']),
    trustLoopback: !(trust === '0' || trust === 'false' || trust === 'no'),
    host: host ? host : null,
    port: Number(env['SYNAPSE_PORT'] ?? 4317),
    vaultPath: expandHome(raw),
    webDist: env['SYNAPSE_WEB_DIST'] ? expandHome(env['SYNAPSE_WEB_DIST']) : DEFAULT_WEB_DIST,
    privateSessions: env['SYNAPSE_PRIVATE_SESSIONS'] === '1',
    automationDelayMs: Math.max(0, Number(env['SYNAPSE_AUTOMATION_DELAY_MS'] ?? 0) || 0),
  };
}
