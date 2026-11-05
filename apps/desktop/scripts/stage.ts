/**
 * Stages the Mac app in apps/desktop/stage (docs/ARCHITECTURE.md "Desktop app"): the main process and the preload
 * (CommonJS, as Electron loads them), the server bundled into one ES module with every dependency inside, the built
 * web UI, the vault template the server keeps a vault's agent layer from, and the start page. `stage/` is laid out
 * like the packed app's Resources, so the server finds the template at `../template/` either way.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = path.resolve(DESKTOP, '..', '..');
export const STAGE = path.join(DESKTOP, 'stage');
const WEB = path.join(REPO, 'apps', 'web');

/** `web: true` builds the web UI first (a DMG always ships the current one); otherwise only when it was never built. */
export async function stageApp(opts: { web?: boolean } = {}): Promise<void> {
  if (opts.web || !existsSync(path.join(WEB, 'dist', 'index.html'))) {
    execFileSync('pnpm', ['--filter', '@synapse/web', 'build'], { cwd: REPO, stdio: 'inherit' });
  }
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });
  cpSync(path.join(DESKTOP, 'static', 'lock.html'), path.join(STAGE, 'lock.html'));
  const common = { bundle: true, platform: 'node', target: 'node24', legalComments: 'none', logLevel: 'warning' } as const;
  for (const name of ['main', 'preload']) {
    await build({ ...common, entryPoints: [path.join(DESKTOP, 'src', `${name}.ts`)], outfile: path.join(STAGE, `${name}.cjs`), format: 'cjs', external: ['electron'] });
  }
  // The server is the same entry as `pnpm start`. Its CommonJS dependencies call `require`, which an ES module lacks.
  await build({
    ...common,
    entryPoints: [path.join(REPO, 'apps', 'server', 'src', 'main.ts')],
    outfile: path.join(STAGE, 'server', 'server.mjs'),
    format: 'esm',
    banner: { js: "import { createRequire as __synapseRequire } from 'node:module'; const require = __synapseRequire(import.meta.url);" },
    // ws reaches for these optional native speed-ups and does without them.
    external: ['bufferutil', 'utf-8-validate'],
  });
  cpSync(path.join(WEB, 'dist'), path.join(STAGE, 'web'), { recursive: true });
  cpSync(path.join(REPO, 'packages', 'vault-template', 'template'), path.join(STAGE, 'template'), { recursive: true });
  const mark = readFileSync(path.join(WEB, 'public', 'icon.svg'), 'utf8').replace('<svg ', '<svg class="mark" aria-hidden="true" ');
  writeFileSync(path.join(STAGE, 'start.html'), readFileSync(path.join(DESKTOP, 'static', 'start.html'), 'utf8').replace('<!--mark-->', mark));
  const root = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { version: string; description: string; license: string };
  writeFileSync(path.join(STAGE, 'package.json'), `${JSON.stringify({
    name: 'synapse', productName: 'Synapse', version: root.version, description: root.description, license: root.license, author: 'Synapse', main: 'main.cjs',
  }, null, 2)}\n`);
}
