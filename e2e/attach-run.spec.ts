import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures';
import { EXPORTS, SEND, attachGuide, saveGuide } from './attach-helpers';

// 1.2 (R3): Run for me attaches the file an earlier step downloaded, on the demo app's Exports
// and Send pages (the file field is hidden behind an Attach button, as in webmail).

type State = {
  status: string;
  phase: string;
  index: number;
  reason?: string;
  file?: { name?: string; step?: number };
};
declare const __showsteps: {
  guidance: { current: State; control(a: string): Promise<State> };
  startGuidance(msg: object): Promise<State>;
  runFiles: { count(): Promise<number> };
};

const state = (sw: Worker) => sw.evaluate(() => __showsteps.guidance.current);
const storedFiles = (sw: Worker) => sw.evaluate(() => __showsteps.runFiles.count());

/** As if ShowSteps had no download access: the run then reads simple links in the page. */
async function withoutDownloadAccess(sw: Worker): Promise<void> {
  await sw.evaluate(() => {
    const p = chrome.permissions;
    const contains = p.contains.bind(p);
    p.contains = ((q: chrome.permissions.Permissions) =>
      q.permissions?.includes('downloads')
        ? Promise.resolve(false)
        : contains(q)) as typeof p.contains;
  });
}

async function run(
  context: BrowserContext,
  sw: Worker,
  opts: Parameters<typeof attachGuide>[0] & { stepThrough?: boolean },
): Promise<{ page: Page; guideId: string }> {
  const { guide } = attachGuide(opts);
  await saveGuide(sw, guide);
  const page = await context.newPage();
  await page.goto(EXPORTS + (opts.exportsQuery ? `?${opts.exportsQuery}` : ''));
  await page.bringToFront();
  const tabId = await sw.evaluate(
    async (u) => (await chrome.tabs.query({ url: `${u}*` }))[0]!.id!,
    EXPORTS,
  );
  await sw.evaluate(
    ({ id, tabId, stepThrough }) =>
      __showsteps.startGuidance({
        type: 'guide-start',
        guideId: id,
        mode: 'run',
        tabId,
        speed: 'fast',
        stepThrough,
      }),
    { id: guide.id, tabId, stepThrough: opts.stepThrough ?? false },
  );
  return { page, guideId: guide.id };
}

/** The run attached the file and sent it; its stored copy is gone afterwards. */
async function attachedAndSent(sw: Worker, page: Page, name: string, starts: string) {
  await expect.poll(async () => (await state(sw)).status, { timeout: 60_000 }).toBe('done');
  await expect(page).toHaveURL(new RegExp(`^${SEND}`));
  await expect(page.getByRole('list', { name: 'Attached files' })).toContainText(
    new RegExp(`^${name.replace('.', '\\.')} \\(\\d+ bytes, starts ${starts}\\)$`),
  );
  await expect(page.getByRole('status')).toHaveText('Sent with 1 attachment.');
  await expect.poll(() => storedFiles(sw)).toBe(0);
}

/** The run stopped at the attach step for the person, saying why. */
async function stoppedAtAttach(sw: Worker, reason: string) {
  await expect
    .poll(
      async () => {
        const s = await state(sw);
        return `${s.index}:${s.phase}:${s.reason}`;
      },
      { timeout: 60_000 },
    )
    .toBe(`4:manual:${reason}`);
  return state(sw);
}

for (const access of [true, false])
  test(`a plain download link is attached ${access ? 'with' : 'without'} download access`, async ({
    context,
    serviceWorker: sw,
  }) => {
    test.setTimeout(90_000);
    if (!access) await withoutDownloadAccess(sw);
    const { page } = await run(context, sw, { download: 'link', from: 'step' });
    await attachedAndSent(sw, page, 'report.pdf', '%PDF-');
  });

test('a file built in the page (a blob: link) is read in the page and attached', async ({
  context,
  serviceWorker: sw,
}) => {
  test.setTimeout(90_000);
  const { page } = await run(context, sw, { download: 'blob', from: 'latest' });
  await attachedAndSent(sw, page, 'invoices.csv', 'numbe');
});

