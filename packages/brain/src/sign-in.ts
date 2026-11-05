import type { SignInSpec } from './types';

/**
 * Reading a vendor CLI's own sign-in as it runs (docs/BRAIN-ENGINES.md "Sign-in from the app"): the link to the
 * vendor's page, a device code to type there, whether the CLI waits for a pasted code, and its last error. The
 * server runs the CLI; the CLI keeps whatever credentials come out of it.
 */
export interface SignInReading {
  url: string | null;
  code: string | null;
  needsPaste: boolean;
  error: string | null;
}

/** OSC 8 hyperlinks carry the whole link even when the visible text wraps. */
const OSC8_LINK = /\x1b\]8;[^;\x07\x1b]*;(https:\/\/[^\x07\x1b]+)(?:\x07|\x1b\\)/g;
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const ESC = /\x1b[@-Z\\-_]/g;

/** Terminal output as plain text: escape sequences removed, carriage returns turned into line breaks. */
export function plainTerminalText(raw: string): string {
  return raw.replace(OSC, '').replace(CSI, '').replace(ESC, '').replace(/\r\n?/g, '\n');
}

function onHost(url: string, hosts: string[]): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch { return false; }
}

/** Anything shaped like a key or a token is cut out of text the app shows. */
export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, '[redacted]');
}

const ERROR_LINE = /\b(error|failed|failure|invalid|denied|expired|unable|not supported|forbidden)\b/i;

/** What the CLI's sign-in has said so far. Only links to the vendor's own hosts are ever returned. */
export function readSignInOutput(raw: string, spec: SignInSpec): SignInReading {
  const text = plainTerminalText(raw);
  const linked = [...raw.matchAll(OSC8_LINK)].map((m) => m[1] ?? '');
  const visible = (text.match(/https:\/\/[^\s"'<>]+/g) ?? []).map((u) => u.replace(/[).,;:]+$/, ''));
  const url = [...linked, ...visible].find((u) => onHost(u, spec.hosts)) ?? null;
  let code: string | null = null;
  if (spec.flow === 'device-code') {
    const at = url ? text.indexOf(url) : -1;
    const after = at >= 0 ? text.slice(at + (url ?? '').length) : text;
    code = /\b([A-Z0-9]{4,8}-[A-Z0-9]{4,8})\b/.exec(after)?.[1] ?? null;
  }
  const needsPaste = spec.flow === 'paste-code' && /paste (the )?code/i.test(text);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const errorLine = [...lines].reverse().find((l) => ERROR_LINE.test(l)) ?? null;
  return { url, code, needsPaste, error: errorLine ? redactSecrets(errorLine).slice(0, 300) : null };
}

/** The last lines worth showing when a sign-in ends without success (no prompts, no links). */
export function lastSignInLines(raw: string, max = 2): string {
  const lines = plainTerminalText(raw).split('\n').map((l) => l.trim())
    .filter((l) => l && !/paste (the )?code|https:\/\//i.test(l));
  return redactSecrets(lines.slice(-max).join(' · ')).slice(0, 300);
}
