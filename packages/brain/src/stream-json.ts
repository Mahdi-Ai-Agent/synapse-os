import type { BrainEvent } from './types';

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** One line, at most `n` characters, for activity-feed summaries. */
export function clip(s: string, n = 140): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

/** One-line description of a tool call for the activity feed. */
export function summarizeToolUse(name: string, input: unknown): string {
  const i = isObj(input) ? input : {};
  const fp = str(i['file_path']) ?? str(i['notebook_path']) ?? str(i['path']);
  switch (name) {
    case 'Read': return `Read ${fp ?? ''}`.trim();
    case 'Write': return `Write ${fp ?? ''}`.trim();
    case 'Edit': case 'MultiEdit': return `Edit ${fp ?? ''}`.trim();
    case 'Glob': return `Glob ${str(i['pattern']) ?? ''}${fp ? ` in ${fp}` : ''}`.trim();
    case 'Grep': return `Grep ${JSON.stringify(str(i['pattern']) ?? '')}${fp ? ` in ${fp}` : ''}`;
    case 'Skill': return `Skill /${str(i['skill']) ?? str(i['command']) ?? '?'}`;
    case 'Bash': return `Bash ${clip(str(i['command']) ?? '', 100)}`;
    // In-app vault tools (API engines)
    case 'read_file': return `Read ${fp ?? ''}`.trim();
    case 'write_file': return `Write ${fp ?? ''}`.trim();
    case 'edit_file': return `Edit ${fp ?? ''}`.trim();
    case 'list_files': return `Glob ${str(i['pattern']) ?? ''}`.trim();
    case 'grep': return `Grep ${JSON.stringify(str(i['pattern']) ?? '')}${fp ? ` in ${fp}` : ''}`;
    // Codex items
    case 'command_execution': return `Bash ${clip(str(i['command']) ?? '', 100)}`;
    case 'file_change': {
      const changes = Array.isArray(i['changes']) ? i['changes'] : [];
      const names = changes.map((c) => (isObj(c) ? `${str(c['kind']) ?? 'update'} ${str(c['path']) ?? ''}`.trim() : '')).filter(Boolean);
      return `Edit ${clip(names.join(', '), 110)}`.trim();
    }
    case 'mcp_tool_call': return `MCP ${str(i['server']) ?? ''}/${str(i['tool']) ?? ''}`;
    case 'web_search': return `WebSearch ${clip(str(i['query']) ?? '', 100)}`;
    default: return `${name} ${clip(JSON.stringify(input ?? {}), 100)}`;
  }
}

/**
 * Stateful parser for Claude Code `--output-format stream-json` lines.
 * Text is streamed through `stream_event` deltas; when none arrive for a message
 * (e.g. partial messages disabled) the full assistant text is emitted instead.
 */
