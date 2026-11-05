import MiniSearch from 'minisearch';
import type { VaultNode } from './types';

export interface SearchDoc {
  id: string;
  title: string;
  type: string;
  summary: string;
  status: string;
  path: string;
  body: string;
  tags: string;
  aliases: string;
}

export interface SearchHit {
  id: string;
  title: string;
  type: string;
  summary: string;
  status: string;
  path: string;
  score: number;
}

export type SearchIndex = MiniSearch<SearchDoc>;

export function buildSearchIndex(nodes: VaultNode[]): SearchIndex {
  const index = new MiniSearch<SearchDoc>({
    fields: ['title', 'aliases', 'summary', 'tags', 'body'],
    storeFields: ['id', 'title', 'type', 'summary', 'status', 'path'],
    searchOptions: { boost: { title: 4, aliases: 3, summary: 2, tags: 2 }, prefix: true, fuzzy: 0.2 },
  });
  index.addAll(
    nodes.map((n) => ({
      id: n.fm.id,
      title: n.fm.title,
      type: n.fm.type,
      summary: n.fm.summary,
      status: n.fm.status,
      path: n.path,
      body: n.body.slice(0, 20_000),
      tags: n.fm.tags.join(' '),
      aliases: n.fm.aliases.join(' '),
    })),
  );
  return index;
}

export function searchNodes(index: SearchIndex, query: string, limit = 20): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  return index.search(q).slice(0, limit).map((r) => ({
    id: String(r.id),
    title: String(r['title']),
    type: String(r['type']),
    summary: String(r['summary']),
    status: String(r['status']),
    path: String(r['path']),
    score: r.score,
  }));
}
