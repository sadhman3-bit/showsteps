// The agent-readable copy of a guide: structured steps without screenshots or secrets, written
// into the Agent Pack (U2) and embedded in every human export (U3). It describes the procedure;
// it never addresses whoever reads it.
import { stepNumbers } from '../editor/ops.js';
import { toPlainText } from '../richText.js';
import { SCHEMA_VERSION } from '../version.js';
import type { AppRef, Expectation, Guide, InputMode, Step, Target } from '../schema.js';
import { fieldLabel, variableName } from './variables.js';

export const PROCEDURE_FORMAT = 'showsteps-procedure';
/** Formats written before the product was named ShowSteps; readers still accept them. */
export const LEGACY_PROCEDURE_FORMATS = ['trailmark-procedure'] as const;

/** True for a procedure written by this or an earlier version under its former name. */
export function isProcedureFormat(format: unknown): boolean {
  return (
    format === PROCEDURE_FORMAT || (LEGACY_PROCEDURE_FORMATS as readonly unknown[]).includes(format)
  );
}

export interface ProcedureVariable {
  name: string;
  label: string;
  description?: string;
  /** A sample value (never for sensitive variables). */
  example?: string;
  defaultValue?: string;
  sensitive: boolean;
}

export interface ProcedureTarget {
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  text?: string;
  testId?: string;
  /** Other ways to find the element, most reliable first. */
  selectors: { type: string; value: string; score: number }[];
  /** CSS selectors of the iframes to go through, outermost first. */
  frames?: string[];
  /** CSS selectors of the shadow hosts to go through, outermost first. */
  shadowHosts?: string[];
  uia?: Target['uia'];
  /** Text read from the screenshot around the action (visual-only steps). */
  ocrText?: string;
}

export interface ProcedureStep {
  number: number;
  id: string;
  /** The heading this step sits under. */
  section?: string;
  action: Step['action'];
  instruction: string;
  description?: string;
  /** Callouts written just before this step. */
  notes?: string[];
  app: Step['app'];
  target?: ProcedureTarget;
  input?: { mode: InputMode; variable?: string; value?: string; sensitive: boolean };
  key?: string;
  expect: Expectation[];
  /** What happens when the step cannot be done. */
  onFailure: string;
  /** A person approves this step before it is done (it cannot be undone). */
  confirm: boolean;
  /** No reliable element information: only the screenshot (and OCR text) show the target. */
  visualOnly: boolean;
  timeoutMs: number;
  /**
   * Where the target was on the recorded screen, as fractions (0 to 1) of the screenshot's
   * width and height: for agents that work from screenshots and the pointer.
   */
  screen?: { x: number; y: number; w: number; h: number };
}

const frac = (n: number) => Math.round(n * 1000) / 1000;

function screenBox(step: Step): ProcedureStep['screen'] {
  // The Action Box is in the pixels of the step's screenshot (the one the pack ships).
  const box = step.human.actionBox;
  const shot = step.human.screenshot;
  if (!box || !shot || shot.width <= 0 || shot.height <= 0) return undefined;
  return {
    x: frac(box.x / shot.width),
    y: frac(box.y / shot.height),
    w: frac(box.w / shot.width),
    h: frac(box.h / shot.height),
  };
}

export interface Procedure {
  format: typeof PROCEDURE_FORMAT;
  schemaVersion: number;
  title: string;
  description?: string;
  preconditions: string[];
  success?: string;
  apps: AppRef[];
  variables: ProcedureVariable[];
  steps: ProcedureStep[];
}

export const DEFAULT_ON_FAILURE =
  'The procedure stops here: the target was not found or the expected result did not appear.';

