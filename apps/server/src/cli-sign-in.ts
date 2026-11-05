import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import { lastSignInLines, readSignInOutput, redactSecrets, sanitizeEnv, type BrainEngine, type EngineId, type EngineProbe, type SignInFlow } from '@synapse/brain';
import { HttpError } from './context';

/**
 * Signing a vendor CLI in from the app (docs/BRAIN-ENGINES.md "Sign-in from the app"): the CLI's own sign-in command
 * runs on a terminal here, the app shows the vendor's link (and a device code) and hands a pasted one-time code to
 * the CLI's terminal. The CLI keeps the credentials it gets; this module never reads, stores or logs them.
 */

export type SignInStatus = 'starting' | 'waiting' | 'verifying' | 'done' | 'failed' | 'cancelled';

export interface SignInState {
  engine: EngineId;
  flow: SignInFlow;
  status: SignInStatus;
  /** The vendor's sign-in page. */
  url: string | null;
  /** A device code to type on that page (device-code flow). */
  code: string | null;
  /** The CLI waits for the code the vendor's page shows after sign-in (paste-code flow). */
  needsPaste: boolean;
  message: string | null;
  startedAt: string;
}

interface Session {
  engine: BrainEngine;
  state: SignInState;
  child: ChildProcess;
  raw: string;
  pasted: string[];
  timer: NodeJS.Timeout;
}

const ACTIVE: ReadonlySet<SignInStatus> = new Set(['starting', 'waiting', 'verifying']);
const TIMEOUT_MS = 15 * 60_000;
const KEEP_MS = 5 * 60_000;
const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

let haveScript: boolean | null = null;

/**
 * The CLI on a terminal: util-linux `script` gives it a real one on Linux (a server); BSD `script` refuses a piped
 * stdin, so elsewhere the CLI runs on pipes — on a desktop it opens the browser itself and needs no pasted code.
 */
