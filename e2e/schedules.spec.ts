import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures';
import { saveSchedule, scheduledGuide, titleOf, type Hook, type RunLog } from './schedule-helpers';

declare const __showsteps: Hook;

/** Make the schedule due now (what its alarm does at the set time). */
const due = (sw: Worker, id: string) =>
  sw.evaluate((name) => __showsteps.scheduler.onAlarm(name), `schedule:${id}`);

const guidance = (sw: Worker) => sw.evaluate(() => __showsteps.guidance.current);
const logs = (sw: Worker, id: string) => sw.evaluate((s) => __showsteps.runLogs.list(s), id);
const windowCount = (sw: Worker) => sw.evaluate(async () => (await chrome.windows.getAll()).length);
const notifications = (sw: Worker) =>
  sw.evaluate(async () => Object.keys(await chrome.notifications.getAll()));

/** The run window's page (Playwright sees every window in the context). */
async function runPage(context: BrowserContext, url: RegExp): Promise<Page> {
  await expect
    .poll(() => context.pages().some((p) => url.test(p.url())), { timeout: 30_000 })
    .toBe(true);
  return context.pages().find((p) => url.test(p.url()))!;
}

/** Every logged step has a picture of its own in the run-log store. */
async function screenshotsStored(sw: Worker, log: RunLog): Promise<number[]> {
  return sw.evaluate(
    async (names) =>
      Promise.all(names.map(async (n) => (await __showsteps.runLogs.getShot(n))?.size ?? 0)),
    log.steps.map((s) => s.screenshot ?? 'none'),
  );
}

const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

test('a schedule runs the demo flow unattended in its own window and pauses at the confirm step', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  test.setTimeout(180_000);
  const { id: guideId, steps } = await scheduledGuide(sw);
  const id = await saveSchedule(sw, guideId, steps);
  const before = await windowCount(sw);
  await due(sw, id);

  // Its own window, not the test's.
  await expect.poll(() => windowCount(sw)).toBe(before + 1);
  const submitIndex = steps.findIndex((s) => titleOf(s) === 'Click Submit invoice');
  await expect.poll(async () => (await guidance(sw)).phase, { timeout: 120_000 }).toBe('confirm');
  expect((await guidance(sw)).index).toBe(submitIndex);

  // The recorded one-click sign-in replayed, and the scheduled value (with {today}) was typed.
  const page = await runPage(context, /\/app\/invoices\/new/);
  await expect(page.locator('#who')).toHaveText('Signed in as alex');
  await expect(page.getByRole('textbox', { name: 'Supplier' })).toHaveValue(`Saltbush ${today()}`);
  await expect(page.getByRole('heading', { name: 'Invoice submitted' })).toHaveCount(0);

  // The person is told.
  expect((await notifications(sw)).some((n) => n.startsWith(`ss|paused|${id}`))).toBe(true);

  // Nobody comes: the wait runs out and the run ends as stopped.
  const [running] = await logs(sw, id);
  await sw.evaluate((name) => __showsteps.scheduler.onAlarm(name), `wait:${running!.id}`);
  await expect.poll(async () => (await logs(sw, id))[0]?.outcome).toBe('stopped');
  const [log] = await logs(sw, id);
  expect(log!.reason).toBe('confirm');
  expect(log!.values).toEqual({
    [steps.find((s) => s.target?.name === 'Supplier')!.id]: `Saltbush ${today()}`,
  });
  expect(log!.steps.at(-1)).toMatchObject({ number: submitIndex + 1, status: 'stopped' });
  // A picture for every step, taken in the unfocused run window.
  const sizes = await screenshotsStored(sw, log!);
  expect(sizes.length).toBe(submitIndex + 1);
  for (const size of sizes) expect(size).toBeGreaterThan(5000);
  await expect.poll(() => windowCount(sw)).toBe(before);
  expect((await guidance(sw)).status).toBe('idle');

  // The toolbar shows "!" until the Schedules page is opened.
  const badge = () => sw.evaluate(() => chrome.action.getBadgeText({}));
  await expect.poll(badge).toBe('!');
  const schedules = await context.newPage();
  await schedules.goto(`chrome-extension://${extensionId}/library.html#/schedules`);
  await expect.poll(badge).toBe('');
});

test('with the confirm step pre-approved it completes, and after a guide edit it pauses again', async ({
  context,
  serviceWorker: sw,
}) => {
  test.setTimeout(240_000);
  const { id: guideId, steps } = await scheduledGuide(sw);
  const id = await saveSchedule(sw, guideId, steps, { approve: true, keepWindowOpen: true });
  await due(sw, id);
  await expect
    .poll(async () => (await logs(sw, id))[0]?.outcome, { timeout: 150_000 })
    .toBe('completed');
  const [log] = await logs(sw, id);
  expect(log!.steps).toHaveLength(steps.length);
  expect(log!.steps.at(-1)).toMatchObject({ status: 'confirmed' });
  const page = await runPage(context, /\/app\//);
  await expect(page.getByRole('heading', { name: 'Invoice submitted' })).toBeVisible();
  await page.close();

  // Edit what a step types: approvals no longer apply, so Submit pauses again.
  await sw.evaluate(async (guideId) => {
    const g = await __showsteps.store.getGuide(guideId);
    const no = g.blocks.find((b) => b.target?.name === 'Invoice no.')!;
    no.input = { ...no.input!, value: 'INV-2000' };
    await __showsteps.store.saveGuide(g);
  }, guideId);
  await due(sw, id);
  await expect.poll(async () => (await guidance(sw)).phase, { timeout: 120_000 }).toBe('confirm');
  await sw.evaluate(() => __showsteps.guidance.control('stop'));
  await expect.poll(async () => (await logs(sw, id))[0]?.outcome).toBe('stopped');
});

test('an expired session stops the run for sign-in, and Continue finishes it', async ({
  context,
  serviceWorker: sw,
}) => {
  test.setTimeout(180_000);
  await context.addCookies([
    { name: 'demo_session', value: 'expired', url: 'http://localhost:5173' },
  ]);
  const { id: guideId, steps } = await scheduledGuide(sw, true);
  const id = await saveSchedule(sw, guideId, steps, { approve: true });
  await due(sw, id);

  await expect
    .poll(
      async () => {
        const g = await guidance(sw);
        return `${g.phase}:${g.reason ?? ''}`;
      },
      { timeout: 120_000 },
    )
    .toBe('failed:sign-in');
  expect((await notifications(sw)).some((n) => n.startsWith(`ss|paused|${id}`))).toBe(true);

  // The page says what to do; the person signs in (Run for me never types passwords).
  const idp = await runPage(context, /127\.0\.0\.1:5174\/idp\//);
  const banner = idp.locator('showsteps-guide .banner');
  await expect(banner).toContainText('Sign in, then press Continue.');
  await idp.getByLabel('Password').fill('not-a-real-password');
  await idp.getByRole('button', { name: 'Sign in' }).click();
  await idp.waitForURL(/localhost:5173\/app\//);

  // Continue from the side panel's control (the banner went with the sign-in page).
  await sw.evaluate(() => __showsteps.guidance.control('retry'));
  await expect
    .poll(async () => (await logs(sw, id))[0]?.outcome, { timeout: 120_000 })
    .toBe('completed');
});
