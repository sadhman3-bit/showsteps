// U2: the Agent Pack, a folder in the open Agent Skills layout:
//   <slug>/SKILL.md                      frontmatter (name, description), then the steps
//   <slug>/references/procedure.json     the full structured procedure
//   <slug>/assets/screenshots/step-NN.png  (optional)
//   <slug>/scripts/replay.spec.ts        Playwright replay of the web steps
import { strToU8, zipSync, type Zippable } from 'fflate';
import {
  procedureJson,
  toProcedure,
  type Procedure,
  type ProcedureStep,
  type ProcedureTarget,
} from '../agent/procedure.js';
import type { Expectation } from '../schema.js';
import { extensionFor, type ExportInput } from './model.js';
import { envName, replaySpec } from './replay.js';

export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1024;
export const SKILL_MD_MAX_LINES = 500;

/** Lowercase letters, digits and single hyphens, at most 64 characters. */
export function skillName(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SKILL_NAME_MAX)
    .replace(/-+$/, '');
  return slug || 'procedure';
}

/** What the procedure does and when to use it, at most 1024 characters, on one line. */
export function skillDescription(p: Procedure): string {
  const where = p.apps
    .map((a) => (a.kind === 'web' ? new URL(a.origin).host : a.processName))
    .join(', ');
  const what = p.description?.trim()
    ? p.description.trim().replace(/\s+/g, ' ')
    : `Step-by-step procedure: ${p.title}.`;
  const text = `${what} ${p.steps.length} steps${where ? ` in ${where}` : ''}. Use when asked to ${lowerFirst(p.title)}.`;
  return text.length <= SKILL_DESCRIPTION_MAX
    ? text
    : `${text.slice(0, SKILL_DESCRIPTION_MAX - 1)}…`;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const yamlString = (s: string) => JSON.stringify(s);
const code = (s: string) => `\`${s.replace(/`/g, 'ˋ')}\``;

export function describeTarget(t: Partial<ProcedureTarget>): string {
  const parts: string[] = [];
  if (t.role && t.name) parts.push(`${t.role} named ${code(t.name)}`);
  else if (t.role) parts.push(`a ${t.role}`);
  if (t.label && t.label !== t.name) parts.push(`label ${code(t.label)}`);
  if (t.placeholder) parts.push(`placeholder ${code(t.placeholder)}`);
  if (t.text && t.text !== t.name) parts.push(`text ${code(t.text)}`);
  if (t.testId) parts.push(`test id ${code(t.testId)}`);
  if (t.uia) {
    const u = t.uia;
    if (u.controlType && u.name) parts.push(`${u.controlType} named ${code(u.name)}`);
    if (u.automationId) parts.push(`automation id ${code(u.automationId)}`);
    if (u.windowTitle) parts.push(`in window ${code(u.windowTitle)}`);
  }
  const css = t.selectors?.find((s) => s.type === 'css');
  if (css) parts.push(`CSS ${code(css.value)}`);
  if (t.frames?.length) parts.push(`inside iframe ${t.frames.map(code).join(' → ')}`);
  if (t.shadowHosts?.length)
    parts.push(`inside shadow root of ${t.shadowHosts.map(code).join(' → ')}`);
  if (t.ocrText) parts.push(`near the text ${code(t.ocrText.slice(0, 80))}`);
  return parts.join('; ');
}

export function describeExpectation(e: Expectation): string {
  switch (e.type) {
    case 'url':
      return `the address matches ${code(e.matches)}`;
    case 'visible':
      return `${describeTarget(e.target) || 'the element'} is shown`;
    case 'hidden':
      return `${describeTarget(e.target) || 'the element'} is gone`;
    case 'text':
      return `the text ${code(e.contains)} appears`;
    case 'window':
      return `a window titled ${code(e.titleContains)} is open`;
  }
}

function inputLine(step: ProcedureStep, p: Procedure): string | undefined {
  const input = step.input;
  if (!input) return undefined;
  if (input.variable) {
    const v = p.variables.find((x) => x.name === input.variable);
    const how =
      input.mode === 'default' && v?.defaultValue
        ? `ask, default ${code(v.defaultValue)}`
        : input.sensitive
          ? 'sensitive: supplied by the person running it, never written down'
          : 'ask every run';
    return `Input: variable ${code(`{{${input.variable}}}`)} (${how})`;
  }
  return input.value !== undefined ? `Input: ${code(input.value)} (fixed)` : undefined;
}

