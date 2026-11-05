/**
 * Client side of the pairing model (docs/ARCHITECTURE.md "Access control"): the token arrives once as
 * `#pair=<token>` (QR code or the installed app's start URL), lives in localStorage, and goes out as a bearer
 * header on every API call and as `?token=` on the WebSocket URL. Loopback clients never need one.
 */
const KEY = 'synapse.pairToken';
const TOKEN_RE = /^[A-Za-z0-9_-]{32,}$/;

let token: string | null = null;
let unauthorizedListeners: Array<() => void> = [];

function readStorage(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

function writeStorage(value: string | null): void {
  try { if (value) localStorage.setItem(KEY, value); else localStorage.removeItem(KEY); } catch { /* private mode: in-memory only */ }
}

/** `#pair=<token>` or a full pair URL pasted by hand → the token, or null. */
export function extractToken(input: string): string | null {
  const text = input.trim();
  if (TOKEN_RE.test(text)) return text;
  const m = /#pair=([A-Za-z0-9_-]{32,})/.exec(text);
  return m?.[1] ?? null;
}

/** Runs once at startup: adopts a token from the URL fragment (then strips it) or from storage. */
export function initPairing(): void {
  const fromHash = extractToken(location.hash);
  if (fromHash) {
    token = fromHash;
    writeStorage(fromHash);
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    token = readStorage();
  }
  installManifestLink();
  // A pair link opened while the app (or the pairing screen) is already showing is a same-document navigation:
  // adopt the new token and start clean instead of waiting for a reload that never comes.
  window.addEventListener('hashchange', () => {
    const next = extractToken(location.hash);
    if (!next) return;
    setPairToken(next);
    location.replace(location.pathname + location.search);
  });
}

export function getPairToken(): string | null {
  return token;
}

export function setPairToken(value: string | null): void {
  token = value;
  writeStorage(value);
  installManifestLink();
}

export function isLoopbackOrigin(): boolean {
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
}

export function authHeaders(): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

export function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/**
 * The manifest link is added by script so a paired client asks for `?token=`: the server then puts the token in
 * `start_url`, and a home-screen app (separate storage on iOS) pairs itself on first launch.
 */
export function installManifestLink(): void {
  const href = token && !isLoopbackOrigin() ? `/manifest.webmanifest?token=${encodeURIComponent(token)}` : '/manifest.webmanifest';
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) { link = document.createElement('link'); link.rel = 'manifest'; document.head.append(link); }
  if (link.getAttribute('href') !== href) link.href = href;
}

export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.push(listener);
  return () => { unauthorizedListeners = unauthorizedListeners.filter((l) => l !== listener); };
}

/** Called by the API layer on a 401: the app swaps to the pairing screen instead of showing broken views. */
export function reportUnauthorized(): void {
  for (const l of unauthorizedListeners) l();
}