test('a form that returns a PDF stops for the person when the desktop app isn’t connected', async ({
  context,
  serviceWorker: sw,
}) => {
  test.setTimeout(90_000);
  const { page } = await run(context, sw, {
    download: 'post',
    from: 'step',
    file: 'statement.pdf',
  });
  const s = await stoppedAtAttach(sw, 'file-failed');
  // The side panel says what to choose: "Choose … from your Downloads folder (downloaded in step 2)."
  expect(s.file?.step).toBe(2);
  expect(s.file?.name).toBeTruthy();
  expect(await storedFiles(sw)).toBe(0);
  // The person picks the file themselves and says so; the run carries on.
  await page.locator('input[type="file"]').setInputFiles({
    name: 'statement.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4'),
  });
  // The field is hidden, so there's nothing to watch: the person presses "I did it".
  await sw.evaluate(() => __showsteps.guidance.control('next'));
  await expect.poll(async () => (await state(sw)).status, { timeout: 30_000 }).toBe('done');
});

test('a field that doesn’t take the file stops with the reason', async ({
  context,
  serviceWorker: sw,
}) => {
  test.setTimeout(90_000);
  await run(context, sw, { download: 'link', from: 'step', query: 'accept=.png' });
  const s = await stoppedAtAttach(sw, 'file-type');
  expect(s.file?.name).toBe('report.pdf');
  await sw.evaluate(() => __showsteps.guidance.control('stop'));
  await expect.poll(() => storedFiles(sw)).toBe(0);
});

test('a file over 25 MB isn’t attached', async ({ context, serviceWorker: sw }) => {
  test.setTimeout(120_000);
  await run(context, sw, { download: 'link', from: 'step', exportsQuery: 'kb=26000' });
  await stoppedAtAttach(sw, 'file-big');
  expect(await storedFiles(sw)).toBe(0);
  await sw.evaluate(() => __showsteps.guidance.control('stop'));
});

test('after a worker restart mid-run, the kept file is still attached', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  test.setTimeout(120_000);
  // Step by step, so the run can be stopped between the download and the attach step: the
  // first pause comes after the download click (step 2).
  const { page } = await run(context, sw, { download: 'link', from: 'step', stepThrough: true });
  await expect
    .poll(async () => `${(await state(sw)).index}:${(await state(sw)).phase}`, { timeout: 30_000 })
    .toBe('2:paused');
  await expect.poll(() => storedFiles(sw)).toBe(1);

  // Stop the service worker (as Chrome does when it is idle), then wake it from a page.
  const library = await context.newPage();
  await library.goto(`chrome-extension://${extensionId}/library.html`);
  const cdp = await context.newCDPSession(library);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await library.evaluate(() => chrome.runtime.sendMessage({ type: 'guide-get' }));
  // Playwright keeps one Worker object per worker; find the one that answers now.
  let worker: Worker | undefined;
  await expect
    .poll(
      async () => {
        for (const w of [...context.serviceWorkers()].reverse()) {
          if (await w.evaluate(() => 1).catch(() => 0)) {
            worker = w;
            return true;
          }
        }
        return false;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  if (!worker) throw new Error('no worker');
  await expect.poll(async () => (await state(worker)).phase, { timeout: 20_000 }).toBe('paused');
  expect(await storedFiles(worker)).toBe(1);
  // Carry on, step by step, to the end.
  await expect
    .poll(
      async () => {
        const s = await state(worker);
        if (s.status === 'active' && s.phase === 'paused')
          await worker.evaluate(() => __showsteps.guidance.control('resume'));
        return s.status;
      },
      { timeout: 60_000, intervals: [500] },
    )
    .toBe('done');
  await expect(page.getByRole('list', { name: 'Attached files' })).toContainText('report.pdf (');
  await expect.poll(() => storedFiles(worker)).toBe(0);
});

test('a 25 MB file is attached within the step’s timeout (R8)', async ({
  context,
  serviceWorker: sw,
}) => {
  test.setTimeout(120_000);
  // 25,000 KB: just under the 25 MB cap. The upload step's timeout is 15 s.
  const { page } = await run(context, sw, {
    download: 'link',
    from: 'step',
    exportsQuery: 'kb=25000',
  });
  await expect.poll(async () => (await state(sw)).index, { timeout: 60_000 }).toBe(4);
  const started = Date.now();
  await expect
    .poll(async () => (await state(sw)).index, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(5);
  const ms = Date.now() - started;
  test.info().annotations.push({ type: 'attach 25 MB', description: `${ms} ms` });
  expect(ms).toBeLessThan(15_000);
  await expect(page.getByRole('list', { name: 'Attached files' })).toContainText(
    `report.pdf (${25_000 * 1024} bytes, starts %PDF-)`,
  );
  await expect.poll(async () => (await state(sw)).status, { timeout: 30_000 }).toBe('done');
  await expect.poll(() => storedFiles(sw)).toBe(0);
});
