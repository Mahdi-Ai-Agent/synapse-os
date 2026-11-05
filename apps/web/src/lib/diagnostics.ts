/**
 * The client's side of Settings → Diagnostics (docs/ARCHITECTURE.md "Diagnostics"): the last errors this page saw,
 * each with the code the UI also showed next to the failure — `HTTP-<status>` (plus the request id the server put in
 * `x-request-id`), `HTTP-NET` when no answer came, `LIVE-WS-<close code>` / `LIVE-HTTP-<status>` for the live channel,
 * `RUN-<run id>` for a brain run that failed.
 */
export interface ClientError {
  at: string;
  code: string;
  message: string;
  requestId?: string;
  path?: string;
}

let errors: ClientError[] = [];
const listeners = new Set<() => void>();

export function recordError(e: Omit<ClientError, 'at'>): void {
  const entry: ClientError = { at: new Date().toISOString(), ...e, message: e.message.slice(0, 400) };
  errors = [entry, ...errors].slice(0, 50);
  for (const l of listeners) l();
}

export function clientErrors(): ClientError[] {
  return errors;
}

export function onClientErrors(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
