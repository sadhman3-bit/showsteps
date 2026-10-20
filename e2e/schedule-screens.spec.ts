import type { Worker } from '@playwright/test';
import { expect, test } from './fixtures';
import { scheduledGuide, type Hook } from './schedule-helpers';

declare const __showsteps: Hook;

const guidance = (sw: Worker) => sw.evaluate(() => __showsteps.guidance.current);

test('create, edit, pause, run now and delete a schedule from its screens', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  test.setTimeout(300_000);
  const { id: guideId } = await scheduledGuide(sw);
  const base = `chrome-extension://${extensionId}/library.html`;
  const page = await context.newPage();

  // Create: ⋯ → Schedule… in the guide reader.
  await page.goto(`${base}#/guide/${guideId}/view`);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Schedule…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Schedule “Scheduled invoice”' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Repeat' })).toHaveValue('weekdays');
  await dialog.getByLabel('Time').fill('07:30');
  await expect(dialog.locator('p', { hasText: 'Next runs:' })).toContainText('07:30');
  const value = dialog.getByRole('group', { name: 'Values to type' }).getByRole('textbox');
  await value.fill('Saltbush ');
  await dialog.getByRole('combobox', { name: /^Insert a date/ }).selectOption({ label: 'Today' });
  await expect(value).toHaveValue('Saltbush {today}');
  await expect(dialog.getByText(/^The next run types: Saltbush \d\d\/\d\d\/\d{4}$/)).toBeVisible();
  // An unknown placeholder is caught before saving.
  await value.fill('Saltbush {next_week}');
  await expect(
    dialog.getByText('ShowSteps doesn’t know the placeholder {next_week}.'),
  ).toBeVisible();
  await value.fill('Saltbush {today}');
  await dialog.getByRole('checkbox', { name: /Click Submit invoice/ }).check();
  await dialog.getByRole('button', { name: 'Save schedule' }).click();
  await expect(dialog).toBeHidden();

  // The Schedules page lists it.
  await page.goto(`${base}#/schedules`);
  const card = page.getByRole('listitem').filter({ hasText: 'Scheduled invoice' });
  await expect(card.getByRole('heading', { name: 'Scheduled invoice' })).toBeVisible();
  await expect(card).toContainText('Weekdays at 07:30');
  await expect(card).toContainText('Not run yet');

  // Edit: the same dialog, with the saved answers.
  await card.getByRole('button', { name: 'Edit' }).click();
  await expect(dialog.getByLabel('Time')).toHaveValue('07:30');
  await expect(dialog.getByRole('checkbox', { name: /Click Submit invoice/ })).toBeChecked();
  await dialog.getByLabel('Time').fill('08:15');
  await dialog.getByRole('button', { name: 'Save schedule' }).click();
  await expect(card).toContainText('Weekdays at 08:15');

  // Pause it, and switch it back on.
  const toggle = card.getByRole('switch', { name: 'Run “Scheduled invoice” on schedule' });
  await toggle.uncheck();
  await expect(card).toContainText('Off');
  await toggle.check();
  await expect(card).toContainText('Next:');

  // Run now: it completes in its own window and shows in the history with pictures.
  await card.getByRole('button', { name: 'Run now' }).click();
  await expect(page.getByRole('status')).toHaveText('Running in its own window.');
  await expect(card).toContainText('Completed', { timeout: 150_000 });
  await card.getByText('Run history (1 run)').click();
  const runs = card.getByRole('list').filter({ hasText: 'After step' });
  await expect(runs.getByRole('button', { name: /The page after step/ }).first()).toBeVisible();
  await expect(card).toContainText('Saltbush');
  await runs.getByRole('button', { name: 'The page after step 1', exact: true }).click();
  const picture = page.getByRole('dialog', { name: 'The page after step 1' });
  await expect(picture.getByRole('img')).toBeVisible();
  await picture.getByRole('button', { name: 'Close' }).click();

  // Without the approval it stops at Submit; the side panel's card stops it.
  await card.getByRole('button', { name: 'Edit' }).click();
  await dialog.getByRole('checkbox', { name: /Click Submit invoice/ }).uncheck();
  await dialog.getByRole('button', { name: 'Save schedule' }).click();
  await expect(dialog).toBeHidden();
  await card.getByRole('button', { name: 'Run now' }).click();
  await expect(card).toContainText('Running now');
  await expect.poll(async () => (await guidance(sw)).phase, { timeout: 120_000 }).toBe('confirm');
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const run = panel.getByRole('region', { name: 'Scheduled invoice' });
  await expect(run).toContainText('Scheduled run');
  await expect(run).toContainText('Step 16 of 16');
  await run.getByRole('button', { name: 'Stop' }).click();
  await expect(card).toContainText('Stopped', { timeout: 30_000 });
  await expect(card).toContainText('Run history (2 runs)');
  await expect(card.getByText('Waited for a confirmation').first()).toBeVisible();
  await panel.close();

  // Delete: the schedule and its history go; the guide stays.
  await card.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this schedule?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByText('No schedules yet.')).toBeVisible();
  expect(await sw.evaluate((id) => __showsteps.store.getGuide(id), guideId)).toBeTruthy();
});

test('a guide with only desktop steps offers Schedule disabled, with the reason', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  const id = await sw.evaluate(async () => {
    await __showsteps.installSamples();
    const any = (await __showsteps.store.listGuides())[0]!;
    const g = await __showsteps.store.getGuide(any.id);
    const desktopOnly = {
      ...g,
      id: 'desktop-only',
      title: 'Desktop only',
      blocks: g.blocks
        .filter((b) => b.kind === 'step')
        .slice(0, 2)
        .map((b) => ({
          ...b,
          app: { kind: 'desktop', processName: 'notepad.exe', windowTitle: 'Notepad' },
        })),
    };
    await __showsteps.store.saveGuide(desktopOnly as typeof g);
    return desktopOnly.id;
  });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/library.html#/guide/${id}/view`);
  await page.getByRole('button', { name: 'More actions' }).click();
  const item = page.getByRole('menuitem', { name: /Schedule…/ });
  await expect(item).toBeDisabled();
  await expect(item).toContainText('Only guides with a browser step can be scheduled.');
});
