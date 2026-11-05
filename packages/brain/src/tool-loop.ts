import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildSystemPrompt, expandSkillPrompt, loadAgentLayer, rulesForPath, type SystemPrompt } from './agent-layer';
import type { AsyncQueue } from './async-queue';
import { clip, summarizeToolUse } from './stream-json';
import { VaultTools, type ToolDefinition } from './tools/vault-tools';
import type { BrainEvent, BrainRunRequest, EngineId, TokenUsage } from './types';

/**
 * Provider-agnostic agentic loop for the API engines: system prompt from the vault's agent layer, the confined
 * vault tools, folder rules injected on first touch, a persisted per-thread transcript. Spec: docs/BRAIN-ENGINES.md.
 */
export interface ToolCall { id: string; name: string; input: unknown }
export interface ToolResultMessage { toolUseId: string; content: string; isError: boolean }

export type ChatMessage =
  | { role: 'user'; text: string }
  /** `raw` keeps the provider's own assistant blocks (thinking signatures, reasoning details) for faithful replay. */
  | { role: 'assistant'; text: string; toolCalls: ToolCall[]; raw?: unknown }
  | { role: 'tool_results'; results: ToolResultMessage[] };

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export interface TurnUsage extends TokenUsage { costUsd?: number }

export interface ProviderTurn {
  text: string;
  toolCalls: ToolCall[];
  raw?: unknown;
  usage: TurnUsage;
  stopReason: StopReason;
  model?: string;
}

export interface CompleteRequest {
  system: SystemPrompt;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  model: string;
  effort?: string;
  maxTokens: number;
  signal?: AbortSignal;
  onText(delta: string): void;
}

export interface ChatProvider {
  readonly id: EngineId;
  complete(req: CompleteRequest): Promise<ProviderTurn>;
}

export interface ToolLoopOptions {
  provider: ChatProvider;
  request: BrainRunRequest;
  model: string;
  /** Folder for persisted transcripts (one JSON file per session). */
  sessionsDir: string;
  signal?: AbortSignal;
  maxTokens?: number;
}

/** Threads longer than this start a fresh provider context (the UI thread is kept by the server). */
const MAX_HISTORY = 120;
const DEFAULT_MAX_TURNS = 40;

export const TOOL_NOTES = [
  '# Tools',
  '',
  'You work through five tools: `read_file`, `list_files`, `grep`, `write_file`, `edit_file`. Paths are vault-relative.',
  '- Start with `read_file("index/INDEX.md")`; open `index/by-type/<type>.md` or `grep` before reading node files. Never list and read every node.',
  '- Writes are accepted only under `nodes/` and `memory/`; `index/` and `.synapse/` belong to the app and are rejected.',
  '- `write_file` needs the complete file (frontmatter + body); `edit_file` replaces one exact occurrence.',
  '- Where the vault instructions mention Claude Code tools (Read, Grep, Edit, Write, Skill, hooks), use the equivalents above; skills are expanded into your prompt by the app.',
].join('\n');

/** JSON transcript per engine session under `<vault>/.synapse/engine-sessions/<engine>/`. */
export class SessionStore {
  constructor(private readonly dir: string) {}

