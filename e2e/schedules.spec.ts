import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures';

type Target = {
  role?: string;
  name?: string;
  selectors: { type: string; value: string; score: number }[];
};
type Step = {
  id: string;
  kind: 'step';
  action: string;
  app: { kind: string; url: string; title?: string; frameUrl?: string };
  target?: Target;
  input?: { mode: string; value?: string; sensitive: boolean };
  human: { title: { spans: { text: string }[] } };
  agent: { confirm: boolean; expect?: unknown[] };
};
type Guide = { id: string; title: string; blocks: Step[] };
type RunLog = {
  id: string;
  outcome?: string;
  reason?: string;
  values: Record<string, string>;
  steps: { number: number; status: string; screenshot?: string }[];
};
type State = { status: string; phase: string; reason?: string; index: number; tabId?: number };
type Hook = {
  installSamples(): Promise<string[]>;
  store: {
    listGuides(): Promise<{ id: string; title: string }[]>;
    getGuide(id: string): Promise<Guide>;
    saveGuide(g: Guide): Promise<void>;
  };
  guidance: { current: State; control(a: string): Promise<State> };
  scheduler: {
    save(s: object): Promise<{ id: string }>;
    onAlarm(name: string): Promise<void>;
  };
  runLogs: {
    list(scheduleId: string): Promise<RunLog[]>;
    getShot(name: string): Promise<Blob | undefined>;
  };
  guideVersion(g: Guide): string;
};
declare const __showsteps: Hook;

const INVOICE = 'Create a supplier invoice in Ledgerline';
const IDP = 'http://127.0.0.1:5174/idp/';
const titleOf = (s: Step) => s.human.title.spans.map((x) => x.text).join('');

/**
 * The sample invoice guide with the username/password sign-in swapped for single sign-on through
 * the demo identity provider, so it can run unattended. The supplier is asked every run.
 * With `fromApp`, the guide starts on the app itself (a session that may have expired).
 */
async function scheduledGuide(sw: Worker, fromApp = false): Promise<{ id: string; steps: Step[] }> {
  return sw.evaluate(
    async ({ title, idp, fromApp }) => {
      await __showsteps.installSamples();
      const sampleId = (await __showsteps.store.listGuides()).find((g) => g.title === title)!.id;
      const sample = await __showsteps.store.getGuide(sampleId);
      const steps = sample.blocks.filter((b) => b.kind === 'step');
      const text = (s: Step) => s.human.title.spans.map((x) => x.text).join('');
      const open = structuredClone(steps[0]!);
      const signIn = steps.find((s) => text(s) === 'Click Sign in')!;
      const click = (id: string, label: string, target: Target, url: string): Step => ({
        ...structuredClone(signIn),
        id,
        app: { kind: 'web', url },
        // Only the box and point from the recorded step; the rest describes the new element.
        target: {
          bbox: structuredClone((signIn.target as unknown as { bbox: object }).bbox),
          point: structuredClone((signIn.target as unknown as { point: object }).point),
          ...target,
        } as Target,
        human: { ...structuredClone(signIn.human), title: { spans: [{ text: label }] } },
        agent: { ...structuredClone(signIn.agent), expect: [] },
      });
      const sso = click(
        'sso-link',
        'Click Use single sign-on',
        {
          role: 'link',
          name: 'Use single sign-on',
          selectors: [{ type: 'aria', value: 'link "Use single sign-on"', score: 0.9 }],
        },
        'http://localhost:5173/login.html',
      );
      const tile = click(
        'sso-tile',
        'Click Alex Demo',
        {
          role: 'button',
          name: 'Alex Demo alex@ledgerline.example',
          selectors: [
            { type: 'aria', value: 'button "Alex Demo alex@ledgerline.example"', score: 0.9 },
          ],
        },
        idp,
      );
      const work = steps.slice(steps.findIndex((s) => text(s) === 'Click New invoice'));
      const supplier = work.find((s) => s.target?.name === 'Supplier')!;
      supplier.input = { mode: 'ask', sensitive: false };
      const start = fromApp
        ? { ...open, id: 'open-app', app: { kind: 'web', url: 'http://localhost:5173/app/' } }
        : open;
      const guide: Guide = {
        ...structuredClone(sample),
        id: fromApp ? 'scheduled-app' : 'scheduled',
        title: fromApp ? 'Scheduled invoice (signed in)' : 'Scheduled invoice',
        blocks: fromApp ? [start, ...work] : [start, sso, tile, ...work],
      };
      await __showsteps.store.saveGuide(guide);
      return { id: guide.id, steps: guide.blocks };
    },
    { title: INVOICE, idp: IDP, fromApp },
  );
}