function target(t: Target): ProcedureTarget {
  return {
    ...(t.role ? { role: t.role } : {}),
    ...(t.name ? { name: t.name } : {}),
    ...(t.label ? { label: t.label } : {}),
    ...(t.placeholder ? { placeholder: t.placeholder } : {}),
    ...(t.text ? { text: t.text } : {}),
    ...(t.testId ? { testId: t.testId } : {}),
    selectors: [...t.selectors].sort((a, b) => b.score - a.score),
    ...(t.frames?.length ? { frames: t.frames } : {}),
    ...(t.shadowHosts?.length ? { shadowHosts: t.shadowHosts } : {}),
    ...(t.uia ? { uia: t.uia } : {}),
    ...(t.ocrText ? { ocrText: t.ocrText } : {}),
  };
}

/**
 * The guide as a procedure. Secret inputs (passwords, one-time codes) get a sensitive variable
 * so whoever runs the procedure supplies the value; their values are never stored anyway.
 */
export function toProcedure(guide: Guide): Procedure {
  const numbers = stepNumbers(guide);
  const variables: ProcedureVariable[] = guide.variables.map((v) => ({
    name: v.name,
    label: v.label,
    ...(v.description ? { description: v.description } : {}),
    ...(!v.sensitive && v.example ? { example: v.example } : {}),
    ...(!v.sensitive && v.defaultValue ? { defaultValue: v.defaultValue } : {}),
    sensitive: v.sensitive,
  }));
  // Names for secret inputs, unique alongside the guide's own variables.
  const named = { ...guide, variables: [...guide.variables] };
  const steps: ProcedureStep[] = [];
  let section: string | undefined;
  let notes: string[] = [];
  for (const b of guide.blocks) {
    if (b.kind === 'heading') {
      section = b.text;
      continue;
    }
    if (b.kind === 'callout') {
      notes.push(b.text);
      continue;
    }
    let input: ProcedureStep['input'];
    if (b.input) {
      let variable = b.input.variable;
      // Secrets, and values asked for every run, are variables the runner fills in.
      if ((b.input.sensitive || b.input.mode !== 'fixed') && !variable) {
        variable = variableName(named, fieldLabel(b));
        const v: ProcedureVariable = {
          name: variable,
          label: fieldLabel(b),
          sensitive: b.input.sensitive,
        };
        if (!b.input.sensitive && b.input.value !== undefined) {
          if (b.input.mode === 'default') v.defaultValue = b.input.value;
          else v.example = b.input.value;
        }
        named.variables.push({ name: variable, label: v.label, sensitive: v.sensitive });
        variables.push(v);
      }
      input = {
        mode: b.input.sensitive ? 'ask' : b.input.mode,
        ...(variable ? { variable } : {}),
        ...(!b.input.sensitive && b.input.value !== undefined && !variable
          ? { value: b.input.value }
          : {}),
        sensitive: b.input.sensitive,
      };
    }
    const description = b.human.description ? toPlainText(b.human.description) : '';
    steps.push({
      number: numbers.get(b.id) ?? steps.length + 1,
      id: b.id,
      ...(section ? { section } : {}),
      action: b.action,
      instruction: toPlainText(b.human.title),
      ...(description ? { description } : {}),
      ...(notes.length ? { notes } : {}),
      app: b.app,
      ...(b.target ? { target: target(b.target) } : {}),
      ...(input ? { input } : {}),
      ...(b.key ? { key: b.key } : {}),
      expect: b.agent.expect ?? [],
      onFailure: b.agent.onFailure?.trim() || DEFAULT_ON_FAILURE,
      confirm: b.agent.confirm,
      visualOnly: b.agent.visualOnly,
      timeoutMs: b.agent.timeoutMs,
      ...(screenBox(b) ? { screen: screenBox(b) } : {}),
    });
    notes = [];
  }
  return {
    format: PROCEDURE_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    title: guide.title,
    ...(guide.description ? { description: guide.description } : {}),
    preconditions: guide.preconditions,
    ...(guide.success ? { success: guide.success } : {}),
    apps: guide.apps,
    variables,
    steps,
  };
}

/** Pretty JSON for files; `</` is escaped so it can sit inside an HTML script element. */
export function procedureJson(procedure: Procedure): string {
  return JSON.stringify(procedure, null, 2).replace(/<\//g, '<\\/');
}
