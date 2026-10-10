// U4: typed values that probably change every time (numbers, dates, IDs, emails) are suggested
// as "ask every run"; turning one into a variable names it after its field.
import { toPlainText } from '../richText.js';
import { writeStepTitle } from '../stepText.js';
import type { Guide, InputMode, Step, Variable } from '../schema.js';

export type ValueKind = 'number' | 'date' | 'id' | 'email';

const PATTERNS: [ValueKind, RegExp][] = [
  ['email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/],
  ['date', /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})$/],
  ['number', /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/],
  // Letters and digits together, such as INV-1043 or PO2026-77.
  ['id', /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9_./-]{2,39}$/],
];

/** What kind of changing value a typed text looks like, if any. */
export function valueKind(value: string): ValueKind | undefined {
  const v = value.trim();
  return PATTERNS.find(([, re]) => re.test(v))?.[0];
}

/** A typed value worth asking for every run (a fixed value that looks like data). */
export function suggestAsk(step: Step): ValueKind | undefined {
  const input = step.input;
  if (step.action !== 'type' || !input || input.sensitive || input.variable) return undefined;
  if (input.mode !== 'fixed' || !input.value) return undefined;
  return valueKind(input.value);
}

/** "Invoice no." → "invoice_no"; unique within the guide. */
export function variableName(guide: Guide, label: string): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, 'v_$1')
      .slice(0, 40) || 'value';
  const taken = new Set(guide.variables.map((v) => v.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** The field a step types into, for labels and variable names. */
export function fieldLabel(step: Step): string {
  const t = step.target;
  return t?.label ?? t?.name ?? t?.placeholder ?? t?.uia?.name ?? 'Value';
}

/**
 * Set how a step's typed value is used. "ask" and "default" make it a named variable (so the
 * Agent Pack and the replay script can fill it); "fixed" keeps the recorded text.
 */
export function setInputMode(guide: Guide, stepId: string, mode: InputMode): Guide {
  const step = guide.blocks.find((b): b is Step => b.kind === 'step' && b.id === stepId);
  if (!step?.input) return guide;
  const input = step.input;
  let variables = guide.variables;
  let variable = input.variable;
  if (mode !== 'fixed' && !variable) {
    variable = variableName(guide, fieldLabel(step));
    const v: Variable = {
      name: variable,
      label: fieldLabel(step),
      sensitive: input.sensitive,
      ...(!input.sensitive && input.value ? { example: input.value } : {}),
    };
    variables = [...variables, v];
  }
  if (variable && !input.sensitive) {
    variables = variables.map((v) => {
      if (v.name !== variable) return v;
      const { defaultValue: _d, ...rest } = v;
      return mode === 'default' && input.value ? { ...rest, defaultValue: input.value } : rest;
    });
  }
  const nextInput = { ...input, mode, ...(mode !== 'fixed' && variable ? { variable } : {}) };
  if (mode === 'fixed') delete nextInput.variable;
  const used = new Set(
    guide.blocks.flatMap((b) =>
      b.kind === 'step' && b.id !== stepId && b.input?.variable ? [b.input.variable] : [],
    ),
  );
  if (mode === 'fixed')
    variables = variables.filter((v) => v.name !== input.variable || used.has(v.name));
  return {
    ...guide,
    variables,
    blocks: guide.blocks.map((b) => {
      if (b.kind !== 'step' || b.id !== stepId) return b;
      const next = { ...b, input: nextInput };
      // Keep a title the author wrote; refresh one Trailmark wrote.
      const written = toPlainText(writeStepTitle(b)) === toPlainText(b.human.title);
      return written ? { ...next, human: { ...next.human, title: writeStepTitle(next) } } : next;
    }),
  };
}

/**
 * Mark a step's value sensitive (or not). Marking it removes the recorded value from the step,
 * its title and its variable, as for passwords; unmarking cannot bring the value back.
 */
export function markSensitive(guide: Guide, stepId: string, sensitive: boolean): Guide {
  const step = guide.blocks.find((b): b is Step => b.kind === 'step' && b.id === stepId);
  if (!step?.input || step.input.sensitive === sensitive) return guide;
  const old = step.input.value;
  const { value: _v, ...rest } = step.input;
  const input = sensitive ? { ...rest, sensitive } : { ...step.input, sensitive };
  const next: Step = { ...step, input };
  if (sensitive) {
    const written = toPlainText(writeStepTitle(step)) === toPlainText(step.human.title);
    next.human = {
      ...step.human,
      title: written
        ? writeStepTitle(next)
        : {
            spans: step.human.title.spans.map((sp) =>
              old ? { ...sp, text: sp.text.split(old).join('•••') } : sp,
            ),
          },
    };
  }
  return {
    ...guide,
    variables: guide.variables.map((v) => {
      if (v.name !== step.input?.variable) return v;
      if (!sensitive) return { ...v, sensitive };
      const { example: _e, defaultValue: _d, ...kept } = v;
      return { ...kept, sensitive };
    }),
    blocks: guide.blocks.map((b) => (b.kind === 'step' && b.id === stepId ? next : b)),
  };
}
