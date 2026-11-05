import { describe, expect, it } from 'vitest';
import { replyLanguage, replyLanguageLine, replyReminder } from '../src/language';

describe('language', () => {
  it("answers in the language of the user's message, Persian with English names in it still Persian", () => {
    expect(replyLanguage('فردا با دکتر تماس بگیرم', 'en')).toBe('fa');
    expect(replyLanguage('میخوام Claude Code و ChatGPT رو وصل کنم', 'en')).toBe('fa');
    expect(replyLanguage('What is on my plate this week?', 'fa')).toBe('en');
    expect(replyLanguage('please check [[پروژه سایت]] https://example.com/فارسی', 'fa')).toBe('en');
  });

  it('follows the UI language when the message has no words to go by', () => {
    expect(replyLanguage('https://example.com', 'fa')).toBe('fa');
    expect(replyLanguage('۱۲۳ 456 !!', 'en')).toBe('en');
    expect(replyLanguage('[[سلام]]', 'en')).toBe('en');
  });

  it('says it in the runtime context and at the end of the prompt', () => {
    expect(replyLanguageLine('fa')).toContain('Persian (فارسی)');
    expect(replyLanguageLine('en')).toContain('every word of your reply in English');
    expect(replyReminder('fa')).toBe('\n\n(Write your reply in Persian (فارسی).)');
  });
});
