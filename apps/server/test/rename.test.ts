import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVault } from '@synapse/vault-template';
import { VaultGit } from '../src/vault-git';
import { VaultService } from '../src/vault-service';

let root = '';
let vault: VaultService;
let git: VaultGit;
let projectId = '';
let taskId = '';
let noteId = '';

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-rename-'));
  await createVault(root);
  vault = new VaultService(root);
  await vault.start();
  git = new VaultGit(root);
  await git.ensureRepo();
  projectId = (await vault.createNode({ type: 'area', title: 'Work' })).fm.id;
  projectId = (await vault.createNode({ type: 'project', title: 'Old Project', area: '[[Work]]', body: '**Outcome:** ship.\n' })).fm.id;
  taskId = (await vault.createNode({
    type: 'task', title: 'Do the thing', project: '[[Old Project]]', links: ['[[old project]]'],
    body: 'See [[Old Project|the project]] and [[Old Project#Outcome]]. Code `[[Old Project]]` stays.\n',
  })).fm.id;
  noteId = (await vault.createNode({ type: 'note', title: 'Unrelated', body: 'Links [[Work]] only.\n' })).fm.id;
  await git.snapshot('seed: test nodes');
});

afterAll(async () => {
  await vault.stop();
  await fs.rm(root, { recursive: true, force: true });
});

describe('VaultService.renameNode', () => {
  it('rewrites links in body and frontmatter of files that resolve to the node, keeps aliases, commits', async () => {
    const before = await fs.readFile(path.join(root, vault.getNode(noteId)?.path ?? ''), 'utf8');
    await git.snapshot('manual: edits');
    const r = await vault.renameNode(projectId, 'New Project');
    const set = await git.commitChanges('manual: rename Old Project → New Project');

    const taskPath = vault.getNode(taskId)?.path ?? '';
    const task = await fs.readFile(path.join(root, taskPath), 'utf8');
    expect(r.rewritten).toEqual([taskPath]);
    expect(task).toContain('project: "[[New Project]]"');
    expect(task).toContain('- "[[New Project]]"');
    expect(task).toContain('[[New Project|the project]] and [[New Project#Outcome]]');
    expect(task).toContain('Code `[[Old Project]]` stays');

    const project = vault.getNode(projectId);
    expect(project?.fm.title).toBe('New Project');
    expect(project?.fm.aliases).toEqual(['Old Project']);
    expect(project?.path).toMatch(/old-project\.md$/); // the file name is kept

    expect(await fs.readFile(path.join(root, vault.getNode(noteId)?.path ?? ''), 'utf8')).toBe(before);

    const detail = vault.getDetail(taskId);
    expect(detail?.outgoing.filter((o) => o.target === projectId).every((o) => o.resolved)).toBe(true);
    expect(vault.graph?.stats.unresolved).toBe(0);

    expect(set.updated).toContain(taskPath);
    expect((await git.log(1))[0]?.subject).toBe('manual: rename Old Project → New Project');
  });

  it('refuses a title another node already has', async () => {
    await expect(vault.renameNode(taskId, 'unrelated')).rejects.toMatchObject({ status: 409 });
  });
});
