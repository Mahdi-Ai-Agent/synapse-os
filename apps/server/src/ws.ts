import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';

/** One server event as the UI receives it; `seq` orders them within one server run (`epoch`). */
export interface LiveEvent {
  seq: number;
  type: string;
  payload: unknown;
  at: number;
}

/**
 * Fan-out of server events to every connected UI (docs/ARCHITECTURE.md "Live events"): pushed over the WebSocket,
 * and kept in a short log that `GET /api/events` serves to clients whose WebSocket a proxy or CDN blocks.
 */
export class Broadcaster {
  private clients = new Set<WebSocket>();
  private log: LiveEvent[] = [];
  private seq = 0;
  private waiters = new Set<() => void>();
  /** Changes on every server start, so a polling client knows its `after` belongs to another run. */
  readonly epoch = randomBytes(6).toString('hex');

  constructor(private readonly keep = 3000, private readonly maxAgeMs = 10 * 60_000) {}

  add(socket: WebSocket): void {
    this.clients.add(socket);
    socket.on('close', () => this.clients.delete(socket));
    socket.on('error', () => this.clients.delete(socket));
  }

  broadcast(type: string, payload: unknown): void {
    const now = Date.now();
    const ev: LiveEvent = { seq: ++this.seq, type, payload, at: now };
    this.log.push(ev);
    while (this.log.length > this.keep || (this.log.length > 0 && now - this.log[0]!.at > this.maxAgeMs)) this.log.shift();
    const msg = JSON.stringify({ type, payload });
    for (const c of this.clients) {
      if (c.readyState === c.OPEN) c.send(msg);
    }
    const waiting = [...this.waiters];
    this.waiters.clear();
    for (const w of waiting) w();
  }

  get size(): number {
    return this.clients.size;
  }

  get lastSeq(): number {
    return this.seq;
  }

  /** Events after `after`; null when some of them have already left the log (the client reloads its state). */
  since(after: number): LiveEvent[] | null {
    if (after > this.seq) return null;
    if (after === this.seq) return [];
    const first = this.log[0]?.seq ?? this.seq + 1;
    if (after < first - 1) return null;
    return this.log.filter((e) => e.seq > after);
  }

  /** Resolves on the next broadcast, after `ms`, or when `signal` aborts (the client went away). */
  next(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => { clearTimeout(timer); this.waiters.delete(done); resolve(); };
      const timer = setTimeout(done, ms);
      this.waiters.add(done);
      signal?.addEventListener('abort', done, { once: true });
    });
  }
}
