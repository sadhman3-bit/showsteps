// Builds the two sample guides that ship with ABCXYZ (apps/extension/public/samples/).
// Records real flows in the demo app with the e2e extension build, then adds sections, tips
// and descriptions with the same core editing operations the editor uses.
// Run: pnpm make:samples (after pnpm build and pnpm setup:browsers). Output is committed.
process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const { chromium } = await import('@playwright/test');
const { zipSync, strToU8 } = await import('fflate');
const core = await import('@trailmark/core');
const { startDemoApp } = await import('../fixtures/demo-app/server.mjs');

const EXT = fileURLToPath(new URL('../apps/extension/.output/chrome-mv3-e2e', import.meta.url));
const OUT = fileURLToPath(new URL('../apps/extension/public/samples/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const pause = (page) => page.waitForTimeout(700);

async function record(context, sw, url, actions) {
  const page = await context.newPage();
  await page.goto(url);
  await page.bringToFront();
  const tabId = await sw.evaluate(
    async (u) => (await globalThis.chrome.tabs.query({ url: `${u}*` }))[0]?.id,
    url.split('?')[0],
  );
  const { guideId } = await sw.evaluate(
    (id) => globalThis.__trailmark.startCapture({ type: 'start', tabId: id }),
    tabId,
  );
  await page.locator('trailmark-controller').getByRole('toolbar').waitFor();
  await pause(page);
  const expected = await actions(page);
  for (let i = 0; i < 50; i++) {
    const n = await sw.evaluate(() => globalThis.__trailmark.recorder.current.stepCount);
    if (n >= expected) break;
    await page.waitForTimeout(200);
  }
  await sw.evaluate(() => globalThis.__trailmark.recorder.control('finish'));
  await page.close();
  const guide = await sw.evaluate((id) => globalThis.__trailmark.store.getGuide(id), guideId);
  const names = await sw.evaluate((id) => globalThis.__trailmark.store.listImages(id), guideId);
  const images = {};
  for (const name of names) {
    images[name] = new Uint8Array(
      await sw.evaluate(
        async ({ id, n }) => Array.from(await globalThis.__trailmark.store.getImage(id, n)),
        { id: guideId, n: name },
      ),
    );
  }
  return { guide: core.parseGuide(guide), images };
}

/** Find a step by its plain-text title (prefix). */
function stepId(guide, startsWith) {
  const s = guide.blocks.find(
    (b) => b.kind === 'step' && core.toPlainText(b.human.title).startsWith(startsWith),
  );
  if (!s) throw new Error(`No step "${startsWith}" in ${guide.title}`);
  return s.id;
}

function describe(guide, startsWith, text) {
  return core.updateStep(guide, stepId(guide, startsWith), (s) => ({
    ...s,
    human: { ...s.human, description: core.plain(text) },
  }));
}

function archive(guide, images, file) {
  const zip = zipSync(
    { 'guide.json': strToU8(core.serializeGuide(guide)), img: images },
    { level: 0 },
  );
  writeFileSync(`${OUT}${file}`, zip);
  console.log(`Wrote ${file}: ${guide.blocks.length} blocks, ${Object.keys(images).length} images`);
}

const app = await startDemoApp({ port: 5173, xoriginPort: 5174 });
const profile = mkdtempSync(join(tmpdir(), 'trailmark-samples-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
try {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));

  // ---------- Sample 1: create an invoice ----------
  let { guide, images } = await record(
    context,
    sw,
    'http://localhost:5173/login.html',
    async (page) => {
      await page.getByLabel('Username').fill('alex');
      await pause(page);
      await page.getByLabel('Password').fill('sample-password');
      await pause(page);
      await page.getByRole('button', { name: 'Sign in' }).click({ delay: 150 });
      await page.getByRole('cell', { name: 'INV-1042' }).waitFor();
      await pause(page);
      await page.getByTestId('new-invoice').click({ delay: 150 });
      await pause(page);
      await page.getByLabel('Supplier').fill('Harbour Paper Co.');
      await pause(page);
      await page.getByLabel('Invoice no.').fill('INV-1043');
      await pause(page);
      await page.getByLabel('Amount').fill('1280.50');
      await pause(page);
      await page.getByLabel('Currency').selectOption('AUD');
      await pause(page);
      await page.getByLabel('Invoice date').fill('2026-10-01');
      await pause(page);
      await page.getByLabel('Includes GST').check();
      await pause(page);
      const widget = page.frameLocator('iframe[title="Cost centre lookup"]');
      await widget.getByLabel('Cost centre lookup').selectOption('CC-110 Finance');
      await pause(page);
      await widget.getByRole('button', { name: 'Use this cost centre' }).click({ delay: 150 });
      await pause(page);
      await page.getByRole('searchbox', { name: 'Search approvers' }).fill('priya');
      await pause(page);
      await page.getByRole('button', { name: 'Priya Raman' }).click({ delay: 150 });
      await pause(page);
      await page.getByRole('button', { name: 'Review invoice' }).click({ delay: 150 });
      await pause(page);
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Submit invoice' })
        .click({ delay: 150 });
      await page.waitForURL(/invoices\/done/);
      await pause(page);
      return 16;
    },
  );
  guide = { ...guide, title: 'Create a supplier invoice in Ledgerline' };
  guide.description =
    'Enter a supplier invoice and send it for approval. A sample made from the ABCXYZ demo app.';
  guide.tags = ['sample', 'accounts payable'];
  guide.preconditions = ['You have a Ledgerline account'];
  guide.success = 'The page says “Invoice submitted” with the invoice number.';
  guide = core.insertHeading(guide, null, 'Sign in').guide;
  guide = core.insertHeading(guide, stepId(guide, 'Click Sign in'), 'Enter the invoice').guide;
  guide = core.insertCallout(
    guide,
    stepId(guide, 'Type 1280.50'),
    'tip',
    'Enter the amount including GST, as printed on the invoice.',
  ).guide;
  guide = core.insertHeading(guide, stepId(guide, 'Click Priya Raman'), 'Send for approval').guide;
  guide = core.insertCallout(
    guide,
    stepId(guide, 'Click Review invoice'),
    'warning',
    'Submitting cannot be undone. Check the supplier, amount and approver first.',
  ).guide;
  guide = describe(guide, 'Type alex', 'Use your own Ledgerline username.');
  guide = describe(
    guide,
    'Select CC-110 Finance',
    'The cost centre list comes from the finance system.',
  );
  guide = describe(guide, 'Click Submit invoice', 'The invoice goes to the approver you chose.');
  archive(guide, images, 'create-invoice.trailmark');

  // ---------- Sample 2: run a report ----------
  ({ guide, images } = await record(
    context,
    sw,
    'http://localhost:5173/reports.html',
    async (page) => {
      await page.getByLabel('Period').selectOption('Last month');
      await pause(page);
      await page.getByRole('button', { name: 'Run report' }).click({ delay: 150 });
      await pause(page);
      return 3;
    },
  ));
  guide = { ...guide, title: 'Run a monthly report in Ledgerline' };
  guide.description = 'Produce last month’s report. A short sample made from the ABCXYZ demo app.';
  guide.tags = ['sample', 'reports'];
  guide = core.insertCallout(guide, null, 'note', 'Reports cover whole calendar months.').guide;
  guide = describe(
    guide,
    'Select Last month',
    'Choose “This quarter” for quarterly reporting instead.',
  );
  archive(guide, images, 'monthly-report.trailmark');
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
  await app.close();
}
