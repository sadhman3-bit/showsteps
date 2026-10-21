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
          .getByRole('button', { name: 'Create a supplier invoice in Ledgerline' })
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
