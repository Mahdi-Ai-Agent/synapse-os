import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { Bold, Code, Heading2, Italic, List, ListChecks, ListOrdered, Quote, Strikethrough } from 'lucide-react';
import { useRef } from 'react';
import { useT, type TKey } from '../i18n';
import { docToMarkdown, editorExtensions, markdownToDoc } from '../lib/editor-markdown';

/**
 * WYSIWYG body editor (TipTap). `initial` is the node body as stored; `onChange` receives Markdown after each edit.
 * A document equal to the loaded one reports the original string back, so unchanged bodies stay byte-identical.
 */
export function BodyEditor({ initial, onChange }: { initial: string; onChange: (markdown: string) => void }) {
  const t = useT();
  const loaded = useRef<PMNode | null>(null);
  const content = useRef<JSONContent | null>(null);
  if (content.current === null) content.current = markdownToDoc(initial);

  const editor = useEditor({
    extensions: editorExtensions(),
    content: content.current,
    editorProps: { attributes: { class: 'body-editor prose-md min-h-40 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent', dir: 'auto' } },
    onCreate: ({ editor: e }) => { loaded.current = e.state.doc; },
    onUpdate: ({ editor: e }) => {
      onChange(loaded.current && e.state.doc.eq(loaded.current) ? initial : docToMarkdown(e.getJSON()));
    },
  });

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
      strike: e?.isActive('strike') ?? false,
      code: e?.isActive('code') ?? false,
      heading: e?.isActive('heading', { level: 2 }) ?? false,
      bullets: e?.isActive('bulletList') ?? false,
      numbered: e?.isActive('orderedList') ?? false,
      tasks: e?.isActive('taskList') ?? false,
      quote: e?.isActive('blockquote') ?? false,
    }),
  });

  if (!editor) return null;
  const tools: Array<{ key: TKey; on: boolean; Icon: typeof Bold; run: () => void }> = [
    { key: 'editor.bold', on: active.bold, Icon: Bold, run: () => editor.chain().focus().toggleBold().run() },
    { key: 'editor.italic', on: active.italic, Icon: Italic, run: () => editor.chain().focus().toggleItalic().run() },
    { key: 'editor.strike', on: active.strike, Icon: Strikethrough, run: () => editor.chain().focus().toggleStrike().run() },
    { key: 'editor.code', on: active.code, Icon: Code, run: () => editor.chain().focus().toggleCode().run() },
    { key: 'editor.heading', on: active.heading, Icon: Heading2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { key: 'editor.bullets', on: active.bullets, Icon: List, run: () => editor.chain().focus().toggleBulletList().run() },
    { key: 'editor.numbered', on: active.numbered, Icon: ListOrdered, run: () => editor.chain().focus().toggleOrderedList().run() },
    { key: 'editor.tasks', on: active.tasks, Icon: ListChecks, run: () => editor.chain().focus().toggleTaskList().run() },
    { key: 'editor.quote', on: active.quote, Icon: Quote, run: () => editor.chain().focus().toggleBlockquote().run() },
  ];

  return (
    <div className="mt-1 space-y-1">
      <div className="flex flex-wrap gap-0.5" role="toolbar">
        {tools.map(({ key, on, Icon, run }) => (
          <button key={key} type="button" title={t(key)} onMouseDown={(e) => e.preventDefault()} onClick={run} className={`rounded-md p-1 ${on ? 'bg-panel2 text-accent' : 'text-muted hover:bg-panel2 hover:text-text'}`}>
            <Icon size={14} />
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
      <p className="text-[10px] text-muted">{t('editor.hint')}</p>
    </div>
  );
}
