import { describe, expect, it } from 'vitest';
import { facetsOf, habitStats, kindFromUrl, platformOf } from '../src/facets';
import { healNode, parseNodeFile } from '../src/node';

const mk = (path: string, text: string) => healNode(parseNodeFile(path, text).node, { newId: () => 'id-1', now: () => '2026-10-31T10:00:00+03:30' }).node;

describe('facets', () => {
  it('detects platforms and kinds from URLs', () => {
    expect(platformOf('https://www.instagram.com/reel/Cx12/')).toBe('instagram');
    expect(kindFromUrl('https://www.instagram.com/reel/Cx12/')).toBe('reel');
    expect(kindFromUrl('https://youtu.be/abc')).toBe('video');
    expect(kindFromUrl('https://www.youtube.com/shorts/abc')).toBe('reel');
    expect(kindFromUrl('https://www.coursera.org/learn/rust')).toBe('course');
    expect(kindFromUrl('https://react.dev/learn/thinking-in-react')).toBe('article');
    expect(platformOf('not a url')).toBeNull();
  });

  it('counts a habit streak ending today or yesterday', () => {
    expect(habitStats(['2026-10-29', '2026-10-30', '2026-10-31'], '2026-10-31')).toEqual({ streak: 3, doneToday: true, total: 3 });
    expect(habitStats(['2026-10-28', '2026-10-29', '2026-10-30'], '2026-10-31')).toEqual({ streak: 3, doneToday: false, total: 3 });
    expect(habitStats(['2026-10-27', '2026-10-30'], '2026-10-31').streak).toBe(1);
    expect(habitStats(['nonsense'], '2026-10-31')).toEqual({ streak: 0, doneToday: false, total: 0 });
  });

  it('validates kind fields and fills derived ones', () => {
    const goal = mk('nodes/goals/run.md', '---\ntype: goal\ntitle: Run 10k\nsummary: by spring\ntarget: 2027-03-20\nprogress: 140\nwhy: health\n---\n');
    expect(facetsOf(goal.fm)).toEqual({ target: '2027-03-20', progress: 100, why: 'health' });
    const habit = mk('nodes/habits/med.md', '---\ntype: habit\ntitle: Meditate\nsummary: daily\ncadence: daily\ncheckins: [2026-10-30, oops, 2026-10-29]\n---\n');
    expect(facetsOf(habit.fm)).toEqual({ cadence: 'daily', checkins: ['2026-10-29', '2026-10-30'] });
    const reel = mk('nodes/resources/r.md', '---\ntype: resource\ntitle: Reel\nsummary: a reel\nurl: https://www.instagram.com/reel/Cx12/\n---\n');
    expect(facetsOf(reel.fm)).toMatchObject({ url: 'https://www.instagram.com/reel/Cx12/', platform: 'instagram', kind: 'reel' });
    const event = mk('nodes/events/e.md', '---\ntype: event\ntitle: Dinner\nsummary: mom\'s birthday\ndate: 2026-10-20\nmood: great\nplace: home\n---\n');
    expect(facetsOf(event.fm)).toEqual({ date: '2026-10-20', mood: 'great', place: 'home' });
    const badMood = mk('nodes/events/x.md', '---\ntype: event\ntitle: X\nsummary: x\nmood: ecstatic\n---\n');
    expect(facetsOf(badMood.fm)['mood']).toBeUndefined();
  });

  it('keeps kind fields through a parse → serialize round trip', () => {
    const habit = mk('nodes/habits/med.md', '---\ntype: habit\ntitle: Meditate\nsummary: daily\ncadence: daily\ntime: morning\ncheckins: ["2026-10-30"]\n---\nBody.\n');
    expect(habit.fm.extra['cadence']).toBe('daily');
    expect(habit.fm.type).toBe('habit');
    expect(habit.path).toBe('nodes/habits/med.md');
  });
});
