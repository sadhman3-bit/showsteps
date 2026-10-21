import { expect, test } from './fixtures';
import { scheduledGuide, type Hook } from './schedule-helpers';

declare const __showsteps: Hook & {
  schedulesKey: string;
  runLogs: { put(l: object): Promise<void>; putShot(n: string, b: Blob): Promise<void> };
};

test('the Schedules page with 10 schedules and 20 runs each opens in under a second', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  test.setTimeout(120_000);
  const { id: guideId } = await scheduledGuide(sw);
  await sw.evaluate(
    async ({ guideId }) => {
      const canvas = new OffscreenCanvas(1280, 800);
      canvas.getContext('2d')!.fillRect(0, 0, 1280, 800);
      const shot = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
      const schedules = [];
      for (let i = 0; i < 10; i++) {
        const id = `perf-${i}`;
        schedules.push({
          id,
          guideId,
          name: `Schedule ${i}`,
          enabled: true,
          createdAt: new Date().toISOString(),
          guideVersion: 'v',
          recurrence: { kind: 'weekly', days: [1, 3, 5] },
          time: `0${i}:15`.slice(-5),
          skipDates: [],
          missedRun: 'run-at-start',
          values: {},
          dateFormat: 'dd/MM/yyyy',
          approvedConfirmSteps: { guideVersion: '', stepIds: [] },
          waitMinutes: 30,
          keepWindowOpen: false,
          checkFirst: false,
        });
        for (let r = 0; r < 20; r++) {
          const runId = `${id}-run-${r}`;
          const steps = [];
          for (let n = 1; n <= 16; n++) {
            const name = `${runId}/${n}.jpg`;
            await __showsteps.runLogs.putShot(name, shot);
            steps.push({
              stepId: `s${n}`,
              number: n,
              status: 'done',
              at: new Date().toISOString(),
              screenshot: name,
            });
          }
          await __showsteps.runLogs.put({
            id: runId,
            scheduleId: id,
            guideId,
            startedAt: new Date(Date.now() - (r + 1) * 86_400_000).toISOString(),
            finishedAt: new Date(Date.now() - (r + 1) * 86_400_000 + 60_000).toISOString(),
            outcome: r % 4 ? 'completed' : 'stopped',
            ...(r % 4 ? {} : { reason: 'confirm' }),
            steps,
            values: { supplier: `Saltbush ${r}` },
          });
        }
      }
      await chrome.storage.local.set({ [__showsteps.schedulesKey]: schedules });
    },
    { guideId },
  );

  const page = await context.newPage();
  // Warm the extension page once (the first load of any page compiles its code).
  await page.goto(`chrome-extension://${extensionId}/library.html`);
  const t = Date.now();
  await page.goto(`chrome-extension://${extensionId}/library.html#/schedules`);
  await expect(page.locator('.ss-schedules__item')).toHaveCount(10);
  await expect(page.getByText('Run history (20 runs)')).toHaveCount(10);
  const openMs = Date.now() - t;
  test.info().annotations.push({ type: 'timing', description: JSON.stringify({ openMs }) });
  expect(openMs).toBeLessThan(1000);
});
