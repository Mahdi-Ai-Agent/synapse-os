import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayLocal } from '@synapse/core';
import { createVault } from '@synapse/vault-template';
import { VaultService } from '../src/vault-service';

let root = '';
let vault: VaultService;
// The service stamps `completed` with the local date, so the expectation must be local too (UTC differs after midnight).
const today = todayLocal();

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-kinds-'));
  await createVault(root);
  vault = new VaultService(root);
  await vault.start();
});

afterAll(async () => {
  await vault.stop();
  await fs.rm(root, { recursive: true, force: true });
});

describe('status and kind changes in the vault service', () => {
  it('stamps completed when an item is finished and clears it when it reopens', async () => {
    const id = (await vault.createNode({ type: 'task', title: 'Order labels' })).fm.id;
    expect(vault.getNode(id)!.fm.completed).toBeUndefined();
    await vault.updateNode(id, { frontmatter: { status: 'done' } });
    expect(vault.getNode(id)!.fm.completed).toBe(today);
    expect(await fs.readFile(path.join(root, vault.getNode(id)!.path), 'utf8')).toContain(`completed: ${today}`);
    await vault.updateNode(id, { frontmatter: { status: 'todo' } });
    expect(vault.getNode(id)!.fm.completed).toBeUndefined();
  });

  it('keeps a completed date an item already carries', async () => {
    const id = (await vault.createNode({ type: 'goal', title: 'Run 10k', status: 'achieved' })).fm.id;
    expect(vault.getNode(id)!.fm.completed).toBe(today);
    await vault.updateNode(id, { frontmatter: { summary: 'ran it' } });
    expect(vault.getNode(id)!.fm.completed).toBe(today);
  });

  it('turns an item into another kind by moving its file, keeping id, title and links', async () => {
    const noteId = (await vault.createNode({ type: 'note', title: 'Call the bank', body: 'About [[Order labels]].\n' })).fm.id;
    const before = vault.getNode(noteId)!;
    expect(before.path).toBe('nodes/notes/call-the-bank.md');
    const after = await vault.retypeNode(noteId, 'task');
    expect(after.fm.id).toBe(noteId);
    expect(after.fm.type).toBe('task');
    expect(after.fm.status).toBe('todo');
    expect(after.path).toBe('nodes/tasks/call-the-bank.md');
    expect(after.body).toContain('[[Order labels]]');
    await expect(fs.access(path.join(root, before.path))).rejects.toThrow();
    expect(vault.getDetail(noteId)!.outgoing.some((o) => o.resolved)).toBe(true);
  });

  it('refuses kinds that have their own naming or meaning', async () => {
    const id = (await vault.createNode({ type: 'idea', title: 'Maybe a shop' })).fm.id;
    await expect(vault.retypeNode(id, 'journal')).rejects.toThrow(/cannot turn/);
    await expect(vault.retypeNode(id, 'area')).rejects.toThrow(/cannot turn/);
  });
});
