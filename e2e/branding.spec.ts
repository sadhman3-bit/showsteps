import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { audit } from './a11y-helpers';
import { expect, test } from './fixtures';

// B4–B6: a company's brand kit, built on the Branding page, made the default, and every PDF
// then looks like the company's with no ShowSteps marks.

declare const __showsteps: {
  installSamples(): Promise<string[]>;
  store: { listGuides(): Promise<{ id: string; title: string }[]> };
};

const INVOICE = 'Create a supplier invoice in Ledgerline';
/** ShowSteps's own 128 px icon, as a stand-in company logo. */
const LOGO = readFileSync(new URL('../apps/extension/public/icon/128.png', import.meta.url));

async function pdfOf(path: string) {
  const task = getDocument({ data: new Uint8Array(readFileSync(path)) });
  const pdf = await task.promise;
  const pages: { text: string; images: number }[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    pages.push({
      text: (await page.getTextContent()).items.map((t) => ('str' in t ? t.str : '')).join(' '),
      images: (await page.getOperatorList()).fnArray.filter((f) => f === OPS.paintImageXObject)
        .length,
    });
  }
  const info = (await pdf.getMetadata()).info as Record<string, unknown>;
  const size = (await pdf.getPage(1)).view.slice(2).map(Math.round);
  await task.destroy();
  return { pages, info, size };
}

const editor = (page: Page) => page.getByRole('region', { name: /^Brand kit: / });

test('a brand kit made on the Branding page brands every PDF, with no ShowSteps marks (B4–B6)', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  test.setTimeout(120_000);
  await serviceWorker.evaluate(() => __showsteps.installSamples());
  const page = await context.newPage();
  // The logo is converted slowly, as on a busy machine: fields changed meanwhile must stay.
  await page.addInitScript(() => {
    const real = globalThis.createImageBitmap.bind(globalThis);
    globalThis.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      await new Promise((done) => setTimeout(done, 1500));
      return real(...args);
    }) as typeof createImageBitmap;
  });
  await page.goto(`chrome-extension://${extensionId}/library.html`);
  await page.getByRole('button', { name: 'Branding' }).click();
  await expect(page).toHaveURL(/#\/branding$/);
  await page.getByRole('button', { name: 'New kit' }).click();
  const kit = editor(page);
  await expect(kit).toBeVisible();

  await kit.getByLabel('Kit name').fill('Acme');
  await kit.getByLabel(/^Company name/).fill('Acme Pty Ltd');
  await kit.getByLabel('Style').selectOption('plain');
  // Swap the cover's pieces: the logo first, the description hidden.
  await kit.getByRole('button', { name: 'Move up: Logo' }).click();
  await kit.getByRole('button', { name: 'Move up: Logo' }).click();
  await kit.getByRole('checkbox', { name: 'Description' }).uncheck();
  await kit.getByLabel('Logo (for light backgrounds)').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: LOGO,
  });
  const footer = kit.getByRole('group', { name: 'Page footer' });
  await footer.getByLabel('Left', { exact: true }).fill('Acme Pty Ltd');
  await footer.getByLabel('Right', { exact: true }).fill('p. ');
  await footer
    .getByRole('combobox', { name: 'Insert into Page footer, Right' })
    .selectOption('{page}');
  await kit.getByLabel('Notice on every page').fill('Confidential: internal use only');
  await expect(kit.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
  await kit.getByLabel('Page size (PDF and Word)').selectOption('Letter');
  for (const mark of [
    'The trail pattern on the cover',
    'Guide Me and Run for me links (can still be ticked in Share)',
    'The line “Agent-readable procedure embedded”',
    'The procedure for AI agents inside PDF and Word files',
  ])
    await kit.getByRole('checkbox', { name: mark }).uncheck();
  await kit.getByLabel(/^File made by/).selectOption('company');
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();

  // The preview is the real web page, in this kit.
  const preview = page.frameLocator('iframe[title="Preview of a guide in this kit"]');
  await expect(preview.getByText('Confidential: internal use only')).toBeVisible();
  await expect(preview.locator('body')).not.toContainText('ShowSteps');

  // Named controls, 24 px targets.
  const { unnamed, small } = await audit(page);
  expect(unnamed).toEqual([]);
  expect(small).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('branding.png'), fullPage: true });

  // Default for all guides; then a PDF from the Share dialog.
  await page.getByLabel('Default for all guides').selectOption({ label: 'Acme' });
  const id = await serviceWorker.evaluate(
    async (title) => (await __showsteps.store.listGuides()).find((g) => g.title === title)!.id,
    INVOICE,
  );
  await page.goto(`chrome-extension://${extensionId}/library.html#/guide/${id}/view`);
  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share this guide' });
  await expect(dialog.getByLabel('Brand')).toBeVisible();
  // The kit leaves the links out, so the toggle starts off.
  await expect(
    dialog.getByRole('checkbox', { name: /Guide Me and Run for me links/ }),
  ).not.toBeChecked();
  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /^PDF\b/ }).click();
  const path = test.info().outputPath('acme.pdf');
  await (await dl).saveAs(path);
  const { pages, info, size } = await pdfOf(path);
  expect(size).toEqual([612, 792]);
  expect(pages[0]!.images).toBeGreaterThanOrEqual(1); // the logo
  const body = pages
    .slice(1)
    .map((p) => p.text)
    .join(' ');
  expect(body).toContain('Acme Pty Ltd');
  expect(body).toContain('Confidential: internal use only');
  expect(body).toMatch(/p\. 2\b/);
  expect(pages.map((p) => p.text).join(' ')).not.toMatch(/ShowSteps|Agent-readable/);
  expect(info.Creator).toBe('Acme Pty Ltd');
});
