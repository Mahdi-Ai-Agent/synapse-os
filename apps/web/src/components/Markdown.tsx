import { createElement, useMemo, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { dominantDir } from '../lib/format';
import { useStore } from '../state/store';

/** `[[Title|alias]]` → markdown link with a `wiki:` scheme the renderer intercepts. */
function preprocess(md: string): string {
  return md.replace(/\[\[([^[\]|#]+)(?:#[^[\]|]*)?(?:\|([^[\]]*))?\]\]/g, (_m, target: string, alias?: string) => {
    const t = target.trim();
    return `[${(alias ?? t).trim()}](wiki:${encodeURIComponent(t)})`;
  });
}

interface Hast { type?: string; value?: string; children?: Hast[] }
function textOf(node: Hast | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

/** A block keeps the direction of the script most of its letters are in (UI-DESIGN "i18n, RTL and mixed text"). */
function directed<T extends 'p' | 'li' | 'h1' | 'h2' | 'h3'>(tag: T) {
  return function Directed({ node, ...props }: ComponentPropsWithoutRef<T> & { node?: unknown }) {
    const dir = dominantDir(textOf(node as Hast | undefined));
    return createElement(tag, { ...props, ...(dir ? { dir } : {}) });
  };
}
const BLOCKS = { p: directed('p'), li: directed('li'), h1: directed('h1'), h2: directed('h2'), h3: directed('h3') };

/** Resolves a `[[Title]]` to the id of the item with that title (case-insensitive, NFC), from the loaded graph. */
export function useResolve(): (title: string) => string | null {
  const graph = useStore((s) => s.graph);
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const n of graph?.nodes ?? []) if (!n.ghost) map.set(n.title.normalize('NFC').toLowerCase(), n.id);
    return (title: string) => map.get(title.normalize('NFC').toLowerCase()) ?? null;
  }, [graph]);
}

export function Markdown({ text, resolve }: { text: string; resolve: (title: string) => string | null }) {
  const select = useStore((s) => s.select);
  return (
    <div className="prose-md text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // react-markdown drops unknown protocols; keep our `wiki:` hrefs so wikilinks stay clickable.
        urlTransform={(url) => (url.startsWith('wiki:') ? url : defaultUrlTransform(url))}
        components={{
          ...BLOCKS,
          a: ({ href, children }) => {
            if (href?.startsWith('wiki:')) {
              const title = decodeURIComponent(href.slice(5));
              const id = resolve(title);
              return (
                <span
                  className={`wikilink ${id ? '' : 'opacity-60'}`}
                  role="link"
                  tabIndex={0}
                  onClick={() => { if (id) select(id); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && id) select(id); }}
                >
                  {children}
                </span>
              );
            }
            return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
          },
        }}
      >
        {preprocess(text)}
      </ReactMarkdown>
    </div>
  );
}
