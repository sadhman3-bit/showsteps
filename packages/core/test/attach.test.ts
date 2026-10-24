import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import {
  RunStepLogSchema,
  acceptsFile,
  attachProblem,
  fileInputFor,
  setInputFile,
  StepInputSchema,
  attachAhead,
  buildStartLink,
  createGuide,
  createStep,
  guideStartUrl,
  guideVersion,
  looksLikeDownload,
  setAttachSource,
  suggestAttachSource,
  parseStartLink,
  planGuideStep,
  planStep,
  plain,
  toProcedure,
  withoutStartLink,
  type Guide,
  type Step,
} from '../src/index.js';
import { agentPackFiles, replaySpec } from '../src/export/index.js';

const app = { kind: 'web' as const, url: 'https://reports.test/app/#/home' };
const target = {
  role: 'button',
  name: 'Attach',
  selectors: [],
  bbox: { x: 0, y: 0, w: 1, h: 1 },
  point: { x: 0, y: 0 },
};

function guide(from?: string): { g: Guide; download: Step; upload: Step } {
  const open = createStep({ action: 'navigate', app, human: { title: plain('Open Reports') } });
  const download = createStep({
    action: 'click',
    app,
    target: { ...target, role: 'link', name: 'Download PDF' },
    human: { title: plain('Click Download PDF') },
  });
  const upload = createStep({
    action: 'upload',
    app,
    target: { ...target, role: undefined, name: undefined, label: 'Invoice file' },
    input: {
      mode: 'fixed',
      value: 'report.pdf',
      sensitive: false,
      ...(from ? { from: { download: from === 'download' ? download.id : from } } : {}),
    },
    human: { title: plain('Upload report.pdf') },
  });
  return {
    g: createGuide({ title: 'Send report', blocks: [open, download, upload] }),
    download,
    upload,
  };
}

describe('upload steps that attach a downloaded file (1.2)', () => {
  it('validate the from field', () => {
    const base = { mode: 'fixed', sensitive: false };
    expect(StepInputSchema.parse({ ...base, from: { download: 'latest' } }).from).toEqual({
      download: 'latest',
    });
    expect(StepInputSchema.parse({ ...base, from: { download: 'step-1' } }).from).toEqual({
      download: 'step-1',
    });
    expect(StepInputSchema.safeParse({ ...base, from: { download: '' } }).success).toBe(false);
    expect(StepInputSchema.safeParse({ ...base, from: { download: 3 } }).success).toBe(false);
    expect(StepInputSchema.safeParse({ ...base, from: 'latest' }).success).toBe(false);
  });

  it('plan an attach step, and ignore from on other steps', () => {
    const { g, upload } = guide('latest');
    expect(planStep(upload)).toEqual({ kind: 'attach', from: { download: 'latest' } });
    expect(planStep(guide().upload)).toEqual({ kind: 'manual', reason: 'upload' });
    const typed = createStep({
      action: 'type',
      app,
      target,
      input: { mode: 'fixed', value: 'x', sensitive: false, from: { download: 'latest' } },
    });
    expect(planStep(typed)).toEqual({ kind: 'act' });
    expect(attachAhead(g, 0)).toBe(true);
    expect(attachAhead(g, 2)).toBe(false);
  });

  it('fall back to a plain upload when the source step is missing or comes later', () => {
    const { g, upload, download } = guide('download');
    expect(planGuideStep(g, upload)).toEqual({ kind: 'attach', from: { download: download.id } });
    const missing = { ...g, blocks: g.blocks.filter((b) => b.id !== download.id) };
    expect(planGuideStep(missing, upload)).toEqual({ kind: 'manual', reason: 'upload' });
    const moved = { ...g, blocks: [g.blocks[0]!, upload, download] };
    expect(planGuideStep(moved, upload)).toEqual({ kind: 'manual', reason: 'upload' });
    expect(attachAhead(moved, 0)).toBe(false);
  });

  it('change the guide version when the file source changes', () => {
    const { g, upload } = guide();
    const set = {
      ...g,
      blocks: g.blocks.map((b) =>
        b.id === upload.id && b.kind === 'step'
          ? { ...b, input: { ...b.input!, from: { download: 'latest' } } }
          : b,
      ),
    };
    expect(guideVersion(set)).not.toBe(guideVersion(g));
  });

  it('describe the source in the procedure, the Agent Pack and the replay', () => {
    const { g } = guide('download');
    const p = toProcedure(g);
    expect(p.steps[2]!.input?.from).toEqual({ download: 2 });
    expect(toProcedure(guide('latest').g).steps[2]!.input?.from).toEqual({ download: 'latest' });
    expect(toProcedure(guide().g).steps[2]!.input?.from).toBeUndefined();

    const files = agentPackFiles({ guide: g, images: new Map() });
    const skill = new TextDecoder().decode(
      Object.entries(files.files).find(([n]) => n.endsWith('SKILL.md'))![1],
    );
    expect(skill).toContain('Input: the file downloaded in step 2');

    const spec = replaySpec(p);
    expect(spec).toContain("import { expect, test, type Download } from '@playwright/test';");
    expect(spec).toContain(
      "page.on('download', (download) => downloads.push({ step: stepNumber, download }));",
    );
    expect(spec).toContain('stepNumber = 2;');
    expect(spec).toContain('downloads.some((d) => d.step === 2)');
    expect(spec).toContain('.setInputFiles(await downloaded("step_3", 2));');
    expect(spec).toContain(
      'TM_FILE_STEP_3: path of the file to upload in step 3 (default: the file this run downloaded)',
    );
    // Without an attach step, the replay is as before.
    const plainSpec = replaySpec(toProcedure(guide().g));
    expect(plainSpec).not.toContain('downloads');
    expect(plainSpec).toContain('.setInputFiles(file("step_3"));');
  });

  it('log the attached file in a run', () => {
    const base = { stepId: 's', number: 3, status: 'done', at: '2026-10-23T00:00:00Z' };
    expect(
      RunStepLogSchema.parse({
        ...base,
        file: { name: 'r.pdf', size: 10, from: 'x.test', step: 2 },
      }).file,
    ).toEqual({ name: 'r.pdf', size: 10, from: 'x.test', step: 2 });
    expect(RunStepLogSchema.safeParse({ ...base, file: { name: 'r.pdf', size: -1 } }).success).toBe(
      false,
    );
  });
});

