import { daysBetween } from './dates';
import { ARCHIVED_STATUSES, DONE_STATUSES } from './types';

/** How long finished work stays in the daily index and on its category before it retires to the archive. */
export const RETIRE_AFTER_DAYS = 30;

/**
 * Retired (VAULT-SPEC "Finished vs. archived"): archived or dropped, or done / achieved at least 30 days ago. A
 * retired node leaves the files the brain reads to work (it is listed in `index/archive.md`) and sits in the map's
 * archive corner, switched off; its file stays as it is. The web app mirrors this in `kinds/meta.ts` `isRetired`.
 */
export function isRetired(status: string, completed: string | null | undefined, today: string): boolean {
  if (ARCHIVED_STATUSES.has(status)) return true;
  return DONE_STATUSES.has(status) && Boolean(completed) && daysBetween(completed as string, today) >= RETIRE_AFTER_DAYS;
}
