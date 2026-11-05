import { recordError } from './diagnostics';
import { authHeaders, reportUnauthorized } from './pairing';
import type { AuthStatus, BrainMode, ImportAnswer, BrainQueue, Commit, ConnectionInfo, ConnectionsList, ConsentRequest, ServerDiagnostics, SignInState, EngineInfo, GraphData, LinkPreview, NodeDetail, LayoutSave, LayoutSaveAnswer, PairingInfo, RelatedHit, RunStart, SavedLayout, SearchHit, Settings, SettingsPatch, Thread, ThreadSummary, VaultInfo } from './types';

/**
 * A failed API call with its HTTP status (the sign-in screen tells a wrong password from a wrong setup code) and the
 * request id the server gave it; the message ends with the code the user can report (`HTTP-502 · 1a2b3c4d`).
 */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly requestId: string | null = null) { super(message); }
}

/** The error for a failed response: recorded for Settings → Diagnostics (401s are the sign-in screen's business). */
function failure(res: Response, data: unknown, path: string): ApiError {
  const body = data as { error?: { message?: string; requestId?: string } } | null;
  const requestId = res.headers.get('x-request-id') ?? body?.error?.requestId ?? null;
  const message = body?.error?.message ?? (res.statusText || 'the request failed');
  const code = `HTTP-${res.status}`;
  if (res.status !== 401) recordError({ code, message, path: path.split('?')[0] ?? path, ...(requestId ? { requestId } : {}) });
  return new ApiError(`${message} · ${code}${requestId ? ` · ${requestId}` : ''}`, res.status, requestId);
}

/** No answer at all (offline, a timeout, a proxy that hung up): recorded as `HTTP-NET`. */
function noAnswer(err: unknown, path: string): ApiError {
  const message = err instanceof Error ? err.message : String(err);
  recordError({ code: 'HTTP-NET', message, path: path.split('?')[0] ?? path });
  return new ApiError(`the server did not answer (${message}) · HTTP-NET`, 0);
}

/** A page's keepalive requests in flight may carry 64 KiB of body together; a save larger than this goes out plainly. */
const KEEPALIVE_MAX = 48_000;

/**
 * `keepalive` lets a request reach the server even when the page reloads or closes while it is on its way (a layout
 * save a moment before a refresh); `'auto'` uses it when the body is small enough, and a keepalive the browser
 * refuses (over its quota) is sent again plainly.
 */
async function request<T>(method: string, path: string, body?: unknown, opts: { keepalive?: boolean | 'auto' } = {}): Promise<T> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const keepalive = opts.keepalive === true || (opts.keepalive === 'auto' && (payload?.length ?? 0) < KEEPALIVE_MAX);
  const send = (keep: boolean): Promise<Response> => fetch(path, {
    method,
    cache: 'no-store',
    ...(keep ? { keepalive: true } : {}),
    headers: { ...authHeaders(), ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    body: payload,
  });
  let res: Response;
  try {
    try { res = await send(keepalive); } catch (err) { if (!keepalive) throw err; res = await send(false); }
  } catch (err) { throw noAnswer(err, path); }
  const text = await res.text();
  const data: unknown = text ? safeJson(text) : null;
  if (!res.ok) {
    if (res.status === 401) reportUnauthorized();
    throw failure(res, data, path);
  }
  return data as T;
}

/** A file from the server (the export), with the name it is offered under. */
async function download(path: string): Promise<{ blob: Blob; filename: string }> {
  let res: Response;
  try { res = await fetch(path, { cache: 'no-store', headers: authHeaders() }); } catch (err) { throw noAnswer(err, path); }
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401) reportUnauthorized();
    throw failure(res, text ? safeJson(text) : null, path);
  }
  const filename = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'synapse.zip';
  return { blob: await res.blob(), filename };
}

/** A file sent as the request body itself (the import). */
async function upload<T>(path: string, file: Blob): Promise<T> {
  let res: Response;
  try { res = await fetch(path, { method: 'POST', cache: 'no-store', headers: { ...authHeaders(), 'content-type': 'application/zip' }, body: file }); } catch (err) { throw noAnswer(err, path); }
  const text = await res.text();
  const data: unknown = text ? safeJson(text) : null;
  if (!res.ok) {
    if (res.status === 401) reportUnauthorized();
    throw failure(res, data, path);
  }
  return data as T;
}

/** The account calls never raise the app-wide "unauthorized" signal: the sign-in screen is where they happen. */
async function authCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      cache: 'no-store',
      headers: { ...authHeaders(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) { throw noAnswer(err, path); }
  const text = await res.text();
  const data: unknown = text ? safeJson(text) : null;
  if (!res.ok) throw failure(res, data, path);
  return data as T;
}