function spawnOnTerminal(bin: string, args: string[]): ChildProcess {
  const opts = { cwd: os.homedir(), env: sanitizeEnv(), stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'], detached: true };
  if (process.platform === 'linux') {
    haveScript ??= spawnSync('script', ['--version'], { stdio: 'ignore' }).status === 0;
    if (haveScript) return spawn('script', ['-q', '-e', '-f', '-c', [bin, ...args].map(shQuote).join(' '), '/dev/null'], opts);
  }
  return spawn(bin, args, opts);
}

export class CliSignIns {
  private live = new Map<EngineId, Session>();

  state(id: EngineId): SignInState | null {
    return this.live.get(id)?.state ?? null;
  }

  /** Starts the engine's own sign-in (or returns the one already running). */
  async start(engine: BrainEngine): Promise<SignInState> {
    const current = this.live.get(engine.id);
    if (current && ACTIVE.has(current.state.status)) return current.state;
    this.live.delete(engine.id);
    const spec = engine.signIn;
    if (!spec || !engine.resolveBin) throw new HttpError(400, `${engine.name} uses an API key; paste it instead of signing in`);
    const bin = await engine.resolveBin();
    if (!bin) throw new HttpError(409, `${engine.name} is not installed on this server`);

    const state: SignInState = { engine: engine.id, flow: spec.flow, status: 'starting', url: null, code: null, needsPaste: false, message: null, startedAt: new Date().toISOString() };
    const child = spawnOnTerminal(bin, spec.login);
    const s: Session = { engine, state, child, raw: '', pasted: [], timer: setTimeout(() => this.stop(s, 'the sign-in took too long and was stopped'), TIMEOUT_MS) };
    s.timer.unref();
    const feed = (chunk: Buffer): void => {
      s.raw = (s.raw + chunk.toString('utf8')).slice(-16_000);
      const r = readSignInOutput(s.raw, spec);
      if (r.url) state.url = r.url;
      if (r.code) state.code = r.code;
      if (r.needsPaste) state.needsPaste = true;
      if (state.status === 'starting' && state.url) state.status = 'waiting';
      if (r.error && state.status !== 'done') state.message = this.scrub(s, r.error);
    };
    child.stdout?.on('data', feed);
    child.stderr?.on('data', feed);
    child.on('error', (err) => { state.status = 'failed'; state.message = err.message; this.retire(s); });
    child.on('close', () => { void this.finish(s); });
    this.live.set(engine.id, s);
    return state;
  }

  /** Hands the code from the vendor's page to the waiting CLI: written to its terminal only, never kept or logged. */
  paste(id: EngineId, code: string): SignInState {
    const s = this.live.get(id);
    if (!s || !ACTIVE.has(s.state.status) || s.state.flow !== 'paste-code') throw new HttpError(409, 'no sign-in is waiting for a code');
    const clean = code.replace(/[\x00-\x1f\x7f]/g, '').trim();
    if (!clean || clean.length > 1000) throw new HttpError(400, 'paste the code the sign-in page showed');
    s.pasted.push(clean);
    s.state.status = 'verifying';
    s.state.message = null;
    s.child.stdin?.write(`${clean}\r`);
    return s.state;
  }

  cancel(id: EngineId): void {
    const s = this.live.get(id);
    if (!s || !ACTIVE.has(s.state.status)) return;
    s.state.status = 'cancelled';
    this.kill(s);
  }

  /** Runs the CLI's own sign-out and returns the fresh probe. */
  async signOut(engine: BrainEngine): Promise<EngineProbe> {
    const spec = engine.signIn;
    if (!spec || !engine.resolveBin) throw new HttpError(400, `${engine.name} uses an API key; remove the key instead`);
    const bin = await engine.resolveBin();
    if (!bin) throw new HttpError(409, `${engine.name} is not installed on this server`);
    this.cancel(engine.id);
    await new Promise<void>((resolve) => {
      const c = spawn(bin, spec.logout, { cwd: os.homedir(), env: sanitizeEnv(), stdio: 'ignore' });
      const t = setTimeout(() => c.kill('SIGKILL'), 20_000);
      c.on('close', () => { clearTimeout(t); resolve(); });
      c.on('error', () => { clearTimeout(t); resolve(); });
    });
    return engine.probe(true);
  }

  dispose(): void {
    for (const s of this.live.values()) if (ACTIVE.has(s.state.status)) this.kill(s);
    this.live.clear();
  }

  private async finish(s: Session): Promise<void> {
    clearTimeout(s.timer);
    if (s.state.status === 'cancelled' || s.state.status === 'failed') { this.retire(s); return; }
    let probe: EngineProbe | null = null;
    try { probe = await s.engine.probe(true); } catch { /* reported below */ }
    if (probe?.loggedIn) {
      s.state.status = 'done';
      s.state.message = null;
    } else {
      s.state.status = 'failed';
      s.state.message ??= this.scrub(s, lastSignInLines(s.raw)) || 'the sign-in did not finish';
    }
    this.retire(s);
  }

  private stop(s: Session, message: string): void {
    if (!ACTIVE.has(s.state.status)) return;
    s.state.status = 'failed';
    s.state.message = message;
    this.kill(s);
  }

  /** The finished session stays readable for a while (the page shows how it ended), without its output. */
  private retire(s: Session): void {
    s.raw = '';
    s.pasted = [];
    setTimeout(() => { if (this.live.get(s.state.engine) === s) this.live.delete(s.state.engine); }, KEEP_MS).unref();
  }

  private kill(s: Session): void {
    const pid = s.child.pid;
    if (!pid) return;
    try { process.kill(-pid, 'SIGTERM'); } catch { s.child.kill('SIGTERM'); }
    setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } }, 2000).unref();
  }

  private scrub(s: Session, text: string): string {
    let t = redactSecrets(text);
    for (const p of s.pasted) t = t.split(p).join('[code]');
    return t.slice(0, 300);
  }
}