async function saveSchedule(
  sw: Worker,
  guideId: string,
  steps: Step[],
  over: { approve?: boolean; keepWindowOpen?: boolean } = {},
): Promise<string> {
  const supplier = steps.find((s) => s.target?.name === 'Supplier')!.id;
  const submit = steps.find((s) => titleOf(s) === 'Click Submit invoice')!.id;
  return sw.evaluate(
    async ({ guideId, supplier, submit, over }) => {
      const guide = await __showsteps.store.getGuide(guideId);
      const id = `sched-${Math.random().toString(36).slice(2)}`;
      await __showsteps.scheduler.save({
        id,
        guideId,
        name: guide.title,
        enabled: true,
        createdAt: new Date().toISOString(),
        guideVersion: 'stamped-on-save',
        recurrence: { kind: 'daily' },
        time: '09:00',
        skipDates: [],
        missedRun: 'run-at-start',
        values: { [supplier]: 'Saltbush {today}' },
        dateFormat: 'dd/MM/yyyy',
        approvedConfirmSteps: over.approve
          ? { guideVersion: __showsteps.guideVersion(guide), stepIds: [submit] }
          : { guideVersion: '', stepIds: [] },
        waitMinutes: 30,
        keepWindowOpen: over.keepWindowOpen ?? false,
        checkFirst: false,
      });
      return id;
    },
    { guideId, supplier, submit, over },
  );
}

/** Make the schedule due now (what its alarm does at the set time). */
const due = (sw: Worker, id: string) =>
  sw.evaluate((name) => __showsteps.scheduler.onAlarm(name), `schedule:${id}`);

const guidance = (sw: Worker) => sw.evaluate(() => __showsteps.guidance.current);
const logs = (sw: Worker, id: string) => sw.evaluate((s) => __showsteps.runLogs.list(s), id);
const windowCount = (sw: Worker) => sw.evaluate(async () => (await chrome.windows.getAll()).length);
const notifications = (sw: Worker) =>
  sw.evaluate(async () => Object.keys(await chrome.notifications.getAll()));

/** The run window's page (Playwright sees every window in the context). */
async function runPage(context: BrowserContext, url: RegExp): Promise<Page> {
  await expect
    .poll(() => context.pages().some((p) => url.test(p.url())), { timeout: 30_000 })
    .toBe(true);
  return context.pages().find((p) => url.test(p.url()))!;
}

/** Every logged step has a picture of its own in the run-log store. */
async function screenshotsStored(sw: Worker, log: RunLog): Promise<number[]> {
  return sw.evaluate(
    async (names) =>
      Promise.all(names.map(async (n) => (await __showsteps.runLogs.getShot(n))?.size ?? 0)),
    log.steps.map((s) => s.screenshot ?? 'none'),
  );
}

const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

