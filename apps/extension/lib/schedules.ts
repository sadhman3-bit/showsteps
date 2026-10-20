import {
  ScheduleSchema,
  activeApprovals,
  createId,
  guideSteps,
  guideVersion,
  missedRun,
  needsPerson,
  nextRun,
  parseSchedules,
  resolveValues,
  type Guide,
  type RunLog,
  type RunOutcome,
  type RunStepLog,
  type Schedule,
  type Zone,
} from '@showsteps/core';
import type { GuidanceState } from './guideMessages';

export const SCHEDULES_KEY = 'schedules';
export const SCHEDULE_STATE_KEY = 'scheduleState';
/** A busy browser (a recording or another guide running) is tried again every 2 minutes… */
export const BUSY_RETRY_MS = 2 * 60_000;
/** …for up to 30 minutes, then the run is skipped. */
export const BUSY_GIVE_UP_MS = 30 * 60_000;
/** The optional dry run happens this long before a run. */
export const CHECK_AHEAD_MS = 60 * 60_000;

/** Why an unattended run paused for the person. */
export type PauseReason = 'confirm' | 'manual' | 'sign-in' | 'not-found' | 'failed';

/** What the person is told (notifications, and the toolbar badge for stops and failures). */
export type Notice =
  | { kind: 'paused'; reason: PauseReason; scheduleId: string; name: string; step: number }
  | { kind: 'due'; scheduleId: string; name: string }
  | { kind: 'finished'; outcome: RunOutcome; scheduleId: string; name: string; reason?: string }
  | { kind: 'check-failed'; scheduleId: string; name: string; step: number };

interface Runtime {
  /** Due times up to here have been handled (run, skipped or missed). */
  accounted?: string;
  /** First try of a run that is waiting for the browser to be free. */
  retrySince?: string;
  /** A guide with desktop steps asked "Start now?" and waits for the person until then. */
  pendingUntil?: string;
}

interface ActiveRun {
  runId: string;
  scheduleId: string;
  guideId: string;
  windowId: number;
  /** Nobody started it: stops pause, notify and wait `waitMinutes`. */
  unattended: boolean;
  approved: string[];
  confirmIds: string[];
  stepIds: string[];
  /** Index of the first step not yet logged. */
  lastIndex: number;
  /** The stop being waited on, as `index:phase:reason`. */
  pauseKey?: string;
  pauseReason?: PauseReason;
  pausedIndex?: number;
  pausedPhase?: string;
}

interface State {
  runtime: Record<string, Runtime>;
  active?: ActiveRun;
  /** A run stopped or failed since the person last opened the Schedules page. */
  attention?: boolean;
}

/** The part of the run-log store the scheduler uses. */
export interface RunLogs {
  put(log: RunLog): Promise<void>;
  get(id: string): Promise<RunLog | undefined>;
  putShot(name: string, blob: Blob): Promise<void>;
  trim(scheduleId: string): Promise<void>;
  removeSchedule(scheduleId: string): Promise<void>;
}

export interface SchedulerDeps {
  now(): Date;
  zone?: Zone;
  storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
  getGuide(id: string): Promise<Guide | undefined>;
  alarms: {
    create(name: string, when: number): void;
    clear(name: string): Promise<unknown>;
    names(): Promise<string[]>;
  };
  /** A recording, Guide Me or Run for me is going. */
  busy(): boolean;
  /** A new window (normal, not focused, never minimised) with the run's first page loaded. */
  openWindow(url: string): Promise<{ windowId: number; tabId: number }>;
  startGuidance(run: {
    guideId: string;
    tabId: number;
    windowId: number;
    values: Record<string, string>;
    approved: string[];
    scheduleId: string;
  }): Promise<void>;
  stopGuidance(): Promise<void>;
  closeWindow(windowId: number): Promise<void>;
  /** A JPEG of the run window's visible tab (at most 1280 px wide), if it can be taken. */
  capture(windowId: number): Promise<Blob | undefined>;
  logs: RunLogs;
  notify(notice: Notice): void;
  /** The badge on the toolbar icon: `!` after a stopped or failed run. */
  attention(on: boolean): void;
  /** Dry-run a guide (U7) in a background window: the numbers of steps that weren't found. */
  selfCheck(guide: Guide): Promise<number[]>;
  /** The next due time changed (the desktop app can open Chrome for it). */
  nextDue?(at: Date | undefined): void;
  /** Schedules or run logs changed (open pages refresh). */
  changed?(): void;
}

