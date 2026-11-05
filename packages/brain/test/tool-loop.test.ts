import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expandSkillPrompt, loadAgentLayer, rulesForPath, splitFrontmatter } from '../src/agent-layer';
import { AsyncQueue } from '../src/async-queue';
import { matchesGlob } from '../src/glob';
import { runToolLoop, type ChatProvider, type CompleteRequest, type ProviderTurn } from '../src/tool-loop';
import type { BrainEvent } from '../src/types';

let root = '';

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-loop-'));
  const w = (rel: string, text: string): Promise<void> => fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true }).then(() => fs.writeFile(path.join(root, rel), text));
  await w('AGENTS.md', '# Synapse vault — brain instructions\n\nIndex first, never bulk-read.\n');
  await w('memory/profile.md', '# Owner profile\n- Name: Sam\n');
  await w('memory/lessons.md', '# Lessons (index)\n');
  await w('.claude/rules/node-format.md', '---\ndescription: File format for every vault node.\npaths:\n  - "nodes/**"\n---\n\n# Node format\n\nOne file = one node.\n');
  await w('.claude/rules/tasks.md', '---\ndescription: Authoring rules for task nodes.\npaths:\n  - "nodes/tasks/**"\n---\n\n# Tasks\n\n- atomic next actions\n');
  await w('.claude/skills/capture/SKILL.md', '---\nname: capture\ndescription: Turns raw text into nodes. Use when the user says "ثبت کن".\n---\n\n# capture\n\n1. Read `index/INDEX.md`.\n\nWorked examples: [references/examples.md](references/examples.md).\n');
  await w('.claude/skills/capture/references/examples.md', '# Examples\n');
  await w('index/INDEX.md', '# Vault index\n\n- 1 node\n');
  await w('.synapse/settings.json', '{"apiKeys":{"anthropic":"sk-secret"}}');
  await w('.synapse/runtime-context.md', '# Runtime context (written by Synapse)\n- Now: 2026-10-31T10:00:00+03:30\n- Mode: capture\n');
});

afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

/** Provider that replays scripted turns and records every request. */
function scripted(turns: Array<Partial<ProviderTurn> & { stream?: string[] }>): ChatProvider & { calls: CompleteRequest[] } {
  const calls: CompleteRequest[] = [];
  return {
    id: 'anthropic-api',
    calls,
    async complete(req) {
      calls.push({ ...req, messages: [...req.messages] }); // snapshot: the loop keeps appending to the live array
      const t = turns[Math.min(calls.length - 1, turns.length - 1)] ?? {};
      for (const d of t.stream ?? []) req.onText(d);
      return { text: t.text ?? (t.stream ?? []).join(''), toolCalls: t.toolCalls ?? [], usage: t.usage ?? { input: 10, output: 5 }, stopReason: t.stopReason ?? ((t.toolCalls?.length ?? 0) ? 'tool_use' : 'end'), ...(t.raw !== undefined ? { raw: t.raw } : {}) };
    },
  };
}

async function collect(queue: AsyncQueue<BrainEvent>): Promise<BrainEvent[]> {
  const out: BrainEvent[] = [];
  for await (const ev of queue) out.push(ev);
  return out;
}

describe('agent layer', () => {
  it('parses rule frontmatter, matches globs and rewrites skill links', async () => {
    const layer = await loadAgentLayer(root);
    expect(layer.instructions).toContain('Index first');
    expect(layer.rules.map((r) => r.file)).toEqual(['.claude/rules/node-format.md', '.claude/rules/tasks.md']);
    expect(layer.rules[1]?.paths).toEqual(['nodes/tasks/**']);
    expect(rulesForPath(layer, 'nodes/tasks/x.md').map((r) => r.file)).toEqual(['.claude/rules/node-format.md', '.claude/rules/tasks.md']);
    expect(rulesForPath(layer, 'nodes/people/x.md').map((r) => r.file)).toEqual(['.claude/rules/node-format.md']);
    expect(rulesForPath(layer, 'index/INDEX.md')).toEqual([]);
    const skill = layer.skills.get('capture');
    expect(skill?.description).toContain('ثبت کن');
    expect(skill?.body).toContain('[references/examples.md](.claude/skills/capture/references/examples.md)');
    const expanded = expandSkillPrompt('/capture فردا به سارا زنگ بزنم', layer);
    expect(expanded.skill).toBe('capture');
    expect(expanded.prompt).toContain('Run the "capture" skill now.');
    expect(expanded.prompt).toContain('User input:\nفردا به سارا زنگ بزنم');
    expect(expandSkillPrompt('/unknown thing', layer)).toEqual({ prompt: '/unknown thing', skill: null });
    expect(expandSkillPrompt('plain chat', layer).skill).toBeNull();
  });

  it('frontmatter reader handles inline lists and quotes', () => {
    const { data, body } = splitFrontmatter('---\ndescription: "a: b"\npaths: ["x/**", \'y/*.md\']\n---\nbody');
    expect(data).toEqual({ description: 'a: b', paths: ['x/**', 'y/*.md'] });
    expect(body).toBe('body');
    expect(matchesGlob('nodes/a.md', 'nodes/**')).toBe(true);
    expect(matchesGlob('nodes/tasks/a.md', 'nodes/*.md')).toBe(false);
    expect(matchesGlob('a/b/c.md', '**/*.md')).toBe(true);
    expect(matchesGlob('c.md', '**/*.md')).toBe(true);
    expect(matchesGlob('nodes/ideas/x.md', 'nodes/{ideas,notes}/**')).toBe(true);
  });
});

