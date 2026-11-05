import type { MapInfo } from '@synapse/core';
import { describe, expect, it } from 'vitest';
import { connectionPatches, MIND, switchPatches } from '../src/lib/maps';

const map = (id: string, kept: string[], apart = false, others: MapInfo[] = []): MapInfo => {
  const off = new Set([...others.filter((m) => m.apart).map((m) => m.id), ...(apart ? [id] : [])]);
  return { id, title: id.toUpperCase(), summary: '', status: 'active', role: null, symbol: 'star', color: null, connects: apart ? [] : kept.filter((c) => !off.has(c)), apart, kept, order: 0, areas: 0, size: 0 };
};

describe('lib/maps', () => {
  it('switches an island off without touching its connections, and back on with all of them', () => {
    const shop = map('shop', [MIND, 'page']);
    const page = map('page', [MIND, 'shop']);
    expect(switchPatches([shop, page], shop, false)).toEqual([{ id: 'shop', frontmatter: { facets: { apart: true } } }]);
    const off = map('shop', [MIND, 'page'], true);
    // Back on: only the mark goes; `connects` stays as written, so the island returns linked to the mind map and the page.
    expect(switchPatches([off, page], off, true)).toEqual([{ id: 'shop', frontmatter: { facets: { apart: null } } }]);
  });

  it('links an island that never had the mind map to it when switched on', () => {
    const lone = map('lone', ['page'], true);
    const page = map('page', [MIND, 'lone']);
    expect(switchPatches([lone, page], lone, true)).toEqual([{ id: 'lone', frontmatter: { facets: { apart: null }, connects: [MIND, '[[PAGE]]'] } }]);
    const fresh = map('fresh', []);
    expect(switchPatches([fresh], fresh, true)).toEqual([{ id: 'fresh', frontmatter: { connects: [MIND] } }]);
  });

  it('keeps paused connections when a chip connects or disconnects, and switches both maps on to connect', () => {
    const blog = map('blog', [MIND], true);
    const shop = map('shop', [MIND, 'blog', 'page'], false, [blog]);
    const page = map('page', [MIND, 'shop']);
    const all = [shop, page, blog];
    // Disconnecting the page keeps the paused link to the switched-off blog.
    expect(connectionPatches(all, shop, 'page', false)).toEqual([
      { id: 'shop', frontmatter: { connects: [MIND, '[[BLOG]]'] } },
      { id: 'page', frontmatter: { connects: [MIND] } },
    ]);
    // Connecting to the blog writes it and switches the blog back on.
    expect(connectionPatches(all, shop, 'blog', true)).toEqual([
      { id: 'shop', frontmatter: { connects: [MIND, '[[PAGE]]', '[[BLOG]]'] } },
      { id: 'blog', frontmatter: { facets: { apart: null } } },
    ]);
  });
});