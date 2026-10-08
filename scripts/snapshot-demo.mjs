// Captures DOM snapshots of the demo app for the matcher tests in packages/core.
// Each page is loaded twice ("a" and "b"); the demo scrambles IDs and classes on every load,
// so tests can describe an element in "a" and prove the matcher finds it again in "b".
// Ground-truth elements carry data-tm-truth; every element carries data-tm-rect (real layout).
// Run: pnpm snapshot:demo (sets PLAYWRIGHT_BROWSERS_PATH itself; needs pnpm setup:browsers once).
process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

const { mkdirSync, writeFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const { chromium } = await import('@playwright/test');
const { startDemoApp } = await import('../fixtures/demo-app/server.mjs');

const OUT = fileURLToPath(new URL('../packages/core/test/fixtures/demo/', import.meta.url));
mkdirSync(OUT, { recursive: true });

/** Serialises the document (or a frame) with shadow roots as <template data-tm-shadow>. */
function serialise() {
  const VOID = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'source',
    'track',
    'wbr',
  ]);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
  const walk = (node) => {
    if (node.nodeType === 3) return esc(node.textContent);
    if (node.nodeType !== 1) return '';
    const tag = node.localName;
    if (tag === 'script' || tag === 'link' || tag === 'style') return '';
    const r = node.getBoundingClientRect();
    node.setAttribute(
      'data-tm-rect',
      [r.x, r.y, r.width, r.height].map((n) => Math.round(n)).join(','),
    );
    const attrs = Array.from(node.attributes)
      .map((a) => ` ${a.name}="${escAttr(a.value)}"`)
      .join('');
    if (VOID.has(tag)) return `<${tag}${attrs}>`;
    let inner = '';
    if (node.shadowRoot) {
      inner += `<template data-tm-shadow>${Array.from(node.shadowRoot.childNodes).map(walk).join('')}</template>`;
    }
    const kids = tag === 'template' ? node.content.childNodes : node.childNodes;
    inner += Array.from(kids).map(walk).join('');
    return `<${tag}${attrs}>${inner}</${tag}>`;
  };
  // Runs inside the page (via evaluate), where `document` is the page's document.
  return '<!doctype html>\n' + walk(globalThis.document.documentElement);
}

async function mark(locator, key) {
  await locator.evaluate((el, k) => el.setAttribute('data-tm-truth', k), key);
}

async function save(target, name) {
  const html = await target.evaluate(serialise);
  writeFileSync(`${OUT}${name}.html`, html);
}

const app = await startDemoApp({ port: 0, xoriginPort: 0 });
const browser = await chromium.launch();
try {
  for (const run of ['a', 'b']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${app.url}/login.html`);
    await mark(page.getByLabel('Username'), 'username');
    await mark(page.getByLabel('Password'), 'password');
    await mark(page.getByRole('button', { name: 'Sign in' }), 'sign-in');
    await save(page, `login.${run}`);

    await page.getByLabel('Username').fill('alex');
    await page.getByLabel('Password').fill('demo');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('cell', { name: 'INV-1042' }).waitFor();
    await mark(page.getByTestId('new-invoice'), 'new-invoice');
    await mark(page.getByRole('link', { name: 'Reports' }), 'reports-link');
    await mark(page.getByRole('link', { name: 'New invoice' }), 'new-invoice-link');
    await mark(page.getByRole('cell', { name: 'INV-1042' }), 'cell-inv-1042');
    await mark(page.getByRole('cell', { name: '4111 1111 1111 1111' }), 'card-on-file');
    await save(page, `dashboard.${run}`);

    await page.getByTestId('new-invoice').click();
    await page.getByLabel('Supplier').waitFor();
    const truths = {
      supplier: page.getByLabel('Supplier'),
      'invoice-no': page.getByLabel('Invoice no.'),
      amount: page.getByLabel('Amount'),
      currency: page.getByLabel('Currency'),
      'invoice-date': page.getByLabel('Invoice date'),
      gst: page.getByLabel('Includes GST'),
      urgent: page.getByLabel('Urgent'),
      cheque: page.getByLabel('Cheque'),
      attach: page.getByLabel('Attach invoice PDF'),
      'cost-centre': page.getByLabel('Cost centre', { exact: true }),
      'approver-search': page.getByRole('searchbox', { name: 'Search approvers' }),
      'approver-mei': page.getByRole('button', { name: 'Mei Chen' }),
      review: page.getByRole('button', { name: 'Review invoice' }),
    };
    for (const [key, loc] of Object.entries(truths)) await mark(loc, key);
    await save(page, `new-invoice.${run}`);

    const notes = page.frameLocator('iframe[title="Internal note"]');
    await mark(notes.getByLabel('Note for approver'), 'note');
    const notesFrame = page.frames().find((f) => f.url().endsWith('/frames/notes.html'));
    await save(notesFrame, `frame-notes.${run}`);

    const widget = page.frameLocator('iframe[title="Cost centre lookup"]');
    await mark(widget.getByLabel('Cost centre lookup'), 'cc-select');
    await mark(widget.getByRole('button', { name: 'Use this cost centre' }), 'cc-use');
    const widgetFrame = page.frames().find((f) => f.url().endsWith('/widget.html'));
    await save(widgetFrame, `frame-widget.${run}`);

    await page.getByLabel('Supplier').fill('Harbour Paper Co.');
    await page.getByRole('button', { name: 'Review invoice' }).click();
    const dialog = page.getByRole('dialog', { name: 'Review invoice' });
    await mark(dialog.getByRole('button', { name: 'Submit invoice' }), 'submit-invoice');
    await mark(dialog.getByRole('button', { name: 'Back to edit' }), 'back-to-edit');
    await save(page, `review.${run}`);
    await page.close();
  }
  console.log(`Snapshots written to ${OUT}`);
} finally {
  await browser.close();
  await app.close();
}
