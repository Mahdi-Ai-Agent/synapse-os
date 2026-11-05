import { privateHistory } from './private-history';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { hasUrl, MODE_HINT, replyLanguage, replyLanguageLine, replyReminder, scopeHint, SKILL_PREFIX, WEB_HINT, type BrainEngine, type BrainEvent, type BrainMode, type EngineId, type ReplyLanguage, type TokenUsage } from '@synapse/brain';
import { CLOSED_STATUSES, MIND_MAP, newId, nowIso, scopesOf } from '@synapse/core';
import { HttpError } from './context';
import { pickDefaultEffort, type SettingsStore } from './settings';
import type { ChangeSet, VaultGit } from './vault-git';
import type { VaultService } from './vault-service';

export type { BrainMode };

export interface RunInput {
  prompt: string;
  mode: BrainMode;
  threadId?: string;
  /** Engine for this run; the selected one in settings otherwise. A thread switching engines starts a new engine session. */
  engine?: EngineId;
  model?: string;
  effort?: string;
  focusId?: string;
  view?: string;
  locale?: 'fa' | 'en';
  /** Inbox file this run files (`nodes/inbox/*.md`): deleted by the app after a run that changed the vault. */
  inboxPath?: string;
  /** What the thread shows for this message when the prompt is an instruction written by the app (inbox filing, reviews). */
  display?: string;
  /** The scope the run works in (UI-DESIGN "Scopes"): `mind` for the core, or the id of a map cut off from the mind map; the core when absent. */
  scope?: string;
}

/** Node ids for created/updated, vault-relative paths for deleted. */
export interface NodeChanges {
  created: string[];
  updated: string[];
  deleted: string[];
  commit?: string;
}

export interface ThreadMessage {
  id: string;
  role: 'user' | 'brain';
  text: string;
  /** Shown instead of `text` for app-written prompts. */
  display?: string;
  at: string;
  mode?: BrainMode;
  runId?: string;
  changes?: NodeChanges;
  costUsd?: number;
  tokens?: TokenUsage;
  isError?: boolean;
}

export interface Thread {
  id: string;
  title: string;
  engineId: EngineId;
  engineSessionId?: string;
  createdAt: string;
  updatedAt: string;
  messages: ThreadMessage[];
}

export interface RunState {
  runId: string;
  threadId: string;
  mode: BrainMode;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  startedAt: string;
}

/**
 * Where a run's time went, from `brain.started` (the engine is spawned right after): to the engine's first event (its
 * `init`: the CLI is up), to its first output (text or a tool call: the model answered), and to the end. Carried by
 * `brain.done` and logged by the server, so a slow run says which part was slow (docs/ARCHITECTURE.md "Diagnostics").
 */
export interface RunTiming {
  firstEventMs?: number;
  firstOutputMs?: number;
  totalMs: number;
  /** The engine's last notice (an API retry, a reconnect), when it sent one. */
  lastNotice?: string;
}

/** A run whose engine sends nothing for this long is stopped, so a hung process never holds the queue. */
export const DEFAULT_STALL_MS = 15 * 60_000;

/**
 * Subject of a run's vault commit: the last prose line of the reply (the brain's one sentence on what it did), not a
 * `created …` / `updated …` list line and not narration that leaked ahead of the reply on a long run.
 */
export function commitLabel(reply: string, fallback: string): string {
  const lines = reply.split('\n').map((l) => l.trim()).filter(Boolean);
  // A list item names a node; a heading or a line that is bold alone ("**Now**") titles what follows: neither says what was done.
  const prose = lines.filter((l) => !/^([-*•]|\d+[.)])\s/.test(l) && !/^#{1,6}\s/.test(l) && !/^\*\*[^*]+\*\*:?$/.test(l));
  return (prose[prose.length - 1] ?? lines[0] ?? fallback).slice(0, 72);
}

/** Who runs now and who waits, in order; broadcast as `brain.queue` whenever it changes. */
export interface QueueState {
  running: string | null;
  queued: string[];
}

/** `POST /api/brain/run` response: `position` = runs ahead of this one when it was enqueued (0 = starts now). */
export interface RunStart {
  runId: string;
  threadId: string;
  queued: boolean;
  position: number;
}

interface Job { runId: string; threadId: string; input: RunInput }

const VAULT_DATA = /^(nodes|index|memory)(\/|$)/;
const WRITE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit|write_file|edit_file|file_change)$/;
/** Searches that may name no folder: they look through the whole vault, and the core lights up. */
const SEARCH_TOOLS = /^(Grep|Glob|LS|grep|list_files)$/;
/** A shell command writes when it redirects into a file, moves, copies, deletes or edits in place. */
const SHELL_WRITES = /(^|[^<>&|0-9])>{1,2}\s*[^&\s]|\btee\b|\bsed\s+-[a-z]*i|\bperl\s+-[a-z]*i|\b(mv|cp|rm|mkdir|touch|apply_patch)\b/;
const MAX_PATHS = 12;

