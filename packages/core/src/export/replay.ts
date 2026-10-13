// U10: a Playwright test that replays a guide's web steps. Elements are found by role and
// name, label or text first and by CSS last; variables come from environment variables; steps
// marked to confirm stop the run unless TRAILMARK_ALLOW_CONFIRM=1.
import type { Procedure, ProcedureStep, ProcedureTarget } from '../agent/procedure.js';
import type { Expectation } from '../schema.js';

const q = (s: string) => JSON.stringify(s);

/** TM_INVOICE_NO for the variable invoice_no. */
export function envName(variable: string): string {
  return `TM_${variable.toUpperCase()}`;
}

/** Playwright's names for keys: "Ctrl+S" → "Control+S". */
function playwrightKey(key: string): string {
  return key
    .split('+')
    .map((k) => (k === 'Ctrl' ? 'Control' : k === 'Esc' ? 'Escape' : k === 'Del' ? 'Delete' : k))
    .join('+');
}

/** The expression that finds a target: frames first, then role, label, text, test id, CSS. */
export function locatorFor(target: Partial<ProcedureTarget>, root = 'page'): string {
  let scope = root;
  for (const frame of target.frames ?? []) scope = `${scope}.frameLocator(${q(frame)})`;
  if (target.role && target.name)
    return `${scope}.getByRole(${q(target.role)}, { name: ${q(target.name)}, exact: true })`;
  if (target.label) return `${scope}.getByLabel(${q(target.label)}, { exact: true })`;
  if (target.text) return `${scope}.getByText(${q(target.text)}, { exact: true })`;
  if (target.testId) return `${scope}.getByTestId(${q(target.testId)})`;
  if (target.placeholder)
    return `${scope}.getByPlaceholder(${q(target.placeholder)}, { exact: true })`;
  const css = target.selectors?.find((s) => s.type === 'css');
  if (css) return `${scope}.locator(${q(css.value)})`;
  const xpath = target.selectors?.find((s) => s.type === 'xpath');
  if (xpath) return `${scope}.locator(${q(`xpath=${xpath.value}`)})`;
  if (target.role) return `${scope}.getByRole(${q(target.role)})`;
  return `${scope}.locator('body')`;
}

/** `frames`: the step's iframe chain, for expectations that hold inside its iframe. */
function expectation(e: Expectation, timeout: number, frames: string[] = []): string | undefined {
  const within = 'inFrame' in e && e.inFrame ? frames : [];
  const scope = within.reduce((s, f) => `${s}.frameLocator(${q(f)})`, 'page');
  switch (e.type) {
    case 'url':
      return `await expect(page).toHaveURL(new RegExp(${q(e.matches)}), { timeout: ${timeout} });`;
    case 'visible':
      return `await expect(${locatorFor({ ...e.target, frames: within })}.first()).toBeVisible({ timeout: ${timeout} });`;
    case 'hidden':
      return `await expect(${locatorFor({ ...e.target, frames: within })}).toHaveCount(0, { timeout: ${timeout} });`;
    case 'text':
      return `await expect(${scope}.getByText(${q(e.contains)}).first()).toBeVisible({ timeout: ${timeout} });`;
    case 'window':
      return undefined; // desktop windows are outside the browser
  }
}

function valueExpr(step: ProcedureStep): string | undefined {
  const input = step.input;
  if (!input) return undefined;
  if (input.variable) return `value(${q(input.variable)})`;
  return input.value !== undefined ? q(input.value) : undefined;
}