describe('runToolLoop', () => {
  it('runs tools inside the vault, injects folder rules once, sums cost, persists the session', async () => {
    const provider = scripted([
      {
        stream: ['Filing', ' it.'],
        toolCalls: [
          { id: 't1', name: 'read_file', input: { path: 'index/INDEX.md' } },
          { id: 't2', name: 'read_file', input: { path: '.synapse/settings.json' } },
          { id: 't3', name: 'write_file', input: { path: 'nodes/tasks/call-sara.md', content: '---\ntype: task\ntitle: تماس با سارا\n---\n' } },
          { id: 't4', name: 'write_file', input: { path: 'index/INDEX.md', content: 'hacked' } },
          { id: 't5', name: 'edit_file', input: { path: 'nodes/tasks/call-sara.md', old_string: 'title: تماس با سارا', new_string: 'title: تماس با سارا احمدی' } },
        ],
        usage: { input: 100, output: 20, cacheRead: 50, costUsd: 0.01 },
        raw: [{ type: 'text', text: 'Filing it.' }],
      },
      { stream: ['created [[تماس با سارا احمدی]] (task)'], usage: { input: 200, output: 30, costUsd: 0.02 } },
    ]);
    const sessionsDir = path.join(root, '.synapse', 'engine-sessions', 'anthropic-api');
    const queue = new AsyncQueue<BrainEvent>();
    void runToolLoop({ provider, model: 'claude-sonnet-5-5', sessionsDir, request: { prompt: '/capture فردا به سارا زنگ بزنم', cwd: root, effort: 'low', systemAppendFile: path.join(root, '.synapse', 'runtime-context.md') } }, queue);
    const events = await collect(queue);

    expect(events.map((e) => e.type)).toEqual([
      'init', 'text_delta', 'text_delta',
      'tool_use', 'tool_result', 'tool_use', 'tool_result', 'tool_use', 'tool_result', 'tool_use', 'tool_result', 'tool_use', 'tool_result',
      'text_delta', 'text_delta', 'result',
    ]);
    const oks = events.filter((e) => e.type === 'tool_result').map((e) => (e.type === 'tool_result' ? e.ok : null));
    expect(oks).toEqual([true, false, true, false, true]);
    const text = events.filter((e) => e.type === 'text_delta').map((e) => (e.type === 'text_delta' ? e.text : '')).join('');
    expect(text).toBe('Filing it.\n\ncreated [[تماس با سارا احمدی]] (task)');
    const result = events.at(-1);
    expect(result?.type).toBe('result');
    if (result?.type === 'result') {
      expect(result.text).toBe('Filing it.\n\ncreated [[تماس با سارا احمدی]] (task)');
      expect(result.costUsd).toBe(0.03);
      expect(result.tokens).toEqual({ input: 300, output: 50, cacheRead: 50, cacheWrite: 0 });
      expect(result.numTurns).toBe(2);
      expect(result.isError).toBe(false);
      expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    }
    // the vault
    expect(await fs.readFile(path.join(root, 'nodes', 'tasks', 'call-sara.md'), 'utf8')).toContain('title: تماس با سارا احمدی');
    expect(await fs.readFile(path.join(root, 'index', 'INDEX.md'), 'utf8')).toContain('# Vault index');

    // the first request: system prompt + expanded skill + effort + tools
    const first = provider.calls[0];
    expect(first?.model).toBe('claude-sonnet-5-5');
    expect(first?.effort).toBe('low');
    expect(first?.tools.map((t) => t.name)).toEqual(['read_file', 'list_files', 'grep', 'write_file', 'edit_file']);
    expect(first?.system.stable).toContain('Index first, never bulk-read.');
    expect(first?.system.stable).toContain('# Owner profile (memory/profile.md)');
    expect(first?.system.stable).toContain('`.claude/rules/tasks.md` — Authoring rules for task nodes. (applies to nodes/tasks/**)');
    expect(first?.system.stable).toContain('# Tools');
    expect(first?.system.volatile).toContain('- Mode: capture');
    const user = first?.messages[0];
    expect(user?.role === 'user' ? user.text : '').toContain('Run the "capture" skill now.');

    // the second request carries the assistant turn (raw kept) and the tool results with rules injected exactly once
    const second = provider.calls[1];
    expect(second?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool_results']);
    const assistant = second?.messages[1];
    expect(assistant?.role === 'assistant' ? assistant.raw : null).toEqual([{ type: 'text', text: 'Filing it.' }]);
    const results = second?.messages[2];
    const joined = results?.role === 'tool_results' ? results.results.map((r) => r.content).join('\n') : '';
    expect(joined.match(/\[Folder rule \.claude\/rules\/tasks\.md/g)?.length).toBe(1);
    expect(joined.match(/\[Folder rule \.claude\/rules\/node-format\.md/g)?.length).toBe(1);
    expect(joined).toContain('- atomic next actions');
    const t2 = results?.role === 'tool_results' ? results.results[1] : undefined;
    expect(t2?.isError).toBe(true);
    expect(t2?.content).toMatch(/app-private/);

    // session persisted and resumable
    const sessionId = result?.type === 'result' ? result.sessionId : '';
    const saved = JSON.parse(await fs.readFile(path.join(sessionsDir, `${sessionId}.json`), 'utf8')) as { messages: unknown[] };
    expect(saved.messages).toHaveLength(4);
    const again = scripted([{ stream: ['ok'] }]);
    const q2 = new AsyncQueue<BrainEvent>();
    void runToolLoop({ provider: again, model: 'claude-sonnet-5-5', sessionsDir, request: { prompt: 'thanks', cwd: root, sessionId } }, q2);
    const ev2 = await collect(q2);
    expect(ev2[0]).toEqual({ type: 'init', sessionId, model: 'claude-sonnet-5-5' });
    expect(again.calls[0]?.messages).toHaveLength(5);
    expect(again.calls[0]?.messages.at(-1)).toEqual({ role: 'user', text: 'thanks' });
    const unknown = new AsyncQueue<BrainEvent>();
    void runToolLoop({ provider: scripted([{ stream: ['fresh'] }]), model: 'm', sessionsDir, request: { prompt: 'hi', cwd: root, sessionId: 'missing-session' } }, unknown);
    const ev3 = await collect(unknown);
    expect(ev3[0]?.type === 'init' ? ev3[0].sessionId : '').not.toBe('missing-session');
  });

  it('stops after maxTurns with an error result and reports provider failures as error events', async () => {
    const loops = scripted([{ toolCalls: [{ id: 'x', name: 'read_file', input: { path: 'index/INDEX.md' } }] }]);
    const q = new AsyncQueue<BrainEvent>();
    void runToolLoop({ provider: loops, model: 'm', sessionsDir: path.join(root, '.synapse', 's'), request: { prompt: 'loop', cwd: root, maxTurns: 2 } }, q);
    const events = await collect(q);
    const result = events.at(-1);
    expect(result?.type).toBe('result');
    if (result?.type === 'result') { expect(result.isError).toBe(true); expect(result.text).toBe('stopped after 2 turns without a final answer'); expect(result.numTurns).toBe(2); }
    expect(loops.calls).toHaveLength(2);

    const failing: ChatProvider = { id: 'openai-api', complete: async () => { throw new Error('OpenAI rejected the API key (401).'); } };
    const q2 = new AsyncQueue<BrainEvent>();
    void runToolLoop({ provider: failing, model: 'm', sessionsDir: path.join(root, '.synapse', 's'), request: { prompt: 'x', cwd: root } }, q2);
    const ev2 = await collect(q2);
    expect(ev2.map((e) => e.type)).toEqual(['init', 'error']);
    expect(ev2[1]).toEqual({ type: 'error', message: 'OpenAI rejected the API key (401).' });

    const refusing = scripted([{ text: '', stopReason: 'refusal' }]);
    const q3 = new AsyncQueue<BrainEvent>();
    void runToolLoop({ provider: refusing, model: 'm', sessionsDir: path.join(root, '.synapse', 's'), request: { prompt: 'x', cwd: root } }, q3);
    const ev3 = await collect(q3);
    const r3 = ev3.at(-1);
    expect(r3?.type === 'result' ? [r3.isError, r3.text] : null).toEqual([true, 'the model declined this request']);
  });

  it('honours an already-aborted signal', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const q = new AsyncQueue<BrainEvent>();
    void runToolLoop({ provider: scripted([{ stream: ['never'] }]), model: 'm', sessionsDir: path.join(root, '.synapse', 's'), request: { prompt: 'x', cwd: root }, signal: ctl.signal }, q);
    const events = await collect(q);
    expect(events.at(-1)).toEqual({ type: 'error', message: 'run cancelled' });
  });
});
