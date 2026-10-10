import type { Worker } from '@playwright/test';
import { expect, test } from './fixtures';

type Hook = {
  installSamples(): Promise<string[]>;
  store: {
    listGuides(): Promise<{ id: string; title: string }[]>;
    listSidecars(
      id: string,
      kind: string,
    ): Promise<{ user: string; data: Record<string, unknown> }[]>;
  };
  guidance: {
    current: { status: string; mode: string; index: number; guideId?: string };
    control(a: string): Promise<unknown>;
  };
  readMarks(): Promise<
    {
      kind: string;
      tone: string;
      text: { spans: { text: string }[] };
      guideId?: string;
      target?: unknown;
    }[]
  >;
};
declare const __trailmark: Hook;

const REPORT = 'Run a monthly report in Ledgerline';
const INVOICE = 'Create a supplier invoice in Ledgerline';

async function samples(sw: Worker): Promise<Record<string, string>> {
  return sw.evaluate(async () => {
    await __trailmark.installSamples();
    return Object.fromEntries((await __trailmark.store.listGuides()).map((g) => [g.title, g.id]));
  });
}

const guidance = (sw: Worker) => sw.evaluate(() => __trailmark.guidance.current);

test('notes, pins, Discover and the Guidance switch on a page', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  test.setTimeout(90_000);
  const ids = await samples(sw);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const page = await context.newPage();
  await page.goto('http://localhost:5173/reports.html');
  await page.bringToFront(); // the side panel follows the active tab

  // Discover: both sample guides were recorded on this site.
  const discover = panel.getByRole('region', { name: 'Guides for this site' });
  await expect(discover.getByRole('listitem')).toHaveCount(2);
  await expect(discover).toContainText(REPORT);

  // A note on the "Run report" button: pick it on the page, then write the note.
  await panel.getByRole('button', { name: 'Add a note' }).click();
  await expect(page.locator('trailmark-guide').getByRole('status')).toContainText(
    'Click an element',
  );
  await page.getByRole('button', { name: 'Run report' }).click();
  await panel.getByLabel('Kind').selectOption('warning');
  await panel.getByLabel('Note', { exact: true }).fill('Reports take **a minute** to run.');
  await panel.getByRole('button', { name: 'Save' }).click();
  const notes = panel.getByRole('region', { name: 'Notes and pins on this page' });
  await expect(notes).toContainText('Reports take a minute to run.');

  const badges = page.locator('trailmark-guide').locator('.badge');
  await expect(badges).toHaveCount(1);
  await badges.first().hover();
  const pop = page.locator('trailmark-guide').getByRole('dialog');
  await expect(pop).toContainText('Reports take a minute to run.');
  await expect(pop.locator('strong')).toHaveText('a minute');
  await page.screenshot({ path: test.info().outputPath('note.png') });
  await pop.getByRole('button', { name: 'Cancel' }).click();

  // A pin for the whole page that starts Guide Me.
  await panel.getByRole('button', { name: 'Pin a guide' }).click();
  await page.locator('trailmark-guide').getByRole('button', { name: 'Whole page' }).click();
  await panel.getByLabel('Guide', { exact: true }).selectOption({ label: REPORT });
  await panel.getByRole('button', { name: 'Save' }).click();
  await expect(badges).toHaveCount(2);
  const marks = await sw.evaluate(() => __trailmark.readMarks());
  expect(marks).toEqual([
    expect.objectContaining({ kind: 'note', tone: 'warning', target: expect.anything() }),
    expect.objectContaining({ kind: 'pin', guideId: ids[REPORT] }),
  ]);
  expect(marks[1]!.target).toBeUndefined();

  // Marks survive a reload, and the pin starts Guide Me.
  await page.reload();
  await expect(badges).toHaveCount(2);
  await page.locator('trailmark-guide').locator('.badge.pin').click();
  await page
    .locator('trailmark-guide')
    .getByRole('dialog')
    .getByRole('button', { name: 'Guide Me' })
    .click();
  await expect.poll(async () => (await guidance(sw)).status).toBe('active');
  expect((await guidance(sw)).guideId).toBe(ids[REPORT]);

  // The side panel shows the running guide with its steps.
  await expect(panel.getByRole('heading', { name: 'Guide Me' })).toBeVisible();
  await expect(panel.getByText('Step 2 of 3')).toBeVisible();
  await expect(panel.getByRole('list').getByRole('listitem')).toHaveCount(3);
  await panel.screenshot({ path: test.info().outputPath('sidepanel-guide-me.png') });
  await panel.getByRole('button', { name: 'Stop' }).click();
  await expect.poll(async () => (await guidance(sw)).status).toBe('idle');

  // The Guidance switch hides notes and pins on pages.
  await panel.getByRole('switch').uncheck();
  await expect(badges).toHaveCount(0);
  await expect(panel.getByRole('region', { name: 'Guides for this site' })).toHaveCount(0);
  await panel.getByRole('switch').check();
  await expect(badges).toHaveCount(2);

  // Delete the note from the list.
  await notes
    .getByRole('listitem')
    .filter({ hasText: 'Reports take' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(badges).toHaveCount(1);
});

test('reader: Guide Me button, comments, reactions, views and Insights', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  test.setTimeout(90_000);
  const ids = await samples(sw);
  const id = ids[REPORT]!;
  const lib = await context.newPage();
  const errors: string[] = [];
  lib.on('pageerror', (e) => errors.push(e.message));

  // Name used on comments.
  await lib.goto(`chrome-extension://${extensionId}/library.html`);
  await lib.getByRole('button', { name: 'Settings' }).click();
  await lib.getByLabel('Your name').fill('Priya Raman');
  await lib.getByRole('dialog').getByRole('button', { name: 'Save' }).click();

  await lib.goto(`chrome-extension://${extensionId}/library.html#/guide/${id}/view`);
  const steps = lib.locator('.tm-step');
  await expect(steps).toHaveCount(3);

  // Comment on step 1 and react at the end.
  await steps.first().getByRole('button', { name: 'Add a comment' }).click();
  await steps
    .first()
    .getByRole('textbox', { name: 'Add a comment' })
    .fill('Which period is the default?');
  await steps.first().getByRole('button', { name: 'Post' }).click();
  await expect(steps.first()).toContainText('Priya Raman (you)');
  await expect(steps.first().getByRole('button', { name: '1 comment' })).toBeVisible();
  const end = lib.getByRole('region', { name: 'Comments on this guide' });
  await end.getByRole('button', { name: 'React with 🎉' }).click();
  await expect(end.getByRole('button', { name: 'React with 🎉' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await lib.screenshot({ path: test.info().outputPath('comments.png'), fullPage: true });

  const comments = await sw.evaluate((g) => __trailmark.store.listSidecars(g, 'comments'), id);
  expect(comments).toEqual([
    {
      user: 'priya-raman',
      data: expect.objectContaining({
        author: 'Priya Raman',
        comments: [expect.objectContaining({ text: 'Which period is the default?' })],
        reactions: [{ blockId: 'end', emoji: '🎉' }],
      }),
    },
  ]);

  // Guide Me from the reader opens the guide's first page and starts guiding.
  await lib.getByRole('button', { name: 'Guide Me' }).click();
  await expect.poll(async () => (await guidance(sw)).status).toBe('active');
  await expect
    .poll(() =>
      context.pages().some((p) => p.url().startsWith('http://localhost:5173/reports.html')),
    )
    .toBe(true);
  await sw.evaluate(() => __trailmark.guidance.control('stop'));

  // Insights: one view and one Guide Me run for this guide.
  await lib.bringToFront();
  await lib.goto(`chrome-extension://${extensionId}/library.html#/insights`);
  const row = lib.getByRole('row').filter({ hasText: REPORT });
  await expect(row.getByRole('cell').nth(0)).toHaveText('1'); // views
  await expect(row.getByRole('cell').nth(1)).toHaveText('1'); // Guide Me runs
  await expect(row.getByRole('cell').nth(3)).toHaveText('0'); // completed
  await row.getByRole('button', { name: REPORT }).click();
  await expect(
    lib.getByRole('region', { name: `How far people got in “${REPORT}”` }),
  ).toContainText('Step 1: 1 run');
  await lib.screenshot({ path: test.info().outputPath('insights.png'), fullPage: true });
  expect(errors).toEqual([]);
  expect(ids[INVOICE]).toBeTruthy();
});

test('on-device AI tools appear only when available and enabled; they improve, summarise and translate', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  test.setTimeout(60_000);
  const ids = await samples(sw);
  // Stand-ins for Chrome's built-in AI (test Chromium has no on-device model).
  await context.addInitScript(() => {
    const ready = async () => 'available';
    Object.assign(globalThis, {
      LanguageModel: {
        availability: ready,
        create: async () => ({
          prompt: async (input: string) => {
            const step = /Step (\d+): (.*)$/.exec(input);
            return step?.[1] === '1' ? 'Choose **Last month** in **Period**' : (step?.[2] ?? '');
          },
          destroy() {},
        }),
      },
      Summarizer: {
        availability: ready,
        create: async () => ({ summarize: async () => 'Run last month’s report.', destroy() {} }),
      },
      Translator: {
        availability: ready,
        create: async () => ({ translate: async (t: string) => `[fr] ${t}`, destroy() {} }),
      },
    });
  });
  const lib = await context.newPage();
  const id = ids[REPORT]!;
  await lib.goto(`chrome-extension://${extensionId}/library.html#/guide/${id}`);
  await expect(lib.getByRole('textbox', { name: 'Step 1 title' })).toBeVisible();
  await expect(lib.getByRole('button', { name: 'AI', exact: true })).toHaveCount(0); // off by default

  await lib.goto(`chrome-extension://${extensionId}/library.html`);
  await lib.getByRole('button', { name: 'Settings' }).click();
  await lib.getByLabel('Use on-device AI').check();
  await lib.getByRole('dialog').getByRole('button', { name: 'Save' }).click();

  await lib.goto(`chrome-extension://${extensionId}/library.html#/guide/${id}`);
  await lib.getByRole('button', { name: 'AI', exact: true }).click();
  await lib.getByRole('menuitem', { name: 'Improve step text' }).click();
  const review = lib.getByRole('dialog', { name: 'Review suggestions' });
  await expect(review.getByRole('listitem')).toHaveCount(1);
  await review.getByRole('button', { name: 'Use all' }).click();
  await expect(lib.getByRole('textbox', { name: 'Step 1 title' })).toHaveText(
    'Choose Last month in Period',
  );

  await lib.getByRole('button', { name: 'AI', exact: true }).click();
  await lib.getByRole('menuitem', { name: 'Write a summary' }).click();
  await lib
    .getByRole('dialog', { name: 'Write a summary' })
    .getByRole('button', { name: 'Use' })
    .click();
  await expect(lib.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(
    'Run last month’s report.',
  );

  await lib.getByRole('button', { name: 'AI', exact: true }).click();
  await lib.getByRole('menuitem', { name: 'Translate…' }).click();
  await lib.getByLabel('Language').selectOption('fr');
  await lib.getByRole('button', { name: 'Translate as a copy' }).click();
  await expect(lib.getByRole('dialog').getByRole('status')).toContainText('Translated copy saved');
  const titles = await sw.evaluate(async () =>
    (await __trailmark.store.listGuides()).map((g) => g.title),
  );
  expect(titles).toContain(`[fr] ${REPORT}`);
  await lib.getByRole('button', { name: 'Open the copy' }).click();
  await expect(lib).not.toHaveURL(new RegExp(id));
  await expect(lib.getByRole('textbox', { name: 'Guide title' })).toHaveValue(`[fr] ${REPORT}`);
});
