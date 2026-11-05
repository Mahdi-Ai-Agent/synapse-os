import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VaultTools, VAULT_TOOL_DEFINITIONS } from '../src/tools/vault-tools';

let root = '';
let outside = '';
let tools: VaultTools;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-tools-'));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-outside-'));
  await fs.mkdir(path.join(root, 'nodes', 'tasks'), { recursive: true });
  await fs.mkdir(path.join(root, 'nodes', 'people'), { recursive: true });
  await fs.mkdir(path.join(root, 'memory'), { recursive: true });
  await fs.mkdir(path.join(root, 'index'), { recursive: true });
  await fs.mkdir(path.join(root, '.synapse'), { recursive: true });
  await fs.writeFile(path.join(root, 'AGENTS.md'), '# Vault\n');
  await fs.writeFile(path.join(root, 'index', 'INDEX.md'), '# Vault index\n\n- 2 nodes\n');
  await fs.writeFile(path.join(root, 'nodes', 'tasks', 'call-sara.md'), '---\ntype: task\ntitle: تماس با سارا\n---\nCall [[سارا احمدی]] about the launch.\n');
  await fs.writeFile(path.join(root, 'nodes', 'people', 'sara.md'), '---\ntype: person\ntitle: سارا احمدی\n---\nDesigner.\n');
  await fs.writeFile(path.join(root, '.synapse', 'settings.json'), '{"apiKeys":{"anthropic":"sk-secret"}}');
  await fs.writeFile(path.join(outside, 'secret.md'), 'outside');
  await fs.symlink(outside, path.join(root, 'nodes', 'escape'));
  tools = new VaultTools(root);
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

describe('VaultTools', () => {
  it('exposes five tool definitions with closed schemas', () => {
    expect(VAULT_TOOL_DEFINITIONS.map((t) => t.name)).toEqual(['read_file', 'list_files', 'grep', 'write_file', 'edit_file']);
    for (const t of VAULT_TOOL_DEFINITIONS) expect(t.inputSchema.additionalProperties).toBe(false);
  });

  it('reads inside the vault, including index/, with offset and limit', async () => {
    const r = await tools.call('read_file', { path: 'index/INDEX.md' });
    expect(r.ok).toBe(true);
    expect(r.content).toContain('# Vault index');
    expect(r.path).toBe('index/INDEX.md');
    const part = await tools.call('read_file', { path: 'nodes/tasks/call-sara.md', offset: 2, limit: 2 });
    expect(part.content).toBe('[nodes/tasks/call-sara.md: lines 2–3 of 6]\ntype: task\ntitle: تماس با سارا');
    const abs = await tools.call('read_file', { path: path.join(root, 'AGENTS.md') });
    expect(abs.ok).toBe(true);
  });

  it('refuses app-private folders, escapes and symlinks out of the vault', async () => {
    expect((await tools.call('read_file', { path: '.synapse/settings.json' })).content).toMatch(/app-private/);
    expect((await tools.call('read_file', { path: '../outside.md' })).content).toMatch(/escapes the vault/);
    expect((await tools.call('read_file', { path: '/etc/hosts' })).content).toMatch(/escapes the vault/);
    const viaLink = await tools.call('read_file', { path: 'nodes/escape/secret.md' });
    expect(viaLink.ok).toBe(false);
    expect(viaLink.content).toMatch(/symlink/);
    expect((await tools.call('grep', { pattern: 'secret', path: '.synapse' })).ok).toBe(false);
  });

  it('writes only under nodes/ and memory/', async () => {
    const ok = await tools.call('write_file', { path: 'nodes/tasks/new.md', content: '---\ntype: task\n---\n' });
    expect(ok).toMatchObject({ ok: true, path: 'nodes/tasks/new.md', wrote: true });
    expect(ok.content).toMatch(/created/);
    const mem = await tools.call('write_file', { path: 'memory/lessons.md', content: '# Lessons\n' });
    expect(mem.ok).toBe(true);
    for (const p of ['index/INDEX.md', '.synapse/settings.json', 'AGENTS.md', 'nodes', '../x.md', 'nodes/escape/evil.md']) {
      const r = await tools.call('write_file', { path: p, content: 'x' });
      expect(r.ok, p).toBe(false);
    }
    expect(await fs.readFile(path.join(root, 'index', 'INDEX.md'), 'utf8')).toContain('# Vault index');
    expect(await fs.readdir(outside)).toEqual(['secret.md']);
  });

  it('edits one exact occurrence unless replace_all', async () => {
    const miss = await tools.call('edit_file', { path: 'nodes/tasks/call-sara.md', old_string: 'nope', new_string: 'x' });
    expect(miss.ok).toBe(false);
    expect(miss.content).toMatch(/not found/);
    await fs.writeFile(path.join(root, 'nodes', 'tasks', 'dup.md'), 'a a\n');
    const dup = await tools.call('edit_file', { path: 'nodes/tasks/dup.md', old_string: 'a', new_string: 'b' });
    expect(dup.content).toMatch(/occurs 2 times/);
    const all = await tools.call('edit_file', { path: 'nodes/tasks/dup.md', old_string: 'a', new_string: 'b', replace_all: true });
    expect(all).toMatchObject({ ok: true, wrote: true });
    expect(await fs.readFile(path.join(root, 'nodes', 'tasks', 'dup.md'), 'utf8')).toBe('b b\n');
    const one = await tools.call('edit_file', { path: 'nodes/tasks/call-sara.md', old_string: 'about the launch', new_string: 'about the $launch$' });
    expect(one.ok).toBe(true);
    expect(await fs.readFile(path.join(root, 'nodes', 'tasks', 'call-sara.md'), 'utf8')).toContain('about the $launch$.');
    expect((await tools.call('edit_file', { path: 'index/INDEX.md', old_string: 'Vault', new_string: 'x' })).ok).toBe(false);
  });

  it('lists by glob and greps with a regex', async () => {
    const list = await tools.call('list_files', { pattern: 'nodes/**/*.md' });
    expect(list.content.split('\n')).toEqual(expect.arrayContaining(['nodes/people/sara.md', 'nodes/tasks/call-sara.md', 'nodes/tasks/new.md']));
    expect(list.content).not.toContain('secret.md');
    expect(list.path).toBe('nodes/');
    const bare = await tools.call('list_files', { pattern: 'INDEX.md' });
    expect(bare.content).toBe('index/INDEX.md');
    const grep = await tools.call('grep', { pattern: 'سارا', path: 'nodes' });
    expect(grep.ok).toBe(true);
    expect(grep.path).toBe('nodes/');
    expect(grep.content).toContain('nodes/people/sara.md:3: title: سارا احمدی');
    expect(grep.content).toContain('nodes/tasks/call-sara.md:5:');
    const scoped = await tools.call('grep', { pattern: 'designer', glob: '*.md', path: 'nodes/people' });
    expect(scoped.content).toBe('nodes/people/sara.md:5: Designer.');
    expect((await tools.call('grep', { pattern: '(' })).content).toMatch(/invalid regular expression/);
    expect((await tools.call('grep', { pattern: 'zzz' })).content).toMatch(/no matches/);
  });

  it('answers unknown tools and bad input without throwing', async () => {
    expect((await tools.call('bash', { command: 'ls' })).content).toMatch(/unknown tool/);
    expect((await tools.call('read_file', null)).ok).toBe(false);
    expect((await tools.call('read_file', { path: 42 })).content).toMatch(/must be a string/);
  });
});
