import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { HttpError } from './context';

/**
 * The owner's account (docs/ARCHITECTURE.md "Access control"): one username and a scrypt hash of the password in
 * `.synapse/auth.json` (owner-only file), plus the devices signed in with it — each a random bearer token kept only
 * as its SHA-256. Made once through the first-run setup, which a setup code from the server log guards.
 */

interface Session { id: string; createdAt: string; lastSeen: string; agent: string }
interface AuthFile { version: 1; username: string; salt: string; hash: string; N: number; r: number; p: number; createdAt: string; sessions: Session[] }
interface KdfParams { N: number; r: number; p: number }

const PARAMS: KdfParams = { N: 1 << 15, r: 8, p: 1 };
const KEYLEN = 64;
const SESSION_DAYS = 90;
const MAX_SESSIONS = 20;
/** A session's `lastSeen` is written at most this often (no file write per request). */
const TOUCH_MS = 6 * 3_600_000;
export const PASSWORD_MIN = 8;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,}$/;

const sha256 = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();
const sameBytes = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);
const sessionId = (token: string): string => sha256(token).toString('hex');
const clipAgent = (agent: string): string => agent.replace(/\s+/g, ' ').trim().slice(0, 120);

function derive(password: string, salt: Buffer, p: KdfParams): Promise<Buffer> {
  const opts: ScryptOptions = { N: p.N, r: p.r, p: p.p, maxmem: 256 * p.N * p.r };
  return new Promise((resolve, reject) => scrypt(password.normalize('NFC'), salt, KEYLEN, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

export function normalizeUsername(u: string): string {
  return u.normalize('NFC').trim().toLowerCase();
}

/** What is wrong with a new password, or null. Length is the only rule (NIST SP 800-63B). */
export function passwordProblem(p: string): string | null {
  if (p.length < PASSWORD_MIN) return `the password needs at least ${PASSWORD_MIN} characters`;
  if (p.length > 256) return 'the password is too long';
  return null;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A one-time setup code, `XXXX-XXXX-XXXX` from an alphabet without look-alikes (60 bits). */
export function newSetupCode(): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

const normCode = (c: string): string => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Case and dashes do not matter; an empty code never matches. */
export function sameSetupCode(given: string, expected: string): boolean {
  const a = normCode(given); const b = normCode(expected);
  if (!a || !b) return false;
  return sameBytes(sha256(a), sha256(b));
}

function validSession(s: unknown): s is Session {
  const x = s as Partial<Session> | null;
  return Boolean(x && typeof x.id === 'string' && typeof x.lastSeen === 'string' && typeof x.createdAt === 'string');
}

export class AuthStore {
  /** undefined = not read yet; null = no account. */
  private cache: AuthFile | null | undefined;
  private setupCode: string | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly root: string) {}

  get file(): string {
    return path.join(this.root, '.synapse', 'auth.json');
  }

  private async load(): Promise<AuthFile | null> {
    if (this.cache !== undefined) return this.cache;
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<AuthFile>;
      if (typeof raw.username === 'string' && typeof raw.hash === 'string' && typeof raw.salt === 'string') {
        this.cache = {
          version: 1, username: raw.username, salt: raw.salt, hash: raw.hash,
          N: raw.N ?? PARAMS.N, r: raw.r ?? PARAMS.r, p: raw.p ?? PARAMS.p,
          createdAt: raw.createdAt ?? new Date().toISOString(),
          sessions: Array.isArray(raw.sessions) ? raw.sessions.filter(validSession) : [],
        };
        return this.cache;
      }
    } catch { /* no account yet */ }
    this.cache = null;
    return null;
  }

  /** Writes are queued and atomic (temp file + rename); the cache changes at once. */
  private save(f: AuthFile): Promise<void> {
    this.cache = f;
    this.writing = this.writing.catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(f, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
      await fs.rename(tmp, this.file);
      await fs.chmod(this.file, 0o600).catch(() => undefined);
    });
    return this.writing;
  }

  async hasAccount(): Promise<boolean> {
    return (await this.load()) !== null;
  }

  async username(): Promise<string | null> {
    return (await this.load())?.username ?? null;
  }

  /** The first-run setup code while no account exists (made on first ask, kept until the account exists), else null. */
  async currentSetupCode(): Promise<string | null> {
    if (await this.hasAccount()) { this.setupCode = null; return null; }
    this.setupCode ??= newSetupCode();
    return this.setupCode;
  }

  /** Creates the one account and signs this device in; returns its session token. */
  async create(username: string, password: string, agent: string): Promise<string> {
    if (await this.hasAccount()) throw new HttpError(409, 'an account exists already; sign in instead');
    const name = username.normalize('NFC').trim();
    if (!name || name.length > 64) throw new HttpError(400, 'the username needs 1 to 64 characters');
    const problem = passwordProblem(password);
    if (problem) throw new HttpError(400, problem);
    const salt = randomBytes(16);
    const hash = await derive(password, salt, PARAMS);
    // Two setups racing: whoever finishes hashing second finds the account (the check and the cache write are one tick).
    if (this.cache) throw new HttpError(409, 'an account exists already; sign in instead');
    const now = new Date().toISOString();
    const token = randomBytes(32).toString('base64url');
    this.setupCode = null;
    await this.save({ version: 1, username: name, salt: salt.toString('base64'), hash: hash.toString('base64'), ...PARAMS, createdAt: now, sessions: [{ id: sessionId(token), createdAt: now, lastSeen: now, agent: clipAgent(agent) }] });
    return token;
  }

  /** A session token for the right username and password, else null (the hash runs either way). */
  async login(username: string, password: string, agent: string): Promise<string | null> {
    const f = await this.load();
    if (!f) return null;
    const key = await derive(password, Buffer.from(f.salt, 'base64'), f);
    const userOk = sameBytes(sha256(normalizeUsername(username)), sha256(normalizeUsername(f.username)));
    const passOk = sameBytes(key, Buffer.from(f.hash, 'base64'));
    if (!userOk || !passOk) return null;
    return this.issue(agent);
  }

  private live(sessions: Session[]): Session[] {
    const cutoff = Date.now() - SESSION_DAYS * 86_400_000;
    return sessions.filter((s) => Date.parse(s.lastSeen) > cutoff);
  }

  private async issue(agent: string): Promise<string> {
    const f = await this.load();
    if (!f) throw new HttpError(409, 'no account');
    const token = randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    const sessions = [{ id: sessionId(token), createdAt: now, lastSeen: now, agent: clipAgent(agent) }, ...this.live(f.sessions)]
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
      .slice(0, MAX_SESSIONS);
    await this.save({ ...f, sessions });
    return token;
  }

  /** True for the token of a signed-in device that was seen within the last 90 days. */
  async verifySession(token: string | null | undefined): Promise<boolean> {
    if (!token || !TOKEN_RE.test(token)) return false;
    const f = await this.load();
    if (!f) return false;
    const id = sessionId(token);
    const s = f.sessions.find((x) => x.id === id);
    if (!s) return false;
    const age = Date.now() - Date.parse(s.lastSeen);
    if (age > SESSION_DAYS * 86_400_000) return false;
    if (age > TOUCH_MS) {
      const now = new Date().toISOString();
      void this.save({ ...f, sessions: f.sessions.map((x) => (x.id === id ? { ...x, lastSeen: now } : x)) });
    }
    return true;
  }

  /** Signs one device out. */
  async revoke(token: string): Promise<void> {
    const f = await this.load();
    if (!f) return;
    const id = sessionId(token);
    if (!f.sessions.some((s) => s.id === id)) return;
    await this.save({ ...f, sessions: f.sessions.filter((s) => s.id !== id) });
  }

  /** Checks the current password, sets the new one, signs every device out and returns a fresh session for this one. */
  async changePassword(current: string, next: string, agent: string): Promise<string | null> {
    const f = await this.load();
    if (!f) return null;
    const key = await derive(current, Buffer.from(f.salt, 'base64'), f);
    if (!sameBytes(key, Buffer.from(f.hash, 'base64'))) return null;
    const problem = passwordProblem(next);
    if (problem) throw new HttpError(400, problem);
    const salt = randomBytes(16);
    const hash = await derive(next, salt, PARAMS);
    await this.save({ ...f, salt: salt.toString('base64'), hash: hash.toString('base64'), ...PARAMS, sessions: [] });
    return this.issue(agent);
  }
}

/**
 * Failed sign-in, setup and password attempts, per client and in all: past either limit the door stays shut until
 * the window ends. The client key may come from `X-Forwarded-For` (behind a proxy every socket is the proxy's), so a
 * spoofed header only buys separate buckets; the total limit holds regardless.
 */
export class Throttle {
  private hits = new Map<string, { n: number; until: number }>();

  constructor(private readonly perKey = 8, private readonly total = 40, private readonly windowMs = 15 * 60_000) {}

  /** Seconds to wait before the next try, or 0. */
  wait(key: string, now = Date.now()): number {
    const mine = this.hits.get(key);
    const all = this.hits.get('*');
    const until = Math.max(mine && mine.n >= this.perKey ? mine.until : 0, all && all.n >= this.total ? all.until : 0);
    return until > now ? Math.ceil((until - now) / 1000) : 0;
  }

  fail(key: string, now = Date.now()): void {
    if (this.hits.size > 2000) for (const [k, v] of this.hits) if (v.until <= now) this.hits.delete(k);
    for (const k of [key, '*']) {
      const e = this.hits.get(k);
      if (!e || e.until <= now) this.hits.set(k, { n: 1, until: now + this.windowMs });
      else e.n++;
    }
  }

  clear(key: string): void {
    this.hits.delete(key);
  }
}
