import type { BrowserContext, Worker } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { startCaptureOn } from './helpers';

// E11 for web steps: word positions saved at capture find every planted value on the dashboard.

type Stored = {
  blocks: {
    id: string;
    kind: string;
    human?: {
      title: { spans: { text: string }[] };
      blurs: unknown[];
      screenshot?: { file: string };
    };
  }[];
};
declare const __trailmark: {
  recorder: { control(action: string): Promise<unknown>; current: { stepCount: number } };
  store: {
    getGuide(id: string): Promise<Stored>;
    listImages(id: string): Promise<string[]>;
    getImage(g: string, n: string): Promise<Uint8Array | undefined>;
    deleteImage(g: string, n: string): Promise<void>;
    saveGuide(g: Stored): Promise<void>;
  };
};

const planted = JSON.parse(
  readFileSync(new URL('../fixtures/demo-app/planted-secrets.json', import.meta.url), 'utf8'),
) as { values: { kind: string; text: string }[] };

/** Record signing in and clicking the dashboard's "Supplier contact" heading (5 steps). */
async function recordDashboard(context: BrowserContext, sw: Worker): Promise<string> {
  const page = await context.newPage();
  await page.goto('http://localhost:5173/login.html');
  await page.bringToFront();
  const guideId = await startCaptureOn(sw, 'http://localhost:5173/');
  await page.locator('trailmark-controller').getByRole('toolbar').waitFor();
  await page.waitForTimeout(650);
  await page.getByLabel('Username').fill('alex');
  await page.waitForTimeout(650);
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.waitForTimeout(650);
  await page.getByRole('button', { name: 'Sign in' }).click({ delay: 120 });
  await page.waitForURL(/\/app\/$/);
  // Bring the supplier contact panel into view and click its heading.
  const heading = page.getByRole('heading', { name: 'Supplier contact' });
  // The slow "Recent invoices" section moves the table down when it loads: wait for it.
  await expect(page.getByText('Loading recent invoices…')).toHaveCount(0, { timeout: 10_000 });
  // The whole table on screen: its last row is the IBAN.
  await page.getByRole('cell', { name: 'GB82 WEST 1234 5698 7654 32' }).scrollIntoViewIfNeeded();
  await expect(heading).toBeInViewport();
  await page.waitForTimeout(650);
  await heading.click({ delay: 120 });
  await expect.poll(() => sw.evaluate(() => __trailmark.recorder.current.stepCount)).toBe(5);
  await page.waitForTimeout(400);
  await sw.evaluate(() => __trailmark.recorder.control('finish'));
  return guideId;
}

test('Secure Blur finds every planted value on the dashboard and blurs after review (E11)', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  const guideId = await recordDashboard(context, sw);

  // Word files sit next to the pictures and never hold the password.
  const words = await sw.evaluate(async (id) => {
    const out: string[] = [];
    for (const name of await __trailmark.store.listImages(id))
      if (name.endsWith('.words.json'))
        out.push(new TextDecoder().decode(await __trailmark.store.getImage(id, name)));
    return out;
  }, guideId);
  // Each picture taken from the page has its words (how many pictures there are depends on
  // Chrome's two-per-second limit: a step may reuse the previous one).
  expect(words.some((w) => w.includes('accounts@saltbush-supplies.example'))).toBe(true);
  for (const w of words) expect(w).not.toContain('not-a-real-password');

  const editor = await context.newPage();
  await editor.goto(`chrome-extension://${extensionId}/library.html#/guide/${guideId}`);
  await editor.getByRole('button', { name: 'Secure Blur' }).click();
  const dialog = editor.getByRole('dialog', { name: 'Secure Blur' });
  const region = dialog.getByRole('region', { name: 'Secure Blur' });
  await expect(region).toBeVisible();
  const items = region.getByRole('checkbox');
  await expect(items).toHaveCount(planted.values.length);
  for (const label of [
    'Email',
    'Phone number',
    'Card number',
    'BSB',
    'Account number',
    'Tax file number',
    'ABN',
    'IBAN',
  ])
    await expect(region.getByText(label, { exact: true })).toBeVisible();
  // Values are masked on the review screen.
  await expect(region).toContainText('1111');
  await expect(region).not.toContainText('4111 1111 1111 1111');
  await expect(region.getByRole('img', { name: /Step 5 screenshot/ })).toBeVisible();
  await editor.screenshot({ path: test.info().outputPath('secure-blur.png') });

  // Leave one out, then blur the rest.
  await region.getByRole('checkbox', { name: /^Email/ }).uncheck();
  await dialog.getByRole('button', { name: `Blur ${planted.values.length - 1} items` }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => {
      const g = await sw.evaluate((id) => __trailmark.store.getGuide(id), guideId);
      return g.blocks.find((b) => b.kind === 'step' && b.human?.blurs.length)?.human?.blurs.length;
    })
    .toBe(planted.values.length - 1);

  // A second run only offers what is still unblurred.
  await editor.getByRole('button', { name: 'Secure Blur' }).click();
  await expect(region.getByRole('checkbox')).toHaveCount(1);
  await expect(region.getByText('Email', { exact: true })).toBeVisible();
});

