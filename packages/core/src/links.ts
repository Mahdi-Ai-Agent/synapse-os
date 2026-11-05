import { relationTitles } from './node';
import { extractWikilinks, normalizeTitle, stripLinkBrackets } from './wikilinks';
import type { EdgeKind, VaultNode } from './types';

export interface OutgoingLink {
  /** Target node id when resolved, otherwise the ghost id `ghost:<normalized text>`. */
  target: string;
  kind: EdgeKind;
  resolved: boolean;
  /** Link text as written. */
  text: string;
}

export interface LinkIndex {
  /** normalized title or alias → node */
  byKey: Map<string, VaultNode>;
  byId: Map<string, VaultNode>;
  /** source node id → outgoing links (deduplicated by target+kind) */
  outgoing: Map<string, OutgoingLink[]>;
  /** target node id → set of source node ids */
  backlinks: Map<string, Set<string>>;
  /** ghost id → { text, sources } */
  unresolved: Map<string, { text: string; sources: Set<string> }>;
  /** titles claimed by more than one node (normalized) */
  duplicateTitles: Map<string, string[]>;
}

export function ghostId(text: string): string {
  return `ghost:${normalizeTitle(text)}`;
}

export function buildLinkIndex(nodes: VaultNode[]): LinkIndex {
  const byKey = new Map<string, VaultNode>();
  const byId = new Map<string, VaultNode>();
  const duplicateTitles = new Map<string, string[]>();

  for (const n of nodes) {
    byId.set(n.fm.id, n);
    const key = normalizeTitle(n.fm.title);
    const existing = byKey.get(key);
    if (existing && existing !== n) {
      const list = duplicateTitles.get(key) ?? [existing.path];
      list.push(n.path);
      duplicateTitles.set(key, list);
    } else {
      byKey.set(key, n);
    }
  }
  // Aliases never override a real title.
  for (const n of nodes) {
    for (const alias of n.fm.aliases) {
      const key = normalizeTitle(alias);
      if (!byKey.has(key)) byKey.set(key, n);
    }
  }

  const outgoing = new Map<string, OutgoingLink[]>();
  const backlinks = new Map<string, Set<string>>();
  const unresolved = new Map<string, { text: string; sources: Set<string> }>();

  for (const n of nodes) {
    const seen = new Set<string>();
    const list: OutgoingLink[] = [];
    const add = (text: string, kind: EdgeKind): void => {
      const target = byKey.get(normalizeTitle(text));
      if (target && target.fm.id === n.fm.id) return; // self-link
      const id = target ? target.fm.id : ghostId(text);
      const dedupe = `${id}|${kind}`;
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      list.push({ target: id, kind, resolved: Boolean(target), text });
      if (target) {
        let set = backlinks.get(target.fm.id);
        if (!set) { set = new Set(); backlinks.set(target.fm.id, set); }
        set.add(n.fm.id);
      } else {
        let g = unresolved.get(id);
        if (!g) { g = { text: text.trim(), sources: new Set() }; unresolved.set(id, g); }
        g.sources.add(n.fm.id);
      }
    };

    if (n.fm.type !== 'inbox') {
      for (const ref of extractWikilinks(n.body)) add(ref.target, 'link');
      for (const l of n.fm.links) add(stripLinkBrackets(l), 'link');
      const rel = relationTitles(n.fm);
      if (rel.project) add(rel.project, 'belongs_to');
      if (rel.area) add(rel.area, 'belongs_to');
      if (rel.map) add(rel.map, 'belongs_to');
      for (const p of rel.people) add(p, 'mentions');
    }
    outgoing.set(n.fm.id, list);
  }

  return { byKey, byId, outgoing, backlinks, unresolved, duplicateTitles };
}

export function resolveTitle(index: LinkIndex, text: string): VaultNode | undefined {
  return index.byKey.get(normalizeTitle(stripLinkBrackets(text)));
}
