import { guideSteps, planStep, runFields } from '../guidance/plan.js';
import { createId, nowIso } from '../ids.js';
import type { Guide } from '../schema.js';
import { resolveTokens } from './placeholders.js';
import { SCHEDULE_DEFAULTS, ScheduleSchema, type Recurrence, type Schedule } from './schema.js';
import { guideVersion } from './version.js';
import type { Zone } from './zone.js';

/** Whether a guide can be scheduled: Run for me needs at least one browser step. */
export function canSchedule(guide: Guide): boolean {
  return guideSteps(guide).some((s) => s.app.kind === 'web');
}

/** Guides with Windows desktop steps need the person there: they ask "Start now?" instead. */
export function needsPerson(guide: Guide): boolean {
  return guideSteps(guide).some((s) => planStep(s).kind === 'manual' && s.app.kind === 'desktop');
}

/** A new schedule for a guide, with the plan's defaults. */
export function createSchedule(
  guide: Guide,
  init: { recurrence: Recurrence; time: string } & Partial<Schedule>,
): Schedule {
  const fields = runFields(guide);
  return ScheduleSchema.parse({
    ...SCHEDULE_DEFAULTS,
    id: createId(),
    guideId: guide.id,
    name: guide.title.trim() || 'Untitled guide',
    createdAt: nowIso(),
    values: Object.fromEntries(fields.map((f) => [f.key, f.defaultValue])),
    approvedConfirmSteps: { guideVersion: '', stepIds: [] },
    ...init,
    guideVersion: guideVersion(guide),
  });
}

/** Store approvals for the guide as it is now. Only steps flagged confirm can be approved. */
export function withApprovals(schedule: Schedule, guide: Guide, stepIds: string[]): Schedule {
  const confirm = new Set(
    guideSteps(guide)
      .filter((s) => s.agent.confirm)
      .map((s) => s.id),
  );
  return {
    ...schedule,
    approvedConfirmSteps: {
      guideVersion: guideVersion(guide),
      stepIds: stepIds.filter((id) => confirm.has(id)),
    },
  };
}

/**
 * The values a run types: each run field's saved answer with placeholders resolved for `now`.
 * Only the guide's current run fields are used, so sensitive inputs never get a value.
 */
export function resolveValues(
  schedule: Schedule,
  guide: Guide,
  now: Date,
  zone?: Zone,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of runFields(guide)) {
    const raw = schedule.values[field.key] ?? field.defaultValue;
    out[field.key] = resolveTokens(raw, now, schedule.dateFormat, {
      ...(zone ? { zone } : {}),
      skipDates: schedule.skipDates,
    });
  }
  return out;
}