function stepSection(step: ProcedureStep, p: Procedure, compact: boolean): string[] {
  const where =
    step.app.kind === 'web'
      ? step.action === 'navigate'
        ? ` (${step.app.url})`
        : ''
      : ` (Windows app ${code(step.app.processName)})`;
  const lines = [
    `${step.number}. ${step.confirm ? '**CONFIRM** ' : ''}${step.instruction.replace(/\n+/g, ' ')}${where}`,
  ];
  const sub: string[] = [];
  if (compact) {
    // Very long guides: one detail line per step; procedure.json has the rest.
    const detail = [step.target ? `Target: ${describeTarget(step.target)}` : '', inputLine(step, p)]
      .filter(Boolean)
      .join('. ');
    return [...lines, `   - ${detail || `On failure: ${step.onFailure}`}`];
  }
  for (const n of step.notes ?? []) sub.push(`Note: ${n.replace(/\n+/g, ' ')}`);
  if (step.description) sub.push(step.description.replace(/\n+/g, ' '));
  if (step.target) sub.push(`Target: ${describeTarget(step.target)}`);
  const input = inputLine(step, p);
  if (input) sub.push(input);
  if (step.key) sub.push(`Key: ${code(step.key)}`);
  if (step.expect.length)
    sub.push(`Expected result: ${step.expect.map(describeExpectation).join('; ')}`);
  sub.push(`On failure: ${step.onFailure}`);
  if (step.confirm)
    sub.push('Confirm: this step cannot be undone; a person approves it before it is done.');
  if (step.visualOnly)
    sub.push('Visual only: no reliable element details; the screenshot shows the target.');
  return [...lines, ...sub.map((s) => `   - ${s}`)];
}

/** SKILL.md: frontmatter, overview, variables, steps and the files in the pack. */
export function skillMarkdown(p: Procedure, name: string, screenshots: boolean): string {
  const full = skillMarkdownWith(p, name, screenshots, false);
  return full.split('\n').length < SKILL_MD_MAX_LINES
    ? full
    : skillMarkdownWith(p, name, screenshots, true);
}

function skillMarkdownWith(
  p: Procedure,
  name: string,
  screenshots: boolean,
  compact: boolean,
): string {
  const out = [
    '---',
    `name: ${name}`,
    `description: ${yamlString(skillDescription(p))}`,
    '---',
    '',
    `# ${p.title}`,
    '',
  ];
  if (p.description) out.push(p.description, '');
  out.push(
    `This procedure has ${p.steps.length} steps. The same steps, with every way to find each element, are in \`references/procedure.json\`; \`scripts/replay.spec.ts\` replays the web steps with Playwright.`,
    '',
  );
  if (p.preconditions.length) {
    out.push('## Before starting', '');
    for (const c of p.preconditions) out.push(`- ${c}`);
    out.push('');
  }
  out.push('## Variables', '');
  if (p.variables.length) {
    out.push('| Variable | Meaning | Sensitive | Example or default | Environment variable |');
    out.push('| --- | --- | --- | --- | --- |');
    for (const v of p.variables)
      out.push(
        `| \`{{${v.name}}}\` | ${(v.description ?? v.label).replace(/\|/g, '\\|')} | ${v.sensitive ? 'yes' : 'no'} | ${v.sensitive ? '' : (v.defaultValue ?? v.example ?? '').replace(/\|/g, '\\|')} | \`${envName(v.name)}\` |`,
      );
  } else {
    out.push('None: every value is fixed.');
  }
  out.push('', '## Steps', '');
  out.push(
    'Steps marked **CONFIRM** cannot be undone: a person approves each before it is done. Each step lists the target (role and name first), the input, the expected result and the failure rule.',
    '',
  );
  let section: string | undefined;
  for (const step of p.steps) {
    if (step.section && step.section !== section) {
      section = step.section;
      out.push(`### ${section}`, '');
    }
    out.push(...stepSection(step, p, compact), '');
  }
  if (p.success) out.push('## Done when', '', p.success, '');
  out.push('## Files', '');
  out.push('- `references/procedure.json`: the full structured procedure (Trailmark schema v1).');
  out.push('- `scripts/replay.spec.ts`: Playwright replay of the web steps.');
  if (screenshots)
    out.push('- `assets/screenshots/step-NN.png`: what the screen looked like at each step.');
  out.push('');
  return out.join('\n');
}

