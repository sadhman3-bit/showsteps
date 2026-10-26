import { strFromU8, unzipSync } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { BrandKitSchema, SHOWSTEPS_KIT, resolveBrand, type BrandKit } from '../src/index.js';
import {
  guideToDocx,
  guideToEmbedHtml,
  guideToHtml,
  guideToMarkdown,
  guideToPdf,
  procedureFromDocx,
  procedureFromPdf,
} from '../src/export/index.js';
import { fixtureInput } from './helpers/exportFixture.js';

/** A company's kit with every ShowSteps mark off. */
const ACME: BrandKit = BrandKitSchema.parse({
  ...SHOWSTEPS_KIT,
  id: 'acme',
  name: 'Acme',
  company: 'Acme Pty Ltd',
  colors: { ...SHOWSTEPS_KIT.colors, accent: '#0055aa', links: '#0055aa', headings: '#112233' },
  cover: {
    style: 'plain',
    height: 'small',
    elements: [
      { kind: 'logo', visible: true },
      { kind: 'title', visible: true },
      { kind: 'meta', visible: true },
      { kind: 'description', visible: false },
    ],
  },
  page: {
    header: { left: '{company}', centre: '', right: '{title}' },
    footer: { left: '{date}', centre: '', right: 'p. {page}/{pages}' },
    notice: 'Confidential: internal use only',
    size: 'Letter',
  },
  steps: { numberStyle: 'square', pictureBorder: false },
  marks: {
    pattern: false,
    openInLinks: false,
    agentLine: false,
    agentData: false,
    generator: 'company',
  },
});

const branded = () => {
  const input = fixtureInput();
  return { ...input, brand: resolveBrand(input.guide, { kits: [ACME], defaultKit: 'acme' }) };
};

async function pdfText(bytes: Uint8Array) {
  const task = getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  const pages: string[] = [];
  const sizes: number[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    sizes.push(page.view.slice(2).map(Math.round));
    pages.push((await page.getTextContent()).items.map((t) => ('str' in t ? t.str : '')).join(' '));
  }
  const info = (await pdf.getMetadata()).info as Record<string, unknown>;
  await task.destroy();
  return { pages, sizes, info };
}

describe('exports in a company’s brand (B2)', () => {
  it('PDF: the kit’s page size, header, footer and notice, and no ShowSteps marks', async () => {
    const bytes = await guideToPdf(branded());
    const { pages, sizes, info } = await pdfText(bytes);
    expect(sizes[0]).toEqual([612, 792]);
    const body = pages.slice(1).join(' ');
    expect(body).toContain('Acme Pty Ltd');
    expect(body).toContain('Confidential: internal use only');
    expect(body).toMatch(/p\. 2\/\d/);
    expect(pages.join(' ')).not.toMatch(/ShowSteps|Agent-readable/);
    expect(info.Creator).toBe('Acme Pty Ltd');
    expect(info.Producer).toBe('Acme Pty Ltd');
    expect(await procedureFromPdf(bytes)).toBeUndefined();
    // The description was hidden on the cover.
    expect(pages[0]).not.toContain(fixtureInput().guide.description ?? '§');
  });

  it('Word: the kit’s header, footer and notice, and no ShowSteps marks or procedure', async () => {
    const bytes = await guideToDocx(branded());
    const files = unzipSync(bytes);
    const xml = Object.entries(files)
      .filter(([n]) => n.endsWith('.xml'))
      .map(([, b]) => strFromU8(b))
      .join('\n');
    expect(xml).toContain('Acme Pty Ltd');
    expect(xml).toContain('Confidential: internal use only');
    expect(xml).toContain('w:w="12240"'); // Letter
    expect(xml).not.toMatch(/ShowSteps|Agent-readable/);
    expect(procedureFromDocx(bytes)).toBeUndefined();
  });

  it('web page, embed card and Markdown: no ShowSteps marks', () => {
    const input = branded();
    const page = guideToHtml(input);
    expect(page).toContain('<meta name="generator" content="Acme Pty Ltd">');
    expect(page).toContain('Confidential: internal use only');
    expect(page).not.toContain('class="cover__art"');
    expect(page).toContain('h1,h2{color:#112233}');
    expect(page).toContain('.num{border-radius:6px}');
    expect(page).not.toMatch(/ShowSteps|Agent-readable|application\/json/);
    expect(guideToEmbedHtml(input)).not.toMatch(/ShowSteps/);
    const md = guideToMarkdown(input);
    expect(md).not.toMatch(/ShowSteps|Agent-readable|<details>/);
    expect(md).toContain('*Confidential: internal use only*');
  });

  it('ShowSteps’s own kit draws exactly what exports drew before', async () => {
    const input = fixtureInput();
    const own = { ...input, brand: resolveBrand(input.guide) };
    expect(guideToHtml(own)).toBe(guideToHtml(input));
    expect(guideToMarkdown(own)).toBe(guideToMarkdown(input));
    expect(await guideToPdf(own)).toEqual(await guideToPdf(input));
  });
});
