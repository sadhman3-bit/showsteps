// Chrome Web Store images (docs/webstore/images): 1280×800 screenshots of the real extension
// and the 440×280 promo tile. Its own Playwright project, not part of `pnpm e2e`:
// `pnpm store:images` (build first).
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { startCaptureOn } from './helpers';

const OUT = fileURLToPath(new URL('../docs/webstore/images/', import.meta.url));
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

/** Scroll so the "Enter the invoice" section starts just under the editor's toolbar. */
async function toSection(page: Page): Promise<void> {
  await page.waitForTimeout(500);
  // The reader shows it as a heading; the editor as a text field or editable text.
  const found = await page.evaluate((text) => {
    const all = Array.from(document.querySelectorAll<HTMLElement>('h2, input, [contenteditable]'));
    const el = all.find(
      (e) => (e instanceof HTMLInputElement ? e.value : e.textContent)?.trim() === text,
    );
    el?.scrollIntoView();
    scrollBy(0, -76);
    return Boolean(el);
  }, 'Enter the invoice');
  expect(found).toBe(true);
  await page.waitForTimeout(800);
}

test('Chrome Web Store images', async ({ context, serviceWorker, extensionId }) => {
  test.setTimeout(120_000);
  mkdirSync(OUT, { recursive: true });
  const tokens = read('../packages/ui/src/tokens.css');
  const icon = read('../apps/extension/assets/icon.svg');

  // 2 and 3. A finished guide (from an empty library): the reader and the agent view.
  const lib = await context.newPage();
  await lib.goto(`chrome-extension://${extensionId}/library.html`);
  await lib.getByRole('button', { name: 'Add the sample guides' }).click();
  const list = lib.getByRole('list', { name: 'Library' });
  await list.getByRole('button', { name: 'Create a supplier invoice in Ledgerline' }).click();
  await lib.getByRole('button', { name: 'Preview' }).click();
  await expect(lib.locator('.tm-reader .tm-step svg[role="img"]').first()).toBeVisible();
  await toSection(lib);
  await lib.screenshot({ path: `${OUT}2-guide.png` });
  await lib.getByRole('button', { name: 'Agent' }).click();
  await lib.waitForTimeout(500);
  await lib.evaluate(() => scrollTo(0, 0));
  await lib.waitForTimeout(500);
  await lib.screenshot({ path: `${OUT}3-agent.png` });

  // 1. Recording: the page with its toolbar, and the side panel listing the steps.
  const page = await context.newPage();
  await page.goto('http://localhost:5173/app/');
  await page.getByRole('cell', { name: 'INV-1042' }).waitFor();
  const opened = context.waitForEvent('page');
  await serviceWorker.evaluate(
    (url) => chrome.windows.create({ url, type: 'popup', width: 400, height: 800, focused: false }),
    `chrome-extension://${extensionId}/sidepanel.html`,
  );
  const panel = await opened;
  await panel.setViewportSize({ width: 400, height: 800 });
  await page.bringToFront();
  await startCaptureOn(serviceWorker, 'http://localhost:5173/');
  const bar = page.locator('trailmark-controller').getByRole('toolbar');
  await expect(bar).toContainText('1 step');
  await page.waitForTimeout(650);
  await page.getByRole('heading', { name: 'Recent invoices' }).click({ delay: 100 });
  await page.waitForTimeout(650);
  await page.getByRole('cell', { name: 'INV-1042' }).click({ delay: 100 });
  await expect(bar).toContainText('3 steps');
  await expect(panel.getByRole('list').getByRole('listitem')).toHaveCount(3);
  await page.waitForTimeout(400);
  await page.getByRole('cell', { name: 'INV-1041' }).click({ delay: 100 });
  await expect(page.locator('trailmark-controller .toast')).toContainText('INV-1041');
  // The toolbar sits left of where the side panel goes in the picture.
  await page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('trailmark-controller');
    if (bar) bar.style.right = '420px';
  });
  const left = (await page.screenshot()).toString('base64');
  await expect(panel.getByRole('list').getByRole('listitem')).toHaveCount(4);
  await panel.waitForTimeout(800);
  const right = (await panel.screenshot()).toString('base64');
  await panel.getByRole('button', { name: 'Finish' }).click();

  const shot = await context.newPage();
  await shot.setContent(`<style>${tokens}
    body { margin: 0; width: 1280px; height: 800px; display: flex; background: var(--tm-border); }
    .l { width: 879px; height: 800px; object-fit: cover; object-position: left top; }
    .r { width: 400px; height: 800px; margin-left: 1px; }</style>
    <img class="l" src="data:image/png;base64,${left}"><img class="r" src="data:image/png;base64,${right}">`);
  await shot.screenshot({ path: `${OUT}1-record.png` });

  // Small promo tile.
  const tile = await context.newPage();
  await tile.setViewportSize({ width: 440, height: 280 });
  await tile.setContent(`<style>${tokens}
    body { margin: 0; width: 440px; height: 280px; display: flex; flex-direction: column;
      justify-content: center; gap: 14px; padding: 0 36px; box-sizing: border-box;
      background: var(--tm-chrome-bg); color: var(--tm-chrome-fg); font-family: var(--tm-font); }
    .brand { display: flex; align-items: center; gap: 14px; font-size: 40px; font-weight: 700; }
    .brand svg { width: 64px; height: 64px; }
    p { margin: 0; font-size: 17px; line-height: 1.35; color: var(--tm-chrome-muted); }
    b { color: var(--tm-chrome-accent); font-weight: 600; }</style>
    <div class="brand">${icon}Trailmark</div>
    <p>Record a process once. Get a step-by-step guide.<br><b>Private: nothing leaves your computer.</b></p>`);
  await tile.screenshot({ path: `${OUT}promo-440x280.png` });
});
