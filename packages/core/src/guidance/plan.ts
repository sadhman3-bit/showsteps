import { toPlainText } from '../richText.js';
import type { Guide, Step } from '../schema.js';

/**
 * How Guide Me and Run for me treat a step:
 * - `navigate`: open the step's page;
 * - `act`: find the target (Guide Me highlights it; Run for me performs it);
 * - `manual`: the person does it (a manual or desktop step, a secret, a file upload, a step
 *   without element information). Run for me always stops for these.
 */
export type StepPlan =
  | { kind: 'navigate'; url: string }
  | { kind: 'act' }
  | { kind: 'manual'; reason: 'manual' | 'secret' | 'upload' | 'desktop' | 'no-target' };

export function planStep(step: Step): StepPlan {
  if (step.app.kind === 'desktop') return { kind: 'manual', reason: 'desktop' };
  if (step.action === 'navigate') return { kind: 'navigate', url: step.app.url };
  if (step.action === 'manual' || step.action === 'wait')
    return { kind: 'manual', reason: 'manual' };
  if (step.action === 'upload') return { kind: 'manual', reason: 'upload' };
  if (step.input?.sensitive) return { kind: 'manual', reason: 'secret' };
  if (step.action === 'key' && !step.target) return { kind: 'act' };
  if (!step.target || step.agent.visualOnly) return { kind: 'manual', reason: 'no-target' };
  return { kind: 'act' };
}

export function guideSteps(guide: Guide): Step[] {
  return guide.blocks.filter((b): b is Step => b.kind === 'step');
}

/** A value Run for me asks for once at the start. */
export interface RunField {
  /** Variable name, or the step id for an unnamed "ask" input. */
  key: string;
  label: string;
  defaultValue: string;
  description?: string;
}

/**
 * Values to ask for before Run for me starts: inputs set to "ask every run" or "ask with a
 * default", and named variables. Secrets are never asked for: those steps stay manual.
 */
export function runFields(guide: Guide): RunField[] {
  const out: RunField[] = [];
  const seen = new Set<string>();
  for (const step of guideSteps(guide)) {
    const input = step.input;
    if (!input || input.sensitive) continue;
    if (input.mode === 'fixed' && !input.variable) continue;
    const key = input.variable ?? step.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const variable = guide.variables.find((v) => v.name === input.variable);
    if (variable?.sensitive) continue;
    out.push({
      key,
      label: variable?.label ?? toPlainText(step.human.title),
      defaultValue: input.mode === 'ask' ? '' : (variable?.defaultValue ?? input.value ?? ''),
      ...(variable?.description ? { description: variable.description } : {}),
    });
  }
  return out;
}

/** The value Run for me types or selects for a step. */
export function valueFor(step: Step, values: Record<string, string>): string | undefined {
  const input = step.input;
  if (!input || input.sensitive) return undefined;
  const key = input.variable ?? step.id;
  return values[key] ?? input.value;
}
