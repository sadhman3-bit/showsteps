import type { Page, Worker } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import mammoth from 'mammoth';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildStartLink, type Guide } from '@showsteps/core';
import { expect, test } from './fixtures';

type Rect = { x: number; y: number; w: number; h: number };
type StoredGuide = {
  id: string;
  title: string;
  blocks: {
    id: string;
    kind: string;
    human?: {
      title: { spans: { text: string }[] };
      blurs: Rect[];
      screenshot?: { file: string; width: number; height: number; crop?: Rect; zoom?: number };
    };
  }[];
};
type Hook = {
  installSamples(): Promise<string[]>;
  store: {
    getGuide(id: string): Promise<StoredGuide>;
    saveGuide(g: StoredGuide): Promise<void>;
    getImage(id: string, name: string): Promise<Uint8Array>;
    listGuides(): Promise<{ id: string; title: string }[]>;
  };
};
declare const __showsteps: Hook;

const INVOICE = 'Create a supplier invoice in Ledgerline';
/** Over the "Sign in" heading, labels and button in step 1's screenshot (image pixels). */
const BLUR: Rect = { x: 210, y: 110, w: 260, h: 270 };

const titleOf = (b: StoredGuide['blocks'][number]) =>
  b.human?.title.spans.map((s) => s.text).join('') ?? '';

/** Install the samples; blur part of step 1 and show its whole screenshot (no magnify). */
async function prepareGuide(sw: Worker): Promise<StoredGuide> {
  return sw.evaluate(
    async ({ title, blur }) => {
      await __showsteps.installSamples();
      const summary = (await __showsteps.store.listGuides()).find((g) => g.title === title)!;
      const guide = await __showsteps.store.getGuide(summary.id);
      const first = guide.blocks.find((b) => b.kind === 'step')!;
      const shot = first.human!.screenshot!;
      delete shot.crop;
      delete shot.zoom;
      first.human!.blurs = [blur];
      await __showsteps.store.saveGuide(guide);
      return guide;
    },
    { title: INVOICE, blur: BLUR },
  );
}

async function download(page: Page, format: string): Promise<{ path: string; name: string }> {
  const dl = page.waitForEvent('download');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: new RegExp(`^${format}\\b`) })
    .click();
  const file = await dl;
  const path = test.info().outputPath(file.suggestedFilename());
  await file.saveAs(path);
  return { path, name: file.suggestedFilename() };
}

/**
 * Sum of differences between neighbouring pixels in `rect`: high for text and edges, low
 * once blurred. Runs in the page (decodes with the browser).
 */