/** A refused connection request on the consent page; `redirect` is set when the app may be told why. */
export class ConsentError extends ApiError {
  constructor(message: string, status: number, readonly redirect: string | null) { super(message, status); }
}

/** The consent page's calls: like `authCall`, but a 400 keeps the server's reason and the way back to the app. */
async function consentCall<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', cache: 'no-store', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch (err) { throw noAnswer(err, path); }
  const text = await res.text();
  const data: unknown = text ? safeJson(text) : null;
  if (res.status === 400) {
    const e = (data as { error?: { message?: string; redirect?: string } } | null)?.error;
    throw new ConsentError(e?.message ?? 'the request is not valid', 400, e?.redirect ?? null);
  }
  if (!res.ok) throw failure(res, data, path);
  return data as T;
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

export const api = {
  vault: () => request<VaultInfo>('GET', '/api/vault'),
  /** `?t=` steps past a stale copy a CDN in front of the server may still hold (the server says no-store). */
  authStatus: () => authCall<AuthStatus>('GET', `/api/auth/status?t=${Date.now()}`),
  /** The consent page (`/oauth/authorize`): what the app asks for, then the owner's answer (docs/ARCHITECTURE.md "MCP connector"). */
  consentRequest: (query: string) => consentCall<ConsentRequest>('/api/oauth/request', { query }),
  consentDecide: (input: { query: string; allow: boolean; write: boolean }) => consentCall<{ redirect: string }>('/api/oauth/decide', input),
  connections: () => request<ConnectionsList>('GET', `/api/connections?t=${Date.now()}`),
  removeConnection: (id: string) => request<{ ok: boolean }>('DELETE', `/api/connections/${encodeURIComponent(id)}`),
  createKey: (input: { name: string; write: boolean }) => request<{ key: string; connection: ConnectionInfo }>('POST', '/api/connections/keys', input),
  authSetup: (input: { username: string; password: string; code?: string }) => authCall<{ token: string; username: string }>('POST', '/api/auth/setup', input),
  authLogin: (input: { username: string; password: string }) => authCall<{ token: string; username: string }>('POST', '/api/auth/login', input),
  authLogout: () => authCall<{ ok: boolean }>('POST', '/api/auth/logout', {}),
  authPassword: (input: { current: string; next: string }) => authCall<{ token: string }>('POST', '/api/auth/password', input),
  createVault: (sample: boolean) => request<{ exists: boolean }>('POST', '/api/vault/create', { sample }),
  graph: () => request<GraphData>('GET', '/api/graph'),
  node: (id: string) => request<NodeDetail>('GET', `/api/nodes/${encodeURIComponent(id)}`),
  updateNode: (id: string, patch: { frontmatter?: Record<string, unknown>; body?: string }) => request<NodeDetail>('PUT', `/api/nodes/${encodeURIComponent(id)}`, patch),
  createNode: (input: Record<string, unknown>) => request<NodeDetail>('POST', '/api/nodes', input),
  deleteNode: (id: string) => request<{ ok: boolean; commit: string | null }>('DELETE', `/api/nodes/${encodeURIComponent(id)}`),
  deleteCategory: (id: string, moveTo: string | null) => request<{ ok: boolean; moved: number; commit: string | null }>('POST', `/api/categories/${encodeURIComponent(id)}/delete`, { moveTo }),
  related: (id: string, limit = 8) => request<{ related: RelatedHit[] }>('GET', `/api/nodes/${encodeURIComponent(id)}/related?limit=${limit}`),
  dismissRelated: (id: string, targetId: string) => request<{ ok: boolean }>('POST', `/api/nodes/${encodeURIComponent(id)}/related/dismiss`, { targetId }),
  capture: (text: string) => request<{ node: { fm: { id: string } } }>('POST', '/api/capture', { text }),
  search: (q: string) => request<{ hits: SearchHit[] }>('GET', `/api/search?q=${encodeURIComponent(q)}`),
  index: async (type: string): Promise<string> => {
    const res = await fetch(`/api/index/${encodeURIComponent(type)}`, { headers: authHeaders() });
    if (res.status === 401) reportUnauthorized();
    if (!res.ok) throw new Error(`index ${type}: ${res.status}`);
    return res.text();
  },
  /** `place`: `desktop` when the server runs on the owner's own computer (its desktop apps' CLIs), `server` in a container. */
  engines: (force = false) => request<{ engines: EngineInfo[]; busy: boolean; place?: 'desktop' | 'server' }>('GET', `/api/engines${force ? '?force=1' : ''}`),
  signInStart: (id: string) => request<SignInState>('POST', `/api/engines/${encodeURIComponent(id)}/sign-in`),
  signInState: (id: string) => request<{ signIn: SignInState | null }>('GET', `/api/engines/${encodeURIComponent(id)}/sign-in?t=${Date.now()}`),
  signInCode: (id: string, code: string) => request<SignInState>('POST', `/api/engines/${encodeURIComponent(id)}/sign-in/code`, { code }),
  signInCancel: (id: string) => request<{ ok: boolean }>('DELETE', `/api/engines/${encodeURIComponent(id)}/sign-in`),
  signOut: (id: string) => request<{ probe: EngineInfo['probe'] }>('POST', `/api/engines/${encodeURIComponent(id)}/sign-out`),
  engineModels: (id: string) => request<{ models: Array<{ id: string; label: string }>; live: boolean }>('GET', `/api/engines/${encodeURIComponent(id)}/models`),
  run: (input: { prompt: string; mode: BrainMode; threadId?: string; engine?: string; model?: string; effort?: string; focusId?: string; view?: string; locale?: string; inboxPath?: string; display?: string; scope?: string }) =>
    request<RunStart>('POST', '/api/brain/run', input),
  /** The brain's memory files the UI shows (`profile`, `insights`); null when not written yet. */
  memory: async (name: 'profile' | 'insights' | 'focus'): Promise<string | null> => {
    const res = await fetch(`/api/memory/${name}`, { headers: authHeaders() });
    if (res.status === 401) reportUnauthorized();
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`memory ${name}: ${res.status}`);
    return res.text();
  },
  /** A category's or map's analysis: the file `/insight [[Place]] → <path>` writes, and its text (null until written). */
  placeAnalysis: (id: string) => request<{ path: string; text: string | null }>('GET', `/api/places/${encodeURIComponent(id)}/analysis`),
  cancel: (runId: string) => request<{ cancelled: boolean }>('POST', `/api/brain/cancel/${encodeURIComponent(runId)}`),
  queue: () => request<BrainQueue>('GET', '/api/brain/queue'),
  /** The server's side of Settings → Diagnostics. */
  diagnostics: () => request<ServerDiagnostics>('GET', `/api/diagnostics?t=${Date.now()}`),
  threads: () => request<{ threads: ThreadSummary[] }>('GET', '/api/threads'),
  thread: (id: string) => request<Thread>('GET', `/api/threads/${encodeURIComponent(id)}`),
  renameThread: (id: string, title: string) => request<{ id: string; title: string }>('PATCH', `/api/threads/${encodeURIComponent(id)}`, { title }),
  deleteThread: (id: string) => request<{ ok: boolean }>('DELETE', `/api/threads/${encodeURIComponent(id)}`),
  history: () => request<{ commits: Commit[] }>('GET', '/api/history'),
  undo: (commit: string) => request<{ ok: boolean; commit?: string }>('POST', `/api/history/undo/${encodeURIComponent(commit)}`),
  settings: () => request<Settings>('GET', '/api/settings'),
  putSettings: (patch: SettingsPatch) => request<Settings>('PUT', '/api/settings', patch),
  pairing: () => request<PairingInfo>('GET', '/api/pairing'),
  preview: (url: string) => request<LinkPreview>('GET', `/api/preview?url=${encodeURIComponent(url)}`),
  layout: () => request<SavedLayout>('GET', '/api/layout'),
  putLayout: (body: LayoutSave, opts?: { keepalive?: boolean | 'auto' }) => request<LayoutSaveAnswer>('PUT', '/api/layout', body, opts),
  /** Erases everything the user put in (Settings → Erase everything); `confirm` must be the word the dialog asked for. */
  eraseVault: (confirm: string) => request<{ ok: boolean }>('POST', '/api/vault/reset', { confirm }),
  /** Everything the owner put in, as a zip (docs/ARCHITECTURE.md "Backup"). */
  exportAll: () => download('/api/export'),
  drafts: () => request<{ drafts: Record<string, string> }>('GET', '/api/drafts'),
  saveDraft: (key: string, text: string) => request<{ ok: true }>('PUT', `/api/drafts/${encodeURIComponent(key)}`, { text }),
  /** `check`: only say what the file holds; otherwise it replaces everything here. */
  importAll: (file: Blob, check: boolean) => upload<ImportAnswer>(check ? '/api/import?check=1' : '/api/import', file),
  rotatePairing: () => request<{ token: string; createdAt: string }>('POST', '/api/pairing/rotate'),
};
