import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { strFromU8, unzipSync } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import {
  agentWarnings,
  markSensitive,
  urlMatches,
  expectationsFrom,
  createStep,
  needsConfirm,
  parseGuide,
  setInputMode,
  suggestAsk,
  toProcedure,
  valueKind,
  variableName,
  type Guide,
  type Procedure,
  type Step,
  isProcedureFormat,
} from '../src/index.js';
import {
  agentPackFiles,
  guideToAgentPack,
  guideToDocx,
  guideToHtml,
  guideToMarkdown,
  guideToPdf,
  locatorFor,
  procedureFromDocx,
  procedureFromPdf,
  replaySpec,
  skillMarkdown,
  skillName,
  validateAgentPack,
  type ExportInput,
} from '../src/export/index.js';
import { image } from './helpers/exportFixture.js';

/** The demo app's "create a supplier invoice" sample guide (17 steps). */
function sample(): Guide {
  const zip = unzipSync(
    readFileSync(
      new URL('../../../apps/extension/public/samples/create-invoice.showsteps', import.meta.url),
    ),
  );
  return parseGuide(JSON.parse(strFromU8(zip['guide.json']!)));
}

const steps = (g: Guide) => g.blocks.filter((b): b is Step => b.kind === 'step');
const byTitle = (g: Guide, start: string) =>
  steps(g).find((s) =>
    s.human.title.spans
      .map((x) => x.text)
      .join('')
      .startsWith(start),
  )!;

function input(guide: Guide): ExportInput {
  return {
    guide,
    images: new Map(steps(guide).map((s, i) => [s.id, image(4 + i, 3, [i * 10, 80, 160])])),
  };
}

describe('confirm flags (U5)', () => {
  it('marks irreversible buttons only', () => {
    const g = sample();
    expect(needsConfirm(byTitle(g, 'Click Submit invoice'))).toBe(true);
    expect(needsConfirm(byTitle(g, 'Click Sign in'))).toBe(false);
    expect(needsConfirm(byTitle(g, 'Click Review invoice'))).toBe(false);
    const send = createStep({
      action: 'click',
      app: { kind: 'web', url: 'https://x.test/' },
      target: {
        role: 'link',
        name: 'Send for approval',
        selectors: [],
        bbox: { x: 0, y: 0, w: 1, h: 1 },
        point: { x: 0, y: 0 },
      },
    });
    expect(needsConfirm(send)).toBe(true);
    const field = { ...send, target: { ...send.target!, role: 'textbox', name: 'Post code' } };
    expect(needsConfirm(field)).toBe(false);
  });
});

describe('input modes and variables (U4)', () => {
  it('suggests asking for values that look like data', () => {
    expect(valueKind('INV-1043')).toBe('id');
    expect(valueKind('1280.50')).toBe('number');
    expect(valueKind('2026-10-01')).toBe('date');
    expect(valueKind('ap@contoso.example')).toBe('email');
    expect(valueKind('Harbour Paper Co.')).toBeUndefined();
    const g = sample();
    expect(suggestAsk(byTitle(g, 'Type INV-1043'))).toBe('id');
    expect(suggestAsk(byTitle(g, 'Type Harbour'))).toBeUndefined();
    expect(suggestAsk(byTitle(g, 'Enter your password'))).toBeUndefined();
  });

  it('turns a typed value into a variable and back', () => {
    const g = sample();
    const inv = byTitle(g, 'Type INV-1043');
    const asked = setInputMode(g, inv.id, 'ask');
    const step = steps(asked).find((s) => s.id === inv.id)!;
    expect(step.input).toMatchObject({ mode: 'ask', variable: 'invoice_no', value: 'INV-1043' });
    expect(step.human.title.spans.map((s) => s.text).join('')).toBe(
      'Type {{invoice_no}} into Invoice no.',
    );
    expect(asked.variables).toEqual([
      { name: 'invoice_no', label: 'Invoice no.', sensitive: false, example: 'INV-1043' },
    ]);
    const withDefault = setInputMode(asked, inv.id, 'default');
    expect(withDefault.variables[0]).toMatchObject({ defaultValue: 'INV-1043' });
    const fixed = setInputMode(withDefault, inv.id, 'fixed');
    expect(fixed.variables).toEqual([]);
    expect(steps(fixed).find((s) => s.id === inv.id)!.input).toEqual({
      mode: 'fixed',
      value: 'INV-1043',
      sensitive: false,
    });
    expect(variableName(asked, 'Invoice no.')).toBe('invoice_no_2');
    // The result is still a valid guide.
    expect(() => parseGuide(withDefault)).not.toThrow();
  });
});