const PAUSE_PHASES: Record<string, PauseReason | undefined> = {
  confirm: 'confirm',
  manual: 'manual',
  'not-found': 'not-found',
  failed: 'failed',
};

/**
 * Scheduled runs (S2): one alarm per schedule, catch-up after Chrome was closed, the rules for
 * unattended runs, and the run log. Schedules and logs stay in this browser profile.
 */
export class Scheduler {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: SchedulerDeps) {}

  /** Run one change at a time (alarms, guidance updates and page requests can overlap). */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  // ---------- Storage ----------

  async list(): Promise<Schedule[]> {
    return parseSchedules(await this.deps.storage.get(SCHEDULES_KEY));
  }

  private async write(schedules: Schedule[]): Promise<void> {
    await this.deps.storage.set(SCHEDULES_KEY, schedules);
  }

  private async state(): Promise<State> {
    const raw = (await this.deps.storage.get(SCHEDULE_STATE_KEY)) as State | undefined;
    return { runtime: {}, ...raw };
  }

  private async saveState(state: State): Promise<void> {
    await this.deps.storage.set(SCHEDULE_STATE_KEY, state);
  }

  private async runtime(id: string, patch: Partial<Runtime> | undefined): Promise<void> {
    const st = await this.state();
    st.runtime =
      patch === undefined
        ? Object.fromEntries(Object.entries(st.runtime).filter(([key]) => key !== id))
        : { ...st.runtime, [id]: { ...st.runtime[id], ...patch } };
    await this.saveState(st);
  }

  get now(): Date {
    return this.deps.now();
  }

  // ---------- Changing schedules ----------

  /** Save a new or changed schedule. Its guide version is stamped from the guide as it is now. */
  save(input: Schedule): Promise<Schedule> {
    return this.serial(async () => {
      const guide = await this.deps.getGuide(input.guideId);
      if (!guide) throw new Error('not-found');
      const schedule = ScheduleSchema.parse({ ...input, guideVersion: guideVersion(guide) });
      const all = await this.list();
      const isNew = !all.some((s) => s.id === schedule.id);
      await this.write([...all.filter((s) => s.id !== schedule.id), schedule]);
      if (isNew) await this.runtime(schedule.id, { accounted: this.now.toISOString() });
      await this.rebuild();
      return schedule;
    });
  }

  setEnabled(id: string, enabled: boolean): Promise<void> {
    return this.serial(async () => {
      const all = await this.list();
      await this.write(all.map((s) => (s.id === id ? { ...s, enabled } : s)));
      // Switching back on starts from now: runs due while it was off aren't caught up.
      if (enabled) await this.runtime(id, { accounted: this.now.toISOString() });
      await this.rebuild();
    });
  }

  remove(id: string): Promise<void> {
    return this.serial(async () => {
      await this.write((await this.list()).filter((s) => s.id !== id));
      await this.runtime(id, undefined);
      await this.deps.logs.removeSchedule(id);
      await this.rebuild();
    });
  }

  // ---------- Alarms ----------

  /** One alarm per schedule at its next run (and one an hour before, for the check). */
  async rebuild(): Promise<void> {
    for (const name of await this.deps.alarms.names())
      if (name.startsWith('schedule:') || name.startsWith('check:'))
        await this.deps.alarms.clear(name);
    let soonest: Date | undefined;
    const now = this.now;
    for (const s of await this.list()) {
      const at = nextRun(s, now, this.deps.zone);
      if (!at) continue;
      this.deps.alarms.create(`schedule:${s.id}`, at.getTime());
      if (s.checkFirst && at.getTime() - CHECK_AHEAD_MS > now.getTime())
        this.deps.alarms.create(`check:${s.id}`, at.getTime() - CHECK_AHEAD_MS);
      if (!soonest || at < soonest) soonest = at;
    }
    this.deps.nextDue?.(soonest);
    this.deps.changed?.();
  }

  /**
   * Chrome started or the extension was installed or updated (alarms are cleared then). A run
   * that was going when Chrome closed is logged as stopped; alarms are set again; and runs
   * missed meanwhile are caught up, at most one per schedule.
   */
  startup(): Promise<void> {
    return this.serial(async () => {
      const st = await this.state();
      if (st.active) {
        const active = st.active;
        delete st.active;
        await this.saveState(st);
        await this.finishLog(active, 'stopped', 'interrupted');
      }
      await this.rebuild();
      await this.catchUp();
    });
  }

  private async catchUp(): Promise<void> {
    const now = this.now;
    const st = await this.state();
    for (const s of await this.list()) {
      if (!s.enabled) continue;
      const since = new Date(st.runtime[s.id]?.accounted ?? s.createdAt);
      const missed = missedRun(s, since, now, this.deps.zone);
      if (!missed) continue;
      await this.runtime(s.id, { accounted: now.toISOString() });
      if (s.missedRun === 'run-at-start') await this.due(s, now);
      else await this.logOnly(s, 'missed', 'closed', missed);
    }
  }

  onAlarm(name: string): Promise<void> {
    return this.serial(async () => {
      const [kind, id = ''] = name.split(/:(.*)/s);
      if (kind === 'wait') return this.waitOver(id);
      const s = (await this.list()).find((x) => x.id === id);
      if (kind === 'pending') return this.pendingOver(id, s);
      if (!s?.enabled) return;
      switch (kind) {
        case 'schedule':
          await this.runtime(s.id, { accounted: this.now.toISOString() });
          await this.due(s, this.now);
          await this.rebuild();
          break;
        case 'retry':
          await this.tryStart(s);
          break;
        case 'check':
          await this.check(s);
          break;
      }
    });
  }

  // ---------- Due runs ----------

  private async due(s: Schedule, at: Date): Promise<void> {
    const guide = await this.deps.getGuide(s.guideId);
    if (!guide) return this.logOnly(s, 'failed', 'guide-missing', at);
    if (needsPerson(guide)) {
      // Desktop steps need someone at the PC: ask, and wait `waitMinutes` for them.
      const until = new Date(this.now.getTime() + s.waitMinutes * 60_000);
      await this.runtime(s.id, { pendingUntil: until.toISOString() });
      this.deps.alarms.create(`pending:${s.id}`, until.getTime());
      this.deps.notify({ kind: 'due', scheduleId: s.id, name: s.name });
      return;
    }
    await this.runtime(s.id, { retrySince: this.now.toISOString() });
    await this.tryStart(s);
  }

  /** Start now if the browser is free; else try again in 2 minutes, for up to 30. */
  private async tryStart(s: Schedule): Promise<void> {
    const st = await this.state();
    const since = new Date(st.runtime[s.id]?.retrySince ?? this.now.toISOString());
    if (this.deps.busy() || st.active) {
      if (this.now.getTime() - since.getTime() >= BUSY_GIVE_UP_MS) {
        await this.runtime(s.id, { retrySince: undefined });
        await this.logOnly(s, 'skipped', 'busy', since);
        return;
      }
      this.deps.alarms.create(`retry:${s.id}`, this.now.getTime() + BUSY_RETRY_MS);
      return;
    }
    await this.runtime(s.id, { retrySince: undefined });
    await this.begin(s, true);
  }

  /** "Start" on a "due" notification, or "Run now" on the Schedules page. */
  startNow(id: string): Promise<{ error?: string }> {
    return this.serial(async () => {
      const s = (await this.list()).find((x) => x.id === id);
      if (!s) return { error: 'not-found' };
      if (this.deps.busy() || (await this.state()).active) return { error: 'busy' };
      const st = await this.state();
      const pending = st.runtime[id]?.pendingUntil;
      if (pending) {
        await this.deps.alarms.clear(`pending:${id}`);
        await this.runtime(id, { pendingUntil: undefined });
      }
      const guide = await this.deps.getGuide(s.guideId);
      // Someone pressed the button, but a run without desktop steps still runs on its own.
      await this.begin(s, !guide || !needsPerson(guide));
      return {};
    });
  }

  private async pendingOver(id: string, s: Schedule | undefined): Promise<void> {
    const until = (await this.state()).runtime[id]?.pendingUntil;
    if (!until) return;
    await this.runtime(id, { pendingUntil: undefined });
    if (s) await this.logOnly(s, 'missed', 'not-started', new Date(until));
  }

  private async begin(s: Schedule, unattended: boolean): Promise<void> {
    const guide = await this.deps.getGuide(s.guideId);
    const runId = createId();
    const log: RunLog = {
      id: runId,
      scheduleId: s.id,
      guideId: s.guideId,
      startedAt: this.now.toISOString(),
      steps: [],
      values: {},
    };
    if (!guide) return this.close(log, 'failed', 'guide-missing');
    const steps = guideSteps(guide);
    const first = steps.find((x) => x.app.kind === 'web');
    if (!first || first.app.kind !== 'web') return this.close(log, 'failed', 'no-web-steps');
    try {
      log.values = resolveValues(s, guide, this.now, this.deps.zone);
    } catch {
      return this.close(log, 'failed', 'values');
    }
    await this.deps.logs.put(log);
    await this.deps.logs.trim(s.id);
    this.deps.changed?.();
    const approved = [...activeApprovals(s, guide)];
    let windowId: number | undefined;
    try {
      const opened = await this.deps.openWindow(first.app.url);
      windowId = opened.windowId;
      const st = await this.state();
      st.active = {
        runId,
        scheduleId: s.id,
        guideId: guide.id,
        windowId,
        unattended,
        approved,
        confirmIds: steps.filter((x) => x.agent.confirm).map((x) => x.id),
        stepIds: steps.map((x) => x.id),
        lastIndex: 0,
      };
      await this.saveState(st);
      await this.deps.startGuidance({
        guideId: guide.id,
        tabId: opened.tabId,
        windowId,
        values: log.values,
        approved,
        scheduleId: s.id,
      });
    } catch {
      const st = await this.state();
      delete st.active;
      await this.saveState(st);
      if (windowId !== undefined) await this.deps.closeWindow(windowId).catch(() => undefined);
      await this.close(log, 'failed', 'start');
    }
  }

  private async check(s: Schedule): Promise<void> {
    if (this.deps.busy() || (await this.state()).active) return;
    const guide = await this.deps.getGuide(s.guideId);
    if (!guide) return;
    const missing = await this.deps.selfCheck(guide).catch(() => []);
    if (missing[0] !== undefined)
      this.deps.notify({ kind: 'check-failed', scheduleId: s.id, name: s.name, step: missing[0] });
  }

  // ---------- Following a run ----------

  /** Every guidance broadcast: log steps as they finish, and handle stops. */
  onGuidance(g: GuidanceState): Promise<void> {
    return this.serial(async () => {
      const st = await this.state();
      const a = st.active;
      if (!a || g.scheduleId !== a.scheduleId) return;
      if (g.status === 'active') {
        if (g.index > a.lastIndex) await this.logSteps(a, g.index);
        const reason =
          g.phase === 'failed' && g.reason === 'sign-in' ? 'sign-in' : PAUSE_PHASES[g.phase];
        const key = reason ? `${g.index}:${g.phase}:${g.reason ?? ''}` : undefined;
        if (key && key !== a.pauseKey) {
          a.pauseKey = key;
          a.pauseReason = reason;
          a.pausedIndex = g.index;
          a.pausedPhase = g.phase;
          if (a.unattended) {
            const s = (await this.list()).find((x) => x.id === a.scheduleId);
            const wait = (s?.waitMinutes ?? 30) * 60_000;
            this.deps.alarms.create(`wait:${a.runId}`, this.now.getTime() + wait);
            this.deps.notify({
              kind: 'paused',
              reason: reason as PauseReason,
              scheduleId: a.scheduleId,
              name: s?.name ?? g.title ?? '',
              step: g.index + 1,
            });
          }
        } else if (!key && a.pauseKey && g.phase !== 'paused') {
          // The person dealt with it: the run goes on.
          delete a.pauseKey;
          delete a.pauseReason;
          delete a.pausedIndex;
          delete a.pausedPhase;
          await this.deps.alarms.clear(`wait:${a.runId}`);
        }
        st.active = a;
        await this.saveState(st);
        return;
      }
      if (g.status === 'done') {
        await this.logSteps(a, a.stepIds.length);
        await this.end(a, 'completed');
        // Leave the side panel ready for the person, not on "All steps done".
        await this.deps.stopGuidance();
        return;
      }
      // Stopped by the person, or its tab was closed.
      await this.end(a, 'stopped', a.pauseReason ?? 'stopped', false);
    });
  }

  /** Log steps up to (not including) `upTo`, with a screenshot of the page after the last. */
  private async logSteps(a: ActiveRun, upTo: number): Promise<void> {
    const log = await this.deps.logs.get(a.runId);
    if (!log) return;
    const at = this.now.toISOString();
    for (let i = a.lastIndex; i < Math.min(upTo, a.stepIds.length); i++) {
      const stepId = a.stepIds[i] ?? '';
      const stopped = a.pausedIndex === i;
      const status: RunStepLog['status'] =
        stopped && a.pausedPhase === 'confirm'
          ? 'confirmed'
          : stopped
            ? 'manual'
            : a.confirmIds.includes(stepId) && a.approved.includes(stepId)
              ? 'confirmed'
              : 'done';
      log.steps.push({ stepId, number: i + 1, status, at });
    }
    a.lastIndex = Math.max(a.lastIndex, Math.min(upTo, a.stepIds.length));
    const last = log.steps[log.steps.length - 1];
    if (last && !last.screenshot) {
      const shot = await this.deps.capture(a.windowId).catch(() => undefined);
      if (shot) {
        const name = `${a.runId}/${last.number}.jpg`;
        await this.deps.logs.putShot(name, shot);
        last.screenshot = name;
      }
    }
    await this.deps.logs.put(log);
    this.deps.changed?.();
  }

  /** The wait for the person ran out: end the run as stopped. */
  private async waitOver(runId: string): Promise<void> {
    const a = (await this.state()).active;
    if (!a || a.runId !== runId || !a.pauseKey) return;
    await this.end(a, 'stopped', a.pauseReason ?? 'stopped', true);
    await this.deps.stopGuidance();
  }

  private async end(
    a: ActiveRun,
    outcome: RunOutcome,
    reason?: string,
    closeWindow = true,
  ): Promise<void> {
    const st = await this.state();
    if (st.active?.runId === a.runId) delete st.active;
    await this.saveState(st);
    await this.deps.alarms.clear(`wait:${a.runId}`);
    // A stopped step is logged as the step the run stopped at.
    if (outcome !== 'completed' && a.pausedIndex !== undefined && a.pausedIndex >= a.lastIndex) {
      const log = await this.deps.logs.get(a.runId);
      if (log) {
        log.steps.push({
          stepId: a.stepIds[a.pausedIndex] ?? '',
          number: a.pausedIndex + 1,
          status:
            a.pauseReason === 'failed' || a.pauseReason === 'not-found' ? 'failed' : 'stopped',
          at: this.now.toISOString(),
        });
        const shot = await this.deps.capture(a.windowId).catch(() => undefined);
        if (shot) {
          const name = `${a.runId}/${a.pausedIndex + 1}-stop.jpg`;
          await this.deps.logs.putShot(name, shot);
          const last = log.steps[log.steps.length - 1];
          if (last) last.screenshot = name;
        }
        await this.deps.logs.put(log);
      }
    }
    await this.finishLog(a, outcome, reason);
    if (closeWindow) {
      const s = (await this.list()).find((x) => x.id === a.scheduleId);
      if (!s?.keepWindowOpen) await this.deps.closeWindow(a.windowId).catch(() => undefined);
    }
  }

  private async finishLog(a: ActiveRun, outcome: RunOutcome, reason?: string): Promise<void> {
    const log = await this.deps.logs.get(a.runId);
    if (!log) return;
    await this.close(log, outcome, reason);
  }

  /** Record how a run ended and tell the person. */
  private async close(log: RunLog, outcome: RunOutcome, reason?: string): Promise<void> {
    await this.deps.logs.put({
      ...log,
      finishedAt: this.now.toISOString(),
      outcome,
      ...(reason ? { reason } : {}),
    });
    await this.deps.logs.trim(log.scheduleId);
    this.deps.changed?.();
    const s = (await this.list()).find((x) => x.id === log.scheduleId);
    this.deps.notify({
      kind: 'finished',
      outcome,
      scheduleId: log.scheduleId,
      name: s?.name ?? '',
      ...(reason ? { reason } : {}),
    });
    if (outcome === 'stopped' || outcome === 'failed') {
      const st = await this.state();
      st.attention = true;
      await this.saveState(st);
      this.deps.attention(true);
    }
  }

  /** A run that never started (skipped, missed, or its guide is gone). */
  private async logOnly(s: Schedule, outcome: RunOutcome, reason: string, at: Date): Promise<void> {
    const log: RunLog = {
      id: createId(),
      scheduleId: s.id,
      guideId: s.guideId,
      startedAt: at.toISOString(),
      steps: [],
      values: {},
    };
    await this.close(log, outcome, reason);
  }

  // ---------- For the pages ----------

  /** The window of the run going now (notifications bring it to the front). */
  async runWindow(): Promise<number | undefined> {
    return (await this.state()).active?.windowId;
  }

  async activeScheduleId(): Promise<string | undefined> {
    return (await this.state()).active?.scheduleId;
  }

  /** The Schedules page was opened: clear the badge. */
  async seen(): Promise<void> {
    const st = await this.state();
    st.attention = false;
    await this.saveState(st);
    this.deps.attention(false);
  }

  async needsAttention(): Promise<boolean> {
    return (await this.state()).attention === true;
  }
}
