import { describe, expect, it } from 'vitest';
import { TouchMap } from '../src/lib/activity';

describe('activity', () => {
  const nodes = [{ id: 'n1', path: 'nodes/notes/a.md' }, { id: 'core:mind', path: null }];

  it('signals an item by its file and the core for the index, memory, a folder or a search', () => {
    const t = new TouchMap('core:mind');
    expect(t.ids(['nodes/notes/a.md'], 'read', nodes)).toEqual(['n1']);
    expect(t.ids(['index/INDEX.md', 'memory/profile.md'], 'read', nodes)).toEqual(['core:mind']);
    expect(t.ids(['nodes/people', 'nodes/notes/a.md'], 'read', nodes)).toEqual(['core:mind', 'n1']);
  });

  it('lights the core for a new item the brain writes, then the item itself once it is on the map', () => {
    const t = new TouchMap('core:mind', 1000);
    expect(t.ids(['nodes/tasks/call.md'], 'write', nodes, 0)).toEqual(['core:mind']);
    expect(t.arrived(nodes, 10)).toEqual([]);
    expect(t.arrived([...nodes, { id: 'n2', path: 'nodes/tasks/call.md' }], 20)).toEqual(['n2']);
    // Once only, and not after it waited too long.
    expect(t.arrived([...nodes, { id: 'n2', path: 'nodes/tasks/call.md' }], 30)).toEqual([]);
    t.ids(['nodes/tasks/late.md'], 'write', nodes, 0);
    expect(t.arrived([{ id: 'n3', path: 'nodes/tasks/late.md' }], 5000)).toEqual([]);
    // A read of a file not on the map remembers nothing.
    t.ids(['nodes/tasks/ghost.md'], 'read', nodes, 0);
    expect(t.arrived([{ id: 'n4', path: 'nodes/tasks/ghost.md' }], 10)).toEqual([]);
  });
});
