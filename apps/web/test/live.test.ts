import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientErrors } from '../src/lib/diagnostics';
import { connectLive, type LiveStatus, type WsMessage } from '../src/lib/ws';

/** A WebSocket that a CDN in front of the server never lets open. */
class BlockedSocket {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { setTimeout(() => this.onclose?.({ code: 1006 }), 5); }
  close(): void { /* already closed */ }
}

const g = globalThis as unknown as Record<string, unknown>;

afterEach(() => { vi.unstubAllGlobals(); });

describe('the live channel', () => {
  it('falls back to HTTP when the WebSocket cannot open, and delivers the same events', async () => {
    vi.stubGlobal('location', { protocol: 'https:', host: 'mind.example' });
    vi.stubGlobal('WebSocket', BlockedSocket);
    const polls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      polls.push(url);
      const after = new URL(url, 'https://mind.example').searchParams.get('after');
      const body = after === null
        ? { epoch: 'e1', seq: 7, hello: { vault: true, queue: { running: null, queued: [] } }, events: [] }
        : after === '7' ? { epoch: 'e1', seq: 8, events: [{ seq: 8, type: 'brain.done', payload: { runId: 'r1', ok: true } }] }
          : await new Promise<never>(() => undefined);
      return { ok: true, status: 200, headers: new Headers(), json: async () => body } as unknown as Response;
    });
    const got: WsMessage[] = [];
    const states: LiveStatus[] = [];
    const stop = connectLive((m) => got.push(m), (s) => states.push(s));
    await vi.waitFor(() => expect(got.map((m) => m.type)).toEqual(['hello', 'brain.done']), { timeout: 4000 });
    stop();
    expect(states.at(-1)).toMatchObject({ mode: 'http', detail: 'LIVE-WS-1006' });
    expect(polls[1]).toContain('after=7');
    expect(polls[1]).toContain('epoch=e1');
    expect(clientErrors().some((e) => e.code === 'LIVE-WS-1006')).toBe(true);
    expect(typeof g['WebSocket']).toBe('function');
  });
});
