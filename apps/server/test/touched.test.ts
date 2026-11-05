import { describe, expect, it } from 'vitest';
import { commandPaths, touchedBy } from '../src/brain-runner';

describe('touchedBy', () => {
  const root = '/v';
  it('maps a vault file read to its relative path', () => {
    expect(touchedBy('Read', { file_path: '/v/nodes/notes/a.md' }, root)).toEqual({ paths: ['nodes/notes/a.md'], kind: 'read' });
    expect(touchedBy('Grep', { pattern: 'x', path: 'index' }, root)).toEqual({ paths: ['index'], kind: 'read' });
  });
  it('calls edits and writes a write', () => {
    expect(touchedBy('Edit', { file_path: 'nodes/tasks/t.md' }, root)?.kind).toBe('write');
    expect(touchedBy('write_file', { path: 'memory/profile.md' }, root)?.kind).toBe('write');
  });
  it('ignores what is outside the vault or not the user\'s data', () => {
    expect(touchedBy('Read', { file_path: '/etc/hosts' }, root)).toBeUndefined();
    expect(touchedBy('Read', { file_path: '/v/.synapse/settings.json' }, root)).toBeUndefined();
    expect(touchedBy('Bash', { command: 'ls' }, root)).toBeUndefined();
    expect(touchedBy('command_execution', { command: "bash -lc 'cat /etc/hosts'" }, root)).toBeUndefined();
  });
  it('lights the core for a search across the whole vault', () => {
    expect(touchedBy('Grep', { pattern: 'دکتر' }, root)).toEqual({ paths: ['index'], kind: 'read' });
    expect(touchedBy('Glob', { pattern: '**/*.md', path: '/v' }, root)).toEqual({ paths: ['index'], kind: 'read' });
    expect(touchedBy('Glob', { pattern: 'nodes/**/*.md', path: 'nodes/tasks/**' }, root)).toEqual({ paths: ['nodes/tasks'], kind: 'read' });
  });
  it("reads Codex's shell commands and its file changes", () => {
    expect(touchedBy('command_execution', { command: "/bin/zsh -lc \"sed -n '1,120p' index/INDEX.md\"" }, root)).toEqual({ paths: ['index/INDEX.md'], kind: 'read' });
    expect(touchedBy('command_execution', { command: "bash -lc 'rg -n \"علی\" nodes/people /v/nodes/projects/site.md'" }, root))
      .toEqual({ paths: ['nodes/people', 'nodes/projects/site.md'], kind: 'read' });
    expect(touchedBy('command_execution', { command: "bash -lc \"cat > 'nodes/notes/یادداشت تازه.md' <<'EOF'\nhi\nEOF\"" }, root))
      .toEqual({ paths: ['nodes/notes/یادداشت تازه.md'], kind: 'write' });
    expect(touchedBy('file_change', { changes: [{ path: '/v/nodes/tasks/call.md', kind: 'add' }, { path: '/v/.synapse/x.json', kind: 'update' }] }, root))
      .toEqual({ paths: ['nodes/tasks/call.md'], kind: 'write' });
  });
  it('finds quoted paths whole and keeps a command to a few paths', () => {
    expect(commandPaths("cat 'nodes/notes/a b.md' memory/profile.md --file=index/by-type/task.md", '/v')).toEqual(['nodes/notes/a b.md', 'memory/profile.md', 'index/by-type/task.md']);
    const many = Array.from({ length: 30 }, (_, k) => `nodes/notes/n${k}.md`).join(' ');
    expect(commandPaths(`cat ${many}`, '/v')).toHaveLength(12);
  });
});
