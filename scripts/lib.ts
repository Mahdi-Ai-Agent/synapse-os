import os from 'node:os';
import path from 'node:path';

/** Vault path from the first positional argument, `SYNAPSE_VAULT`, or `~/Synapse/vault`. */
export function resolveVaultPath(argv: string[] = process.argv.slice(2)): string {
  const positional = argv.find((a) => !a.startsWith('--'));
  const raw = positional ?? process.env['SYNAPSE_VAULT'] ?? path.join(os.homedir(), 'Synapse', 'vault');
  return path.resolve(raw.replace(/^~(?=$|\/)/, os.homedir()));
}

export function hasFlag(flag: string, argv: string[] = process.argv.slice(2)): boolean {
  return argv.includes(flag);
}
