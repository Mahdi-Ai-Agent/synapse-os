import { Extension, type AnyExtension, type JSONContent } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { MarkdownManager } from '@tiptap/markdown';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import { dominantDir } from './format';
import { Wikilink } from './wikilink';

/** Each block is laid out in the direction of the script most of its letters are in (as the rendered Markdown is). */
const BlockDirection = Extension.create({
  name: 'blockDirection',
  addProseMirrorPlugins() {
    const decorate = (doc: PMNode): DecorationSet => {
      const decos: Decoration[] = [];
      doc.descendants((node, pos) => {
        if (!node.isTextblock) return;
        const dir = dominantDir(node.textContent);
        if (dir) decos.push(Decoration.node(pos, pos + node.nodeSize, { dir }));
      });
      return DecorationSet.create(doc, decos);
    };
    return [new Plugin<DecorationSet>({
      key: new PluginKey('blockDirection'),
      state: { init: (_config, state) => decorate(state.doc), apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old) },
      props: { decorations(state) { return this.getState(state) ?? null; } },
    })];
  },
});

/** Extensions shared by the body editor and the Markdown round-trip, so both sides use one schema. */
export function editorExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({ underline: false, link: { openOnClick: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Wikilink,
    BlockDirection,
  ];
}

/**
 * Escapes only what would change meaning on re-parse: a backslash before punctuation, backticks, `*`/`~` that touch
 * a non-space (flanking delimiters), `<` that could open a tag, `&` that could form an entity. `_`, `[` and `]`
 * stay literal so vault prose (`belongs_to`) and wikilinks are never rewritten.
 */
function escapeInlineMarkdown(text: string): string {
  return text
    .replace(/\\(?=[!-/:-@[-`{-~])/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/[*~](?=\S)|(?<=\S)[*~]/g, (c) => `\\${c}`)
    .replace(/<(?=[a-zA-Z/!?])/g, '\\<')
    .replace(/&(?=[a-zA-Z]+;|#\d+;)/g, '\\&');
}

class VaultMarkdownManager extends MarkdownManager {}
// The stock serializer HTML-encodes `& < >` and backslash-escapes `_ [ ]` as well, which would rewrite plain vault
// prose (`belongs_to`, `R&D`). Both helpers are private in the typings, so they are replaced on the subclass prototype.
Object.assign(VaultMarkdownManager.prototype as unknown as Record<string, unknown>, {
  encodeTextForMarkdown(this: { codeTypes: Set<string> }, text: string, node: JSONContent, parentNode?: JSONContent): string {
    const parentIsCode = parentNode?.type !== undefined && this.codeTypes.has(parentNode.type);
    const hasCodeMark = (node.marks ?? []).some((m) => this.codeTypes.has(typeof m === 'string' ? m : m.type));
    return parentIsCode || hasCodeMark ? text : escapeInlineMarkdown(text);
  },
  escapeMarkdownSyntax: escapeInlineMarkdown,
});

let manager: MarkdownManager | null = null;
function getManager(): MarkdownManager {
  manager ??= new VaultMarkdownManager({ extensions: editorExtensions() });
  return manager;
}

export function markdownToDoc(markdown: string): JSONContent {
  return getManager().parse(markdown);
}

/** Serializes a document to Markdown that ends with exactly one newline (an empty document gives ''). */
export function docToMarkdown(doc: JSONContent): string {
  const md = getManager().serialize(doc).replace(/\s+$/, '');
  return md ? `${md}\n` : '';
}
