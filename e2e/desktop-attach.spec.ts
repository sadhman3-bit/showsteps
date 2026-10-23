import type { Worker } from '@playwright/test';
import { expect, test } from './desktop-fixtures';
import { EXPORTS, SEND, attachGuide, saveGuide } from './attach-helpers';

// 1.2 (R4): a form that returns a PDF can't be fetched again, so the desktop app reads the file
// Chrome saved and Run for me attaches it. No mouse or keyboard input is sent.

type Hook = {
  syncDesktop(): Promise<boolean>;
  guidance: { current: { status: string; index: number; phase: string; reason?: string } };
  startGuidance(msg: object): Promise<unknown>;
  runFiles: { count(): Promise<number> };
};
declare const __showsteps: Hook;

/** Turn on "Work with the desktop app" and wait for the native bridge. */
async function connect(sw: Worker): Promise<void> {
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...(settings ?? {}), desktopApp: true } });
  });
  await expect.poll(() => sw.evaluate(() => __showsteps.syncDesktop())).toBe(true);
}

test('a form download is read by the desktop app and attached (R4)', async ({
  desktop,
  context,
  serviceWorker: sw,
}) => {
  test.setTimeout(120_000);
  await connect(sw);
  await expect.poll(() => desktop.extensionConnected()).toBe(true);

  const { guide } = attachGuide({ download: 'post', from: 'step', file: 'statement.pdf' });
  await saveGuide(sw, guide);
  const page = await context.newPage();
  await page.goto(EXPORTS);
  const tabId = await sw.evaluate(
    async (u) => (await chrome.tabs.query({ url: `${u}*` }))[0]!.id!,
    EXPORTS,
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
    .poll(() => sw.evaluate(() => __showsteps.guidance.current.status), { timeout: 60_000 })
    .toBe('done')
    .catch(async (e: Error) => {
      const s = await sw.evaluate(() => JSON.stringify(__showsteps.guidance.current));
      throw new Error(`${e.message}
STATE ${s}`);
    });
  await expect(page).toHaveURL(new RegExp(`^${SEND}`));
  await expect(page.getByRole('list', { name: 'Attached files' })).toContainText(
    /\(\d+ bytes, starts %PDF-\)/,
  );
  await expect(page.getByRole('status')).toHaveText('Sent with 1 attachment.');
  await expect.poll(() => sw.evaluate(() => __showsteps.runFiles.count())).toBe(0);
});
