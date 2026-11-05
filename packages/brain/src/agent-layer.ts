import { promises as fs } from 'node:fs';
import path from 'node:path';
import { matchesGlob } from './glob';

/**
 * The vault's agent layer as Claude Code would load it: `AGENTS.md`, the always-loaded memory files,
 * path-scoped rules and skills. Engines without a native notion of these (API engines, Codex) use it
 * to build their system prompt and to expand `/skill` prompts. Spec: docs/BRAIN-ENGINES.md.
 */
export interface AgentRule {
  /** Vault-relative file, e.g. `.claude/rules/tasks.md`. */
  file: string;
  description: string;
  /** Globs the rule applies to, e.g. `nodes/tasks/**`. */
  paths: string[];
  body: string;
}

export interface AgentSkill {
  name: string;
  description: string;
  /** Skill body with relative links rewritten to vault-relative paths. */
  body: string;
  /** Vault-relative skill folder. */
  dir: string;
}

export interface AgentLayer {
  root: string;
  instructions: string;
  profile: string;
  lessons: string;
  rules: AgentRule[];
  skills: Map<string, AgentSkill>;
}

export interface SystemPrompt {
  /** Identical across runs on the same vault (cacheable prefix). */
  stable: string;
  /** Changes per run (runtime context). */
  volatile: string;
}

async function readText(p: string): Promise<string> {
  try { return await fs.readFile(p, 'utf8'); } catch { return ''; }
}

async function listDir(p: string): Promise<string[]> {
  try { return await fs.readdir(p); } catch { return []; }
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

/** Minimal frontmatter reader for rule and skill files: scalar `key: value` lines, `key:` + `- item` block lists, `[a, b]` inline lists. */
export function splitFrontmatter(text: string): { data: Record<string, string | string[]>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const raw of (m[1] ?? '').split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(raw);
    if (item && listKey) {
      const list = data[listKey];
      if (Array.isArray(list)) list.push(unquote(item[1] ?? ''));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(raw);
    if (!kv) continue;
    const key = kv[1] ?? '';
    const value = (kv[2] ?? '').trim();
    if (value === '') { data[key] = []; listKey = key; }
    else if (value.startsWith('[')) { data[key] = value.slice(1, value.lastIndexOf(']') > 0 ? value.lastIndexOf(']') : undefined).split(',').map((s) => unquote(s)).filter(Boolean); listKey = null; }
    else { data[key] = unquote(value); listKey = null; }
  }
  return { data, body: text.slice(m[0].length) };
}

const str = (v: string | string[] | undefined): string => (typeof v === 'string' ? v : Array.isArray(v) ? v.join(' ') : '');

/** `[text](references/x.md)` inside a skill → `[text](.claude/skills/<name>/references/x.md)` so a file tool can open it. */
export function rewriteRelativeLinks(body: string, dir: string): string {
  return body.replace(/\]\((?!https?:|mailto:|\/|#|\.claude\/)([^)\s]+)\)/g, (_m, p: string) => `](${dir}/${p.replace(/^\.\//, '')})`);
}

export async function loadAgentLayer(root: string): Promise<AgentLayer> {
  const rulesDir = path.join(root, '.claude', 'rules');
  const skillsDir = path.join(root, '.claude', 'skills');
  const rules: AgentRule[] = [];
  for (const f of (await listDir(rulesDir)).filter((n) => n.endsWith('.md')).sort()) {
    const { data, body } = splitFrontmatter(await readText(path.join(rulesDir, f)));
    const raw = data['paths'];
    const paths = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : [];
    rules.push({ file: `.claude/rules/${f}`, description: str(data['description']), paths, body: body.trim() });
  }
  const skills = new Map<string, AgentSkill>();
  for (const name of (await listDir(skillsDir)).sort()) {
    const text = await readText(path.join(skillsDir, name, 'SKILL.md'));
    if (!text) continue;
    const { data, body } = splitFrontmatter(text);
    const dir = `.claude/skills/${name}`;
    skills.set(name, { name: str(data['name']) || name, description: str(data['description']), body: rewriteRelativeLinks(body.trim(), dir), dir });
  }
  return {
    root,
    instructions: (await readText(path.join(root, 'AGENTS.md'))).trim(),
    profile: (await readText(path.join(root, 'memory', 'profile.md'))).trim(),
    lessons: (await readText(path.join(root, 'memory', 'lessons.md'))).trim(),
    rules,
    skills,
  };
}

/** `/capture some text` → the capture skill's instructions followed by the user's text; other prompts pass through. */
export function expandSkillPrompt(prompt: string, layer: AgentLayer): { prompt: string; skill: string | null } {
  const m = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i.exec(prompt.trim());
  const skill = m ? layer.skills.get((m[1] ?? '').toLowerCase()) : undefined;
  if (!m || !skill) return { prompt, skill: null };
  const rest = (m[2] ?? '').trim();
  const expanded = [
    `Run the "${skill.name}" skill now. Its instructions, from ${skill.dir}/SKILL.md:`,
    '',
    skill.body,
    '',
    '---',
    '',
    rest ? `User input:\n${rest}` : 'User input: (none — run the skill on the current vault state)',
  ].join('\n');
  return { prompt: expanded, skill: skill.name };
}

export function rulesForPath(layer: AgentLayer, relPath: string): AgentRule[] {
  return layer.rules.filter((r) => r.paths.some((g) => matchesGlob(relPath, g)));
}

/** One line per rule: where it lives, what it says, which folders it governs. */
export function rulesIndex(layer: AgentLayer): string {
  return layer.rules.map((r) => `- \`${r.file}\` — ${r.description || 'folder rules'} (applies to ${r.paths.join(', ') || 'all files'})`).join('\n');
}

/**
 * System prompt for engines that do not read `AGENTS.md` themselves: instructions + always-loaded memory +
 * rules index + tool notes (stable), then the runtime context (volatile).
 */
export function buildSystemPrompt(layer: AgentLayer, opts: { runtimeContext?: string; toolNotes?: string } = {}): SystemPrompt {
  const parts = [layer.instructions || '# Vault\nYou are the brain of this Markdown vault.'];
  if (layer.profile) parts.push(`# Owner profile (memory/profile.md)\n\n${layer.profile}`);
  if (layer.lessons) parts.push(`# Lessons (memory/lessons.md)\n\n${layer.lessons}`);
  if (layer.rules.length) {
    parts.push(
      '# Folder rules\n\nRules under `.claude/rules/` govern the folders listed after each one. The full text of a rule is appended to the first tool result that touches a matching path; you may also read the rule file directly before writing there.\n\n' +
        rulesIndex(layer),
    );
  }
  if (opts.toolNotes) parts.push(opts.toolNotes);
  const volatile = opts.runtimeContext?.trim() ? `# Runtime context\n\n${opts.runtimeContext.trim()}` : '';
  return { stable: parts.join('\n\n'), volatile };
}
