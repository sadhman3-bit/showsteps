import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures';
import { recordShortGuide } from './helpers';

// M3 acceptance: reorder, insert heading and callout, blur, annotate, undo, restore a version.

type Stored = {
  title: string;
  blocks: {
    kind: string;
    text?: string;
    tone?: string;
    human?: {
      title: { spans: { text: string }[] };
      blurs: unknown[];
      annotations: { kind: string }[];
      screenshot?: { crop?: unknown };
    };
  }[];
};
declare const __showsteps: { store: { getGuide(id: string): Promise<Stored | undefined> } };

async function openEditor(context: BrowserContext, sw: Worker, extensionId: string) {
  const { id } = await recordShortGuide(context, sw);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/library.html#/guide/${id}`);
  await expect(page.getByRole('textbox', { name: 'Guide title' })).toHaveValue(
    'Sign in · Ledgerline',
  );
  return { id, page };
}

const saved = (page: Page) =>
  expect(page.getByRole('status').filter({ hasText: /^(Saved|Saving…)$/ })).toHaveText('Saved');

/** Block labels in order, as the editor shows them (step titles, headings, callout text). */
async function outline(page: Page): Promise<string[]> {
  return page.locator('.ss-eblock').evaluateAll((els) =>
    els.map((el) => {
      const title = el.querySelector('.ss-eblock__title [role="textbox"]');
      if (title) return title.textContent ?? '';
      const heading = el.querySelector<HTMLInputElement>('.ss-eblock__heading');
      if (heading) return `# ${heading.value}`;
      const callout = el.querySelector<HTMLTextAreaElement>('.ss-eblock__callout textarea');
      return `! ${callout?.value ?? ''}`;
    }),
  );
}

const stored = (sw: Worker, id: string) => sw.evaluate((g) => __showsteps.store.getGuide(g), id);

