/**
 * Renders the PWA icons from `public/icon.svg` (the single source of the mark) with resvg's WASM build —
 * no native image library. Run: `pnpm --filter @synapse/web icons`. Outputs land in `public/icons/`.
 */
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg, initWasm } from '@resvg/resvg-wasm';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(here, '..', 'public');
const out = path.join(pub, 'icons');
const require = createRequire(import.meta.url);

const BG = '#0b0f17';

/** The mark on a square canvas; `inset` shrinks it toward the centre (maskable icons keep the safe zone). */
function variant(mark: string, inset: number, square: boolean): string {
  const body = mark.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const scale = 1 - inset * 2;
  const offset = 512 * inset;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
    (square ? `<rect width="512" height="512" fill="${BG}"/>` : '') +
    `<g transform="translate(${offset} ${offset}) scale(${scale})">${body}</g></svg>`;
}

async function render(svg: string, size: number, file: string): Promise<void> {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: 'transparent' });
  const png = resvg.render().asPng();
  await fs.writeFile(path.join(out, file), png);
  console.log(`${file}  ${size}×${size}  ${png.byteLength} bytes`);
}

await initWasm(await fs.readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
await fs.mkdir(out, { recursive: true });
const mark = await fs.readFile(path.join(pub, 'icon.svg'), 'utf8');
await render(mark, 192, 'icon-192.png');
await render(mark, 512, 'icon-512.png');
// Maskable: full-bleed background, mark inside the central 80% (the platform crops the outer ring).
await render(variant(mark, 0.1, true), 512, 'maskable-512.png');
// iOS rounds the corners itself and dislikes transparency: opaque square, no inset.
await render(variant(mark, 0, true), 180, 'apple-touch-icon.png');