  private file(id: string): string {
    if (!/^[\w-]{1,64}$/.test(id)) throw new Error(`bad session id: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  async load(id: string): Promise<ChatMessage[] | null> {
    try {
      const raw = JSON.parse(await fs.readFile(this.file(id), 'utf8')) as { messages?: ChatMessage[] };
      return Array.isArray(raw.messages) ? raw.messages : null;
    } catch { return null; }
  }

  async save(id: string, messages: ChatMessage[]): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.file(id), JSON.stringify({ messages, updatedAt: new Date().toISOString() }), 'utf8');
  }
}

async function readOptional(p: string | undefined): Promise<string> {
  if (!p) return '';
  try { return await fs.readFile(p, 'utf8'); } catch { return ''; }
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Runs the loop, pushing events into `queue`; always ends with a `result` or an `error` and closes the queue. */
export async function runToolLoop(opts: ToolLoopOptions, queue: AsyncQueue<BrainEvent>): Promise<void> {
  const started = Date.now();
  const { provider, request: req, signal } = opts;
  const maxTurns = req.maxTurns ?? DEFAULT_MAX_TURNS;
  try {
    const layer = await loadAgentLayer(req.cwd);
    const runtime = await readOptional(req.systemAppendFile);
    const system = buildSystemPrompt(layer, { runtimeContext: runtime, toolNotes: TOOL_NOTES });
    const tools = new VaultTools(req.cwd);
    const sessions = new SessionStore(opts.sessionsDir);

    let sessionId = req.sessionId ?? '';
    let messages = sessionId ? await sessions.load(sessionId) : null;
    if (!sessionId || !messages || messages.length > MAX_HISTORY) { sessionId = randomUUID(); messages = []; }
    queue.push({ type: 'init', sessionId, model: opts.model });

    const { prompt } = expandSkillPrompt(req.prompt, layer);
    messages.push({ role: 'user', text: prompt });

    const injected = new Set<string>();
    const tokens: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let cost = 0;
    let hasCost = false;
    let text = '';
    let turns = 0;
    let isError = false;
    let note = '';
    let pendingBreak = false;

    while (turns < maxTurns) {
      if (signal?.aborted) throw new Error('run cancelled');
      turns++;
      const turn = await provider.complete({
        system, messages, tools: tools.definitions(), model: opts.model, maxTokens: opts.maxTokens ?? 32_000,
        ...(req.effort ? { effort: req.effort } : {}),
        ...(signal ? { signal } : {}),
        onText: (delta) => {
          if (!delta) return;
          if (pendingBreak) { pendingBreak = false; text += '\n\n'; queue.push({ type: 'text_delta', text: '\n\n' }); }
          text += delta;
          queue.push({ type: 'text_delta', text: delta });
        },
      });
      tokens.input += turn.usage.input;
      tokens.output += turn.usage.output;
      tokens.cacheRead = (tokens.cacheRead ?? 0) + (turn.usage.cacheRead ?? 0);
      tokens.cacheWrite = (tokens.cacheWrite ?? 0) + (turn.usage.cacheWrite ?? 0);
      if (turn.usage.costUsd !== undefined) { cost += turn.usage.costUsd; hasCost = true; }

      const assistant: ChatMessage = { role: 'assistant', text: turn.text, toolCalls: turn.toolCalls };
      if (turn.raw !== undefined) assistant.raw = turn.raw;
      messages.push(assistant);

      if (turn.stopReason === 'refusal') { isError = true; note = 'the model declined this request'; break; }
      if (turn.stopReason === 'max_tokens') { isError = turn.toolCalls.length > 0; note = 'output cut at the token limit'; break; }
      if (turn.toolCalls.length === 0) break;

      const results: ToolResultMessage[] = [];
      for (const call of turn.toolCalls) {
        queue.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input, summary: summarizeToolUse(call.name, call.input) });
        const out = await tools.call(call.name, call.input);
        let content = out.content;
        if (out.ok && out.path) {
          for (const rule of rulesForPath(layer, out.path)) {
            if (injected.has(rule.file)) continue;
            injected.add(rule.file);
            content += `\n\n[Folder rule ${rule.file} — applies to ${rule.paths.join(', ')}]\n${rule.body}`;
          }
        }
        results.push({ toolUseId: call.id, content, isError: !out.ok });
        queue.push({ type: 'tool_result', toolUseId: call.id, ok: out.ok, summary: clip(out.content) });
      }
      messages.push({ role: 'tool_results', results });
      if (turn.text.trim()) pendingBreak = true;
      if (turns >= maxTurns) { isError = true; note = `stopped after ${maxTurns} turns without a final answer`; }
    }

    await sessions.save(sessionId, messages);
    const result: Extract<BrainEvent, { type: 'result' }> = {
      type: 'result', text: text.trim() || note, sessionId, isError, numTurns: turns, durationMs: Date.now() - started, tokens,
      usage: { ...tokens, costUsd: hasCost ? round(cost) : undefined, provider: provider.id, model: opts.model },
    };
    if (hasCost) result.costUsd = round(cost);
    queue.push(result);
  } catch (err) {
    const message = signal?.aborted ? 'run cancelled' : err instanceof Error ? err.message : String(err);
    queue.push({ type: 'error', message });
  } finally {
    queue.close();
  }
}
