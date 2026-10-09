import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { recordShortGuide } from './helpers';

test('library: search, rename, folders, tags, filters, duplicate, trash, export and import', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  test.setTimeout(90_000);
  await recordShortGuide(context, serviceWorker);

  const lib = await context.newPage();
  const errors: string[] = [];
  lib.on('pageerror', (e) => errors.push(e.message));
  await lib.goto(`chrome-extension://${extensionId}/library.html`);
  const cards = lib.getByRole('list', { name: 'Library' });
  const card = (title: string) =>
    cards
      .getByRole('listitem')
      .filter({ has: lib.locator('.tm-card__title').getByText(title, { exact: true }) });
  const menu = async (title: string, item: string) => {
    await card(title).getByLabel(`Actions for this guide: ${title}`).click();
    await card(title).getByRole('menuitem', { name: item }).click();
  };

  // The recorded guide, titled after the page, with its cover thumbnail.
  await expect(card('Sign in · Ledgerline')).toBeVisible();
  await expect(card('Sign in · Ledgerline')).toContainText('4 steps');
  await expect(card('Sign in · Ledgerline').locator('img')).toHaveJSProperty('complete', true);
  await lib.screenshot({ path: test.info().outputPath('library-grid.png') });

  // Full-text search over step text.
  await lib.getByPlaceholder('Search guides and steps').fill('username');
  await expect(card('Sign in · Ledgerline')).toBeVisible();
  await lib.getByPlaceholder('Search guides and steps').fill('nothing like this');
  await expect(lib.getByText('No guides match your search.')).toBeVisible();
  await lib.getByPlaceholder('Search guides and steps').fill('');

  // Rename
  await menu('Sign in · Ledgerline', 'Rename');
  await lib.getByLabel('Guide title').fill('Log in to Ledgerline');
  await lib.getByRole('button', { name: 'Save' }).click();
  await expect(card('Log in to Ledgerline')).toBeVisible();

  // Tags and the tag filter
  await menu('Log in to Ledgerline', 'Tags');
  await lib.getByRole('textbox', { name: 'Tags' }).fill('ap, demo');
  await lib.getByRole('button', { name: 'Save' }).click();
  await expect(card('Log in to Ledgerline').getByText('demo')).toBeVisible();

  // Duplicate
  await menu('Log in to Ledgerline', 'Duplicate');
  await expect(card('Copy of Log in to Ledgerline')).toBeVisible();

  // Folders: create, move a guide in, view it
  await lib.getByRole('button', { name: 'New folder' }).click();
  await lib.getByLabel('Folder name').fill('Finance');
  await lib.getByRole('button', { name: 'Save' }).click();
  await menu('Copy of Log in to Ledgerline', 'Move to…');
  await lib.getByRole('combobox', { name: 'Folders' }).selectOption({ label: 'Finance' });
  await lib.getByRole('button', { name: 'Save' }).click();
  await lib.getByRole('button', { name: 'Finance' }).click();
  await expect(lib.getByRole('heading', { name: 'Finance' })).toBeVisible();
  await expect(cards.getByRole('listitem')).toHaveCount(1);
  await expect(card('Copy of Log in to Ledgerline')).toBeVisible();
  await lib.getByRole('button', { name: 'All guides' }).click();

  // Filters: app and tag
  await lib
    .getByRole('combobox', { name: 'Site or app' })
    .selectOption({ label: 'localhost:5173' });
  await expect(cards.getByRole('listitem')).toHaveCount(2);
  await lib.getByRole('combobox', { name: 'Tag' }).selectOption('demo');
  await expect(cards.getByRole('listitem')).toHaveCount(2); // the copy kept the tags
  await lib.getByRole('combobox', { name: 'Tag' }).selectOption('');
  await lib.getByRole('combobox', { name: 'Site or app' }).selectOption('');

  // List view
  await lib.getByRole('button', { name: 'List view' }).click();
  await expect(lib.locator('.tm-rows')).toBeVisible();
  await lib.screenshot({ path: test.info().outputPath('library-list.png') });
  await lib.getByRole('button', { name: 'Grid view' }).click();

  // Export as .trailmark
  const download = lib.waitForEvent('download');
  await menu('Log in to Ledgerline', 'Export (.trailmark)');
  const file = await download;
  expect(file.suggestedFilename()).toBe('Log in to Ledgerline.trailmark');
  const archivePath = test.info().outputPath('guide.trailmark');
  await file.saveAs(archivePath);
  expect(readFileSync(archivePath).subarray(0, 2).toString()).toBe('PK');

  // Trash, restore, delete permanently
  await menu('Log in to Ledgerline', 'Move to Trash');
  await expect(card('Log in to Ledgerline')).toHaveCount(0);
  await lib.getByRole('button', { name: 'Trash' }).click();
  await menu('Log in to Ledgerline', 'Restore');
  await expect(lib.getByText('The Trash is empty.')).toBeVisible();
  await lib.getByRole('button', { name: 'All guides' }).click();
  await menu('Log in to Ledgerline', 'Move to Trash');
  await lib.getByRole('button', { name: 'Trash' }).click();
  await menu('Log in to Ledgerline', 'Delete permanently');
  await lib.getByRole('dialog').getByRole('button', { name: 'Delete permanently' }).click();
  await expect(lib.getByText('The Trash is empty.')).toBeVisible();

  // Import brings it back
  await lib.getByRole('button', { name: 'All guides' }).click();
  await lib.getByLabel('Import').setInputFiles(archivePath);
  await expect(lib.getByText('Guide imported.')).toBeVisible();
  await expect(card('Log in to Ledgerline')).toBeVisible();

  // Delete the folder: its guide moves back to the top level
  await lib.getByRole('button', { name: 'Finance' }).click();
  await lib.getByRole('button', { name: 'Delete folder' }).click();
  await lib.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(lib.getByRole('button', { name: 'Finance' })).toHaveCount(0);
  await expect(card('Copy of Log in to Ledgerline')).toBeVisible();

  expect(errors).toEqual([]);
});

