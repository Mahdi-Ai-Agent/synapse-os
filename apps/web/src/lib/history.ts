/**
 * An item's history (spec: docs/UI-DESIGN.md "Item details"): the day it was created, the dated lines the brain or
 * the user appended to its body (`- YYYY-MM-DD: what changed`, VAULT-SPEC "Node files" → History), and the day it
 * was finished. The dated lines are lifted out of the rendered text and shown as a timeline instead.
 */

export interface HistoryEntry {
  date: string;
  text: string;
  kind: 'created' | 'note' | 'done';
}

const LOG_LINE = /^\s*[-*]\s+(\d{4}-\d{2}-\d{2})\s*(?:[:：—–-]\s*)(.+?)\s*$/;

/** Splits the dated history lines out of a body. */
export function splitHistory(body: string): { text: string; notes: HistoryEntry[] } {
  const keep: string[] = [];
  const notes: HistoryEntry[] = [];
  for (const line of body.split('\n')) {
    const m = LOG_LINE.exec(line);
    if (m) notes.push({ date: m[1] ?? '', text: m[2] ?? '', kind: 'note' });
    else keep.push(line);
  }
  return { text: keep.join('\n').replace(/\n{3,}/g, '\n\n').trim(), notes: notes.sort((a, b) => a.date.localeCompare(b.date)) };
}

/** The timeline of an item: created, then its dated notes, then finished (when it is). */
export function timelineOf(fm: { created: string; completed?: string; status: string }, body: string, labels: { created: string; finished: string }): { text: string; entries: HistoryEntry[] } {
  const { text, notes } = splitHistory(body);
  const entries: HistoryEntry[] = [];
  if (fm.created) entries.push({ date: fm.created.slice(0, 10), text: labels.created, kind: 'created' });
  entries.push(...notes);
  if (fm.completed) entries.push({ date: fm.completed, text: labels.finished, kind: 'done' });
  return { text, entries };
}
