import type { Recurrence, Schedule } from './schema.js';
import {
  addDays,
  daysInMonth,
  isBusinessDay,
  isoDate,
  systemZone,
  weekday,
  type LocalDate,
  type Zone,
} from './zone.js';

/** How far ahead to look; skip dates can block a whole year of a weekly or monthly schedule. */
const HORIZON_DAYS = 800;

function businessDays(year: number, month: number, skip: ReadonlySet<string>): LocalDate[] {
  const out: LocalDate[] = [];
  for (let day = 1; day <= daysInMonth(year, month); day++) {
    const d = { year, month, day };
    if (isBusinessDay(d, skip)) out.push(d);
  }
  return out;
}

/** Whether the recurrence falls on a date (before skip dates are applied). */
export function occursOn(r: Recurrence, d: LocalDate, skip: ReadonlySet<string>): boolean {
  switch (r.kind) {
    case 'daily':
      return true;
    case 'weekdays': {
      const w = weekday(d);
      return w !== 0 && w !== 6;
    }
    case 'weekly':
      return r.days.includes(weekday(d));
    case 'monthly-day':
      return d.day === Math.min(r.day, daysInMonth(d.year, d.month));
    case 'monthly-business-day': {
      const days = businessDays(d.year, d.month, skip);
      const pick = r.nth === 'last' ? days[days.length - 1] : days[r.nth - 1];
      return pick !== undefined && pick.day === d.day;
    }
  }
}

/**
 * The next time a schedule runs strictly after `after`, in local time, or undefined when it is
 * switched off or never runs again within two years.
 */
export function nextRun(
  schedule: Pick<Schedule, 'enabled' | 'recurrence' | 'time' | 'skipDates'>,
  after: Date,
  z: Zone = systemZone(),
): Date | undefined {
  if (!schedule.enabled) return undefined;
  const [hour = 0, minute = 0] = schedule.time.split(':').map(Number);
  const skip = new Set(schedule.skipDates);
  const start = z.partsOf(after);
  let d: LocalDate = { year: start.year, month: start.month, day: start.day };
  for (let i = 0; i < HORIZON_DAYS; i++, d = addDays(d, 1)) {
    if (skip.has(isoDate(d)) || !occursOn(schedule.recurrence, d, skip)) continue;
    const at = z.instantOf({ ...d, hour, minute });
    if (at.getTime() > after.getTime()) return at;
  }
  return undefined;
}

/** The next `count` run times (for the "next runs" line in the Schedule dialog). */
export function nextRuns(
  schedule: Pick<Schedule, 'enabled' | 'recurrence' | 'time' | 'skipDates'>,
  after: Date,
  count: number,
  z: Zone = systemZone(),
): Date[] {
  const out: Date[] = [];
  let from = after;
  while (out.length < count) {
    const at = nextRun(schedule, from, z);
    if (!at) break;
    out.push(at);
    from = at;
  }
  return out;
}

/**
 * The most recent run time due at or before `now` and after `since` (the last time runs were
 * accounted for), if any: a run missed while Chrome was closed or the computer asleep. Only one
 * is returned however many were missed.
 */
export function missedRun(
  schedule: Pick<Schedule, 'enabled' | 'recurrence' | 'time' | 'skipDates'>,
  since: Date,
  now: Date,
  z: Zone = systemZone(),
): Date | undefined {
  let last: Date | undefined;
  let from = since;
  for (;;) {
    const at = nextRun(schedule, from, z);
    if (!at || at.getTime() > now.getTime()) return last;
    last = at;
    from = at;
  }
}
