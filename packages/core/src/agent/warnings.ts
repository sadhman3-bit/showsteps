// U1: what an agent would struggle with, per step, for the editor's Agent view.
import { planStep } from '../guidance/plan.js';
import { stepNumbers } from '../editor/ops.js';
import type { Guide, Step } from '../schema.js';
import { needsConfirm } from './confirm.js';
import { suggestAsk } from './variables.js';

export type AgentWarningKind =
  /** A web step whose best way to find the element is fragile (no role and name, low score). */
  | 'no-stable-selector'
  /** Only the screenshot shows what to do (remote desktop, canvas, no element details). */
  | 'visual-only'
  /** An action with no element information at all. */
  | 'no-target'
  /** The control's name sounds irreversible but the step does not ask for confirmation. */
  | 'unconfirmed'
  /** A fixed typed value that looks like data that changes (a number, date, ID or email). */
  | 'fixed-value';

export interface AgentWarning {
  stepId: string;
  number: number;
  kind: AgentWarningKind;
}

/** Selector score below which a step counts as fragile when there is no role and name. */
export const STABLE_SCORE = 0.6;

export function hasStableSelector(step: Step): boolean {
  const t = step.target;
  if (!t) return false;
  if (step.app.kind === 'desktop') return !!(t.uia?.automationId || t.uia?.name);
  if (t.role && t.name) return true;
  return t.selectors.some((s) => s.score >= STABLE_SCORE);
}

export function stepWarnings(step: Step): AgentWarningKind[] {
  const out: AgentWarningKind[] = [];
  const plan = planStep(step);
  if (step.agent.visualOnly) out.push('visual-only');
  else if (plan.kind === 'manual' && plan.reason === 'no-target') out.push('no-target');
  else if (step.target && !hasStableSelector(step)) out.push('no-stable-selector');
  if (!step.agent.confirm && needsConfirm(step)) out.push('unconfirmed');
  if (suggestAsk(step)) out.push('fixed-value');
  return out;
}

export function agentWarnings(guide: Guide): AgentWarning[] {
  const numbers = stepNumbers(guide);
  return guide.blocks.flatMap((b) =>
    b.kind === 'step'
      ? stepWarnings(b).map((kind) => ({ stepId: b.id, number: numbers.get(b.id) ?? 0, kind }))
      : [],
  );
}
