import { buildStartLink } from '@showsteps/core';
import type { Page } from '@playwright/test';
import { audit } from './a11y-helpers';
import { attachGuide, saveGuide } from './attach-helpers';
import { expect, test } from './fixtures';

// 1.2 (R8): the File control, the download-access note and the start window: named controls,
// 24 px targets, and usable with the keyboard alone.

async function noProblems(page: Page, name: string) {
  const { unnamed, small } = await audit(page);
  expect(unnamed, `${name}: controls without a name`).toEqual([]);
  expect(small, `${name}: targets under 24×24 px`).toEqual([]);
}

/** The element the keyboard is on, described by its accessible label or text. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el?.getAttribute('aria-label') ?? el?.textContent?.trim() ?? '';
  });

test('File control and download-access note: named, 24 px, keyboard only', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  const { guide, steps } = attachGuide();
  await saveGuide(sw, guide);
  const page = await context.newPage();
  // As if download access wasn't granted yet (the e2e build has it).
  await page.addInitScript(() => {
    const p = chrome.permissions;
    const contains = p.contains.bind(p);
    p.contains = ((q: chrome.permissions.Permissions) =>
      q.permissions?.includes('downloads')
        ? Promise.resolve(false)
        : contains(q)) as typeof p.contains;
    p.request = (() => Promise.resolve(false)) as typeof p.request;
  });
  await page.goto(`chrome-extension://${extensionId}/library.html#/guide/${guide.id}`);
  const file = page.getByRole('combobox', { name: 'File: Step 5 title' });
  await expect(file).toBeVisible();

  // Keyboard only: focus the File control, choose "the file this run downloaded last".
  await file.focus();
  expect(await focused(page)).toBe('File: Step 5 title');
  await page.keyboard.press('ArrowDown');
  await expect(file).toHaveValue('latest');
  await expect(page.getByText('Run for me attaches the file instead of stopping.')).toBeVisible();
  // Tab reaches Allow download access, and Enter presses it.
  const allow = page.getByRole('button', { name: 'Allow download access' });
  await expect(allow).toBeVisible();
  for (let i = 0; i < 6 && (await focused(page)) !== 'Allow download access'; i++)
    await page.keyboard.press('Tab');
  expect(await focused(page)).toBe('Allow download access');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Without download access/)).toBeVisible();
  await noProblems(page, 'editor with the File control');
  expect(steps).toHaveLength(6);
});

test('the start window: named, 24 px, and Start with the keyboard', async ({
  context,
  serviceWorker: sw,
}) => {
  const { guide } = attachGuide();
  await saveGuide(sw, guide);
  const page = await context.newPage();
  await page.goto(buildStartLink(guide, 'guide')!);
  await expect
    .poll(() => context.pages().some((p) => p.url().includes('#/start/')), { timeout: 15_000 })
    .toBe(true);
  const prompt = context.pages().find((p) => p.url().includes('#/start/'))!;
  await expect(prompt.getByRole('button', { name: 'Start' })).toBeVisible();
  await noProblems(prompt, 'start window');
  // The first Tab stop is Start; Enter starts.
  await prompt.keyboard.press('Tab');
  expect(await focused(prompt)).toBe('Start');
  const closed = prompt.waitForEvent('close');
  await prompt.keyboard.press('Enter');
  await closed;
  await expect
    .poll(() =>
      sw.evaluate(
        () =>
          (globalThis as unknown as { __showsteps: { guidance: { current: { status: string } } } })
            .__showsteps.guidance.current.status,
      ),
    )
    .toBe('active');
});

test('a guide from someone else: the panel is named, 24 px, and passes with the keyboard (H4)', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  const { guide } = attachGuide();
  await saveGuide(sw, { ...guide, received: { at: guide.updatedAt, from: 'import' } });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/library.html`);
  await page.getByRole('button', { name: `Run for me: ${guide.title}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Run for me' });
  await expect(dialog.getByRole('region', { name: 'From someone else' })).toBeVisible();
  await noProblems(page, 'Run for me with a guide from someone else');
  // Keyboard only: reach the tick, tick it with Space, then Start is enabled.
  const tick = dialog.getByRole('checkbox', { name: 'I’ve checked this guide' });
  for (let i = 0; i < 12 && !(await tick.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press('Tab');
  await expect(tick).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Start' })).toBeDisabled();
  await page.keyboard.press('Space');
  await expect(tick).toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Start' })).toBeEnabled();
  // The next Tab stop is Trust this guide; Enter trusts it and the panel goes.
  await page.keyboard.press('Tab');
  expect(await focused(page)).toBe('Trust this guide');
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('region', { name: 'From someone else' })).toHaveCount(0);
});
