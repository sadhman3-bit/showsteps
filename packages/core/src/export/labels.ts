/**
 * Text that exporters write into documents. UI text lives in `@trailmark/ui` strings; this is
 * the reader-facing wording inside exported files, kept in one place so it can be translated.
 */
export const EXPORT_LABELS = {
  step: (n: number) => `Step ${n}`,
  stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
  steps: (n: number) => (n === 1 ? '1 step' : `${n} steps`),
  updated: (date: string) => `Updated ${date}`,
  tone: { tip: 'Tip', note: 'Note', warning: 'Warning', alert: 'Alert' },
  contents: 'Contents',
  before: 'Before you start',
  success: 'You’re done when',
  previous: 'Previous',
  next: 'Next',
  top: 'Back to top',
  screenshotAlt: (n: number, title: string) => `Screenshot for step ${n}: ${title}`,
  page: (n: number, total: number) => `Page ${n} of ${total}`,
  noSteps: 'This guide has no steps yet.',
  /** U3: the visible line in every export that carries the structured procedure. */
  agentFooter: 'Agent-readable procedure embedded (Trailmark schema v1).',
  agentProcedure: 'Agent procedure',
  months: [
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
  ],
};

export type ExportLabels = typeof EXPORT_LABELS;

/** "10 October 2026" from an ISO timestamp (UTC date, so output never depends on the machine). */
export function formatDate(iso: string, labels: ExportLabels = EXPORT_LABELS): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${labels.months[d.getUTCMonth()] ?? ''} ${d.getUTCFullYear()}`;
}
