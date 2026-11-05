import type { TKey } from '../i18n';
import { daysBetween } from '../lib/format';

/**
 * What each kind of thing is in the UI (spec: docs/UI-DESIGN.md "Kinds"): its everyday name, how it is added, its
 * statuses in plain words. The vault side of the same kinds is VAULT-SPEC "Kinds".
 */
export const ADDABLE_KINDS = ['idea', 'task', 'project', 'goal', 'habit', 'event', 'person', 'resource', 'note'] as const;
export type AddableKind = (typeof ADDABLE_KINDS)[number];

/** Order of kind sections inside a category. */
export const KIND_ORDER = ['goal', 'project', 'habit', 'task', 'idea', 'person', 'event', 'resource', 'note', 'journal', 'inbox', 'area', 'ghost'] as const;

/** States the user picks by hand, per kind (UI-DESIGN "Done and archived"); the other kinds only archive from the menu. */
export const STATUS_OPTIONS: Record<string, string[]> = {
  task: ['todo', 'doing', 'done', 'dropped'],
  project: ['active', 'paused', 'done', 'archived'],
  goal: ['active', 'achieved', 'paused', 'dropped'],
  habit: ['active', 'paused', 'archived'],
  resource: ['active', 'doing', 'done', 'archived'],
};

/** Finished: history that stays (faded on the map, under "Done"). */
export const DONE = new Set(['done', 'achieved']);
/** Out of the way: archived or dropped. */
export const ARCHIVED = new Set(['archived', 'dropped']);
/** How long finished work stays with its category before it retires (core `RETIRE_AFTER_DAYS`). */
export const RETIRE_AFTER_DAYS = 30;

/**
 * Retired (VAULT-SPEC "Finished vs. archived", mirroring core `isRetired`): archived or dropped, or done / achieved
 * 30+ days ago. It sits switched off in the map's archive corner and is left out of what needs you.
 */
export function isRetired(n: { status: string; completed?: string | null }, today: string): boolean {
  if (ARCHIVED.has(n.status)) return true;
  return DONE.has(n.status) && Boolean(n.completed) && daysBetween(n.completed as string, today) >= RETIRE_AFTER_DAYS;
}
/**
 * Where the map draws an item (UI-DESIGN "Done and archived"): finished work leaves its category for the archive corner
 * at once, so a category shows only what is still going on; the brain keeps it in its reading for 30 days (`isRetired`).
 */
export function inArchiveCorner(n: { status: string; completed?: string | null }, today: string): boolean {
  return isRetired(n, today) || DONE.has(n.status);
}

/** Kinds whose vocabulary has `archived` (VAULT-SPEC "Status"). */
export const ARCHIVABLE_KINDS: ReadonlySet<string> = new Set(['note', 'idea', 'project', 'habit', 'event', 'person', 'resource', 'area', 'map']);

/** Label key of a status for a kind (a resource's "active" reads "saved for later"). */
export function statusKey(type: string, status: string): TKey {
  if (type === 'resource') return `status.resource.${status}` as TKey;
  return `status.${status}` as TKey;
}

/** One line on what a state means for this kind (shown in the state menu). */
export function stateHintKey(type: string, status: string): TKey {
  if (type === 'resource') return `stateHint.resource.${status}` as TKey;
  return `stateHint.${status}` as TKey;
}

/** The state that finishes an item of this kind, and the one that opens it again. */
export function closeStatus(type: string): string {
  return type === 'goal' ? 'achieved' : type === 'task' || type === 'project' || type === 'resource' ? 'done' : 'archived';
}
export function openStatus(type: string): string {
  return type === 'task' ? 'todo' : 'active';
}

export const RESOURCE_KIND_KEYS = ['video', 'reel', 'course', 'article', 'book', 'podcast', 'tool', 'other'] as const;
export const MOODS = ['great', 'good', 'okay', 'low', 'bad'] as const;
export const MOOD_EMOJI: Record<string, string> = { great: '😄', good: '🙂', okay: '😐', low: '😔', bad: '😣' };
export const RELATIONS = ['friend', 'family', 'partner', 'colleague', 'client', 'mentor', 'doctor', 'other'] as const;

/** Label key of a person's relation, or null when the vault holds free text (shown as written). */
export function relationKey(r: string | undefined): TKey | null {
  return r && (RELATIONS as readonly string[]).includes(r) ? (`relation.${r}` as TKey) : null;
}
export const CADENCES = ['daily', 'weekdays', 'weekly', '3/week'] as const;
export const TIMES = ['morning', 'afternoon', 'evening', 'night'] as const;

/** Brand colour per platform (thumbnail placeholders and badges). */
export const PLATFORM_STYLE: Record<string, { label: string; from: string; to: string }> = {
  instagram: { label: 'Instagram', from: '#f58529', to: '#c13584' },
  youtube: { label: 'YouTube', from: '#ff3d3d', to: '#a50000' },
  aparat: { label: 'Aparat', from: '#ea1d5d', to: '#8e1239' },
  coursera: { label: 'Coursera', from: '#2a73cc', to: '#0b3a7a' },
  udemy: { label: 'Udemy', from: '#a435f0', to: '#5624d0' },
  maktabkhooneh: { label: 'Maktabkhooneh', from: '#14b8a6', to: '#0f766e' },
  x: { label: 'X', from: '#3a3a3a', to: '#0a0a0a' },
  github: { label: 'GitHub', from: '#4b5563', to: '#111827' },
  telegram: { label: 'Telegram', from: '#38bdf8', to: '#0369a1' },
  spotify: { label: 'Spotify', from: '#1ed760', to: '#0b7a35' },
  linkedin: { label: 'LinkedIn', from: '#2f80c4', to: '#0a3d6b' },
  medium: { label: 'Medium', from: '#555', to: '#111' },
  tiktok: { label: 'TikTok', from: '#25f4ee', to: '#fe2c55' },
  web: { label: 'Web', from: '#6d7cff', to: '#2b2f6b' },
};

/** Persian/English week-day initials for habit dots, Saturday first in fa and Monday first in en. */
export function weekdayInitial(date: string, locale: 'fa' | 'en'): string {
  const d = new Date(`${date}T12:00:00`);
  return new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', { weekday: 'narrow' }).format(d);
}

/** The last `n` local dates ending today, oldest first. */
export function lastDays(n: number, today: string): string[] {
  const out: string[] = [];
  const base = new Date(`${today}T12:00:00`);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}
