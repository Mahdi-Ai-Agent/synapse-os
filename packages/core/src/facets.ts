import type { NodeFacets, NodeFrontmatter, NodeType } from './types';

/**
 * Kind-specific fields (VAULT-SPEC "Kinds"). They live in the frontmatter as ordinary keys (kept verbatim in
 * `extra`), so the files stay plain Markdown; this module validates them for the UI and fills derived values
 * (a link's platform and kind from its URL, a habit's streak).
 */

export const MOODS = ['great', 'good', 'okay', 'low', 'bad'] as const;
export const RESOURCE_KINDS = ['video', 'reel', 'course', 'article', 'book', 'podcast', 'tool', 'other'] as const;
/** The mark at the centre of a map's island (VAULT-SPEC "Maps"); a character map defaults to `person`, any other map to `star`. */
export const MAP_SYMBOLS = ['person', 'star', 'briefcase', 'store', 'camera', 'globe', 'book', 'heart', 'music', 'code'] as const;
export type MapSymbol = (typeof MAP_SYMBOLS)[number];

export function mapSymbol(role: 'character' | null, raw: unknown): MapSymbol {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return (MAP_SYMBOLS as readonly string[]).includes(s) ? (s as MapSymbol) : role === 'character' ? 'person' : 'star';
}

/** A map's switch (VAULT-SPEC "Maps"): `apart: true` while the user has switched its island off. */
export function mapApart(raw: unknown): boolean {
  return raw === true || (typeof raw === 'string' && raw.trim().toLowerCase() === 'true');
}

/** Frontmatter keys each kind may carry beyond the common fields. */
export const FACET_KEYS: Partial<Record<NodeType, readonly string[]>> = {
  goal: ['target', 'progress', 'why'],
  habit: ['cadence', 'time', 'checkins'],
  event: ['place', 'mood'],
  person: ['birthday', 'contact', 'met'],
  resource: ['kind', 'platform', 'image', 'duration', 'creator'],
  journal: ['mood'],
  map: ['role', 'symbol', 'apart'],
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLATFORMS: Array<[RegExp, string]> = [
  [/(^|\.)instagram\.com$/, 'instagram'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'], [/(^|\.)aparat\.com$/, 'aparat'],
  [/(^|\.)coursera\.org$/, 'coursera'], [/(^|\.)udemy\.com$/, 'udemy'], [/(^|\.)maktabkhooneh\.org$/, 'maktabkhooneh'],
  [/(^|\.)(x\.com|twitter\.com)$/, 'x'], [/(^|\.)github\.com$/, 'github'], [/(^|\.)(t\.me|telegram\.me)$/, 'telegram'],
  [/(^|\.)spotify\.com$/, 'spotify'], [/(^|\.)linkedin\.com$/, 'linkedin'], [/(^|\.)medium\.com$/, 'medium'], [/(^|\.)tiktok\.com$/, 'tiktok'],
];

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

/** Platform of a URL by its host (`web` for anything else); null for a malformed URL. */
export function platformOf(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  return PLATFORMS.find(([re]) => re.test(host))?.[1] ?? 'web';
}

/** Best guess at what a link is, when the frontmatter does not say. */
export function kindFromUrl(url: string): string {
  const platform = platformOf(url);
  if (platform === 'instagram' || platform === 'tiktok') return /\/(reel|reels|p)\//.test(url) || platform === 'tiktok' ? 'reel' : 'other';
  if (platform === 'youtube' || platform === 'aparat') return /\/shorts\//.test(url) ? 'reel' : 'video';
  if (platform === 'coursera' || platform === 'udemy' || platform === 'maktabkhooneh') return 'course';
  if (platform === 'spotify') return 'podcast';
  if (platform === 'github') return 'tool';
  return 'article';
}

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s ? s : undefined;
}

/** Habit progress from its check-in dates: the current streak (ending today or yesterday) and whether today is done. */
export function habitStats(checkins: readonly string[], today: string): { streak: number; doneToday: boolean; total: number } {
  const days = new Set(checkins.filter((d) => DATE.test(d)));
  const step = (d: string, n: number): string => {
    const t = new Date(`${d}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };
  const doneToday = days.has(today);
  let cursor = doneToday ? today : step(today, -1);
  let streak = 0;
  while (days.has(cursor)) { streak++; cursor = step(cursor, -1); }
  return { streak, doneToday, total: days.size };
}

/** Validated kind fields of a node plus the common fields cards need (`url`, `relation`, `date`). */
export function facetsOf(fm: NodeFrontmatter): NodeFacets {
  const out: NodeFacets = {};
  const x = fm.extra;
  switch (fm.type) {
    case 'goal': {
      const target = str(x['target']); if (target && DATE.test(target)) out['target'] = target;
      const p = Number(x['progress']); if (x['progress'] !== undefined && Number.isFinite(p)) out['progress'] = Math.max(0, Math.min(100, Math.round(p)));
      const why = str(x['why']); if (why) out['why'] = why;
      break;
    }
    case 'habit': {
      const cadence = str(x['cadence']); if (cadence) out['cadence'] = cadence;
      const time = str(x['time']); if (time) out['time'] = time;
      const raw = Array.isArray(x['checkins']) ? x['checkins'] : x['checkins'] !== undefined ? [x['checkins']] : [];
      const checkins = raw.map(str).filter((d): d is string => Boolean(d && DATE.test(d))).sort();
      out['checkins'] = checkins.slice(-120);
      break;
    }
    case 'event': {
      if (fm.date) out['date'] = fm.date;
      const place = str(x['place']); if (place) out['place'] = place;
      const mood = str(x['mood']); if (mood && (MOODS as readonly string[]).includes(mood)) out['mood'] = mood;
      break;
    }
    case 'journal': {
      if (fm.date) out['date'] = fm.date;
      const mood = str(x['mood']); if (mood && (MOODS as readonly string[]).includes(mood)) out['mood'] = mood;
      break;
    }
    case 'person': {
      if (fm.relation) out['relation'] = fm.relation;
      for (const k of ['birthday', 'contact', 'met']) { const v = str(x[k]); if (v) out[k] = v; }
      break;
    }
    case 'map': {
      // The one map the brain writes about the owner (VAULT-SPEC "Maps"); any other value is a custom map.
      const role = str(x['role']) === 'character' ? 'character' : null;
      if (role) out['role'] = role;
      out['symbol'] = mapSymbol(role, x['symbol']);
      break;
    }
    case 'resource': {
      if (fm.url) out['url'] = fm.url;
      const platform = str(x['platform']) ?? (fm.url ? platformOf(fm.url) ?? undefined : undefined); if (platform) out['platform'] = platform;
      const kind = str(x['kind']);
      out['kind'] = kind && (RESOURCE_KINDS as readonly string[]).includes(kind) ? kind : fm.url ? kindFromUrl(fm.url) : 'other';
      for (const k of ['image', 'duration', 'creator']) { const v = str(x[k]); if (v) out[k] = v; }
      break;
    }
    default:
      if (fm.url) out['url'] = fm.url;
  }
  return out;
}
