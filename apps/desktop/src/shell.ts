/**
 * The Mac app's pure parts (docs/ARCHITECTURE.md "Desktop app"): the server's environment and the PATH the brain's
 * CLIs are found on, when a server that stopped by itself is started again, which addresses stay in the window and
 * where the window opens. Nothing here imports Electron, so the tests run in plain Node.
 */
import path from 'node:path';

export const SHELL_PATH_MARK = '__SYNAPSE_PATH__';

/** The PATH a login shell printed between two marks, whatever its startup files printed around it. */
export function parseShellPath(out: string): string | null {
  const m = new RegExp(`${SHELL_PATH_MARK}(.*?)${SHELL_PATH_MARK}`, 's').exec(out);
  const v = m?.[1]?.trim();
  return v ? v : null;
}

/**
 * An app opened from Finder gets only /usr/bin:/bin:/usr/sbin:/sbin. The server needs what a terminal has (`claude`,
 * `codex`, `git`): the login shell's PATH first, then the app's own, then where Claude Code and Homebrew install.
 */
export function mergePath(shellPath: string | null, current: string | undefined, home: string): string {
  const known = [
    path.join(home, '.npm-global', 'bin'), path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'),
    '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin',
  ];
  const all = [...(shellPath ?? '').split(':'), ...(current ?? '').split(':'), ...known].map((d) => d.trim()).filter(Boolean);
  return [...new Set(all)].join(':');
}

export interface ServerEnvOptions {
  base: NodeJS.ProcessEnv;
  path: string;
  user: string;
  vault: string;
  port: number;
  webDist: string;
  envFile: string;
  /** The protected app: loopback only, private CLI sessions, a late first scheduled-run check. */
  protected?: boolean;
}

/** Another Claude Code session's variables, an API key or Electron's own never reach the server, nor the brain. */
const DROPPED = /^(CLAUDE|ANTHROPIC_API_KEY$|ANTHROPIC_AUTH_TOKEN$|ELECTRON_|NODE_OPTIONS$|SYNAPSE_)/;

/** The environment the server runs in: the Mac's sign-ins, this app's vault, port and built UI. */
export function serverEnv(o: ServerEnvOptions): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(o.base)) {
    if (v === undefined || (DROPPED.test(k) && k !== 'CLAUDE_CONFIG_DIR')) continue;
    env[k] = v;
  }
  env['PATH'] = o.path;
  // Claude Code finds its keychain sign-in by the user's name.
  env['USER'] = env['USER'] || o.user;
  env['LOGNAME'] = env['LOGNAME'] || o.user;
  env['SYNAPSE_VAULT'] = o.vault;
  env['SYNAPSE_PORT'] = String(o.port);
  env['SYNAPSE_WEB_DIST'] = o.webDist;
  env['SYNAPSE_ENV_FILE'] = o.envFile;
  env['NODE_ENV'] = 'production';
  // The protected app (docs/ARCHITECTURE.md "Desktop protection"): loopback only, no vendor transcripts, and the first
  // scheduled-run check a few minutes after an unlock, so a quick look queues nothing ahead of the owner.
  if (o.protected) {
    env['SYNAPSE_HOST'] = '127.0.0.1';
    env['SYNAPSE_PRIVATE_SESSIONS'] = '1';
    env['SYNAPSE_AUTOMATION_DELAY_MS'] = String(AUTOMATION_DELAY_MS);
  }
  return env;
}

export const AUTOMATION_DELAY_MS = 3 * 60_000;

/** How long Touch ID alone opens the app before the password is asked once, so it is not forgotten. */
export const PASSWORD_EVERY_DAYS = 14;

/**
 * True when the password was last typed `days` or more ago. Never recorded (an install from before this rule) is not
 * due: the clock starts at the next unlock, so an update never takes Touch ID away from someone unsure of the password.
 */
export function passwordDue(lastAt: string | undefined, now: Date, days = PASSWORD_EVERY_DAYS): boolean {
  const t = lastAt ? Date.parse(lastAt) : NaN;
  return Number.isFinite(t) && now.getTime() - t >= days * 86_400_000;
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I: it is written down by hand

/** A recovery key from 20 random bytes: 32 characters in eight groups of four (160 bits). */
export function formatRecoveryKey(bytes: Uint8Array): string {
  if (bytes.length < 20) throw new Error('A recovery key needs 20 random bytes.');
  let bits = 0; let value = 0; let out = '';
  for (const b of bytes.subarray(0, 20)) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += RECOVERY_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out.match(/.{4}/g)!.join('-');
}

/** The recovery key as typed: case, spaces and dashes do not matter; null when it is not one. */
export function normalizeRecoveryKey(text: string): string | null {
  const plain = text.toUpperCase().replace(/[\s-]/g, '');
  if (plain.length !== 32 || [...plain].some((c) => !RECOVERY_ALPHABET.includes(c))) return null;
  return plain.match(/.{4}/g)!.join('-');
}

/** Stops of the server within the last two minutes. */
export function recentStops(stops: readonly number[], now: number, windowMs = 120_000): number[] {
  return stops.filter((t) => now - t < windowMs);
}

/** How long to wait before starting again a server that stopped by itself (the count includes this stop); null = give up. */
export function restartDelay(stopsInWindow: number): number | null {
  if (stopsInWindow <= 1) return 1000;
  if (stopsInWindow === 2) return 3000;
  if (stopsInWindow === 3) return 8000;
  return null;
}

/** The app's own pages: its server on loopback at this port. Everything else opens outside the window. */
export function isAppUrl(url: string, port: number): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && u.port === String(port);
  } catch {
    return false;
  }
}

/** Addresses another program opens: the default browser or the mail app. */
export function isExternalUrl(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url);
}

export interface Rect { x: number; y: number; width: number; height: number }
export interface WindowState extends Rect { maximized: boolean }

/** A saved window state, or null when it is missing or not one. */
export function windowStateOf(v: unknown): WindowState | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  const num = (k: string): number | null => (typeof s[k] === 'number' && Number.isFinite(s[k]) ? (s[k] as number) : null);
  const x = num('x'); const y = num('y'); const width = num('width'); const height = num('height');
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height, maximized: s['maximized'] === true };
}

const overlap = (a: number, al: number, b: number, bl: number): number => Math.max(0, Math.min(a + al, b + bl) - Math.max(a, b));

/**
 * Where the window opens: the saved place when enough of it is on a screen that is still attached, at least the
 * smallest size; null = centred at the default size (a screen was unplugged, or nothing was saved).
 */
export function fitBounds(saved: WindowState | null, screens: readonly Rect[], min: { width: number; height: number }): WindowState | null {
  if (!saved) return null;
  const width = Math.max(min.width, Math.round(saved.width));
  const height = Math.max(min.height, Math.round(saved.height));
  const x = Math.round(saved.x);
  const y = Math.round(saved.y);
  const seen = screens.some((s) => overlap(x, width, s.x, s.width) >= 160 && overlap(y, height, s.y, s.height) >= 120);
  return seen ? { x, y, width, height, maximized: saved.maximized } : null;
}
