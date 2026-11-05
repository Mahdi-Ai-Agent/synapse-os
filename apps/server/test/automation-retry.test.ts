import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BrainEngine, EngineId } from '@synapse/brain';
import { Automation, localDate } from '../src/automation';
import type { BrainRunner } from '../src/brain-runner';
import type { SettingsStore } from '../src/settings';

/** A runner that only records starts and lets the test end them (the Mac app locking mid-run). */
class FakeRunner extends EventEmitter {
  starts: string[] = [];
  async start(input: { mode: string }): Promise<{ runId: string; threadId: string; queued: boolean; position: number }> {
    const runId = `run-${this.starts.length}`;
    this.starts.push(input.mode);
    return { runId, threadId: 't', queued: false, position: 0 };
  }
}

describe('scheduled reviews that get interrupted', () => {
  it('are tried again at the next check when cancelled, and kept as done when they finish', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-automation-'));
    try {
      const settings = { get: async () => ({ engine: 'claude-cli', locale: 'fa', automation: { review: '06:00', daily: null, weekly: null } }) } as unknown as SettingsStore;
      const engine = { probe: async () => ({ installed: true, loggedIn: true }) } as unknown as BrainEngine;
      const runner = new FakeRunner();
      const auto = new Automation(root, settings, runner as unknown as BrainRunner, new Map<EngineId, BrainEngine>([['claude-cli', engine]]), () => undefined);
      auto.start(60_000); // listens for run ends; the first check is ours
      const morning = new Date(); morning.setHours(9, 0, 0, 0);
      expect(await auto.tick(morning)).toEqual(['review']);
      expect(await auto.tick(morning)).toEqual([]); // recorded for today while it runs
      runner.emit('done', { runId: 'run-0', ok: false, error: 'cancelled' });
      await new Promise((r) => setTimeout(r, 50));
      expect(await auto.tick(morning)).toEqual(['review']); // the lock cut it: it runs again
      runner.emit('done', { runId: 'run-1', ok: true });
      await new Promise((r) => setTimeout(r, 50));
      expect(await auto.tick(morning)).toEqual([]);
      const state = JSON.parse(await fs.readFile(path.join(root, '.synapse', 'automation.json'), 'utf8')) as Record<string, string>;
      expect(state['review']).toBe(localDate(morning));
      auto.stop();
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});
