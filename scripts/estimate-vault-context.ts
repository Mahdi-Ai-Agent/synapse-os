import { estimateStartupContext } from '@synapse/vault-template';
import { resolveVaultPath } from './lib';

const root = resolveVaultPath();
const r = await estimateStartupContext(root);
console.log(JSON.stringify({ root, ...r }, null, 2));
process.exitCode = r.withinBudget ? 0 : 1;
