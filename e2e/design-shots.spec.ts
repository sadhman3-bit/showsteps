// Design review screenshots of every main screen, light and dark, into docs/design/<DESIGN_OUT>
// (default "after"). Its own Playwright project, not part of `pnpm e2e`: `pnpm design:shots`.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { startCaptureOn } from './helpers';
import { saveSchedule, scheduledGuide } from './schedule-helpers';

type Hook = {
  installSamples(): Promise<string[]>;
  store: { listGuides(): Promise<{ id: string; title: string }[]> };
  startGuidance(msg: object, options?: object): Promise<unknown>;
  guidance: { current: { phase: string }; control(a: string): Promise<unknown> };
  scheduler: { onAlarm(name: string): Promise<void> };
  runLogs: { list(id: string): Promise<{ id: string; outcome?: string }[]> };
  recorder: { control(a: string): Promise<unknown> };
};
declare const __showsteps: Hook;

const OUT = fileURLToPath(
  new URL(`../docs/design/${process.env.DESIGN_OUT ?? 'after'}/`, import.meta.url),
);
const INVOICE = 'Create a supplier invoice in Ledgerline';
const SCHEMES = ['light', 'dark'] as const;

async function both(pages: Page[], name: string, shoot: Page = pages[0]!): Promise<void> {
  for (const scheme of SCHEMES) {
    for (const p of pages) await p.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await shoot.waitForTimeout(400);
    await shoot.screenshot({ path: `${OUT}${name}-${scheme}.png` });
  }
}

test('design screenshots', async ({ context, serviceWorker: sw, extensionId }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });

  // Library (empty, then with the samples), editor, reader and agent view.
  const lib = await context.newPage();
  await lib.setViewportSize({ width: 1280, height: 800 });
  await lib.goto(`chrome-extension://${extensionId}/library.html`);
  await both([lib], 'library-empty');
  await sw.evaluate(() => __showsteps.installSamples());
  await lib.reload();
  const list = lib.getByRole('list', { name: 'Library' });
  await expect(list.getByRole('button', { name: INVOICE, exact: true })).toBeVisible();
  await both([lib], 'library');
  await list.getByRole('button', { name: INVOICE, exact: true }).click();
  await lib.waitForTimeout(800);
  await both([lib], 'editor');
  await lib.getByRole('button', { name: 'Preview' }).click();
  await lib.waitForTimeout(800);
  await both([lib], 'reader');
  await lib.getByRole('button', { name: 'Agent' }).click();
  await lib.waitForTimeout(800);
  await both([lib], 'agent');

  // Side panel: idle, then recording three steps.
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://localhost:5173/app/');
  await page.getByRole('cell', { name: 'INV-1042' }).waitFor();
  const opened = context.waitForEvent('page');
  await sw.evaluate(
    (url) => chrome.windows.create({ url, type: 'popup', width: 400, height: 800, focused: false }),
    `chrome-extension://${extensionId}/sidepanel.html`,
  );
  const panel = await opened;
  await panel.setViewportSize({ width: 400, height: 800 });
  await page.bringToFront();
  await panel.waitForTimeout(800);
  await both([panel], 'sidepanel-idle');
  await startCaptureOn(sw, 'http://localhost:5173/');
  const bar = page.locator('showsteps-controller').getByRole('toolbar');
  await expect(bar).toContainText('1 step');
  await page.waitForTimeout(650);
  await page.getByRole('heading', { name: 'Recent invoices' }).click({ delay: 100 });
  await page.waitForTimeout(650);
  await page.getByRole('cell', { name: 'INV-1042' }).click({ delay: 100 });
  await expect(bar).toContainText('3 steps');
  await expect(panel.getByRole('list').getByRole('listitem')).toHaveCount(3);
  await panel.waitForTimeout(800);
  await both([panel], 'sidepanel-recording');
  await both([page], 'toolbar');
  await sw.evaluate(() => __showsteps.recorder.control('cancel'));

  // Guide Me on the demo login page.
  const id = await sw.evaluate(
    async (t) => (await __showsteps.store.listGuides()).find((g) => g.title === t)!.id,
    INVOICE,
  );
  const guide = await context.newPage();
  await guide.setViewportSize({ width: 1280, height: 800 });
  await guide.goto('http://localhost:5173/login.html');
  await guide.bringToFront();
  const tabId = await sw.evaluate(
    async () => (await chrome.tabs.query({ url: 'http://localhost:5173/login.html*' }))[0]!.id!,
  );
  await sw.evaluate(
    ({ id, tabId }) =>
      __showsteps.startGuidance({ type: 'guide-start', guideId: id, mode: 'guide', tabId }),
    { id, tabId },
  );
  await expect.poll(() => sw.evaluate(() => __showsteps.guidance.current.phase)).toBe('showing');
  await guide.waitForTimeout(800);
  await both([guide], 'guide-me');
  await both([panel], 'sidepanel-guiding');
  await sw.evaluate(() => __showsteps.guidance.control('stop'));

  // Schedules (1.1): a real run that completes, and one that stops at Submit.
  const sched = await scheduledGuide(sw);
  const scheduleId = await saveSchedule(sw, sched.id, sched.steps, { approve: true });
  const outcome = () =>
    sw.evaluate(async (s) => (await __showsteps.runLogs.list(s))[0]?.outcome, scheduleId);
  await sw.evaluate((n) => __showsteps.scheduler.onAlarm(n), `schedule:${scheduleId}`);
  await expect.poll(outcome, { timeout: 150_000 }).toBe('completed');
  await lib.goto(`chrome-extension://${extensionId}/library.html#/guide/${sched.id}/view`);
  await lib.getByRole('button', { name: 'More actions' }).click();
  await lib.getByRole('menuitem', { name: 'Schedule…' }).click();
  await lib.getByRole('dialog').waitFor();
  await both([lib], 'schedule-dialog');
  await lib.keyboard.press('Escape');
  await lib.goto(`chrome-extension://${extensionId}/library.html#/schedules`);
  await lib.getByText(/Run history/).click();
  await lib.getByRole('button', { name: 'The page after step 1', exact: true }).waitFor();
  await both([lib], 'schedules');

  // The side panel while a scheduled run goes (paused after its first step).
  await guide.goto('http://localhost:5173/login.html');
  await sw.evaluate(
    async ({ id, tabId }) => {
      const tab = await chrome.tabs.get(tabId);
      await __showsteps.startGuidance(
        { type: 'guide-start', guideId: id, mode: 'run', tabId, stepThrough: true },
        { scheduleId: 'design', windowId: tab.windowId },
      );
    },
    { id: sched.id, tabId },
  );
  await expect.poll(() => sw.evaluate(() => __showsteps.guidance.current.phase)).toBe('paused');
  await panel.waitForTimeout(800);
  await both([panel], 'sidepanel-scheduled');
  await sw.evaluate(() => __showsteps.guidance.control('stop'));
});