describe('start links in exported files (1.2)', () => {
  it('round-trip the marker on the start page', () => {
    const { g } = guide();
    expect(guideStartUrl(g)).toBe('https://reports.test/app/#/home');
    const link = buildStartLink(g, 'run')!;
    expect(link).toBe(
      `https://reports.test/app/#showsteps=1&guide=${g.id}&mode=run&v=${guideVersion(g)}`,
    );
    expect(parseStartLink(link)).toEqual({ guideId: g.id, mode: 'run', version: guideVersion(g) });
    expect(withoutStartLink(link)).toBe('https://reports.test/app/');
  });

  it('percent-encode any guide ID, and refuse long ones', () => {
    const { g } = guide();
    const odd = { ...g, id: 'a b&c=d#é' };
    const link = buildStartLink(odd, 'guide')!;
    expect(link).toContain('guide=a%20b%26c%3Dd%23%C3%A9&');
    expect(parseStartLink(link)?.guideId).toBe('a b&c=d#é');
    expect(buildStartLink({ ...g, id: 'x'.repeat(201) }, 'guide')).toBeUndefined();
  });

  it('give no link without a web start page', () => {
    const desktop = createGuide({
      blocks: [
        createStep({
          action: 'click',
          app: { kind: 'desktop', processName: 'excel.exe', windowTitle: 'Book1' },
        }),
      ],
    });
    expect(buildStartLink(desktop, 'run')).toBeUndefined();
    expect(buildStartLink(createGuide(), 'run')).toBeUndefined();
  });

  it('reject junk and other keys', () => {
    const ok = 'https://x.test/#showsteps=1&guide=g1&mode=guide&v=abc123';
    expect(parseStartLink(ok)).toEqual({ guideId: 'g1', mode: 'guide', version: 'abc123' });
    for (const bad of [
      'https://x.test/',
      'https://x.test/#/home',
      'not a url',
      'https://x.test/#showsteps=2&guide=g1&mode=guide&v=abc123',
      'https://x.test/#showsteps=1&guide=g1&mode=walk&v=abc123',
      'https://x.test/#showsteps=1&guide=&mode=guide&v=abc123',
      'https://x.test/#showsteps=1&guide=g1&mode=guide&v=ABC!',
      'https://x.test/#showsteps=1&guide=g1&mode=guide',
      'https://x.test/#showsteps=1&guide=g1&mode=guide&v=abc&extra=1',
      'https://x.test/#showsteps=1&guide=g1&guide=g2&mode=guide',
      'https://x.test/#showsteps=1&guide=g1&mode=guide&next=abc',
      'https://x.test/#showsteps=1&guide=%E0%A4%A&mode=guide&v=abc',
      'https://x.test/#showsteps=1&guide=a%0Ab&mode=guide&v=abc',
      `https://x.test/#showsteps=1&guide=${'x'.repeat(201)}&mode=guide&v=abc`,
    ])
      expect(parseStartLink(bad), bad).toBeUndefined();
  });
});

