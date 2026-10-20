import { guideSteps } from '../guidance/plan.js';
import type { Guide } from '../schema.js';
import type { Schedule } from './schema.js';

/** JSON with object keys sorted, so the same content always gives the same text. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** cyrb53: a fast 53-bit string hash (not for security; it only detects change). */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * A fingerprint of what Run for me does with a guide: each step's id, action, page, target,
 * input and confirm flag, in order. Titles, pictures and annotations don't count, so tidying the
 * written guide keeps a schedule's approvals; any change to what gets clicked or typed drops them.
 */
export function guideVersion(guide: Guide): string {
  const steps = guideSteps(guide).map((s) => ({
    id: s.id,
    action: s.action,
    app: s.app,
    key: s.key,
    target: s.target,
    input: s.input,
    confirm: s.agent.confirm,
  }));
  return hash53(stable(steps));
}

/** Confirm steps that run without stopping: the approvals, while the guide is unchanged. */
export function activeApprovals(schedule: Schedule, guide: Guide): Set<string> {
  const a = schedule.approvedConfirmSteps;
  if (!a.stepIds.length || a.guideVersion !== guideVersion(guide)) return new Set();
  const confirmSteps = new Set(
    guideSteps(guide)
      .filter((s) => s.agent.confirm)
      .map((s) => s.id),
  );
  return new Set(a.stepIds.filter((id) => confirmSteps.has(id)));
}

/** True when steps were approved for an earlier version of the guide ("Guide changed"). */
export function approvalsOutdated(schedule: Schedule, guide: Guide): boolean {
  const a = schedule.approvedConfirmSteps;
  return a.stepIds.length > 0 && a.guideVersion !== guideVersion(guide);
}
