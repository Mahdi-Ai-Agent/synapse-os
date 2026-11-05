import { promises as fs } from 'node:fs';
import path from 'node:path';
import { splitFrontmatter } from '@synapse/core';

export interface ContextEstimate {
  estimatedStartupTokens: number;
  budget: number;
  withinBudget: boolean;
  breakdown: Record<string, number>;
  note: string;
}

const toks = (chars: number): number => Math.round(chars / 4);
const IMPORT_RE = /(?:^|\s)@([^\s`"']+\.[A-Za-z0-9]+)/g;

async function readText(p: string): Promise<string | null> {
  try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}

async function importTokens(file: string, seen = new Set<string>(), depth = 0): Promise<number> {
  if (depth > 4) return 0;
  const real = path.resolve(file);
  if (seen.has(real)) return 0;
  seen.add(real);
  const text = await readText(file);
  if (text === null) return 0;
  const stripped = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  let total = 0;
  for (const m of stripped.matchAll(IMPORT_RE)) {
    const rel = m[1] ?? '';
    const target = path.isAbsolute(rel) ? rel : path.join(path.dirname(file), rel);
    const t = await readText(target);
    if (t === null) continue;
    total += toks(t.length) + (await importTokens(target, seen, depth + 1));
  }
  return total;
}

async function walkMd(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkMd(p)));
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

/**
 * Approximates what a Claude Code session loads at startup for a vault or agent folder:
 * CLAUDE.md (or AGENTS.md when no CLAUDE.md) plus @-imports, skill metadata, and rules without `paths:`.
 */
export async function estimateStartupContext(root: string, budget = 2500): Promise<ContextEstimate> {
  const breakdown: Record<string, number> = {};
  let total = 0;

  const claudeMd = path.join(root, 'CLAUDE.md');
  const agentsMd = path.join(root, 'AGENTS.md');
  const main = (await readText(claudeMd)) !== null ? claudeMd : agentsMd;
  const mainText = await readText(main);
  if (mainText !== null) {
    const t = toks(mainText.length);
    breakdown[path.basename(main)] = t;
    total += t;
    const imp = await importTokens(main);
    if (imp) { breakdown[`${path.basename(main)} @-imports`] = imp; total += imp; }
  }

  let skillTokens = 0; let skillCount = 0;
  for (const f of await walkMd(path.join(root, '.claude', 'skills'))) {
    if (path.basename(f) !== 'SKILL.md') continue;
    const text = await readText(f);
    if (text === null) continue;
    const { data } = splitFrontmatter(text);
    const meta = ['name', 'description', 'when_to_use'].map((k) => (typeof data[k] === 'string' ? (data[k] as string).length : 0)).reduce((a, b) => a + b, 0);
    skillTokens += toks(meta);
    skillCount++;
  }
  if (skillCount) { breakdown[`skill metadata (x${skillCount})`] = skillTokens; total += skillTokens; }

  let ruleTokens = 0; let alwaysRules = 0;
  for (const f of await walkMd(path.join(root, '.claude', 'rules'))) {
    const text = await readText(f);
    if (text === null) continue;
    const { data } = splitFrontmatter(text);
    const paths = data['paths'];
    if (!paths || (Array.isArray(paths) && paths.length === 0)) { ruleTokens += toks(text.length); alwaysRules++; }
  }
  if (alwaysRules) { breakdown[`always-loaded rules (x${alwaysRules})`] = ruleTokens; total += ruleTokens; }

  return {
    estimatedStartupTokens: total,
    budget,
    withinBudget: total <= budget,
    breakdown,
    note: 'Approximate (chars/4). Path-scoped rules, skill bodies, references and index files are NOT counted.',
  };
}
