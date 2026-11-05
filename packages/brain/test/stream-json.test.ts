import { describe, expect, it } from 'vitest';
import { createStreamJsonParser, summarizeToolUse } from '../src/stream-json';
import { claudeEnv, sanitizeEnv } from '../src/env';

const lines = [
  '{"type":"system","subtype":"init","session_id":"s1","model":"claude-sonnet-5-5"}',
  '{"type":"stream_event","event":{"type":"message_start"}}',
  '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"سلام"}}}',
  '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":" دنیا"}}}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"سلام دنیا"},{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"index/INDEX.md"}}]}}',
  '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"# Vault index"}]}}',
  '{"type":"assistant","parent_tool_use_id":"x","message":{"content":[{"type":"text","text":"subagent"}]}}',
  'not json at all',
  '{"type":"result","subtype":"success","result":"done","session_id":"s1","total_cost_usd":0.01,"is_error":false,"num_turns":2,"duration_ms":1234,"usage":{"input_tokens":12,"output_tokens":34,"cache_read_input_tokens":5000,"cache_creation_input_tokens":0}}',
];

describe('stream-json parser', () => {
  it('maps lines to brain events without duplicating streamed text', () => {
    const p = createStreamJsonParser();
    const events = lines.flatMap((l) => p.feed(l));
    expect(events.map((e) => e.type)).toEqual(['init', 'text_delta', 'text_delta', 'tool_use', 'tool_result', 'result']);
    const text = events.filter((e) => e.type === 'text_delta').map((e) => (e.type === 'text_delta' ? e.text : '')).join('');
    expect(text).toBe('سلام دنیا');
    const tool = events.find((e) => e.type === 'tool_use');
    expect(tool && tool.type === 'tool_use' ? tool.summary : '').toBe('Read index/INDEX.md');
    const result = events.at(-1);
    expect(result && result.type === 'result' ? result.costUsd : null).toBe(0.01);
    expect(result && result.type === 'result' ? result.tokens : null).toEqual({ input: 12, output: 34, cacheRead: 5000, cacheWrite: 0 });
  });

  it('turns an API retry into a notice that says what is waited for', () => {
    const p = createStreamJsonParser();
    expect(p.feed('{"type":"system","subtype":"api_retry","attempt":3,"max_retries":10,"retry_delay_ms":8000,"error_status":529,"error":"overloaded_error","session_id":"s1"}'))
      .toEqual([{ type: 'notice', message: 'API retry 3/10 (HTTP 529 overloaded_error) · next try in 8 s' }]);
    expect(p.feed('{"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":500,"error_status":null,"error":"connection_error"}'))
      .toEqual([{ type: 'notice', message: 'API retry 1/10 (connection_error) · next try in 1 s' }]);
    expect(p.feed('{"type":"system","subtype":"status","status":"requesting"}')).toEqual([]);
  });

  it('emits assistant text when no deltas were streamed', () => {
    const p = createStreamJsonParser();
    const events = p.feed('{"type":"assistant","message":{"content":[{"type":"text","text":"full text"}]}}');
    expect(events).toEqual([{ type: 'text_delta', text: 'full text' }]);
  });

  it('summarizes tool calls', () => {
    expect(summarizeToolUse('Grep', { pattern: 'علی', path: 'nodes' })).toBe('Grep "علی" in nodes');
    expect(summarizeToolUse('Skill', { skill: 'capture' })).toBe('Skill /capture');
  });
});

describe('sanitizeEnv', () => {
  it('drops host Claude Code variables and keeps the rest', () => {
    const env = sanitizeEnv({ PATH: '/bin', HOME: '/h', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x', CLAUDE_AGENT_SDK_VERSION: '1', CLAUDE_CONFIG_DIR: '/c', ANTHROPIC_API_KEY: 'k' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', CLAUDE_CONFIG_DIR: '/c', ANTHROPIC_API_KEY: 'k' });
  });

  it("keeps the user's own Claude Code settings although they carry the prefix", () => {
    const env = sanitizeEnv({ CLAUDE_CODE_OAUTH_TOKEN: 't', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '0', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8000', CLAUDE_CODE_SSE_PORT: '1' });
    expect(env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 't', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '0', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8000' });
  });
});

describe('claudeEnv', () => {
  it('adds the headless defaults and lets the user\'s own values win', () => {
    const env = claudeEnv({ PATH: '/bin', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '0', DISABLE_TELEMETRY: '0' });
    expect(env).toEqual({ PATH: '/bin', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '0', DISABLE_TELEMETRY: '0', DISABLE_AUTOUPDATER: '1', DISABLE_ERROR_REPORTING: '1', DISABLE_BUG_COMMAND: '1' });
    expect(claudeEnv({})['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC']).toBe('1');
  });
});
