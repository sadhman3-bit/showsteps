import { XMLValidator } from 'fast-xml-parser';
import { strFromU8, unzipSync } from 'fflate';
import mammoth from 'mammoth';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import {
  exportDocument,
  formatDate,
  guideToClipboardHtml,
  guideToDocx,
  guideToEmbedHtml,
  guideToHtml,
  guideToMarkdown,
  guideToMarkdownZip,
  guideToPdf,
  guideToText,
  toBase64,
} from '../src/export/index.js';
import { fixtureInput, image } from './helpers/exportFixture.js';

describe('export model', () => {
  it('numbers steps, names pictures and fills alt text', () => {
    const doc = exportDocument(fixtureInput());
    expect(doc.meta).toBe('4 steps · Updated 9 October 2026');
    const steps = doc.items.filter((i) => i.kind === 'step');
    expect(steps.map((s) => [s.number, s.anchor, s.imageName])).toEqual([
      [1, 'step-1', 'step-01.png'],
      [2, 'step-2', 'step-02.png'],
      [3, 'step-3', undefined],
      [4, 'step-4', 'step-04.png'],
    ]);
    expect(steps[0]!.alt).toBe('Screenshot for step 1: Type alex into Username');
    expect(steps[1]!.alt).toBe('The sign-in form');
  });

  it('formats dates in UTC and encodes base64 like the platform', () => {
    expect(formatDate('2026-01-31T23:59:00Z')).toBe('31 January 2026');
    expect(formatDate('nonsense')).toBe('');
    for (const n of [0, 1, 2, 3, 4, 5, 255]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 13) & 255);
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });
});

describe('Markdown (X3)', () => {
  it('matches the golden file', async () => {
    await expect(guideToMarkdown(fixtureInput())).toMatchFileSnapshot('./golden/guide.md');
  });

  it('zips guide.md with every picture in img/', () => {
    const files = unzipSync(guideToMarkdownZip(fixtureInput()));
    expect(
      Object.keys(files)
        .filter((n) => !n.endsWith('/'))
        .sort(),
    ).toEqual([
      'guide.md',
      'img/logo.png',
      'img/step-01.png',
      'img/step-02.png',
      'img/step-04.png',
    ]);
    const md = strFromU8(files['guide.md']!);
    for (const name of ['img/step-01.png', 'img/step-02.png', 'img/step-04.png'])
      expect(md).toContain(`](${name})`);
  });
});

