export interface LinkRef {
  /** Full match, e.g. `[[Title|alias]]`. */
  raw: string;
  /** Link target text as written (trimmed), without `#subpath` or `|alias`. */
  target: string;
  alias?: string;
  subpath?: string;
}

const LINK_RE = /\[\[([^[\]|#]+)(?:#([^[\]|]*))?(?:\|([^[\]]*))?\]\]/g;

/** Extracts `[[wikilinks]]` from text. Links inside fenced code blocks are skipped. */
export function extractWikilinks(text: string): LinkRef[] {
  const out: LinkRef[] = [];
  const withoutCode = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const m of withoutCode.matchAll(LINK_RE)) {
    const target = (m[1] ?? '').trim();
    if (!target) continue;
    const ref: LinkRef = { raw: m[0], target };
    if (m[2] !== undefined && m[2] !== '') ref.subpath = m[2].trim();
    if (m[3] !== undefined && m[3] !== '') ref.alias = m[3].trim();
    out.push(ref);
  }
  return out;
}

/** Normalization key for titles/aliases/link targets: NFC, trim, collapse spaces, case-fold. */
export function normalizeTitle(s: string): string {
  return s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** `"[[Title|alias]]"` → `Title`; plain strings are returned trimmed. */
export function stripLinkBrackets(s: string): string {
  const m = /^\s*\[\[([^[\]|#]+)(?:#[^[\]|]*)?(?:\|[^[\]]*)?\]\]\s*$/.exec(s);
  return (m?.[1] ?? s).trim();
}

export function toWikilink(title: string): string {
  return `[[${title}]]`;
}

/**
 * Rewrites every `[[link]]` whose target is `oldTitle` (normalized match) to `newTitle`, keeping `#subpath` and
 * `|alias`. Fenced blocks and inline code are left untouched. Works on a whole file, so quoted frontmatter values
 * (`area: "[[Old]]"`) are rewritten too.
 */
export function rewriteWikilinks(text: string, oldTitle: string, newTitle: string): { text: string; count: number } {
  const key = normalizeTitle(oldTitle);
  let count = 0;
  const rewrite = (segment: string): string =>
    segment.replace(LINK_RE, (raw: string, target: string, subpath?: string, alias?: string) => {
      if (normalizeTitle(target) !== key) return raw;
      count++;
      return `[[${newTitle}${subpath !== undefined ? `#${subpath}` : ''}${alias !== undefined ? `|${alias}` : ''}]]`;
    });
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/);
  return { text: parts.map((p, i) => (i % 2 === 1 ? p : rewrite(p))).join(''), count };
}
