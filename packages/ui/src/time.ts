import { strings } from './strings.js';

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 days ago", "just now". */
export function relativeTime(iso: string, now: number = Date.now(), locale?: string): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  if (!Number.isFinite(seconds)) return '';
  if (Math.abs(seconds) < 45) return strings.time.justNow;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size || unit === 'minute')
      return rtf.format(Math.round(seconds / size), unit);
  }
  return '';
}
