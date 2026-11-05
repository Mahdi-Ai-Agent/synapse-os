import { cliSessionArgs } from '../session-policy';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { AsyncQueue } from '../async-queue';
import { claudeEnv } from '../env';
import { claudeAppCliPaths, sourceOf } from './desktop-apps';
import { createStreamJsonParser } from '../stream-json';
import type { BrainEngine, BrainEvent, BrainRunRequest, EngineProbe, ModelOption, SignInSpec } from '../types';

const MODELS: ModelOption[] = [
  { id: 'fable', label: 'Claude Fable (latest)' },
  { id: 'opus', label: 'Claude Opus (latest)' },
  { id: 'sonnet', label: 'Claude Sonnet (latest)' },
  { id: 'haiku', label: 'Claude Haiku (latest)' },
];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const PROBE_TTL_MS = 10 * 60_000;
export const LOGIN_FIX = 'Sign in from Settings → Brain (it runs `claude auth login` and shows Anthropic\'s page), or in a terminal run `claude` and type `/login`. Claude Code keeps the sign-in; Synapse never sees your credentials.';
export const INSTALL_FIX = 'Install Claude Code (https://code.claude.com) so the `claude` command is on your PATH — or the Claude app, which keeps Claude Code with it — then sign in with `claude` → `/login`.';

const CANDIDATE_BINS = [
  () => process.env['SYNAPSE_CLAUDE_BIN'],
  () => path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
  () => path.join(os.homedir(), '.claude', 'local', 'claude'),
  () => path.join(os.homedir(), '.local', 'bin', 'claude'),
  () => '/opt/homebrew/bin/claude',
  () => '/usr/local/bin/claude',
];

async function isExecutable(p: string | undefined): Promise<boolean> {
  if (!p) return false;
  try { await fs.access(p, fs.constants.X_OK); return true; } catch { return false; }
}

/** Finds the `claude` binary: env override, PATH, then well-known install locations. */
export async function resolveClaudeBin(): Promise<string | null> {
  const override = process.env['SYNAPSE_CLAUDE_BIN'];
  if (await isExecutable(override)) return override as string;
  for (const dir of (process.env['PATH'] ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, 'claude');
    if (await isExecutable(p)) return p;
  }
  for (const c of CANDIDATE_BINS) { const p = c(); if (await isExecutable(p)) return p as string; }
  // The Claude app keeps its own Claude Code, signed in with the same login (docs/BRAIN-ENGINES.md "On a desktop").
  for (const p of await claudeAppCliPaths()) if (await isExecutable(p)) return p;
  return null;
}

/** "claude.ai · you@example.com · Max" from `claude auth status --json` fields; never a token. */
export function claudeAccount(status: Record<string, unknown>): string | undefined {
  const plan = typeof status['subscriptionType'] === 'string' && status['subscriptionType'] ? status['subscriptionType'] : null;
  const parts = [status['email'], plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : null].filter((x): x is string => typeof x === 'string' && x.length > 0);
  return parts.length ? parts.join(' · ') : undefined;
}

