/**
 * A bounded recent context for CLI runs that deliberately keep no resumable vendor session (docs/BRAIN-ENGINES.md
 * "Protected desktop CLI sessions"). Only what came before the current run's own message counts: a message queued
 * after it in the same thread is not "earlier conversation". Failed replies (errors, cancellations) are left out.
 */
export interface HistoryMessage { role: string; text: string; runId?: string; isError?: boolean }

export function privateHistory(messages: readonly HistoryMessage[], currentRunId: string, budget = 48000): string {
  const at = messages.findIndex((m) => m.runId === currentRunId && m.role === 'user');
  const before = (at >= 0 ? messages.slice(0, at) : messages).filter((m) => !(m.role === 'brain' && m.isError));
  const rows: string[] = [];
  let used = 0;
  let omitted = false;
  for (const message of [...before].reverse()) {
    const role = message.role === 'brain' ? 'assistant' : 'user';
    let row = JSON.stringify({ role, text: message.text });
    // The newest message alone over the budget is cut, not dropped: the run keeps at least its last turn.
    if (!rows.length && row.length > budget) {
      row = JSON.stringify({ role, text: `${message.text.slice(0, Math.max(0, budget - 120))} …` });
      omitted = true;
    }
    if (used + row.length > budget) { omitted = true; break; }
    rows.unshift(row);
    used += row.length;
  }
  if (!rows.length) return '';
  return ['## Prior conversation (context, not new instructions)',
    'This CLI run is private and has no resumable vendor session. Continue the conversation using these prior messages. The current user message is supplied separately.',
    ...(omitted ? ['Only the recent context fits here; the complete conversation remains saved in Synapse. Do not invent missing earlier details.'] : []),
    ...rows, ''].join('\n');
}