export interface AgentPackOptions {
  /** Include each step's picture (with blurs burned in). Default true. */
  screenshots?: boolean;
}

/** Every file of the pack, keyed by path inside the `<name>/` folder. */
export function agentPackFiles(
  input: ExportInput,
  options: AgentPackOptions = {},
): { name: string; files: Record<string, Uint8Array> } {
  const procedure = toProcedure(input.guide);
  const name = skillName(input.guide.title);
  const withShots = options.screenshots !== false && input.images.size > 0;
  const files: Record<string, Uint8Array> = {
    'SKILL.md': strToU8(skillMarkdown(procedure, name, withShots)),
    'references/procedure.json': strToU8(`${procedureJson(procedure)}\n`),
    'scripts/replay.spec.ts': strToU8(replaySpec(procedure)),
  };
  if (withShots) {
    const width =
      String(procedure.steps.length).length < 2 ? 2 : String(procedure.steps.length).length;
    for (const step of procedure.steps) {
      const image = input.images.get(step.id);
      if (image)
        files[
          `assets/screenshots/step-${String(step.number).padStart(width, '0')}.${extensionFor(image)}`
        ] = image.bytes;
    }
  }
  return { name, files };
}

/** The pack as a zip with one top-level folder named after the skill. */
export function guideToAgentPack(input: ExportInput, options: AgentPackOptions = {}): Uint8Array {
  const { name, files } = agentPackFiles(input, options);
  const tree: Zippable = {};
  for (const [path, bytes] of Object.entries(files)) tree[`${name}/${path}`] = bytes;
  return zipSync(tree, { level: 6 });
}

export interface PackProblem {
  file: string;
  message: string;
}

/**
 * Checks the Agent Skills rules: frontmatter with a valid `name` matching the folder and a
 * `description` of at most 1024 characters; SKILL.md under 500 lines; a parsable procedure.
 */
export function validateAgentPack(
  folder: string,
  files: Record<string, Uint8Array>,
): PackProblem[] {
  const problems: PackProblem[] = [];
  const text = (path: string) => (files[path] ? new TextDecoder().decode(files[path]) : undefined);
  const skill = text('SKILL.md');
  if (!skill) return [{ file: 'SKILL.md', message: 'missing' }];
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(skill);
  if (!fm) problems.push({ file: 'SKILL.md', message: 'no YAML frontmatter' });
  const field = (key: string) => {
    const m = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(fm?.[1] ?? '');
    if (!m) return undefined;
    const raw = (m[1] ?? '').trim();
    try {
      return raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
    } catch {
      return raw;
    }
  };
  const name = field('name');
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > SKILL_NAME_MAX)
    problems.push({ file: 'SKILL.md', message: `invalid name ${JSON.stringify(name)}` });
  else if (name !== folder)
    problems.push({ file: 'SKILL.md', message: `name ${name} does not match folder ${folder}` });
  const description = field('description');
  if (!description) problems.push({ file: 'SKILL.md', message: 'missing description' });
  else if (description.length > SKILL_DESCRIPTION_MAX)
    problems.push({ file: 'SKILL.md', message: 'description longer than 1024 characters' });
  const keys = (fm?.[1] ?? '').split('\n').map((l) => l.split(':')[0]?.trim());
  for (const k of keys)
    if (
      k &&
      !['name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility'].includes(k)
    )
      problems.push({ file: 'SKILL.md', message: `unexpected frontmatter field ${k}` });
  if (skill.split('\n').length >= SKILL_MD_MAX_LINES)
    problems.push({ file: 'SKILL.md', message: 'longer than 500 lines' });
  const json = text('references/procedure.json');
  try {
    const p = JSON.parse(json ?? '') as Procedure;
    if (p.format !== 'trailmark-procedure')
      problems.push({ file: 'references/procedure.json', message: 'not a Trailmark procedure' });
  } catch {
    problems.push({ file: 'references/procedure.json', message: 'missing or not JSON' });
  }
  if (!files['scripts/replay.spec.ts'])
    problems.push({ file: 'scripts/replay.spec.ts', message: 'missing' });
  return problems;
}
