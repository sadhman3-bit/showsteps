import { expect, type BrowserContext, type Page, type Worker } from '@playwright/test';

type Hook = {
  startCapture(msg: { type: 'start'; tabId: number }): Promise<{ guideId?: string }>;
  recorder: { control(action: string): Promise<unknown>; current: { stepCount: number } };
};
declare const __trailmark: Hook;

/** Start a capture on the tab showing `url` through the e2e test hook. */
export async function startCaptureOn(sw: Worker, urlPrefix: string): Promise<string> {
  const tabId = await sw.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: `${u}*` });
    return tab?.id ?? -1;
  }, urlPrefix);
  const { guideId } = await sw.evaluate(
    (id) => __trailmark.startCapture({ type: 'start', tabId: id }),
    tabId,
  );
  if (!guideId) throw new Error('capture did not start');
  return guideId;
}

/** Record a short four-step guide on the demo login page; returns its id. */
export async function recordShortGuide(
  context: BrowserContext,
  sw: Worker,
): Promise<{ id: string; page: Page }> {
  const page = await context.newPage();
  await page.goto('http://localhost:5173/login.html');
  await page.bringToFront();
  const id = await startCaptureOn(sw, 'http://localhost:5173/');
  await page.locator('trailmark-controller').getByRole('toolbar').waitFor();
  await page.waitForTimeout(650);
  await page.getByLabel('Username').fill('alex');
  await page.waitForTimeout(650);
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.waitForTimeout(650);
  await page.getByRole('button', { name: 'Sign in' }).click({ delay: 120 });
  await page.waitForURL(/\/app\/$/);
  await page.waitForTimeout(650);
  // Let the last events from the page that just unloaded arrive before ending the capture.
  await expect.poll(() => sw.evaluate(() => __trailmark.recorder.current.stepCount)).toBe(4);
  await sw.evaluate(() => __trailmark.recorder.control('finish'));
  return { id, page };
}