/** The vault-relative path of a file or folder under nodes/, index/ or memory/; undefined for anything else. */
function vaultPath(raw: string, root: string): string | undefined {
  const p = raw.trim().replace(/^\.\//, '').replace(/[*?[{].*$/, '').replace(/\/+$/, '');
  if (!p) return undefined;
  const rel = path.relative(root, path.isAbsolute(p) ? p : path.join(root, p)).split(path.sep).join('/');
  return !rel.startsWith('..') && VAULT_DATA.test(rel) ? rel : undefined;
}

/**
 * The vault paths a shell command names (Codex reads with `sed`, `cat`, `rg` inside `bash -lc '…'`). A quoted
 * argument that is a vault path is taken whole, since a Persian file name may hold spaces; any other quoted part is a
 * command inside the command and is opened and read again; then every word on its own.
 */
export function commandPaths(command: string, root: string): string[] {
  const out = new Set<string>();
  const add = (w: string): void => {
    const rel = out.size < MAX_PATHS ? vaultPath(w, root) : undefined;
    if (rel) out.add(rel);
  };
  let rest = command;
  for (let pass = 0; pass < 4 && /['"]/.test(rest); pass++) {
    rest = rest.replace(/'([^']*)'|"([^"]*)"/g, (_whole, single?: string, double?: string) => {
      const q = single ?? double ?? '';
      if (vaultPath(q, root)) { add(q); return ' '; }
      return ` ${q} `;
    });
  }
  for (const w of rest.split(/[\s;|&()<>]+/)) add(w.replace(/^[`]+|[`,]+$/g, '').replace(/^-[-\w]*=/, ''));
  return [...out];
}

/**
 * What a tool use touched in the vault, for the map's live signals (UI-DESIGN "Living graph" → The brain at work):
 * vault-relative paths under nodes/, index/ or memory/, and whether the tool read or wrote them. Claude Code and the
 * API engines name a file (`file_path`, `path`); Codex runs shell commands and sends its edits as `file_change`.
 */
export function touchedBy(name: string, input: unknown, root: string): { paths: string[]; kind: 'read' | 'write' } | undefined {
  const i = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  let paths: string[] = [];
  let write = WRITE_TOOLS.test(name);
  if (name === 'file_change' && Array.isArray(i['changes'])) {
    paths = i['changes'].map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>)['path'] : undefined))
      .filter((p): p is string => typeof p === 'string').map((p) => vaultPath(p, root)).filter((p): p is string => Boolean(p));
  } else if (typeof i['command'] === 'string') {
    paths = commandPaths(i['command'], root);
    write = SHELL_WRITES.test(i['command']);
  } else {
    const raw = [i['file_path'], i['notebook_path'], i['path']].find((v): v is string => typeof v === 'string' && v.length > 0);
    const rel = raw ? vaultPath(raw, root) : undefined;
    if (rel) paths = [rel];
    else if (SEARCH_TOOLS.test(name) && (!raw || path.resolve(root, raw) === path.resolve(root))) paths = ['index'];
  }
  if (!paths.length) return undefined;
  return { paths: [...new Set(paths)].slice(0, MAX_PATHS), kind: write ? 'write' : 'read' };
}

/** Runs engine turns one at a time against the vault, keeps threads, snapshots the vault around each run. */
export class BrainRunner extends EventEmitter {
  private threads = new Map<string, Thread>();
  private queue: Job[] = [];
  private current: { runId: string; abort: AbortController } | null = null;
  private runs = new Map<string, RunState>();

  constructor(
    private readonly vault: VaultService,
    private readonly git: VaultGit,
    private readonly engines: Map<EngineId, BrainEngine>,
    private readonly settings: SettingsStore,
    private readonly opts: { stallMs?: number; privateSessions?: boolean } = {},
  ) {
    super();
  }

  private get sessionsFile(): string {
    return path.join(this.vault.root, '.synapse', 'sessions.json');
  }

