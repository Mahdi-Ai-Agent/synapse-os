import { describe, expect, it } from 'vitest';
import { AnthropicProvider, toAnthropicMessages } from '../src/providers/anthropic';
import { OpenAiCompatibleProvider, listOpenAiCompatibleModels, toOpenAiMessages, verifyOpenAiCompatibleKey } from '../src/providers/openai-compatible';
import type { ChatMessage, CompleteRequest } from '../src/tool-loop';
import { VAULT_TOOL_DEFINITIONS } from '../src/tools/vault-tools';

const sse = (events: Array<{ event?: string; data: unknown }>): string => events.map((e) => `${e.event ? `event: ${e.event}\n` : ''}data: ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}\n\n`).join('');

function fakeFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>): { fetch: typeof fetch; calls: Array<{ url: string; init: RequestInit | undefined }> } {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fetch: f, calls };
}

const history: ChatMessage[] = [
  { role: 'user', text: 'file this' },
  { role: 'assistant', text: 'Reading.', toolCalls: [{ id: 'c1', name: 'read_file', input: { path: 'index/INDEX.md' } }] },
  { role: 'tool_results', results: [{ toolUseId: 'c1', content: '# Vault index', isError: false }] },
  { role: 'user', text: 'go on' },
];

const baseReq = (overrides: Partial<CompleteRequest> = {}): CompleteRequest => ({
  system: { stable: 'STABLE', volatile: 'VOLATILE' },
  messages: history,
  tools: VAULT_TOOL_DEFINITIONS,
  model: 'claude-sonnet-5-5',
  maxTokens: 1000,
  onText: () => undefined,
  ...overrides,
});

describe('AnthropicProvider', () => {
  it('sends system blocks, tools, thinking and effort; parses streamed text, tool_use, usage and cost', async () => {
    const body = sse([
      { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 500, cache_creation_input_tokens: 100 } } } },
      { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Look' } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ing' } } },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
      { event: 'content_block_start', data: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'grep', input: {} } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"pattern":"سا' } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'را","path":"nodes"}' } } },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index: 1 } },
      { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 2000 } } },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ]);
    const { fetch: f, calls } = fakeFetch(() => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test', fetch: f });
    const deltas: string[] = [];
    const turn = await provider.complete(baseReq({ effort: 'high', onText: (d) => deltas.push(d) }));

    expect(deltas).toEqual(['Look', 'ing']);
    expect(turn.text).toBe('Looking');
    expect(turn.toolCalls).toEqual([{ id: 'toolu_1', name: 'grep', input: { pattern: 'سارا', path: 'nodes' } }]);
    expect(turn.stopReason).toBe('tool_use');
    expect(turn.model).toBe('claude-sonnet-5-5');
    expect(turn.usage).toEqual({ input: 1000, output: 2000, cacheRead: 500, cacheWrite: 100, costUsd: 0.02235 }); // (2·1000 + 10·2000 + 0.2·500 + 2.5·100) / 1M
    expect(Array.isArray(turn.raw) && turn.raw.length).toBe(2);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = calls[0]?.init?.headers as Headers; // SDK 1.x sends the key as `authorization`; older versions used `x-api-key`
    expect([headers.get('x-api-key'), headers.get('authorization')].some((v) => v?.includes('sk-ant-test'))).toBe(true);
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(sent['model']).toBe('claude-sonnet-5-5');
    expect(sent['stream']).toBe(true);
    expect(sent['thinking']).toEqual({ type: 'adaptive' });
    expect(sent['output_config']).toEqual({ effort: 'high' });
    expect(sent['system']).toEqual([{ type: 'text', text: 'STABLE', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'VOLATILE' }]);
    expect((sent['tools'] as Array<{ name: string; input_schema: unknown }>).map((t) => t.name)).toEqual(['read_file', 'list_files', 'grep', 'write_file', 'edit_file']);
    expect(sent['messages']).toEqual([
      { role: 'user', content: 'file this' },
      { role: 'assistant', content: [{ type: 'text', text: 'Reading.' }, { type: 'tool_use', id: 'c1', name: 'read_file', input: { path: 'index/INDEX.md' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '# Vault index' }] },
      { role: 'user', content: 'go on' },
    ]);
  });

  it('replays raw assistant blocks verbatim and flags error tool results', () => {
    const raw = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 'x', name: 'read_file', input: {} }];
    const out = toAnthropicMessages([
      { role: 'assistant', text: '', toolCalls: [{ id: 'x', name: 'read_file', input: {} }], raw },
      { role: 'tool_results', results: [{ toolUseId: 'x', content: 'nope', isError: true }] },
    ]);
    expect(out[0]).toEqual({ role: 'assistant', content: raw });
    expect(out[1]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'nope', is_error: true }] });
  });

  it('turns a 401 into an actionable error', async () => {
    const { fetch: f } = fakeFetch(() => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'content-type': 'application/json' } }));
    const provider = new AnthropicProvider({ apiKey: 'bad', fetch: f });
    await expect(provider.complete(baseReq())).rejects.toThrow(/rejected the API key \(401\)/);
  });
});