test('editor: reorder, headings, callouts, text, selection, merge, split, undo and autosave', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  test.setTimeout(90_000);
  const { id, page } = await openEditor(context, serviceWorker, extensionId);
  const card = (label: string) =>
    page.locator('.ss-eblock', { has: page.getByRole('checkbox', { name: `Select ${label}` }) });
  const menu = async (label: string, item: string) => {
    await card(label).getByLabel(`Actions for ${label}`).click();
    await card(label).getByRole('menuitem', { name: item }).click();
  };

  expect(await outline(page)).toEqual([
    'Go to localhost:5173',
    'Type alex into Username',
    'Enter your password',
    'Click Sign in',
  ]);

  // Reorder by dragging step 4 above step 2 (E2), in compact view so both are on screen
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Compact view' }).click();
  await card('Step 4')
    .locator('.ss-eblock__handle')
    .dragTo(card('Step 2'), { targetPosition: { x: 40, y: 8 } });
  expect(await outline(page)).toEqual([
    'Go to localhost:5173',
    'Click Sign in',
    'Type alex into Username',
    'Enter your password',
  ]);

  // Undo and redo (E6): focus is on the page, not a text field
  await page.locator('.ss-save').click(); // a non-interactive spot: focus leaves the fields
  await page.keyboard.press('Control+z');
  expect(await outline(page)).toEqual([
    'Go to localhost:5173',
    'Type alex into Username',
    'Enter your password',
    'Click Sign in',
  ]);
  await page.keyboard.press('Control+y');
  expect(await outline(page)).toEqual([
    'Go to localhost:5173',
    'Click Sign in',
    'Type alex into Username',
    'Enter your password',
  ]);
  await page.keyboard.press('Control+z');

  // Insert a heading and a callout (E2, E3)
  await menu('Step 1', 'Add heading below');
  await page.getByRole('textbox', { name: 'Heading' }).fill('Sign in');
  await menu('Step 3', 'Add callout below');
  await page.getByRole('combobox', { name: 'Callout type' }).selectOption('warning');
  await page.getByRole('textbox', { name: 'Callout text' }).fill('Never share your password.');
  expect(await outline(page)).toEqual([
    'Go to localhost:5173',
    '# Sign in',
    'Type alex into Username',
    'Enter your password',
    '! Never share your password.',
    'Click Sign in',
  ]);

  // Headings drag like steps (E3)
  await card('Heading: Sign in')
    .locator('.ss-eblock__handle')
    .dragTo(card('Step 1'), { targetPosition: { x: 40, y: 8 } });
  expect((await outline(page))[0]).toBe('# Sign in');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Compact view' }).click();

  // Edit text: guide title and a step title with bold (E1)
  await page.getByRole('textbox', { name: 'Guide title' }).fill('Sign in to Ledgerline');
  const t2 = page.getByRole('textbox', { name: 'Step 2 title' });
  await t2.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' now');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+b');
  await expect(t2.locator('b, strong').first()).toBeVisible();
  await page.getByRole('textbox', { name: 'Step 2 description' }).click();
  await page.keyboard.type('Use your work username.');

  // Multi-select, duplicate, delete several (E2)
  await page.getByRole('checkbox', { name: 'Select Step 1' }).check();
  await page.getByRole('checkbox', { name: 'Select Step 4' }).check();
  await page
    .getByRole('toolbar', { name: '2 selected' })
    .getByRole('button', { name: 'Duplicate' })
    .click();
  expect((await outline(page)).filter((t) => t === 'Go to localhost:5173')).toHaveLength(2);
  await page
    .getByRole('toolbar', { name: '2 selected' })
    .getByRole('button', { name: 'Delete' })
    .click();
  expect((await outline(page)).filter((t) => t === 'Go to localhost:5173')).toHaveLength(1);

  // Merge and split (E2)
  const before = await outline(page);
  const firstStep = before.findIndex((t) => !t.startsWith('#') && !t.startsWith('!'));
  const firstLabel = `Step 1`;
  await menu(firstLabel, 'Merge with next step');
  // After deleting the selected originals, step 1 is the typing step. (Polled: the editor
  // re-renders after the merge, which takes longer on slower machines such as CI on Linux.)
  await expect
    .poll(async () => (await outline(page))[firstStep])
    .toBe('Type alex into Username now, then enter your password');
  await menu(firstLabel, 'Split step');
  await expect.poll(async () => (await outline(page)).length).toBe(before.length);

  // Keyboard: Ctrl+Enter adds a step; ? opens the shortcut sheet (E6)
  const count = (await outline(page)).length;
  await page.getByRole('textbox', { name: 'Step 1 title' }).click();
  await page.keyboard.press('Control+Enter');
  expect((await outline(page)).length).toBe(count + 1);
  await page.locator('.ss-save').click(); // a non-interactive spot: focus leaves the fields
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Autosave (E9): reload and everything is still there
  await saved(page);
  const final = await outline(page);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Guide title' })).toHaveValue(
    'Sign in to Ledgerline',
  );
  expect(await outline(page)).toEqual(final);
  const g = await stored(serviceWorker, id);
  expect(g?.blocks.some((b) => b.kind === 'callout' && b.tone === 'warning')).toBe(true);
});

