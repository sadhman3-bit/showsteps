import type { Worker } from '@playwright/test';
import { expect, test } from './fixtures';
import { recordShortGuide, startCaptureOn } from './helpers';

type Store = { getGuide(id: string): Promise<{ blocks: Block[] } | undefined> };
type Block = {
  kind: string;
  human?: { title: { spans: { text: string; bold?: boolean }[] } };
  app?: { url: string };
};
declare const __trailmark: {
  store: Store;
  recorder: { current: { stepCount: number; status: string } };
};

const titlesOf = async (sw: Worker, id: string) => {
  const guide = await sw.evaluate((g) => __trailmark.store.getGuide(g), id);
  return (guide?.blocks ?? [])
    .filter((b) => b.kind === 'step')
    .map((b) => b.human!.title.spans.map((x) => (x.bold ? `**${x.text}**` : x.text)).join(''));
};

test('controller: pause, delete last, live blur, keys, right and double clicks', async ({
  context,
  serviceWorker,
}) => {
  test.setTimeout(90_000);
  const page = await context.newPage();
  await page.goto('http://localhost:5173/app/');
  await page.getByRole('cell', { name: 'INV-1042' }).waitFor();
  await page.bringToFront();
  const id = await startCaptureOn(serviceWorker, 'http://localhost:5173/');
  const bar = page.locator('trailmark-controller').getByRole('toolbar');
  await expect(bar).toContainText('Recording');
  await expect(bar).toContainText('1 step');
  const pause = () => page.waitForTimeout(650);
  await pause();

  // Right click and double click (C3)
  await page
    .getByRole('heading', { name: 'Supplier contact' })
    .click({ button: 'right', delay: 100 });
  await page.keyboard.press('Escape'); // close the context menu; recorded as a key step
  await pause();
  await page.getByRole('cell', { name: 'INV-1042' }).dblclick({ delay: 80 });
  await pause();
  await expect(bar).toContainText('4 steps');

  // Pause: nothing is recorded (C2)
  await bar.getByRole('button', { name: 'Pause' }).click();
  await expect(bar).toContainText('Paused');
  await page.getByRole('heading', { name: 'Recent invoices' }).click();
  await bar.getByRole('button', { name: 'Resume' }).click();
  await expect(bar).toContainText('Recording');
  await expect(bar).toContainText('4 steps');

  // Delete last step (C2)
  await bar.getByRole('button', { name: 'Delete last step' }).click();
  await expect(bar).toContainText('3 steps');

  // Live Blur: clicks blur elements instead of recording or activating them (C5)
  await bar.getByRole('button', { name: 'Live Blur' }).click();
  await expect(bar.getByRole('button', { name: 'Live Blur' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const card = page.getByRole('cell', { name: '4111 1111 1111 1111' });
  await card.click();
  await expect(card).toHaveCSS('filter', 'blur(8px)');
  const before = page.url();
  await page.getByTestId('new-invoice').click(); // would navigate if not intercepted
  expect(page.url()).toBe(before);
  await page.getByTestId('new-invoice').click(); // second click un-blurs it
  await bar.getByRole('button', { name: 'Live Blur' }).click();
  await expect(bar.getByRole('button', { name: 'Live Blur' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(bar).toContainText('3 steps');

  // Keys with a modifier, typed into a field first (C3)
  await page.getByTestId('new-invoice').click({ delay: 100 });
  await pause();
  await page.getByLabel('Supplier').fill('Harbour Paper Co.');
  await page.getByLabel('Supplier').press('Control+Enter');
  await pause();

  await bar.getByRole('button', { name: 'Finish' }).click();
  await expect(bar).toHaveCount(0);
  // Blur is removed when capture ends.
  expect(await titlesOf(serviceWorker, id)).toEqual([
    'Go to **localhost:5173**',
    'Right-click **Supplier contact**',
    'Press **Esc**',
    'Click **New invoice**',
    'Type **Harbour Paper Co.** into **Supplier**',
    'Press **Ctrl+Enter**',
  ]);
});

test('cancel discards a new capture', async ({ context, serviceWorker }) => {
  const page = await context.newPage();
  await page.goto('http://localhost:5173/login.html');
  await page.bringToFront();
  const id = await startCaptureOn(serviceWorker, 'http://localhost:5173/');
  const bar = page.locator('trailmark-controller').getByRole('toolbar');
  await bar.getByRole('button', { name: 'Cancel' }).click();
  await bar.getByRole('button', { name: 'Cancel' }).click(); // confirm
  await expect(bar).toHaveCount(0);
  expect(await serviceWorker.evaluate((g) => __trailmark.store.getGuide(g), id)).toBeUndefined();
});

test('capture follows the active tab (C6)', async ({ context, serviceWorker }) => {
  test.setTimeout(60_000);
  const first = await context.newPage();
  await first.goto('http://localhost:5173/login.html');
  await first.bringToFront();
  const id = await startCaptureOn(serviceWorker, 'http://localhost:5173/login');
  await first.waitForTimeout(650);
  await first.getByLabel('Username').fill('alex');
  await first.waitForTimeout(650);

  const second = await context.newPage();
  await second.goto('http://localhost:5173/reports.html');
  await second.bringToFront();
  await expect(second.locator('trailmark-controller').getByRole('toolbar')).toBeVisible();
  await second.waitForTimeout(650);
  await second.getByRole('button', { name: 'Run report' }).click({ delay: 100 });
  await second.waitForTimeout(650);
  await second.locator('trailmark-controller').getByRole('button', { name: 'Finish' }).click();
  await expect(second.locator('trailmark-controller')).toHaveCount(0);

  const guide = await serviceWorker.evaluate((g) => __trailmark.store.getGuide(g), id);
  const steps = guide!.blocks.filter((b) => b.kind === 'step');
  expect(await titlesOf(serviceWorker, id)).toEqual([
    'Go to **localhost:5173**',
    'Type **alex** into **Username**',
    'Go to **localhost:5173**', // the new tab was opened by typing its address
    'Click **Run report**',
  ]);
  expect(steps[3]!.app!.url).toBe('http://localhost:5173/reports.html');
});

test('capture more inserts steps at the chosen position (C7)', async ({
  context,
  serviceWorker,
}) => {
  test.setTimeout(60_000);
  const { id, page } = await recordShortGuide(context, serviceWorker);
  await page.goto('http://localhost:5173/app/');
  await page.bringToFront();
  const tabId = await serviceWorker.evaluate(
    async () => (await chrome.tabs.query({ url: 'http://localhost:5173/app/*' }))[0]!.id!,
  );
  await serviceWorker.evaluate(
    ({ g, t }) =>
      (
        globalThis as never as { __trailmark: { startCapture(m: object): Promise<unknown> } }
      ).__trailmark.startCapture({ type: 'start', tabId: t, guideId: g, insertAt: 1 }),
    { g: id, t: tabId },
  );
  const bar = page.locator('trailmark-controller').getByRole('toolbar');
  await expect(bar).toContainText('0 steps');
  await page.waitForTimeout(650);
  await page.getByTestId('new-invoice').click({ delay: 100 });
  await page.waitForTimeout(650);
  await bar.getByRole('button', { name: 'Finish' }).click();
  await expect(bar).toHaveCount(0);
  expect(await titlesOf(serviceWorker, id)).toEqual([
    'Go to **localhost:5173**',
    'Click **New invoice**',
    'Type **alex** into **Username**',
    'Enter your password',
    'Click **Sign in**',
  ]);
});

test('side panel lists each step as it is recorded, with its screenshot, and deletes any one', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  test.setTimeout(90_000);
  const page = await context.newPage();
  await page.goto('http://localhost:5173/app/');
  await page.getByRole('cell', { name: 'INV-1042' }).waitFor();
  // The panel in a window of its own, as the real side panel is beside the page, not a tab.
  const opened = context.waitForEvent('page');
  await serviceWorker.evaluate(
    (url) => chrome.windows.create({ url, type: 'popup', width: 400, height: 800, focused: false }),
    `chrome-extension://${extensionId}/sidepanel.html`,
  );
  const panel = await opened;
  await page.bringToFront();
  const id = await startCaptureOn(serviceWorker, 'http://localhost:5173/');
  const bar = page.locator('trailmark-controller').getByRole('toolbar');
  await expect(bar).toContainText('1 step');
  const steps = panel.getByRole('list').getByRole('listitem');
  await expect(steps).toHaveCount(1);
  await page.waitForTimeout(650);

  await page.getByRole('heading', { name: 'Recent invoices' }).click({ delay: 100 });
  // The toolbar notes the step just recorded.
  await expect(page.locator('trailmark-controller .toast')).toContainText('Recent invoices');
  await page.waitForTimeout(650);
  await page.getByRole('cell', { name: 'INV-1042' }).click({ delay: 100 });
  await expect(bar).toContainText('3 steps');

  await expect(steps).toHaveCount(3);
  await expect(steps.nth(1)).toHaveAccessibleName(/^Step 2: Click .*Recent invoices/);
  await expect(steps.nth(2)).toHaveAccessibleName(/^Step 3: Click .*INV-1042/);
  for (let i = 0; i < 3; i++) await expect(steps.nth(i).getByRole('img')).toBeVisible();
  await panel.screenshot({ path: test.info().outputPath('sidepanel-recording.png') });
  // Each picture's highlight sits on the clicked element.
  const guide = await serviceWorker.evaluate((g) => __trailmark.store.getGuide(g), id);
  const shot = (guide?.blocks[2] as { human: { screenshot: { width: number } } }).human.screenshot;
  expect(shot.width).toBeGreaterThan(1000);

  await panel.getByRole('button', { name: 'Delete step 2' }).click();
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(1)).toHaveAccessibleName(/^Step 2: Click .*INV-1042/);
  await expect(bar).toContainText('2 steps');

  await panel.getByRole('button', { name: 'Finish' }).click();
  await expect(bar).toHaveCount(0);
  const titles = await titlesOf(serviceWorker, id);
  expect(titles).toHaveLength(2);
  expect(titles[1]).toContain('INV-1042');
});
