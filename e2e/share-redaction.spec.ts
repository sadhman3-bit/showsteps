import type { Page, Worker } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { expect, launchProfile, test } from './fixtures';

type Rect = { x: number; y: number; w: number; h: number };
type StoredStep = {
  id: string;
  kind: string;
  human?: {
    title: { spans: { text: string }[] };
    blurs: Rect[];
    screenshot?: { file: string; crop?: Rect; zoom?: number };
    original?: unknown;
  };
};
type StoredGuide = { id: string; title: string; blocks: StoredStep[] };
type Hook = {
  installSamples(): Promise<string[]>;
  store: {
    getGuide(id: string): Promise<StoredGuide>;
    saveGuide(g: StoredGuide): Promise<void>;
    getImage(id: string, name: string): Promise<Uint8Array>;
    listGuides(): Promise<{ id: string; title: string }[]>;
  };
};
declare const __showsteps: Hook;

const INVOICE = 'Create a supplier invoice in Ledgerline';
const STEP = 'Type INV-1043 into Invoice no.';
/** Over "INV-1043" in the Invoice no. field (image pixels; the picture is 1280 × 800). */
const BLUR: Rect = { x: 217, y: 275, w: 300, h: 47 };

const titleOf = (s: StoredStep) => s.human?.title.spans.map((x) => x.text).join('') ?? '';

/** The guide's invoice-number step and its picture's bytes. */
async function invoiceStep(sw: Worker, title: string) {
  return sw.evaluate(
    async ({ title, step }) => {
      const summary = (await __showsteps.store.listGuides()).find((g) => g.title === title)!;
      const guide = await __showsteps.store.getGuide(summary.id);
      const s = guide.blocks.find(
        (b) => b.human?.title.spans.map((x) => x.text).join('') === step,
      )!;
      const file = s.human!.screenshot!.file.replace(/^img\//, '');
      return {
        guide,
        step: s,
        bytes: Array.from(await __showsteps.store.getImage(guide.id, file)),
      };
    },
    { title, step: STEP },
  );
}

/**
 * Mean difference between two pictures in `rect`, and each one's edge energy there (high for
 * text, low once blurred). Decodes in the page.
 */
function compare(page: Page, a: number[], b: number[], rect: Rect) {
  return page.evaluate(
    async ({ a, b, rect }) => {
      const pixels = async (bytes: number[]) => {
        const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
      };
      const edges = (d: ImageData) => {
        let sum = 0;
        const row = d.width * 4;
        for (let i = row; i < d.data.length; i += 4)
          sum += Math.abs(d.data[i]! - d.data[i - 4]!) + Math.abs(d.data[i]! - d.data[i - row]!);
        return sum / (d.data.length / 4);
      };
      const [pa, pb] = [await pixels(a), await pixels(b)];
      let diff = 0;
      for (let i = 0; i < pa.data.length; i++) diff += Math.abs(pa.data[i]! - pb.data[i]!);
      return { diff: diff / pa.data.length, before: edges(pa), after: edges(pb) };
    },
    { a, b, rect },
  );
}

test('a shared guide file carries the blurs burned in, and nothing that was under them (H1)', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  test.setTimeout(120_000);
  // Blur the invoice number, keeping the whole picture (no crop or magnify).
  await serviceWorker.evaluate(
    async ({ title, step, blur }) => {
      await __showsteps.installSamples();
      const summary = (await __showsteps.store.listGuides()).find((g) => g.title === title)!;
      const guide = await __showsteps.store.getGuide(summary.id);
      const s = guide.blocks.find(
        (b) => b.human?.title.spans.map((x) => x.text).join('') === step,
      )!;
      delete s.human!.screenshot!.crop;
      delete s.human!.screenshot!.zoom;
      s.human!.blurs = [blur];
      await __showsteps.store.saveGuide(guide);
    },
    { title: INVOICE, step: STEP, blur: BLUR },
  );
  const mine = await invoiceStep(serviceWorker, INVOICE);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/library.html#/guide/${mine.guide.id}/view`);
  await page.getByRole('button', { name: 'Share' }).click();
  const dl = page.waitForEvent('download');
  await page
    .getByRole('dialog', { name: 'Share this guide' })
    .getByRole('button', { name: /^ShowSteps file\b/ })
    .click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe(`${INVOICE}.showsteps`);
  const path = test.info().outputPath('shared.showsteps');
  await file.saveAs(path);

  // The file itself: no page text, no originals, no blur rectangles, only pictures in use.
  const zip = unzipSync(new Uint8Array(readFileSync(path)));
  const names = Object.keys(zip).filter((n) => !n.endsWith('/'));
  expect(names.filter((n) => n.endsWith('.words.json'))).toEqual([]);
  const shared = JSON.parse(strFromU8(zip['guide.json']!)) as StoredGuide & { updatedBy?: string };
  expect(shared.updatedBy).toBeUndefined();
  const steps = shared.blocks.filter((b) => b.kind === 'step');
  const used = new Set<string>();
  for (const s of steps) {
    expect(s.human!.blurs).toEqual([]);
    expect(s.human!.original).toBeUndefined();
    if (s.human!.screenshot) used.add(s.human!.screenshot.file);
  }
  const pictures = names.filter((n) => n.startsWith('img/') && !n.includes('.thumb.'));
  for (const n of pictures) expect(used.has(n) || n.startsWith('img/branding')).toBe(true);

  // Someone else imports it into their own, fresh ShowSteps.
  const other = await launchProfile();
  try {
    const lib = await other.context.newPage();
    await lib.goto(`chrome-extension://${other.extensionId}/library.html`);
    await lib.getByLabel('Import').setInputFiles(path);
    await expect(lib.getByText('Guide imported.')).toBeVisible();
    const theirs = await invoiceStep(other.serviceWorker, INVOICE);
    expect(theirs.step.human!.blurs).toEqual([]);
    expect(titleOf(theirs.step)).toBe(STEP);

    // Under the blur the pixels changed and the text's edges are gone.
    const { diff, before, after } = await compare(lib, mine.bytes, theirs.bytes, BLUR);
    expect(diff).toBeGreaterThan(5);
    expect(after).toBeLessThan(before / 3);
    // Away from the blur the picture is the same.
    const away = await compare(lib, mine.bytes, theirs.bytes, { x: 217, y: 120, w: 300, h: 40 });
    expect(away.diff).toBeLessThan(4);
  } finally {
    await other.close();
  }
});