describe('OpenAiCompatibleProvider', () => {
  const stream = sse([
    { data: { id: 'c1', model: 'openai/gpt-6.1-sol', choices: [{ index: 0, delta: { role: 'assistant', content: 'Let me look.' }, finish_reason: null }] } },
    { data: { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'grep', arguments: '' } }] }, finish_reason: null }] } },
    { data: { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"pattern":"سارا"' } }] }, finish_reason: null }] } },
    { data: { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ',"path":"nodes"}' } }] }, finish_reason: null }] } },
    { data: { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: 'call_2', type: 'function', function: { name: 'read_file', arguments: '{"path":"index/INDEX.md"}' } }] }, finish_reason: null }] } },
    { data: { choices: [{ index: 0, delta: { reasoning_details: [{ type: 'reasoning.text', text: 'thin', index: 0, id: 'r1', format: 'anthropic-claude-v1' }] }, finish_reason: null }] } },
    { data: { choices: [{ index: 0, delta: { reasoning_details: [{ type: 'reasoning.text', text: 'king', index: 0 }] }, finish_reason: null }] } },
    { data: { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] } },
    { data: { choices: [], usage: { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 20 }, cost: 0.0012 } } },
    { data: '[DONE]' },
  ]);

  it('streams text and tool-call deltas, merges reasoning details, reads usage and OpenRouter cost', async () => {
    const { fetch: f, calls } = fakeFetch(() => new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const provider = new OpenAiCompatibleProvider({ id: 'openrouter', label: 'OpenRouter', apiKey: 'sk-or-test', baseUrl: 'https://openrouter.ai/api/v1', effortParam: 'reasoning', headers: { 'X-Title': 'Synapse' }, fetch: f });
    const deltas: string[] = [];
    const turn = await provider.complete(baseReq({ model: 'openai/gpt-6.1-sol', effort: 'high', onText: (d) => deltas.push(d) }));
    expect(deltas).toEqual(['Let me look.']);
    expect(turn.text).toBe('Let me look.');
    expect(turn.toolCalls).toEqual([
      { id: 'call_1', name: 'grep', input: { pattern: 'سارا', path: 'nodes' } },
      { id: 'call_2', name: 'read_file', input: { path: 'index/INDEX.md' } },
    ]);
    expect(turn.stopReason).toBe('tool_use');
    expect(turn.usage).toEqual({ input: 100, output: 30, cacheRead: 20, cacheWrite: 0, costUsd: 0.0012 });
    expect(turn.raw).toEqual({ reasoning_details: [{ index: 0, type: 'reasoning.text', text: 'thinking', id: 'r1', format: 'anthropic-claude-v1' }] });

    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = new Headers(calls[0]?.init?.headers as Record<string, string>);
    expect(headers.get('authorization')).toBe('Bearer sk-or-test');
    expect(headers.get('x-title')).toBe('Synapse');
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(sent['reasoning']).toEqual({ effort: 'high' });
    expect(sent['reasoning_effort']).toBeUndefined();
    expect(sent['usage']).toEqual({ include: true });
    expect(sent['stream_options']).toEqual({ include_usage: true });
    expect(sent['max_completion_tokens']).toBe(1000);
    expect((sent['tools'] as Array<{ type: string; function: { name: string } }>).map((t) => `${t.type}:${t.function.name}`)).toEqual(['function:read_file', 'function:list_files', 'function:grep', 'function:write_file', 'function:edit_file']);
    expect(sent['messages']).toEqual([
      { role: 'system', content: 'STABLE\n\nVOLATILE' },
      { role: 'user', content: 'file this' },
      { role: 'assistant', content: 'Reading.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"index/INDEX.md"}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '# Vault index' },
      { role: 'user', content: 'go on' },
    ]);
  });

  it('uses reasoning_effort for OpenAI, retries once without it on a 400, and prices from the table', async () => {
    let n = 0;
    const { fetch: f, calls } = fakeFetch(() => {
      n++;
      if (n === 1) return new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'reasoning_effort'" } }), { status: 400 });
      const ok = sse([
        { data: { model: 'gpt-6.1-sol', choices: [{ index: 0, delta: { content: 'done' }, finish_reason: 'stop' }] } },
        { data: { choices: [], usage: { prompt_tokens: 1_000_000, completion_tokens: 100_000 } } },
        { data: '[DONE]' },
      ]);
      return new Response(ok, { status: 200 });
    });
    const provider = new OpenAiCompatibleProvider({ id: 'openai-api', label: 'OpenAI', apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', effortParam: 'reasoning_effort', priceFor: () => ({ input: 2, output: 10 }), fetch: f });
    const turn = await provider.complete(baseReq({ model: 'gpt-6.1-sol', effort: 'medium' }));
    expect(calls).toHaveLength(2);
    expect((JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>)['reasoning_effort']).toBe('medium');
    expect((JSON.parse(String(calls[1]?.init?.body)) as Record<string, unknown>)['reasoning_effort']).toBeUndefined();
    expect(turn).toMatchObject({ text: 'done', toolCalls: [], stopReason: 'end', usage: { input: 1_000_000, output: 100_000, costUsd: 3 } });
  });

  it('reports 401 and other API errors readably', async () => {
    const { fetch: f } = fakeFetch(() => new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), { status: 401 }));
    const provider = new OpenAiCompatibleProvider({ id: 'openai-api', label: 'OpenAI', apiKey: 'bad', baseUrl: 'https://api.openai.com/v1', effortParam: 'reasoning_effort', fetch: f });
    await expect(provider.complete(baseReq())).rejects.toThrow('OpenAI rejected the API key (401). Check the key in Settings or the environment.');
    const { fetch: g } = fakeFetch(() => new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 }));
    const p2 = new OpenAiCompatibleProvider({ id: 'openai-api', label: 'OpenAI', apiKey: 'k', baseUrl: 'https://api.openai.com/v1', effortParam: 'reasoning_effort', fetch: g });
    await expect(p2.complete(baseReq())).rejects.toThrow('OpenAI API 404: model not found');
  });

  it('lists models with OpenRouter prices and verifies keys for free', async () => {
    const list = { data: [
      { id: 'anthropic/claude-sonnet-5.5', name: 'Anthropic: Claude Sonnet 5.5', pricing: { prompt: '0.000002', completion: '0.00001', input_cache_read: '0.0000002' }, supported_parameters: ['tools', 'reasoning'] },
      { id: 'anthropic/claude-sonnet-5.5:batch', name: 'batch', pricing: { prompt: '0.000001', completion: '0.000005' }, supported_parameters: ['tools'] },
      { id: 'some/chat-only', name: 'no tools', pricing: { prompt: '0', completion: '0' }, supported_parameters: ['max_tokens'] },
    ] };
    const { fetch: f } = fakeFetch(() => new Response(JSON.stringify(list), { status: 200 }));
    const catalog = await listOpenAiCompatibleModels({ id: 'openrouter', label: 'OpenRouter', apiKey: 'k', baseUrl: 'https://openrouter.ai/api/v1', fetch: f });
    expect(catalog.models).toEqual([{ id: 'anthropic/claude-sonnet-5.5', label: 'Anthropic: Claude Sonnet 5.5' }]);
    expect(catalog.prices.get('anthropic/claude-sonnet-5.5')).toEqual({ input: 2, output: 10, cacheRead: 0.2 });

    const openai = { data: [{ id: 'gpt-6.1-sol', created: 2 }, { id: 'gpt-6-astra', created: 3 }, { id: 'gpt-4o-realtime-preview', created: 9 }, { id: 'text-embedding-3-small', created: 1 }] };
    const { fetch: g } = fakeFetch(() => new Response(JSON.stringify(openai), { status: 200 }));
    const cat2 = await listOpenAiCompatibleModels({ id: 'openai-api', label: 'OpenAI', apiKey: 'k', baseUrl: 'https://api.openai.com/v1', fetch: g });
    expect(cat2.models.map((m) => m.id)).toEqual(['gpt-6-astra', 'gpt-6.1-sol']);

    const { fetch: h, calls } = fakeFetch(() => new Response('{}', { status: 401 }));
    expect(await verifyOpenAiCompatibleKey({ id: 'openrouter', label: 'OpenRouter', apiKey: 'k', baseUrl: 'https://openrouter.ai/api/v1', fetch: h })).toMatchObject({ ok: false, rejected: true });
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/auth/key');
    const { fetch: offline } = fakeFetch(() => { throw new Error('ENOTFOUND'); });
    expect(await verifyOpenAiCompatibleKey({ id: 'openai-api', label: 'OpenAI', apiKey: 'k', baseUrl: 'https://api.openai.com/v1', fetch: offline })).toMatchObject({ ok: true, detail: 'not verified: ENOTFOUND' });
  });

  it('maps the neutral transcript to chat-completions messages', () => {
    const out = toOpenAiMessages('SYS', [
      { role: 'assistant', text: '', toolCalls: [{ id: 'a', name: 'read_file', input: { path: 'x' } }], raw: { reasoning_details: [{ type: 'reasoning.encrypted', data: 'zzz', index: 0 }] } },
      { role: 'tool_results', results: [{ toolUseId: 'a', content: 'text', isError: true }] },
    ]);
    expect(out).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'read_file', arguments: '{"path":"x"}' } }], reasoning_details: [{ type: 'reasoning.encrypted', data: 'zzz', index: 0 }] },
      { role: 'tool', tool_call_id: 'a', content: 'text' },
    ]);
  });
});
