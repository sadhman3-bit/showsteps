// U2: the Agent Pack, a folder in the open Agent Skills layout:
//   <slug>/SKILL.md                      frontmatter (name, description), then the steps
//   <slug>/references/procedure.json     the full structured procedure
//   <slug>/assets/screenshots/step-NN.png  (optional)
//   <slug>/scripts/replay.spec.ts        Playwright replay of the web steps
import { strToU8, zipSync, type Zippable } from 'fflate';
import {
  isProcedureFormat,
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
  const where = 'inFrame' in e && e.inFrame ? ' (inside the step’s iframe)' : '';
  return describeWhere(e) + where;
}

function describeWhere(e: Expectation): string {
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
  if (input.from)
    return input.from.download === 'latest'
      ? 'Input: the most recent file this run downloaded'
      : `Input: the file downloaded in step ${input.from.download}`;
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

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Where the target was on the recorded screen, for agents working from screenshots. */
export function describeScreen(step: ProcedureStep): string | undefined {
  const b = step.screen;
  if (!b) return undefined;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return `about ${pct(cx)} across and ${pct(cy)} down the screen (highlighted box ${pct(b.x)}–${pct(b.x + b.w)} across, ${pct(b.y)}–${pct(b.y + b.h)} down)`;
}

const oneLine = (s: string) => s.replace(/\s*[\r\n\u2028\u2029]+\s*/g, ' ');

/**
 * The step's instruction on one line, with the names it took from the screen (the target's
 * name, label, text or placeholder, and a fixed input value) in code spans, as in **Target**.
 */
export function instructionLine(step: ProcedureStep): string {
  const t = step.target;
  const names = [
    t?.name,
    t?.label,
    t?.text,
    t?.placeholder,
    t?.uia?.name,
    step.input && !step.input.sensitive ? step.input.value : undefined,
  ]
    .filter((n): n is string => !!n && n.trim().length > 0)
    .map(oneLine)
    .sort((a, b) => b.length - a.length);
  // Split at each name's first appearance; names already inside a span stay as they are.
  let parts: { text: string; quoted: boolean }[] = [
    { text: oneLine(step.instruction), quoted: false },
  ];
  for (const name of new Set(names)) {
    const i = parts.findIndex((x) => !x.quoted && x.text.includes(name));
    const part = parts[i];
    if (!part) continue;
    const at = part.text.indexOf(name);
    parts = [
      ...parts.slice(0, i),
      { text: part.text.slice(0, at), quoted: false },
      { text: name, quoted: true },
      { text: part.text.slice(at + name.length), quoted: false },
      ...parts.slice(i + 1),
    ];
  }
  return parts.map((x) => (x.quoted ? code(x.text) : x.text.replace(/`/g, 'ˋ'))).join('');
}

function stepSection(step: ProcedureStep, p: Procedure, compact: boolean, shot?: string): string[] {
  const where =
    step.app.kind === 'web'
      ? step.action === 'navigate'
        ? ` (${step.app.url})`
        : ''
      : ` (Windows app ${code(step.app.processName)})`;
  const lines = [
    `${step.number}. ${step.confirm ? '**CONFIRM** ' : ''}${instructionLine(step)}${where}`,
  ];
  const sub: string[] = [];
  if (compact) {
    // Very long guides: one detail line per step; procedure.json has the rest.
    const detail = [step.target ? `Target: ${describeTarget(step.target)}` : '', inputLine(step, p)]
      .filter(Boolean)
      .join('. ');
    return [...lines, `   - ${detail || `On failure: ${step.onFailure}`}`];
  }
  if (step.description) sub.push(step.description.replace(/\n+/g, ' '));
  if (step.target) sub.push(`Target: ${describeTarget(step.target)}`);
  const screen = describeScreen(step);
  if (screen) sub.push(`On screen: ${screen}${shot ? `; see ${code(shot)}` : ''}`);
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
export function skillMarkdown(
  p: Procedure,
  name: string,
  screenshots: boolean,
  shots: ReadonlyMap<string, string> = new Map(),
): string {
  const full = skillMarkdownWith(p, name, screenshots, false, shots);
  return full.split('\n').length < SKILL_MD_MAX_LINES
    ? full
    : skillMarkdownWith(p, name, screenshots, true, shots);
}

/**
 * How to carry the procedure out, for the two kinds of agent that use packs: browser
 * automation (Playwright, Playwright MCP, the GitHub Copilot coding agent) and computer use
 * (screenshots, pointer and keyboard).
 */
function howToRun(p: Procedure, screenshots: boolean): string[] {
  const web = p.steps.some((s) => s.app.kind === 'web');
  const desktop = p.steps.some((s) => s.app.kind !== 'web');
  const envs = p.variables.map((v) => `${envName(v.name)}=…`).join(' ');
  const out = ['## How it runs', ''];
  out.push(
    '1. Steps run in order. Each step’s **Expected result** appears before the next step starts; when it does not appear within the step’s time limit, the step’s **On failure** rule applies.',
    '2. Steps marked **CONFIRM** wait for a person to approve them. An agent never approves them itself.',
    '3. Variables without a value come from the person running the procedure. Values are never invented, and sensitive values are never written to files, logs or messages.',
    '4. Elements are found by role and name first, then label, placeholder, test id and visible text; CSS selectors come last, because page IDs and classes can change between visits.',
    '5. When the screen does not match the step (another page, an error, a sign-in prompt), the run stops and reports what is on screen.',
    '',
  );
  if (web) {
    out.push(
      '### Browser automation (Playwright, Playwright MCP, GitHub Copilot coding agent)',
      '',
      `- The replay does every web step: \`npx playwright test scripts/replay.spec.ts\`${envs ? `, with ${code(envs)} set` : ''}. It stops before **CONFIRM** steps unless the person sets \`SHOWSTEPS_ALLOW_CONFIRM=1\`.`,
      '- Step by step, each **Target** maps to `getByRole(role, { name })`, or `getByLabel`, `getByPlaceholder`, `getByTestId` and `getByText`, entering any iframes and shadow roots in the order listed. `references/procedure.json` has every selector, best first.',
      '- Expected results are awaited with web-first assertions (such as `expect(page).toHaveURL(...)` or `expect(locator).toBeVisible()`), not fixed delays.',
      '',
    );
  }
  out.push(
    '### Computer use (screenshots, pointer and keyboard)',
    '',
    '- A screenshot before each step shows the screen; the target is the element with the visible text or label given in **Target**.',
    `- **On screen** gives where the target was when recorded, as a share of the screen’s width and height${screenshots ? `; the picture in \`assets/screenshots/\` shows it in a highlighted box` : ''}. Layouts shift with window size, so it shows where to look; the click goes to the element actually on screen.`,
    '- Clicks go to the centre of the element. Typing steps click the field first and select any existing text before typing.',
    '- A screenshot after each action is compared with the **Expected result** before the next step.',
    ...(desktop
      ? [
          '- Windows app steps name the program, the window and the control (UI Automation type, name and automation id).',
        ]
      : []),
    '',
  );
  return out;
}

function skillMarkdownWith(
  p: Procedure,
  name: string,
  screenshots: boolean,
  compact: boolean,
  shots: ReadonlyMap<string, string>,
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
  out.push(...howToRun(p, screenshots));
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
    'Names in backticks are copied from the app’s screens.',
    '',
  );
  let section: string | undefined;
  for (const step of p.steps) {
    if (step.section && step.section !== section) {
      section = step.section;
      out.push(`### ${section}`, '');
    }
    // Callouts sit where the author wrote them: between the steps, not inside one.
    for (const n of step.notes ?? []) out.push(`> Note: ${n.replace(/\n+/g, ' ')}`, '');
    out.push(...stepSection(step, p, compact, shots.get(step.id)), '');
  }
  if (p.success) out.push('## Done when', '', p.success, '');
  out.push('## Files', '');
  out.push('- `references/procedure.json`: the full structured procedure (ShowSteps schema v1).');
  out.push('- `scripts/replay.spec.ts`: Playwright replay of the web steps.');
  out.push('- `AGENTS.md`: the same rules in short, for agents that read it first.');
  if (screenshots)
    out.push('- `assets/screenshots/step-NN.png`: what the screen looked like at each step.');
  out.push('');
  return out.join('\n');
}

