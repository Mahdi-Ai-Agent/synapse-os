import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrainEngine, BrainEvent, BrainRunRequest, EngineId } from '@synapse/brain';
import { createVault } from '@synapse/vault-template';
import { BrainRunner, type QueueState, type RunTiming } from '../src/brain-runner';
import { SettingsStore } from '../src/settings';
import { VaultGit } from '../src/vault-git';
import { VaultService } from '../src/vault-service';

/** Engine whose runs block until released, so the queue can be observed. */
class FakeEngine implements BrainEngine {
  readonly id = 'claude-cli' as const;
  readonly name = 'fake';
  readonly auth = 'cli-login' as const;
  readonly releases = new Map<string, () => void>();
  readonly released = new Set<string>();
  readonly prompts: string[] = [];
  /** What the "brain" does to the vault during a run, keyed by prompt. */
  readonly effects = new Map<string, (cwd: string) => Promise<void>>();

  async probe(): Promise<{ installed: boolean; loggedIn: boolean; checkedAt: string }> {
    return { installed: true, loggedIn: true, checkedAt: new Date().toISOString() };
  }
  models(): Array<{ id: string; label: string }> { return [{ id: 'fake-1', label: 'Fake' }]; }
  efforts(): string[] { return []; }
  /** Every prompt as the engine got it, the reply-language reminder at its end included. */
  readonly raw: string[] = [];
  run(req: BrainRunRequest, signal?: AbortSignal): AsyncIterable<BrainEvent> {
    this.raw.push(req.prompt);
    // The fake answers by the user's words; the runner adds the reply-language reminder after them.
    const prompt = req.prompt.split('\n\n(Write your reply in ')[0]!;
    this.prompts.push(prompt);
    // The gate is registered synchronously so `release()` works no matter how far the consumer has pulled.
    let open!: () => void;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    this.releases.set(prompt, open);
    if (this.released.has(prompt)) open();
    signal?.addEventListener('abort', () => open(), { once: true });
    const effect = this.effects.get(prompt);
    return (async function* () {
      yield { type: 'init', sessionId: 's1' } as BrainEvent;
      if (effect) await effect(req.cwd);
      await gate;
      yield { type: 'result', text: `done: ${prompt}`, sessionId: 's1', isError: false, costUsd: 0.01 } as BrainEvent;
    })();
  }
  release(prompt: string): void { this.released.add(prompt); this.releases.get(prompt)?.(); }
}

let root = '';
let vault: VaultService;
let runner: BrainRunner;
const engine = new FakeEngine();
const queueEvents: QueueState[] = [];
const started: string[] = [];
const done: Array<{ runId: string; ok: boolean; error?: string; timing?: RunTiming }> = [];

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-runner-'));
  await createVault(root);
  vault = new VaultService(root);
  await vault.start();
  const git = new VaultGit(root);
  await git.ensureRepo();
  runner = new BrainRunner(vault, git, new Map<EngineId, BrainEngine>([['claude-cli', engine]]), new SettingsStore(root));
  runner.on('queue', (q: QueueState) => queueEvents.push(q));
  runner.on('started', (p: { runId: string }) => started.push(p.runId));
  runner.on('done', (p: { runId: string; ok: boolean; error?: string; timing?: RunTiming }) => done.push(p));
});

afterAll(async () => {
  await vault.stop();
  await fs.rm(root, { recursive: true, force: true });
});

