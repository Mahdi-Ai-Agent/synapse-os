import { seedSampleVault } from '@synapse/vault-template';
import { hasFlag, resolveVaultPath } from './lib';

const dest = resolveVaultPath();
const r = await seedSampleVault(dest, { reset: hasFlag('--reset'), addMissing: hasFlag('--add-missing') });
console.log(JSON.stringify(r, null, 2));
if (r.skipped) console.error('vault already has nodes; pass --reset to replace them with the sample data');
