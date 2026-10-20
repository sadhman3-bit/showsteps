import type { Schedule } from '@showsteps/core';
import { strings } from '../strings.js';

const s = strings.schedules;

const WHEN = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** "Tue 20 Oct, 09:00" in the reader's own format. */
export function formatWhen(date: Date | string): string {
  return WHEN.format(typeof date === 'string' ? new Date(date) : date);
}

/** "Weekdays at 09:00", "Every Mon, Wed at 18:15", "Last business day of each month at 07:00". */
export function describeSchedule(schedule: Pick<Schedule, 'recurrence' | 'time'>): string {
  const r = schedule.recurrence;
  const what =
    r.kind === 'weekly'
      ? s.summary.weekly(
          [...r.days]
            .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
            .map((d) => s.dayShort[d])
            .join(', '),
        )
      : r.kind === 'monthly-day'
        ? s.summary['monthly-day'](r.day)
        : r.kind === 'monthly-business-day'
          ? s.summary['monthly-business-day'](s.nth[String(r.nth)] ?? '')
          : s.summary[r.kind];
  return s.every(what, schedule.time);
}