const waitFor = async (cond: () => boolean, ms = 5000): Promise<void> => {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('BrainRunner queue', () => {
  it('reports the position at enqueue time and broadcasts every queue change', async () => {
    const a = await runner.start({ prompt: 'A', mode: 'chat' });
    expect(a).toMatchObject({ queued: false, position: 0 });
    await waitFor(() => started.includes(a.runId));
    await waitFor(() => engine.prompts.length === 1); // the engine is spawned after the runtime context + git snapshot
    expect(runner.queueState()).toEqual({ running: a.runId, queued: [] });

    const b = await runner.start({ prompt: 'B', mode: 'chat' });
    const c = await runner.start({ prompt: 'C', mode: 'chat' });
    expect(b).toMatchObject({ queued: true, position: 1 });
    expect(c).toMatchObject({ queued: true, position: 2 });
    expect(runner.getRun(b.runId)?.status).toBe('queued');
    expect(runner.queueState()).toEqual({ running: a.runId, queued: [b.runId, c.runId] });
    expect(queueEvents.at(-1)).toEqual({ running: a.runId, queued: [b.runId, c.runId] });

    // Cancelling a queued run removes it without touching the running one.
    expect(runner.cancel(c.runId)).toBe(true);
    expect(runner.getRun(c.runId)?.status).toBe('cancelled');
    expect(done.find((d) => d.runId === c.runId)).toMatchObject({ ok: false, error: 'cancelled' });
    expect(runner.queueState()).toEqual({ running: a.runId, queued: [b.runId] });
    expect(engine.prompts).toHaveLength(1); // C never reached the engine

    engine.release('A');
    await waitFor(() => started.includes(b.runId));
    expect(done.find((d) => d.runId === a.runId)).toMatchObject({ ok: true });
    // Where the time went travels with `done`: the engine's first event and the whole run are measured from `started`.
    const timing = done.find((d) => d.runId === a.runId)?.timing;
    expect(timing?.firstEventMs).toBeGreaterThanOrEqual(0);
    expect(timing?.totalMs).toBeGreaterThanOrEqual(timing?.firstEventMs ?? 0);
    expect(timing?.firstOutputMs).toBeUndefined(); // the fake engine sends no text and no tool call
    expect(runner.getRun(b.runId)?.status).toBe('running');
    expect(queueEvents.slice(-2)).toEqual([{ running: null, queued: [b.runId] }, { running: b.runId, queued: [] }]);

    await waitFor(() => engine.prompts.length === 2);
    engine.release('B');
    await waitFor(() => done.some((d) => d.runId === b.runId));
    expect(runner.queueState()).toEqual({ running: null, queued: [] });
    expect(runner.busy).toBe(false);
    expect(runner.cancel('nope')).toBe(false);
  }, 15_000);
});

describe('BrainRunner inbox consumption', () => {
  const waitDone = async (runId: string): Promise<{ ok: boolean; error?: string }> => {
    await waitFor(() => done.some((d) => d.runId === runId));
    return done.find((d) => d.runId === runId) as { ok: boolean; error?: string };
  };

  it('deletes an inbox file the brain marked filed, and the run\'s own inboxPath once the brain changed the vault', async () => {
    const marked = await vault.capture('mark me');
    const own = await vault.capture('file me');
    const prompt = '/capture file both';
    engine.effects.set(prompt, async (cwd) => {
      const p = path.join(cwd, marked.path);
      await fs.writeFile(p, (await fs.readFile(p, 'utf8')).replace('status: new', 'status: filed'));
      await fs.writeFile(path.join(cwd, 'nodes', 'notes', 'filed-note.md'), '---\ntype: note\ntitle: Filed note\nsummary: from the inbox\nstatus: active\n---\nbody\n');
    });
    engine.release(prompt);
    const r = await runner.start({ prompt: 'file both', mode: 'capture', inboxPath: own.path });
    const d = await waitDone(r.runId);
    expect(d.ok).toBe(true);
    expect(vault.getNodeByPath(marked.path)).toBeUndefined();
    expect(vault.getNodeByPath(own.path)).toBeUndefined();
    await expect(fs.access(path.join(root, own.path))).rejects.toThrow();
    const changes = runner.getThread(r.threadId)?.messages.at(-1)?.changes;
    expect(changes?.deleted.sort()).toEqual([marked.path, own.path].sort());
    expect(changes?.created.length).toBe(1);
  });

  it('keeps the inbox item and reports an error when the brain changed nothing', async () => {
    const own = await vault.capture('untouched');
    const prompt = '/capture no-op';
    engine.release(prompt);
    const r = await runner.start({ prompt: 'no-op', mode: 'capture', inboxPath: own.path });
    const d = await waitDone(r.runId);
    expect(d.ok).toBe(false);
    expect(d.error).toMatch(/nothing was filed/);
    expect(vault.getNodeByPath(own.path)?.fm.status).toBe('new');
  });
});

describe('BrainRunner stall watchdog', () => {
  it('stops a run whose engine stays silent and says so, naming its last notice', async () => {
    const silent = new FakeEngine();
    const noticed = new Map<string, string>();
    silent.run = (req, signal) => {
      silent.prompts.push(req.prompt);
      return (async function* () {
        yield { type: 'init', sessionId: 'quiet' } as BrainEvent;
        yield { type: 'notice', message: 'API retry 2/10 (HTTP 529 overloaded_error) · next try in 30 s' } as BrainEvent;
        await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
      })();
    };
    const watched = new BrainRunner(vault, new VaultGit(root), new Map<EngineId, BrainEngine>([['claude-cli', silent]]), new SettingsStore(root), { stallMs: 300 });
    const finished: Array<{ runId: string; ok: boolean; error?: string }> = [];
    watched.on('done', (p: { runId: string; ok: boolean; error?: string }) => finished.push(p));
    watched.on('event', (p: { event: BrainEvent }) => { if (p.event.type === 'notice') noticed.set('last', p.event.message); });
    const r = await watched.start({ prompt: 'quiet one', mode: 'chat' });
    await waitFor(() => finished.some((d) => d.runId === r.runId), 5000);
    const d = finished.find((x) => x.runId === r.runId);
    expect(d?.ok).toBe(false);
    expect(d?.error).toBe('the engine sent nothing for 0 minutes and was stopped (its last notice: API retry 2/10 (HTTP 529 overloaded_error) · next try in 30 s)');
    expect(watched.getRun(r.runId)?.status).toBe('error');
    expect(noticed.get('last')).toContain('API retry 2/10');
    expect(watched.busy).toBe(false);
  });
});

describe('BrainRunner reply language', () => {
  const ask = async (input: { prompt: string; display?: string; locale?: 'fa' | 'en' }): Promise<string> => {
    const r = await runner.start({ mode: 'chat', ...input });
    await waitFor(() => engine.prompts.includes(input.prompt));
    const sent = engine.raw.at(-1)!;
    engine.release(input.prompt);
    await waitFor(() => done.some((d) => d.runId === r.runId));
    return sent;
  };

  it("tells the engine to answer in the language of the user's message, and an app-written prompt in the UI's", async () => {
    expect(await ask({ prompt: 'فردا چه کارهایی دارم؟', locale: 'en' })).toMatch(/\(Write your reply in Persian \(فارسی\)\.\)$/);
    expect(await ask({ prompt: 'What is due this week?', locale: 'fa' })).toMatch(/\(Write your reply in English\.\)$/);
    expect(await ask({ prompt: 'Run the weekly review and append it to today.', display: 'مرور هفتگی', locale: 'fa' })).toMatch(/\(Write your reply in Persian \(فارسی\)\.\)$/);
    const context = await fs.readFile(path.join(root, '.synapse', 'runtime-context.md'), 'utf8');
    expect(context).toContain('- UI language: fa');
    expect(context).toContain('- Clock: write times of day in 24-hour form');
    expect(context).toContain('- Reply language: Persian (فارسی)');
  });
});
