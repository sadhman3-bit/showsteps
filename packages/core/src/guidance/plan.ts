import { toPlainText } from '../richText.js';
import type { Guide, Step, StepInput } from '../schema.js';

/**
 * How Guide Me and Run for me treat a step:
 * - `navigate`: open the step's page;
 * - `act`: find the target (Guide Me highlights it; Run for me performs it);
 * - `attach`: an upload step set to use a file this run downloaded. Guide Me treats it like an
 *   upload (the person picks the file); Run for me attaches the file when it has it;
 * - `manual`: the person does it (a manual or desktop step, a secret, a file upload, a step
 *   without element information). Run for me always stops for these.
 */
export type StepPlan =
  | { kind: 'navigate'; url: string }
  | { kind: 'act' }
  | { kind: 'attach'; from: AttachSource }
  | { kind: 'manual'; reason: 'manual' | 'secret' | 'upload' | 'desktop' | 'no-target' };

/** Where an attach step's file comes from: the run's newest download, or a step's (its ID). */
export type AttachSource = NonNullable<StepInput['from']>;

export function planStep(step: Step): StepPlan {
  if (step.app.kind === 'desktop') return { kind: 'manual', reason: 'desktop' };
  if (step.action === 'navigate') return { kind: 'navigate', url: step.app.url };
  if (step.action === 'manual' || step.action === 'wait')
    return { kind: 'manual', reason: 'manual' };
  if (step.action === 'upload')
    return step.input?.from && step.target
      ? { kind: 'attach', from: step.input.from }
      : { kind: 'manual', reason: 'upload' };
  if (step.input?.sensitive) return { kind: 'manual', reason: 'secret' };
  if (step.action === 'key' && !step.target) return { kind: 'act' };
  if (!step.target || step.agent.visualOnly) return { kind: 'manual', reason: 'no-target' };
  return { kind: 'act' };
}

export function guideSteps(guide: Guide): Step[] {
  return guide.blocks.filter((b): b is Step => b.kind === 'step');
}

/**
 * Whether an attach step's source is usable: `latest`, or a step that comes before it. A source
 * step that was deleted or moved after it is broken, and the step is treated as a plain upload.
 */
export function attachSourceValid(guide: Guide, step: Step): boolean {
  const from = step.input?.from;
  if (!from) return false;
  if (from.download === 'latest') return true;
  const steps = guideSteps(guide);
  const at = steps.findIndex((s) => s.id === step.id);
  const source = steps.findIndex((s) => s.id === from.download);
  return source >= 0 && source < at;
}

/** `planStep`, with a broken attach source falling back to a plain upload. */
export function planGuideStep(guide: Guide, step: Step): StepPlan {
  const plan = planStep(step);
  return plan.kind === 'attach' && !attachSourceValid(guide, step)
    ? { kind: 'manual', reason: 'upload' }
    : plan;
}

/** Whether any step after `index` (in `guideSteps` order) attaches a downloaded file. */
export function attachAhead(guide: Guide, index: number): boolean {
  return guideSteps(guide)
    .slice(index + 1)
    .some((s) => planGuideStep(guide, s).kind === 'attach');
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
