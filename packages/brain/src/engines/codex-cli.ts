import { cliSessionArgs } from '../session-policy';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { expandSkillPrompt, loadAgentLayer, rulesIndex, type AgentLayer } from '../agent-layer';
import { AsyncQueue } from '../async-queue';
import { createCodexJsonlParser } from '../codex-jsonl';
import { sanitizeEnv } from '../env';
import { chatgptAppCodexPaths, sourceOf } from './desktop-apps';
import type { BrainEngine, BrainEvent, BrainRunRequest, EngineProbe, ModelOption, SignInSpec } from '../types';

/** Codex models (developers.openai.com/codex/models, read 2026-10-31); any id typed by the user is passed through. */
export const CODEX_MODELS: ModelOption[] = [
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol (balanced)' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra (most capable)' },
  { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra (fast)' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna (efficient)' },
];
/** `model_reasoning_effort` values every current Codex model accepts. */
export const CODEX_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
/** Every effort a Codex model may take, in order (the catalog says which model takes which). */
const EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const PROBE_TTL_MS = 10 * 60_000;
export const CODEX_INSTALL_FIX = 'Install the ChatGPT app (it brings Codex with it) or the Codex CLI — `npm install -g @openai/codex` or `brew install codex` — then sign in.';
export const CODEX_LOGIN_FIX = 'Open the ChatGPT app and sign in, or sign in from Settings → Brain (it runs `codex login --device-auth` and shows OpenAI\'s page and a code), or in a terminal run `codex login`. Codex keeps the sign-in; Synapse never sees your credentials.';

/**
 * The visible models of Codex's own catalog (`codex debug models`), each with the efforts it takes and the one it
 * starts on; hidden and unknown entries are left out. Empty when the output is not a catalog.
 */
export function parseCodexCatalog(json: string): ModelOption[] {
  let data: unknown;
  try { data = JSON.parse(json); } catch { return []; }
  const list = Array.isArray(data) ? data : Array.isArray((data as { models?: unknown })?.models) ? (data as { models: unknown[] }).models : [];
  const out: ModelOption[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as Record<string, unknown>;
    if (typeof m['slug'] !== 'string' || !m['slug'] || m['visibility'] !== 'list') continue;
    const levels = Array.isArray(m['supported_reasoning_levels']) ? (m['supported_reasoning_levels'] as Array<Record<string, unknown>>) : [];
    const efforts = levels.map((l) => l?.['effort']).filter((e): e is string => typeof e === 'string' && e.length > 0);
    const option: ModelOption = { id: m['slug'], label: typeof m['display_name'] === 'string' && m['display_name'] ? m['display_name'] : m['slug'] };
    if (efforts.length) option.efforts = efforts;
    if (typeof m['default_reasoning_level'] === 'string') option.defaultEffort = m['default_reasoning_level'];
    out.push(option);
  }
  return out;
}

const CANDIDATE_BINS = [
  () => path.join(os.homedir(), '.npm-global', 'bin', 'codex'),
  () => path.join(os.homedir(), '.local', 'bin', 'codex'),
  () => path.join(os.homedir(), '.codex', 'bin', 'codex'),
  () => path.join(os.homedir(), '.bun', 'bin', 'codex'),
  () => '/opt/homebrew/bin/codex',
  () => '/usr/local/bin/codex',
  // The ChatGPT app carries Codex and shares its sign-in (docs/BRAIN-ENGINES.md "On a desktop").
  ...chatgptAppCodexPaths().map((p) => () => p),
];

async function isExecutable(p: string | undefined): Promise<boolean> {
  if (!p) return false;
  try { await fs.access(p, fs.constants.X_OK); return true; } catch { return false; }
}

