import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/graph';
import { buildLinkIndex } from '../src/links';
import { healNode, parseNodeFile } from '../src/node';
import type { VaultNode } from '../src/types';

let seq = 0;
function mk(path: string, text: string): VaultNode {
  const { node } = parseNodeFile(path, text);
  seq += 1;
  return healNode(node, { newId: () => `id-${String(seq).padStart(2, '0')}-${path}`, now: () => '2026-10-31T10:00:00+03:30' }).node;
}

const work = mk('nodes/areas/work.md', '---\ntype: area\ntitle: Work\nsummary: job\ncreated: 2026-01-01T10:00:00+03:30\ncolor: "#22D3EE"\n---\n');
const health = mk('nodes/areas/health.md', '---\ntype: area\ntitle: سلامتی\nsummary: health\ncreated: 2026-02-01T10:00:00+03:30\ncolor: "not-a-colour"\n---\n');
const app = mk('nodes/projects/app.md', '---\ntype: project\ntitle: Synapse app\nsummary: the app\narea: "[[Work]]"\n---\n');
const task = mk('nodes/tasks/proto.md', '---\ntype: task\ntitle: Build prototype\nsummary: graph\nproject: "[[Synapse app]]"\npeople: ["[[Reza]]"]\n---\n');
const reza = mk('nodes/people/reza.md', '---\ntype: person\ntitle: Reza\nsummary: mentor\n---\n');
const run = mk('nodes/tasks/run.md', '---\ntype: task\ntitle: Run 5k\nsummary: run\narea: "[[سلامتی]]"\n---\nTalk to [[Reza]] about it.\n');
const note = mk('nodes/notes/mixed.md', '---\ntype: note\ntitle: Mixed note\nsummary: links both\n---\n[[Synapse app]] and [[Build prototype]] and [[Run 5k]] and [[Some Ghost]].\n');
const inbox = mk('nodes/inbox/raw.md', '---\ntype: inbox\ntitle: Raw thought\nsummary: raw\nstatus: new\n---\n[[Work]]\n');
const journal = mk('nodes/journal/2026-10-31.md', '---\ntype: journal\ntitle: 2026-10-31\nsummary: day\ndate: 2026-10-31\n---\n[[Run 5k]]\n');
const lonely = mk('nodes/ideas/lonely.md', '---\ntype: idea\ntitle: Lonely idea\nsummary: no links\n---\n');

describe('categories', () => {
  const nodes = [work, health, app, task, reza, run, note, inbox, journal, lonely];
  const graph = buildGraph(nodes, buildLinkIndex(nodes), '2026-10-31T10:00:00+03:30');
  const byTitle = (title: string) => graph.nodes.find((n) => n.title === title);

  it('takes the area itself, the own area, then the project area', () => {
    expect(byTitle('Work')).toMatchObject({ category: work.fm.id, categorySource: 'self' });
    expect(byTitle('Synapse app')).toMatchObject({ category: work.fm.id, categorySource: 'area' });
    expect(byTitle('Build prototype')).toMatchObject({ category: work.fm.id, categorySource: 'project' });
    expect(byTitle('Run 5k')).toMatchObject({ category: health.fm.id, categorySource: 'area' });
  });

  it('infers from the weighted majority of links, ghosts included, ties to the older category', () => {
    // Reza: mentioned by "Build prototype" (Work) and linked from "Run 5k" (Health), weight 1 each → tie → Work is older.
    expect(byTitle('Reza')).toMatchObject({ category: work.fm.id, categorySource: 'links' });
    // Mixed note: two Work neighbours against one Health neighbour.
    expect(byTitle('Mixed note')).toMatchObject({ category: work.fm.id, categorySource: 'links' });
    expect(byTitle('Some Ghost')).toMatchObject({ category: work.fm.id, categorySource: 'links' });
  });

  it('leaves inbox, journal and unlinked nodes uncategorized', () => {
    expect(byTitle('Raw thought')?.category).toBeNull();
    expect(byTitle('2026-10-31')?.category).toBeNull();
    expect(byTitle('Lonely idea')).toMatchObject({ category: null, categorySource: null });
  });

  it('lists categories in creation order with sizes and a validated colour', () => {
    expect(graph.categories.map((c) => c.title)).toEqual(['Work', 'سلامتی']);
    const [w, h] = graph.categories;
    expect(w).toMatchObject({ order: 0, color: '#22d3ee', size: 6 });
    expect(h).toMatchObject({ order: 1, color: null, size: 2 });
  });

  it('is deterministic for the same input', () => {
    const again = buildGraph(nodes, buildLinkIndex([...nodes].reverse()), '2026-10-31T10:00:00+03:30');
    const pick = (g: typeof graph) => g.nodes.map((n) => `${n.id}:${n.category}:${n.categorySource}`).sort();
    expect(pick(again)).toEqual(pick(graph));
  });
});
