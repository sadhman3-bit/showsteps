import { strFromU8, unzipSync } from 'fflate';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildStartLink, createGuide, createStep, plain, type Guide } from '../src/index.js';
import {
  guideToClipboardHtml,
  guideToDocx,
  guideToEmbedHtml,
  guideToHtml,
  guideToMarkdown,
  guideToPdf,
  type ExportInput,
} from '../src/export/index.js';

const app = { kind: 'web' as const, url: 'https://ledger.test/app/#/home' };
const guide: Guide = createGuide({
  title: 'Approve an invoice',
  blocks: [
    createStep({ action: 'navigate', app, human: { title: plain('Open Ledgerline') } }),
    createStep({ action: 'click', app, human: { title: plain('Click Approve') } }),
  ],
});
const on = (g: Guide = guide): ExportInput => ({ guide: g, images: new Map(), startLinks: true });
const guideLink = buildStartLink(guide, 'guide')!;
const runLink = buildStartLink(guide, 'run')!;
const amp = (s: string) => s.replace(/&/g, '&amp;');

/** URIs of the PDF's link annotations. */
async function pdfLinks(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().flatMap((page) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) return [];
    return annots.asArray().flatMap((ref) => {
      const annot = pdf.context.lookup(ref, PDFDict);
      const action = annot.lookupMaybe(PDFName.of('A'), PDFDict);
      const uri = action?.lookupMaybe(PDFName.of('URI'), PDFString);
      return uri ? [uri.decodeText()] : [];
    });
  });
}

describe('Guide Me and Run for me links in exports (1.2)', () => {
  it('HTML page, embed card and Copy HTML carry both links under the title', () => {
    for (const html of [guideToHtml(on()), guideToEmbedHtml(on()), guideToClipboardHtml(on())]) {
      expect(html).toContain(`<a href="${amp(guideLink)}">Guide Me</a>`);
      expect(html).toContain(`<a href="${amp(runLink)}">Run for me</a>`);
      expect(html).toContain(
        'Needs Chrome with the ShowSteps extension and this guide in its library.',
      );
    }
    expect(guideLink).toMatch(/^https:\/\/ledger\.test\/app\/#showsteps=1&guide=.+&mode=guide&v=/);
  });

  it('Markdown carries both links', () => {
    expect(guideToMarkdown(on())).toContain(
      `Open in ShowSteps: [Guide Me](<${guideLink}>) · [Run for me](<${runLink}>)`,
    );
  });

  it('PDF has link annotations, and Word has hyperlinks', async () => {
    expect(await pdfLinks(await guideToPdf(on()))).toEqual([guideLink, runLink]);
    const docx = unzipSync(await guideToDocx(on()));
    const rels = strFromU8(docx['word/_rels/document.xml.rels']!);
    expect(rels).toContain(`Target="${amp(guideLink)}"`);
    expect(rels).toContain(`Target="${amp(runLink)}"`);
  });

  it('none when switched off, or for a guide with no web step', async () => {
    const off: ExportInput = { guide, images: new Map() };
    expect(guideToHtml(off)).not.toContain('showsteps=1');
    expect(guideToMarkdown(off)).not.toContain('showsteps=1');
    expect(await pdfLinks(await guideToPdf(off))).toEqual([]);
    const desktop = createGuide({
      blocks: [
        createStep({
          action: 'click',
          app: { kind: 'desktop', processName: 'excel.exe', windowTitle: 'Book1' },
        }),
      ],
    });
    expect(guideToHtml(on(desktop))).not.toContain('Open in ShowSteps');
    expect(guideToMarkdown(on(desktop))).not.toContain('Open in ShowSteps');
  });
});