test('guide view shows numbered steps with screenshots and offers capture more', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const { id } = await recordShortGuide(context, serviceWorker);
  const view = await context.newPage();
  await view.goto(`chrome-extension://${extensionId}/library.html#/guide/${id}`);
  await expect(view.getByRole('heading', { level: 1, name: 'Sign in · Ledgerline' })).toBeVisible();
  const steps = view.locator('.tm-step');
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(1)).toContainText('Type alex into Username');
  const img = steps.nth(3).getByRole('img', { name: /Screenshot for step 4: Click Sign in/ });
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await expect(steps.nth(3).locator('.tm-shot__box')).toBeVisible();
  await expect(steps.nth(2)).toContainText('Enter your password');
  await view.screenshot({ path: test.info().outputPath('guide-view.png'), fullPage: true });

  await view.getByRole('button', { name: 'Capture more steps' }).click();
  const dialog = view.getByRole('dialog', { name: 'Capture more steps' });
  await expect(dialog.getByRole('combobox')).toContainText('Step 2: Type alex into Username');
  await dialog.getByRole('combobox').selectOption({ label: 'Step 1: Go to localhost:5173' });
  await dialog.getByRole('button', { name: 'Continue in the side panel' }).click();
  const pending = await serviceWorker.evaluate(
    async () => (await chrome.storage.session.get('captureMore')).captureMore,
  );
  expect(pending).toMatchObject({ guideId: id, insertAt: 1, afterStep: 1 });

  await view.getByRole('button', { name: 'Back to library' }).click();
  await expect(view.getByRole('heading', { name: 'All guides' })).toBeVisible();
});

test('side panel shows Start, recent guides and the capture-more hand-over', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  await recordShortGuide(context, serviceWorker);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 380, height: 760 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole('button', { name: 'Start capture' })).toBeVisible();
  await expect(panel.getByText('Shortcut: Alt+Shift+R')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Sign in · Ledgerline' })).toBeVisible();
  await expect(panel.getByText('Guide saved.')).toBeVisible();
  await panel.screenshot({ path: test.info().outputPath('sidepanel.png') });

  await serviceWorker.evaluate(() =>
    chrome.storage.session.set({
      captureMore: { guideId: 'x', title: 'Pay a bill', insertAt: 3, afterStep: 2 },
    }),
  );
  await expect(
    panel.getByText('Adding steps to “Pay a bill” after step 2.', { exact: false }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Add to a new guide instead' }).click();
  await expect(panel.getByText('Adding steps to', { exact: false })).toHaveCount(0);
});
