// Chrome Web Store images (docs/webstore/images): three 1280×800 screenshots of the real
// extension, the 440×280 small promo tile and the 1400×560 marquee. Its own Playwright
// project, not part of `pnpm e2e`: `pnpm store:images` (after `pnpm build`).
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { saveSchedule, scheduledGuide } from './schedule-helpers';
import { startCaptureOn } from './helpers';

const OUT = fileURLToPath(new URL('../docs/webstore/images/', import.meta.url));
const file = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const read = (path: string) => readFileSync(file(path), 'utf8');
const b64 = (path: string) => readFileSync(file(path)).toString('base64');

/** Brand art and fonts for the promo pages (set as page content, so everything is inline). */
function brandCss(): string {
  const tokens = read('../packages/ui/src/tokens.css').replace(/@import[^;]+;/, '');
  const face = (family: string, path: string) =>
    `@font-face{font-family:'${family}';font-weight:300 800;src:url(data:font/ttf;base64,${b64(path)}) format('truetype')}`;
  return `${face('Funnel Sans', '../packages/ui/assets/fonts/FunnelSans-Variable.ttf')}
${face('Funnel Display', '../packages/ui/assets/fonts/FunnelDisplay-Variable.ttf')}
${tokens}
body { margin: 0; font-family: var(--ss-font); -webkit-font-smoothing: antialiased; }
.pattern { position: absolute; inset: 0; }
.pattern svg { display: block; width: 100%; height: 100%; }`;
}

/** Scroll so the "Enter the invoice" section starts just under the editor's toolbar. */
async function toSection(page: Page): Promise<void> {
  await page.waitForTimeout(500);
  const found = await page.evaluate((text) => {
    const all = Array.from(document.querySelectorAll<HTMLElement>('h2, input, [contenteditable]'));
    const el = all.find(
      (e) => (e instanceof HTMLInputElement ? e.value : e.textContent)?.trim() === text,
    );
    el?.scrollIntoView();
    scrollBy(0, -96);
    return Boolean(el);
  }, 'Enter the invoice');
  expect(found).toBe(true);
  await page.waitForTimeout(800);
}

