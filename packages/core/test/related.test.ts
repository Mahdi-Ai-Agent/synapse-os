import { describe, expect, it } from 'vitest';
import { buildLinkIndex } from '../src/links';
import { healNode, parseNodeFile } from '../src/node';
import { linkedNodeIds, relatedNodes, relatedQueryTerms } from '../src/related';
import { buildSearchIndex } from '../src/search';
import type { VaultNode } from '../src/types';

function mk(path: string, text: string): VaultNode {
  const { node } = parseNodeFile(path, text);
  return healNode(node, { newId: () => `id-${path}`, now: () => '2026-10-31T10:00:00+03:30' }).node;
}

const rustBook = mk('nodes/resources/rust-book.md', '---\ntype: resource\ntitle: The Rust Programming Language\nsummary: The official Rust book, free online.\ntags: [rust]\n---\n');
const rustCourse = mk('nodes/ideas/rust-course.md', '---\ntype: idea\ntitle: مینی‌دوره‌ی Rust برای دوستان\nsummary: تجربه‌ی یادگیری Rust را به یک دوره‌ی کوچک آنلاین تبدیل کنم.\n---\nبعد از تمام شدن کتاب Rust.\n');
const rustProject = mk('nodes/projects/learn-rust.md', '---\ntype: project\ntitle: یادگیری Rust\nsummary: خواندن کتاب Rust و ساخت یک ابزار CLI کوچک.\ntags: [rust, learning]\n---\nمنبع اصلی: [[The Rust Programming Language]]\n');
const sleep = mk('nodes/notes/sleep.md', '---\ntype: note\ntitle: Sleep routine\nsummary: Lights off 23:30, no screens after 23:00.\ntags: [health, sleep]\n---\nCaffeine cutoff 15:00.\n');
const yoga = mk('nodes/ideas/yoga.md', '---\ntype: idea\ntitle: کلاس یوگای صبحگاهی\nsummary: ثبت‌نام در کلاس یوگا برای کاهش استرس و بهبود خواب.\ntags: [health]\n---\nشاید جایگزین یکی از جلسات دویدن.\n');
const inbox = mk('nodes/inbox/x.md', '---\ntype: inbox\ntitle: rust rust rust\nsummary: rust rust rust\nstatus: new\n---\nrust book\n');
const nodes = [rustBook, rustCourse, rustProject, sleep, yoga, inbox];
const search = buildSearchIndex(nodes);
const links = buildLinkIndex(nodes);

describe('related', () => {
  it('builds query terms from title, tags, summary and body without stopwords', () => {
    const terms = relatedQueryTerms(rustProject);
    expect(terms[0]).toBe('rust');
    expect(terms).toContain('کتاب');
    expect(terms).not.toContain('و');
    expect(terms).not.toContain('the');
  });

  it('ranks lexically similar nodes and skips self, linked nodes and inbox items', () => {
    const exclude = linkedNodeIds(links, rustProject.fm.id);
    expect(exclude.has(rustBook.fm.id)).toBe(true); // linked from the body
    const hits = relatedNodes(search, rustProject, 5, { exclude });
    expect(hits.map((h) => h.id)).not.toContain(rustProject.fm.id);
    expect(hits.map((h) => h.id)).not.toContain(rustBook.fm.id);
    expect(hits.map((h) => h.id)).not.toContain(inbox.fm.id);
    expect(hits[0]?.id).toBe(rustCourse.fm.id);
    expect(hits[0]?.terms).toContain('rust');
    expect(hits.map((h) => h.id)).not.toContain(sleep.fm.id);
  });

  it('matches across Persian text and tags', () => {
    const hits = relatedNodes(search, yoga, 5);
    expect(hits[0]?.id).toBe(sleep.fm.id); // shared tag "health"
  });

  it('collects linked ids in both directions', () => {
    expect(linkedNodeIds(links, rustBook.fm.id).has(rustProject.fm.id)).toBe(true); // backlink
  });
});
