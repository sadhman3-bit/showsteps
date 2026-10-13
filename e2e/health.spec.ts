import type { Worker } from '@playwright/test';
import { expect, test } from './fixtures';

// U7 agent self-check and U9 guide health (re-capture a step that can no longer be found).

type Step = {
  id: string;
  kind: 'step';
  human: { title: { spans: { text: string }[] } };
  target?: {
    name?: string;
    text?: string;
    testId?: string;
    selectors: { type: string; value: string; score: number }[];
  };
  agent: { timeoutMs: number };
};
type Guide = { id: string; title: string; blocks: (Step | { kind: string; id: string })[] };
type State = { status: string; index: number; phase: string; reason?: string };
declare const __showsteps: {
  installSamples(): Promise<string[]>;
  store: {
    listGuides(): Promise<{ id: string; title: string }[]>;
    getGuide(id: string): Promise<Guide>;
    saveGuide(g: Guide): Promise<void>;
  };
  guidance: { current: State };
  startGuidance(msg: object): Promise<State>;
  recorder: { current: { status: string } };
};

const INVOICE = 'Create a supplier invoice in Ledgerline';
const titleOf = (s: Step) => s.human.title.spans.map((x) => x.text).join('');
const state = (sw: Worker) => sw.evaluate(() => __showsteps.guidance.current);

async function sampleId(sw: Worker): Promise<string> {
  return sw.evaluate(async (title) => {
    await __showsteps.installSamples();
    return (await __showsteps.store.listGuides()).find((g) => g.title === title)!.id;
  }, INVOICE);
}

test('self-check: a dry run finds each step’s element without acting (U7)', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  test.setTimeout(120_000);
  const id = await sampleId(sw);
  const editor = await context.newPage();
  await editor.goto(`chrome-extension://${extensionId}/library.html#/guide/${id}`);
  await editor.getByRole('button', { name: 'Agent', exact: true }).click();
  await editor.getByRole('button', { name: 'Check every step' }).click();
  const summary = editor.getByRole('region', { name: 'Check every step' }).getByRole('status');
  await expect(summary).toHaveText(/\d+ found/, { timeout: 90_000 });
  await editor.bringToFront();
  const step = (n: number, title: string) =>
    editor.getByRole('listitem', { name: `Step ${n}: ${title}` });
  await expect(step(2, 'Type alex into Username')).toContainText('Found by aria');
  // In an iframe and in shadow DOM.
  await expect(step(12, 'Select CC-110 Finance from Cost centre lookup')).toContainText('Found');
  await expect(step(15, 'Click Priya Raman')).toContainText('Found');
  // Only in the dialog that "Review invoice" opens: a dry run never clicks, so it stays closed.
  await expect(step(17, 'Click Submit invoice')).toContainText('Not found');
  // Nothing was done on the way: no invoice was submitted.
  const pages = context.pages().map((p) => p.url());
  expect(pages.some((u) => u.includes('/invoices/done'))).toBe(false);
  await editor.screenshot({ path: test.info().outputPath('self-check.png'), fullPage: true });
});

test('guide health: re-capture a step Guide Me cannot find, keeping the rest (U9)', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  test.setTimeout(120_000);
  const id = await sampleId(sw);
  // The app changed since recording: "New invoice" is no longer called that.
  const broken = await sw.evaluate(async (gid) => {
    const g = await __showsteps.store.getGuide(gid);
    const s = g.blocks.find(
      (b) =>
        b.kind === 'step' &&
        (b as Step).human.title.spans.map((x) => x.text).join('') === 'Click New invoice',
    ) as Step;
    s.target = {
      ...s.target!,
      // A different kind of control, elsewhere on the page.
      role: 'menuitem',
      tag: 'li',
      name: 'Create invoice',
      text: 'Create invoice',
      testId: 'create-invoice',
      bbox: { x: 20, y: 700, w: 80, h: 20 },
      point: { x: 60, y: 710 },
      selectors: [{ type: 'aria', value: 'button "Create invoice"', score: 0.9 }],
    };
    s.agent.timeoutMs = 1500;
    await __showsteps.store.saveGuide(g);
    return s.id;
  }, id);
  const before = (await sw.evaluate((gid) => __showsteps.store.getGuide(gid), id)).blocks.filter(
    (b): b is Step => b.kind === 'step',
  );
  const brokenIndex = before.findIndex((s) => s.id === broken);

  // Signed in, on the dashboard; Guide Me starts at the broken step.
  const page = await context.newPage();
  await page.goto('http://localhost:5173/login.html');
  await page.getByLabel('Username').fill('alex');
  await page.getByLabel('Password').fill('pw');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app\/$/);
  await page.bringToFront();
  const tabId = await sw.evaluate(
    async () => (await chrome.tabs.query({ url: 'http://localhost:5173/app/*' }))[0]!.id!,
  );
  await sw.evaluate(
    ([g, t, from]) =>
      __showsteps.startGuidance({ type: 'guide-start', guideId: g, mode: 'guide', tabId: t, from }),
    [id, tabId, brokenIndex] as const,
  );
  await expect.poll(async () => (await state(sw)).phase, { timeout: 20_000 }).toBe('not-found');

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Re-capture this step' }).click();
  await expect.poll(() => sw.evaluate(() => __showsteps.recorder.current.status)).toBe('recording');

  // Do the step for real; the capture ends by itself and the guide carries on.
  await page.bringToFront();
  await page.waitForTimeout(650);
  await page.getByRole('button', { name: 'New invoice' }).click({ delay: 120 });
  await expect
    .poll(() => sw.evaluate(() => __showsteps.recorder.current.status), { timeout: 10_000 })
    .toBe('idle');
  await expect.poll(async () => (await state(sw)).status, { timeout: 15_000 }).toBe('active');
  expect((await state(sw)).index).toBe(brokenIndex + 1);

  const after = (await sw.evaluate((gid) => __showsteps.store.getGuide(gid), id)).blocks.filter(
    (b): b is Step => b.kind === 'step',
  );
  expect(after.map(titleOf)).toEqual(before.map(titleOf));
  expect(after.some((s) => s.id === broken)).toBe(false);
  expect(after[brokenIndex]!.target?.name).toBe('New invoice');
});
