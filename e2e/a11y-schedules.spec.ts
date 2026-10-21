import type { Page, Worker } from '@playwright/test';
import { audit, focusVisible, moving } from './a11y-helpers';
import { expect, test } from './fixtures';
import { saveSchedule, scheduledGuide, type Hook } from './schedule-helpers';

declare const __showsteps: Hook & {
  startGuidance(msg: object, options?: object): Promise<unknown>;
};

async function check(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(300);
  const { unnamed, small } = await audit(page);
  expect(unnamed, `${name}: controls without a name`).toEqual([]);
  expect(small, `${name}: targets under 24×24 px`).toEqual([]);
  expect(await focusVisible(page, 20), `${name}: focus not visible`).toEqual([]);
  expect(await moving(page), `${name}: moving with reduced motion`).toBe(0);
}

/** A finished run in the log, so the history (with pictures) shows. */
async function addRun(sw: Worker, scheduleId: string, guideId: string): Promise<void> {
  await sw.evaluate(
    async ({ scheduleId, guideId }) => {
      const logs = __showsteps.runLogs as unknown as {
        put(l: object): Promise<void>;
        putShot(n: string, b: Blob): Promise<void>;
      };
      const canvas = new OffscreenCanvas(320, 200);
      canvas.getContext('2d')!.fillRect(0, 0, 320, 200);
      const shot = await canvas.convertToBlob({ type: 'image/jpeg' });
      await logs.putShot('a11y/1.jpg', shot);
      await logs.put({
        id: 'a11y-run',
        scheduleId,
        guideId,
        startedAt: new Date(Date.now() - 60_000).toISOString(),
        finishedAt: new Date().toISOString(),
        outcome: 'stopped',
        reason: 'confirm',
        steps: [
          {
            stepId: 'x',
            number: 1,
            status: 'done',
            at: new Date().toISOString(),
            screenshot: 'a11y/1.jpg',
          },
        ],
        values: { supplier: 'Saltbush 21/10/2026' },
      });
    },
    { scheduleId, guideId },
  );
}

test('schedule screens: named controls, 24 px targets, visible focus, reduced motion', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  test.setTimeout(120_000);
  const { id: guideId, steps } = await scheduledGuide(sw);
  const scheduleId = await saveSchedule(sw, guideId, steps);
  await addRun(sw, scheduleId, guideId);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const base = `chrome-extension://${extensionId}/library.html`;

  // The Schedule dialog (editing the schedule, so every section shows).
  await page.goto(`${base}#/guide/${guideId}/view`);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Schedule…' }).click();
  await page.getByRole('dialog').waitFor();
  await check(page, 'schedule dialog');
  await page.keyboard.press('Escape');

  // The Schedules page with its history open.
  await page.goto(`${base}#/schedules`);
  await page.getByText(/Run history/).click();
  await page.getByRole('button', { name: 'The page after step 1', exact: true }).waitFor();
  await check(page, 'schedules page');

  // The side panel's card while a scheduled run is going (paused after its first step).
  const run = await context.newPage();
  await run.goto('http://localhost:5173/login.html');
  await sw.evaluate(
    async ({ guideId }) => {
      const [tab] = await chrome.tabs.query({ url: 'http://localhost:5173/login.html' });
      await __showsteps.startGuidance(
        { type: 'guide-start', guideId, mode: 'run', tabId: tab!.id, stepThrough: true },
        { scheduleId: 'a11y', windowId: tab!.windowId },
      );
    },
    { guideId },
  );
  const panel = await context.newPage();
  await panel.emulateMedia({ reducedMotion: 'reduce' });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByText('Scheduled run', { exact: true }).waitFor();
  await check(panel, 'side panel run card');
  await sw.evaluate(() => __showsteps.guidance.control('stop'));
});

test('a schedule can be set up with the keyboard alone', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  const { id: guideId } = await scheduledGuide(sw);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/library.html#/guide/${guideId}/view`);
  const more = page.getByRole('button', { name: 'More actions' });
  await more.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Schedule…' })).toBeFocused();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Schedule “Scheduled invoice”' });
  await expect(dialog).toBeVisible();

  // Repeat: every day, by keyboard.
  const repeat = dialog.getByRole('combobox', { name: 'Repeat' });
  await repeat.focus();
  await repeat.selectOption('daily');
  // Time, then the value, by typing.
  await dialog.getByLabel('Time').focus();
  await page.keyboard.type('0645');
  const value = dialog.getByRole('group', { name: 'Values to type' }).getByRole('textbox');
  await value.focus();
  await page.keyboard.type('Saltbush');
  // Pre-approve Submit with the space bar.
  const approve = dialog.getByRole('checkbox', { name: /Click Submit invoice/ });
  await approve.focus();
  await page.keyboard.press('Space');
  await expect(approve).toBeChecked();
  // Save with Enter on the button.
  await dialog.getByRole('button', { name: 'Save schedule' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();

  await page.goto(`chrome-extension://${extensionId}/library.html#/schedules`);
  await expect(page.getByRole('listitem').filter({ hasText: 'Scheduled invoice' })).toContainText(
    'Every day at 06:45',
  );
});