describe('procedure', () => {
  it('describes every step with targets, inputs, sections and notes, and no secrets', () => {
    const p = toProcedure(setInputMode(sample(), byTitle(sample(), 'Type INV-1043').id, 'ask'));
    expect(p).toMatchObject({ format: 'showsteps-procedure', schemaVersion: 1 });
    // Procedures written before the rename are still recognised.
    expect(isProcedureFormat('showsteps-procedure')).toBe(true);
    expect(isProcedureFormat('trailmark-procedure')).toBe(true);
    expect(isProcedureFormat('other')).toBe(false);
    expect(p.steps).toHaveLength(17);
    const pw = p.steps.find((s) => s.instruction === 'Enter your password')!;
    expect(pw.input).toEqual({ mode: 'ask', variable: 'password', sensitive: true });
    expect(p.variables).toContainEqual({ name: 'password', label: 'Password', sensitive: true });
    const amount = p.steps.find((s) => s.instruction.startsWith('Type 1280.50'))!;
    expect(amount.input).toEqual({ mode: 'fixed', value: '1280.50', sensitive: false });
    expect(amount.section).toBe('Enter the invoice');
    const currency = p.steps.find((s) => s.instruction.startsWith('Select AUD'))!;
    expect(currency.notes).toEqual(['Enter the amount including GST, as printed on the invoice.']);
    const cc = p.steps.find((s) => s.instruction.startsWith('Select CC-110'))!;
    expect(cc.target?.frames).toEqual(['iframe[title="Cost centre lookup"]']);
    expect(cc.target?.selectors[0]!.score).toBeGreaterThanOrEqual(cc.target!.selectors[1]!.score);
    expect(JSON.stringify(p)).not.toContain('not-a-real-password');
    expect(JSON.stringify(p)).not.toMatch(/screenshot|"img\//);
  });
});

describe('agent warnings (U1)', () => {
  it('flags fragile, visual-only and unconfirmed steps and fixed data values', () => {
    const g = sample();
    const kinds = (title: string) =>
      agentWarnings(g)
        .filter((w) => w.stepId === byTitle(g, title).id)
        .map((w) => w.kind);
    expect(kinds('Click Submit invoice')).toEqual([]);
    expect(kinds('Type INV-1043')).toEqual(['fixed-value']);
    expect(kinds('Click Sign in')).toEqual([]);
    const visual = { ...byTitle(g, 'Click Sign in'), id: 'v1' };
    visual.agent = { ...visual.agent, visualOnly: true };
    const fragile = { ...byTitle(g, 'Click Sign in'), id: 'f1' };
    fragile.target = {
      ...fragile.target!,
      role: undefined,
      name: undefined,
      selectors: [{ type: 'css', value: 'div > span', score: 0.3 }],
    } as never;
    const submit = byTitle(g, 'Click Submit invoice');
    const unconfirmed = { ...submit, id: 'u1', agent: { ...submit.agent, confirm: false } };
    const w = agentWarnings({ ...g, blocks: [visual, fragile, unconfirmed] });
    expect(w).toEqual([
      { stepId: 'v1', number: 1, kind: 'visual-only' },
      { stepId: 'f1', number: 2, kind: 'no-stable-selector' },
      { stepId: 'u1', number: 3, kind: 'unconfirmed' },
    ]);
  });
});

describe('Agent Pack (U2)', () => {
  it('follows the Agent Skills layout and rules', () => {
    const g = sample();
    const { name, files } = agentPackFiles(input(g));
    expect(name).toBe('create-a-supplier-invoice-in-ledgerline');
    expect(Object.keys(files).sort()).toEqual(
      [
        'AGENTS.md',
        'SKILL.md',
        ...Array.from(
          { length: 17 },
          (_, i) => `assets/screenshots/step-${String(i + 1).padStart(2, '0')}.png`,
        ),
        'references/procedure.json',
        'scripts/replay.spec.ts',
      ].sort(),
    );
    expect(validateAgentPack(name, files)).toEqual([]);
    const skill = strFromU8(files['SKILL.md']!);
    expect(skill).toMatch(/^---\nname: create-a-supplier-invoice-in-ledgerline\ndescription: "/);
    expect(skill.split('\n').length).toBeLessThan(500);
    for (let n = 1; n <= 17; n++) expect(skill).toMatch(new RegExp(`^${n}\\. `, 'm'));
    expect(skill).toContain('Target: textbox named `Username`');
    expect(skill).toContain('| `{{password}}` | Password | yes |');
    expect(skill).toContain('inside iframe `iframe[title="Cost centre lookup"]`');
    expect(skill).toContain('On failure:');
    // Both kinds of agent get directions: browser automation and computer use.
    expect(skill).toContain('## How it runs');
    expect(skill).toContain(
      '### Browser automation (Playwright, Playwright MCP, GitHub Copilot coding agent)',
    );
    expect(skill).toContain('### Computer use (screenshots, pointer and keyboard)');
    expect(skill).toMatch(
      /On screen: about \d+% across and \d+% down the screen .*; see `assets\/screenshots\/step-\d\d\.png`/,
    );
    const agents = strFromU8(files['AGENTS.md']!);
    expect(agents).toContain('`SKILL.md` has every step');
    expect(agents).not.toMatch(/\byou\b/i);
    // A callout sits between the steps it was written between.
    expect(skill).toMatch(
      /Type `1280\.50`[^]*> Note: Enter the amount including GST[^]*9\. Select `AUD`/,
    );
    expect(skill).not.toMatch(/\bignore\b|you must/i);
    // A confirm step carries the marker.
    const confirmed = {
      ...g,
      blocks: g.blocks.map((b) =>
        b.kind === 'step' && needsConfirm(b) ? { ...b, agent: { ...b.agent, confirm: true } } : b,
      ),
    };
    const c = strFromU8(agentPackFiles(input(confirmed)).files['SKILL.md']!);
    expect(c).toMatch(/^17\. \*\*CONFIRM\*\* Click `Submit invoice`/m);
    // Zip has one top-level folder named after the skill.
    const zip = unzipSync(guideToAgentPack(input(g), { screenshots: false }));
    expect(Object.keys(zip).every((p) => p.startsWith(`${name}/`))).toBe(true);
    expect(Object.keys(zip).some((p) => p.includes('screenshots'))).toBe(false);
  });

  it('catches broken packs', () => {
    const { name, files } = agentPackFiles(input(sample()));
    expect(validateAgentPack('other-name', files)).toEqual([
      { file: 'SKILL.md', message: `name ${name} does not match folder other-name` },
    ]);
    const long = new TextEncoder().encode(
      strFromU8(files['SKILL.md']!).replace(
        /description: ".*"/,
        `description: "${'x'.repeat(1100)}"`,
      ),
    );
    expect(validateAgentPack(name, { ...files, 'SKILL.md': long })[0]!.message).toMatch(/1024/);
    expect(skillName('Pay  a supplier — Q3!')).toBe('pay-a-supplier-q3');
    expect(skillName('x'.repeat(80))).toHaveLength(64);
  });

  it('keeps SKILL.md under 500 lines for very long guides', () => {
    const g = sample();
    const many = steps(g).flatMap((s, i) =>
      Array.from({ length: 6 }, (_, k) => ({ ...s, id: `${s.id}-${i}-${k}` })),
    );
    const { name, files } = agentPackFiles({ guide: { ...g, blocks: many }, images: new Map() });
    expect(validateAgentPack(name, files)).toEqual([]);
  });
});

describe('Playwright replay (U10)', () => {
  it('finds elements by role, label or text first and CSS last', () => {
    expect(locatorFor({ role: 'button', name: 'Save', selectors: [] })).toBe(
      `page.getByRole("button", { name: "Save", exact: true })`,
    );
    expect(locatorFor({ label: 'Amount', selectors: [] })).toBe(
      `page.getByLabel("Amount", { exact: true })`,
    );
    expect(locatorFor({ selectors: [{ type: 'css', value: '#x', score: 0.5 }] })).toBe(
      `page.locator("#x")`,
    );
    expect(
      locatorFor({ role: 'combobox', name: 'CC', selectors: [], frames: ['iframe[title="A"]'] }),
    ).toBe(
      `page.frameLocator("iframe[title=\\"A\\"]").getByRole("combobox", { name: "CC", exact: true })`,
    );
  });

  it('reads variables from the environment and stops before confirm steps', () => {
    const g = sample();
    const withConfirm = {
      ...g,
      blocks: g.blocks.map((b) =>
        b.kind === 'step' && needsConfirm(b) ? { ...b, agent: { ...b.agent, confirm: true } } : b,
      ),
    };
    const p = toProcedure(setInputMode(withConfirm, byTitle(g, 'Type INV-1043').id, 'ask'));
    const spec = replaySpec(p);
    expect(spec).toContain("import { expect, test } from '@playwright/test';");
    expect(spec).toContain('//   TM_PASSWORD: Password (sensitive, required)');
    expect(spec).toContain('//   TM_INVOICE_NO: Invoice no., default "INV-1043"');
    expect(spec).toContain('.fill(value("password")');
    expect(spec).toContain('.fill(value("invoice_no")');
    expect(spec).toContain(`await page.goto("http://localhost:5173/login.html");`);
    expect(spec).toContain('.selectOption("AUD"');
    expect(spec).toContain("const allowConfirm = process.env.SHOWSTEPS_ALLOW_CONFIRM === '1';");
    // The stop comes after step 17's comment and before its click.
    const confirmAt = spec.indexOf('if (!allowConfirm)');
    expect(confirmAt).toBeGreaterThan(spec.indexOf('// 17. Click Submit invoice'));
    expect(spec.indexOf('name: "Submit invoice"')).toBeGreaterThan(confirmAt);
    expect(spec).not.toContain('not-a-real-password');
  });
});

describe('embedded procedure in human exports (U3)', () => {
  const procedureOf = (json: string) => JSON.parse(json) as Procedure;

  it('HTML: a JSON data block and a visible line', () => {
    const html = guideToHtml(input(sample()));
    const m = /<script type="application\/json" id="showsteps-procedure">([\s\S]*?)<\/script>/.exec(
      html,
    );
    expect(procedureOf(m![1]!).steps).toHaveLength(17);
    expect(html).toContain('Agent-readable procedure embedded (ShowSteps schema v1).');
  });

  it('Markdown: a collapsed block at the end', () => {
    const md = guideToMarkdown(input(sample()));
    const m =
      /<details><summary>Agent procedure<\/summary>\n\n```json\n([\s\S]*?)\n```\n\n<\/details>\n$/.exec(
        md,
      );
    expect(procedureOf(m![1]!).steps).toHaveLength(17);
    expect(md).toContain('*Agent-readable procedure embedded (ShowSteps schema v1).*');
  });

  it('Word: a custom XML part', async () => {
    const docx = await guideToDocx(input(sample()));
    const files = unzipSync(docx);
    expect(strFromU8(files['[Content_Types].xml']!)).toContain('/customXml/itemProps1.xml');
    expect(strFromU8(files['word/_rels/document.xml.rels']!)).toContain('../customXml/item1.xml');
    expect(procedureOf(procedureFromDocx(docx)!).steps).toHaveLength(17);
    expect(strFromU8(files['word/document.xml']!)).toContain('Agent-readable procedure embedded');
  });

  it('PDF: procedure.json attached', async () => {
    const bytes = await guideToPdf(input(sample()));
    expect(procedureOf((await procedureFromPdf(bytes))!).steps).toHaveLength(17);
    const pdf = await getDocument({ data: bytes.slice() }).promise;
    const attachments = (await pdf.getAttachments()) as Map<string, { description: string }>;
    expect(attachments.get('procedure.json')?.description).toBe(
      'Agent-readable procedure embedded (ShowSteps schema v1).',
    );
    const last = await pdf.getPage(pdf.numPages);
    const text = (await last.getTextContent()).items
      .map((t) => ('str' in t ? t.str : ''))
      .join(' ');
    expect(text).toContain('Agent-readable procedure embedded');
  });
});

describe('captured expectations (U6)', () => {
  it('records a new address, dialogs that open or close, messages and headings', () => {
    const before = {
      url: 'http://localhost:5173/app/invoices/new',
      landmarks: ['heading|New invoice'],
      messages: [],
    };
    expect(
      expectationsFrom(before, {
        ...before,
        landmarks: [...before.landmarks, 'dialog|Review invoice'],
      }),
    ).toEqual([{ type: 'visible', target: { role: 'dialog', name: 'Review invoice' } }]);
    expect(
      expectationsFrom(
        { ...before, landmarks: [...before.landmarks, 'dialog|Review invoice'] },
        {
          url: 'http://localhost:5173/app/invoices/1043',
          landmarks: ['heading|Invoice submitted'],
          messages: ['Invoice INV-1043 sent for approval'],
        },
      ),
    ).toEqual([
      { type: 'url', matches: '/app/invoices/1043$' },
      { type: 'hidden', target: { role: 'dialog', name: 'Review invoice' } },
      { type: 'text', contains: 'Invoice INV-1043 sent for approval' },
    ]);
    expect(expectationsFrom(before, before)).toEqual([]);
  });
});

describe('sensitive values', () => {
  it('removes the value from the step, its title and its variable', () => {
    const g = sample();
    const user = byTitle(g, 'Type alex');
    const asked = setInputMode(g, user.id, 'default');
    const marked = markSensitive(asked, user.id, true);
    const step = steps(marked).find((s) => s.id === user.id)!;
    expect(step.input).toEqual({ mode: 'default', variable: 'username', sensitive: true });
    expect(JSON.stringify(marked)).not.toContain('"alex"');
    expect(marked.variables).toEqual([{ name: 'username', label: 'Username', sensitive: true }]);
    expect(() => parseGuide(marked)).not.toThrow();
    // An author's own title keeps its words, minus the value.
    const custom = {
      ...g,
      blocks: g.blocks.map((b) =>
        b.id === user.id && b.kind === 'step'
          ? { ...b, human: { ...b.human, title: { spans: [{ text: 'Sign in as alex' }] } } }
          : b,
      ),
    };
    const t = steps(markSensitive(custom, user.id, true)).find((s) => s.id === user.id)!;
    expect(t.human.title.spans.map((x) => x.text).join('')).toBe('Sign in as •••');
  });
});

describe('checking a captured address', () => {
  it('treats it as a regular expression, or plain text when it is not one', () => {
    expect(urlMatches('http://localhost:5173/app/', '/app/$')).toBe(true);
    expect(urlMatches('http://localhost:5173/app/invoices', '/app/$')).toBe(false);
    expect(urlMatches('http://x.test/a(b', 'a(b')).toBe(true);
  });
});

describe('expectations inside iframes', () => {
  it('are recorded without the frame address and checked inside the frame by the replay', () => {
    const before = { url: 'http://127.0.0.1:5174/widget.html', landmarks: [], messages: [] };
    const after = {
      url: 'http://127.0.0.1:5174/widget.html#done',
      landmarks: [],
      messages: ['Saved'],
    };
    expect(expectationsFrom(before, after, { inFrame: true })).toEqual([
      { type: 'text', contains: 'Saved', inFrame: true },
    ]);
    const g = sample();
    const use = byTitle(g, 'Click Use this cost centre');
    use.agent.expect = [
      { type: 'text', contains: 'Saved', inFrame: true },
      { type: 'text', contains: 'Cost centre set' },
    ];
    const spec = replaySpec(toProcedure(g));
    expect(spec).toContain(
      'await expect(page.frameLocator("iframe[title=\\"Cost centre lookup\\"]").getByText("Saved").first()).toBeVisible',
    );
    expect(spec).toContain('await expect(page.getByText("Cost centre set").first()).toBeVisible');
    expect(() => parseGuide(g)).not.toThrow();
  });
});

describe('guide text in the replay script and SKILL.md (H2)', () => {
  const EXEC = "require('child_process').execSync('calc')";
  const payloads = [
    `Click OK\r${EXEC}//`,
    `Click OK\n${EXEC}//`,
    `Click OK\u2028${EXEC}//`,
    `Click OK\u2029${EXEC}//`,
    `Click OK */ ${EXEC} /*`,
    `Click \`OK\` ${EXEC}`,
    `Click \${${EXEC}}`,
  ];

  /** The sample with the payload in the title, every instruction, a target name and a label. */
  function planted(text: string): Procedure {
    const g = sample();
    const p = toProcedure(setInputMode(g, byTitle(g, 'Type INV-1043').id, 'ask'));
    return {
      ...p,
      title: text,
      steps: p.steps.map((s, i) => ({
        ...s,
        instruction: text,
        ...(i === 4 && s.target ? { target: { ...s.target, name: text } } : {}),
      })),
      variables: p.variables.map((v) => ({ ...v, label: text, defaultValue: text })),
    };
  }

  it.each(payloads.map((t) => [JSON.stringify(t), t]))(
    'replay.spec.ts stays the expected program for %s',
    (_name, text) => {
      const spec = replaySpec(planted(text));
      const file = ts.createSourceFile('replay.spec.ts', spec, ts.ScriptTarget.Latest, true);
      const diagnostics = (file as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics;
      expect(diagnostics).toEqual([]);
      const top = file.statements.map((st) => {
        if (ts.isImportDeclaration(st)) return 'import';
        if (ts.isVariableStatement(st))
          return `const ${st.declarationList.declarations.map((d) => d.name.getText(file)).join()}`;
        if (ts.isFunctionDeclaration(st)) return `function ${st.name?.text}`;
        if (
          ts.isExpressionStatement(st) &&
          ts.isCallExpression(st.expression) &&
          st.expression.expression.getText(file) === 'test'
        )
          return 'test()';
        return `unexpected: ${st.getText(file).slice(0, 80)}`;
      });
      expect(top).toEqual([
        'import',
        'const defaults',
        'const allowConfirm',
        'function value',
        'test()',
      ]);
      const calls: string[] = [];
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n)) calls.push(n.expression.getText(file));
        ts.forEachChild(n, visit);
      };
      visit(file);
      expect(calls.filter((c) => /(^|\.)(require|execSync)$/.test(c))).toEqual([]);
    },
  );

  it('SKILL.md puts names from the screen in code spans', () => {
    const g = sample();
    const md = skillMarkdown(toProcedure(g), 'create-invoice', false);
    expect(md).toContain('Names in backticks are copied from the app’s screens.');
    expect(md).toContain('4. Click `Sign in`');
    expect(md).toContain('7. Type `INV-1043` into `Invoice no.`');
    const p = planted(`Click OK\u2028${EXEC}`);
    const steps = skillMarkdown(p, 'x', false).split('## Steps')[1]!;
    const line = steps.split('\n').find((l) => l.startsWith('5. '))!;
    expect(line).toContain(`\`Click OK ${EXEC}\``);
  });
});