function edgeEnergy(page: Page, src: string, rect: Rect, scale = 1) {
  return page.evaluate(
    async ({ src, rect, scale }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const r = rect;
      const d = ctx.getImageData(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
      let sum = 0;
      const row = d.width * 4;
      for (let i = row; i < d.data.length; i += 4)
        sum += Math.abs(d.data[i]! - d.data[i - 4]!) + Math.abs(d.data[i]! - d.data[i - row]!);
      return sum / (d.data.length / 4);
    },
    { src, rect, scale },
  );
}

test('exports: PDF, Word, Markdown, HTML, embed card, Copy HTML, print and shared folder', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  test.setTimeout(120_000);
  const guide = await prepareGuide(serviceWorker);
  const steps = guide.blocks.filter((b) => b.kind === 'step');
  expect(steps).toHaveLength(17);

  // "Save to shared folder" goes to a private browser folder in tests (no OS picker).
  await context.addInitScript(() => {
    (
      window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
    ).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle('Shared guides', {
        create: true,
      });
  });
  // The clipboard is read back from a web page: permissions cannot be granted to extension pages.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://localhost:5173',
  });

  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${extensionId}/library.html#/guide/${guide.id}/view`);
  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share this guide' });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('share-dialog.png') });
  const status = dialog.getByRole('status');

  // ---------- PDF (X1) ----------
  const pdfFile = await download(page, 'PDF');
  expect(pdfFile.name).toBe(`${INVOICE}.pdf`);
  await expect(status).toHaveText(`Downloaded “${INVOICE}.pdf”.`);
  const task = getDocument({ data: new Uint8Array(readFileSync(pdfFile.path)) });
  const pdf = await task.promise;
  let pdfText = '';
  let pdfImages = 0;
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i);
    pdfText += ` ${(await p.getTextContent()).items.map((t) => ('str' in t ? t.str : '')).join(' ')}`;
    pdfImages += (await p.getOperatorList()).fnArray.filter(
      (f) => f === OPS.paintImageXObject,
    ).length;
  }
  await task.destroy();
  pdfText = pdfText.replace(/\s+/g, ' ');
  expect(pdfImages).toBe(17);
  for (const s of steps) expect(pdfText).toContain(titleOf(s));
  expect(pdfText).toContain('Send for approval');
  expect(pdfText).toContain(`Page ${pdf.numPages} of ${pdf.numPages}`);

  // ---------- Word (X2) ----------
  const docx = await download(page, 'Word');
  expect(docx.name).toBe(`${INVOICE}.docx`);
  const { value: docHtml, messages } = await mammoth.convertToHtml({ path: docx.path });
  expect(messages.filter((m) => m.type === 'error')).toEqual([]);
  expect(docHtml.match(/<img /g)).toHaveLength(17);
  expect(docHtml.match(/<h1>/g)).toHaveLength(3);
  for (const s of steps) expect(docHtml).toContain(`<li>${titleOf(s).split(' ')[0]}`);
  expect(docHtml).toContain('alt="Screenshot for step 1:');

  // ---------- Markdown (X3) ----------
  const mdZip = await download(page, 'Markdown');
  const files = unzipSync(readFileSync(mdZip.path));
  const pictures = Object.keys(files).filter((n) => /^img\/step-\d+\.png$/.test(n));
  expect(pictures).toHaveLength(17);
  const md = strFromU8(files['guide.md']!);
  expect(md).toContain(`# ${INVOICE}`);
  for (const p of pictures) expect(md).toContain(`](${p})`);

  // Blurs are burned into exported pixels: the sign-in form is unreadable in step 1.
  const original = await serviceWorker.evaluate(
    async ({ id, file }) => Array.from(await __showsteps.store.getImage(id, file)),
    { id: guide.id, file: steps[0]!.human!.screenshot!.file.replace(/^img\//, '') },
  );
  const toData = (bytes: Uint8Array | number[], type: string) =>
    `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
  const before = await edgeEnergy(page, toData(original, 'image/webp'), BLUR);
  const after = await edgeEnergy(page, toData(files['img/step-01.png']!, 'image/png'), BLUR);
  expect(before).toBeGreaterThan(3);
  expect(after).toBeLessThan(before / 4);

  // ---------- HTML page (X4) ----------
  const htmlFile = await download(page, 'Web page');
  const html = readFileSync(htmlFile.path, 'utf8');
  expect(html.match(/<img class="shot" src="data:image\/png;base64,/g)).toHaveLength(17);
  const reader = await context.newPage();
  await reader.goto(`${pathToFileURL(htmlFile.path).href}#step-5`);
  await expect(reader.locator('article.step')).toHaveCount(17);
  await expect(reader.locator('#step-5')).toBeInViewport();
  await reader
    .getByRole('navigation', { name: 'Contents' })
    .getByRole('link', { name: /^12/ })
    .click();
  await expect(reader).toHaveURL(/#step-12$/);
  await expect(reader.locator('#step-12')).toBeInViewport();
  const loaded = await reader
    .locator('img.shot')
    .evaluateAll((imgs) =>
      imgs.every(
        (i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0,
      ),
    );
  expect(loaded).toBe(true);
  await reader.emulateMedia({ colorScheme: 'dark' });
  const darkBg = await reader.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBg).toBe('rgb(17, 13, 36)');
  await reader.emulateMedia({ colorScheme: 'light', media: 'print' });
  await expect(reader.getByRole('navigation', { name: 'Contents' })).toBeHidden();
  await reader.emulateMedia({ media: 'screen' });
  await reader.screenshot({ path: test.info().outputPath('export-html.png') });
  await reader.close();

  // ---------- Embed card (X6) ----------
  const embedFile = await download(page, 'Embed card');
  expect(embedFile.name).toBe(`${INVOICE}.embed.html`);
  const embed = await context.newPage();
  await embed.setViewportSize({ width: 720, height: 600 });
  await embed.goto(pathToFileURL(embedFile.path).href);
  await expect(embed.locator('.slide:visible')).toHaveCount(1);
  await expect(embed.locator('.slide:visible')).toContainText('Step 1 of 17');
  await embed.getByRole('link', { name: 'Next →' }).click();
  await expect(embed.locator('.slide:visible')).toContainText('Step 2 of 17');
  await embed.screenshot({ path: test.info().outputPath('export-embed.png') });
  await embed.close();

  // ---------- Copy HTML (X5) ----------
  await page.bringToFront();
  await dialog.getByRole('button', { name: 'Copy HTML' }).click();
  await expect(status).toHaveText('Copied. Paste it where you want the guide.');
  const demo = await context.newPage();
  await demo.goto('http://localhost:5173/login.html');
  await demo.bringToFront();
  const clip = await demo.evaluate(async () => {
    // Read the HTML as written (Chrome otherwise sanitises it on read).
    const read = navigator.clipboard.read.bind(navigator.clipboard) as (
      o: object,
    ) => Promise<ClipboardItems>;
    const [item] = await read({ unsanitized: ['text/html'] });
    return {
      types: item!.types,
      html: await (await item!.getType('text/html')).text(),
      text: await (await item!.getType('text/plain')).text(),
    };
  });
  expect(clip.types).toEqual(expect.arrayContaining(['text/html', 'text/plain']));
  expect(clip.html.match(/<img [^>]*src="data:image\/png;base64,/g)).toHaveLength(17);
  expect(clip.text).toContain('1. Go to');
  expect(clip.text).toContain('17. Click Submit invoice');
  await demo.close();
  await page.bringToFront();

  // ---------- Save to shared folder (X8), twice: the second save updates the same files ----------
  await dialog.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(dialog).toContainText('Folder: Shared guides');
  await dialog.getByRole('button', { name: 'Save to folder' }).click();
  await expect(status).toHaveText('Saved 3 files to “Shared guides”.');
  const listFolder = () =>
    page.evaluate(async () => {
      const dir = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('Shared guides');
      const out: Record<string, string> = {};
      for await (const [name, handle] of dir as unknown as AsyncIterable<
        [string, FileSystemFileHandle]
      >) {
        const file = await handle.getFile();
        out[name] = name.endsWith('.html') ? await file.text() : String(file.size);
      }
      return out;
    });
  const first = await listFolder();
  expect(Object.keys(first).sort()).toEqual([
    `${INVOICE}.embed.html`,
    `${INVOICE}.html`,
    `${INVOICE}.showsteps`,
  ]);
  await page.getByRole('button', { name: 'Close' }).click();

  await serviceWorker.evaluate(async (id) => {
    const g = await __showsteps.store.getGuide(id);
    const step = g.blocks.find((b) => b.kind === 'step')!;
    step.human!.title = { spans: [{ text: 'Open Ledgerline in Chrome' }] };
    await __showsteps.store.saveGuide(g);
  }, guide.id);
  await page.reload();
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(dialog).toContainText('Folder: Shared guides'); // remembered
  await dialog.getByRole('button', { name: 'Save to folder' }).click();
  await expect(status).toHaveText('Saved 3 files to “Shared guides”.');
  const second = await listFolder();
  expect(Object.keys(second)).toHaveLength(3);
  expect(second[`${INVOICE}.embed.html`]).toContain('Open Ledgerline in Chrome');
  expect(first[`${INVOICE}.embed.html`]).not.toContain('Open Ledgerline in Chrome');

  // ---------- Print view (X7) ----------
  await dialog.getByRole('button', { name: 'Print…' }).click();
  await expect(page).toHaveURL(/\/print$/);
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeVisible();
  await expect(page.locator('.ss-reader .ss-step')).toHaveCount(17);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.ss-print__bar')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/view$/);

  expect(errors).toEqual([]);
});

test('editor: Share is in the toolbar and exports the guide being edited', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const guide = await prepareGuide(serviceWorker);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/library.html#/guide/${guide.id}`);
  await page.getByRole('button', { name: 'Share' }).click();
  const html = await download(page, 'Web page');
  const text = readFileSync(html.path, 'utf8');
  expect(text).toContain(`<h1>${INVOICE}</h1>`);
  expect(text.match(/<article class="step"/g)).toHaveLength(17);
});

test('exports carry Guide Me and Run for me links, and none with the toggle off (1.2)', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  test.setTimeout(120_000);
  const guide = await prepareGuide(serviceWorker);
  const stored = await serviceWorker.evaluate((id) => __showsteps.store.getGuide(id), guide.id);
  const guideLink = buildStartLink(stored as unknown as Guide, 'guide')!;
  const runLink = buildStartLink(stored as unknown as Guide, 'run')!;
  expect(guideLink).toMatch(
    /^http:\/\/localhost:5173\/login\.html#showsteps=1&guide=.+&mode=guide&v=/,
  );
  const amp = (s: string) => s.replace(/&/g, '&amp;');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'http://localhost:5173',
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/library.html#/guide/${guide.id}/view`);
  await page.getByRole('button', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share this guide' });
  const toggle = dialog.getByRole('checkbox', { name: 'Include Guide Me and Run for me links' });
  await expect(toggle).toBeChecked();

  const files = async () => {
    const html = readFileSync((await download(page, 'Web page')).path, 'utf8');
    const embed = readFileSync((await download(page, 'Embed card')).path, 'utf8');
    const md = strFromU8(
      unzipSync(new Uint8Array(readFileSync((await download(page, 'Markdown')).path)))['guide.md']!,
    );
    const docx = unzipSync(new Uint8Array(readFileSync((await download(page, 'Word')).path)));
    const rels = strFromU8(docx['word/_rels/document.xml.rels']!);
    // The PDF's link annotations, read back.
    const doc = await getDocument({
      data: new Uint8Array(readFileSync((await download(page, 'PDF')).path)),
    }).promise;
    const uris: string[] = [];
    for (let i = 1; i <= doc.numPages; i++)
      for (const a of await (await doc.getPage(i)).getAnnotations())
        if (a.subtype === 'Link' && a.url) uris.push(a.url as string);
    await dialog.getByRole('button', { name: 'Copy HTML' }).click();
    await expect(dialog.getByRole('status')).toHaveText(
      'Copied. Paste it where you want the guide.',
    );
    const demo = await context.newPage();
    await demo.goto('http://localhost:5173/login.html');
    await demo.bringToFront();
    const clip = await demo.evaluate(async () => {
      const read = navigator.clipboard.read.bind(navigator.clipboard) as (
        o: object,
      ) => Promise<ClipboardItems>;
      const [item] = await read({ unsanitized: ['text/html'] });
      return (await item!.getType('text/html')).text();
    });
    await demo.close();
    await page.bringToFront();
    return { html, embed, md, rels, uris, clip };
  };

  const on = await files();
  for (const html of [on.html, on.embed, on.clip]) {
    expect(html).toContain(`<a href="${amp(guideLink)}">Guide Me</a>`);
    expect(html).toContain(`<a href="${amp(runLink)}">Run for me</a>`);
  }
  expect(on.md).toContain(`[Guide Me](<${guideLink}>) · [Run for me](<${runLink}>)`);
  expect(on.rels).toContain(`Target="${amp(guideLink)}"`);
  expect(on.rels).toContain(`Target="${amp(runLink)}"`);
  expect(on.uris).toEqual([guideLink, runLink]);

  // Off, and remembered when the dialog opens again.
  await toggle.uncheck();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(toggle).not.toBeChecked();
  const off = await files();
  for (const text of [off.html, off.embed, off.clip, off.md, off.rels])
    expect(text).not.toContain('showsteps=1');
  expect(off.uris).toEqual([]);
});
