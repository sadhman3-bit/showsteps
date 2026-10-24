import { buildStartLink, type Guide } from '@showsteps/core';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures';
import { EXPORTS, SEND, attachGuide, saveGuide } from './attach-helpers';

// 1.2 (R7): a Guide Me or Run for me link from an exported file opens the guide's first page;
// ShowSteps spots the marker in the address and offers to start, in its own small window.

type State = {
  status: string;
  mode: string;
  guideId?: string;
  tabId?: number;
  scheduleId?: string;
};
declare const __showsteps: {
  guidance: { current: State; control(a: string): Promise<State> };
  startGuidance(msg: object, options?: object): Promise<State>;
  store: { getGuide(id: string): Promise<Guide>; saveGuide(g: Guide): Promise<void> };
};

const state = (sw: Worker) => sw.evaluate(() => __showsteps.guidance.current);

/** Open a link in a new tab, and the ShowSteps window it brings up. */
async function openLink(
  context: BrowserContext,
  url: string,
): Promise<{ page: Page; prompt: Page }> {
  const before = new Set(context.pages());
  const page = await context.newPage();
  await page.goto(url);
  const isPrompt = (p: Page) => !before.has(p) && p.url().includes('/library.html#/start/');
  await expect
    .poll(() => context.pages().some(isPrompt), { timeout: 15_000 })
    .toBe(true)
    .catch((e: Error) => {
      throw new Error(`${e.message}
PAGES ${context
        .pages()
        .map((p) => p.url())
        .join(' | ')}`);
    });
  return { page, prompt: context.pages().find(isPrompt)! };
}

test('Start from a Guide Me link goes to the clean start page and starts there', async ({
  context,
  serviceWorker: sw,
}) => {
  const { guide } = attachGuide();
  await saveGuide(sw, guide);
  const { page, prompt } = await openLink(context, buildStartLink(guide, 'guide')!);
  await expect(prompt.getByRole('heading', { name: 'Open in ShowSteps' })).toBeVisible();
  await expect(prompt.getByRole('heading', { name: guide.title })).toBeVisible();
  await expect(prompt.getByText(/^Guide Me shows each step/)).toBeVisible();
  const closed = prompt.waitForEvent('close');
  await prompt.getByRole('button', { name: 'Start' }).click();
  await closed;
  await expect
    .poll(async () => `${(await state(sw)).status}:${(await state(sw)).mode}`)
    .toBe('active:guide');
  await expect(page).toHaveURL(EXPORTS);
  await sw.evaluate(() => __showsteps.guidance.control('stop'));
});

test('Start from a Run for me link shows the run choices, then runs in that tab', async ({
  context,
  serviceWorker: sw,
}) => {
  const { guide } = attachGuide();
  await saveGuide(sw, guide);
  const { page, prompt } = await openLink(context, buildStartLink(guide, 'run')!);
  const dialog = prompt.getByRole('dialog', { name: 'Run for me' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Not now' })).toBeVisible();
  const closed = prompt.waitForEvent('close');
  await dialog.getByRole('button', { name: 'Start' }).click();
  await closed;
  await expect
    .poll(async () => `${(await state(sw)).status}:${(await state(sw)).mode}`)
    .toBe('active:run');
  // In the tab the link opened, now on the clean start page.
  await expect(page).toHaveURL(EXPORTS);
  expect((await state(sw)).tabId).toBe(
    await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, EXPORTS),
  );
  await sw.evaluate(() => __showsteps.guidance.control('stop'));
});

test('Not now takes the marker out of the address without reloading', async ({
  context,
  serviceWorker: sw,
}) => {
  const { guide } = attachGuide();
  await saveGuide(sw, guide);
  const { page, prompt } = await openLink(context, buildStartLink(guide, 'guide')!);
  await page.evaluate(() => ((window as unknown as { stayed: boolean }).stayed = true));
  const closed = prompt.waitForEvent('close');
  await prompt.getByRole('button', { name: 'Not now' }).click();
  await closed;
  await expect(page).toHaveURL(EXPORTS);
  expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true);
  expect((await state(sw)).status).toBe('idle');
});

test('a guide that isn’t in the library, and one that changed since the file was made', async ({
  context,
  serviceWorker: sw,
}) => {
  const { guide } = attachGuide();
  // Let ShowSteps finish starting in this new profile first (see PROGRESS, Deferred (1.2)).
  await sw.evaluate(() => __showsteps.store.getGuide('warm-up').catch(() => undefined));
  // Not imported: the window says so.
  const missing = await openLink(context, buildStartLink(guide, 'guide')!);
  await expect(missing.prompt.getByText(/isn’t in your ShowSteps library/)).toBeVisible();
  await expect(missing.prompt.getByRole('button', { name: 'Open library' })).toBeVisible();
  await missing.prompt.getByRole('button', { name: 'Close' }).click();

  // Imported, then changed after the file was made.
  const link = buildStartLink(guide, 'run')!;
  const changed = structuredClone(guide);
  const upload = changed.blocks[4]!;
  if (upload.kind === 'step') upload.input = { ...upload.input!, from: { download: 'latest' } };
  await saveGuide(sw, changed);
  const { prompt } = await openLink(context, link);
  await expect(
    prompt.getByText(/has changed since this file was made\. Run for me uses/),
  ).toBeVisible();
});

test('a scheduled run going makes Start say it’s busy', async ({ context, serviceWorker: sw }) => {
  const { guide } = attachGuide();
  await saveGuide(sw, guide);
  const other = attachGuide({ title: 'Another guide' }).guide;
  await saveGuide(sw, other);
  // A scheduled run is going (in its own tab).
  const runTab = await context.newPage();
  await runTab.goto(EXPORTS);
  const tabId = await sw.evaluate(
    async (u) => (await chrome.tabs.query({ url: u }))[0]!.id!,
    EXPORTS,
  );
  await sw.evaluate(
    ({ id, tabId }) =>
      __showsteps.startGuidance(
        { type: 'guide-start', guideId: id, mode: 'run', tabId, stepThrough: true },
        { scheduleId: 'sched-test' },
      ),
    { id: other.id, tabId },
  );
  const { prompt } = await openLink(context, buildStartLink(guide, 'guide')!);
  await prompt.getByRole('button', { name: 'Start' }).click();
  await expect(prompt.getByRole('alert')).toContainText('Something else is running');
  expect((await state(sw)).guideId).toBe(other.id);
  await sw.evaluate(() => __showsteps.guidance.control('stop'));
});

test('a marker on a page that isn’t the guide’s start page is ignored', async ({
  context,
  serviceWorker: sw,
}) => {
  const { guide } = attachGuide();
  await saveGuide(sw, guide);
  const elsewhere = new URL(buildStartLink(guide, 'guide')!);
  const url = `${SEND}${elsewhere.hash}`;
  let prompted = false;
  context.on('page', (p) => {
    if (p.url().includes('#/start/')) prompted = true;
  });
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForTimeout(2000);
  expect(prompted).toBe(false);
  expect(context.pages().some((p) => p.url().includes('#/start/'))).toBe(false);
});
