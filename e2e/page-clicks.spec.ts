import type { Page, Worker } from '@playwright/test';
import { attachGuide, saveGuide } from './attach-helpers';
import { expect, test } from './fixtures';
import { startCaptureOn } from './helpers';

// H5: ShowSteps's buttons sit in open shadow roots that page scripts can reach. Only a real
// click presses them: a page script that clicks Confirm or Finish changes nothing.

type State = { status: string; phase: string; index: number };
declare const __showsteps: {
  guidance: { current: State; control(a: string): Promise<State> };
  startGuidance(msg: object): Promise<State>;
  recorder: { current: { status: string } };
};

const state = (sw: Worker) => sw.evaluate(() => __showsteps.guidance.current);

/** A page script presses a button inside a ShowSteps shadow root, both ways it can. */
function pageScriptPress(page: Page, host: string, label: string) {
  return page.evaluate(
    ({ host, label }) => {
      const root = document.querySelector(host)!.shadowRoot!;
      const button = Array.from(root.querySelectorAll('button')).find((b) =>
        b.textContent?.includes(label),
      )!;
      button.click();
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    },
    { host, label },
  );
}

test('a page script can’t confirm a Run for me step; a real click can (H5)', async ({
  context,
  serviceWorker: sw,
}) => {
  test.setTimeout(90_000);
  const { guide } = attachGuide({ from: 'step' });
  const send = guide.blocks.at(-1)!;
  if (send.kind === 'step') send.agent.confirm = true;
  await saveGuide(sw, guide);
  const page = await context.newPage();
  await page.goto('http://localhost:5173/exports.html');
  await page.bringToFront();
  const tabId = await sw.evaluate(
    async () => (await chrome.tabs.query({ url: 'http://localhost:5173/exports.html' }))[0]!.id!,
  );
  await sw.evaluate(
    ({ id, tabId }) =>
      __showsteps.startGuidance({
        type: 'guide-start',
        guideId: id,
        mode: 'run',
        tabId,
        speed: 'fast',
      }),
    { id: guide.id, tabId },
  );
  await expect
    .poll(async () => `${(await state(sw)).index}:${(await state(sw)).phase}`, {
      timeout: 60_000,
    })
    .toBe('5:confirm');
  const confirm = page
    .locator('showsteps-guide')
    .getByRole('button', { name: 'Confirm and continue' });
  await expect(confirm).toBeVisible();

  await pageScriptPress(page, 'showsteps-guide', 'Confirm and continue');
  await page.waitForTimeout(1500);
  expect(await state(sw)).toMatchObject({ index: 5, phase: 'confirm' });
  await expect(page.getByText('Sent with 1 attachment.')).toHaveCount(0);

  await confirm.click();
  await expect.poll(async () => (await state(sw)).status, { timeout: 30_000 }).toBe('done');
  await expect(page.getByRole('status')).toHaveText('Sent with 1 attachment.');
});

test('a page script can’t press Finish on the capture toolbar; a real click can (H5)', async ({
  context,
  serviceWorker: sw,
}) => {
  test.setTimeout(60_000);
  const page = await context.newPage();
  await page.goto('http://localhost:5173/app/');
  await page.getByRole('cell', { name: 'INV-1042' }).waitFor();
  await page.bringToFront();
  await startCaptureOn(sw, 'http://localhost:5173/');
  const bar = page.locator('showsteps-controller').getByRole('toolbar');
  await expect(bar).toContainText('Recording');

  await pageScriptPress(page, 'showsteps-controller', 'Finish');
  await page.waitForTimeout(1000);
  await expect(bar).toContainText('Recording');
  expect(await sw.evaluate(() => __showsteps.recorder.current.status)).toBe('recording');

  await bar.getByRole('button', { name: 'Finish' }).click();
  await expect
    .poll(() => sw.evaluate(() => __showsteps.recorder.current.status))
    .not.toBe('recording');
});
