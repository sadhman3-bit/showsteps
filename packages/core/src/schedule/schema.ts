import { z } from 'zod';
import { DEFAULT_DATE_FORMAT, isDateFormat, unknownPlaceholders } from './placeholders.js';

/**
 * Schedules and their run logs live only in this browser profile (extension storage). They are
 * never part of a guide, an export, a `.showsteps` file or a team folder.
 */

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-MM-dd');

export const RecurrenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily') }),
  /** Monday to Friday. */
  z.object({ kind: z.literal('weekdays') }),
  /** Chosen days, 0 = Sunday … 6 = Saturday. */
  z.object({
    kind: z.literal('weekly'),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  }),
  /** Day 1–31, clamped to the month's last day. */
  z.object({ kind: z.literal('monthly-day'), day: z.number().int().min(1).max(31) }),
  /** The 1st–5th or last business day (Monday to Friday, minus `skipDates`). */
  z.object({
    kind: z.literal('monthly-business-day'),
    nth: z.union([z.number().int().min(1).max(5), z.literal('last')]),
  }),
]);
export type Recurrence = z.infer<typeof RecurrenceSchema>;

export const ScheduleSchema = z
  .object({
    id: z.string().min(1).max(64),
    guideId: z.string().min(1),
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean(),
    createdAt: z.string(),
    /** `guideVersion()` of the guide when the schedule was last saved. */
    guideVersion: z.string().min(1),
    recurrence: RecurrenceSchema,
    /** Local `HH:mm`. */
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm'),
    skipDates: z.array(IsoDate).max(366),
    missedRun: z.enum(['run-at-start', 'skip']),
    /** Answers for the guide's run fields, keyed like `runFields`; may hold date placeholders. */
    values: z.record(z.string(), z.string().max(2000)),
    dateFormat: z.string().refine(isDateFormat, 'Not a date format'),
    /** Confirm steps that run without stopping, valid only for the guide version they name. */
    approvedConfirmSteps: z.object({
      guideVersion: z.string(),
      stepIds: z.array(z.string()),
    }),
    /** How long a stopped run waits for the person before it ends as stopped. */
    waitMinutes: z.number().int().min(1).max(240),
    keepWindowOpen: z.boolean(),
    /** Dry-run the guide with the self-check an hour before each run. */
    checkFirst: z.boolean(),
  })
  .superRefine((s, ctx) => {
    for (const [key, value] of Object.entries(s.values))
      for (const name of unknownPlaceholders(value))
        ctx.addIssue({
          code: 'custom',
          path: ['values', key],
          message: `Unknown placeholder {${name}}`,
        });
  });
export type Schedule = z.infer<typeof ScheduleSchema>;

export const SCHEDULE_DEFAULTS = {
  enabled: true,
  skipDates: [] as string[],
  missedRun: 'run-at-start' as const,
  dateFormat: DEFAULT_DATE_FORMAT,
  waitMinutes: 30,
  keepWindowOpen: false,
  checkFirst: false,
};

export const RUN_OUTCOMES = ['completed', 'stopped', 'failed', 'skipped', 'missed'] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

export const RunStepLogSchema = z.object({
  stepId: z.string(),
  /** 1-based step number in the guide. */
  number: z.number().int().positive(),
  status: z.enum(['done', 'confirmed', 'manual', 'stopped', 'failed']),
  at: z.string(),
  /** Name of the screenshot in the run-log store, taken after the step. */
  screenshot: z.string().optional(),
  /** An attach step: the file put in the upload field (never its contents). */
  file: z
    .object({
      name: z.string().max(255),
      size: z.number().int().nonnegative(),
      /** The host the file was downloaded from. */
      from: z.string().max(255).optional(),
      /** The step number that downloaded it. */
      step: z.number().int().positive().optional(),
    })
    .optional(),
});
export type RunStepLog = z.infer<typeof RunStepLogSchema>;

export const RunLogSchema = z.object({
  id: z.string().min(1).max(64),
  scheduleId: z.string().min(1),
  guideId: z.string().min(1),
  startedAt: z.string(),
  /** Absent while the run is still going. */
  finishedAt: z.string().optional(),
  outcome: z.enum(RUN_OUTCOMES).optional(),
  /** Why a run stopped, failed, was skipped or missed (`busy`, `sign-in`, `confirm`, …). */
  reason: z.string().max(200).optional(),
  steps: z.array(RunStepLogSchema),
  /** The values typed, after placeholders were resolved. Never sensitive values. */
  values: z.record(z.string(), z.string()),
});
export type RunLog = z.infer<typeof RunLogSchema>;

/** Runs kept per schedule. */
export const MAX_RUN_LOGS = 20;

/** Keep the newest `MAX_RUN_LOGS` of one schedule; returns the ids to delete. */
export function runLogsToDrop(logs: readonly RunLog[]): string[] {
  return [...logs]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(MAX_RUN_LOGS)
    .map((l) => l.id);
}

export function parseSchedules(raw: unknown): Schedule[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const r = ScheduleSchema.safeParse(item);
    return r.success ? [r.data] : [];
  });
}
