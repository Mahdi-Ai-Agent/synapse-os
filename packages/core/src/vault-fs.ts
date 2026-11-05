import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseNodeFile, serializeNode } from './node';
import type { GraphData, IndexFiles, ParseProblem, VaultNode } from './types';

export const NODES_DIR = 'nodes';
export const INDEX_DIR = 'index';
export const MEMORY_DIR = 'memory';
export const APP_DIR = '.synapse';

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Lists every `nodes/**\/*.md` file relative to the root (POSIX). */
export async function listNodeFiles(root: string): Promise<string[]> {
  const base = path.join(root, NODES_DIR);
  const out: string[] = [];
  let dirs: string[];
  try {
    dirs = (await fs.readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return out;
  }
  for (const dir of dirs) {
    const entries = await fs.readdir(path.join(base, dir), { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(`${NODES_DIR}/${dir}/${e.name}`);
    }
  }
  return out.sort();
}

export async function readNodeFile(root: string, relPath: string): Promise<{ node: VaultNode; problems: ParseProblem[] }> {
  const abs = path.join(root, relPath);
  const [text, stat] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)]);
  return parseNodeFile(relPath, text, { mtimeMs: stat.mtimeMs });
}

export async function readVaultNodes(root: string): Promise<{ nodes: VaultNode[]; problems: ParseProblem[] }> {
  const files = await listNodeFiles(root);
  const nodes: VaultNode[] = [];
  const problems: ParseProblem[] = [];
  for (const f of files) {
    let r: Awaited<ReturnType<typeof readNodeFile>>;
    try { r = await readNodeFile(root, f); } catch (err) {
      // Gone between the listing and the read (moved or deleted meanwhile): it is not in the vault any more.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    nodes.push(r.node);
    problems.push(...r.problems);
  }
  return { nodes, problems };
}

export async function writeNodeFile(root: string, node: VaultNode): Promise<void> {
  const abs = path.join(root, node.path);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, serializeNode(node), 'utf8');
}

export async function deleteNodeFile(root: string, relPath: string): Promise<void> {
  await fs.rm(path.join(root, relPath), { force: true });
}

async function writeAtomic(file: string, content: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
}

/** Writes `index/INDEX.md`, `index/by-type/*.md` and `index/graph.json` atomically (temp file + rename). */
export async function writeDerived(root: string, files: IndexFiles, graph: GraphData): Promise<void> {
  const dir = path.join(root, INDEX_DIR);
  const areaDir = path.join(dir, 'by-area');
  await fs.mkdir(path.join(dir, 'by-type'), { recursive: true });
  await fs.mkdir(areaDir, { recursive: true });
  const writes: Promise<void>[] = [writeAtomic(path.join(dir, 'INDEX.md'), files.router), writeAtomic(path.join(dir, 'archive.md'), files.archive)];
  for (const [type, content] of Object.entries(files.byType)) {
    if (content) writes.push(writeAtomic(path.join(dir, 'by-type', `${type}.md`), content));
  }
  // A renamed or deleted category leaves no stale sub-index behind.
  const keep = new Set(Object.keys(files.byArea));
  for (const f of await fs.readdir(areaDir).catch(() => [] as string[])) if (f.endsWith('.md') && !keep.has(f)) await fs.rm(path.join(areaDir, f), { force: true });
  for (const [name, content] of Object.entries(files.byArea)) writes.push(writeAtomic(path.join(areaDir, name), content));
  writes.push(writeAtomic(path.join(dir, 'graph.json'), JSON.stringify(graph)));
  await Promise.all(writes);
}

export async function pathExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

/** Raw file text of a node, for textual rewrites that must not re-serialize the frontmatter (e.g. renames). */
export async function readNodeText(root: string, relPath: string): Promise<string> {
  return fs.readFile(path.join(root, relPath), 'utf8');
}

export async function writeNodeText(root: string, relPath: string, text: string): Promise<void> {
  await fs.writeFile(path.join(root, relPath), text, 'utf8');
}
