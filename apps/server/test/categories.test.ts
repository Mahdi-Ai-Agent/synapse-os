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
const ids: Record<string, string> = {};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-categories-'));
  await createVault(root);
  vault = new VaultService(root);
  await vault.start();
  git = new VaultGit(root);
  await git.ensureRepo();
  ids['work'] = (await vault.createNode({ type: 'area', title: 'Work', color: '#22d3ee' })).fm.id;
  ids['side'] = (await vault.createNode({ type: 'area', title: 'Side business' })).fm.id;
  ids['project'] = (await vault.createNode({ type: 'project', title: 'Shop', area: '[[Side business]]' })).fm.id;
  ids['task'] = (await vault.createNode({ type: 'task', title: 'Order labels', project: '[[Shop]]', area: '[[side business]]' })).fm.id;
  ids['note'] = (await vault.createNode({ type: 'note', title: 'Pricing idea', body: 'For [[Shop]].\n' })).fm.id;
  await git.snapshot('seed: test nodes');
});

afterAll(async () => {
  await vault.stop();
  await fs.rm(root, { recursive: true, force: true });
});

describe('categories in the vault service', () => {
  it('stores a category colour in the frontmatter and edits or removes it', async () => {
    const work = vault.getNode(ids['work']!)!;
    expect(work.fm.extra['color']).toBe('#22d3ee');
    expect(await fs.readFile(path.join(root, work.path), 'utf8')).toContain('color: "#22d3ee"');
    await vault.updateNode(ids['work']!, { frontmatter: { color: '#fbbf24' } });
    expect(vault.getNode(ids['work']!)!.fm.extra['color']).toBe('#fbbf24');
    await vault.updateNode(ids['work']!, { frontmatter: { color: null } });
    expect(vault.getNode(ids['work']!)!.fm.extra['color']).toBeUndefined();
  });

  it('derives categories for the graph', () => {
    const graph = vault.graph!;
    const of = (id: string) => graph.nodes.find((n) => n.id === id);
    expect(of(ids['project']!)?.category).toBe(ids['side']);
    expect(of(ids['note']!)).toMatchObject({ category: ids['side'], categorySource: 'links' });
    expect(graph.categories.map((c) => c.title)).toEqual(['Work', 'Side business']);
  });

  it('deletes a category, moving the nodes that named it to another one', async () => {
    await git.snapshot('manual: edits');
    const r = await vault.deleteCategory(ids['side']!, ids['work']!);
    await git.commitChanges('manual: delete category Side business');
    expect(r.moved.sort()).toEqual([ids['project'], ids['task']].sort());
    expect(vault.getNode(ids['side']!)).toBeUndefined();
    expect(vault.getNode(ids['project']!)!.fm.area).toBe('[[Work]]');
    expect(vault.getNode(ids['task']!)!.fm.area).toBe('[[Work]]');
    const graph = vault.graph!;
    expect(graph.nodes.find((n) => n.id === ids['note'])?.category).toBe(ids['work']);
    const log = await git.log(3);
    expect(log[0]?.subject).toBe('manual: delete category Side business');
  });

  it('refuses to move into something that is not another category', async () => {
    await expect(vault.deleteCategory(ids['work']!, ids['note']!)).rejects.toThrow(/not a category/);
  });
});
