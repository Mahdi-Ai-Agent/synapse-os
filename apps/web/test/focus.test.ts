import { describe, expect, it } from 'vitest';
import { focusLine, parseFocus } from '../src/lib/focus';

describe('focus', () => {
  const md = [
    '# Focus — 2026-11-02', '',
    '## Now',
    '- [[تماس با دکتر رضایی]] — دو روز عقب افتاده',
    '2. [[Build graph view prototype|the prototype]] — moves the Synapse goal', '',
    '## This week', '- [[مرور سایت]] — due Thursday', '',
    '## Waiting', '- [[قرارداد پیج]] — on Ali', '',
    '## Asked of you', '- [[سفر نوروز]] has not moved in 40 days: still on?', '',
    '## This review', '- archived 4 · priorities 9 · links 12',
  ].join('\n');

  it('reads the review date, the ordered lists, the questions and the counts', () => {
    const f = parseFocus(md);
    expect(f.date).toBe('2026-11-02');
    expect(f.now.map((l) => [l.title, l.why])).toEqual([['تماس با دکتر رضایی', 'دو روز عقب افتاده'], ['Build graph view prototype', 'moves the Synapse goal']]);
    expect(f.week[0]?.title).toBe('مرور سایت');
    expect(f.waiting[0]?.why).toBe('on Ali');
    expect(f.asked).toEqual(['[[سفر نوروز]] has not moved in 40 days: still on?']);
    expect(f.review).toBe('archived 4 · priorities 9 · links 12');
  });

  it('keeps a line without a link as text, and an empty file as nothing', () => {
    expect(focusLine('- Call the bank — before noon')).toEqual({ title: null, text: 'Call the bank — before noon', why: 'before noon' });
    expect(parseFocus('')).toEqual({ date: null, now: [], week: [], waiting: [], asked: [], review: null });
  });
});
