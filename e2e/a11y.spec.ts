import { audit, focusVisible, moving } from './a11y-helpers';
import { expect, test } from './fixtures';

type Hook = { installSamples(): Promise<string[]> };
declare const __showsteps: Hook;

test('every screen: named controls, 24 px targets, visible focus, reduced motion', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  test.setTimeout(120_000);
  await sw.evaluate(() => __showsteps.installSamples());
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const screens: [string, () => Promise<void>][] = [
    [
      'library',
      () => page.goto(`chrome-extension://${extensionId}/library.html`).then(() => undefined),
    ],
    [
      'editor',
      async () => {
        await page
          .getByRole('list', { name: 'Library' })
          .getByRole('button', { name: 'Create a supplier invoice in Ledgerline', exact: true })
          .click();
        await page.getByRole('textbox', { name: 'Guide title' }).waitFor();
      },
    ],
    ['reader', () => page.getByRole('button', { name: 'Preview' }).click()],
    ['agent', () => page.getByRole('button', { name: 'Agent' }).click()],
    [
      'side panel',
      () => page.goto(`chrome-extension://${extensionId}/sidepanel.html`).then(() => undefined),
    ],
  ];
  for (const [name, open] of screens) {
    await open();
    await page.waitForTimeout(400);
    const { unnamed, small } = await audit(page);
    expect(unnamed, `${name}: controls without a name`).toEqual([]);
    expect(small, `${name}: targets under 24×24 px`).toEqual([]);
    expect(await focusVisible(page), `${name}: focus not visible`).toEqual([]);
  }

  // Reduced motion: transitions and animations are off.
  expect(await moving(page)).toBe(0);
});

test('Guide Me and Run for me on cards, the editor and the side panel: named, 24 px, focusable (1.2)', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  await sw.evaluate(() => __showsteps.installSamples());
  const page = await context.newPage();
  const title = 'Create a supplier invoice in Ledgerline';
  /** Big enough, and Tab reaches it with a visible focus ring. */
  const check = async (button: ReturnType<typeof page.getByRole>) => {
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
    // Reach it with the keyboard (back one, then Tab), as a keyboard user would.
    await button.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const ring = await button.evaluate((el) => {
      const s = getComputedStyle(el);
      return el.matches(':focus-visible') && (s.outlineStyle !== 'none' || s.boxShadow !== 'none');
    });
    expect(ring).toBe(true);
  };

  await page.goto(`chrome-extension://${extensionId}/library.html`);
  await check(page.getByRole('button', { name: `Guide Me: ${title}` }));
  await check(page.getByRole('button', { name: `Run for me: ${title}` }));

  await page
    .getByRole('list', { name: 'Library' })
    .getByRole('button', { name: title, exact: true })
    .click();
  await page.getByRole('textbox', { name: 'Guide title' }).waitFor();
  await check(page.getByRole('button', { name: 'Guide Me', exact: true }));
  await check(page.getByRole('button', { name: 'Run for me', exact: true }));

  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const recent = page.getByRole('region', { name: 'Recent guides' });
  await check(recent.getByRole('button', { name: `Guide Me: ${title}` }));
  await check(recent.getByRole('button', { name: `Run for me: ${title}` }));
});
