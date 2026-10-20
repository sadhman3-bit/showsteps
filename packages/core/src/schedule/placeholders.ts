import {
  addDays,
  daysInMonth,
  isBusinessDay,
  systemZone,
  type LocalDate,
  type Zone,
} from './zone.js';

/** Date placeholders a scheduled value can contain, resolved when the run starts. */
export const PLACEHOLDERS = [
  'today',
  'yesterday',
  'tomorrow',
  'month_start',
  'month_end',
  'last_month_start',
  'last_month_end',
  'last_business_day',
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

export const DEFAULT_DATE_FORMAT = 'dd/MM/yyyy';

/** `{word}`: anything in braces made of lower-case letters and underscores. */
const TOKEN = /\{([a-z_]+)\}/g;

export class UnknownPlaceholderError extends Error {
  constructor(readonly placeholder: string) {
    super(`Unknown placeholder {${placeholder}}`);
    this.name = 'UnknownPlaceholderError';
  }
}

const isPlaceholder = (name: string): name is Placeholder =>
  (PLACEHOLDERS as readonly string[]).includes(name);

/** Placeholders in a value that ShowSteps doesn't know (checked when a schedule is saved). */
export function unknownPlaceholders(value: string): string[] {
  return [...value.matchAll(TOKEN)].map((m) => m[1] ?? '').filter((n) => !isPlaceholder(n));
}

export function hasPlaceholders(value: string): boolean {
  return [...value.matchAll(TOKEN)].some((m) => isPlaceholder(m[1] ?? ''));
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Date format letters: `d`, `dd`, `M`, `MM`, `MMM`, `MMMM`, `yy`, `yyyy`; anything else is kept. */
const FORMAT_TOKEN = /yyyy|yy|MMMM|MMM|MM|M|dd|d/g;

export function isDateFormat(format: string): boolean {
  return format.length > 0 && format.length <= 40 && /[dMy]/.test(format);
}

export function formatDate(d: LocalDate, format: string): string {
  return format.replace(FORMAT_TOKEN, (t) => {
    switch (t) {
      case 'yyyy':
        return String(d.year).padStart(4, '0');
      case 'yy':
        return String(d.year % 100).padStart(2, '0');
      case 'MMMM':
        return MONTHS[d.month - 1] ?? '';
      case 'MMM':
        return (MONTHS[d.month - 1] ?? '').slice(0, 3);
      case 'MM':
        return String(d.month).padStart(2, '0');
      case 'M':
        return String(d.month);
      case 'dd':
        return String(d.day).padStart(2, '0');
      default:
        return String(d.day);
    }
  });
}

/** The date a placeholder stands for on `today`. Business days skip weekends and `skipDates`. */
export function placeholderDate(
  name: Placeholder,
  today: LocalDate,
  skipDates: readonly string[] = [],
): LocalDate {
  const { year, month } = today;
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  switch (name) {
    case 'today':
      return today;
    case 'yesterday':
      return addDays(today, -1);
    case 'tomorrow':
      return addDays(today, 1);
    case 'month_start':
      return { year, month, day: 1 };
    case 'month_end':
      return { year, month, day: daysInMonth(year, month) };
    case 'last_month_start':
      return { ...prev, day: 1 };
    case 'last_month_end':
      return { ...prev, day: daysInMonth(prev.year, prev.month) };
    case 'last_business_day': {
      const skip = new Set(skipDates);
      let d = addDays(today, -1);
      while (!isBusinessDay(d, skip)) d = addDays(d, -1);
      return d;
    }
  }
}

/**
 * Replace date placeholders in a value with dates for `now`, in `format`. Throws
 * `UnknownPlaceholderError` for a placeholder ShowSteps doesn't know (saving a schedule rejects
 * those first, so a run never meets one).
 */
export function resolveTokens(
  value: string,
  now: Date,
  dateFormat: string = DEFAULT_DATE_FORMAT,
  options: { zone?: Zone; skipDates?: readonly string[] } = {},
): string {
  const unknown = unknownPlaceholders(value);
  if (unknown[0] !== undefined) throw new UnknownPlaceholderError(unknown[0]);
  if (!hasPlaceholders(value)) return value;
  const parts = (options.zone ?? systemZone()).partsOf(now);
  const today = { year: parts.year, month: parts.month, day: parts.day };
  return value.replace(TOKEN, (_, name: string) =>
    formatDate(placeholderDate(name as Placeholder, today, options.skipDates), dateFormat),
  );
}