describe('editor help for attach steps (1.2)', () => {
  it('spot download clicks and suggest the nearest one', () => {
    const { g, download, upload } = guide();
    expect(looksLikeDownload(download)).toBe(true);
    const named = (name: string) =>
      createStep({ action: 'click', app, target: { ...target, name } });
    expect(looksLikeDownload(named('Export'))).toBe(true);
    expect(looksLikeDownload(named('Invoice (XLSX)'))).toBe(true);
    expect(looksLikeDownload(named('Save'))).toBe(false);
    expect(
      looksLikeDownload(
        createStep({
          action: 'click',
          app,
          target: {
            ...target,
            name: 'Get it',
            selectors: [{ type: 'css', value: 'a[download]', score: 1 }],
          },
        }),
      ),
    ).toBe(true);
    expect(suggestAttachSource(g, upload)?.id).toBe(download.id);
    expect(suggestAttachSource(g, guide('latest').upload)).toBeUndefined();
  });

  it('set and clear the source on upload steps only', () => {
    const { g, upload, download } = guide();
    const set = setAttachSource(g, upload.id, { download: download.id });
    const step = set.blocks.find((b) => b.id === upload.id) as Step;
    expect(step.input).toEqual({
      mode: 'fixed',
      value: 'report.pdf',
      sensitive: false,
      from: { download: download.id },
    });
    const cleared = setAttachSource(set, upload.id, undefined);
    expect((cleared.blocks.find((b) => b.id === upload.id) as Step).input?.from).toBeUndefined();
    expect(setAttachSource(g, download.id, { download: 'latest' }).blocks).toEqual(g.blocks);
  });
});

describe('attaching a file to the page (1.2)', () => {
  const page = (html: string) => {
    const w = new Window({ url: 'https://send.test/' });
    w.document.body.innerHTML = html;
    return w.document as unknown as Document;
  };

  it('finds the file field behind a button, a label, or alone in its form', () => {
    const doc = page(`
      <form><button id="b">Attach</button><input id="f" type="file" hidden></form>
      <label id="l" for="g">Photo</label><input id="g" type="file">`);
    expect(fileInputFor(doc.getElementById('f')!)?.id).toBe('f');
    expect(fileInputFor(doc.getElementById('l')!)?.id).toBe('g');
    expect(fileInputFor(doc.getElementById('b')!)?.id).toBe('f');
    const two = page('<button id="b">Attach</button><input type="file"><input type="file">');
    expect(fileInputFor(two.getElementById('b')!)).toBeUndefined();
    const none = page('<button id="b">Attach</button>');
    expect(fileInputFor(none.getElementById('b')!)).toBeUndefined();
  });

  it('checks the accept list', () => {
    expect(acceptsFile('', 'a.exe', '')).toBe(true);
    expect(acceptsFile('.pdf,.csv', 'Report.PDF', 'application/pdf')).toBe(true);
    expect(acceptsFile('.png', 'report.pdf', 'application/pdf')).toBe(false);
    expect(acceptsFile('image/*', 'a.png', 'image/png')).toBe(true);
    expect(acceptsFile('image/*', 'a.pdf', 'application/pdf')).toBe(false);
    expect(acceptsFile('application/pdf', 'a', 'application/pdf')).toBe(true);
  });

  it('sets the file and tells the page, unless the field is disabled or refuses it', () => {
    const doc = page('<input id="f" type="file" accept=".pdf">');
    const input = doc.getElementById('f') as HTMLInputElement;
    const w = doc.defaultView as unknown as typeof globalThis;
    const seen: string[] = [];
    input.addEventListener('input', () => seen.push('input'));
    input.addEventListener('change', () => seen.push('change'));
    const pdf = new w.File(['%PDF-'], 'report.pdf', { type: 'application/pdf' });
    expect(attachProblem(input, pdf)).toBeUndefined();
    expect(attachProblem(input, new w.File(['x'], 'a.png', { type: 'image/png' }))).toBe(
      'file-type',
    );
    setInputFile(input, pdf);
    expect(input.files?.[0]?.name).toBe('report.pdf');
    expect(seen).toEqual(['input', 'change']);
    input.disabled = true;
    expect(attachProblem(input, pdf)).toBe('file-type');
  });
});