test('OCR reads the screenshots that have no word positions, offline (U8, E11 for desktop and image steps)', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  test.setTimeout(180_000);
  const guideId = await recordDashboard(context, sw);
  // As for desktop and uploaded pictures: no word positions saved with the screenshots.
  await sw.evaluate(async (id) => {
    for (const name of await __trailmark.store.listImages(id))
      if (name.endsWith('.words.json')) await __trailmark.store.deleteImage(id, name);
  }, guideId);
  // Nothing may come from the internet: the engine is bundled with the extension.
  const remote: string[] = [];
  context.on('request', (r) => {
    if (!/^(chrome-extension|data|blob):|^http:\/\/(localhost|127\.0\.0\.1)/.test(r.url()))
      remote.push(r.url());
  });

  const editor = await context.newPage();
  await editor.goto(`chrome-extension://${extensionId}/library.html#/guide/${guideId}`);
  await editor.getByRole('button', { name: 'Secure Blur' }).click();
  const dialog = editor.getByRole('dialog', { name: 'Secure Blur' });
  await expect(dialog.getByRole('status')).toContainText(/Reading the text|Looking through/);
  const region = dialog.getByRole('region', { name: 'Secure Blur' });
  await expect(region).toBeVisible({ timeout: 120_000 });
  for (const label of [
    'Email',
    'Phone number',
    'Card number',
    'BSB',
    'Account number',
    'Tax file number',
    'ABN',
    'IBAN',
  ])
    await expect(region.getByText(label, { exact: true })).toBeVisible();
  await editor.screenshot({ path: test.info().outputPath('secure-blur-ocr.png') });
  // The text read is kept beside each picture, so the next scan needs no OCR.
  const kept = await sw.evaluate(
    async (id) =>
      (await __trailmark.store.listImages(id)).filter((n) => n.endsWith('.words.json')).length,
    guideId,
  );
  expect(kept).toBeGreaterThanOrEqual(3);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // U8: a visual-only step gets the text around its action.
  await sw.evaluate(async (id) => {
    const g = await __trailmark.store.getGuide(id);
    const last = g.blocks.filter((b) => b.kind === 'step').at(-1) as unknown as {
      agent: { visualOnly: boolean };
    };
    last.agent.visualOnly = true;
    await __trailmark.store.saveGuide(g);
  }, guideId);
  await editor.reload();
  await expect
    .poll(
      async () =>
        sw.evaluate(async (id) => {
          const g = await __trailmark.store.getGuide(id);
          const last = g.blocks.filter((b) => b.kind === 'step').at(-1) as unknown as {
            target?: { ocrText?: string };
          };
          return last.target?.ocrText ?? '';
        }, guideId),
      { timeout: 90_000 },
    )
    .toContain('Supplier contact');
  expect(remote).toEqual([]);
});
