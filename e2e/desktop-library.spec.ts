import { createGuide, createStep, FolderStore, plain, type Guide } from '@showsteps/core';
import { nodeFileSystem } from '@showsteps/core/node';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './desktop-fixtures';

// L3 team library in a synced folder and L6 read-only guides, in the desktop app's own window
// (no mouse or keyboard input outside it).

function guideWithStep(title: string, readOnly = false): Guide {
  const step = createStep({
    action: 'click',
    app: { kind: 'desktop', processName: 'excel', windowTitle: 'Book1 - Excel' },
    human: { title: plain(`Click ${title}`) },
  });
  return { ...createGuide({ title }), blocks: [step], ...(readOnly ? { readOnly: true } : {}) };
}

test('team library: others’ guides, who edited them, read-only guides and personal copies (L3, L6)', async ({
  desktop,
}) => {
  // A colleague's guides in the synced folder.
  const teamDir = join(desktop.dir, 'team');
  const priya = new FolderStore(nodeFileSystem, teamDir, { user: 'Priya' });
  const locked = guideWithStep('Approve a supplier', true);
  const open = guideWithStep('Close the month');
  await priya.saveGuide(locked);
  await priya.saveGuide(open);

  const win = await desktop.app.firstWindow();
  await win.evaluate(
    (dir) =>
      (
        window as unknown as { showsteps: { invoke(c: string, v: unknown): Promise<unknown> } }
      ).showsteps.invoke('settings:set', { sharedPath: dir, active: 'shared', userName: 'Sam' }),
    teamDir,
  );
  await win.reload();
  await expect(win.getByRole('button', { name: 'Team library' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const cards = win.getByRole('list', { name: 'Library' }).getByRole('listitem');
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: 'Approve a supplier' })).toContainText('Edited by Priya');

  // A read-only guide opens in the reader; editing makes a copy in my library.
  await win.getByRole('button', { name: 'Approve a supplier' }).click();
  await expect(win.getByRole('status').filter({ hasText: 'Read-only' })).toBeVisible();
  await expect(win.getByRole('textbox', { name: 'Step 1 title' })).toHaveCount(0);
  await win.getByRole('button', { name: 'Edit a personal copy' }).click();
  await expect(win.getByText('Copied “Approve a supplier” to your library.')).toBeVisible();
  await expect(win.getByRole('textbox', { name: 'Step 1 title' })).toHaveText(
    'Click Approve a supplier',
  );
  await expect(win.getByRole('button', { name: 'My library' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const mine = new FolderStore(nodeFileSystem, desktop.library);
  const [copy] = await mine.listGuides();
  expect(copy?.title).toBe('Approve a supplier');
  expect((await mine.getGuide(copy!.id))?.readOnly).toBeUndefined();
  // The team's guide is unchanged.
  expect((await priya.getGuide(locked.id))?.readOnly).toBe(true);

  // In the team library I can mark my guide read-only for others; my name is on the edit.
  await win.getByRole('button', { name: 'Back to library' }).click();
  await win.getByRole('button', { name: 'Team library' }).click();
  await win.getByRole('button', { name: 'Close the month' }).click();
  await win.getByRole('checkbox', { name: 'Read-only for others' }).check();
  await expect
    .poll(async () => {
      const g = await priya.getGuide(open.id);
      return [g?.readOnly, g?.updatedBy];
    })
    .toEqual([true, 'Sam']);
});

test('Secure Blur reads an uploaded picture with the bundled OCR in the desktop app (E11, U8)', async ({
  desktop,
  page,
}) => {
  test.setTimeout(180_000);
  const planted = JSON.parse(
    readFileSync(new URL('../fixtures/demo-app/planted-secrets.json', import.meta.url), 'utf8'),
  ) as { values: { kind: string; text: string }[] };
  // A picture of the planted values, as someone might paste from another app.
  await page.setViewportSize({ width: 1000, height: 420 });
  await page.setContent(
    `<style>body{font:16px Segoe UI,sans-serif;margin:32px}td{padding:4px 16px}</style><h2>Supplier contact</h2><table>${[
      ['Email', 'accounts@saltbush-supplies.example'],
      ['Phone', '0412 345 678'],
      ['Card on file', '4111 1111 1111 1111'],
      ['BSB / Account', '123-456 / 98765432'],
      ['TFN', '123 456 782'],
      ['ABN', '51 824 753 556'],
      ['IBAN', 'GB82 WEST 1234 5698 7654 32'],
    ]
      .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
      .join('')}</table>`,
  );
  const png = await page.screenshot();
  const store = new FolderStore(nodeFileSystem, desktop.library);
  const step = createStep({
    action: 'manual',
    app: { kind: 'desktop', processName: 'excel', windowTitle: 'Suppliers - Excel' },
    human: {
      title: plain('Check the supplier details'),
      screenshot: { file: 'img/pasted.png', width: 1000, height: 420, dpr: 1 },
    },
  });
  const guide = { ...createGuide({ title: 'Check a supplier' }), blocks: [step] };
  await store.saveGuide(guide);
  await store.putImage(guide.id, 'pasted.png', new Uint8Array(png));

  const win = await desktop.app.firstWindow();
  await win.evaluate((id) => (location.hash = `#/guide/${id}`), guide.id);
  await win.getByRole('button', { name: 'More actions' }).click();
  await win.getByRole('menuitem', { name: 'Secure Blur' }).click();
  const region = win.getByRole('dialog', { name: 'Secure Blur' }).getByRole('region', {
    name: 'Secure Blur',
  });
  await expect(region).toBeVisible({ timeout: 120_000 });
  await expect(region.getByRole('checkbox')).toHaveCount(planted.values.length);
  await win.screenshot({ path: test.info().outputPath('desktop-secure-blur.png') });
});
