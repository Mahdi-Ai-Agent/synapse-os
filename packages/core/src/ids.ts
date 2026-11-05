import { ulid } from 'ulid';

export function newId(): string {
  return ulid();
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(s: unknown): s is string {
  return typeof s === 'string' && ULID_RE.test(s);
}

const UNSAFE = /[/\\:*?"<>|#^[\]%]/g;

/**
 * File-name slug per VAULT-SPEC: NFC, unsafe chars and whitespace → `-`, collapse, trim,
 * lowercase Latin, keep other scripts (Persian) as written, max 80 chars.
 */
export function slugify(title: string): string {
  let s = title.normalize('NFC').trim();
  s = s.replace(UNSAFE, '-');
  s = s.replace(/\s+/g, '-');
  s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
  s = s.replace(/[A-Z]/g, (c) => c.toLowerCase());
  if (s.length > 80) s = s.slice(0, 80).replace(/-$/, '');
  return s || 'untitled';
}
