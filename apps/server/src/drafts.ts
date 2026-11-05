import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * What the owner was typing and has not sent (the chat box, the map's tell bar), kept in the vault's `.synapse/` so a
 * reload or the Mac app's lock does not lose it (docs/ARCHITECTURE.md "Drafts"). One short text per key.
 */
export const DRAFT_KEYS = ['chat', 'map'] as const;
export type DraftKey = (typeof DRAFT_KEYS)[number];
export const DRAFT_MAX = 20_000;

export class DraftsStore {
  private cache: Partial<Record<DraftKey, string>> | null = null;
  private writing: Promise<void> = Promise.resolve();
  constructor(private readonly root: string) {}
  private get file(): string { return path.join(this.root, '.synapse', 'drafts.json'); }

  async all(): Promise<Partial<Record<DraftKey, string>>> {
    if (this.cache) return this.cache;
    try { this.cache = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<Record<DraftKey, string>>; } catch { this.cache = {}; }
    return this.cache;
  }

  /** An empty text removes the draft. Writes go one after another, each replacing the file whole. */
  async set(key: DraftKey, text: string): Promise<void> {
    const all = { ...(await this.all()) };
    if (text.trim()) all[key] = text.slice(0, DRAFT_MAX); else delete all[key];
    this.cache = all;
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(`${this.file}.tmp`, JSON.stringify(all), 'utf8');
      await fs.rename(`${this.file}.tmp`, this.file);
    });
    await this.writing;
  }
}
