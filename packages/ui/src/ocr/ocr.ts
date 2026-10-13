// U8: on-device OCR with tesseract.js. The worker, WebAssembly core and English model are
// bundled with each app under `ocr/` (scripts/copy-ocr.mjs) and loaded from there: nothing is
// fetched from the internet, and the engine loads only when a picture needs reading.
import type { PageText, TextRun } from '@showsteps/core';
import type { Worker } from 'tesseract.js';

let engine: Promise<Worker> | undefined;

/** Where the app serves the OCR files, next to its pages. */
function assetBase(): string {
  return new URL('ocr/', document.baseURI).href;
}

function start(): Promise<Worker> {
  engine ??= (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    const base = assetBase();
    return createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${base}worker.min.js`,
      // A folder: the worker picks the core build this machine supports.
      corePath: base,
      langPath: base.replace(/\/$/, ''),
      gzip: true,
      workerBlobURL: false,
      cacheMethod: 'none',
    });
  })();
  engine.catch(() => (engine = undefined));
  return engine;
}

/** Small screen text reads far better enlarged; boxes are scaled back to picture pixels. */
const UPSCALE_BELOW = 2000;

async function prepare(
  picture: Blob,
): Promise<{ image: Blob; scale: number; w: number; h: number }> {
  const bitmap = await createImageBitmap(picture);
  const w = bitmap.width;
  const h = bitmap.height;
  const scale = w < UPSCALE_BELOW ? 2 : 1;
  if (scale === 1) {
    bitmap.close();
    return { image: picture, scale, w, h };
  }
  const canvas = new OffscreenCanvas(w * scale, h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w * scale, h * scale);
  bitmap.close();
  return { image: await canvas.convertToBlob({ type: 'image/png' }), scale, w, h };
}

/**
 * The text on a picture as runs (one per line) with each word's box in picture pixels: the
 * same shape as the word positions saved for web screenshots, so Secure Blur reads both.
 */
export async function readPicture(picture: Blob): Promise<PageText> {
  const { image, scale, w, h } = await prepare(picture);
  const worker = await start();
  const { data } = await worker.recognize(image, {}, { blocks: true, text: false });
  const runs: TextRun[] = [];
  for (const block of data.blocks ?? [])
    for (const paragraph of block.paragraphs)
      for (const line of paragraph.lines) {
        let text = '';
        const words: TextRun['words'] = [];
        for (const word of line.words) {
          const t = word.text.trim();
          if (!t) continue;
          if (text) text += ' ';
          const b = word.bbox;
          words.push([
            text.length,
            text.length + t.length,
            Math.round(b.x0 / scale),
            Math.round(b.y0 / scale),
            Math.round((b.x1 - b.x0) / scale),
            Math.round((b.y1 - b.y0) / scale),
          ]);
          text += t;
        }
        if (words.length) runs.push({ text, words });
      }
  return { width: w, height: h, runs };
}

/**
 * The lines nearest a box (picture pixels), nearest first: "text around the click". Text inside
 * the box (a button's label, a heading) comes first.
 */
export function textAround(
  page: PageText,
  box: { x: number; y: number; w: number; h: number },
  maxChars = 200,
): string {
  const gap = (a0: number, a1: number, b0: number, b1: number) =>
    a1 < b0 ? b0 - a1 : b1 < a0 ? a0 - b1 : 0;
  const distance = (run: TextRun) =>
    Math.min(
      ...run.words.map(([, , wx, wy, ww, wh]) =>
        Math.hypot(gap(wx, wx + ww, box.x, box.x + box.w), gap(wy, wy + wh, box.y, box.y + box.h)),
      ),
    );
  const near = page.runs
    .map((run) => ({ run, d: distance(run) }))
    .filter((r) => r.d < 160)
    .sort((a, b) => a.d - b.d);
  let out = '';
  for (const { run } of near) {
    if (out.length + run.text.length + 3 > maxChars) break;
    out += (out ? ' · ' : '') + run.text;
  }
  return out;
}

/** Free the OCR worker (it holds the model in memory). */
export async function stopOcr(): Promise<void> {
  const running = engine;
  engine = undefined;
  if (running) await (await running).terminate();
}

/** Around a box: this far left and right, and up and down, in picture pixels. */
const AROUND_X = 420;
const AROUND_Y = 180;

/** Text near a box on a picture (its Action Box): what an agent can look for on screen. */
export async function readAround(
  picture: Blob,
  box: { x: number; y: number; w: number; h: number },
): Promise<string> {
  const bitmap = await createImageBitmap(picture);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const x = Math.max(0, Math.round(cx - AROUND_X));
  const y = Math.max(0, Math.round(cy - AROUND_Y));
  const w = Math.min(bitmap.width - x, AROUND_X * 2);
  const h = Math.min(bitmap.height - y, AROUND_Y * 2);
  const canvas = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  canvas.getContext('2d')?.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  bitmap.close();
  const page = await readPicture(await canvas.convertToBlob({ type: 'image/png' }));
  return textAround(page, { x: box.x - x, y: box.y - y, w: box.w, h: box.h });
}