function runCapture(bin: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env: claudeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: String(err) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

export class ClaudeCliEngine implements BrainEngine {
  readonly id = 'claude-cli' as const;
  readonly name = 'Claude Code (your subscription)';
  readonly auth = 'cli-login' as const;
  readonly signIn: SignInSpec = { flow: 'paste-code', login: ['auth', 'login', '--claudeai'], logout: ['auth', 'logout'], hosts: ['claude.com', 'claude.ai', 'anthropic.com'] };
  private cached: EngineProbe | null = null;

  resolveBin(): Promise<string | null> { return resolveClaudeBin(); }
  models(): ModelOption[] { return MODELS; }
  efforts(): string[] { return EFFORTS; }

  async probe(force = false): Promise<EngineProbe> {
    if (!force && this.cached && Date.now() - Date.parse(this.cached.checkedAt) < PROBE_TTL_MS) return this.cached;
    const checkedAt = new Date().toISOString();
    const bin = await resolveClaudeBin();
    if (!bin) {
      this.cached = { installed: false, loggedIn: false, fix: INSTALL_FIX, checkedAt };
      return this.cached;
    }
    const v = await runCapture(bin, ['--version'], 15_000);
    const version = /(\d+\.\d+\.\d+)/.exec(v.stdout)?.[1];
    const a = await runCapture(bin, ['auth', 'status'], 20_000);
    let loggedIn = false; let detail: string | undefined; let account: string | undefined;
    try {
      const j = JSON.parse(a.stdout.trim()) as Record<string, unknown>;
      loggedIn = j['loggedIn'] === true;
      detail = typeof j['authMethod'] === 'string' ? `auth: ${j['authMethod']}` : undefined;
      if (loggedIn) account = claudeAccount(j);
    } catch {
      loggedIn = /logged in/i.test(a.stdout) && !/not logged in/i.test(a.stdout);
      detail = (a.stdout || a.stderr).trim().slice(0, 200) || undefined;
    }
    const probe: EngineProbe = { installed: true, loggedIn, checkedAt, via: sourceOf(bin) };
    if (version) probe.version = version;
    if (detail) probe.detail = detail;
    if (account) probe.account = account;
    if (!loggedIn) probe.fix = LOGIN_FIX;
    this.cached = probe;
    return probe;
  }

  run(req: BrainRunRequest, signal?: AbortSignal): AsyncIterable<BrainEvent> {
    const queue = new AsyncQueue<BrainEvent>();
    void this.spawnRun(req, queue, signal);
    return queue;
  }

  private async spawnRun(req: BrainRunRequest, queue: AsyncQueue<BrainEvent>, signal?: AbortSignal): Promise<void> {
    const bin = await resolveClaudeBin();
    if (!bin) { queue.push({ type: 'error', message: INSTALL_FIX }); queue.close(); return; }
    const args = [
      '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--permission-mode', 'acceptEdits', '--permission-prompts', 'none',
      '--tools', req.allowWeb ? 'Read,Edit,Write,Glob,Grep,Skill,WebFetch' : 'Read,Edit,Write,Glob,Grep,Skill', '--disallowedTools', 'mcp__*', '--strict-mcp-config',
      '--max-turns', String(req.maxTurns ?? 40),
    ];
    if (req.model) args.push('--model', req.model);
    if (req.effort) args.push('--effort', req.effort);
    args.push(...cliSessionArgs('claude', req));
    if (req.systemAppendFile) args.push('--append-system-prompt-file', req.systemAppendFile);

    let child: ChildProcess;
    try {
      child = spawn(bin, args, { cwd: req.cwd, env: claudeEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      queue.push({ type: 'error', message: `failed to start claude: ${err instanceof Error ? err.message : String(err)}` });
      queue.close();
      return;
    }
    const parser = createStreamJsonParser();
    let gotResult = false;
    let stderr = '';
    let killTimer: NodeJS.Timeout | null = null;

    const onAbort = (): void => {
      child.kill('SIGINT');
      killTimer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGTERM'); }, 5_000);
    };
    if (signal) {
      if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdin?.on('error', () => { /* closed early */ });
    child.stdin?.end(req.prompt);
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); if (stderr.length > 20_000) stderr = stderr.slice(-20_000); });

    const rl = readline.createInterface({ input: child.stdout as NodeJS.ReadableStream });
    rl.on('line', (line) => {
      for (const ev of parser.feed(line)) {
        if (ev.type === 'result') gotResult = true;
        queue.push(ev);
      }
    });

    child.on('error', (err) => {
      queue.push({ type: 'error', message: `claude process error: ${err.message}` });
    });
    child.on('close', (code) => {
      if (killTimer) clearTimeout(killTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      rl.close();
      if (!gotResult) {
        const reason = signal?.aborted ? 'run cancelled' : `claude exited with code ${code ?? 'null'}${stderr.trim() ? `: ${stderr.trim().split('\n').slice(-3).join(' | ')}` : ''}`;
        queue.push({ type: 'error', message: reason });
      }
      queue.close();
    });
  }
}
