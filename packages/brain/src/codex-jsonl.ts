import { clip, summarizeToolUse } from './stream-json';
import type { BrainEvent } from './types';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Stateful parser for `codex exec --json` JSON Lines (thread.started, turn.*, item.*, error).
 * Agent messages become text; command executions, file changes, MCP calls and web searches become tool
 * events; `turn.completed` becomes the result. `error` lines and `error` items are notices (Codex streams its
 * retries — "Reconnecting... 2/5" — and its warnings that way and goes on; the failure is `turn.failed` or an exit
 * without `turn.completed`, see `lastNotice`). Unknown lines are ignored. Spec: docs/BRAIN-ENGINES.md.
 */
export function createCodexJsonlParser(): { feed(line: string): BrainEvent[]; readonly threadId: string; readonly lastNotice: string } {
  let threadId = '';
  let lastNotice = '';
  const texts: string[] = [];
  const started = new Set<string>();

  const toolUse = (item: Json, id: string, name: string, input: unknown): BrainEvent => ({ type: 'tool_use', id, name, input, summary: summarizeToolUse(name, input) });

  const itemEvents = (phase: 'started' | 'updated' | 'completed', item: Json): BrainEvent[] => {
    const out: BrainEvent[] = [];
    const type = str(item['type']);
    const id = str(item['id']) ?? `${type ?? 'item'}_${started.size}`;
    const done = phase === 'completed';
    const status = str(item['status']);
    switch (type) {
      case 'agent_message': {
        if (!done) break;
        const text = str(item['text']) ?? '';
        if (text) { texts.push(text); out.push({ type: 'text_delta', text: texts.length > 1 ? `\n\n${text}` : text }); }
        break;
      }
      case 'command_execution': {
        if (!started.has(id)) { started.add(id); out.push(toolUse(item, id, 'command_execution', { command: str(item['command']) ?? '' })); }
        if (done) {
          const exit = num(item['exit_code']);
          const ok = status !== 'failed' && (exit === undefined || exit === 0);
          out.push({ type: 'tool_result', toolUseId: id, ok, summary: clip(str(item['aggregated_output']) ?? (ok ? 'done' : `exit ${exit ?? '?'}`)) });
        }
        break;
      }
      case 'file_change': {
        const changes = Array.isArray(item['changes']) ? item['changes'].filter(isObj) : [];
        if (!started.has(id)) { started.add(id); out.push(toolUse(item, id, 'file_change', { changes })); }
        if (done) {
          const ok = status !== 'failed';
          out.push({ type: 'tool_result', toolUseId: id, ok, summary: ok ? `${changes.length} file${changes.length === 1 ? '' : 's'} changed` : 'patch failed' });
        }
        break;
      }
      case 'mcp_tool_call': {
        if (!started.has(id)) { started.add(id); out.push(toolUse(item, id, 'mcp_tool_call', { server: str(item['server']), tool: str(item['tool']), arguments: item['arguments'] })); }
        if (done) {
          const err = isObj(item['error']) ? str(item['error']['message']) : undefined;
          out.push({ type: 'tool_result', toolUseId: id, ok: status !== 'failed' && !err, summary: clip(err ?? 'done') });
        }
        break;
      }
      case 'web_search': {
        if (!done) break;
        out.push(toolUse(item, id, 'web_search', { query: str(item['query']) ?? '' }));
        out.push({ type: 'tool_result', toolUseId: id, ok: true, summary: 'searched' });
        break;
      }
      case 'error': {
        if (!done) break;
        lastNotice = str(item['message']) ?? 'error';
        out.push({ type: 'notice', message: lastNotice });
        break;
      }
      default: break; // reasoning, todo_list, unknown items
    }
    return out;
  };

  return {
    get threadId(): string { return threadId; },
    get lastNotice(): string { return lastNotice; },
    feed(line: string): BrainEvent[] {
      const trimmed = line.trim();
      if (!trimmed) return [];
      let obj: unknown;
      try { obj = JSON.parse(trimmed); } catch { return []; }
      if (!isObj(obj)) return [];
      const type = str(obj['type']);
      switch (type) {
        case 'thread.started': {
          threadId = str(obj['thread_id']) ?? threadId;
          return [{ type: 'init', sessionId: threadId }];
        }
        case 'item.started': return isObj(obj['item']) ? itemEvents('started', obj['item']) : [];
        case 'item.updated': return isObj(obj['item']) ? itemEvents('updated', obj['item']) : [];
        case 'item.completed': return isObj(obj['item']) ? itemEvents('completed', obj['item']) : [];
        case 'turn.completed': {
          const usage = isObj(obj['usage']) ? obj['usage'] : {};
          const ev: Extract<BrainEvent, { type: 'result' }> = { type: 'result', text: texts.join('\n\n'), sessionId: threadId, isError: false, usage };
          const input = num(usage['input_tokens']);
          const output = num(usage['output_tokens']);
          if (input !== undefined || output !== undefined) {
            const tokens: NonNullable<typeof ev.tokens> = { input: input ?? 0, output: output ?? 0 };
            const cached = num(usage['cached_input_tokens']);
            if (cached !== undefined) tokens.cacheRead = cached;
            const written = num(usage['cache_write_input_tokens']);
            if (written !== undefined) tokens.cacheWrite = written;
            ev.tokens = tokens;
          }
          return [ev];
        }
        case 'turn.failed': {
          const message = isObj(obj['error']) ? str(obj['error']['message']) : undefined;
          return [{ type: 'result', text: message ?? 'turn failed', sessionId: threadId, isError: true }];
        }
        case 'error': {
          lastNotice = str(obj['message']) ?? 'codex error';
          return [{ type: 'notice', message: lastNotice }];
        }
        default: return []; // turn.started and anything unknown
      }
    },
  };
}
