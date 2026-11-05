import { describe, expect, it } from 'vitest';
import { createCodexJsonlParser } from '../src/codex-jsonl';
import { buildCodexArgs, buildCodexPrompt } from '../src/engines/codex-cli';
import type { AgentLayer } from '../src/agent-layer';

// Shapes from the Codex SDK event/item types (sdk/typescript/src/{events,items}.ts) and the `codex exec --json` docs.
const lines = [
  '{"type":"thread.started","thread_id":"0199a213-81c0-7800-8aa1-bbab2a035a53"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"Looking at the index first."}}',
  '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc \'cat index/INDEX.md\'","aggregated_output":"","status":"in_progress"}}',
  '{"type":"item.updated","item":{"id":"item_1","type":"command_execution","command":"bash -lc \'cat index/INDEX.md\'","aggregated_output":"# Vault","status":"in_progress"}}',
  '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"bash -lc \'cat index/INDEX.md\'","aggregated_output":"# Vault index\\n49 nodes","exit_code":0,"status":"completed"}}',
  '{"type":"item.completed","item":{"id":"item_2","type":"file_change","changes":[{"path":"nodes/tasks/call-sara.md","kind":"add"}],"status":"completed"}}',
  '{"type":"item.completed","item":{"id":"item_3","type":"command_execution","command":"bash -lc false","aggregated_output":"","exit_code":1,"status":"failed"}}',
  '{"type":"item.completed","item":{"id":"item_4","type":"todo_list","items":[{"text":"file it","completed":true}]}}',
  '{"type":"item.completed","item":{"id":"item_5","type":"agent_message","text":"created [[تماس با سارا]] (task)"}}',
  'not json',
  '{"type":"turn.completed","usage":{"input_tokens":24763,"cached_input_tokens":24448,"output_tokens":122,"reasoning_output_tokens":0}}',
];

describe('codex-jsonl parser', () => {
  it('maps thread, items and turn.completed to brain events', () => {
    const p = createCodexJsonlParser();
    const events = lines.flatMap((l) => p.feed(l));
    expect(events.map((e) => e.type)).toEqual(['init', 'tool_use', 'tool_result', 'tool_use', 'tool_result', 'tool_use', 'tool_result', 'text_delta', 'result']);
    expect(p.threadId).toBe('0199a213-81c0-7800-8aa1-bbab2a035a53');
    const init = events[0];
    expect(init && init.type === 'init' ? init.sessionId : '').toBe('0199a213-81c0-7800-8aa1-bbab2a035a53');
    const tools = events.filter((e) => e.type === 'tool_use').map((e) => (e.type === 'tool_use' ? e.summary : ''));
    expect(tools[0]).toBe("Bash bash -lc 'cat index/INDEX.md'");
    expect(tools[1]).toBe('Edit add nodes/tasks/call-sara.md');
    const results = events.filter((e) => e.type === 'tool_result').map((e) => (e.type === 'tool_result' ? e.ok : null));
    expect(results).toEqual([true, true, false]);
    const result = events.at(-1);
    expect(result?.type).toBe('result');
    if (result?.type === 'result') {
      expect(result.text).toBe('created [[تماس با سارا]] (task)');
      expect(result.isError).toBe(false);
      expect(result.sessionId).toBe('0199a213-81c0-7800-8aa1-bbab2a035a53');
      expect(result.tokens).toEqual({ input: 24763, output: 122, cacheRead: 24448 });
      expect(result.costUsd).toBeUndefined();
    }
  });

  it('turns turn.failed into an error result', () => {
    const p = createCodexJsonlParser();
    p.feed('{"type":"thread.started","thread_id":"t2"}');
    const failed = p.feed('{"type":"turn.failed","error":{"message":"rate limited"}}');
    expect(failed).toEqual([{ type: 'result', text: 'rate limited', sessionId: 't2', isError: true }]);
    expect(p.feed('{"type":"turn.started"}')).toEqual([]);
  });

  // Lines seen from codex-cli 0.166.0 on a filtered network: the turn went on after every one of them.
  it('keeps error lines and error items as notices, remembers the last one, and never ends the run on them', () => {
    const p = createCodexJsonlParser();
    p.feed('{"type":"thread.started","thread_id":"t3"}');
    expect(p.feed('{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata for `x` not found. Defaulting to fallback metadata; this can degrade performance and cause issues."}}'))
      .toEqual([{ type: 'notice', message: 'Model metadata for `x` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.' }]);
    expect(p.feed('{"type":"error","message":"Reconnecting... 2/5 (stream disconnected before completion: URL error: Proxy connection failed: HTTP CONNECT failed with status 403)"}'))
      .toEqual([{ type: 'notice', message: 'Reconnecting... 2/5 (stream disconnected before completion: URL error: Proxy connection failed: HTTP CONNECT failed with status 403)' }]);
    expect(p.feed('{"type":"error","message":"Reconnecting... waiting for network (Connection failed: error sending request)"}'))
      .toEqual([{ type: 'notice', message: 'Reconnecting... waiting for network (Connection failed: error sending request)' }]);
    expect(p.lastNotice).toBe('Reconnecting... waiting for network (Connection failed: error sending request)');
    const done = p.feed('{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"answer"}}');
    expect(done).toEqual([{ type: 'text_delta', text: 'answer' }]);
    const r = p.feed('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2}}');
    expect(r[0]?.type === 'result' ? { text: r[0].text, isError: r[0].isError } : null).toEqual({ text: 'answer', isError: false });
  });

  it('joins several agent messages with blank lines', () => {
    const p = createCodexJsonlParser();
    const a = p.feed('{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"one"}}');
    const b = p.feed('{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"two"}}');
    expect(a).toEqual([{ type: 'text_delta', text: 'one' }]);
    expect(b).toEqual([{ type: 'text_delta', text: '\n\ntwo' }]);
    const r = p.feed('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2}}');
    expect(r[0]?.type === 'result' ? r[0].text : '').toBe('one\n\ntwo');
  });
});

