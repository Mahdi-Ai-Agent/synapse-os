/**
 * What the Settings → Diagnostics card shows about the server (docs/ARCHITECTURE.md "Diagnostics"): when it started
 * and its last errors, each with a code the UI also shows next to the failure — `HTTP-<status>` with the request id
 * the response carried in `x-request-id`, or `RUN-<run id>` for a brain run that failed.
 */
export interface ServerError {
  at: string;
  code: string;
  message: string;
  requestId?: string;
  path?: string;
}

export class ServerDiagnostics {
  readonly startedAt = new Date().toISOString();
  private errors: ServerError[] = [];

  record(e: Omit<ServerError, 'at'>): void {
    this.errors.push({ at: new Date().toISOString(), ...e, message: e.message.slice(0, 400) });
    if (this.errors.length > 50) this.errors.shift();
  }

  recent(): ServerError[] {
    return [...this.errors].reverse();
  }
}