export function createStreamJsonParser(): { feed(line: string): BrainEvent[] } {
  let sawDeltaInMessage = false;
  return {
    feed(line: string): BrainEvent[] {
      const trimmed = line.trim();
      if (!trimmed) return [];
      let obj: unknown;
      try { obj = JSON.parse(trimmed); } catch { return []; }
      if (!isObj(obj)) return [];
      const type = str(obj['type']);
      const out: BrainEvent[] = [];

      if (type === 'system') {
        const subtype = str(obj['subtype']);
        if (subtype === 'init') {
          const ev: BrainEvent = { type: 'init', sessionId: str(obj['session_id']) ?? '' };
          const model = str(obj['model']); if (model) ev.model = model;
          out.push(ev);
        } else if (subtype === 'api_retry') {
          // The CLI waits out a failed API call (`attempt`, `max_retries`, `retry_delay_ms`, `error_status`, `error`): say so, or the run looks stuck.
          const attempt = typeof obj['attempt'] === 'number' ? obj['attempt'] : undefined;
          const max = typeof obj['max_retries'] === 'number' ? obj['max_retries'] : undefined;
          const delay = typeof obj['retry_delay_ms'] === 'number' ? Math.max(1, Math.round(obj['retry_delay_ms'] / 1000)) : undefined;
          const status = typeof obj['error_status'] === 'number' ? obj['error_status'] : undefined;
          const reason = [status !== undefined ? `HTTP ${status}` : '', str(obj['error']) ?? ''].filter(Boolean).join(' ');
          const parts = [`API retry${attempt !== undefined ? ` ${attempt}${max !== undefined ? `/${max}` : ''}` : ''}`];
          if (reason) parts.push(`(${reason})`);
          if (delay !== undefined) parts.push(`· next try in ${delay} s`);
          out.push({ type: 'notice', message: parts.join(' ') });
        }
        return out;
      }

      if (type === 'stream_event') {
        const ev = isObj(obj['event']) ? obj['event'] : {};
        const evType = str(ev['type']);
        if (evType === 'message_start') sawDeltaInMessage = false;
        if (evType === 'content_block_delta') {
          const delta = isObj(ev['delta']) ? ev['delta'] : {};
          if (str(delta['type']) === 'text_delta') {
            const text = str(delta['text']) ?? '';
            if (text) { sawDeltaInMessage = true; out.push({ type: 'text_delta', text }); }
          }
        }
        return out;
      }

      if (type === 'assistant') {
        if (obj['parent_tool_use_id']) return out; // subagent chatter
        const msg = isObj(obj['message']) ? obj['message'] : {};
        const content = Array.isArray(msg['content']) ? msg['content'] : [];
        for (const block of content) {
          if (!isObj(block)) continue;
          const bt = str(block['type']);
          if (bt === 'tool_use') {
            const name = str(block['name']) ?? 'tool';
            out.push({ type: 'tool_use', id: str(block['id']) ?? '', name, input: block['input'], summary: summarizeToolUse(name, block['input']) });
          } else if (bt === 'text' && !sawDeltaInMessage) {
            const text = str(block['text']) ?? '';
            if (text) out.push({ type: 'text_delta', text });
          }
        }
        sawDeltaInMessage = false;
        return out;
      }

      if (type === 'user') {
        if (obj['parent_tool_use_id']) return out;
        const msg = isObj(obj['message']) ? obj['message'] : {};
        const content = Array.isArray(msg['content']) ? msg['content'] : [];
        for (const block of content) {
          if (!isObj(block) || str(block['type']) !== 'tool_result') continue;
          const raw = block['content'];
          let text = '';
          if (typeof raw === 'string') text = raw;
          else if (Array.isArray(raw)) text = raw.map((c) => (isObj(c) ? str(c['text']) ?? '' : '')).join(' ');
          out.push({ type: 'tool_result', toolUseId: str(block['tool_use_id']) ?? '', ok: block['is_error'] !== true, summary: clip(text) });
        }
        return out;
      }

      if (type === 'result') {
        const usage = obj['usage'];
        const ev: BrainEvent = {
          type: 'result',
          text: str(obj['result']) ?? '',
          sessionId: str(obj['session_id']) ?? '',
          isError: obj['is_error'] === true || str(obj['subtype'])?.startsWith('error') === true,
        };
        if (typeof obj['total_cost_usd'] === 'number') ev.costUsd = obj['total_cost_usd'];
        if (usage !== undefined) ev.usage = usage;
        if (isObj(usage)) {
          const n = (k: string): number | undefined => (typeof usage[k] === 'number' ? (usage[k] as number) : undefined);
          const input = n('input_tokens'); const output = n('output_tokens');
          if (input !== undefined || output !== undefined) {
            ev.tokens = { input: input ?? 0, output: output ?? 0 };
            const cr = n('cache_read_input_tokens'); if (cr !== undefined) ev.tokens.cacheRead = cr;
            const cw = n('cache_creation_input_tokens'); if (cw !== undefined) ev.tokens.cacheWrite = cw;
          }
        }
        if (typeof obj['num_turns'] === 'number') ev.numTurns = obj['num_turns'];
        if (typeof obj['duration_ms'] === 'number') ev.durationMs = obj['duration_ms'];
        out.push(ev);
        return out;
      }
      return out;
    },
  };
}
