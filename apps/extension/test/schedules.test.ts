import { IDBFactory } from 'fake-indexeddb';
import {
  createGuide,
  createSchedule,
  createStep,
  plain,
  withApprovals,
  zone,
  type Guide,
  type Schedule,
  type Step,
} from '@showsteps/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GUIDANCE_IDLE, type GuidanceState } from '../lib/guideMessages';
import { RunLogStore } from '../lib/runlogs';
import {
  BUSY_GIVE_UP_MS,
  BUSY_RETRY_MS,
  CHECK_AHEAD_MS,
  Scheduler,
  type Notice,
} from '../lib/schedules';

const SYD = zone('Australia/Sydney');
const PAGE = 'http://localhost:5173/app/';
const web = { kind: 'web' as const, url: PAGE };
const target = (name: string) => ({
  role: 'button',
  name,
  selectors: [],
  bbox: { x: 0, y: 0, w: 10, h: 10 },
  point: { x: 5, y: 5 },
});

function makeGuide(extra: Step[] = []): Guide {
  return {
    ...createGuide({ id: 'g1', title: 'Create an invoice' }),
    blocks: [
      createStep({ id: 's1', action: 'click', app: web, target: target('New invoice') }),
      createStep({
        id: 's2',
        action: 'type',
        app: web,
        target: target('Supplier'),
        input: { mode: 'ask', sensitive: false },
        human: { title: plain('Type the supplier') },
      }),
      createStep({
        id: 's3',
        action: 'click',
        app: web,
        target: target('Submit invoice'),
        agent: { confirm: true },
      }),
      ...extra,
    ],
  };
}

function harness(guide = makeGuide()) {
  const storage = new Map<string, unknown>();
  const alarms = new Map<string, number>();
  const notices: Notice[] = [];
  const started: { approved: string[]; values: Record<string, string> }[] = [];
  const closed: number[] = [];
  let busy = false;
  let guides: Record<string, Guide> = { [guide.id]: guide };
  let attention = false;
  let stops = 0;
  /** While set, taking a screenshot waits for it (to hold a run mid-update). */
  let gate: Promise<void> | undefined;
  const logs = new RunLogStore(new IDBFactory());
  const scheduler = new Scheduler({
    now: () => new Date(),
    zone: SYD,
    storage: {
      get: async (k) => structuredClone(storage.get(k)),
      set: async (k, v) => void storage.set(k, structuredClone(v)),
    },
    getGuide: async (id) => guides[id],
    alarms: {
      create: (name, when) => void alarms.set(name, when),
      clear: async (name) => alarms.delete(name),
      names: async () => [...alarms.keys()],
    },
    busy: () => busy,
    openWindow: async () => ({ windowId: 7, tabId: 70 }),
    startGuidance: async (run) => void started.push({ approved: run.approved, values: run.values }),
    stopGuidance: async () => void stops++,
    closeWindow: async (id) => void closed.push(id),
    capture: async () => {
      await gate;
      return new Blob(['jpeg'], { type: 'image/jpeg' });
    },
    logs,
    notify: (n) => void notices.push(n),
    attention: (on) => void (attention = on),
    selfCheck: async () => [2],
  });
  /** Fire every alarm due by now, like Chrome does. */
  const fire = async () => {
    for (const [name, when] of [...alarms]) {
      if (when > Date.now()) continue;
      alarms.delete(name);
      await scheduler.onAlarm(name);
    }
  };
  const state = (over: Partial<GuidanceState>): GuidanceState => ({
    ...GUIDANCE_IDLE,
    status: 'active',
    mode: 'run',
    guideId: 'g1',
    title: 'Create an invoice',
    total: 3,
    scheduleId: 'sched',
    ...over,
  });
  return {
    scheduler,
    storage,
    alarms,
    notices,
    started,
    closed,
    logs,
    fire,
    state,
    setBusy: (b: boolean) => void (busy = b),
    setGuides: (g: Record<string, Guide>) => void (guides = g),
    attention: () => attention,
    stops: () => stops,
    /** Hold screenshots until the returned function is called. */
    hold: () => {
      let release: () => void = () => undefined;
      gate = new Promise<void>((r) => (release = r));
      return () => {
        gate = undefined;
        release();
      };
    },
  };
}

