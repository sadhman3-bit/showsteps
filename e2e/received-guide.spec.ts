import type { Page, Worker } from '@playwright/test';
import { attachGuide, saveGuide } from './attach-helpers';
import { expect, launchProfile, test } from './fixtures';

// H4: a guide from someone else. One person exports it; another imports it into their own
// ShowSteps, as if it came from another computer. Run for me lists what it does and waits for a
// tick, its Send step asks again although the author turned that off, and it can't be scheduled
// until it is trusted.

type State = { status: string; phase: string; index: number };
type Hook = {
  guidance: { current: State; control(a: string): Promise<State> };
  store: {
    listGuides(): Promise<{ id: string; title: string }[]>;
    getGuide(id: string): Promise<{ received?: unknown } | undefined>;
  };
};
declare const __showsteps: Hook;

const TITLE = 'Send the monthly report';
const state = (sw: Worker) => sw.evaluate(() => __showsteps.guidance.current);

const cardOf = (lib: Page, title: string) =>
  lib
    .getByRole('list', { name: 'Library' })
    .getByRole('listitem')
    .filter({ has: lib.locator('.ss-card__title').getByText(title, { exact: true }) });

async function menu(lib: Page, item: string) {
  await cardOf(lib, TITLE).getByLabel(`Actions for this guide: ${TITLE}`).click();
  await cardOf(lib, TITLE).getByRole('menuitem', { name: item }).click();
}

test('a guide from someone else asks first, re-arms Send and waits for trust (H4)', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  test.setTimeout(150_000);
  // The author's copy: Send is a confirm step they switched off.
  const { guide } = attachGuide({ from: 'step' });
  const send = guide.blocks.at(-1)!;
  expect(send.kind === 'step' && send.agent.confirm).toBe(false);
  await saveGuide(serviceWorker, guide);
  const mine = await context.newPage();
  await mine.goto(`chrome-extension://${extensionId}/library.html`);
  const dl = mine.waitForEvent('download');
  await menu(mine, 'Export (.showsteps)');
  const path = test.info().outputPath('from-alex.showsteps');
  await (await dl).saveAs(path);

  const other = await launchProfile();
  try {
    const sw = other.serviceWorker;
    const lib = await other.context.newPage();
    await lib.goto(`chrome-extension://${other.extensionId}/library.html`);
    await lib.getByLabel('Import').setInputFiles(path);
    await expect(lib.getByText('Guide imported.')).toBeVisible();

    // No schedule before it is trusted.
    await menu(lib, 'Schedule…');
    const refused = lib.getByRole('dialog', { name: `Schedule “${TITLE}”` });
    await expect(refused).toContainText('came from someone else');
    await expect(refused.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await refused.getByRole('button', { name: 'Cancel' }).click();

    // Run for me lists what it does; Start waits for the tick.
    await cardOf(lib, TITLE)
      .getByRole('button', { name: `Run for me: ${TITLE}` })
      .click();
    const dialog = lib.getByRole('dialog', { name: 'Run for me' });
    const panel = dialog.getByRole('region', { name: 'From someone else' });
    await expect(panel).toContainText('from-alex.showsteps');
    await expect(panel).toContainText('localhost:5173');
    await expect(panel).toContainText(
      'Step 5 attaches the file downloaded from localhost:5173 on localhost:5173',
    );
    await expect(panel).toContainText('Step 6: Click Send (you confirm it)');
    await lib.screenshot({ path: test.info().outputPath('received-panel.png') });
    const start = dialog.getByRole('button', { name: 'Start' });
    await expect(start).toBeDisabled();
    await panel.getByRole('checkbox', { name: 'I’ve checked this guide' }).check();
    await expect(start).toBeEnabled();
    await start.click();

    // It runs, and stops at Send for the person although the file said not to.
    await expect
      .poll(async () => `${(await state(sw)).index}:${(await state(sw)).phase}`, {
        timeout: 60_000,
      })
      .toBe('5:confirm');
    await sw.evaluate(() => __showsteps.guidance.control('stop'));

    // Trust this guide: the panel is gone, and it can be scheduled.
    await lib.bringToFront();
    await cardOf(lib, TITLE)
      .getByRole('button', { name: `Run for me: ${TITLE}` })
      .click();
    await panel.getByRole('checkbox', { name: 'I’ve checked this guide' }).check();
    await panel.getByRole('button', { name: 'Trust this guide' }).click();
    await expect(panel).toHaveCount(0);
    await expect(start).toBeEnabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    const id = await sw.evaluate(
      async (t) => (await __showsteps.store.listGuides()).find((g) => g.title === t)!.id,
      TITLE,
    );
    expect(
      await sw.evaluate(async (i) => (await __showsteps.store.getGuide(i))?.received, id),
    ).toBeUndefined();
    await menu(lib, 'Schedule…');
    await expect(lib.getByRole('dialog', { name: `Schedule “${TITLE}”` })).not.toContainText(
      'came from someone else',
    );
  } finally {
    await other.close();
  }
});