test('Chrome Web Store images', async ({ context, serviceWorker, extensionId }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  const css = brandCss();
  const lockup = read('../brand/lockup.svg');
  const lockupDark = read('../brand/lockup-dark.svg');
  const ripple = read('../brand/pattern-ripple.svg');
  const trail = read('../brand/pattern-trail.svg');

  // 2 and 3. A finished guide (from an empty library): the reader and the agent view.
  const lib = await context.newPage();
  await lib.setViewportSize({ width: 1280, height: 800 });
  await lib.goto(`chrome-extension://${extensionId}/library.html`);
  await lib.getByRole('button', { name: 'Add the sample guides' }).click();
  const list = lib.getByRole('list', { name: 'Library' });
  await list
    .getByRole('button', { name: 'Create a supplier invoice in Ledgerline', exact: true })
    .click();
  await lib.getByRole('button', { name: 'Preview' }).click();
  await expect(lib.locator('.ss-reader .ss-step svg[role="img"]').first()).toBeVisible();
  await toSection(lib);
  await lib.screenshot({ path: `${OUT}2-guide.png` });
  await lib.getByRole('button', { name: 'Agent' }).click();
  await lib.waitForTimeout(500);
  await lib.evaluate(() => scrollTo(0, 0));
  await lib.waitForTimeout(500);
  await lib.screenshot({ path: `${OUT}3-agent.png` });

  // 4. Schedules (1.1): a real scheduled run, completed, with its history open.
  const sched = await scheduledGuide(serviceWorker);
  const scheduleId = await saveSchedule(serviceWorker, sched.id, sched.steps, { approve: true });
  await serviceWorker.evaluate(
    (n) =>
      (
        globalThis as unknown as {
          __showsteps: { scheduler: { onAlarm(n: string): Promise<void> } };
        }
      ).__showsteps.scheduler.onAlarm(n),
    `schedule:${scheduleId}`,
  );
  await lib.goto(`chrome-extension://${extensionId}/library.html#/schedules`);
  const card = lib.getByRole('listitem').filter({ hasText: 'Scheduled invoice' });
  await expect(card).toContainText('Completed', { timeout: 150_000 });
  await card.getByText(/Run history/).click();
  await lib.getByRole('button', { name: 'The page after step 16', exact: true }).waitFor();
  await lib.waitForTimeout(800);
  await lib.screenshot({ path: `${OUT}4-schedules.png` });

  // 1. Recording: the page with its toolbar, and the side panel listing the steps.
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
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
  const bar = page.locator('showsteps-controller').getByRole('toolbar');
  await expect(bar).toContainText('1 step');
  await page.waitForTimeout(650);
  await page.getByRole('heading', { name: 'Recent invoices' }).click({ delay: 100 });
  await page.waitForTimeout(650);
  await page.getByRole('cell', { name: 'INV-1042' }).click({ delay: 100 });
  await expect(bar).toContainText('3 steps');
  await expect(panel.getByRole('list').getByRole('listitem')).toHaveCount(3);
  await page.waitForTimeout(400);
  await page.getByRole('cell', { name: 'INV-1041' }).click({ delay: 100 });
  await expect(page.locator('showsteps-controller .toast')).toContainText('INV-1041');
  // The toolbar sits left of where the side panel goes in the picture.
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('showsteps-controller');
    if (host) host.style.right = '420px';
  });
  const left = (await page.screenshot()).toString('base64');
  await expect(panel.getByRole('list').getByRole('listitem')).toHaveCount(4);
  await panel.waitForTimeout(800);
  const right = (await panel.screenshot()).toString('base64');
  await panel.getByRole('button', { name: 'Finish' }).click();

  const shot = await context.newPage();
  await shot.setViewportSize({ width: 1280, height: 800 });
  await shot.setContent(`<style>${css}
    body { width: 1280px; height: 800px; display: flex; background: var(--ss-line); }
    .l { width: 879px; height: 800px; object-fit: cover; object-position: left top; }
    .r { width: 400px; height: 800px; margin-left: 1px; }</style>
    <img class="l" src="data:image/png;base64,${left}"><img class="r" src="data:image/png;base64,${right}">`);
  await shot.screenshot({ path: `${OUT}1-record.png` });

  // Small promo tile: Ripple pattern, lockup, one line.
  const tile = await context.newPage();
  await tile.setViewportSize({ width: 440, height: 280 });
  await tile.setContent(`<style>${css}
    body { position: relative; width: 440px; height: 280px; overflow: hidden; }
    .card { position: absolute; right: 22px; top: 26px; width: 250px; padding: 18px 20px 20px;
      border-radius: 16px; background: var(--ss-surface); box-shadow: 0 12px 32px rgb(20 16 43 / .28); }
    .card svg { display: block; width: 100%; height: auto; }
    p { margin: 14px 0 0; color: var(--ss-text); font: 800 26px/30px var(--ss-font-display); letter-spacing: -0.02em; }</style>
    <div class="pattern">${ripple}</div>
    <div class="card">${lockup}<p>Show it once.<br>Get the guide.</p></div>`);
  await tile.waitForTimeout(300);
  await tile.screenshot({ path: `${OUT}promo-440x280.png` });

  // Marquee: Trail on navy, the lockup and the promise, and the product.
  const marquee = await context.newPage();
  await marquee.setViewportSize({ width: 1400, height: 560 });
  await marquee.setContent(`<style>${css}
    body { position: relative; width: 1400px; height: 560px; overflow: hidden; background: var(--ss-chrome-bg); color: var(--ss-chrome-fg); }
    .pattern { opacity: .9; }
    .copy { position: absolute; left: 72px; top: 92px; width: 520px; }
    .copy svg { display: block; width: 300px; height: auto; }
    h1 { margin: 34px 0 14px; font: 800 46px/52px var(--ss-font-display); letter-spacing: -0.02em; }
    .copy p { margin: 0; color: var(--ss-chrome-muted); font: 500 20px/30px var(--ss-font); }
    .shot { position: absolute; right: 64px; top: 64px; width: 700px; border-radius: 16px; box-shadow: 0 24px 60px rgb(0 0 0 / .45); }
    .fade { position: absolute; inset: 0 auto 0 0; width: 700px; background: linear-gradient(90deg, var(--ss-chrome-bg) 62%, transparent); }</style>
    <div class="pattern">${trail}</div><div class="fade"></div>
    <div class="copy">${lockupDark}<h1>Show it once.<br>Get the guide.</h1>
      <p>Records your clicks into a step-by-step guide with screenshots. Private: nothing leaves your computer.</p></div>
    <img class="shot" src="data:image/png;base64,${readFileSync(`${OUT}2-guide.png`).toString('base64')}">`);
  await marquee.waitForTimeout(300);
  await marquee.screenshot({ path: `${OUT}marquee-1400x560.png` });
});
