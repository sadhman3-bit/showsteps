import { writeFileSync } from 'node:fs';
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures';

// M2 acceptance: record the demo app's "create invoice" flow and check the steps.

type Hook = {
  startCapture(msg: { type: 'start'; tabId: number }): Promise<{ guideId?: string }>;
  store: { getGuide(id: string): Promise<unknown>; listImages(id: string): Promise<string[]> };
};
declare const __trailmark: Hook;

/** A human-like pause, so screenshots are not skipped by Chrome's 2-per-second limit. */
const human = (page: Page) => page.waitForTimeout(650);

async function startOn(sw: Worker, url: string) {
  const tabId = await sw.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: `${u}*` });
    return tab?.id ?? -1;
  }, url);
  return sw.evaluate((id) => __trailmark.startCapture({ type: 'start', tabId: id }), tabId);
}

type StoredStep = {
  kind: 'step';
  id: string;
  action: string;
  human: {
    title: { spans: { text: string; bold?: boolean }[] };
    screenshot?: { file: string; width: number; height: number; reusedFromStepId?: string };
    actionBox?: { x: number; y: number; w: number; h: number };
  };
  target?: { frames?: string[]; shadowHosts?: string[] };
  input?: { value?: string; sensitive: boolean };
};

const md = (s: StoredStep) =>
  s.human.title.spans.map((x) => (x.bold ? `**${x.text}**` : x.text)).join('');

