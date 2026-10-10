import type { Worker } from '@playwright/test';
import { expect, openNotepad, test } from './desktop-fixtures';
import { startCaptureOn } from './helpers';

type Step = {
  id: string;
  kind: 'step';
  action: string;
  app: { kind: string; processName?: string };
  human: { title: { spans: { text: string }[] }; screenshot?: { file: string } };
};
type Guide = { id: string; title: string; blocks: Step[]; apps: unknown[] };
type Hook = {
  syncDesktop(): Promise<boolean>;
  recorder: { control(action: string): Promise<unknown>; current: { stepCount: number } };
  store: { getGuide(id: string): Promise<Guide> };
  guidance: { current: { status: string; index: number; phase: string; reason?: string } };
  startGuidance(msg: object): Promise<unknown>;
};
declare const __trailmark: Hook;

const titleOf = (s: Step) => s.human.title.spans.map((x) => x.text).join('');
const LOGIN = 'http://localhost:5173/login.html';
const PAGE_TITLE = 'Sign in · Ledgerline';

/** Turn on "Work with the desktop app" and wait for the native bridge. */
async function connect(sw: Worker): Promise<void> {
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...(settings ?? {}), desktopApp: true } });
  });
  await expect.poll(() => sw.evaluate(() => __trailmark.syncDesktop())).toBe(true);
}

// A real browser window, so the test can switch between it and Notepad.
test.use({ headed: true });

/** Step titles of the guide being recorded (it is saved as it grows). */
const titles = (sw: Worker, id: string) =>
  sw.evaluate(
    async (g) =>
      (await __trailmark.store.getGuide(g)).blocks
        .filter((b) => b.kind === 'step')
        .map((b) => b.human.title.spans.map((x) => x.text).join('')),
    id,
  );

const stepCount = (sw: Worker) => sw.evaluate(() => __trailmark.recorder.current.stepCount);

test('one capture across a web page and Notepad, then Guide Me across both (C10, G8)', async ({
  desktop,
  context,
  serviceWorker: sw,
}) => {
  test.setTimeout(180_000);
  await connect(sw);
  await expect.poll(() => desktop.extensionConnected()).toBe(true);

  // Record: web steps, a Notepad step, then a web step again.
  const page = await context.newPage();
  await page.goto(LOGIN);
  await page.bringToFront();
  const guideId = await startCaptureOn(sw, 'http://localhost:5173/');
  await page.locator('trailmark-controller').getByRole('toolbar').waitFor();
  // The desktop app joins the extension's capture.
  await expect.poll(async () => (await desktop.capture()).shared).toBe(true);
  await page.waitForTimeout(650);
  await page.getByLabel('Username').fill('alex');
  await page.getByLabel('Username').press('Tab');
  await expect.poll(() => stepCount(sw)).toBe(2);

  const { editor } = await openNotepad(desktop);
  await desktop.click(editor);
  await desktop.input([
    { type: 'text', text: 'Invoice 1043 approved' },
    { type: 'wait', ms: 600 },
  ]);
  // Back to the browser: switching apps ends the typing in Notepad.
  expect(await desktop.activate('chrome', PAGE_TITLE)).toBe(true);
  await expect
    .poll(() => titles(sw, guideId))
    .toContain('Type Invoice 1043 approved into Text Editor');
  await page.getByRole('button', { name: 'Sign in' }).click({ delay: 120 });
  // The step lands once its screenshot is encoded and saved.
  await expect.poll(() => titles(sw, guideId), { timeout: 20_000 }).toContain('Click Sign in');
  await sw.evaluate(() => __trailmark.recorder.control('finish'));
  await expect.poll(async () => (await desktop.capture()).status).toBe('idle');

  const guide = await sw.evaluate((id) => __trailmark.store.getGuide(id), guideId);
  const steps = guide.blocks.filter((b) => b.kind === 'step');
  expect(steps.map(titleOf)).toEqual([
    'Go to localhost:5173',
    'Type alex into Username',
    'Type Invoice 1043 approved into Text Editor',
    'Click Sign in',
  ]);
  expect(steps.map((s) => s.app.kind)).toEqual(['web', 'web', 'desktop', 'web']);
  expect(guide.apps).toContainEqual({ kind: 'desktop', processName: 'notepad' });
  expect(steps[2]!.human.screenshot?.file).toMatch(/\.png$/);

  // Edit: the desktop step and its picture show in the extension's editor.
  const extensionId = new URL(sw.url()).host;
  const editorPage = await context.newPage();
  await editorPage.goto(`chrome-extension://${extensionId}/library.html#/guide/${guideId}`);
  await expect(editorPage.getByRole('textbox', { name: 'Step 3 title' })).toHaveText(
    'Type Invoice 1043 approved into Text Editor',
  );
  const picture = editorPage.getByRole('img', { name: /Invoice 1043 approved/ }).first();
  const width = await picture
    .locator('image')
    .first()
    .evaluate(async (image) => {
      const img = new Image();
      img.src = image.getAttribute('href') ?? '';
      await img.decode();
      return img.naturalWidth;
    });
  expect(width).toBeGreaterThan(400);
  await editorPage.close();

  // Guide Me: the web step in the page, the Notepad step in the desktop overlay (G8).
  await page.goto(LOGIN);
  await page.bringToFront();
  const tabId = await sw.evaluate(
    async (u) => (await chrome.tabs.query({ url: `${u}*` }))[0]?.id ?? -1,
    LOGIN,
  );
  await sw.evaluate(
    ([g, t]) =>
      __trailmark.startGuidance({ type: 'guide-start', guideId: g, mode: 'guide', tabId: t }),
    [guideId, tabId] as const,
  );
  // Step 1 (Go to) is done already; wait until the guide shows step 2 in the page.
  await expect
    .poll(() =>
      sw.evaluate(() => [__trailmark.guidance.current.index, __trailmark.guidance.current.phase]),
    )
    .toEqual([1, 'showing']);
  await page.getByLabel('Username').fill('alex');
  await page.getByLabel('Username').press('Tab');
  await expect.poll(() => sw.evaluate(() => __trailmark.guidance.current.index)).toBe(2);
  await expect
    .poll(() => sw.evaluate(() => __trailmark.guidance.current.reason))
    .toBe('desktop-app');
  await expect.poll(() => desktop.overlayText()).toContain('Invoice 1043 approved');
  await desktop.app
    .windows()
    .find((w) => w.url().includes('overlay.html'))
    ?.screenshot({ path: test.info().outputPath('overlay.png') });

  // Do the Notepad step for real: the overlay sees it and the guide moves on.
  expect(await desktop.activate('notepad')).toBe(true);
  await desktop.click(editor);
  await desktop.input([
    { type: 'text', text: ' ok' },
    { type: 'wait', ms: 300 },
    { type: 'key', vk: 0x09 },
    { type: 'wait', ms: 300 },
  ]);
  await expect.poll(() => sw.evaluate(() => __trailmark.guidance.current.index)).toBe(3);
  await expect.poll(() => desktop.overlayText()).toBe('');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect
    .poll(() => sw.evaluate(() => __trailmark.guidance.current.status))
    .not.toBe('active');
});
