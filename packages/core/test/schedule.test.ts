import { describe, expect, it } from 'vitest';
import {
  RunLogSchema,
  ScheduleSchema,
  UnknownPlaceholderError,
  activeApprovals,
  approvalsOutdated,
  canSchedule,
  createGuide,
  createSchedule,
  createStep,
  exportGuideArchive,
  guideVersion,
  importGuideArchive,
  IndexedDbStore,
  hostMatches,
  isSignInHost,
  missedRun,
  needsPerson,
  needsSignIn,
  nextRun,
  nextRuns,
  parseGuide,
  parseSchedules,
  plain,
  resolveTokens,
  resolveValues,
  runLogsToDrop,
  serializeGuide,
  unknownPlaceholders,
  withApprovals,
  zone,
  type Guide,
  type RunLog,
  type Schedule,
  type Step,
} from '../src/index.js';

const SYD = zone('Australia/Sydney');
const at = (iso: string) => new Date(iso);
/** Sydney wall time as an ISO string with its offset, for readable assertions. */
const syd = (d: Date | undefined) => {
  if (!d) return undefined;
  const p = SYD.partsOf(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
};

const base = { enabled: true, skipDates: [] as string[] };
const daily = (time: string) => ({ ...base, recurrence: { kind: 'daily' as const }, time });

const web = { kind: 'web' as const, url: 'http://localhost:5173/app/', title: 'Ledgerline' };
const target = (name: string) => ({
  role: 'button',
  name,
  selectors: [{ type: 'css' as const, value: `#${name}`, score: 0.5 }],
  bbox: { x: 10, y: 10, w: 80, h: 30 },
  point: { x: 50, y: 25 },
});

function guide(): Guide {
  const s1 = createStep({ id: 's1', action: 'click', app: web, target: target('new') });
  const s2 = createStep({
    id: 's2',
    action: 'type',
    app: web,
    target: target('supplier'),
    input: { mode: 'ask', sensitive: false },
    human: { title: plain('Type the supplier') },
  });
  const s3 = createStep({
    id: 's3',
    action: 'type',
    app: web,
    target: target('date'),
    input: { mode: 'default', value: '01/01/2026', variable: 'invoice_date', sensitive: false },
  });
  const s4 = createStep({
    id: 's4',
    action: 'type',
    app: web,
    target: target('password'),
    input: { mode: 'ask', sensitive: true },
  });
  const s5 = createStep({
    id: 's5',
    action: 'click',
    app: web,
    target: target('submit'),
    agent: { confirm: true },
  });
  return {
    ...createGuide({ id: 'g1', title: 'Create an invoice' }),
    variables: [{ name: 'invoice_date', label: 'Invoice date', sensitive: false }],
    blocks: [s1, s2, s3, s4, s5],
  } as Guide;
}

const editStep = (g: Guide, id: string, change: (s: Step) => Step): Guide => ({
  ...g,
  blocks: g.blocks.map((b) => (b.kind === 'step' && b.id === id ? change(b) : b)),
});

describe('nextRun', () => {
  it('keeps the wall-clock time across the October daylight-saving change in Sydney', () => {
    // Clocks go from 02:00 AEST to 03:00 AEDT on Sunday 4 October 2026.
    const s = daily('09:00');
    const sat = nextRun(s, at('2026-10-02T12:00:00Z'), SYD); // Saturday morning, Sydney
    expect(syd(sat)).toBe('2026-10-03 09:00');
    expect(sat?.toISOString()).toBe('2026-10-02T23:00:00.000Z'); // +10:00
    const sun = nextRun(s, sat!, SYD);
    expect(syd(sun)).toBe('2026-10-04 09:00');
    expect(sun?.toISOString()).toBe('2026-10-03T22:00:00.000Z'); // +11:00
  });

  it('runs a time that does not exist on the change day the same distance past the change', () => {
    const s = daily('02:30');
    const run = nextRun(s, at('2026-10-03T00:00:00Z'), SYD); // Saturday 10:00 Sydney
    expect(run?.toISOString()).toBe('2026-10-03T16:30:00.000Z');
    expect(syd(run)).toBe('2026-10-04 03:30');
    // The day after, 02:30 exists again.
    expect(syd(nextRun(s, run!, SYD))).toBe('2026-10-05 02:30');
  });

  it('runs once, at the first 02:30, when clocks go back in April', () => {
    // Clocks go from 03:00 AEDT back to 02:00 AEST on Sunday 5 April 2026.
    const s = daily('02:30');
    const first = nextRun(s, at('2026-04-04T10:00:00Z'), SYD);
    expect(first?.toISOString()).toBe('2026-04-04T15:30:00.000Z'); // 02:30 +11:00
    const second = nextRun(s, first!, SYD);
    expect(syd(second)).toBe('2026-04-06 02:30');
    expect(syd(nextRun(daily('09:00'), at('2026-04-04T10:00:00Z'), SYD))).toBe('2026-04-05 09:00');
    expect(nextRun(daily('09:00'), at('2026-04-04T10:00:00Z'), SYD)?.toISOString()).toBe(
      '2026-04-04T23:00:00.000Z', // +10:00
    );
  });

  it('runs on weekdays only', () => {
    const s = { ...base, recurrence: { kind: 'weekdays' as const }, time: '09:00' };
    // Friday 16 October 2026, 10:00 Sydney: the next weekday run is Monday.
    expect(syd(nextRun(s, at('2026-10-15T23:00:00Z'), SYD))).toBe('2026-10-19 09:00');
  });

  it('runs on chosen days of the week', () => {
    const s = { ...base, recurrence: { kind: 'weekly' as const, days: [1, 3] }, time: '18:15' };
    const runs = nextRuns(s, at('2026-10-20T00:00:00Z'), 3, SYD).map(syd);
    expect(runs).toEqual(['2026-10-21 18:15', '2026-10-26 18:15', '2026-10-28 18:15']);
  });

  it('clamps a day of the month to the month’s last day', () => {
    const s = { ...base, recurrence: { kind: 'monthly-day' as const, day: 31 }, time: '07:00' };
    const runs = nextRuns(s, at('2027-01-01T00:00:00Z'), 4, SYD).map(syd);
    expect(runs).toEqual([
      '2027-01-31 07:00',
      '2027-02-28 07:00',
      '2027-03-31 07:00',
      '2027-04-30 07:00',
    ]);
    const leap = nextRun(s, at('2028-02-01T00:00:00Z'), SYD);
    expect(syd(leap)).toBe('2028-02-29 07:00');
  });

  it('finds the nth and last business day, skipping weekends and skip dates', () => {
    const first = {
      ...base,
      recurrence: { kind: 'monthly-business-day' as const, nth: 1 as const },
      time: '08:00',
    };
    // 1 November 2026 is a Sunday.
    expect(syd(nextRun(first, at('2026-10-31T00:00:00Z'), SYD))).toBe('2026-11-02 08:00');
    const third = {
      ...first,
      recurrence: { kind: 'monthly-business-day' as const, nth: 3 as const },
    };
    expect(syd(nextRun(third, at('2026-10-31T00:00:00Z'), SYD))).toBe('2026-11-04 08:00');
    const last = {
      ...first,
      recurrence: { kind: 'monthly-business-day' as const, nth: 'last' as const },
    };
    // 31 October 2026 is a Saturday.
    expect(syd(nextRun(last, at('2026-10-20T00:00:00Z'), SYD))).toBe('2026-10-30 08:00');
    // A public holiday on the Friday moves it to Thursday.
    expect(
      syd(nextRun({ ...last, skipDates: ['2026-10-30'] }, at('2026-10-20T00:00:00Z'), SYD)),
    ).toBe('2026-10-29 08:00');
    // A holiday on the first Monday makes Tuesday the first business day.
    expect(
      syd(nextRun({ ...first, skipDates: ['2026-11-02'] }, at('2026-10-31T00:00:00Z'), SYD)),
    ).toBe('2026-11-03 08:00');
  });

  it('skips skip dates and returns nothing when switched off', () => {
    const s = { ...daily('09:00'), skipDates: ['2026-12-25', '2026-12-26'] };
    expect(syd(nextRun(s, at('2026-12-24T00:00:00Z'), SYD))).toBe('2026-12-27 09:00');
    expect(nextRun({ ...s, enabled: false }, at('2026-12-24T00:00:00Z'), SYD)).toBeUndefined();
  });

  it('crosses a year end', () => {
    const s = { ...base, recurrence: { kind: 'monthly-day' as const, day: 1 }, time: '00:05' };
    expect(syd(nextRun(s, at('2026-12-15T00:00:00Z'), SYD))).toBe('2027-01-01 00:05');
  });
});

describe('missedRun', () => {
  it('returns the latest run due while Chrome was closed, at most one', () => {
    const s = daily('09:00');
    // Last accounted for Saturday 10 Oct 08:00; now Monday 12 Oct 12:00 (Sydney).
    const missed = missedRun(s, at('2026-10-09T21:00:00Z'), at('2026-10-12T01:00:00Z'), SYD);
    expect(syd(missed)).toBe('2026-10-12 09:00');
    expect(
      missedRun(s, at('2026-10-11T23:00:00Z'), at('2026-10-11T23:30:00Z'), SYD),
    ).toBeUndefined();
  });
});

describe('placeholders', () => {
  // Monday 2 March 2026, 10:00 in Sydney.
  const now = at('2026-03-01T23:00:00Z');
  const r = (v: string, f?: string) => resolveTokens(v, now, f, { zone: SYD });

  it('resolves every date placeholder', () => {
    expect(r('{today}')).toBe('02/03/2026');
    expect(r('{yesterday}')).toBe('01/03/2026');
    expect(r('{tomorrow}')).toBe('03/03/2026');
    expect(r('{month_start}')).toBe('01/03/2026');
    expect(r('{month_end}')).toBe('31/03/2026');
    expect(r('{last_month_start}')).toBe('01/02/2026');
    expect(r('{last_month_end}')).toBe('28/02/2026');
    expect(r('{last_business_day}')).toBe('27/02/2026'); // the Friday before
    expect(r('Invoices {last_month_start} to {last_month_end}')).toBe(
      'Invoices 01/02/2026 to 28/02/2026',
    );
  });

  it('uses the local date, not UTC, and other formats', () => {
    // 14:30 UTC on 20 October is 01:30 on 21 October in Sydney.
    expect(resolveTokens('{today}', at('2026-10-20T14:30:00Z'), 'yyyy-MM-dd', { zone: SYD })).toBe(
      '2026-10-21',
    );
    expect(r('{today}', 'd MMMM yyyy')).toBe('2 March 2026');
    expect(r('{today}', 'MMM d, yy')).toBe('Mar 2, 26');
    expect(r('{today}', 'M/d/yyyy')).toBe('3/2/2026');
  });

  it('handles January and leap years', () => {
    const jan = at('2028-01-10T00:00:00Z');
    expect(resolveTokens('{last_month_start}', jan, undefined, { zone: SYD })).toBe('01/12/2027');
    const march = at('2028-03-05T00:00:00Z');
    expect(resolveTokens('{last_month_end}', march, undefined, { zone: SYD })).toBe('29/02/2028');
  });

  it('counts skip dates out of the last business day', () => {
    expect(
      resolveTokens('{last_business_day}', now, undefined, {
        zone: SYD,
        skipDates: ['2026-02-27'],
      }),
    ).toBe('26/02/2026');
  });

  it('leaves text without placeholders alone and rejects unknown placeholders', () => {
    expect(r('Saltbush Supplies')).toBe('Saltbush Supplies');
    expect(r('Code {ABC}')).toBe('Code {ABC}');
    expect(unknownPlaceholders('{today} {next_week}')).toEqual(['next_week']);
    expect(() => r('{next_week}')).toThrow(UnknownPlaceholderError);
  });
});

describe('schedule schema', () => {
  it('creates a schedule with the defaults and the guide’s run fields', () => {
    const g = guide();
    const s = createSchedule(g, { recurrence: { kind: 'daily' }, time: '09:00' });
    expect(s).toMatchObject({
      guideId: 'g1',
      name: 'Create an invoice',
      enabled: true,
      missedRun: 'run-at-start',
      dateFormat: 'dd/MM/yyyy',
      waitMinutes: 30,
      keepWindowOpen: false,
      checkFirst: false,
      guideVersion: guideVersion(g),
    });
    // The secret step is never a run field.
    expect(s.values).toEqual({ s2: '', invoice_date: '01/01/2026' });
  });

  it('rejects unknown placeholders, bad times and bad dates at save time', () => {
    const s = createSchedule(guide(), { recurrence: { kind: 'daily' }, time: '09:00' });
    expect(ScheduleSchema.safeParse({ ...s, values: { s2: '{today}' } }).success).toBe(true);
    const bad = ScheduleSchema.safeParse({ ...s, values: { s2: 'Due {next_week}' } });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe('Unknown placeholder {next_week}');
    expect(ScheduleSchema.safeParse({ ...s, time: '24:00' }).success).toBe(false);
    expect(ScheduleSchema.safeParse({ ...s, skipDates: ['25/12/2026'] }).success).toBe(false);
    expect(
      ScheduleSchema.safeParse({ ...s, recurrence: { kind: 'monthly-day', day: 32 } }).success,
    ).toBe(false);
    expect(parseSchedules([s, { ...s, time: 'nine' }, 'junk'])).toEqual([s]);
  });

  it('resolves values for a run, never giving sensitive inputs a value', () => {
    const g = guide();
    const s = { ...createSchedule(g, { recurrence: { kind: 'daily' }, time: '09:00' }) };
    s.values = { s2: 'Saltbush', invoice_date: '{last_month_end}', s4: 'hunter2' };
    expect(resolveValues(s, g, at('2026-03-01T23:00:00Z'), SYD)).toEqual({
      s2: 'Saltbush',
      invoice_date: '28/02/2026',
    });
  });

  it('parses run logs and keeps the newest 20 per schedule', () => {
    const log = (i: number): RunLog => ({
      id: `r${i}`,
      scheduleId: 'x',
      guideId: 'g1',
      startedAt: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(),
      finishedAt: new Date(Date.UTC(2026, 9, 1 + i, 0, 5)).toISOString(),
      outcome: 'completed',
      steps: [
        {
          stepId: 's1',
          number: 1,
          status: 'done',
          at: '2026-10-01T00:00:00Z',
          screenshot: 'r1-1.jpg',
        },
      ],
      values: { s2: 'Saltbush' },
    });
    expect(RunLogSchema.parse(log(1))).toEqual(log(1));
    expect(RunLogSchema.safeParse({ ...log(1), outcome: 'exploded' }).success).toBe(false);
    const logs = Array.from({ length: 23 }, (_, i) => log(i));
    expect(runLogsToDrop(logs).sort()).toEqual(['r0', 'r1', 'r2']);
    expect(runLogsToDrop(logs.slice(0, 20))).toEqual([]);
  });

  it('never travels inside a guide file', () => {
    const g = guide();
    const s = createSchedule(g, { recurrence: { kind: 'daily' }, time: '09:00' });
    const raw = JSON.parse(serializeGuide(g)) as Record<string, unknown>;
    const imported = parseGuide({ ...raw, schedules: [s], runLogs: [] });
    expect(imported).not.toHaveProperty('schedules');
    expect(imported).not.toHaveProperty('runLogs');
    expect(serializeGuide(imported)).not.toContain(s.id);
  });

  it('never arrives inside an imported .showsteps file', async () => {
    const { IDBFactory } = await import('fake-indexeddb');
    const { strFromU8, strToU8, unzipSync, zipSync } = await import('fflate');
    const g = guide();
    const s = createSchedule(g, { recurrence: { kind: 'daily' }, time: '09:00' });
    const from = new IndexedDbStore(new IDBFactory());
    await from.saveGuide(g);
    // A file someone tampered with: a schedule inside guide.json and as a file of its own.
    const files = unzipSync(await exportGuideArchive(from, g.id));
    const raw = JSON.parse(strFromU8(files['guide.json']!)) as Record<string, unknown>;
    files['guide.json'] = strToU8(JSON.stringify({ ...raw, schedules: [s] }));
    files['schedules.json'] = strToU8(JSON.stringify([s]));
    const to = new IndexedDbStore(new IDBFactory());
    const { guideId } = await importGuideArchive(to, zipSync(files));
    const imported = await to.getGuide(guideId);
    expect(imported).toBeDefined();
    expect(JSON.stringify(imported)).not.toContain(s.id);
  });

  it('knows which guides can be scheduled and which need the person', () => {
    const g = guide();
    expect(canSchedule(g)).toBe(true);
    expect(needsPerson(g)).toBe(false);
    const desktop = createStep({
      action: 'click',
      app: { kind: 'desktop', processName: 'notepad.exe', windowTitle: 'Notepad' },
    });
    expect(needsPerson({ ...g, blocks: [...g.blocks, desktop] })).toBe(true);
    expect(canSchedule({ ...g, blocks: [desktop] })).toBe(false);
  });
});

describe('guide version and approvals', () => {
  const schedule = (g: Guide): Schedule =>
    createSchedule(g, { recurrence: { kind: 'daily' }, time: '09:00' });

  it('changes when what Run for me does changes, not when the writing does', () => {
    const g = guide();
    const v = guideVersion(g);
    expect(guideVersion(structuredClone(g))).toBe(v);
    expect(guideVersion({ ...g, title: 'Renamed' })).toBe(v);
    expect(
      guideVersion(
        editStep(g, 's1', (s) => ({ ...s, human: { ...s.human, title: plain('New title') } })),
      ),
    ).toBe(v);
    expect(
      guideVersion(editStep(g, 's1', (s) => ({ ...s, target: { ...s.target!, name: 'old' } }))),
    ).not.toBe(v);
    expect(
      guideVersion(editStep(g, 's5', (s) => ({ ...s, agent: { ...s.agent, confirm: false } }))),
    ).not.toBe(v);
    expect(
      guideVersion(
        editStep(g, 's3', (s) => ({ ...s, input: { ...s.input!, value: '02/01/2026' } })),
      ),
    ).not.toBe(v);
    expect(guideVersion({ ...g, blocks: [...g.blocks].reverse() })).not.toBe(v);
  });

  it('applies approvals only while the guide is unchanged', () => {
    const g = guide();
    // s1 is not a confirm step, so it can't be approved.
    const s = withApprovals(schedule(g), g, ['s5', 's1']);
    expect(s.approvedConfirmSteps.stepIds).toEqual(['s5']);
    expect([...activeApprovals(s, g)]).toEqual(['s5']);
    expect(approvalsOutdated(s, g)).toBe(false);

    const edited = editStep(g, 's5', (st) => ({ ...st, target: target('submit-now') }));
    expect(activeApprovals(s, edited).size).toBe(0);
    expect(approvalsOutdated(s, edited)).toBe(true);
    // Approving again for the edited guide works.
    expect([...activeApprovals(withApprovals(s, edited, ['s5']), edited)]).toEqual(['s5']);
  });
});

describe('sign-in pages', () => {
  it('recognises identity providers, including subdomains', () => {
    expect(isSignInHost('login.microsoftonline.com')).toBe(true);
    expect(isSignInHost('accounts.google.com')).toBe(true);
    expect(isSignInHost('acme.okta.com')).toBe(true);
    expect(isSignInHost('acme.eu.auth0.com')).toBe(true);
    expect(isSignInHost('okta.com')).toBe(false);
    expect(isSignInHost('notokta.com')).toBe(false);
    expect(isSignInHost('mail.google.com')).toBe(false);
    expect(hostMatches('LOGIN.LIVE.COM.', 'login.live.com')).toBe(true);
    expect(isSignInHost('127.0.0.1', ['127.0.0.1'])).toBe(true);
  });

  it('stops only for a sign-in page on another host', () => {
    expect(
      needsSignIn({ host: 'acme.okta.com', stepHost: 'app.acme.com', hasSecretField: false }),
    ).toBe(true);
    expect(
      needsSignIn({ host: 'sso.acme.com', stepHost: 'app.acme.com', hasSecretField: true }),
    ).toBe(true);
    expect(
      needsSignIn({ host: 'app.acme.com', stepHost: 'app.acme.com', hasSecretField: true }),
    ).toBe(false);
    expect(
      needsSignIn({ host: 'other.com', stepHost: 'app.acme.com', hasSecretField: false }),
    ).toBe(false);
  });
});
