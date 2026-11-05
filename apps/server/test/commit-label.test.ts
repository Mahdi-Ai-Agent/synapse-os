import { describe, expect, it } from 'vitest';
import { commitLabel } from '../src/brain-runner';

describe('commitLabel', () => {
  it('takes the reply sentence, not the list of nodes under it', () => {
    expect(commitLabel('کفش را ثبت کردم.\n- created [[خرید کفش]] (task) → [[سلامتی]]\n', 'chat')).toBe('کفش را ثبت کردم.');
  });

  it('skips narration that leaked ahead of the reply on a long run', () => {
    const reply = 'Now creating the six new items.All files written as intended.\n\nنقشه‌ی کاراکتر را به‌روز کردم.\n- updated [[a]] (note)\n- created [[b]] (note)\n';
    expect(commitLabel(reply, 'character')).toBe('نقشه‌ی کاراکتر را به‌روز کردم.');
  });

  it('skips a heading or a bold title over a list (the full review\'s Now)', () => {
    const reply = 'بازبینی انجام شد و تمرکز ثبت شد: ۵ اولویت تغییر کرد.\n\n**اکنون**\n\n- [[تماس با دکتر رضایی]] — دو روز عقب‌افتاده.\n\n## Asked of you\n- one\n';
    expect(commitLabel(reply, 'review')).toBe('بازبینی انجام شد و تمرکز ثبت شد: ۵ اولویت تغییر کرد.');
  });

  it('falls back to the first line, then the mode', () => {
    expect(commitLabel('- created [[a]] (note)\n', 'capture')).toBe('- created [[a]] (note)');
    expect(commitLabel('\n  \n', 'daily')).toBe('daily');
    expect(commitLabel('x'.repeat(100), 'ask')).toHaveLength(72);
  });
});
