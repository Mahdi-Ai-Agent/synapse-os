import type { LinkIndex } from './links';
import type { SearchIndex } from './search';
import type { VaultNode } from './types';

export interface RelatedHit {
  id: string;
  title: string;
  type: string;
  summary: string;
  path: string;
  score: number;
  /** Query terms the candidate shares with the node, strongest first (the "why"). */
  terms: string[];
}

export interface RelatedOptions {
  /** Node ids never suggested (already linked, dismissed, …). The node itself is always excluded. */
  exclude?: ReadonlySet<string>;
  /** Node types never suggested. Default: inbox and journal. */
  excludeTypes?: ReadonlySet<string>;
  /** Drop hits below this BM25 score. */
  minScore?: number;
  /** How many of the node's own terms form the query. */
  maxTerms?: number;
}

/** Same splitter MiniSearch uses by default, so query terms line up with indexed terms. */
const SPLIT_RE = /[\n\r\p{Z}\p{P}]+/u;
const DIGITS_RE = /^\d+$/;

const STOPWORDS = new Set<string>([
  // English
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'it', 'its', 'this', 'that', 'these', 'those', 'as', 'if', 'not', 'no', 'but', 'so', 'we', 'i', 'you', 'he', 'she', 'they', 'my', 'our',
  'your', 'me', 'do', 'does', 'did', 'has', 'have', 'had', 'will', 'would', 'can', 'could', 'should', 'than', 'then', 'there', 'here',
  'what', 'when', 'where', 'which', 'who', 'how', 'all', 'any', 'each', 'more', 'most', 'some', 'such', 'only', 'own', 'same', 'into',
  'over', 'after', 'before', 'about', 'up', 'down', 'out', 'see', 'also', 'one', 'two', 'per', 'via', 'http', 'https', 'www', 'com',
  // Persian
  'و', 'در', 'به', 'از', 'که', 'را', 'رو', 'با', 'این', 'آن', 'اون', 'برای', 'یک', 'یه', 'تا', 'هم', 'یا', 'اگر', 'ولی', 'اما', 'بر', 'هر',
  'است', 'هست', 'بود', 'شد', 'می', 'نمی', 'شود', 'کند', 'کنم', 'کنیم', 'باشد', 'دارم', 'داریم', 'دارد', 'ما', 'من', 'تو', 'او', 'شما',
  'آنها', 'چی', 'چه', 'کی', 'کجا', 'چرا', 'روی', 'بعد', 'قبل', 'امروز', 'فردا', 'دیروز', 'هفته', 'ماه', 'سال', 'روز', 'خیلی', 'باید',
  'شاید', 'همه', 'چیز', 'اینو', 'اونو', 'مثل', 'بین', 'پیش', 'فقط', 'حتی', 'دیگر', 'دیگه', 'همین', 'همان', 'آیا', 'بله', 'نه', 'هستم',
]);

function tokens(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .split(SPLIT_RE)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 2 && !DIGITS_RE.test(t) && !STOPWORDS.has(t));
}

/** The node's most characteristic terms: title and tags weigh 3, summary 2, body 1 per occurrence (capped). */
export function relatedQueryTerms(node: VaultNode, maxTerms = 40): string[] {
  const weight = new Map<string, number>();
  const add = (list: string[], w: number, cap = Infinity): void => {
    for (const t of list) weight.set(t, Math.min(cap, (weight.get(t) ?? 0) + w));
  };
  add(tokens(node.fm.title), 3);
  add(node.fm.tags.map((t) => t.toLowerCase()), 3);
  add(tokens(node.fm.aliases.join(' ')), 2);
  add(tokens(node.fm.summary), 2);
  add(tokens(node.body), 1, 4);
  return [...weight.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxTerms)
    .map(([t]) => t);
}

/** Ids connected to `id` in either direction (resolved outgoing targets + backlink sources). */
export function linkedNodeIds(links: LinkIndex, id: string): Set<string> {
  const out = new Set<string>();
  for (const l of links.outgoing.get(id) ?? []) if (l.resolved) out.add(l.target);
  for (const s of links.backlinks.get(id) ?? []) out.add(s);
  return out;
}

/**
 * Lexically similar nodes ("more like this") from the MiniSearch index: the node's own terms are the query,
 * candidates are ranked by BM25 over title/aliases/summary/tags/body, and already-linked nodes are excluded.
 */
export function relatedNodes(index: SearchIndex, node: VaultNode, limit = 8, opts: RelatedOptions = {}): RelatedHit[] {
  const terms = relatedQueryTerms(node, opts.maxTerms ?? 40);
  if (!terms.length) return [];
  const exclude = opts.exclude ?? new Set<string>();
  const excludeTypes = opts.excludeTypes ?? new Set(['inbox', 'journal']);
  const minScore = opts.minScore ?? 1;
  const hits = index.search(terms.join(' '), {
    combineWith: 'OR',
    prefix: false,
    fuzzy: false,
    boost: { title: 3, tags: 3, summary: 2, aliases: 2 },
    filter: (r) => String(r.id) !== node.fm.id && !exclude.has(String(r.id)) && !excludeTypes.has(String(r['type'])),
  });
  return hits
    .filter((r) => r.score >= minScore)
    .slice(0, limit)
    .map((r) => ({
      id: String(r.id),
      title: String(r['title']),
      type: String(r['type']),
      summary: String(r['summary']),
      path: String(r['path']),
      score: Math.round(r.score * 1000) / 1000,
      terms: r.terms.slice(0, 5),
    }));
}
