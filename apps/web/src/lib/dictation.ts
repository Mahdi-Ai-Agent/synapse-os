/**
 * Speaking instead of typing (UI-DESIGN "Chat" → Voice): the browser's own speech recognition in the UI language —
 * Chrome sends the audio to Google's speech service, Safari to Apple's. The dictation of Claude Code and of the
 * ChatGPT app belongs to those apps and is not open to other programs, so a web page has this way in. The Mac app
 * (Electron) has the API's names with no speech service behind them, and says so (`synapseDesktop.speech`).
 */

export interface SpeechAlternativeLike { transcript: string }
export interface SpeechResultLike { readonly length: number; readonly isFinal: boolean; [i: number]: SpeechAlternativeLike | undefined }
export interface SpeechEventLike { readonly results: { readonly length: number; [i: number]: SpeechResultLike | undefined } }

/** The part of the Web Speech API's `SpeechRecognition` this uses. */
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
export type RecognitionCtor = new () => RecognitionLike;

/** The browser's recognizer (`SpeechRecognition`, `webkitSpeechRecognition` in Chrome and Safari), or null. */
export function recognitionCtor(scope: unknown = typeof window === 'undefined' ? undefined : window): RecognitionCtor | null {
  const w = scope as Record<string, unknown> | undefined;
  const shell = w?.['synapseDesktop'] as { speech?: unknown } | undefined;
  if (shell && shell.speech === false) return null;
  const ctor = w?.['SpeechRecognition'] ?? w?.['webkitSpeechRecognition'];
  return typeof ctor === 'function' ? (ctor as RecognitionCtor) : null;
}

/** Everything heard so far, the words still changing included. */
export function transcriptOf(ev: SpeechEventLike): string {
  let out = '';
  for (let i = 0; i < ev.results.length; i++) out += ev.results[i]?.[0]?.transcript ?? '';
  return out;
}

/** What was typed before the microphone went on, then what was said. */
export function joinDictation(before: string, heard: string): string {
  const said = heard.replace(/\s+/g, ' ').trim();
  if (!said) return before;
  if (!before.trim()) return said;
  return /\s$/.test(before) ? before + said : `${before} ${said}`;
}

export interface Dictation { stop(): void }

/**
 * Listens until stopped (or the browser ends it), handing every new reading of what was said to `onText`. Error codes
 * are the API's (`not-allowed`, `network`, `no-speech`, `aborted`, …). Null when the browser has no recognizer.
 */
export function startDictation(opts: { lang: string; onText: (heard: string) => void; onEnd: () => void; onError: (code: string) => void; ctor?: RecognitionCtor | null }): Dictation | null {
  const Ctor = opts.ctor === undefined ? recognitionCtor() : opts.ctor;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = opts.lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (ev) => opts.onText(transcriptOf(ev));
  rec.onerror = (ev) => opts.onError(ev.error);
  rec.onend = () => opts.onEnd();
  try { rec.start(); } catch { opts.onError('start-failed'); return null; }
  return { stop: () => { try { rec.stop(); } catch { /* already ended */ } } };
}
