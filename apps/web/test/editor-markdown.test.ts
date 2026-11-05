import { describe, expect, it } from 'vitest';
import { docToMarkdown, markdownToDoc } from '../src/lib/editor-markdown';

const roundTrip = (md: string): string => docToMarkdown(markdownToDoc(md));

describe('editor-markdown', () => {
  it('keeps canonical vault bodies byte-identical', () => {
    const bodies = [
      '**Outcome:** a daily-used app where capture → graph → review works end to end.\n\n**Next action:** [[Build graph view prototype]]\n\nSee [[Obsidian: why it didn\'t stick]] for the problem statement and [[react-force-graph]] for the rendering library.\n',
      '- [ ] طرح صفحه‌ی اصلی\n- [ ] فهرست نمونه‌کارها\n- [x] زمان‌بندی بلاگ\n',
      '- Index-first retrieval beats embedding-everything for personal vaults.\n- Typed edges (belongs_to, mentions) make graphs readable.\n- Follow up: [[Send Synapse demo to Dr. Chen]]\n',
      'هر گره با `created` خودش ظاهر شود؛ مثل حالت Animate در آبسیدین ولی با رنگ نوع.\n\n**Why it matters:** حس پیشرفت و الگوهای فکری را نشان می‌دهد.\n**Next step:** اسلایدر بازه‌ی زمانی در کنترل‌های گراف.\n',
      'Link with alias [[Synapse app|the app]] and heading [[PARA و GTD#Intro]].\n\n```\n[[not a link]] and *literal*\n```\n',
      '## 21:40\n\nکل روز روی [[Build graph view prototype]] بودم. [[برنامه‌ی تناسب اندام]] امروز تعطیل.\n\n## Related\n\n- [[Sleep routine]]\n',
      'Tiago Forte\'s book; R&D notes and 5 * 3 = 15.\n',
      'Escaped \\*not italic\\* and a path C:\\Users stay as written.\n',
    ];
    for (const md of bodies) expect(roundTrip(md)).toBe(md);
  });

  it('parses wikilinks into atom nodes and writes them back unescaped', () => {
    const doc = markdownToDoc('See [[Sleep routine|sleep]] now.\n');
    const para = doc.content?.[0];
    expect(para?.content?.map((n) => n.type)).toEqual(['text', 'wikilink', 'text']);
    expect(para?.content?.[1]?.attrs).toEqual({ target: 'Sleep routine', subpath: null, alias: 'sleep' });
    expect(docToMarkdown(doc)).toBe('See [[Sleep routine|sleep]] now.\n');
  });

  it('normalizes only layout, never content: a heading directly followed by text gains a blank line', () => {
    expect(roundTrip('## 08:15\nدویدن سبک.\n')).toBe('## 08:15\n\nدویدن سبک.\n');
  });

  it('ends with exactly one newline and maps an empty document to an empty body', () => {
    expect(roundTrip('Caffeine cutoff 15:00.')).toBe('Caffeine cutoff 15:00.\n');
    expect(roundTrip('')).toBe('');
    expect(roundTrip('\n\n')).toBe('');
  });
});
