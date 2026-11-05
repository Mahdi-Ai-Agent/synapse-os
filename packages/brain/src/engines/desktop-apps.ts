import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The CLIs the vendors' desktop apps carry on a Mac (docs/BRAIN-ENGINES.md "On a desktop"): the ChatGPT app ships
 * Codex inside its bundle, and the Claude app keeps Claude Code under Application Support. Both share their login with
 * the app (Codex in `~/.codex`, Claude Code in the user's Claude Code login), so an engine found here is signed in
 * whenever the app is.
 */

/** Where an engine's CLI was found, for the Settings card. */
export type CliSource = 'path' | 'chatgpt-app' | 'claude-app';

/** Codex inside the ChatGPT app, for every user and for this one. */
export function chatgptAppCodexPaths(): string[] {
  const inside = path.join('ChatGPT.app', 'Contents', 'Resources', 'codex-cli', 'CodexCLI.app', 'Contents', 'MacOS', 'codex');
  return [path.join('/Applications', inside), path.join(os.homedir(), 'Applications', inside)];
}

const CLAUDE_APP_CLI = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code');

/** Compares dotted version strings numerically (`2.1.309` > `2.1.295`). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Claude Code as the Claude app keeps it (`<version>/<build>/claude.app/Contents/MacOS/claude`), the newest first. */
export async function claudeAppCliPaths(root = CLAUDE_APP_CLI): Promise<string[]> {
  let versions: string[];
  try { versions = (await fs.readdir(root)).filter((v) => /^\d+(\.\d+)*$/.test(v)); } catch { return []; }
  const out: string[] = [];
  for (const v of versions.sort(compareVersions).reverse()) {
    let builds: string[];
    try { builds = await fs.readdir(path.join(root, v)); } catch { continue; }
    for (const b of builds) out.push(path.join(root, v, b, 'claude.app', 'Contents', 'MacOS', 'claude'));
  }
  return out;
}

/** Which app (if any) a found binary belongs to. */
export function sourceOf(bin: string): CliSource {
  if (bin.includes(`${path.sep}ChatGPT.app${path.sep}`)) return 'chatgpt-app';
  if (bin.startsWith(CLAUDE_APP_CLI)) return 'claude-app';
  return 'path';
}
