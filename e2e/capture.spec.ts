import { writeFileSync } from 'node:fs';
import type { Page, Worker } from '@playwright/test';
import { expect, test } from './fixtures';

// M2 acceptance: record the demo app's "create invoice" flow and check the steps.

type Hook = {
  startCapture(msg: { type: 'start'; tabId: number }): Promise<{ guideId?: string }>;
  store: { getGuide(id: string): Promise<unknown>; listImages(id: string): Promise<string[]> };
};
declare const __showsteps: Hook;

/** A human-like pause, so screenshots are not skipped by Chrome's 2-per-second limit. */
const human = (page: Page) => page.waitForTimeout(650);

async function startOn(sw: Worker, url: string) {
  const tabId = await sw.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: `${u}*` });
    return tab?.id ?? -1;
  }, url);
  return sw.evaluate((id) => __showsteps.startCapture({ type: 'start', tabId: id }), tabId);
}

type StoredStep = {
  kind: 'step';
  id: string;
  action: string;
  human: {
    title: { spans: { text: string; bold?: boolean }[] };
    screenshot?: { file: string; width: number; height: number; reusedFromStepId?: string };
    actionBox?: { x: number; y: number; w: number; h: number };
  };
  target?: { frames?: string[]; shadowHosts?: string[] };
  input?: { value?: string; sensitive: boolean };
};

const md = (s: StoredStep) =>
  s.human.title.spans.map((x) => (x.bold ? `**${x.text}**` : x.text)).join('');

