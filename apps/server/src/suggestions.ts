import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nowIso } from '@synapse/core';

interface DismissedPair { a: string; b: string; at: string }
interface SuggestionsFile { dismissed: DismissedPair[] }

/** Related-node suggestions the user dismissed, kept in `<vault>/.synapse/suggestions.json` as unordered id pairs. */
export class SuggestionsStore {
  private cache: SuggestionsFile | null = null;
  constructor(private readonly root: string) {}

  private get file(): string {
    return path.join(this.root, '.synapse', 'suggestions.json');
  }

  private async load(): Promise<SuggestionsFile> {
    if (this.cache) return this.cache;
    let data: SuggestionsFile = { dismissed: [] };
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<SuggestionsFile>;
      if (Array.isArray(raw.dismissed)) data = { dismissed: raw.dismissed.filter((p) => typeof p.a === 'string' && typeof p.b === 'string') };
    } catch { /* fresh */ }
    this.cache = data;
    return data;
  }

  /** Reads the file again on next use (an import replaced it). */
  forget(): void {
    this.cache = null;
  }

  /** Ids whose pairing with `id` was dismissed. */
  async dismissedFor(id: string): Promise<Set<string>> {
    const { dismissed } = await this.load();
    const out = new Set<string>();
    for (const p of dismissed) {
      if (p.a === id) out.add(p.b);
      else if (p.b === id) out.add(p.a);
    }
    return out;
  }

  async dismiss(id: string, otherId: string): Promise<void> {
    const data = await this.load();
    const [a, b] = id < otherId ? [id, otherId] : [otherId, id];
    if (data.dismissed.some((p) => p.a === a && p.b === b)) return;
    data.dismissed.push({ a, b, at: nowIso() });
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  }
}