function stepCode(step: ProcedureStep): string[] {
  const lines = [`// ${step.number}. ${step.instruction.replace(/\n/g, ' ')}`];
  if (step.app.kind === 'desktop') {
    lines.push(
      `test.info().annotations.push({ type: 'manual', description: ${q(`Step ${step.number} is in ${step.app.processName}, outside the browser`)} });`,
    );
    return lines;
  }
  if (step.confirm) {
    lines.push(
      `if (!allowConfirm) {`,
      `  test.info().annotations.push({ type: 'stopped', description: ${q(`Step ${step.number} needs confirmation: set TRAILMARK_ALLOW_CONFIRM=1 to do it`)} });`,
      `  return;`,
      `}`,
    );
  }
  const timeout = step.timeoutMs;
  const el = step.target ? locatorFor(step.target) : undefined;
  const v = valueExpr(step);
  switch (step.action) {
    case 'navigate':
      lines.push(`await page.goto(${q(step.app.url)});`);
      break;
    case 'click':
      if (el) lines.push(`await ${el}.click({ timeout: ${timeout} });`);
      break;
    case 'double_click':
      if (el) lines.push(`await ${el}.dblclick({ timeout: ${timeout} });`);
      break;
    case 'right_click':
      if (el) lines.push(`await ${el}.click({ button: 'right', timeout: ${timeout} });`);
      break;
    case 'hover':
      if (el) lines.push(`await ${el}.hover({ timeout: ${timeout} });`);
      break;
    case 'type':
      if (el && v) lines.push(`await ${el}.fill(${v}, { timeout: ${timeout} });`);
      break;
    case 'select':
      if (el && v) lines.push(`await ${el}.selectOption(${v}, { timeout: ${timeout} });`);
      break;
    case 'check':
      if (el)
        lines.push(
          step.input?.value === 'false'
            ? `await ${el}.uncheck({ timeout: ${timeout} });`
            : `await ${el}.check({ timeout: ${timeout} });`,
        );
      break;
    case 'key':
      if (step.key) {
        if (el)
          lines.push(`await ${el}.press(${q(playwrightKey(step.key))}, { timeout: ${timeout} });`);
        else lines.push(`await page.keyboard.press(${q(playwrightKey(step.key))});`);
      }
      break;
    case 'upload':
      if (el) lines.push(`await ${el}.setInputFiles(file(${q(`step_${step.number}`)}));`);
      break;
    case 'scroll':
      if (el) lines.push(`await ${el}.scrollIntoViewIfNeeded({ timeout: ${timeout} });`);
      break;
    case 'wait':
      lines.push(`await page.waitForTimeout(${Math.min(timeout, 10_000)});`);
      break;
    case 'manual':
      lines.push(
        `test.info().annotations.push({ type: 'manual', description: ${q(`Step ${step.number} is done by hand`)} });`,
      );
      break;
  }
  for (const e of step.expect) {
    const line = expectation(e, timeout, step.target?.frames);
    if (line) lines.push(line);
  }
  return lines;
}

/** `scripts/replay.spec.ts` for the Agent Pack. */
export function replaySpec(procedure: Procedure): string {
  const vars = procedure.variables;
  const uploads = procedure.steps.filter((s) => s.action === 'upload' && s.app.kind === 'web');
  const header = [
    `// Playwright replay of “${procedure.title.replace(/\n/g, ' ')}”, generated by ABCXYZ.`,
    '// Run: npx playwright test scripts/replay.spec.ts',
    ...(vars.length
      ? [
          '// Values come from environment variables:',
          ...vars.map(
            (v) =>
              `//   ${envName(v.name)}: ${v.label}${v.sensitive ? ' (sensitive, required)' : ''}${(v.defaultValue ?? v.example) ? `, default ${JSON.stringify(v.defaultValue ?? v.example)}` : ''}`,
          ),
        ]
      : []),
    ...uploads.map(
      (s) =>
        `//   ${envName(`file_step_${s.number}`)}: path of the file to upload in step ${s.number}`,
    ),
    '// Steps marked to confirm stop the run unless TRAILMARK_ALLOW_CONFIRM=1 is set.',
    '',
    "import { expect, test } from '@playwright/test';",
    '',
    `const defaults: Record<string, string> = ${JSON.stringify(
      Object.fromEntries(
        vars
          .filter((v) => !v.sensitive && (v.defaultValue ?? v.example) !== undefined)
          .map((v) => [v.name, v.defaultValue ?? v.example]),
      ),
    )};`,
    "const allowConfirm = process.env.TRAILMARK_ALLOW_CONFIRM === '1';",
    '',
    'function value(name: string): string {',
    '  const v = process.env[`TM_${name.toUpperCase()}`] ?? defaults[name];',
    '  if (v === undefined) throw new Error(`Set TM_${name.toUpperCase()} to run this procedure`);',
    '  return v;',
    '}',
    ...(uploads.length
      ? [
          '',
          'function file(name: string): string {',
          '  const v = process.env[`TM_FILE_${name.toUpperCase()}`];',
          '  if (!v) throw new Error(`Set TM_FILE_${name.toUpperCase()} to the file to upload`);',
          '  return v;',
          '}',
        ]
      : []),
    '',
  ];
  const total = procedure.steps.reduce((ms, s) => ms + s.timeoutMs, 0);
  const body = procedure.steps.flatMap((s) => [...stepCode(s), '']);
  return [
    ...header,
    `test(${q(procedure.title)}, async ({ page }) => {`,
    `  test.setTimeout(${Math.max(60_000, total)});`,
    ...body.map((l) => (l ? `  ${l}` : '')),
    '});',
    '',
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n\n\}\);\n$/, '\n});\n');
}
