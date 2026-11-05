/**
 * The Mac app's icon: the Synapse mark (apps/web/public/icon.svg) on a dark rounded square on Apple's icon grid,
 * rendered at every size macOS asks for and packed into an .icns file with iconutil.
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { REPO } from './stage';

export async function renderIcns(out: string): Promise<void> {
  await initWasm(await fs.readFile(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm')));
  const mark = await fs.readFile(path.join(REPO, 'apps', 'web', 'public', 'icon.svg'), 'utf8');
  const body = mark.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">'
    + '<rect x="100" y="100" width="824" height="824" rx="185" fill="#0b0f17"/>'
    + `<g transform="translate(212 212) scale(1.171875)">${body}</g></svg>`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-icon-'));
  const set = path.join(dir, 'Synapse.iconset');
  await fs.mkdir(set);
  try {
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const png = new Resvg(icon, { fitTo: { mode: 'width', value: size * scale }, background: 'transparent' }).render().asPng();
        await fs.writeFile(path.join(set, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`), png);
      }
    }
    await fs.mkdir(path.dirname(out), { recursive: true });
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', set, '-o', out]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
