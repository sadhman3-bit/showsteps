import { createGuide, createStep, plain, type Guide, type Step } from '@showsteps/core';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { FileControls } from '../src/index.js';

const app = { kind: 'web' as const, url: 'https://reports.test/' };
const box = { selectors: [], bbox: { x: 0, y: 0, w: 1, h: 1 }, point: { x: 0, y: 0 } };

function guide(from?: string, order: 'normal' | 'moved' = 'normal') {
  const download = createStep({
    action: 'click',
    app,
    target: { ...box, role: 'link', name: 'Download PDF' },
    human: { title: plain('Click Download PDF') },
  });
  const other = createStep({
    action: 'click',
    app,
    target: { ...box, role: 'button', name: 'Save' },
    human: { title: plain('Click Save') },
  });
  const upload = createStep({
    action: 'upload',
    app,
    target: { ...box, label: 'Attachment' },
    input: {
      mode: 'fixed',
      value: 'report.pdf',
      sensitive: false,
      ...(from ? { from: { download: from === 'download' ? download.id : from } } : {}),
    },
    human: { title: plain('Upload report.pdf') },
  });
  const blocks = order === 'moved' ? [other, upload, download] : [download, other, upload];
  return { g: createGuide({ blocks }), upload };
}

const render = (g: Guide, step: Step, access?: 'granted' | 'missing' | 'declined') =>
  renderToString(
    <FileControls
      guide={g}
      step={step}
      num={3}
      access={access ? { state: access, onAllow: () => undefined } : undefined}
      onGuide={() => undefined}
    />,
  );

describe('the File control on upload steps (1.2)', () => {
  it('offers choose it yourself, the latest download and each earlier step', () => {
    const { g, upload } = guide();
    const html = render(g, upload, 'missing');
    expect(html).toContain('aria-label="File: Step 3 title"');
    expect(html).toContain('<option selected value>Choose it yourself</option>');
    expect(html).toContain('The file this run downloaded last');
    expect(html).toContain('The file downloaded in step 1: Click Download PDF');
    expect(html).toContain('The file downloaded in step 2: Click Save');
    expect(html).not.toContain('step 3:');
    expect(html).not.toContain('Run for me attaches the file');
  });

  it('suggests the download step until one is chosen', () => {
    const { g, upload } = guide();
    expect(render(g, upload)).toContain('Attach the file this run downloaded?');
    const set = guide('download');
    const html = render(set.g, set.upload, 'granted');
    expect(html).not.toContain('Attach the file this run downloaded?');
    expect(html).toContain('Run for me attaches the file instead of stopping.');
    expect(html).not.toContain('Allow download access');
  });

  it('asks for download access, and explains what is lost without it', () => {
    const { g, upload } = guide('latest');
    const missing = render(g, upload, 'missing');
    expect(missing).toContain('Allow download access');
    expect(missing).toContain('Lets Run for me see the file its own click downloaded');
    expect(render(g, upload, 'declined')).toContain(
      'Without download access, ShowSteps can only attach files from simple download links.',
    );
    // The desktop app's editor: no button.
    const desktop = render(g, upload);
    expect(desktop).toContain('Download access is set in Chrome.');
    expect(desktop).not.toContain('Allow download access');
  });

  it('warns when the source step is missing or now comes later', () => {
    const moved = guide('download', 'moved');
    const html = render(moved.g, moved.upload, 'granted');
    expect(html).toContain('role="alert"');
    expect(html).toContain('deleted or moved after this one');
    expect(html).not.toContain('Run for me attaches the file');
    const gone = guide('missing-step-id');
    expect(render(gone.g, gone.upload, 'granted')).toContain('deleted or moved after this one');
  });
});
