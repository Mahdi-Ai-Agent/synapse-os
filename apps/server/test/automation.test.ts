import { describe, expect, it } from 'vitest';
import { dueRuns, localDate } from '../src/automation';

const at = (iso: string): Date => new Date(iso);

describe('scheduled reviews', () => {
  it('runs the daily review from its time on, once a day', () => {
    const automation = { review: null, daily: '08:00', weekly: null };
    expect(dueRuns(automation, {}, at('2026-10-31T07:59:00'))).toEqual([]);
    expect(dueRuns(automation, {}, at('2026-10-31T08:00:00'))).toEqual(['daily']);
    expect(dueRuns(automation, {}, at('2026-10-31T13:45:00'))).toEqual(['daily']);
    expect(dueRuns(automation, { daily: '2026-10-31' }, at('2026-10-31T13:45:00'))).toEqual([]);
    expect(dueRuns(automation, { daily: '2026-10-30' }, at('2026-10-31T13:45:00'))).toEqual(['daily']);
  });

  it('runs the weekly review on its weekday only', () => {
    const saturday = at('2026-10-31T18:30:00'); // 2026-10-31 is a Saturday
    expect(saturday.getDay()).toBe(6);
    const automation = { review: null, daily: null, weekly: { day: 6, time: '18:00' } };
    expect(dueRuns(automation, {}, saturday)).toEqual(['weekly']);
    expect(dueRuns(automation, {}, at('2026-10-30T18:30:00'))).toEqual([]);
    expect(dueRuns(automation, { weekly: localDate(saturday) }, saturday)).toEqual([]);
  });

  it('stays quiet when nothing is scheduled', () => {
    expect(dueRuns({ review: null, daily: null, weekly: null }, {}, at('2026-10-31T09:00:00'))).toEqual([]);
  });

  it('makes up for a missed day at the first start, once, before the hour comes', () => {
    const automation = { review: '09:00', daily: '08:00', weekly: null };
    // Off for four days, opened at 07:00: both missed runs go now, the full review first.
    expect(dueRuns(automation, { review: '2026-10-27', daily: '2026-10-27' }, at('2026-10-31T07:00:00'))).toEqual(['review', 'daily']);
    // They ran at 07:00; at the hour the same day nothing runs again.
    expect(dueRuns(automation, { review: '2026-10-31', daily: '2026-10-31' }, at('2026-10-31T09:30:00'))).toEqual([]);
    // On every day it ran yesterday: today's hour is awaited.
    expect(dueRuns(automation, { review: '2026-10-30', daily: '2026-10-30' }, at('2026-10-31T07:00:00'))).toEqual([]);
    expect(dueRuns(automation, { review: '2026-10-30', daily: '2026-10-30' }, at('2026-10-31T09:00:00'))).toEqual(['review', 'daily']);
    // Just switched on, never run: it waits for its hour.
    expect(dueRuns(automation, {}, at('2026-10-31T07:00:00'))).toEqual([]);
  });

  it('makes up for a missed weekly review on the next start, and only once', () => {
    const automation = { review: null, daily: null, weekly: { day: 6, time: '18:00' } };
    const monday = at('2026-11-02T10:00:00');
    expect(monday.getDay()).toBe(1);
    expect(dueRuns(automation, { weekly: '2026-10-24' }, monday)).toEqual(['weekly']);
    expect(dueRuns(automation, { weekly: '2026-10-31' }, monday)).toEqual([]);
    expect(dueRuns(automation, { weekly: '2026-11-02' }, monday)).toEqual([]);
    // The day itself before the hour: last week's ran, so it waits.
    expect(dueRuns(automation, { weekly: '2026-10-24' }, at('2026-10-31T09:00:00'))).toEqual([]);
    expect(dueRuns(automation, { weekly: '2026-10-17' }, at('2026-10-31T09:00:00'))).toEqual(['weekly']);
  });
});