/**
 * AGENTS.md: the rules in a few lines, for agents that look for it in the folder they work in
 * (the GitHub Copilot coding agent and other coding agents read the nearest AGENTS.md).
 */
export function agentsMarkdown(p: Procedure): string {
  const confirms = p.steps.filter((s) => s.confirm).map((s) => s.number);
  return [
    `# ${p.title}: agent notes`,
    '',
    'This folder holds a recorded procedure. `SKILL.md` has every step and is the one to read before acting.',
    '',
    '- Steps run in order; each step’s expected result appears before the next one starts.',
    `- ${confirms.length ? `Step${confirms.length > 1 ? 's' : ''} ${confirms.join(', ')} (marked CONFIRM) wait` : 'Steps marked CONFIRM wait'} for a person’s approval.`,
    '- Missing variable values come from the person running it; none are invented and sensitive ones are never stored.',
    '- Elements are found by role and name, then label, test id and text; CSS selectors last.',
    '- Browser agents: `npx playwright test scripts/replay.spec.ts` replays the web steps.',
    '- Screen agents: each step’s “On screen” line and `assets/screenshots/` show where to look.',
    '- When the screen does not match a step, the run stops and reports what is on screen.',
    '',
  ].join('\n');
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
  const files: Record<string, Uint8Array> = {};
  const shots = new Map<string, string>();
  if (withShots) {
    const width =
      String(procedure.steps.length).length < 2 ? 2 : String(procedure.steps.length).length;
    for (const step of procedure.steps) {
      const image = input.images.get(step.id);
      if (!image) continue;
      const path = `assets/screenshots/step-${String(step.number).padStart(width, '0')}.${extensionFor(image)}`;
      files[path] = image.bytes;
      shots.set(step.id, path);
    }
  }
  files['SKILL.md'] = strToU8(skillMarkdown(procedure, name, withShots, shots));
  files['AGENTS.md'] = strToU8(agentsMarkdown(procedure));
  files['references/procedure.json'] = strToU8(`${procedureJson(procedure)}\n`);
  files['scripts/replay.spec.ts'] = strToU8(replaySpec(procedure));
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
    if (!isProcedureFormat(p.format))
      problems.push({ file: 'references/procedure.json', message: 'not a ShowSteps procedure' });
  } catch {
    problems.push({ file: 'references/procedure.json', message: 'missing or not JSON' });
  }
  if (!files['scripts/replay.spec.ts'])
    problems.push({ file: 'scripts/replay.spec.ts', message: 'missing' });
  return problems;
}