/** Finds the `codex` binary: `SYNAPSE_CODEX_BIN`, PATH, then well-known install locations. */
export async function resolveCodexBin(): Promise<string | null> {
  const override = process.env['SYNAPSE_CODEX_BIN'];
  if (await isExecutable(override)) return override as string;
  for (const dir of (process.env['PATH'] ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, 'codex');
    if (await isExecutable(p)) return p;
  }
  for (const c of CANDIDATE_BINS) { const p = c(); if (await isExecutable(p)) return p; }
  return null;
}

function runCapture(bin: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env: sanitizeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: String(err) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

/** `codex exec --json --cd <vault> --sandbox workspace-write --skip-git-repo-check [-m] [-c model_reasoning_effort=] [resume <id>] -` (prompt on stdin). */
export function buildCodexArgs(req: { cwd: string; model?: string; effort?: string; sessionId?: string; ephemeral?: boolean }): string[] {
  const args = ['exec', '--json', '--cd', req.cwd, '--sandbox', 'workspace-write', '--skip-git-repo-check'];
  if (req.model) args.push('--model', req.model);
  if (req.effort) args.push('-c', `model_reasoning_effort=${req.effort}`);
  args.push(...cliSessionArgs('codex', req));
  args.push('-');
  return args;
}

/**
 * Codex has no system-prompt flag and does not expand `/skill` prompts or load path-scoped rules, so the prompt
 * carries the runtime context, the rules index and the expanded skill; `AGENTS.md` itself is read by Codex from cwd.
 */
export function buildCodexPrompt(prompt: string, layer: AgentLayer, runtimeContext: string): string {
  const { prompt: expanded } = expandSkillPrompt(prompt, layer);
  const parts: string[] = [];
  if (runtimeContext.trim()) parts.push(`<runtime_context>\n${runtimeContext.trim()}\n</runtime_context>`);
  if (layer.rules.length) parts.push(`<folder_rules>\nRead the rule file before writing in its folder:\n${rulesIndex(layer)}\n</folder_rules>`);
  parts.push(expanded);
  return parts.join('\n\n');
}

export class CodexCliEngine implements BrainEngine {
  readonly id = 'codex-cli' as const;
  readonly name = 'Codex CLI (your ChatGPT account)';
  readonly auth = 'cli-login' as const;
  readonly signIn: SignInSpec = { flow: 'device-code', login: ['login', '--device-auth'], logout: ['logout'], hosts: ['openai.com', 'chatgpt.com'] };
  private cached: EngineProbe | null = null;
  /** Codex's own model catalog, read when the CLI is there (`fetchModels`, every probe). */
  private catalog: ModelOption[] | null = null;

  resolveBin(): Promise<string | null> { return resolveCodexBin(); }
  models(): ModelOption[] { return this.catalog ?? CODEX_MODELS; }
  efforts(): string[] {
    if (!this.catalog) return CODEX_EFFORTS;
    const all = new Set(this.catalog.flatMap((m) => m.efforts ?? []));
    const ordered = EFFORT_ORDER.filter((e) => all.has(e));
    return ordered.length ? ordered : CODEX_EFFORTS;
  }

  /** Free and local: `codex debug models` prints the catalog the CLI keeps for the signed-in account. */
  async fetchModels(): Promise<ModelOption[]> {
    const bin = await resolveCodexBin();
    if (!bin) return this.models();
    const r = await runCapture(bin, ['debug', 'models'], 20_000);
    const list = parseCodexCatalog(r.stdout);
    if (list.length) this.catalog = list;
    return this.models();
  }

  /** Free: `codex --version` and `codex login status` (exit 0 = signed in, 1 = "Not logged in"). */
  async probe(force = false): Promise<EngineProbe> {
    if (!force && this.cached && Date.now() - Date.parse(this.cached.checkedAt) < PROBE_TTL_MS) return this.cached;
    const checkedAt = new Date().toISOString();
    const bin = await resolveCodexBin();
    if (!bin) {
      this.cached = { installed: false, loggedIn: false, fix: CODEX_INSTALL_FIX, detail: 'no `codex` binary on PATH', checkedAt };
      return this.cached;
    }
    const v = await runCapture(bin, ['--version'], 15_000);
    const version = /(\d+\.\d+\.\d+)/.exec(v.stdout || v.stderr)?.[1];
    const s = await runCapture(bin, ['login', 'status'], 20_000);
    const statusLine = (s.stderr || s.stdout).trim().split('\n').find((l) => l.trim()) ?? '';
    const loggedIn = s.code === 0 && !/not logged in/i.test(statusLine);
    const probe: EngineProbe = { installed: true, loggedIn, checkedAt, via: sourceOf(bin) };
    if (version) probe.version = version;
    if (statusLine) probe.detail = statusLine.slice(0, 200);
    const by = /logged in using (.+)$/i.exec(statusLine)?.[1]?.trim();
    if (loggedIn && by) probe.account = by;
    if (!loggedIn) probe.fix = CODEX_LOGIN_FIX;
    if (loggedIn) await this.fetchModels().catch(() => undefined);
    this.cached = probe;
    return probe;
  }

  run(req: BrainRunRequest, signal?: AbortSignal): AsyncIterable<BrainEvent> {
    const queue = new AsyncQueue<BrainEvent>();
    void this.spawnRun(req, queue, signal, true);
    return queue;
  }

  private async spawnRun(req: BrainRunRequest, queue: AsyncQueue<BrainEvent>, signal: AbortSignal | undefined, allowRetry: boolean): Promise<void> {
    const bin = await resolveCodexBin();
    if (!bin) { queue.push({ type: 'error', message: CODEX_INSTALL_FIX }); queue.close(); return; }
    let prompt: string;
    try {
      const layer = await loadAgentLayer(req.cwd);
      const runtime = req.systemAppendFile ? await fs.readFile(req.systemAppendFile, 'utf8').catch(() => '') : '';
      prompt = buildCodexPrompt(req.prompt, layer, runtime);
    } catch (err) {
      queue.push({ type: 'error', message: `failed to prepare the Codex prompt: ${err instanceof Error ? err.message : String(err)}` });
      queue.close();
      return;
    }
    const args = buildCodexArgs(req);

    let child: ChildProcess;
    try {
      child = spawn(bin, args, { cwd: req.cwd, env: sanitizeEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      queue.push({ type: 'error', message: `failed to start codex: ${err instanceof Error ? err.message : String(err)}` });
      queue.close();
      return;
    }
    const parser = createCodexJsonlParser();
    let finished = false; // a result reached the queue
    let sawThread = false;
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
    child.stdin?.end(prompt);
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); if (stderr.length > 20_000) stderr = stderr.slice(-20_000); });

    const rl = readline.createInterface({ input: child.stdout as NodeJS.ReadableStream });
    rl.on('line', (line) => {
      for (const ev of parser.feed(line)) {
        if (ev.type === 'init') sawThread = true;
        if (ev.type === 'result') finished = true;
        queue.push(ev);
      }
    });

    child.on('error', (err) => { queue.push({ type: 'error', message: `codex process error: ${err.message}` }); finished = true; });
    child.on('close', (code) => {
      if (killTimer) clearTimeout(killTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      rl.close();
      if (finished) { queue.close(); return; }
      // Codex's stderr is tracing noise (`… ERROR codex_api::…`); its last notice says what went wrong in plain words.
      const tail = parser.lastNotice || stderr.trim().split('\n').filter((l) => l.trim()).slice(-3).join(' | ');
      if (!signal?.aborted && req.sessionId && !sawThread && allowRetry) {
        // The saved session is gone (or not resumable): start fresh and keep the UI thread.
        const { sessionId: _dropped, ...fresh } = req;
        void this.spawnRun(fresh, queue, signal, false);
        return;
      }
      const reason = signal?.aborted ? 'run cancelled' : `codex exited with code ${code ?? 'null'}${tail ? `: ${tail}` : ''}`;
      queue.push({ type: 'error', message: reason });
      queue.close();
    });
  }
}
