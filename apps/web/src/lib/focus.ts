/**
 * The full review's focus list (`memory/focus.md`, written by `/review`; VAULT-SPEC "Memory"): what to spend time on
 * now, this week, what waits on others, what the review asks of the user and what it changed. The headings are fixed
 * English; the lines are in the user's language, one `[[Title]]` each.
 */
export interface FocusLine { title: string | null; text: string; why: string }
export interface Focus { date: string | null; now: FocusLine[]; week: FocusLine[]; waiting: FocusLine[]; asked: string[]; review: string | null }

const SECTIONS: Record<string, keyof Omit<Focus, 'date' | 'review'> | 'review'> = { now: 'now', 'this week': 'week', waiting: 'waiting', 'asked of you': 'asked', 'this review': 'review' };

/** One list line: the item it names (its first `[[Title]]`, alias dropped) and the reason after the dash. */
export function focusLine(raw: string): FocusLine {
  const text = raw.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim();
  const m = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/.exec(text);
  const dash = text.search(/\s[—–-]\s/);
  return { title: m?.[1]?.trim() ?? null, text, why: dash >= 0 ? text.slice(dash).replace(/^\s[—–-]\s/, '').trim() : '' };
}

export function parseFocus(md: string): Focus {
  const out: Focus = { date: null, now: [], week: [], waiting: [], asked: [], review: null };
  let at: string | null = null;
  for (const line of md.split('\n')) {
    const h1 = /^#\s+.*?(\d{4}-\d{2}-\d{2})/.exec(line);
    if (h1 && !out.date) { out.date = h1[1] ?? null; continue; }
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) { at = SECTIONS[(h2[1] ?? '').toLowerCase()] ?? null; continue; }
    if (!at || !/^\s*(?:[-*]|\d+[.)])\s+\S/.test(line)) continue;
    if (at === 'review') out.review = (out.review ? `${out.review} · ` : '') + focusLine(line).text;
    else if (at === 'asked') out.asked.push(focusLine(line).text);
    else (out[at as 'now' | 'week' | 'waiting']).push(focusLine(line));
  }
  return out;
}
