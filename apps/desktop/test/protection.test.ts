import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { wrapKey, unwrapKey } from '../src/protection';
import { fingerprint } from '../src/secure-vault';
describe('vault key protection', () => {
  it('round trips with a password, rejects the wrong password and authenticated-data tampering', async () => {
    const secret = randomBytes(48); const wrapped = await wrapKey(secret, 'a long test password 123');
    expect(await unwrapKey(wrapped, 'a long test password 123')).toEqual(secret);
    await expect(unwrapKey(wrapped, 'incorrect password')).rejects.toThrow();
    const bytes = Buffer.from(wrapped.data, 'base64'); bytes[0] = (bytes[0] ?? 0) ^ 1;
    await expect(unwrapKey({ ...wrapped, data: bytes.toString('base64') }, 'a long test password 123')).rejects.toThrow();
    expect(JSON.stringify(wrapped)).not.toContain(secret.toString('base64'));
  });
  it('uses independent salts and nonces and rejects short passwords', async () => {
    const key = randomBytes(32); const a = await wrapKey(key, 'a long test password 123'); const b = await wrapKey(key, 'a long test password 123');
    expect(a.salt).not.toBe(b.salt); expect(a.iv).not.toBe(b.iv);
    await expect(wrapKey(key, 'short')).rejects.toThrow();
  });
});
describe('migration verification', () => {
  it('covers hidden history and bytes, and refuses symlinks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'synapse-protection-'));
    try {
      await mkdir(path.join(root, '.git')); await writeFile(path.join(root, '.git', 'test'), 'history');
      const a = await fingerprint(root); await writeFile(path.join(root, '.git', 'test'), 'changed');
      expect(await fingerprint(root)).not.toBe(a);
      await symlink('/tmp', path.join(root, 'escape')); await expect(fingerprint(root)).rejects.toThrow(/link/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