test('image editor: blur, annotate, magnify, undo, bulk blur and reset', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  test.setTimeout(90_000);
  const { id, page } = await openEditor(context, serviceWorker, extensionId);
  await page.getByRole('button', { name: 'Edit image: Step 3' }).click();
  const dlg = page.getByRole('dialog', { name: 'Edit image for step 3' });
  const canvas = dlg.getByRole('img', { name: 'Screenshot being edited' });
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const drag = async (x1: number, y1: number, x2: number, y2: number) => {
    await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width * ((x1 + x2) / 2),
      box.y + box.height * ((y1 + y2) / 2),
      { steps: 4 },
    );
    await page.mouse.move(box.x + box.width * x2, box.y + box.height * y2, { steps: 4 });
    await page.mouse.up();
  };

  // Blur
  await dlg.getByRole('button', { name: 'Blur', exact: true }).click();
  await drag(0.3, 0.3, 0.6, 0.4);
  await expect(canvas.locator('[data-blur-rect]')).toHaveCount(1);

  // Annotations: rectangle, arrow, text, numbered badge, pen
  await dlg.getByRole('button', { name: 'Rectangle' }).click();
  await drag(0.1, 0.1, 0.25, 0.2);
  await dlg.getByRole('button', { name: 'Arrow' }).click();
  await drag(0.7, 0.7, 0.5, 0.5);
  await dlg.getByRole('button', { name: 'Numbered badge' }).click();
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.2);
  await dlg.getByRole('button', { name: 'Pen' }).click();
  await drag(0.2, 0.8, 0.4, 0.85);
  await dlg.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.6);
  await page.getByRole('textbox', { name: 'Text' }).fill('Sign in here');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(canvas.locator('[data-annotation]')).toHaveCount(5);

  // Colour applies to new shapes
  await dlg.getByRole('button', { name: '#14102B' }).click();
  await dlg.getByRole('button', { name: 'Ellipse' }).click();
  await drag(0.5, 0.1, 0.6, 0.2);
  await expect(canvas.locator('ellipse')).toHaveAttribute('stroke', '#14102B');

  // Undo and redo inside the image editor
  await page.keyboard.press('Control+z');
  await expect(canvas.locator('[data-annotation]')).toHaveCount(5);
  await page.keyboard.press('Control+y');
  await expect(canvas.locator('[data-annotation]')).toHaveCount(6);
  await page.keyboard.press('Control+z');

  // Select an annotation and delete it
  await dlg.getByRole('button', { name: 'Select and move' }).click();
  await canvas.locator('[data-annotation]').first().click();
  await page.keyboard.press('Delete');
  await expect(canvas.locator('[data-annotation]')).toHaveCount(4);

  // Magnify around the highlight
  await dlg.getByRole('checkbox', { name: 'Magnify around the highlight' }).check();
  await expect(dlg.getByRole('slider', { name: /Zoom level/ })).toBeVisible();
  await dlg.getByRole('button', { name: 'Done' }).click();
  await expect(dlg).toHaveCount(0);

  // The editor card shows the blur and annotations
  const step3 = page.locator('.ss-eblock', {
    has: page.getByRole('checkbox', { name: 'Select Step 3' }),
  });
  await expect(step3.locator('[data-blur]')).toHaveCount(1);
  await expect(step3.locator('[data-annotation]')).toHaveCount(4);
  await page.screenshot({ path: test.info().outputPath('editor-annotated.png'), fullPage: true });

  // Bulk blur: same region applied to other steps with same-size screenshots (E4)
  await page.getByRole('button', { name: 'Edit image: Step 2' }).click();
  const dlg2 = page.getByRole('dialog', { name: 'Edit image for step 2' });
  await dlg2.getByRole('button', { name: 'Blur', exact: true }).click();
  const c2 = (await dlg2.getByRole('img', { name: 'Screenshot being edited' }).boundingBox())!;
  await page.mouse.move(c2.x + c2.width * 0.05, c2.y + c2.height * 0.02);
  await page.mouse.down();
  await page.mouse.move(c2.x + c2.width * 0.3, c2.y + c2.height * 0.08, { steps: 5 });
  await page.mouse.up();
  await dlg2.getByRole('button', { name: 'Apply blurs to other steps…' }).click();
  const bulk = page.getByRole('dialog', { name: 'Blur the same areas in other steps' });
  await expect(bulk.getByRole('checkbox')).toHaveCount(3);
  await bulk.getByRole('button', { name: 'Apply' }).click();
  await saved(page);
  const g = await stored(serviceWorker, id);
  const steps = g!.blocks.filter((b) => b.kind === 'step');
  expect(steps.map((s) => s.human!.blurs.length)).toEqual([1, 1, 2, 1]);
  expect(steps[2]!.human!.screenshot?.crop).toBeDefined();

  // Reset to original
  await page.getByRole('button', { name: 'Edit image: Step 3' }).click();
  const dlg3 = page.getByRole('dialog', { name: 'Edit image for step 3' });
  await dlg3.getByRole('button', { name: 'Reset to original' }).click();
  await page
    .getByRole('dialog', { name: 'Reset to original' })
    .getByRole('button', { name: 'Reset to original' })
    .click();
  await expect(dlg3.locator('[data-annotation]')).toHaveCount(0);
  await dlg3.getByRole('button', { name: 'Done' }).click();
  await expect(
    page
      .locator('.ss-eblock', { has: page.getByRole('checkbox', { name: 'Select Step 3' }) })
      .locator('[data-blur]'),
  ).toHaveCount(0);
});

