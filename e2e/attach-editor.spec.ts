import type { Guide, Step } from '@showsteps/core';
import { expect, test } from './fixtures';
import { attachGuide, saveGuide } from './attach-helpers';

// 1.2 (R2): the editor's File control on upload steps.

declare const __showsteps: { store: { getGuide(id: string): Promise<Guide> } };

test('an upload step set to the file this run downloaded last is saved, and download access is asked for inside the click', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  const { guide, steps } = attachGuide();
  await saveGuide(sw, guide);
  const page = await context.newPage();
  // As if ShowSteps had no download access yet: Chrome's prompt can't be clicked in a test, so
  // the request is recorded (with whether the click's user activation was still live) and declined.
  await page.addInitScript(() => {
    const w = window as unknown as { __requests: { permissions?: string[]; active: boolean }[] };
    w.__requests = [];
    const p = chrome.permissions;
    const contains = p.contains.bind(p);
    p.contains = ((q: chrome.permissions.Permissions) =>
      q.permissions?.includes('downloads')
        ? Promise.resolve(false)
        : contains(q)) as typeof p.contains;
    p.request = ((q: chrome.permissions.Permissions) => {
      w.__requests.push({
        ...(q.permissions ? { permissions: q.permissions } : {}),
        active: navigator.userActivation.isActive,
      });
      return Promise.resolve(false);
    }) as typeof p.request;
  });
  await page.goto(`chrome-extension://${extensionId}/library.html#/guide/${guide.id}`);

  const file = page.getByRole('combobox', { name: 'File: Step 5 title' });
  await expect(file).toHaveValue('');
  await expect(page.getByText('Attach the file this run downloaded?')).toBeVisible();
  await file.selectOption({ label: 'The file this run downloaded last' });
  await expect(page.getByText('Run for me attaches the file instead of stopping.')).toBeVisible();
  await expect(page.getByText('Attach the file this run downloaded?')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: /^(Saved|Saving…)$/ })).toHaveText(
    'Saved',
  );
  const upload = await sw.evaluate(
    async ({ id, stepId }) =>
      (await __showsteps.store.getGuide(id)).blocks.find((b) => b.id === stepId) as Step,
    { id: guide.id, stepId: steps[4]!.id },
  );
  expect(upload.input?.from).toEqual({ download: 'latest' });

  // Allow download access: the request runs inside the click.
  await expect(
    page.getByText('Lets Run for me see the file its own click downloaded, so it can attach it.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Allow download access' }).click();
  await expect(
    page.getByText(
      'Without download access, ShowSteps can only attach files from simple download links.',
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __requests: unknown[] }).__requests),
  ).toEqual([{ permissions: ['downloads'], active: true }]);
  // Declining keeps the choice.
  await expect(file).toHaveValue('latest');

  // "Use it" picks the download step.
  await file.selectOption({ label: 'Choose it yourself' });
  await page.getByRole('button', { name: 'Use it' }).click();
  await expect(file).toHaveValue(steps[1]!.id);
});
