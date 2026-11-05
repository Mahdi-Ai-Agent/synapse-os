import { costFor, type ModelPrice } from '../pricing';
import { clip } from '../stream-json';
import type { ChatMessage, ChatProvider, CompleteRequest, ProviderTurn, StopReason, ToolCall } from '../tool-loop';
import type { ModelOption } from '../types';
import type { KeyCheck } from './anthropic';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export interface OpenAiCompatibleOptions {
  id: 'openai-api' | 'openrouter';
  /** Shown in errors, e.g. "OpenAI" or "OpenRouter". */
  label: string;
  apiKey: string;
  /** e.g. `https://api.openai.com/v1` or `https://openrouter.ai/api/v1`. */
  baseUrl: string;
  /** `reasoning_effort` (OpenAI) or the `reasoning: {effort}` object (OpenRouter). */
  effortParam: 'reasoning_effort' | 'reasoning';
  headers?: Record<string, string>;
  priceFor?: (model: string) => ModelPrice | undefined;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

interface ReasoningDetail extends Json { index?: number }

function authHeaders(opts: Pick<OpenAiCompatibleOptions, 'apiKey' | 'headers'>): Record<string, string> {
  return { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json', ...(opts.headers ?? {}) };
}

async function apiError(label: string, res: Response, keyHint: string): Promise<Error> {
  const text = await res.text().catch(() => '');
  let message = text;
  try { const j = JSON.parse(text) as Json; const e = isObj(j['error']) ? j['error'] : j; message = str(e['message']) ?? text; } catch { /* plain text */ }
  if (res.status === 401) return new Error(`${label} rejected the API key (401). ${keyHint}`);
  return new Error(`${label} API ${res.status}: ${clip(message || res.statusText, 300)}`);
}

export function toOpenAiMessages(system: string, messages: ChatMessage[]): Json[] {
  const out: Json[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.text });
    } else if (m.role === 'assistant') {
      const msg: Json = { role: 'assistant', content: m.text || null };
      if (m.toolCalls.length) msg['tool_calls'] = m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) } }));
      if (isObj(m.raw) && Array.isArray(m.raw['reasoning_details']) && m.raw['reasoning_details'].length) msg['reasoning_details'] = m.raw['reasoning_details'];
      out.push(msg);
    } else {
      for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.toolUseId, content: r.content });
    }
  }
  return out;
}

/** `data:` payloads of a Server-Sent Events body, one per yielded string. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trim();
}

/** Streamed `reasoning_details` fragments merged by index so they can be echoed back unchanged. */
function mergeReasoning(into: ReasoningDetail[], fragments: unknown[]): void {
  for (const [pos, frag] of fragments.entries()) {
    if (!isObj(frag)) continue;
    const index = num(frag['index']) ?? pos;
    let cur = into.find((d) => d.index === index);
    if (!cur) { cur = { index }; into.push(cur); }
    for (const [k, v] of Object.entries(frag)) {
      if (k === 'index') continue;
      if (typeof v === 'string' && typeof cur[k] === 'string' && (k === 'text' || k === 'summary' || k === 'data')) cur[k] = `${cur[k] as string}${v}`;
      else if (cur[k] === undefined) cur[k] = v;
    }
  }
}

function safeJson(s: string): unknown {
  if (!s.trim()) return {};
  try { return JSON.parse(s); } catch { return { INVALID_JSON: s }; }
}

/** Chat Completions with function tools over plain `fetch`; serves OpenAI and OpenRouter (same wire format, different base URL). */
export class OpenAiCompatibleProvider implements ChatProvider {
  readonly id: 'openai-api' | 'openrouter';

  constructor(private readonly opts: OpenAiCompatibleOptions) {
    this.id = opts.id;
  }

  private get fetchImpl(): typeof fetch {
    return this.opts.fetch ?? fetch;
  }

  private post(body: Json, signal: AbortSignal | undefined): Promise<Response> {
    return this.fetchImpl(`${this.opts.baseUrl}/chat/completions`, { method: 'POST', headers: authHeaders(this.opts), body: JSON.stringify(body), ...(signal ? { signal } : {}) });
  }