test('records the create-invoice flow across pages, iframes, shadow DOM and a dialog', async ({
  context,
  serviceWorker,
}) => {
  test.setTimeout(90_000);
  const page = await context.newPage();
  await page.goto('http://localhost:5173/login.html');
  await page.bringToFront();

  const { guideId } = await startOn(serviceWorker, 'http://localhost:5173/');
  expect(guideId).toBeTruthy();
  const controller = page.locator('trailmark-controller');
  await expect(
    controller.getByRole('toolbar', { name: 'Trailmark capture controls' }),
  ).toBeVisible();
  await human(page);

  // Page 1: login (full page load afterwards)
  await page.getByLabel('Username').fill('alex');
  await human(page);
  await page.getByLabel('Password').fill('not-a-real-password');
  await human(page);
  await page.getByRole('button', { name: 'Sign in' }).click({ delay: 120 });
  await expect(page).toHaveURL(/\/app\/$/);
  await expect(controller.getByRole('toolbar')).toBeVisible();
  await human(page);

  // Page 2: the SPA
  await page.getByTestId('new-invoice').click({ delay: 120 });
  await human(page);
  await page.getByLabel('Supplier').fill('Harbour Paper Co.');
  await human(page);
  await page.getByLabel('Invoice no.').fill('INV-1043');
  await human(page);
  await page.getByLabel('Amount').fill('1280.50');
  await human(page);
  await page.getByLabel('Currency').selectOption('NZD');
  await human(page);
  await page.getByLabel('Invoice date').fill('2026-10-01');
  await human(page);
  await page.getByLabel('Includes GST').check();
  await human(page);
  await page.getByLabel('Cheque').check();
  await human(page);
  await page.getByLabel('Attach invoice PDF').setInputFiles({
    name: 'invoice.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 demo'),
  });
  await human(page);

  // Cross-origin iframe
  const widget = page.frameLocator('iframe[title="Cost centre lookup"]');
  await widget.getByLabel('Cost centre lookup').selectOption('CC-220 Operations');
  await human(page);
  await widget.getByRole('button', { name: 'Use this cost centre' }).click({ delay: 120 });
  await human(page);

  // Same-origin iframe
  await page
    .frameLocator('iframe[title="Internal note"]')
    .getByLabel('Note for approver')
    .fill('Please approve by Friday.');
  await human(page);

  // Shadow DOM
  await page.getByRole('searchbox', { name: 'Search approvers' }).fill('mei');
  await human(page);
  await page.getByRole('button', { name: 'Mei Chen' }).click({ delay: 120 });
  await human(page);

  // Dialog with the irreversible action
  await page.getByRole('button', { name: 'Review invoice' }).click({ delay: 250 });
  await human(page);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Submit invoice' })
    .click({ delay: 120 });
  await expect(page).toHaveURL(/\/invoices\/done$/);
  await human(page);

  await controller.getByRole('button', { name: 'Finish' }).click();
  await expect(controller).toHaveCount(0);

  const guide = (await serviceWorker.evaluate(
    (id) => __trailmark.store.getGuide(id),
    guideId!,
  )) as {
    blocks: StoredStep[];
  };
  const steps = guide.blocks.filter((b) => b.kind === 'step');
  expect(steps.map(md)).toEqual([
    'Go to **localhost:5173**',
    'Type **alex** into **Username**',
    'Enter your password',
    'Click **Sign in**',
    'Click **New invoice**',
    'Type **Harbour Paper Co.** into **Supplier**',
    'Type **INV-1043** into **Invoice no.**',
    'Type **1280.50** into **Amount**',
    'Select **NZD** from **Currency**',
    'Type **2026-10-01** into **Invoice date**',
    'Check **Includes GST**',
    'Select **Cheque**',
    'Upload **invoice.pdf**',
    'Select **CC-220 Operations** from **Cost centre lookup**',
    'Click **Use this cost centre**',
    'Type **Please approve by Friday.** into **Note for approver**',
    'Type **mei** into **Search approvers**',
    'Click **Mei Chen**',
    'Click **Review invoice**',
    'Click **Submit invoice**',
  ]);

  // Secrets never stored.
  expect(JSON.stringify(guide)).not.toContain('not-a-real-password');
  expect(steps[2]!.input).toEqual({ mode: 'fixed', sensitive: true });

  // Every step has a screenshot; most are fresh; Action Boxes lie inside their images.
  const images = await serviceWorker.evaluate((id) => __trailmark.store.listImages(id), guideId!);
  let fresh = 0;
  for (const s of steps) {
    const shot = s.human.screenshot;
    expect(shot, md(s)).toBeDefined();
    expect(images).toContain(shot!.file.replace(/^img\//, ''));
    if (!shot!.reusedFromStepId) fresh++;
    const box = s.human.actionBox;
    if (box) {
      expect(box.x + box.w).toBeLessThanOrEqual(shot!.width);
      expect(box.y + box.h).toBeLessThanOrEqual(shot!.height);
    }
  }
  // A skipped capture (Chrome allows two per second) reuses the previous step's image, which
  // was taken at the same moment: e.g. typing committed by the click that follows it.
  for (const [i, s] of steps.entries()) {
    const from = s.human.screenshot?.reusedFromStepId;
    if (!from) continue;
    const source = steps.findIndex((x) => x.id === from);
    expect(source, md(s)).toBeGreaterThanOrEqual(0);
    expect(source).toBeLessThan(i);
    expect(steps[source]!.human.screenshot?.reusedFromStepId).toBeUndefined();
    expect(s.human.screenshot?.file).toBe(steps[source]!.human.screenshot?.file);
  }
  expect(fresh).toBeGreaterThanOrEqual(10);

  // Iframe and shadow DOM targets carry their context.
  const byTitle = (t: string) => steps.find((s) => md(s).includes(t))!;
  expect(byTitle('Use this cost centre').target?.frames).toEqual([
    'iframe[title="Cost centre lookup"]',
  ]);
  expect(byTitle('Note for approver').target?.frames).toEqual(['iframe[title="Internal note"]']);
  expect(byTitle('Mei Chen').target?.shadowHosts).toEqual(['tm-approver-picker']);

  // Iframe targets were shifted into the top frame: the iframe sits below the form fields, so
  // its button cannot be at the iframe-local origin.
  const useBtn = byTitle('Use this cost centre') as StoredStep & {
    target: { bbox: { x: number; y: number } };
  };
  expect(useBtn.target.bbox.x).toBeGreaterThan(20);

  // Keep one screenshot with its Action Box drawn on it, for a human to eyeball in the report.
  const review = byTitle('Review invoice');
  const { png, brightness } = await serviceWorker.evaluate(
    async ({ id, file, box }) => {
      const store = __trailmark.store as unknown as {
        getImage(g: string, n: string): Promise<Uint8Array>;
      };
      const bytes = await store.getImage(id, file.replace(/^img\//, ''));
      const bmp = await createImageBitmap(new Blob([bytes]));
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      // Brightness of the page margin, left of the form: a modal backdrop would darken it.
      const [r = 0, g = 0, b = 0] = ctx.getImageData(60, 400, 1, 1).data;
      const brightness = (r + g + b) / 3;
      ctx.strokeStyle = '#c2410c';
      ctx.lineWidth = 4;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return { png: Array.from(new Uint8Array(await blob.arrayBuffer())), brightness };
    },
    { id: guideId!, file: review.human.screenshot!.file, box: review.human.actionBox! },
  );
  writeFileSync(test.info().outputPath('review-step.png'), Buffer.from(png));
  // Taken on pointerdown, before the click opened the dialog (no dark backdrop yet).
  expect(brightness, 'review screenshot taken after the dialog opened').toBeGreaterThan(220);
});