const daily = (guide: Guide, over: Partial<Schedule> = {}): Schedule => ({
  ...createSchedule(guide, { recurrence: { kind: 'daily' }, time: '09:00' }),
  id: 'sched',
  values: { s2: 'Saltbush {today}' },
  ...over,
});

/** Monday 19 October 2026, 07:00 in Sydney. */
const START = new Date('2026-10-18T20:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
});
afterEach(() => vi.useRealTimers());

describe('alarms', () => {
  it('sets one alarm per enabled schedule at its next run, plus the check an hour before', async () => {
    const h = harness();
    await h.scheduler.save(daily(makeGuide(), { checkFirst: true }));
    const next = new Date('2026-10-18T22:00:00Z').getTime(); // 09:00 Sydney
    expect(h.alarms.get('schedule:sched')).toBe(next);
    expect(h.alarms.get('check:sched')).toBe(next - CHECK_AHEAD_MS);
    await h.scheduler.setEnabled('sched', false);
    expect(h.alarms.size).toBe(0);
  });

  it('rebuilds the alarms when Chrome starts (they are cleared on update)', async () => {
    const h = harness();
    await h.scheduler.save(daily(makeGuide()));
    h.alarms.clear();
    await h.scheduler.startup();
    expect([...h.alarms.keys()]).toEqual(['schedule:sched']);
  });

  it('runs the self-check before the run and reports a missing step', async () => {
    const h = harness();
    await h.scheduler.save(daily(makeGuide(), { checkFirst: true }));
    vi.setSystemTime(new Date('2026-10-18T21:00:00Z'));
    await h.fire();
    expect(h.notices).toContainEqual({
      kind: 'check-failed',
      scheduleId: 'sched',
      name: 'Create an invoice',
      step: 2,
    });
  });
});

describe('due runs', () => {
  it('runs in its own window with resolved values when the alarm fires', async () => {
    const h = harness();
    await h.scheduler.save(daily(makeGuide()));
    vi.setSystemTime(new Date('2026-10-18T22:00:00Z'));
    await h.fire();
    expect(h.started).toEqual([{ approved: [], values: { s2: 'Saltbush 19/10/2026' } }]);
    // The next day's alarm is set.
    expect(h.alarms.get('schedule:sched')).toBe(new Date('2026-10-19T22:00:00Z').getTime());
  });

  it('retries every 2 minutes while the browser is busy, then skips after 30', async () => {
    const h = harness();
    await h.scheduler.save(daily(makeGuide()));
    h.setBusy(true);
    vi.setSystemTime(new Date('2026-10-18T22:00:00Z'));
    await h.fire();
    expect(h.alarms.get('retry:sched')).toBe(Date.now() + BUSY_RETRY_MS);
    // Free after 4 minutes: it starts.
    vi.advanceTimersByTime(BUSY_RETRY_MS);
    await h.fire();
    expect(h.started).toHaveLength(0);
    h.setBusy(false);
    vi.advanceTimersByTime(BUSY_RETRY_MS);
    await h.fire();
    expect(h.started).toHaveLength(1);

    // Another day, busy the whole time: logged as skipped.
    vi.setSystemTime(START);
    const h2 = harness();
    await h2.scheduler.save(daily(makeGuide()));
    h2.setBusy(true);
    vi.setSystemTime(new Date('2026-10-19T22:00:00Z'));
    await h2.fire();
    for (let t = 0; t < BUSY_GIVE_UP_MS; t += BUSY_RETRY_MS) {
      vi.advanceTimersByTime(BUSY_RETRY_MS);
      await h2.fire();
    }
    const logs = await h2.logs.list('sched');
    expect(logs.map((l) => [l.outcome, l.reason])).toEqual([['skipped', 'busy']]);
    expect(h2.alarms.has('retry:sched')).toBe(false);
    expect(h2.attention()).toBe(false);
  });

  it('catches up one missed run at start-up, or logs it as missed', async () => {
    const h = harness();
    await h.scheduler.save(daily(makeGuide()));
    // Chrome was closed for three days.
    vi.setSystemTime(new Date('2026-10-21T23:00:00Z'));
    await h.scheduler.startup();
    expect(h.started).toHaveLength(1);

    vi.setSystemTime(START);
    const h2 = harness();
    await h2.scheduler.save(daily(makeGuide(), { missedRun: 'skip' }));
    vi.setSystemTime(new Date('2026-10-21T23:00:00Z'));
    await h2.scheduler.startup();
    expect(h2.started).toHaveLength(0);
    const [log] = await h2.logs.list('sched');
    expect([log?.outcome, log?.reason]).toEqual(['missed', 'closed']);
    // Nothing missed: nothing happens.
    await h2.scheduler.startup();
    expect(await h2.logs.list('sched')).toHaveLength(1);
  });

  it('asks the person to start a guide with desktop steps, and logs it as missed if not', async () => {
    const desktop = createStep({
      id: 'd1',
      action: 'click',
      app: { kind: 'desktop', processName: 'notepad.exe', windowTitle: 'Notepad' },
    });
    const g = makeGuide([desktop]);
    const h = harness(g);
    await h.scheduler.save(daily(g, { waitMinutes: 15 }));
    vi.setSystemTime(new Date('2026-10-18T22:00:00Z'));
    await h.fire();
    expect(h.notices.at(-1)).toEqual({
      kind: 'due',
      scheduleId: 'sched',
      name: 'Create an invoice',
    });
    expect(h.started).toHaveLength(0);
    vi.advanceTimersByTime(15 * 60_000);
    await h.fire();
    const [log] = await h.logs.list('sched');
    expect([log?.outcome, log?.reason]).toEqual(['missed', 'not-started']);

    // Next day the person presses Start in time.
    vi.setSystemTime(new Date('2026-10-19T22:00:00Z'));
    await h.fire();
    expect(await h.scheduler.startNow('sched')).toEqual({});
    expect(h.started).toHaveLength(1);
    expect(h.alarms.has('pending:sched')).toBe(false);
  });
});

