import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createVault } from '@synapse/vault-template';
import { VaultService } from '../src/vault-service';

describe('VaultService.stop', () => {
  it('waits for a rebuild under way, so the folder can go', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-stop-'));
    await createVault(root);
    const vault = new VaultService(root);
    await vault.start();
    const writing = vault.rebuildNow('api');
    await vault.stop();
    await fs.rm(root, { recursive: true, force: true });
    await writing;
    await new Promise((r) => setTimeout(r, 100));
    // A rebuild still writing after stop() would have put index/ back (or failed the rm with ENOTEMPTY).
    await expect(fs.access(root)).rejects.toThrow();
  });
});
