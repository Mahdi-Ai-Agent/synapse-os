import { promises as fs } from 'node:fs';
import path from 'node:path';
import { git } from '@synapse/vault-template';

export interface ChangeSet {
  created: string[];
  updated: string[];
  deleted: string[];
  commit?: string;
}

export interface Commit {
  hash: string;
  date: string;
  subject: string;
}

/** All git operations on the vault live here (history + undo of brain runs). */
export class VaultGit {
  constructor(private readonly root: string) {}

  private async run(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return git(this.root, ['-c', 'core.quotePath=false', ...args]);
  }

  async ensureRepo(): Promise<void> {
    let fresh = false;
    try { await fs.access(path.join(this.root, '.git')); } catch { fresh = true; }
    if (fresh) await this.run(['init', '-q', '-b', 'main']);
    // Commits need an identity; a machine without a global one (a container) gets a local, neutral one.
    const name = await this.run(['config', 'user.name']);
    if (!name.stdout.trim()) { await this.run(['config', 'user.name', 'Synapse']); await this.run(['config', 'user.email', 'synapse@localhost']); }
    if (!fresh) return;
    await this.run(['add', '-A']);
    await this.run(['commit', '-q', '-m', 'seed: vault']);
  }

  /** Drops the whole history and starts the repository again from what is on disk (Erase everything). */
  async reinit(): Promise<void> {
    await fs.rm(path.join(this.root, '.git'), { recursive: true, force: true });
    await this.ensureRepo();
  }

  async head(): Promise<string | null> {
    const r = await this.run(['rev-parse', 'HEAD']);
    return r.code === 0 ? r.stdout.trim() : null;
  }

  async isDirty(): Promise<boolean> {
    const r = await this.run(['status', '--porcelain']);
    return r.stdout.trim().length > 0;
  }

  /** Commits any pending changes so later diffs attribute edits correctly. Returns the commit hash or null. */
  async snapshot(message: string): Promise<string | null> {
    if (!(await this.isDirty())) return null;
    await this.run(['add', '-A']);
    const r = await this.run(['commit', '-q', '-m', message]);
    return r.code === 0 ? this.head() : null;
  }

  /** Stages everything, classifies the pending changes, commits them. Paths are vault-relative. */
  async commitChanges(message: string): Promise<ChangeSet> {
    await this.run(['add', '-A']);
    const status = await this.run(['status', '--porcelain', '-z']);
    const set: ChangeSet = { created: [], updated: [], deleted: [] };
    const parts = status.stdout.split('\0');
    for (let i = 0; i < parts.length; i++) {
      const entry = parts[i];
      if (!entry || entry.length < 4) continue;
      const x = entry[0];
      const p = entry.slice(3);
      if (x === 'R' || x === 'C') { i++; set.updated.push(p); }
      else if (x === 'A' || x === '?') set.created.push(p);
      else if (x === 'D') set.deleted.push(p);
      else set.updated.push(p);
    }
    if (!set.created.length && !set.updated.length && !set.deleted.length) return set;
    const r = await this.run(['commit', '-q', '-m', message]);
    if (r.code === 0) { const h = await this.head(); if (h) set.commit = h; }
    return set;
  }

  async log(limit = 50): Promise<Commit[]> {
    const r = await this.run(['log', `-n${limit}`, '--date=iso-strict', '--pretty=format:%H%x1f%ad%x1f%s']);
    if (r.code !== 0) return [];
    return r.stdout.split('\n').filter(Boolean).map((line) => {
      const [hash = '', date = '', subject = ''] = line.split('\x1f');
      return { hash, date, subject };
    });
  }

  /** Reverts one commit (e.g. a brain run) in a new commit. */
  async revert(hash: string): Promise<{ ok: boolean; commit?: string; error?: string }> {
    await this.snapshot('manual: edits before undo');
    const r = await this.run(['revert', '--no-edit', hash]);
    if (r.code !== 0) { await this.run(['revert', '--abort']); return { ok: false, error: r.stderr.trim() || 'git revert failed' }; }
    const head = await this.head();
    return head ? { ok: true, commit: head } : { ok: true };
  }
}
