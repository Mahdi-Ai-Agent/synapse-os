import { describe, expect, it } from 'vitest';
import { joinFrontmatter, splitFrontmatter } from '../src/frontmatter';

describe('frontmatter', () => {
  it('splits YAML and body, keeping dates as strings', () => {
    const text = '---\ntitle: X\ndue: 2026-11-05\nlinks: ["[[A]]"]\npriority: 2\n---\nbody line\n';
    const r = splitFrontmatter(text);
    expect(r.hasFrontmatter).toBe(true);
    expect(r.data['due']).toBe('2026-11-05');
    expect(r.data['links']).toEqual(['[[A]]']);
    expect(r.data['priority']).toBe(2);
    expect(r.body).toBe('body line\n');
  });

  it('round-trips without quoting dates and with quoted links', () => {
    const data = { type: 'task', title: 'تماس با دکتر', due: '2026-11-05', area: '[[سلامتی]]', people: ['[[علی]]'] };
    const text = joinFrontmatter(data, 'متن\n');
    expect(text).toContain('due: 2026-11-05\n');
    expect(text).toMatch(/area: "\[\[سلامتی\]\]"/);
    const back = splitFrontmatter(text);
    expect(back.data).toEqual(data);
    expect(back.body).toBe('متن\n');
  });

  it('reports invalid YAML without throwing', () => {
    const r = splitFrontmatter('---\ntitle: [unclosed\n---\nbody');
    expect(r.yamlError).toBeTruthy();
    expect(r.body).toBe('body');
  });

  it('treats a file without frontmatter as body only', () => {
    const r = splitFrontmatter('just text');
    expect(r.hasFrontmatter).toBe(false);
    expect(r.body).toBe('just text');
  });
});

describe('lenient recovery', () => {
  it('recovers a frontmatter with an unquoted colon in a value (the brain wrote it)', () => {
    const text = '---\nid: 01ABC\ntype: journal\ntitle: 2026-10-31\nsummary: صبح دویدم؛ مرور روزانه: ۲ عقب‌افتاده، ۱ مهلت امروز.\nstatus: active\ndate: 2026-10-31\npeople:\n  - "[[علی]]"\ntags: [health, "sleep"]\npriority: 2\n---\nbody\n';
    const r = splitFrontmatter(text);
    expect(r.yamlError).toBeTruthy();
    expect(r.recovered).toBe(true);
    expect(r.data['title']).toBe('2026-10-31');
    expect(r.data['summary']).toBe('صبح دویدم؛ مرور روزانه: ۲ عقب‌افتاده، ۱ مهلت امروز.');
    expect(r.data['people']).toEqual(['[[علی]]']);
    expect(r.data['tags']).toEqual(['health', 'sleep']);
    expect(r.data['priority']).toBe(2);
    expect(r.body).toBe('body\n');
  });

  it('re-serializes a recovered summary as valid YAML', () => {
    const out = joinFrontmatter({ title: 'x', summary: 'a: b' }, 'body\n');
    expect(splitFrontmatter(out).yamlError).toBeUndefined();
    expect(splitFrontmatter(out).data['summary']).toBe('a: b');
  });
});
