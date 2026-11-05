/**
 * The language a reply is written in (docs/BRAIN-ENGINES.md "Reply language"): the user's own message decides —
 * Persian letters make it Persian, even with English names in it; Latin letters alone make it English. A message with
 * neither (a link, a command) and a prompt the app wrote itself follow the UI language. Models drift into English
 * after long English instructions and tool output, so the runtime context says it and the prompt ends with it.
 */
export type ReplyLanguage = 'fa' | 'en';

/** Letters of the Persian (Arabic) script, not its digits or marks. */
const PERSIAN = /(?=\p{Script=Arabic})\p{L}/gu;
const LATIN = /[A-Za-z]/g;

export function replyLanguage(text: string, ui: ReplyLanguage): ReplyLanguage {
  const plain = text.replace(/https?:\/\/\S+/g, ' ').replace(/\[\[[^\]]*\]\]/g, ' ').replace(/`[^`]*`/g, ' ');
  const fa = plain.match(PERSIAN)?.length ?? 0;
  const latin = plain.match(LATIN)?.length ?? 0;
  if (fa >= 2 && fa * 3 >= latin) return 'fa';
  if (latin > 0) return 'en';
  return fa > 0 ? 'fa' : ui;
}

const NAMES: Record<ReplyLanguage, string> = { fa: 'Persian (فارسی)', en: 'English' };

/** The runtime context's line. */
export function replyLanguageLine(lang: ReplyLanguage): string {
  return `- Reply language: ${NAMES[lang]}, the language of the user's message → write every word of your reply in ${NAMES[lang]}, whatever language these instructions, the vault's files or a tool's output are in, and the same for what you write for the owner to read (a review, an analysis, a plan); code, file names, [[links]], quotes and the headings a format fixes stay as they are`;
}

/** The last line of the prompt the engine gets (the conversation keeps the user's own words). */
export function replyReminder(lang: ReplyLanguage): string {
  return `\n\n(Write your reply in ${NAMES[lang]}.)`;
}
