import { buildLinkIndex, loadVault, SUMMARY_MAX } from '@synapse/core';
import { resolveVaultPath } from './lib';

const root = resolveVaultPath();
const { nodes, problems } = await loadVault(root, { heal: false });
const links = buildLinkIndex(nodes);

const errors: string[] = [];
const warnings: string[] = [];
for (const p of problems) (p.severity === 'error' ? errors : warnings).push(`${p.path}: ${p.message}`);
for (const [key, paths] of links.duplicateTitles) errors.push(`duplicate title "${key}": ${paths.join(', ')}`);
for (const n of nodes) if (n.fm.summary.length > SUMMARY_MAX) warnings.push(`${n.path}: summary ${n.fm.summary.length} > ${SUMMARY_MAX}`);
const unresolved = [...links.unresolved.values()].map((u) => ({ text: u.text, sources: u.sources.size }));

const report = {
  root,
  nodes: nodes.length,
  errors,
  warnings,
  unresolvedLinks: unresolved,
  orphans: nodes.filter((n) => n.fm.type !== 'inbox' && !(links.outgoing.get(n.fm.id)?.length) && !links.backlinks.get(n.fm.id)?.size).map((n) => n.path),
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = errors.length ? 1 : 0;
