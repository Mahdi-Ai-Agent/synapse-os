import { mergeAttributes, Node, nodeInputRule, type MarkdownToken } from '@tiptap/core';

export interface WikilinkAttrs { target: string; subpath: string | null; alias: string | null }

/** `[[Title]]`, `[[Title#Heading]]`, `[[Title|shown text]]` — same grammar as packages/core `extractWikilinks`. */
const WIKILINK_HEAD_RE = /^\[\[([^[\]|#]+)(?:#([^[\]|]*))?(?:\|([^[\]]*))?\]\]/;
// Group 1 spans the whole link: TipTap's nodeInputRule replaces `match[1]`, so it must cover the brackets too.
const WIKILINK_INPUT_RE = /(\[\[([^[\]|#]+)(?:#([^[\]|]*))?(?:\|([^[\]]*))?\]\])$/;

export function wikilinkText(a: WikilinkAttrs): string {
  return `[[${a.target}${a.subpath ? `#${a.subpath}` : ''}${a.alias ? `|${a.alias}` : ''}]]`;
}

function attrsFromMatch(m: RegExpExecArray | RegExpMatchArray, offset = 0): WikilinkAttrs {
  return { target: (m[1 + offset] ?? '').trim(), subpath: m[2 + offset]?.trim() || null, alias: m[3 + offset]?.trim() || null };
}

function attrsOf(attrs: Record<string, unknown> | undefined): WikilinkAttrs {
  return {
    target: typeof attrs?.['target'] === 'string' ? attrs['target'] : '',
    subpath: typeof attrs?.['subpath'] === 'string' && attrs['subpath'] ? attrs['subpath'] : null,
    alias: typeof attrs?.['alias'] === 'string' && attrs['alias'] ? attrs['alias'] : null,
  };
}

/**
 * Inline atom node for vault wikilinks. In the editor it shows the alias or title as a chip; in Markdown it is
 * written back verbatim as `[[Title]]` (never backslash-escaped), so files stay Obsidian-compatible.
 */
export const Wikilink = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      target: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-target') ?? '', renderHTML: (a: Record<string, unknown>) => ({ 'data-target': a['target'] }) },
      subpath: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-subpath'), renderHTML: (a: Record<string, unknown>) => (a['subpath'] ? { 'data-subpath': a['subpath'] } : {}) },
      alias: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-alias'), renderHTML: (a: Record<string, unknown>) => (a['alias'] ? { 'data-alias': a['alias'] } : {}) },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-wikilink]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = attrsOf(node.attrs);
    return ['span', mergeAttributes(HTMLAttributes, { 'data-wikilink': '', class: 'wikilink', title: wikilinkText(a) }), a.alias ?? a.target];
  },

  renderText({ node }) {
    return wikilinkText(attrsOf(node.attrs));
  },

  addInputRules() {
    return [nodeInputRule({ find: WIKILINK_INPUT_RE, type: this.type, getAttributes: (m) => attrsFromMatch(m, 1) })];
  },

  // ---- Markdown round-trip hooks read by @tiptap/markdown
  markdownTokenName: 'wikilink',
  markdownTokenizer: {
    name: 'wikilink',
    level: 'inline',
    start: '[[',
    tokenize(src: string): MarkdownToken | undefined {
      const m = WIKILINK_HEAD_RE.exec(src);
      if (!m) return undefined;
      const a = attrsFromMatch(m);
      return { type: 'wikilink', raw: m[0], target: a.target, subpath: a.subpath, alias: a.alias };
    },
  },
  parseMarkdown(token, h) {
    return h.createNode('wikilink', attrsOf(token as Record<string, unknown>));
  },
  renderMarkdown(node) {
    return wikilinkText(attrsOf(node.attrs));
  },
});
