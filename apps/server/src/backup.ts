import { promises as fs } from 'node:fs';
import path from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { nowIso } from '@synapse/core';
import type { VaultSettings } from '@synapse/vault-template';

/**
 * Export and import of everything the owner put in (docs/ARCHITECTURE.md "Backup"): one zip with the items and memory
 * as they are on disk, the chats, the map's layout, the dismissed suggestions and the owner's preferences in a manifest.
 * Never in it: API keys, the account and its sessions, the pairing token, connected apps, the vault's git history,
 * caches and the generated index.
 */

export const EXPORT_FORMAT = 'synapse-export';
export const EXPORT_VERSION = 1;
export const MANIFEST = 'synapse-export.json';

/** Folders taken whole; app files taken one by one (`.synapse/` holds secrets and caches too). */
const DATA_DIRS = ['nodes', 'memory'] as const;
export const APP_FILES = ['.synapse/sessions.json', '.synapse/layout.json', '.synapse/suggestions.json'] as const;
/** Limits for a file being imported: what it may unpack to, and how many entries. */
const MAX_UNPACKED = 512 * 1024 * 1024;
const MAX_ENTRIES = 50_000;

/** The owner's preferences that travel with the data; the machine's own (keys, LAN access, schedules) stay. */
export type PortableSettings = Pick<VaultSettings, 'locale' | 'graph' | 'engine' | 'model' | 'effort' | 'engines'>;

export interface ExportCounts { items: number; memory: number; chats: number }

export interface ExportManifest {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  counts: ExportCounts;
  settings: PortableSettings;
}

export class BackupError extends Error {}

async function walk(root: string, rel: string, out: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try { entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // .DS_Store and the like
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) await walk(root, child, out);
    else if (e.isFile()) out.push(child);
  }
}

function threadCount(raw: Uint8Array | undefined): number {
  if (!raw) return 0;
  try {
    const data = JSON.parse(strFromU8(raw)) as { threads?: unknown[] };
    return Array.isArray(data.threads) ? data.threads.length : 0;
  } catch { return 0; }
}

/** Everything the owner put in, as a zip (`synapse-export.json` first). */
export async function buildExport(root: string, settings: VaultSettings): Promise<{ zip: Uint8Array; manifest: ExportManifest }> {
  const files: Record<string, Uint8Array> = {};
  for (const dir of DATA_DIRS) {
    const list: string[] = [];
    await walk(root, dir, list);
    for (const rel of list.sort()) files[rel] = new Uint8Array(await fs.readFile(path.join(root, rel)));
  }
  for (const rel of APP_FILES) {
    try { files[rel] = new Uint8Array(await fs.readFile(path.join(root, rel))); } catch { /* not written yet */ }
  }
  const names = Object.keys(files);
  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: nowIso(),
    counts: {
      items: names.filter((n) => n.startsWith('nodes/') && n.endsWith('.md')).length,
      memory: names.filter((n) => n.startsWith('memory/')).length,
      chats: threadCount(files['.synapse/sessions.json']),
    },
    settings: { locale: settings.locale, graph: settings.graph, engine: settings.engine, model: settings.model, effort: settings.effort, engines: settings.engines },
  };
  const zippable: Zippable = { [MANIFEST]: strToU8(JSON.stringify(manifest, null, 2) + '\n') };
  for (const name of names) zippable[name] = files[name]!;
  return { zip: zipSync(zippable, { level: 6, mtime: new Date() }), manifest };
}

export interface ReadExport {
  manifest: ExportManifest;
  /** Vault-relative path → content, only paths an export may hold. */
  files: Map<string, Uint8Array>;
}

/** Where a zip entry may go: under `nodes/` or `memory/`, or one of the app files; never outside the vault. */
export function allowedPath(name: string): boolean {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/')) return false;
  const parts = name.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return false;
  if ((APP_FILES as readonly string[]).includes(name)) return true;
  return (DATA_DIRS as readonly string[]).includes(parts[0]!) && parts.length >= 2;
}