test('records the create-invoice flow across pages, iframes, shadow DOM and a dialog', async ({
  context,
  serviceWorker,
}) => {
  test.setTimeout(90_000);
  const page = await context.newPage();
  await page.goto('http://localhost:5173/login.html');
  await page.bringToFront();

  const { guideId } = await startOn(serviceWorker, 'http://localhost:5173/');
  expect(guideId).toBeTruthy();
  const controller = page.locator('showsteps-controller');
  await expect(
    controller.getByRole('toolbar', { name: 'ShowSteps capture controls' }),
  ).toBeVisible();
  await human(page);

  // Page 1: login (full page load afterwards)
  await page.getByLabel('Username').fill('alex');
  await human(page);
  await page.getByLabel('Password').fill('not-a-real-password');
  await human(page);
  await page.getByRole('button', { name: 'Sign in' }).click({ delay: 120 });
  await expect(page).toHaveURL(/\/app\/$/);
  await expect(controller.getByRole('toolbar')).toBeVisible();
  await human(page);

  // Page 2: the SPA
  await page.getByTestId('new-invoice').click({ delay: 120 });
  await human(page);
  await page.getByLabel('Supplier').fill('Harbour Paper Co.');
  await human(page);
  await page.getByLabel('Invoice no.').fill('INV-1043');
  await human(page);
  await page.getByLabel('Amount').fill('1280.50');
  await human(page);
  await page.getByLabel('Currency').selectOption('NZD');
  await human(page);
  await page.getByLabel('Invoice date').fill('2026-10-01');
  await human(page);
  await page.getByLabel('Includes GST').check();
  await human(page);
  await page.getByLabel('Cheque').check();
  await human(page);
  await page.getByLabel('Attach invoice PDF').setInputFiles({
    name: 'invoice.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 demo'),
  });
  await human(page);

  // Cross-origin iframe
  const widget = page.frameLocator('iframe[title="Cost centre lookup"]');
  await widget.getByLabel('Cost centre lookup').selectOption('CC-220 Operations');
  await human(page);
  await widget.getByRole('button', { name: 'Use this cost centre' }).click({ delay: 120 });
  await human(page);

  // Same-origin iframe
  await page
    .frameLocator('iframe[title="Internal note"]')
    .getByLabel('Note for approver')
    .fill('Please approve by Friday.');
  await human(page);

  // Shadow DOM
  await page.getByRole('searchbox', { name: 'Search approvers' }).fill('mei');
  await human(page);
  await page.getByRole('button', { name: 'Mei Chen' }).click({ delay: 120 });
  await human(page);

  // Dialog with the irreversible action
  // The press lasts long enough for Chrome to take the picture on a busy machine (it can take
  // 300 ms there); the dialog opens on release.
  await page.getByRole('button', { name: 'Review invoice' }).click({ delay: 600 });
  await human(page);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Submit invoice' })
    .click({ delay: 120 });
  await expect(page).toHaveURL(/\/invoices\/done$/);
  await human(page);

  await controller.getByRole('button', { name: 'Finish' }).click();
  await expect(controller).toHaveCount(0);

  const guide = (await serviceWorker.evaluate(
    (id) => __showsteps.store.getGuide(id),
    guideId!,
  )) as {
    blocks: StoredStep[];
  };
  const steps = guide.blocks.filter((b) => b.kind === 'step');
  expect(steps.map(md)).toEqual([
    'Go to **localhost:5173**',
    'Type **alex** into **Username**',
    'Enter your password',
    'Click **Sign in**',
    'Click **New invoice**',
    'Type **Harbour Paper Co.** into **Supplier**',
    'Type **INV-1043** into **Invoice no.**',
    'Type **1280.50** into **Amount**',
    'Select **NZD** from **Currency**',
    'Type **2026-10-01** into **Invoice date**',
    'Check **Includes GST**',
    'Select **Cheque**',
    'Upload **invoice.pdf**',
    'Select **CC-220 Operations** from **Cost centre lookup**',
    'Click **Use this cost centre**',
    'Type **Please approve by Friday.** into **Note for approver**',
    'Type **mei** into **Search approvers**',
    'Click **Mei Chen**',
    'Click **Review invoice**',
    'Click **Submit invoice**',
  ]);

  // Secrets never stored.
  expect(JSON.stringify(guide)).not.toContain('not-a-real-password');
  expect(steps[2]!.input).toEqual({ mode: 'fixed', sensitive: true });

  // Every step has a screenshot; most are fresh; Action Boxes lie inside their images.
  const images = await serviceWorker.evaluate((id) => __showsteps.store.listImages(id), guideId!);
  let fresh = 0;
  for (const s of steps) {
    const shot = s.human.screenshot;
    expect(shot, md(s)).toBeDefined();
    expect(images).toContain(shot!.file.replace(/^img\//, ''));
    if (!shot!.reusedFromStepId) fresh++;
    const box = s.human.actionBox;
    if (box) {
      expect(box.x + box.w).toBeLessThanOrEqual(shot!.width);
      expect(box.y + box.h).toBeLessThanOrEqual(shot!.height);
    }
  }
  // A skipped capture (Chrome allows two per second) reuses the previous step's image, which
  // was taken at the same moment: e.g. typing committed by the click that follows it.
  for (const [i, s] of steps.entries()) {
    const from = s.human.screenshot?.reusedFromStepId;
    if (!from) continue;
    const source = steps.findIndex((x) => x.id === from);
    expect(source, md(s)).toBeGreaterThanOrEqual(0);
    expect(source).toBeLessThan(i);
    expect(steps[source]!.human.screenshot?.reusedFromStepId).toBeUndefined();
    expect(s.human.screenshot?.file).toBe(steps[source]!.human.screenshot?.file);
  }
  expect(fresh).toBeGreaterThanOrEqual(10);

  // Iframe and shadow DOM targets carry their context.
  const byTitle = (t: string) => steps.find((s) => md(s).includes(t))!;
  expect(byTitle('Use this cost centre').target?.frames).toEqual([
    'iframe[title="Cost centre lookup"]',
  ]);
  expect(byTitle('Note for approver').target?.frames).toEqual(['iframe[title="Internal note"]']);
  expect(byTitle('Mei Chen').target?.shadowHosts).toEqual(['ss-approver-picker']);

  // Iframe targets were shifted into the top frame: the iframe sits below the form fields, so
  // its button cannot be at the iframe-local origin.
  const useBtn = byTitle('Use this cost centre') as StoredStep & {
    target: { bbox: { x: number; y: number } };
  };
  expect(useBtn.target.bbox.x).toBeGreaterThan(20);

  // The sign-in click loads a new page at once: its screenshot must still show the sign-in form,
  // so the pixel under its highlight is the blue "Sign in" button.
  const signIn = byTitle('Click **Sign in**');
  const centre = await serviceWorker.evaluate(
    async ({ id, file, box }) => {
      const store = __showsteps.store as unknown as {
        getImage(g: string, n: string): Promise<Uint8Array>;
      };
      const bytes = await store.getImage(id, file.replace(/^img\//, ''));
      const bmp = await createImageBitmap(new Blob([bytes]));
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      // Just inside the box corner: the button background, away from its white label.
      return Array.from(ctx.getImageData(box.x + 10, box.y + 10, 1, 1).data);
    },
    { id: guideId!, file: signIn.human.screenshot!.file, box: signIn.human.actionBox! },
  );
  expect(centre[2]! - centre[0]!, 'sign-in screenshot should show the blue button').toBeGreaterThan(
    60,
  );

  // The capture toolbar (dark, bottom-right) never appears in a screenshot.
  const corners = await serviceWorker.evaluate(
    async ({ id, files }) => {
      const store = __showsteps.store as unknown as {
        getImage(g: string, n: string): Promise<Uint8Array>;
      };
      const out: number[] = [];
      for (const f of files) {
        const bmp = await createImageBitmap(new Blob([await store.getImage(id, f.slice(4))]));
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        const [r = 0, g = 0, b = 0] = ctx.getImageData(bmp.width - 60, bmp.height - 30, 1, 1).data;
        out.push(Math.round((r + g + b) / 3));
      }
      return out;
    },
    { id: guideId!, files: [...new Set(steps.map((s) => s.human.screenshot!.file))] },
  );
  for (const brightness of corners)
    expect(brightness, 'toolbar visible in a screenshot').toBeGreaterThan(100);

  // Keep one screenshot with its Action Box drawn on it, for a human to eyeball in the report.
  const review = byTitle('Review invoice');
  const { png, brightness } = await serviceWorker.evaluate(
    async ({ id, file, box }) => {
      const store = __showsteps.store as unknown as {
        getImage(g: string, n: string): Promise<Uint8Array>;
      };
      const bytes = await store.getImage(id, file.replace(/^img\//, ''));
      const bmp = await createImageBitmap(new Blob([bytes]));
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      // Brightness of the page margin, left of the form: a modal backdrop would darken it.
      const [r = 0, g = 0, b = 0] = ctx.getImageData(60, 400, 1, 1).data;
      const brightness = (r + g + b) / 3;
      ctx.strokeStyle = '#c2410c';
      ctx.lineWidth = 4;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return { png: Array.from(new Uint8Array(await blob.arrayBuffer())), brightness };
    },
    { id: guideId!, file: review.human.screenshot!.file, box: review.human.actionBox! },
  );
  writeFileSync(test.info().outputPath('review-step.png'), Buffer.from(png));
  // Taken on pointerdown, before the click opened the dialog (no dark backdrop yet).
  expect(brightness, 'review screenshot taken after the dialog opened').toBeGreaterThan(220);
});

type SecretsHook = {
  store: {
    getGuide(id: string): Promise<{ blocks: (StoredStep & { human: { blurs: unknown[] } })[] }>;
    listImages(id: string): Promise<string[]>;
    getImage(id: string, name: string): Promise<Uint8Array | undefined>;
  };
  recorder: { control(a: string): Promise<unknown>; current: { stepCount: number } };
};

test('a revealed password stays out of the guide, its page text and its pictures (H6)', async ({
  context,
  serviceWorker: sw,
}) => {
  test.setTimeout(90_000);
  const SECRET = 'reveal-me-9271';
  const page = await context.newPage();
  await page.goto('http://localhost:5173/login.html');
  // Only `type="password"` says this field is secret: no autocomplete, and a name and label
  // that don't (so the name test can't be what catches it).
  await page.evaluate(() => {
    const f = document.querySelector<HTMLInputElement>('input[type="password"]')!;
    f.removeAttribute('autocomplete');
    f.name = 'memorable';
    f.labels![0]!.textContent = 'Memorable word';
  });
  await page.bringToFront();
  const { guideId } = await startOn(sw, 'http://localhost:5173/');
  await page.locator('showsteps-controller').getByRole('toolbar').waitFor();
  await human(page);
  await page.getByLabel('Username').fill('alex');
  await human(page);
  await page.getByLabel('Memorable word').fill(SECRET);
  await human(page);
  await page.getByRole('button', { name: 'Show password' }).click({ delay: 80 });
  const shownField = page.getByRole('textbox', { name: 'Memorable word' });
  await expect(shownField).toHaveValue(SECRET);
  await human(page);
  // Typing more into the now plain text field is still secret.
  await shownField.press('End');
  await shownField.pressSequentially('X');
  await human(page);
  // A click on the same page: its picture shows the revealed field.
  await page.getByRole('heading', { name: 'Sign in' }).click({ delay: 80 });
  await human(page);
  await page.getByRole('button', { name: 'Sign in' }).click({ delay: 120 });
  await page.waitForURL(/\/app\/$/);
  await human(page);
  await expect
    .poll(
      () =>
        sw.evaluate(
          () =>
            (globalThis as unknown as { __showsteps: SecretsHook }).__showsteps.recorder.current
              .stepCount,
        ),
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(5);
  await sw.evaluate(() =>
    (globalThis as unknown as { __showsteps: SecretsHook }).__showsteps.recorder.control('finish'),
  );

  const { guide, words } = await sw.evaluate(async (id) => {
    const h = (globalThis as unknown as { __showsteps: SecretsHook }).__showsteps;
    const g = await h.store.getGuide(id);
    const names = (await h.store.listImages(id)).filter((n) => n.endsWith('.words.json'));
    const words: string[] = [];
    for (const n of names) {
      const b = await h.store.getImage(id, n);
      if (b) words.push(new TextDecoder().decode(b));
    }
    return { guide: g, words };
  }, guideId!);
  expect(JSON.stringify(guide)).not.toContain(SECRET);
  expect(JSON.stringify(guide)).not.toContain(`${SECRET}X`);
  expect(words.length).toBeGreaterThan(0);
  for (const w of words) expect(w).not.toContain(SECRET);
  // The picture taken while the password showed has a blur over the field.
  const heading = guide.blocks.find(
    (b) => b.kind === 'step' && (b.target as { role?: string } | undefined)?.role === 'heading',
  )!;
  // (Its picture may be the one taken a moment earlier for the typing: the blur comes with it.)
  expect(heading.human.screenshot).toBeTruthy();
  expect(heading.human.blurs.length).toBeGreaterThan(0);
});

test('a step the page’s script made is marked, and the editor offers Delete or Keep (H6)', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  test.setTimeout(60_000);
  const page = await context.newPage();
  await page.goto('http://localhost:5173/login.html');
  await page.bringToFront();
  const { guideId } = await startOn(sw, 'http://localhost:5173/');
  await page.locator('showsteps-controller').getByRole('toolbar').waitFor();
  await human(page);
  // A script sets a value and raises "change" (isTrusted is false).
  await page.evaluate(() => {
    const f = document.querySelector<HTMLInputElement>('input[name="username"]')!;
    f.value = 'planted';
    f.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await human(page);
  await expect
    .poll(() =>
      sw.evaluate(
        () =>
          (globalThis as unknown as { __showsteps: SecretsHook }).__showsteps.recorder.current
            .stepCount,
      ),
    )
    .toBeGreaterThanOrEqual(2);
  await sw.evaluate(() =>
    (globalThis as unknown as { __showsteps: SecretsHook }).__showsteps.recorder.control('finish'),
  );
  const guide = await sw.evaluate(
    (id) => (globalThis as unknown as { __showsteps: SecretsHook }).__showsteps.store.getGuide(id),
    guideId!,
  );
  const typed = guide.blocks.find((b) => b.kind === 'step' && b.action === 'type') as unknown as {
    capture: { byPage?: boolean };
  };
  expect(typed.capture.byPage).toBe(true);

  const editor = await context.newPage();
  await editor.goto(`chrome-extension://${extensionId}/library.html#/guide/${guideId}`);
  const note = editor
    .getByRole('note')
    .filter({ hasText: 'This step came from the page, not from you.' });
  await expect(note).toBeVisible();
  await note.getByRole('button', { name: 'Keep' }).click();
  await expect(note).toHaveCount(0);
});
