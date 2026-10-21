/**
 * Wall-clock arithmetic in one time zone, using the built-in `Intl` time-zone data. Schedules use
 * the computer's own zone; tests pass a fixed one so daylight-saving cases are reproducible.
 */

/** A calendar date (month 1–12). */
export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

export interface LocalDateTime extends LocalDate {
  hour: number;
  minute: number;
}

export interface Zone {
  /** IANA name, e.g. `Australia/Sydney`. */
  readonly name: string;
  /** The wall-clock date and time of an instant. */
  partsOf(at: Date): LocalDateTime;
  /**
   * The instant a wall-clock time happens. A time skipped when clocks go forward resolves to the
   * same distance past the change (02:30 on a one-hour jump at 02:00 is 03:30). A time that
   * happens twice when clocks go back resolves to the first.
   */
  instantOf(local: LocalDateTime): Date;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(name: string): Intl.DateTimeFormat {
  let f = formatters.get(name);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: name,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(name, f);
  }
  return f;
}

function wallMs(name: string, at: number): number {
  const parts: Record<string, number> = {};
  for (const p of formatter(name).formatToParts(new Date(at)))
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  return Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
}

/** Offset of the zone from UTC at an instant, in milliseconds. */
function offsetAt(name: string, at: number): number {
  const whole = Math.floor(at / 1000) * 1000;
  return wallMs(name, whole) - whole;
}

export function zone(name: string): Zone {
  formatter(name); // throws RangeError for an unknown zone
  return {
    name,
    partsOf(at) {
      const d = new Date(wallMs(name, at.getTime()));
      return {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
      };
    },
    instantOf(local) {
      const wall = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
      // The two offsets either side of the wall time (they differ only around a change).
      const before = offsetAt(name, wall - 86_400_000);
      const after = offsetAt(name, wall + 86_400_000);
      const candidates = [wall - before, wall - after].sort((a, b) => a - b);
      for (const t of candidates) if (wallMs(name, t) === wall) return new Date(t);
      // Skipped by a forward change: keep the wall time's distance past the change.
      return new Date(wall - before);
    },
  };
}

/** The zone this computer is set to. */
export function systemZone(): Zone {
  return zone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

// ---------- Calendar helpers (plain dates, no zone) ----------

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(d: LocalDate): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

export function addDays(d: LocalDate, days: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** `yyyy-MM-dd`. */
export function isoDate(d: LocalDate): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

export function isBusinessDay(d: LocalDate, skip: ReadonlySet<string>): boolean {
  const w = weekday(d);
  return w !== 0 && w !== 6 && !skip.has(isoDate(d));
}
