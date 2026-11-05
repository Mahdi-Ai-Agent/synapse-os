import { describe, expect, it } from 'vitest';
import { joinDictation, recognitionCtor, startDictation, transcriptOf, type RecognitionLike, type SpeechEventLike } from '../src/lib/dictation';
import { effortLabel, effortsOf, fitEffort } from '../src/lib/efforts';
import type { EngineInfo } from '../src/lib/types';

const event = (...parts: Array<[string, boolean]>): SpeechEventLike => ({
  results: Object.assign(parts.map(([text, isFinal]) => Object.assign([{ transcript: text }], { isFinal })), { length: parts.length }),
});

describe('dictation', () => {
  it('puts what is said after what was typed, as it is recognized', () => {
    expect(joinDictation('', ' سلام  دنیا ')).toBe('سلام دنیا');
    expect(joinDictation('یادم بنداز', 'فردا ساعت ده')).toBe('یادم بنداز فردا ساعت ده');
    expect(joinDictation('note: ', 'call Ali')).toBe('note: call Ali');
    expect(joinDictation('kept', '   ')).toBe('kept');
    expect(transcriptOf(event(['سلام ', true], ['دنیا', false]))).toBe('سلام دنیا');
  });

  it("drives the browser's recognizer in the UI language and stops when asked", () => {
    const made: FakeRecognition[] = [];
    class FakeRecognition implements RecognitionLike {
      lang = ''; continuous = false; interimResults = false; started = false; stopped = false;
      onresult: RecognitionLike['onresult'] = null; onerror: RecognitionLike['onerror'] = null; onend: RecognitionLike['onend'] = null;
      constructor() { made.push(this); }
      start(): void { this.started = true; }
      stop(): void { this.stopped = true; this.onend?.(); }
    }
    const heard: string[] = []; const errors: string[] = []; let ended = 0;
    const d = startDictation({ lang: 'fa-IR', ctor: FakeRecognition, onText: (x) => heard.push(x), onEnd: () => { ended++; }, onError: (c) => errors.push(c) });
    const rec = made[0]!;
    expect(rec).toMatchObject({ lang: 'fa-IR', continuous: true, interimResults: true, started: true });
    rec.onresult?.(event(['فردا', false]));
    rec.onresult?.(event(['فردا ساعت ده', true]));
    rec.onerror?.({ error: 'network' });
    expect(heard).toEqual(['فردا', 'فردا ساعت ده']);
    expect(errors).toEqual(['network']);
    d?.stop();
    expect(rec.stopped).toBe(true);
    expect(ended).toBe(1);
    expect(startDictation({ lang: 'en-US', ctor: null, onText: () => undefined, onEnd: () => undefined, onError: () => undefined })).toBeNull();
  });

  it('finds the recognizer under either name, or none', () => {
    function Ctor(): void { /* stand-in */ }
    expect(recognitionCtor({ webkitSpeechRecognition: Ctor })).toBe(Ctor);
    expect(recognitionCtor({ SpeechRecognition: Ctor })).toBe(Ctor);
    expect(recognitionCtor({})).toBeNull();
    expect(recognitionCtor(undefined)).toBeNull();
    // The Mac app has the names but no speech service: the microphone stays hidden there.
    expect(recognitionCtor({ webkitSpeechRecognition: Ctor, synapseDesktop: { speech: false } })).toBeNull();
    expect(recognitionCtor({ webkitSpeechRecognition: Ctor, synapseDesktop: { platform: 'darwin' } })).toBe(Ctor);
  });
});

describe('efforts', () => {
  const codex = {
    id: 'codex-cli',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    models: [
      { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'low' },
      { id: 'gpt-6-luna', label: 'GPT-6-Luna', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium' },
      { id: 'plain', label: 'Plain' },
    ],
  } as unknown as EngineInfo;

  it("offers each model's own efforts and keeps a pick the new model takes", () => {
    expect(effortsOf(codex, 'gpt-6-luna')).not.toContain('ultra');
    expect(effortsOf(codex, 'plain')).toEqual(codex.efforts);
    expect(fitEffort(codex, 'gpt-6-luna', 'high')).toEqual({});
    expect(fitEffort(codex, 'gpt-6-luna', 'ultra')).toEqual({ effort: 'medium' });
    expect(fitEffort(codex, 'gpt-6.1-sol', 'ultra')).toEqual({});
  });

  it('names the known efforts in the UI language and leaves unknown ones as they are', () => {
    const t = (k: string): string => ({ 'effort.max': 'حداکثر', 'effort.xhigh': 'خیلی زیاد' } as Record<string, string>)[k] ?? k;
    expect(effortLabel('max', t as never)).toBe('حداکثر');
    expect(effortLabel('xhigh', t as never)).toBe('خیلی زیاد');
    expect(effortLabel('turbo', t as never)).toBe('turbo');
  });
});