test('a schedule runs the demo flow unattended in its own window and pauses at the confirm step', async ({
  context,
  serviceWorker: sw,
}) => {
  test.setTimeout(180_000);
  const { id: guideId, steps } = await scheduledGuide(sw);
  const id = await saveSchedule(sw, guideId, steps);
  const before = await windowCount(sw);
  await due(sw, id);

  // Its own window, not the test's.
  await expect.poll(() => windowCount(sw)).toBe(before + 1);
  const submitIndex = steps.findIndex((s) => titleOf(s) === 'Click Submit invoice');
  await expect.poll(async () => (await guidance(sw)).phase, { timeout: 120_000 }).toBe('confirm');
  expect((await guidance(sw)).index).toBe(submitIndex);

  // The recorded one-click sign-in replayed, and the scheduled value (with {today}) was typed.
  const page = await runPage(context, /\/app\/invoices\/new/);
  await expect(page.locator('#who')).toHaveText('Signed in as alex');
  await expect(page.getByRole('textbox', { name: 'Supplier' })).toHaveValue(`Saltbush ${today()}`);
  await expect(page.getByRole('heading', { name: 'Invoice submitted' })).toHaveCount(0);

  // The person is told.
  expect((await notifications(sw)).some((n) => n.startsWith(`ss|paused|${id}`))).toBe(true);

  // Nobody comes: the wait runs out and the run ends as stopped.
  const [running] = await logs(sw, id);
  await sw.evaluate((name) => __showsteps.scheduler.onAlarm(name), `wait:${running!.id}`);
  await expect.poll(async () => (await logs(sw, id))[0]?.outcome).toBe('stopped');
  const [log] = await logs(sw, id);
  expect(log!.reason).toBe('confirm');
  expect(log!.values).toEqual({
    [steps.find((s) => s.target?.name === 'Supplier')!.id]: `Saltbush ${today()}`,
  });
  expect(log!.steps.at(-1)).toMatchObject({ number: submitIndex + 1, status: 'stopped' });
  // A picture for every step, taken in the unfocused run window.
  const sizes = await screenshotsStored(sw, log!);
  expect(sizes.length).toBe(submitIndex + 1);
  for (const size of sizes) expect(size).toBeGreaterThan(5000);
  await expect.poll(() => windowCount(sw)).toBe(before);
  expect((await guidance(sw)).status).toBe('idle');
});

test('with the confirm step pre-approved it completes, and after a guide edit it pauses again', async ({
  context,
  serviceWorker: sw,
}) => {
  test.setTimeout(240_000);
  const { id: guideId, steps } = await scheduledGuide(sw);
  const id = await saveSchedule(sw, guideId, steps, { approve: true, keepWindowOpen: true });
  await due(sw, id);
  await expect
    .poll(async () => (await logs(sw, id))[0]?.outcome, { timeout: 150_000 })
    .toBe('completed');
  const [log] = await logs(sw, id);
  expect(log!.steps).toHaveLength(steps.length);
  expect(log!.steps.at(-1)).toMatchObject({ status: 'confirmed' });
  const page = await runPage(context, /\/app\//);
  await expect(page.getByRole('heading', { name: 'Invoice submitted' })).toBeVisible();
  await page.close();

  // Edit what a step types: approvals no longer apply, so Submit pauses again.
  await sw.evaluate(async (guideId) => {
    const g = await __showsteps.store.getGuide(guideId);
    const no = g.blocks.find((b) => b.target?.name === 'Invoice no.')!;
    no.input = { ...no.input!, value: 'INV-2000' };
    await __showsteps.store.saveGuide(g);
  }, guideId);
  await due(sw, id);
  await expect.poll(async () => (await guidance(sw)).phase, { timeout: 120_000 }).toBe('confirm');
  await sw.evaluate(() => __showsteps.guidance.control('stop'));
  await expect.poll(async () => (await logs(sw, id))[0]?.outcome).toBe('stopped');
});

test('an expired session stops the run for sign-in, and Continue finishes it', async ({
  context,
  serviceWorker: sw,
}) => {
  test.setTimeout(180_000);
  await context.addCookies([
    { name: 'demo_session', value: 'expired', url: 'http://localhost:5173' },
  ]);
  const { id: guideId, steps } = await scheduledGuide(sw, true);
  const id = await saveSchedule(sw, guideId, steps, { approve: true });
  await due(sw, id);

  await expect
    .poll(
      async () => {
        const g = await guidance(sw);
        return `${g.phase}:${g.reason ?? ''}`;
      },
      { timeout: 120_000 },
    )
    .toBe('failed:sign-in');
  expect((await notifications(sw)).some((n) => n.startsWith(`ss|paused|${id}`))).toBe(true);

  // The page says what to do; the person signs in (Run for me never types passwords).
  const idp = await runPage(context, /127\.0\.0\.1:5174\/idp\//);
  const banner = idp.locator('showsteps-guide .banner');
  await expect(banner).toContainText('Sign in, then press Continue.');
  await idp.getByLabel('Password').fill('not-a-real-password');
  await idp.getByRole('button', { name: 'Sign in' }).click();
  await idp.waitForURL(/localhost:5173\/app\//);

  // Continue from the side panel's control (the banner went with the sign-in page).
  await sw.evaluate(() => __showsteps.guidance.control('retry'));
  await expect
    .poll(async () => (await logs(sw, id))[0]?.outcome, { timeout: 120_000 })
    .toBe('completed');
});
