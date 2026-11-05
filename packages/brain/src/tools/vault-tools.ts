import { promises as fs } from 'node:fs';
import path from 'node:path';
import { matchesGlob, normalizeRel } from '../glob';

/**
 * File tools for the in-app tool loop, confined to one vault: reads anywhere inside it except the app-private
 * folders, writes only under `nodes/` and `memory/` (the same boundary the vault's `guard-paths.sh` hook enforces
 * for Claude Code). Spec: docs/BRAIN-ENGINES.md ("API engines").
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
}

export interface ToolOutcome {
  ok: boolean;
  content: string;
  /** Vault-relative path the call touched (read, listed under, or written); drives folder-rule injection. */
  path?: string;
  wrote?: boolean;
}

/** Top-level folders the brain may never read (keys, sessions, git internals). */
export const READ_DENY = new Set(['.synapse', '.git']);
/** Top-level folders the brain may write. */
export const WRITE_ALLOW = new Set(['nodes', 'memory']);
/** Folders skipped while walking (generated or private). */
const WALK_SKIP = new Set(['.git', '.synapse', 'node_modules']);

const MAX_READ_BYTES = 200_000;
const MAX_LIST = 500;
const MAX_GREP = 200;
const MAX_GREP_FILE_BYTES = 2_000_000;

export const VAULT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file inside the vault by vault-relative path (e.g. "index/INDEX.md", "nodes/tasks/x.md"). Optional offset (1-based first line) and limit (number of lines) for long files. The app-private folders .synapse/ and .git/ cannot be read.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Vault-relative path' }, offset: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1 } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'list_files',
    description: 'List files whose vault-relative path matches a glob, e.g. "nodes/tasks/*.md", "nodes/**/*.md", "*.md" (a bare name pattern also matches at any depth). Returns one path per line, at most 500.',
    inputSchema: { type: 'object', properties: { pattern: { type: 'string', description: 'Glob with *, **, ?, {a,b}' } }, required: ['pattern'], additionalProperties: false },
  },
  {
    name: 'grep',
    description: 'Search file contents with a regular expression (case-insensitive unless ignore_case is false) under a folder or in one file; default scope is the whole vault. Returns "path:line: text" lines, at most 200. Use it to find nodes by title, tag or phrase instead of reading many files.',
    inputSchema: { type: 'object', properties: { pattern: { type: 'string', description: 'Regular expression (JavaScript syntax)' }, path: { type: 'string', description: 'Vault-relative folder or file to search (default: vault root)' }, glob: { type: 'string', description: 'Only files matching this glob, e.g. "*.md"' }, ignore_case: { type: 'boolean' } }, required: ['pattern'], additionalProperties: false },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a UTF-8 text file under nodes/ or memory/ (vault-relative path, e.g. "nodes/tasks/call-dentist.md"). Parent folders are created. Writes anywhere else — including index/, .synapse/, AGENTS.md — are rejected.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string', description: 'Complete file content' } }, required: ['path', 'content'], additionalProperties: false },
  },
  {
    name: 'edit_file',
    description: 'Replace an exact text occurrence in a file under nodes/ or memory/. old_string must appear exactly once (copy it verbatim from read_file, including whitespace) unless replace_all is true. Prefer this over write_file for small changes.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['path', 'old_string', 'new_string'], additionalProperties: false },
  },
];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function toRel(base: string, abs: string): string | null {
  const r = path.relative(base, abs);
  if (r === '') return '';
  if (r.startsWith('..') || path.isAbsolute(r)) return null;
  return r.split(path.sep).join('/');
}

async function deepestExisting(abs: string): Promise<string> {
  let cur = abs;
  for (;;) {
    try { await fs.lstat(cur); return cur; } catch { /* keep climbing */ }
    const parent = path.dirname(cur);
    if (parent === cur) return cur;
    cur = parent;
  }
}