describe('unattended runs', () => {
  async function running(over: Partial<Schedule> = {}) {
    vi.setSystemTime(START);
    const h = harness();
    await h.scheduler.save(daily(makeGuide(), over));
    vi.setSystemTime(new Date('2026-10-18T22:00:00Z'));
    await h.fire();
    return h;
  }

  it('pauses at a confirm step that is not pre-approved, notifies, then stops after the wait', async () => {
    const h = await running({ waitMinutes: 10 });
    await h.scheduler.onGuidance(h.state({ index: 1, phase: 'acting' }));
    await h.scheduler.onGuidance(h.state({ index: 2, phase: 'confirm' }));
    expect(h.notices.at(-1)).toEqual({
      kind: 'paused',
      reason: 'confirm',
      scheduleId: 'sched',
      name: 'Create an invoice',
      step: 3,
    });
    // The same stop reported again doesn't notify twice.
    await h.scheduler.onGuidance(h.state({ index: 2, phase: 'confirm' }));
    expect(h.notices.filter((n) => n.kind === 'paused')).toHaveLength(1);
    vi.advanceTimersByTime(10 * 60_000);
    await h.fire();
    expect(h.stops()).toBe(1);
    expect(h.closed).toEqual([7]);
    const [log] = await h.logs.list('sched');
    expect(log).toMatchObject({ outcome: 'stopped', reason: 'confirm' });
    expect(log?.steps.map((s) => [s.number, s.status])).toEqual([
      [1, 'done'],
      [2, 'done'],
      [3, 'stopped'],
    ]);
    expect(log?.values).toEqual({ s2: 'Saltbush 19/10/2026' });
    expect(h.attention()).toBe(true);
    await h.scheduler.seen();
    expect(h.attention()).toBe(false);
  });

  it('completes with a pre-approved confirm step, logging a screenshot per step', async () => {
    const g = makeGuide();
    const h = harness(g);
    await h.scheduler.save(withApprovals(daily(g), g, ['s3']));
    vi.setSystemTime(new Date('2026-10-18T22:00:00Z'));
    await h.fire();
    expect(h.started[0]?.approved).toEqual(['s3']);
    for (const index of [1, 2]) await h.scheduler.onGuidance(h.state({ index, phase: 'acting' }));
    await h.scheduler.onGuidance(h.state({ status: 'done', index: 3 }));
    const [log] = await h.logs.list('sched');
    expect(log?.outcome).toBe('completed');
    expect(log?.steps.map((s) => [s.number, s.status, !!s.screenshot])).toEqual([
      [1, 'done', true],
      [2, 'done', true],
      [3, 'confirmed', true],
    ]);
    expect(await h.logs.getShot(log!.steps[0]!.screenshot!)).toBeInstanceOf(Blob);
    expect(h.closed).toEqual([7]);
    expect(h.notices.at(-1)).toMatchObject({ kind: 'finished', outcome: 'completed' });
  });

  it('drops approvals after the guide is edited', async () => {
    const g = makeGuide();
    const h = harness(g);
    await h.scheduler.save(withApprovals(daily(g), g, ['s3']));
    // The Submit step now targets another button.
    const edited: Guide = {
      ...g,
      blocks: g.blocks.map((b) =>
        b.kind === 'step' && b.id === 's3' ? { ...b, target: target('Submit for approval') } : b,
      ),
    };
    h.setGuides({ g1: edited });
    vi.setSystemTime(new Date('2026-10-18T22:00:00Z'));
    await h.fire();
    expect(h.started[0]?.approved).toEqual([]);
  });

  it('keeps the window open when asked, and goes on after the person deals with a stop', async () => {
    const h = await running({ keepWindowOpen: true });
    await h.scheduler.onGuidance(h.state({ index: 0, phase: 'failed', reason: 'sign-in' }));
    expect(h.notices.at(-1)).toMatchObject({ kind: 'paused', reason: 'sign-in', step: 1 });
    expect(h.alarms.has(`wait:${(await h.logs.list('sched'))[0]?.id}`)).toBe(true);
    // Signed in, Continue: the run goes on and the wait is cancelled.
    await h.scheduler.onGuidance(h.state({ index: 0, phase: 'acting' }));
    expect([...h.alarms.keys()].some((k) => k.startsWith('wait:'))).toBe(false);
    await h.scheduler.onGuidance(h.state({ status: 'done', index: 3 }));
    expect(h.closed).toEqual([]);
  });

  it('logs a run the person stopped, and one interrupted by Chrome closing', async () => {
    const h = await running();
    await h.scheduler.onGuidance({ ...GUIDANCE_IDLE, scheduleId: 'sched' });
    const [stopped] = await h.logs.list('sched');
    expect([stopped?.outcome, stopped?.reason]).toEqual(['stopped', 'stopped']);
    expect(h.closed).toEqual([]);

    const h2 = await running();
    await h2.scheduler.startup();
    const logs = await h2.logs.list('sched');
    expect(logs.find((l) => l.reason === 'interrupted')?.outcome).toBe('stopped');
  });

  it('keeps a completed run completed when the Schedules page clears the badge meanwhile', async () => {
    const h = await running();
    // The run finishes, but its last screenshot takes a while.
    const release = h.hold();
    const finishing = h.scheduler.onGuidance(h.state({ status: 'done', index: 3 }));
    // Meanwhile the open Schedules page clears the badge: it must wait for the run to be logged,
    // or it writes back the state from before and the finished run comes back.
    let seen = false;
    const clearing = h.scheduler.seen().then(() => (seen = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toBe(false);
    release();
    await Promise.all([finishing, clearing]);
    // Run for me resets to idle afterwards: nothing changes the log.
    await h.scheduler.onGuidance({ ...GUIDANCE_IDLE, scheduleId: 'sched' });
    const logs = await h.logs.list('sched');
    expect(logs.map((l) => l.outcome)).toEqual(['completed']);
  });

  it('ignores guidance that is not its run, and is busy while a run goes', async () => {
    const h = await running();
    await h.scheduler.onGuidance(h.state({ scheduleId: undefined, phase: 'confirm', index: 2 }));
    expect(h.notices.filter((n) => n.kind === 'paused')).toHaveLength(0);
    expect(await h.scheduler.startNow('sched')).toEqual({ error: 'busy' });
  });
});

describe('deleting', () => {
  it('removes a schedule with its alarms and logs', async () => {
    const h = harness();
    await h.scheduler.save(daily(makeGuide()));
    vi.setSystemTime(new Date('2026-10-18T22:00:00Z'));
    await h.fire();
    await h.scheduler.onGuidance(h.state({ status: 'done', index: 3 }));
    expect(await h.logs.list('sched')).toHaveLength(1);
    await h.scheduler.remove('sched');
    expect(await h.scheduler.list()).toEqual([]);
    expect(await h.logs.list('sched')).toEqual([]);
    expect(h.alarms.size).toBe(0);
  });
});