  private get runtimeContextFile(): string {
    return path.join(this.vault.root, '.synapse', 'runtime-context.md');
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.sessionsFile, 'utf8')) as { threads?: Thread[] };
      for (const t of raw.threads ?? []) this.threads.set(t.id, t);
    } catch { /* fresh */ }
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.sessionsFile), { recursive: true });
    const threads = [...this.threads.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100);
    await fs.writeFile(this.sessionsFile, JSON.stringify({ threads }, null, 2), 'utf8');
  }

  listThreads(): Array<{ id: string; title: string; updatedAt: string; messageCount: number }> {
    return [...this.threads.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((t) => ({ id: t.id, title: t.title, updatedAt: t.updatedAt, messageCount: t.messages.length }));
  }

  getThread(id: string): Thread | undefined {
    return this.threads.get(id);
  }

  /** Renames a chat (the chats list's menu). */
  async renameThread(id: string, title: string): Promise<Thread> {
    const t = this.threads.get(id);
    if (!t) throw new HttpError(404, 'thread not found');
    const next = title.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!next) throw new HttpError(400, 'a chat needs a title');
    t.title = next;
    await this.save();
    return t;
  }

  /** Deletes a chat; refused while the brain is still answering in it. */
  async deleteThread(id: string): Promise<void> {
    if (!this.threads.has(id)) throw new HttpError(404, 'thread not found');
    if ([...this.runs.values()].some((r) => r.threadId === id && (r.status === 'queued' || r.status === 'running'))) throw new HttpError(409, 'the brain is still answering in this chat; delete it when the reply is done');
    this.threads.delete(id);
    await this.save();
  }

  getRun(runId: string): RunState | undefined {
    return this.runs.get(runId);
  }

  get busy(): boolean {
    return this.current !== null;
  }

  queueState(): QueueState {
    return { running: this.current?.runId ?? null, queued: this.queue.map((j) => j.runId) };
  }

  private emitQueue(): void {
    this.emit('queue', this.queueState());
  }

  async start(input: RunInput): Promise<RunStart> {
    const now = nowIso();
    const settings = await this.settings.get();
    let thread = input.threadId ? this.threads.get(input.threadId) : undefined;
    if (!thread) {
      thread = {
        id: newId(),
        title: (input.display ?? input.prompt).trim().split('\n')[0]?.slice(0, 60) || input.mode,
        engineId: input.engine ?? (settings.engine as EngineId),
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      this.threads.set(thread.id, thread);
    }
    const runId = newId();
    thread.messages.push({ id: newId(), role: 'user', text: input.prompt, ...(input.display ? { display: input.display } : {}), at: now, mode: input.mode, runId });
    thread.updatedAt = now;
    this.runs.set(runId, { runId, threadId: thread.id, mode: input.mode, status: 'queued', startedAt: now });
    const job: Job = { runId, threadId: thread.id, input };
    this.queue.push(job);
    this.emitQueue();
    await this.save();
    // Runs ahead of this one right before pumping: the running one plus earlier jobs (a job the pump already took is at 0).
    const idx = this.queue.indexOf(job);
    const position = idx < 0 ? 0 : idx + (this.current && this.current.runId !== runId ? 1 : 0);
    void this.pump();
    return { runId, threadId: thread.id, queued: position > 0, position };
  }

  /** Forgets every thread and run (Erase everything): the sessions file is gone already. */
  forgetThreads(): void {
    this.threads.clear();
    this.runs.clear();
  }

  /**
   * Cancels everything queued and the run at work, then waits (at most `waitMs`) for that run to end: its partial edits
   * are committed as a cancelled run. Called when the server closes.
   */
  async stopAll(waitMs = 12_000): Promise<void> {
    for (const job of [...this.queue]) this.cancel(job.runId);
    const current = this.current;
    if (!current) return;
    const ended = new Promise<void>((resolve) => {
      const onDone = (p: { runId?: string }): void => { if (p.runId === current.runId) { this.off('done', onDone); resolve(); } };
      this.on('done', onDone);
    });
    current.abort.abort();
    await Promise.race([ended, new Promise<void>((resolve) => setTimeout(resolve, waitMs).unref())]);
  }

  cancel(runId: string): boolean {
    if (this.current?.runId === runId) { this.current.abort.abort(); return true; }
    const idx = this.queue.findIndex((j) => j.runId === runId);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
      const st = this.runs.get(runId); if (st) st.status = 'cancelled';
      this.emitQueue();
      this.emit('done', { runId, threadId: st?.threadId, ok: false, error: 'cancelled' });
      return true;
    }
    return false;
  }

  private async pump(): Promise<void> {
    if (this.current || this.queue.length === 0) return;
    const job = this.queue.shift() as Job;
    this.current = { runId: job.runId, abort: new AbortController() };
    this.emitQueue();
    try {
      await this.execute(job, this.current.abort);
    } finally {
      this.current = null;
      this.emitQueue();
      void this.pump();
    }
  }

  /** The Scope line, only when some map is cut off from the mind map (one core needs no line). */
  private scopeLines(wanted: string | undefined): string[] {
    const scopes = scopesOf(this.vault.graph?.maps ?? []);
    if (scopes.length < 2) return [];
    const scope = scopes.find((s) => s.id === (wanted ?? MIND_MAP)) ?? scopes[0]!;
    const outside = scopes.filter((s) => s !== scope).flatMap((s) => s.maps.map((m) => m.title));
    return [`- Scope: ${scopeHint(scope.core, scope.maps.map((m) => m.title), outside)}`];
  }

  private async writeRuntimeContext(input: RunInput, locale: string, lang: ReplyLanguage, history = ''): Promise<string> {
    const now = new Date();
    const nodes = this.vault.listNodes();
    const openTasks = nodes.filter((n) => n.fm.type === 'task' && !CLOSED_STATUSES.has(n.fm.status)).length;
    const inbox = nodes.filter((n) => n.fm.type === 'inbox').length;
    const focus = input.focusId ? this.vault.getNode(input.focusId) : undefined;
    const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
    const lines = [
      '# Runtime context (written by Synapse before this run; do not edit)',
      `- Now: ${nowIso()} (${weekday})`,
      ...(locale === 'fa' ? [`- Today in the Persian calendar: ${new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle: 'full' }).format(now)} (use it for Persian dates; never convert by hand)`] : []),
      `- UI language: ${locale}`,
      '- Clock: write times of day in 24-hour form (07:30, 14:05), never AM/PM or its words in any language',
      replyLanguageLine(lang),
      `- Mode: ${input.mode} → ${MODE_HINT[input.mode]}`,
      ...this.scopeLines(input.scope),
      ...(hasUrl(input.prompt) ? [`- Web: ${WEB_HINT}`] : []),
      `- Focused node: ${focus ? `[[${focus.fm.title}]] (${focus.path})` : 'none'}`,
      `- View: ${input.view ?? 'graph'}`,
      `- Vault: ${nodes.length - inbox} nodes · ${openTasks} open tasks · ${inbox} inbox items`,
      '', history,
    ];
    await fs.mkdir(path.dirname(this.runtimeContextFile), { recursive: true });
    await fs.writeFile(this.runtimeContextFile, lines.join('\n'), 'utf8');
    return this.runtimeContextFile;
  }

  /**
   * Inbox items are consumed by the app, not the brain (CLI engines have no delete tool): after the run, every inbox
   * file the brain marked `status: filed` is deleted, as is the run's own `inboxPath` once the brain changed anything.
   * Returns an error when the run targeted an inbox item but changed nothing (the item stays).
   */
  private async consumeInbox(input: RunInput, dirty: boolean): Promise<string | undefined> {
    const consumed = this.vault.listNodes().filter((n) => n.fm.type === 'inbox' && (n.fm.status === 'filed' || (dirty && n.path === input.inboxPath)));
    for (const n of consumed) await this.vault.deleteNode(n.fm.id);
    if (input.inboxPath && !consumed.some((n) => n.path === input.inboxPath) && this.vault.getNodeByPath(input.inboxPath)) {
      return 'nothing was filed; the inbox item stays';
    }
    return undefined;
  }

  private mapChanges(set: ChangeSet): NodeChanges {
    const toId = (p: string): string | null => this.vault.getNodeByPath(p)?.fm.id ?? null;
    const changes: NodeChanges = {
      created: set.created.map(toId).filter((x): x is string => x !== null),
      updated: set.updated.map(toId).filter((x): x is string => x !== null),
      deleted: set.deleted,
    };
    if (set.commit) changes.commit = set.commit;
    return changes;
  }

  private async execute(job: Job, abort: AbortController): Promise<void> {
    const { runId, threadId, input } = job;
    const state = this.runs.get(runId) as RunState;
    const thread = this.threads.get(threadId) as Thread;
    const settings = await this.settings.get();
    const engine = (input.engine ? this.engines.get(input.engine) : undefined) ?? this.engines.get(settings.engine as EngineId) ?? this.engines.get('claude-cli');
    const t0 = Date.now();
    const timing: RunTiming = { totalMs: 0 };
    const finish = async (text: string, extra: Partial<ThreadMessage>, changes: NodeChanges | undefined, error?: string): Promise<void> => {
      const msg: ThreadMessage = { id: newId(), role: 'brain', text, at: nowIso(), mode: input.mode, runId, ...extra };
      if (changes) msg.changes = changes;
      thread.messages.push(msg);
      thread.updatedAt = msg.at;
      state.status = error ? 'error' : 'done';
      timing.totalMs = Date.now() - t0;
      await this.save();
      if (changes) this.emit('changes', { runId, threadId, ...changes });
      this.emit('done', { runId, threadId, ok: !error, error, message: msg, timing });
      void engine?.probe(true).catch(() => undefined); // refresh login state for the next /api/engines
    };

    if (!engine) { await finish('', { isError: true }, undefined, `engine "${settings.engine}" is not available`); return; }
    if (thread.engineId !== engine.id) { thread.engineId = engine.id; delete thread.engineSessionId; } // sessions never cross engines
    const defaults = this.settings.defaultsFor(settings, engine.id);
    const model = input.model ?? defaults.model ?? engine.models()[0]?.id;
    const effort = input.effort ?? defaults.effort ?? pickDefaultEffort(engine.efforts());

    state.status = 'running';
    this.emit('started', { runId, threadId, mode: input.mode, engine: engine.id, model });
    const locale = input.locale ?? settings.locale;
    const text = input.prompt.trim();
    // The user's own words choose the reply's language; a prompt the app wrote (it carries a `display`) follows the UI.
    const lang: ReplyLanguage = input.display ? (locale === 'en' ? 'en' : 'fa') : replyLanguage(text, locale === 'en' ? 'en' : 'fa');
    const ephemeral = this.opts.privateSessions === true && (engine.id === 'claude-cli' || engine.id === 'codex-cli');
    const contextFile = await this.writeRuntimeContext(input, locale, lang, ephemeral ? privateHistory(thread.messages, runId) : '');
    await this.git.snapshot('manual: edits before brain run');

    const prefix = SKILL_PREFIX[input.mode];
    const prompt = `${prefix ? `${prefix} ${text}` : text}${replyReminder(lang)}`;
    let streamed = '';
    let result: Extract<BrainEvent, { type: 'result' }> | null = null;
    let error: string | undefined;
    // The stall watchdog: re-armed by every event; a silent engine is aborted and the run ends with its own error.
    const stallMs = this.opts.stallMs ?? DEFAULT_STALL_MS;
    let stalled = false;
    let stallTimer: NodeJS.Timeout | null = null;
    const arm = (): void => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => { stalled = true; abort.abort(); }, stallMs);
    };
    arm();
    try {
      const events = engine.run(
        { prompt, cwd: this.vault.root, allowWeb: hasUrl(text), ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(ephemeral ? { ephemeral: true } : thread.engineSessionId ? { sessionId: thread.engineSessionId } : {}), systemAppendFile: contextFile, maxTurns: 40 },
        abort.signal,
      );
      for await (const ev of events) {
        arm();
        if (timing.firstEventMs === undefined) timing.firstEventMs = Date.now() - t0;
        if (timing.firstOutputMs === undefined && (ev.type === 'text_delta' || ev.type === 'tool_use')) timing.firstOutputMs = Date.now() - t0;
        if (ev.type === 'init' && ev.sessionId) thread.engineSessionId = ev.sessionId;
        else if (ev.type === 'text_delta') streamed += ev.text;
        else if (ev.type === 'result') { result = ev; if (ev.sessionId) thread.engineSessionId = ev.sessionId; }
        else if (ev.type === 'error') error = ev.message;
        else if (ev.type === 'notice') timing.lastNotice = ev.message;
        this.emit('event', { runId, threadId, event: ev, ...(ev.type === 'tool_use' ? { touched: touchedBy(ev.name, ev.input, this.vault.root) } : {}) });
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
    }
    if (stalled) {
      error = `the engine sent nothing for ${Math.round(stallMs / 60_000)} minutes and was stopped${timing.lastNotice ? ` (its last notice: ${timing.lastNotice})` : ''}`;
    } else if (abort.signal.aborted) { error = 'cancelled'; state.status = 'cancelled'; }
    if (result?.isError) {
      error = error ?? (result.text || 'engine reported an error');
      if (/session|resume|conversation/i.test(result.text)) delete thread.engineSessionId; // stale session: start fresh next time
    }

    const dirty = await this.git.isDirty();
    await this.vault.rebuildNow('brain');
    if (!error) error = await this.consumeInbox(input, dirty);
    const label = commitLabel(result?.text || streamed || text, input.mode);
    const changeSet = await this.git.commitChanges(`brain(${input.mode}): ${label}`);
    const changes = this.mapChanges(changeSet);
    const finalText = streamed || result?.text || error || '';
    const extra: Partial<ThreadMessage> = { isError: Boolean(error) };
    if (result?.costUsd !== undefined) extra.costUsd = result.costUsd;
    if (result?.tokens) extra.tokens = result.tokens;
    await finish(finalText, extra, changes, error);
  }
}
