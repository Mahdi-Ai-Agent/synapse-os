import Anthropic from '@anthropic-ai/sdk';
import { costFor, priceOf } from '../pricing';
import type { ChatMessage, ChatProvider, CompleteRequest, ProviderTurn, StopReason, ToolCall } from '../tool-loop';
import type { ModelOption } from '../types';

/** Static defaults; `fetchModels` replaces them with the live list from `GET /v1/models`. */
export const ANTHROPIC_MODELS: ModelOption[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
];
export const ANTHROPIC_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

type Effort = NonNullable<Anthropic.OutputConfig['effort']>;
const isEffort = (e: string | undefined): e is Effort => e !== undefined && (ANTHROPIC_EFFORTS as string[]).includes(e);

export interface AnthropicProviderOptions {
  apiKey: string;
  baseURL?: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

export interface KeyCheck { ok: boolean; rejected?: boolean; detail?: string }

function makeClient(opts: AnthropicProviderOptions, maxRetries: number): Anthropic {
  return new Anthropic({
    apiKey: opts.apiKey,
    maxRetries,
    timeout: 10 * 60_000,
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
}

export function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.text });
    } else if (m.role === 'assistant') {
      if (Array.isArray(m.raw) && m.raw.length) {
        out.push({ role: 'assistant', content: m.raw as Anthropic.ContentBlockParam[] });
      } else {
        const content: Anthropic.ContentBlockParam[] = [];
        if (m.text) content.push({ type: 'text', text: m.text });
        for (const tc of m.toolCalls) content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
        if (content.length) out.push({ role: 'assistant', content });
      }
    } else {
      out.push({
        role: 'user',
        content: m.results.map((r) => {
          const block: Anthropic.ToolResultBlockParam = { type: 'tool_result', tool_use_id: r.toolUseId, content: r.content };
          if (r.isError) block.is_error = true;
          return block;
        }),
      });
    }
  }
  return out;
}

function mapStop(reason: Anthropic.StopReason | null): StopReason {
  switch (reason) {
    case 'end_turn': case 'stop_sequence': return 'end';
    case 'tool_use': return 'tool_use';
    case 'max_tokens': case 'model_context_window_exceeded': return 'max_tokens';
    case 'refusal': return 'refusal';
    default: return 'other';
  }
}

function describe(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Anthropic rejected the API key (401). Check ANTHROPIC_API_KEY or the key saved in Settings.';
  if (err instanceof Anthropic.APIUserAbortError) return 'run cancelled';
  if (err instanceof Anthropic.APIError) return `Anthropic API ${err.status ?? ''}: ${err.message}`.replace(/\s+/g, ' ').trim();
  return err instanceof Error ? err.message : String(err);
}

/** Claude through the Messages API (`@anthropic-ai/sdk`), streaming, adaptive thinking, effort via `output_config`. */
export class AnthropicProvider implements ChatProvider {
  readonly id = 'anthropic-api' as const;

  constructor(private readonly opts: AnthropicProviderOptions) {}

  async complete(req: CompleteRequest): Promise<ProviderTurn> {
    const client = makeClient(this.opts, 2);
    const system: Anthropic.TextBlockParam[] = [{ type: 'text', text: req.system.stable, cache_control: { type: 'ephemeral' } }];
    if (req.system.volatile) system.push({ type: 'text', text: req.system.volatile });
    const tools: Anthropic.Tool[] = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema }));
    try {
      const stream = client.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system,
          tools,
          messages: toAnthropicMessages(req.messages),
          thinking: { type: 'adaptive' },
          ...(isEffort(req.effort) ? { output_config: { effort: req.effort } } : {}),
        },
        { signal: req.signal ?? null },
      );
      stream.on('text', (delta) => req.onText(delta));
      const msg = await stream.finalMessage();
      const toolCalls: ToolCall[] = msg.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));
      const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
      const u = msg.usage;
      const tokens = { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
      const cost = costFor(priceOf('anthropic', msg.model), tokens);
      const turn: ProviderTurn = { text, toolCalls, raw: msg.content, usage: { ...tokens }, stopReason: mapStop(msg.stop_reason), model: msg.model };
      if (cost !== undefined) turn.usage.costUsd = cost;
      return turn;
    } catch (err) {
      throw new Error(describe(err));
    }
  }
}

/** Free: lists models (no tokens billed). */
export async function listAnthropicModels(opts: AnthropicProviderOptions): Promise<ModelOption[]> {
  const client = makeClient(opts, 1);
  const out: ModelOption[] = [];
  try {
    for await (const m of client.models.list({ limit: 100 })) {
      if (m.lifecycle === 'retired') continue;
      out.push({ id: m.id, label: m.display_name });
    }
  } catch (err) {
    throw new Error(describe(err));
  }
  return out;
}

/** Free: a one-item models call tells a rejected key (401) from a working one; network failures leave the key unverified. */
export async function verifyAnthropicKey(opts: AnthropicProviderOptions): Promise<KeyCheck> {
  try {
    await makeClient(opts, 0).models.list({ limit: 1 });
    return { ok: true, detail: 'key accepted' };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return { ok: false, rejected: true, detail: describe(err) };
    return { ok: true, detail: `not verified: ${describe(err)}` };
  }
}
