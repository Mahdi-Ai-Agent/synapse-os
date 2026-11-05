import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadVault } from '../src/vault';

const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }); });

async function tmpVault(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-core-'));
  dirs.push(root);
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text, 'utf8');
  }
  return root;
}

describe('loadVault healing', () => {
  it('fills missing id/created/updated and writes the file back', async () => {
    const root = await tmpVault({ 'nodes/notes/a.md': '---\ntype: note\ntitle: A\nsummary: a\n---\nbody\n' });
    const r = await loadVault(root, { newId: () => 'ID1', now: () => '2026-10-31T10:00:00+03:30' });
    expect(r.healed).toEqual(['nodes/notes/a.md']);
    const text = await fs.readFile(path.join(root, 'nodes/notes/a.md'), 'utf8');
    expect(text).toContain('id: ID1');
    expect(text).toContain('created: 2026-10-31T10:00:00+03:30');
  });

  it('leaves a file with broken YAML untouched', async () => {
    const original = '---\n- just: [a list\n{ nope\n---\nbody\n';
    const root = await tmpVault({ 'nodes/journal/2026-10-31.md': original });
    const r = await loadVault(root, { newId: () => 'ID2', now: () => '2026-10-31T10:00:00+03:30' });
    expect(r.healed).toEqual([]);
    expect(r.problems.some((p) => p.code === 'yaml')).toBe(true);
    expect(await fs.readFile(path.join(root, 'nodes/journal/2026-10-31.md'), 'utf8')).toBe(original);
  });
});

describe('loadVault recovery', () => {
  it('normalizes a recoverable frontmatter instead of degrading it', async () => {
    const root = await tmpVault({ 'nodes/journal/2026-10-31.md': '---\nid: 01ABC\ntype: journal\ntitle: 2026-10-31\nsummary: مرور روزانه: ۲ عقب‌افتاده\nstatus: active\ndate: 2026-10-31\ncreated: 2026-10-31T09:01:00+03:30\nupdated: 2026-10-31T09:01:00+03:30\n---\n## 08:15\nran\n' });
    const r = await loadVault(root, { newId: () => 'NEW', now: () => '2026-10-31T10:00:00+03:30' });
    expect(r.healed).toEqual(['nodes/journal/2026-10-31.md']);
    const text = await fs.readFile(path.join(root, 'nodes/journal/2026-10-31.md'), 'utf8');
    expect(text).toContain('id: 01ABC');
    expect(text).toContain('title: 2026-10-31');
    expect(text).toMatch(/summary: "مرور روزانه: ۲ عقب‌افتاده"/);
    expect(text).toContain('## 08:15\nran\n');
    const again = await loadVault(root);
    expect(again.problems.filter((p) => p.code.startsWith('yaml'))).toEqual([]);
  });
});
