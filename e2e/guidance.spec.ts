import type { Frame, Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures';

type Step = {
  id: string;
  kind: 'step';
  action: string;
  input?: { value?: string; sensitive: boolean };
  human: { title: { spans: { text: string }[] } };
  agent: { confirm: boolean };
};
type Guide = { id: string; title: string; blocks: (Step | { kind: string; id: string })[] };
type State = {
  status: string;
  mode: string;
  index: number;
  total: number;
  phase: string;
  reason?: string;
};
type Hook = {
  installSamples(): Promise<string[]>;
  store: {
    listGuides(): Promise<{ id: string; title: string }[]>;
    getGuide(id: string): Promise<Guide>;
    saveGuide(g: Guide): Promise<void>;
    listSidecars(id: string, kind: string): Promise<{ user: string; data: { runs: unknown[] } }[]>;
  };
  guidance: { current: State; control(a: string): Promise<State> };
  startGuidance(msg: object): Promise<State>;
};
declare const __showsteps: Hook;

const INVOICE = 'Create a supplier invoice in Ledgerline';
const titleOf = (s: Step) => s.human.title.spans.map((x) => x.text).join('');

async function loadSample(
  sw: Worker,
  confirmSubmit = false,
): Promise<{ guide: Guide; steps: Step[] }> {
  const guide = await sw.evaluate(
    async ({ title, confirmSubmit }) => {
      await __showsteps.installSamples();
      const id = (await __showsteps.store.listGuides()).find((g) => g.title === title)!.id;
      const g = await __showsteps.store.getGuide(id);
      if (confirmSubmit) {
        const submit = g.blocks.find(
          (b) =>
            b.kind === 'step' &&
            (b as Step).human.title.spans.map((s) => s.text).join('') === 'Click Submit invoice',
        ) as Step;
        submit.agent.confirm = true;
        await __showsteps.store.saveGuide(g);
      }
      return g;
    },
    { title: INVOICE, confirmSubmit },
  );
  return { guide, steps: guide.blocks.filter((b): b is Step => b.kind === 'step') };
}

const state = (sw: Worker) => sw.evaluate(() => __showsteps.guidance.current);

async function tabIdOf(sw: Worker, url: string): Promise<number> {
  return sw.evaluate(async (u) => (await chrome.tabs.query({ url: `${u}*` }))[0]!.id!, url);
}

/** The highlight ring Guide Me draws, in whichever frame shows it, in page coordinates. */
async function ring(
  page: Page,
): Promise<{ frame: Frame; x: number; y: number; fx: number; fy: number } | null> {
  for (const frame of page.frames()) {
    const r = await frame
      .evaluate(() => {
        const ring = document.querySelector('showsteps-guide')?.shadowRoot?.querySelector('.ring');
        if (!ring || (ring as HTMLElement).hidden) return null;
        const b = ring.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      })
      .catch(() => null);
    if (!r) continue;
    let ox = 0;
    let oy = 0;
    const owner = await frame.frameElement().catch(() => null);
    if (owner && frame !== page.mainFrame()) {
      const box = await owner.boundingBox();
      ox = box?.x ?? 0;
      oy = box?.y ?? 0;
    }
    return { frame, x: r.x + ox, y: r.y + oy, fx: r.x, fy: r.y };
  }
  return null;
}

/** The element under the ring's centre in its frame, through shadow roots. */
function elementAt(frame: Frame, x: number, y: number) {
  return frame.evaluateHandle(
    ({ x, y }) => {
      let el = document.elementFromPoint(x, y);
      while (el?.shadowRoot) {
        const inner = el.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === el) break;
        el = inner;
      }
      return el;
    },
    { x, y },
  );
}

