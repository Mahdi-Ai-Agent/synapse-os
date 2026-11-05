import { createVault, rebuildDerived } from '@synapse/vault-template';
import { resolveVaultPath } from './lib';

const dest = resolveVaultPath();
const r = await createVault(dest);
const d = await rebuildDerived(dest);
console.log(JSON.stringify({ ...r, nodes: d.nodes.length, healed: d.healed.length }, null, 2));
