import { createGuide, createStep, plain } from '@showsteps/core';
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures';
import { EXPORTS, attachGuide, saveGuide } from './attach-helpers';

// 1.2 (R6): Guide Me and Run for me wherever a guide is listed.

type State = { status: string; mode: string; guideId?: string; title?: string; speed: string };
declare const __showsteps: {
  guidance: { current: State; control(a: string): Promise<State> };
};

const state = (sw: Worker) => sw.evaluate(() => __showsteps.guidance.current);
const stop = (sw: Worker) => sw.evaluate(() => __showsteps.guidance.control('stop'));

/** Guidance started for the guide in the given mode; then it is stopped for the next check. */
async function started(sw: Worker, guideId: string, mode: 'guide' | 'run', title?: string) {
  await expect
    .poll(async () => {
      const s = await state(sw);
      return `${s.status}:${s.mode}:${s.guideId}`;
    })
    .toBe(`active:${mode}:${guideId}`);
  if (title) expect((await state(sw)).title).toBe(title);
  await stop(sw);
  await expect.poll(async () => (await state(sw)).status).toBe('idle');
}

/** Run for me's dialog opens first; start from it. */
async function runDialog(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Run for me' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Start' }).click();
}

test('Guide Me and Run for me from a library card, and disabled for a desktop-only guide', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  const { guide } = attachGuide({ title: 'Send the monthly report' });
  await saveGuide(sw, guide);
  const desktopOnly = createGuide({
    title: 'Tidy the spreadsheet',
    apps: [{ kind: 'desktop', processName: 'excel.exe' }],
    blocks: [
      createStep({
        action: 'click',
        app: { kind: 'desktop', processName: 'excel.exe', windowTitle: 'Book1' },
        human: { title: plain('Click Sort') },
      }),
    ],
  });
  await saveGuide(sw, desktopOnly);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/library.html`);

  await page.getByRole('button', { name: 'Guide Me: Send the monthly report' }).click();
  await started(sw, guide.id, 'guide');
  await page.getByRole('button', { name: 'Run for me: Send the monthly report' }).click();
  await runDialog(page);
  await started(sw, guide.id, 'run');
  expect(page.url()).toContain('library.html'); // a card click still opens the editor, these don't

  // The same two in the card's ⋯ menu, for keyboard users.
  await page.getByLabel('Actions for this guide: Send the monthly report').click();
  await page.getByRole('menuitem', { name: 'Guide Me' }).click();
  await started(sw, guide.id, 'guide');

  // No browser steps: both shown, disabled, with the reason.
  const off = page.getByRole('button', { name: 'Guide Me: Tidy the spreadsheet' });
  await expect(off).toBeDisabled();
  await expect(off).toHaveAttribute('title', 'This guide has no web steps to guide.');
  await expect(
    page.getByRole('button', { name: 'Run for me: Tidy the spreadsheet' }),
  ).toBeDisabled();
});

test('the editor’s Guide Me uses an edit made a moment before, and Run for me opens its dialog', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  const { guide } = attachGuide();
  await saveGuide(sw, guide);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/library.html#/guide/${guide.id}`);
  const title = page.getByRole('textbox', { name: 'Guide title' });
  await expect(title).toHaveValue('Send the monthly report');
  // Rename and start at once, before the autosave would have run.
  await title.fill('Send the October report');
  await page.getByRole('button', { name: 'Guide Me', exact: true }).click();
  await started(sw, guide.id, 'guide', 'Send the October report');

  await page.getByRole('button', { name: 'Run for me', exact: true }).click();
  await runDialog(page);
  await started(sw, guide.id, 'run');
});

test('Guide Me and Run for me from the side panel’s Recent guides and Guides for this site', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  const { guide } = attachGuide();
  await saveGuide(sw, guide);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 360, height: 900 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const page = await context.newPage();
  await page.goto(EXPORTS);
  await page.bringToFront(); // the side panel follows the active tab

  const recent = panel.getByRole('region', { name: 'Recent guides' });
  await recent.getByRole('button', { name: 'Guide Me: Send the monthly report' }).click();
  await started(sw, guide.id, 'guide');
  await recent.getByRole('button', { name: 'Run for me: Send the monthly report' }).click();
  // The dialog fits the side panel.
  const dialog = panel.getByRole('dialog', { name: 'Run for me' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  await runDialog(panel);
  await started(sw, guide.id, 'run');

  const site = panel.getByRole('region', { name: 'Guides for this site' });
  await site.getByRole('button', { name: 'Run for me: Send the monthly report' }).click();
  await runDialog(panel);
  await started(sw, guide.id, 'run');
  await site.getByRole('button', { name: 'Guide Me', exact: true }).click();
  await started(sw, guide.id, 'guide');
});