  async complete(req: CompleteRequest): Promise<ProviderTurn> {
    const system = [req.system.stable, req.system.volatile].filter(Boolean).join('\n\n');
    const body: Json = {
      model: req.model,
      messages: toOpenAiMessages(system, req.messages),
      tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: req.maxTokens,
    };
    if (this.opts.id === 'openrouter') body['usage'] = { include: true };
    const effortKey = this.opts.effortParam;
    if (req.effort) body[effortKey] = effortKey === 'reasoning' ? { effort: req.effort } : req.effort;
    const keyHint = `Check the key in Settings or the environment.`;

    let res: Response;
    try {
      res = await this.post(body, req.signal);
      if (!res.ok && res.status === 400 && req.effort) {
        // Some models reject the reasoning parameter; retry once without it.
        const text = await res.clone().text().catch(() => '');
        if (/reason/i.test(text)) { delete body[effortKey]; res = await this.post(body, req.signal); }
      }
    } catch (err) {
      if (req.signal?.aborted) throw new Error('run cancelled');
      throw new Error(`${this.opts.label} request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) throw await apiError(this.opts.label, res, keyHint);
    if (!res.body) throw new Error(`${this.opts.label} returned no body`);

    let text = '';
    let finish: string | undefined;
    let model = req.model;
    let usage: Json | undefined;
    const calls = new Map<number, { id: string; name: string; args: string }>();
    const reasoning: ReasoningDetail[] = [];
    for await (const data of sseData(res.body)) {
      if (data === '[DONE]') break;
      let chunk: unknown;
      try { chunk = JSON.parse(data); } catch { continue; }
      if (!isObj(chunk)) continue;
      if (isObj(chunk['error'])) throw new Error(`${this.opts.label} API error: ${str(chunk['error']['message']) ?? JSON.stringify(chunk['error'])}`);
      const m = str(chunk['model']); if (m) model = m;
      if (isObj(chunk['usage'])) usage = chunk['usage'];
      const choices = Array.isArray(chunk['choices']) ? chunk['choices'] : [];
      for (const ch of choices) {
        if (!isObj(ch)) continue;
        const delta = isObj(ch['delta']) ? ch['delta'] : {};
        const content = str(delta['content']);
        if (content) { text += content; req.onText(content); }
        const tcs = Array.isArray(delta['tool_calls']) ? delta['tool_calls'] : [];
        for (const tc of tcs) {
          if (!isObj(tc)) continue;
          const index = num(tc['index']) ?? calls.size;
          const cur = calls.get(index) ?? { id: '', name: '', args: '' };
          const id = str(tc['id']); if (id) cur.id = id;
          const fn = isObj(tc['function']) ? tc['function'] : {};
          const name = str(fn['name']); if (name) cur.name = cur.name ? cur.name : name;
          const args = str(fn['arguments']); if (args) cur.args += args;
          calls.set(index, cur);
        }
        if (Array.isArray(delta['reasoning_details'])) mergeReasoning(reasoning, delta['reasoning_details']);
        const fr = str(ch['finish_reason']); if (fr) finish = fr;
      }
    }

    const toolCalls: ToolCall[] = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([i, c]) => ({ id: c.id || `call_${i}`, name: c.name, input: safeJson(c.args) }));
    const prompt = num(usage?.['prompt_tokens']) ?? 0;
    const cached = isObj(usage?.['prompt_tokens_details']) ? num(usage['prompt_tokens_details']['cached_tokens']) ?? 0 : 0;
    const tokens = { input: Math.max(0, prompt - cached), output: num(usage?.['completion_tokens']) ?? 0, cacheRead: cached, cacheWrite: 0 };
    const reported = num(usage?.['cost']);
    const cost = reported !== undefined ? Math.round(reported * 1e6) / 1e6 : costFor(this.opts.priceFor?.(model), tokens);
    let stopReason: StopReason = toolCalls.length ? 'tool_use' : 'end';
    if (finish === 'length') stopReason = 'max_tokens';
    else if (finish === 'content_filter') stopReason = 'refusal';
    const turn: ProviderTurn = { text, toolCalls, usage: { ...tokens }, stopReason, model };
    if (reasoning.length) turn.raw = { reasoning_details: reasoning };
    if (cost !== undefined) turn.usage.costUsd = cost;
    return turn;
  }
}

export interface ModelCatalog { models: ModelOption[]; prices: Map<string, ModelPrice> }

const OPENAI_EXCLUDE = /(audio|realtime|tts|transcribe|image|embedding|moderation|whisper|dall-e|instruct|search|codex|computer-use|babbage|davinci)/i;

/** `GET /models` on either provider. OpenRouter also carries per-token prices, kept for cost estimates. */
export async function listOpenAiCompatibleModels(opts: Pick<OpenAiCompatibleOptions, 'id' | 'label' | 'apiKey' | 'baseUrl' | 'headers' | 'fetch'>): Promise<ModelCatalog> {
  const res = await (opts.fetch ?? fetch)(`${opts.baseUrl}/models`, { headers: authHeaders(opts) });
  if (!res.ok) throw await apiError(opts.label, res, 'Check the key in Settings or the environment.');
  const j = (await res.json()) as unknown;
  const data = isObj(j) && Array.isArray(j['data']) ? j['data'] : [];
  const models: ModelOption[] = [];
  const prices = new Map<string, ModelPrice>();
  const rows = data.filter(isObj).map((row) => ({ row, id: str(row['id']) ?? '', created: num(row['created']) ?? 0 })).filter((r) => r.id);
  if (opts.id === 'openai-api') rows.sort((a, b) => b.created - a.created);
  else rows.sort((a, b) => a.id.localeCompare(b.id));
  for (const { row, id } of rows) {
    if (opts.id === 'openai-api') {
      if (!/^(gpt-|o\d)/.test(id) || OPENAI_EXCLUDE.test(id)) continue;
      models.push({ id, label: id });
      continue;
    }
    if (id.endsWith(':batch')) continue;
    const params = Array.isArray(row['supported_parameters']) ? row['supported_parameters'] : null;
    if (params && !params.includes('tools')) continue;
    models.push({ id, label: str(row['name']) ?? id });
    const p = isObj(row['pricing']) ? row['pricing'] : null;
    const perToken = (v: unknown): number | undefined => { const n = typeof v === 'string' ? Number(v) : num(v); return n !== undefined && Number.isFinite(n) ? Math.round(n * 1e12) / 1e6 : undefined; };
    const input = perToken(p?.['prompt']);
    const output = perToken(p?.['completion']);
    if (input !== undefined && output !== undefined) {
      const price: ModelPrice = { input, output };
      const cr = perToken(p?.['input_cache_read']); if (cr !== undefined) price.cacheRead = cr;
      const cw = perToken(p?.['input_cache_write']); if (cw !== undefined) price.cacheWrite = cw;
      prices.set(id, price);
    }
  }
  return { models, prices };
}

/** Free key check: `GET /models` (OpenAI, needs auth) or `GET /auth/key` (OpenRouter; its model list is public). */
export async function verifyOpenAiCompatibleKey(opts: Pick<OpenAiCompatibleOptions, 'id' | 'label' | 'apiKey' | 'baseUrl' | 'headers' | 'fetch'>): Promise<KeyCheck> {
  const url = opts.id === 'openrouter' ? `${opts.baseUrl}/auth/key` : `${opts.baseUrl}/models`;
  try {
    const res = await (opts.fetch ?? fetch)(url, { headers: authHeaders(opts), signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 || res.status === 403) return { ok: false, rejected: true, detail: `${opts.label} rejected the key (${res.status})` };
    if (!res.ok) return { ok: true, detail: `not verified: ${opts.label} answered ${res.status}` };
    return { ok: true, detail: 'key accepted' };
  } catch (err) {
    return { ok: true, detail: `not verified: ${err instanceof Error ? err.message : String(err)}` };
  }
}
