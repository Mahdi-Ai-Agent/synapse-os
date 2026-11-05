import { describe, expect, it } from 'vitest';
import { scopesOf, mapsConnected } from '../src/maps';
import type { MapInfo } from '../src/types';

const map = (id: string, connects: string[], order: number, status = 'active'): MapInfo => ({ id, title: id, summary: '', status, role: null, symbol: 'star', color: null, connects, apart: false, kept: connects, order, areas: 0, size: 0 });

describe('scopesOf', () => {
  it('is one core when every map connects to the mind map, directly or through another', () => {
    const maps = [map('character', ['mind'], 0), map('shop', ['character'], 1)];
    const scopes = scopesOf(maps);
    expect(scopes).toHaveLength(1);
    expect(scopes[0]).toMatchObject({ id: 'mind', core: true });
    expect(scopes[0]!.maps.map((m) => m.id)).toEqual(['character', 'shop']);
  });

  it('makes every group cut off from the mind map a scope of its own', () => {
    const maps = [map('character', [], 0), map('shop', ['mind'], 1), map('page', ['character'], 2), map('old', ['mind'], 3, 'archived')];
    const scopes = scopesOf(maps);
    expect(scopes.map((s) => [s.id, s.core, s.maps.map((m) => m.id)])).toEqual([
      ['mind', true, ['shop']],
      ['character', false, ['character', 'page']],
    ]);
    expect(mapsConnected(maps, 'page', 'character')).toBe(true);
    expect(mapsConnected(maps, 'shop', 'character')).toBe(false);
  });
});