test('version history: restore an earlier version (E9)', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  test.setTimeout(60_000);
  const { page } = await openEditor(context, serviceWorker, extensionId);
  await page.getByRole('textbox', { name: 'Guide title' }).fill('Renamed guide');
  await page.getByRole('textbox', { name: 'Step 4 title' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' quickly');
  await saved(page);

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Version history' }).click();
  const dlg = page.getByRole('dialog', { name: 'Version history' });
  const versions = dlg.getByRole('list', { name: 'Version history' }).getByRole('listitem');
  await expect(versions).toHaveCount(2);
  await expect(versions.first()).toContainText('Current');
  await expect(versions.last()).toContainText('Sign in · Ledgerline');

  // View the old version, then restore it
  await versions.last().getByRole('button', { name: 'View' }).click();
  await expect(dlg.getByRole('heading', { level: 1, name: 'Sign in · Ledgerline' })).toBeVisible();
  await dlg.getByRole('button', { name: 'Back to versions' }).click();
  await versions.last().getByRole('button', { name: 'Restore' }).click();
  await page
    .getByRole('dialog', { name: 'Restore' })
    .getByRole('button', { name: 'Restore' })
    .click();
  await expect(page.getByRole('textbox', { name: 'Guide title' })).toHaveValue(
    'Sign in · Ledgerline',
  );
  await expect(page.getByRole('textbox', { name: 'Step 4 title' })).toHaveText('Click Sign in');
  await saved(page);

  // The edited guide was kept as a version too.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Version history' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Version history' }).getByText('Renamed guide').first(),
  ).toBeVisible();
});

test('preview, step links, branding and image-only steps (E5, E7, E8)', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  test.setTimeout(60_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { id, page } = await openEditor(context, serviceWorker, extensionId);

  // Image-only step from a file (E5)
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#0f6b62';
    ctx.fillRect(0, 0, 400, 300);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.ss-addbar').getByRole('button', { name: 'Add image step' }).click();
  await (
    await chooser
  ).setFiles({ name: 'diagram.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await expect(page.getByRole('button', { name: 'Edit image: Step 5' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Step 5 title' }).click();
  await page.keyboard.type('Check the totals match the diagram');

  // Branding (E8)
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Branding' }).click();
  const brand = page.getByRole('dialog', { name: 'Branding' });
  await brand.getByLabel('Accent colour').fill('#aa3355');
  await brand.getByLabel('Font').selectOption('Georgia');
  await brand.getByRole('button', { name: 'Close' }).click();
  await saved(page);

  // Preview shows exactly what readers see, with branding (E7)
  await page.getByRole('button', { name: 'Preview' }).click();
  const reader = page.locator('.ss-reader');
  await expect(reader).toHaveCSS('font-family', /Georgia/);
  expect(
    await reader.evaluate((el) => getComputedStyle(el).getPropertyValue('--ss-accent').trim()),
  ).toBe('#aa3355');
  await expect(reader.locator('.ss-step')).toHaveCount(5);
  await page.screenshot({ path: test.info().outputPath('preview-branded.png'), fullPage: true });

  // Copy link to a step, then follow it
  await reader
    .locator('.ss-step')
    .nth(3)
    .getByRole('button', { name: 'Copy link to this step' })
    .click();
  await expect(
    reader.locator('.ss-step').nth(3).getByRole('button', { name: 'Link copied' }),
  ).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(new RegExp(`library\\.html#/guide/${id}/step/[\\w-]+$`));
  const other = await context.newPage();
  await other.goto(link);
  await expect(other.locator('.ss-step--focused')).toContainText('Click Sign in');
});
