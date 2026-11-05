import { recordError } from './diagnostics';
import { authHeaders, reportUnauthorized, wsUrl } from './pairing';

export interface WsMessage { type: string; payload: unknown }

/** `websocket` and `http` both deliver events; `http` is the fallback when a proxy or CDN drops the WebSocket. */
export type LiveMode = 'connecting' | 'websocket' | 'http' | 'offline';
export interface LiveStatus { mode: LiveMode; code: string | null; detail: string | null }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The live channel to the server (docs/ARCHITECTURE.md "Live events"): the WebSocket first; when it cannot open twice
 * in a row — a proxy or CDN that drops the upgrade — the same events over HTTP long-polls (`GET /api/events`) for the
 * rest of the page's life. `localStorage['synapse.live'] = 'http'` forces the fallback. Returns a disposer.
 */
export function connectLive(onMessage: (m: WsMessage) => void, onStatus: (s: LiveStatus) => void): () => void {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let socket: WebSocket | null = null;
  let poll: AbortController | null = null;
  let attempt = 0;
  let wsFailures = 0;
  const status = (mode: LiveMode, code: string | null = null, detail: string | null = null): void => onStatus({ mode, code, detail });
  const forced = ((): boolean => { try { return localStorage.getItem('synapse.live') === 'http'; } catch { return false; } })();

  const openWs = (): void => {
    status('connecting');
    let opened = false;
    const ws = new WebSocket(wsUrl());
    socket = ws;
    ws.onopen = () => { opened = true; attempt = 0; wsFailures = 0; status('websocket'); };
    ws.onmessage = (ev) => {
      try { onMessage(JSON.parse(String(ev.data)) as WsMessage); } catch { /* ignore */ }
    };
    ws.onclose = (ev) => {
      if (closed) return;
      if (!opened) {
        wsFailures++;
        const code = `LIVE-WS-${ev.code}`;
        recordError({ code, message: 'the live connection (WebSocket) could not open; a proxy or CDN in front of the server may be dropping it', path: '/ws' });
        if (wsFailures >= 2) { socket = null; void pollLoop(code); return; }
        status('connecting', code);
      } else status('connecting');
      timer = setTimeout(openWs, Math.min(10_000, 500 * 2 ** attempt++));
    };
    ws.onerror = () => ws.close();
  };

  const pollLoop = async (why: string | null): Promise<void> => {
    let after: number | undefined;
    let epoch: string | undefined;
    let failures = 0;
    while (!closed) {
      poll = new AbortController();
      try {
        const qs = new URLSearchParams({ wait: '25', t: String(Date.now()) });
        if (after !== undefined && epoch) { qs.set('after', String(after)); qs.set('epoch', epoch); }
        const res = await fetch(`/api/events?${qs.toString()}`, { headers: authHeaders(), cache: 'no-store', signal: poll.signal });
        if (res.status === 401) { reportUnauthorized(); return; }
        if (!res.ok) throw Object.assign(new Error(`the server answered ${res.status}`), { code: `LIVE-HTTP-${res.status}`, requestId: res.headers.get('x-request-id') });
        const j = await res.json() as { epoch: string; seq: number; hello?: unknown; events?: Array<{ type: string; payload: unknown }> };
        if (j.hello) onMessage({ type: 'hello', payload: j.hello });
        for (const ev of j.events ?? []) onMessage({ type: ev.type, payload: ev.payload });
        after = j.seq;
        epoch = j.epoch;
        failures = 0;
        status('http', null, why);
        // While a reply streams, a short pause lets its pieces arrive together in the next answer.
        if ((j.events ?? []).length) await sleep(120);
      } catch (err) {
        if (closed) return;
        failures++;
        const e = err as Error & { code?: string; requestId?: string | null };
        const code = e.code ?? 'LIVE-HTTP-NET';
        recordError({ code, message: e.message, ...(e.requestId ? { requestId: e.requestId } : {}), path: '/api/events' });
        status('offline', code, e.message);
        await sleep(Math.min(10_000, 500 * 2 ** failures));
      }
    }
  };

  // Deferred so React StrictMode's mount/unmount/mount cycle never opens a channel it closes at once.
  timer = setTimeout(() => { if (forced) void pollLoop('forced'); else openWs(); }, 0);
  return () => { closed = true; if (timer) clearTimeout(timer); socket?.close(); poll?.abort(); };
}
