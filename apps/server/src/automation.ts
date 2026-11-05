import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BrainEngine, EngineId } from '@synapse/brain';
import type { VaultSettings } from '@synapse/vault-template';
import type { BrainRunner } from './brain-runner';
import type { SettingsStore } from './settings';

/** The runs that start on their own: the full review, the daily plan and the weekly review. */
export type ScheduledMode = 'review' | 'daily' | 'weekly';

/** The local date each scheduled run last ran on (`.synapse/automation.json`). */
export type AutomationState = Partial<Record<ScheduledMode, string>>;

const pad = (n: number): string => String(n).padStart(2, '0');
export const localDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayDiff = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * A once-a-day run is due when it has not run today and its time has come, or when a day was missed — it last ran
 * before yesterday (the Mac was off, the app closed at the hour) — so the first start makes up for it, once.
 */
function dailyDue(time: string | null | undefined, last: string | undefined, today: string, hhmm: string): boolean {
  if (!time || last === today) return false;
  if (hhmm >= time) return true;
  return last !== undefined && dayDiff(last, today) >= 2;
}

/** The weekly review is due on its day from its time on, or as soon as possible after a missed one. */
function weeklyDue(slot: { day: number; time: string } | null | undefined, last: string | undefined, now: Date, today: string, hhmm: string): boolean {
  if (!slot || last === today) return false;
  const back = (now.getDay() - slot.day + 7) % 7 || (hhmm >= slot.time ? 0 : 7);
  const lastSlot = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back));
  if (lastSlot === today) return true;
  return last !== undefined && dayDiff(last, lastSlot) > 0;
}

/**
 * Which scheduled runs are due at `now` (spec: docs/ARCHITECTURE.md "Automation"): each at most once a day, a missed
 * one made up for on the next start; the full review first, so the daily plan reads the focus it writes.
 */
export function dueRuns(automation: VaultSettings['automation'], state: AutomationState, now: Date): ScheduledMode[] {
  const today = localDate(now);
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const out: ScheduledMode[] = [];
  if (dailyDue(automation.review, state.review, today, hhmm)) out.push('review');
  if (dailyDue(automation.daily, state.daily, today, hhmm)) out.push('daily');
  if (weeklyDue(automation.weekly, state.weekly, now, today, hhmm)) out.push('weekly');
  return out;
}

const LABELS: Record<ScheduledMode, { fa: string; en: string }> = {
  review: { fa: 'بازبینی کامل', en: 'Full review' },
  daily: { fa: 'مرور روزانه', en: 'Daily review' },
  weekly: { fa: 'مرور هفتگی', en: 'Weekly review' },
};

/** Starts the daily and weekly reviews on their own at the times set in Settings, when the brain is ready. */
export class Automation {
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  /** Scheduled runs on their way: run id → its mode, the day it was recorded for and the day before that. */
  private readonly started = new Map<string, { mode: ScheduledMode; day: string; previous?: string }>();

  constructor(
    private readonly root: string,
    private readonly settings: SettingsStore,
    private readonly runner: BrainRunner,
    private readonly engines: Map<EngineId, BrainEngine>,
    private readonly log: (msg: string, data?: Record<string, unknown>) => void,
  ) {}

  private get file(): string {
    return path.join(this.root, '.synapse', 'automation.json');
  }

  /** `firstDelayMs`: the first check waits this long (the Mac app: a quick look after unlocking queues nothing). */
  start(firstDelayMs = 0): void {
    if (this.timer) return;
    const tick = (): void => { void this.tick().catch((err: unknown) => this.log('automation tick failed', { err: String(err) })); };
    this.timer = setInterval(tick, 60_000);
    this.timer.unref();
    this.runner.on('done', this.onDone);
    if (firstDelayMs > 0) { this.first = setTimeout(tick, firstDelayMs); this.first.unref(); } else tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.first) clearTimeout(this.first);
    this.timer = null;
    this.first = null;
    this.runner.off('done', this.onDone);
  }

  /** A scheduled run that was cancelled (the app locked or quit mid-run) is tried again at the next check. */
  private readonly onDone = (p: { runId?: string; ok?: boolean; error?: string }): void => {
    const job = p.runId ? this.started.get(p.runId) : undefined;
    if (!job || !p.runId) return;
    this.started.delete(p.runId);
    if (p.ok || p.error !== 'cancelled') return;
    void this.readState().then((state) => {
      if (state[job.mode] !== job.day) return;
      if (job.previous === undefined) delete state[job.mode]; else state[job.mode] = job.previous;
      this.log('scheduled review interrupted: it runs again at the next check', { mode: job.mode });
      return this.writeState(state);
    }).catch((err: unknown) => this.log('automation state failed', { err: String(err) }));
  };

  async tick(now = new Date()): Promise<ScheduledMode[]> {
    const settings = await this.settings.get();
    const state = await this.readState();
    const due = dueRuns(settings.automation, state, now);
    if (!due.length) return [];
    const engine = this.engines.get(settings.engine as EngineId);
    const probe = engine ? await engine.probe() : null;
    const ready = Boolean(probe?.installed && probe?.loggedIn);
    const started: ScheduledMode[] = [];
    for (const mode of due) {
      const previous = state[mode];
      state[mode] = localDate(now); // one attempt per day, ready or not: a brain that is not signed in must not be retried every minute
      if (!ready) { this.log('scheduled review skipped: the brain is not ready', { mode, engine: settings.engine }); continue; }
      const display = LABELS[mode][settings.locale === 'en' ? 'en' : 'fa'];
      const run = await this.runner.start({ prompt: display, mode, display, locale: settings.locale, view: 'coach' });
      this.started.set(run.runId, { mode, day: state[mode], ...(previous !== undefined ? { previous } : {}) });
      started.push(mode);
      this.log('scheduled review started', { mode });
    }
    await this.writeState(state);
    return started;
  }

  private async readState(): Promise<AutomationState> {
    try { return JSON.parse(await fs.readFile(this.file, 'utf8')) as AutomationState; } catch { return {}; }
  }

  private async writeState(state: AutomationState): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(state, null, 2), 'utf8');
  }
}
