import yaml from 'js-yaml';

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export interface SplitResult {
  data: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
  /** Set when the YAML did not parse; `data` then comes from the lenient line parser (if anything was recovered). */
  yamlError?: string;
  recovered?: boolean;
}

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1);
  return t;
}

function coerce(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

/**
 * Line-based fallback for frontmatter that is not valid YAML — typically an unquoted `: ` inside a
 * value written by the brain (`summary: review: 2 overdue`). Handles `key: value`, `key:` + `- item`
 * block lists and `[a, b]` inline lists. Anything it cannot read is skipped, never guessed.
 */
export function parseLenientFrontmatter(src: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  let listKey: string | null = null;
  for (const raw of src.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const item = /^\s+-\s*(.*)$/.exec(raw);
    if (item && listKey) { (data[listKey] as unknown[]).push(unquote(item[1] ?? '')); continue; }
    const kv = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(raw);
    if (!kv) { listKey = null; continue; }
    const key = kv[1] as string;
    const val = (kv[2] ?? '').trim();
    if (val === '') { data[key] = []; listKey = key; continue; }
    listKey = null;
    if (val.startsWith('[') && val.endsWith(']') && !val.startsWith('[[')) {
      data[key] = val.slice(1, -1).split(',').map((x) => unquote(x)).filter((x) => x.length > 0);
      continue;
    }
    data[key] = coerce(unquote(val));
  }
  return data;
}

/** Splits a Markdown document into YAML data and body. Dates stay strings (CORE schema). */
export function splitFrontmatter(text: string): SplitResult {
  const m = FM_RE.exec(text);
  if (!m) return { data: {}, body: text, hasFrontmatter: false };
  const body = text.slice(m[0].length);
  try {
    const loaded = yaml.load(m[1] ?? '', { schema: yaml.CORE_SCHEMA });
    const data = loaded && typeof loaded === 'object' && !Array.isArray(loaded) ? (loaded as Record<string, unknown>) : {};
    return { data, body, hasFrontmatter: true };
  } catch (err) {
    const data = parseLenientFrontmatter(m[1] ?? '');
    return { data, body, hasFrontmatter: true, yamlError: err instanceof Error ? err.message : String(err), recovered: Object.keys(data).length > 0 };
  }
}

/** Joins data + body into a Markdown document with a YAML frontmatter block. */
export function joinFrontmatter(data: Record<string, unknown>, body: string): string {
  const y = yaml.dump(data, { schema: yaml.CORE_SCHEMA, lineWidth: -1, noRefs: true, sortKeys: false, quotingType: '"' });
  const trimmedBody = body.replace(/^\s*\n/, '');
  return `---\n${y}---\n${trimmedBody}`;
}