describe('codex command line', () => {
  it('builds the exec command with sandbox, model, effort and resume', () => {
    expect(buildCodexArgs({ cwd: '/v' })).toEqual(['exec', '--json', '--cd', '/v', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-']);
    expect(buildCodexArgs({ cwd: '/v', model: 'gpt-6.1-sol', effort: 'high', sessionId: 'abc' })).toEqual([
      'exec', '--json', '--cd', '/v', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--model', 'gpt-6.1-sol', '-c', 'model_reasoning_effort=high', 'resume', 'abc', '-',
    ]);
  });

  it('prepends runtime context and the rules index and expands /skill prompts', () => {
    const layer: AgentLayer = {
      root: '/v', instructions: '# Vault', profile: '', lessons: '',
      rules: [{ file: '.claude/rules/tasks.md', description: 'Task rules', paths: ['nodes/tasks/**'], body: '- atomic' }],
      skills: new Map([['capture', { name: 'capture', description: 'file things', body: 'Steps: read index.', dir: '.claude/skills/capture' }]]),
    };
    const prompt = buildCodexPrompt('/capture call Sara tomorrow', layer, '- Now: 2026-10-31\n- Mode: capture');
    expect(prompt).toContain('<runtime_context>\n- Now: 2026-10-31\n- Mode: capture\n</runtime_context>');
    expect(prompt).toContain('`.claude/rules/tasks.md` — Task rules (applies to nodes/tasks/**)');
    expect(prompt).toContain('Run the "capture" skill now.');
    expect(prompt).toContain('Steps: read index.');
    expect(prompt).toContain('User input:\ncall Sara tomorrow');
    expect(buildCodexPrompt('hello', layer, '')).toBe('<folder_rules>\nRead the rule file before writing in its folder:\n- `.claude/rules/tasks.md` — Task rules (applies to nodes/tasks/**)\n</folder_rules>\n\nhello');
  });
});