describe('HTML (X4, X5, X6)', () => {
  it('page matches the golden file', async () => {
    await expect(guideToHtml(fixtureInput())).toMatchFileSnapshot('./golden/guide.html');
  });

  it('page is self-contained, script-free and escapes guide text', () => {
    const html = guideToHtml(fixtureInput());
    expect(html).not.toMatch(/<script|src="(?!data:)|href="(?!#|https:\/\/example\.com)/);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('<title>Pay a supplier &lt;invoice&gt; &amp; file it</title>');
    expect(html.match(/<img class="shot" src="data:image\/png;base64,/g)).toHaveLength(3);
    // deep links and step navigation
    for (const n of [1, 2, 3, 4]) expect(html).toContain(`id="step-${n}"`);
    expect(html).toContain('href="#step-2">Next →');
    expect(html).toContain('@media print');
    expect(html).toContain('prefers-color-scheme:dark');
    expect(html).toContain('--accent:#7c3aed');
    expect(html).toContain('font-family:Georgia');
  });

  it('embed card matches the golden file', async () => {
    await expect(guideToEmbedHtml(fixtureInput())).toMatchFileSnapshot('./golden/embed.html');
  });

  it('clipboard HTML matches the golden file, with inline styles and pictures', async () => {
    const html = guideToClipboardHtml(fixtureInput());
    await expect(html).toMatchFileSnapshot('./golden/clipboard.html');
    expect(html).not.toContain('class=');
    expect(html.match(/<img [^>]*src="data:image\/png;base64,/g)).toHaveLength(4);
  });

  it('plain text lists every step', () => {
    const text = guideToText(fixtureInput());
    expect(text).toContain('1. Type alex into Username\n   Use your own username.');
    expect(text).toContain('Tip: Ask IT');
    expect(text).toContain('4. Click Submit → done');
  });

  it('handles an empty guide', () => {
    const input = fixtureInput();
    const empty = { ...input, guide: { ...input.guide, blocks: [] }, images: new Map() };
    expect(guideToHtml(empty)).toContain('This guide has no steps yet.');
    expect(guideToEmbedHtml(empty)).toContain('This guide has no steps yet.');
    expect(guideToMarkdown(empty)).toContain('This guide has no steps yet.');
  });
});

async function readPdf(bytes: Uint8Array) {
  const task = getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  const pages: { text: string; images: number }[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const ops = await page.getOperatorList();
    pages.push({
      text: content.items.map((t) => ('str' in t ? t.str : '')).join(' '),
      images: ops.fnArray.filter((f) => f === OPS.paintImageXObject).length,
    });
  }
  const info = (await pdf.getMetadata()).info as { Title?: string };
  await task.destroy();
  return { pages, info };
}

describe('PDF (X1)', () => {
  it('opens, with a cover, every step and picture, headings, callouts and page numbers', async () => {
    const bytes = await guideToPdf(fixtureInput());
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-');
    const { pages, info } = await readPdf(bytes);
    expect(info.Title).toBe('Pay a supplier <invoice> & file it');
    const cover = pages[0]!;
    expect(cover.text).toContain('Pay a supplier <invoice> & file it');
    expect(cover.text).toContain('Enter a supplier invoice');
    expect(cover.text).toContain('Before you start');
    expect(cover.images).toBe(1); // logo
    const body = pages.slice(1);
    const text = body.map((p) => p.text).join(' ');
    for (const t of ['Sign in', 'Enter the invoice', 'Tip:', 'Warning:', 'Use your own username.'])
      expect(text).toContain(t);
    for (const t of ['alex', 'Enter your password', 'New invoice', 'Submit -> done'])
      expect(text).toContain(t);
    expect(body.reduce((n, p) => n + p.images, 0)).toBe(3);
    expect(body.at(-1)!.text).toContain(`Page ${pages.length} of ${pages.length}`);
  });

  it('flows long guides across pages and keeps the picture count', async () => {
    const input = fixtureInput();
    const big = image(1280, 800, [90, 90, 90]);
    const blocks = Array.from({ length: 12 }, (_, i) => ({
      ...input.guide.blocks[1]!,
      id: `x${i}`,
    }));
    const long = {
      ...input,
      guide: { ...input.guide, blocks },
      images: new Map(blocks.map((b) => [b.id, big])),
    };
    const { pages } = await readPdf(await guideToPdf(long));
    expect(pages.length).toBeGreaterThan(4);
    expect(pages.reduce((n, p) => n + p.images, 0)).toBe(12 + 1);
    expect(pages.at(-1)!.text).toContain(`Page ${pages.length} of ${pages.length}`);
  });
});

describe('Word (X2)', () => {
  it('is a valid document with headings, a numbered list, pictures with alt text and callouts', async () => {
    const bytes = await guideToDocx(fixtureInput());
    const files = unzipSync(bytes);
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith('.xml') || name.endsWith('.rels'))
        expect(XMLValidator.validate(strFromU8(data)), name).toBe(true);
    }
    const xml = strFromU8(files['word/document.xml']!);
    expect(xml.match(/<w:drawing>/g)).toHaveLength(4); // logo + 3 steps
    expect(xml).toContain('descr="The sign-in form"');
    expect(xml).toContain('descr="Screenshot for step 1: Type alex into Username"');
    expect(xml.match(/<w:pStyle w:val="Heading1"\/>/g)).toHaveLength(2);
    expect(xml).toContain('<w:pStyle w:val="Title"/>');
    expect(xml.match(/<w:numId w:val="\d+"\/>/g)!.length).toBeGreaterThanOrEqual(4);
    expect(xml).toContain('w:fill="ECF7EF"'); // tip shading
    expect(
      Object.keys(files).filter((n) => n.startsWith('word/media/') && !n.endsWith('/')),
    ).toHaveLength(4);

    // An independent reader opens it and finds every step and picture.
    const { value: html, messages } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
    expect(messages.filter((m) => m.type === 'error')).toEqual([]);
    expect(html).toContain('<h1>Sign in</h1>');
    expect(html.match(/<li>/g)).toHaveLength(4 + 2); // 4 steps + 2 prerequisites
    expect(html.match(/<img /g)).toHaveLength(4);
    expect(html).toContain('alt="The sign-in form"');
    expect(html).toContain('<a href="https://example.com/policy?a=1&amp;b=2">');
  });
});