function clipLine(s: string, n = 240): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export class VaultTools {
  private rootReal: string | null = null;

  constructor(private readonly root: string) {}

  definitions(): ToolDefinition[] {
    return VAULT_TOOL_DEFINITIONS;
  }

  private async realRoot(): Promise<string> {
    if (!this.rootReal) this.rootReal = await fs.realpath(this.root);
    return this.rootReal;
  }

  /**
   * Resolves a model-supplied path to an absolute path inside the vault, or throws with an actionable message.
   * Lexical check against the vault root, then a symlink check through the deepest existing ancestor.
   */
  async resolve(p: unknown, mode: 'read' | 'write'): Promise<{ abs: string; rel: string }> {
    if (typeof p !== 'string') throw new Error('path must be a string');
    const rootReal = await this.realRoot();
    const trimmed = p.trim();
    const abs = path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(rootReal, normalizeRel(trimmed) || '.');
    const rel = toRel(rootReal, abs) ?? toRel(path.resolve(this.root), abs);
    if (rel === null) throw new Error(`path escapes the vault: ${p}. Use vault-relative paths such as nodes/tasks/x.md.`);
    const inside = path.join(rootReal, rel);
    const existing = await deepestExisting(inside);
    const real = await fs.realpath(existing);
    if (toRel(rootReal, real) === null) throw new Error(`path resolves outside the vault through a symlink: ${p}`);
    const top = rel.split('/')[0] ?? '';
    if (mode === 'read' && READ_DENY.has(top)) throw new Error(`${top}/ is app-private and cannot be read`);
    if (mode === 'write') {
      if (!WRITE_ALLOW.has(top) || rel.split('/').length < 2) {
        throw new Error(`writes are allowed only under nodes/ and memory/ (got "${rel}"). index/ and .synapse/ are generated by the app; the agent layer ships with it.`);
      }
    }
    return { abs: inside, rel };
  }

  async call(name: string, input: unknown): Promise<ToolOutcome> {
    const i = isObj(input) ? input : {};
    try {
      switch (name) {
        case 'read_file': return await this.readFile(i);
        case 'list_files': return await this.listFiles(i);
        case 'grep': return await this.grep(i);
        case 'write_file': return await this.writeFile(i);
        case 'edit_file': return await this.editFile(i);
        default: return { ok: false, content: `unknown tool "${name}"; available: ${VAULT_TOOL_DEFINITIONS.map((t) => t.name).join(', ')}` };
      }
    } catch (err) {
      return { ok: false, content: err instanceof Error ? err.message : String(err) };
    }
  }

  private async readFile(i: Record<string, unknown>): Promise<ToolOutcome> {
    const { abs, rel } = await this.resolve(i['path'], 'read');
    const st = await fs.stat(abs).catch(() => null);
    if (!st) return { ok: false, content: `file not found: ${rel}. Use list_files or grep to locate it.`, path: rel };
    if (st.isDirectory()) return { ok: false, content: `${rel || '.'} is a folder; use list_files("${rel ? `${rel}/` : ''}**/*.md") to see its files`, path: rel };
    let text = await fs.readFile(abs, 'utf8');
    let note = '';
    const offset = typeof i['offset'] === 'number' && i['offset'] > 1 ? Math.floor(i['offset']) : 1;
    const limit = typeof i['limit'] === 'number' && i['limit'] > 0 ? Math.floor(i['limit']) : undefined;
    if (offset > 1 || limit !== undefined) {
      const lines = text.split('\n');
      const slice = lines.slice(offset - 1, limit === undefined ? undefined : offset - 1 + limit);
      note = `[${rel}: lines ${offset}–${offset - 1 + slice.length} of ${lines.length}]\n`;
      text = slice.join('\n');
    }
    if (text.length > MAX_READ_BYTES) {
      text = text.slice(0, MAX_READ_BYTES);
      note += `[${rel}: truncated to ${MAX_READ_BYTES} characters; use offset/limit to read further]\n`;
    }
    return { ok: true, content: note + text, path: rel };
  }

  private async walk(dirAbs: string, dirRel: string, out: string[], max: number): Promise<void> {
    if (out.length >= max) return;
    let entries: import('node:fs').Dirent[];
    try { entries = await fs.readdir(dirAbs, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= max) return;
      const rel = dirRel ? `${dirRel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!dirRel && WALK_SKIP.has(e.name)) continue;
        if (WALK_SKIP.has(e.name)) continue;
        await this.walk(path.join(dirAbs, e.name), rel, out, max);
      } else if (e.isFile()) {
        out.push(rel);
      }
    }
  }

  private async listFiles(i: Record<string, unknown>): Promise<ToolOutcome> {
    const pattern = typeof i['pattern'] === 'string' ? normalizeRel(i['pattern'].trim()) : '';
    if (!pattern) return { ok: false, content: 'pattern is required, e.g. "nodes/**/*.md"' };
    const rootReal = await this.realRoot();
    const all: string[] = [];
    await this.walk(rootReal, '', all, 50_000);
    let hits = all.filter((p) => matchesGlob(p, pattern));
    if (!hits.length && !pattern.includes('/')) hits = all.filter((p) => matchesGlob(p, `**/${pattern}`));
    const shown = hits.slice(0, MAX_LIST);
    const more = hits.length - shown.length;
    const content = shown.length ? shown.join('\n') + (more > 0 ? `\n… ${more} more (narrow the pattern)` : '') : `no files match ${pattern}`;
    const outcome: ToolOutcome = { ok: true, content };
    const dir = pattern.split('/').filter((s) => !/[*?{]/.test(s));
    if (dir.length && pattern.includes('/')) outcome.path = `${dir.join('/')}/`;
    return outcome;
  }

  private async grep(i: Record<string, unknown>): Promise<ToolOutcome> {
    const pattern = typeof i['pattern'] === 'string' ? i['pattern'] : '';
    if (!pattern) return { ok: false, content: 'pattern is required' };
    let re: RegExp;
    try { re = new RegExp(pattern, i['ignore_case'] === false ? '' : 'i'); } catch (err) { return { ok: false, content: `invalid regular expression: ${(err as Error).message}` }; }
    const scope = typeof i['path'] === 'string' && i['path'].trim() ? i['path'] : '';
    const { abs, rel } = await this.resolve(scope || '.', 'read');
    const glob = typeof i['glob'] === 'string' && i['glob'].trim() ? normalizeRel(i['glob'].trim()) : null;
    const st = await fs.stat(abs).catch(() => null);
    if (!st) return { ok: false, content: `path not found: ${rel}` };
    const files: string[] = [];
    if (st.isFile()) files.push(rel);
    else await this.walk(abs, rel, files, 50_000);
    const rootReal = await this.realRoot();
    const out: string[] = [];
    let scanned = 0;
    for (const f of files) {
      if (out.length >= MAX_GREP) break;
      if (READ_DENY.has(f.split('/')[0] ?? '')) continue;
      if (glob && !matchesGlob(f, glob) && !matchesGlob(f, `**/${glob}`)) continue;
      const fst = await fs.stat(path.join(rootReal, f)).catch(() => null);
      if (!fst || fst.size > MAX_GREP_FILE_BYTES) continue;
      const buf = await fs.readFile(path.join(rootReal, f));
      if (buf.subarray(0, 1024).includes(0)) continue; // binary
      scanned++;
      const lines = buf.toString('utf8').split('\n');
      for (let n = 0; n < lines.length && out.length < MAX_GREP; n++) {
        const line = lines[n] ?? '';
        if (re.test(line)) out.push(`${f}:${n + 1}: ${clipLine(line.trimEnd())}`);
      }
    }
    const content = out.length ? out.join('\n') + (out.length >= MAX_GREP ? `\n… stopped at ${MAX_GREP} matches (narrow the pattern or path)` : '') : `no matches for /${pattern}/ in ${rel || 'the vault'} (${scanned} files searched)`;
    const outcome: ToolOutcome = { ok: true, content };
    if (rel) outcome.path = st.isFile() ? rel : `${rel}/`;
    return outcome;
  }

  private async writeFile(i: Record<string, unknown>): Promise<ToolOutcome> {
    const { abs, rel } = await this.resolve(i['path'], 'write');
    const content = i['content'];
    if (typeof content !== 'string') return { ok: false, content: 'content must be a string', path: rel };
    const existed = await fs.stat(abs).then((s) => s.isFile()).catch(() => false);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
    return { ok: true, content: `wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${rel} (${existed ? 'overwritten' : 'created'})`, path: rel, wrote: true };
  }

  private async editFile(i: Record<string, unknown>): Promise<ToolOutcome> {
    const { abs, rel } = await this.resolve(i['path'], 'write');
    const oldStr = i['old_string'];
    const newStr = i['new_string'];
    if (typeof oldStr !== 'string' || !oldStr) return { ok: false, content: 'old_string must be a non-empty string', path: rel };
    if (typeof newStr !== 'string') return { ok: false, content: 'new_string must be a string', path: rel };
    const text = await fs.readFile(abs, 'utf8').catch(() => null);
    if (text === null) return { ok: false, content: `file not found: ${rel}; use write_file to create it`, path: rel };
    const count = text.split(oldStr).length - 1;
    if (count === 0) return { ok: false, content: `old_string not found in ${rel}; read the file and copy the exact text (whitespace included)`, path: rel };
    if (count > 1 && i['replace_all'] !== true) return { ok: false, content: `old_string occurs ${count} times in ${rel}; include more surrounding context or set replace_all: true`, path: rel };
    const next = i['replace_all'] === true ? text.split(oldStr).join(newStr) : text.replace(oldStr, () => newStr);
    await fs.writeFile(abs, next, 'utf8');
    return { ok: true, content: `edited ${rel} (${count} replacement${count === 1 ? '' : 's'})`, path: rel, wrote: true };
  }
}