test('Guide Me: completes the demo invoice flow by acting on each highlighted target', async ({
  context,
  serviceWorker: sw,
}) => {
  test.setTimeout(180_000);
  const { guide, steps } = await loadSample(sw);
  const page = await context.newPage();
  await page.goto('http://localhost:5173/login.html');
  await page.bringToFront();
  const tabId = await tabIdOf(sw, 'http://localhost:5173/login.html');
  await sw.evaluate(
    ({ id, tabId }) =>
      __showsteps.startGuidance({ type: 'guide-start', guideId: id, mode: 'guide', tabId }),
    { id: guide.id, tabId },
  );

  // Step 1 ("Go to localhost:5173") is done already: the tab is on that page.
  await expect.poll(async () => (await state(sw)).index).toBe(1);

  for (let i = 1; i < steps.length; i++) {
    const step = steps[i]!;
    await expect
      .poll(async () => (await state(sw)).index, { message: `waiting for step ${i + 1}` })
      .toBe(i);
    await expect
      .poll(async () => (await state(sw)).phase, { message: `step ${i + 1} ${titleOf(step)}` })
      .toBe('showing');
    let at: Awaited<ReturnType<typeof ring>> = null;
    await expect
      .poll(async () => (at = await ring(page)), { message: `ring for step ${i + 1}` })
      .not.toBeNull();
    if (i === 1) await page.screenshot({ path: test.info().outputPath('guide-me.png') });
    if (i === 12) await page.screenshot({ path: test.info().outputPath('guide-me-12.png') });
    const el = await elementAt(at!.frame, at!.fx, at!.fy);
    switch (step.action) {
      case 'type':
        await el
          .asElement()!
          .fill(step.input?.sensitive ? 'not-a-real-password' : step.input!.value!);
        await el.asElement()!.press('Tab');
        break;
      case 'select':
        await el.asElement()!.selectOption({ label: step.input!.value! });
        break;
      default:
        await page.mouse.click(at!.x, at!.y);
    }
  }
  await expect.poll(async () => (await state(sw)).status).toBe('done');
  await expect(page.getByRole('heading', { name: 'Invoice submitted' })).toBeVisible();

  const runs = await sw.evaluate(
    async (id) =>
      (await __showsteps.store.listSidecars(id, 'analytics')).flatMap((s) => s.data.runs),
    guide.id,
  );
  expect(runs).toEqual([expect.objectContaining({ mode: 'guide', completed: true, total: 17 })]);
});

test('Run for me: does the flow, waits for the password and stops at the confirm step', async ({
  context,
  serviceWorker: sw,
}) => {
  test.setTimeout(180_000);
  const { guide, steps } = await loadSample(sw, true);
  const submitIndex = steps.findIndex((s) => titleOf(s) === 'Click Submit invoice');
  const passwordIndex = steps.findIndex((s) => s.input?.sensitive);
  const page = await context.newPage();
  await page.goto('http://localhost:5173/login.html');
  await page.bringToFront();
  const tabId = await tabIdOf(sw, 'http://localhost:5173/login.html');
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

  // Secrets are never stored: Run for me waits for the person to type the password.
  await expect.poll(async () => (await state(sw)).index, { timeout: 30_000 }).toBe(passwordIndex);
  await expect.poll(async () => (await state(sw)).phase).toBe('manual');
  expect((await state(sw)).reason).toBe('secret');
  await expect(page.getByLabel('Username')).toHaveValue('alex');
  // The card on the page is watching the field once it shows the step.
  await expect(page.locator('showsteps-guide').getByRole('dialog')).toContainText(
    'Enter your password',
  );
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByLabel('Password').press('Tab');

  // It carries on through both pages, the iframes and the shadow DOM, then stops to confirm.
  await expect.poll(async () => (await state(sw)).index, { timeout: 90_000 }).toBe(submitIndex);
  await expect.poll(async () => (await state(sw)).phase).toBe('confirm');
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Submit invoice' }),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('run-for-me-confirm.png') });
  expect(page.url()).not.toContain('/invoices/done');

  // Approve in the on-page card.
  const tip = page.locator('showsteps-guide').getByRole('dialog');
  await expect(tip).toContainText('Click Submit invoice');
  await tip.getByRole('button', { name: 'Do it', exact: true }).click();
  await expect.poll(async () => (await state(sw)).status, { timeout: 30_000 }).toBe('done');
  await expect(page.getByRole('heading', { name: 'Invoice submitted' })).toBeVisible();
  await expect(page.getByText('INV-1043').first()).toBeVisible();
});