/** Opens an export: refuses anything that is not one (or unpacks too large); keeps only the paths an export holds. */
export function readExport(zip: Uint8Array): ReadExport {
  let total = 0;
  let count = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(zip, {
      filter: (f) => {
        count++;
        total += f.originalSize;
        if (count > MAX_ENTRIES || total > MAX_UNPACKED) throw new BackupError('the file is too large to be a Synapse export');
        return f.name === MANIFEST || (allowedPath(f.name) && !f.name.endsWith('/'));
      },
    });
  } catch (err) {
    if (err instanceof BackupError) throw err;
    throw new BackupError('this is not a zip file');
  }
  const head = raw[MANIFEST];
  if (!head) throw new BackupError('this zip is not a Synapse export (synapse-export.json is missing)');
  let manifest: ExportManifest;
  try { manifest = JSON.parse(strFromU8(head)) as ExportManifest; } catch { throw new BackupError('synapse-export.json cannot be read'); }
  if (manifest.format !== EXPORT_FORMAT) throw new BackupError('this zip is not a Synapse export');
  if (typeof manifest.version !== 'number' || manifest.version > EXPORT_VERSION) throw new BackupError('this export comes from a newer Synapse; update this one first');
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(raw)) if (name !== MANIFEST) files.set(name, data);
  for (const rel of APP_FILES) {
    const data = files.get(rel);
    if (!data) continue;
    try { JSON.parse(strFromU8(data)); } catch { throw new BackupError(`${rel} in the export cannot be read`); }
  }
  return { manifest, files };
}

/** What a file holds, for the confirmation before an import (and its answer afterwards). */
export function countsOf(read: ReadExport): ExportCounts {
  const names = [...read.files.keys()];
  return {
    items: names.filter((n) => n.startsWith('nodes/') && n.endsWith('.md')).length,
    memory: names.filter((n) => n.startsWith('memory/')).length,
    chats: threadCount(read.files.get('.synapse/sessions.json')),
  };
}

/**
 * The chats of an export without the engines' own session ids: those sessions live on the machine that made them, so
 * an old chat continued here starts a fresh one.
 */
export function portableSessions(raw: Uint8Array): string {
  const data = JSON.parse(strFromU8(raw)) as { threads?: Array<Record<string, unknown>> };
  const threads = (data.threads ?? []).map(({ engineSessionId: _drop, ...t }) => t);
  return JSON.stringify({ threads }, null, 2);
}

/**
 * Lays an export's files into the vault (the vault service has removed the old ones): items and memory as they were,
 * the chats without engine session ids, the dismissed suggestions. The layout goes through the layout store instead,
 * so its count of saves goes on and the open copies hear of it.
 */
export async function writeImport(root: string, read: ReadExport): Promise<void> {
  for (const [rel, data] of read.files) {
    if (rel === '.synapse/layout.json') continue;
    const target = path.join(root, ...rel.split('/'));
    if (!target.startsWith(path.join(root, path.sep)) && target !== root) throw new BackupError(`${rel} would land outside the vault`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, rel === '.synapse/sessions.json' ? portableSessions(data) : data);
  }
}

/** The layout of an export, for the layout store (`null` when the export has none). */
export function layoutOf(read: ReadExport): Record<string, unknown> | null {
  const data = read.files.get('.synapse/layout.json');
  if (!data) return null;
  const l = JSON.parse(strFromU8(data)) as Record<string, unknown>;
  return { anchors: l['anchors'] ?? {}, pins: l['pins'] ?? {}, positions: l['positions'] ?? {}, room: l['room'] ?? {}, settled: l['settled'] !== false };
}

/** Keeps a copy of what is here before an import replaces it, in `.synapse/backups/` (the last three). */
export async function keepSafetyCopy(root: string, zip: Uint8Array): Promise<string> {
  const dir = path.join(root, '.synapse', 'backups');
  await fs.mkdir(dir, { recursive: true });
  const name = `before-import-${nowIso().replace(/[:+]/g, '-')}.zip`;
  await fs.writeFile(path.join(dir, name), zip);
  const old = (await fs.readdir(dir)).filter((f) => f.startsWith('before-import-') && f.endsWith('.zip')).sort();
  for (const f of old.slice(0, Math.max(0, old.length - 3))) await fs.rm(path.join(dir, f), { force: true });
  return `.synapse/backups/${name}`;
}

/** The file name a download is offered under. */
export function exportFileName(exportedAt: string): string {
  return `synapse-${exportedAt.slice(0, 10)}.zip`;
}
