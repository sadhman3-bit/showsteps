import { zlibSync } from 'fflate';
import { createCallout, createGuide, createHeading, createStep } from '../../src/factory.js';
import type { ExportImage, ExportInput } from '../../src/export/index.js';
import type { Guide, Step } from '../../src/schema.js';

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A real PNG of one colour, so PDF and Word libraries accept it. */
export function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    for (let x = 0; x < width; x++) raw.set(rgb, row + 1 + x * 3);
  }
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function image(width: number, height: number, rgb: [number, number, number]): ExportImage {
  return { bytes: solidPng(width, height, rgb), width, height, mime: 'image/png' };
}

const app = { kind: 'web' as const, url: 'http://localhost:5173/app/invoices/new' };
const at = '2026-10-09T23:30:00.000Z';

function step(id: string, title: Step['human']['title'], extra: Partial<Step['human']> = {}): Step {
  return {
    ...createStep({ action: 'click', app, human: { title, ...extra }, capture: { at } }),
    id,
  };
}

/** A guide that exercises every block kind, rich text, a step without a picture and escaping. */
export function fixtureGuide(): Guide {
  const g = createGuide({
    id: 'guide-fixture',
    title: 'Pay a supplier <invoice> & file it',
    description: 'Enter a supplier invoice and send it for approval.',
    tags: ['ap'],
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-09T23:30:00.000Z',
    preconditions: ['You can sign in to Ledgerline', 'You have the invoice PDF'],
    success: 'The page says “Invoice submitted”.',
    branding: { accent: '#7c3aed', font: 'Georgia' },
  });
  const heading1 = { ...createHeading('Sign in'), id: 'h1' };
  const s1 = step(
    's1',
    {
      spans: [
        { text: 'Type ' },
        { text: 'alex', bold: true },
        { text: ' into ' },
        { text: 'Username', bold: true },
      ],
    },
    { description: { spans: [{ text: 'Use your own username.' }] } },
  );
  const s2 = step(
    's2',
    { spans: [{ text: 'Enter your password' }] },
    { altText: 'The sign-in form' },
  );
  const tip = {
    ...createCallout('tip', 'Ask IT if you are locked out.\nThey answer within an hour.'),
    id: 'c1',
  };
  const heading2 = { ...createHeading('Enter the invoice'), id: 'h2' };
  const s3 = step('s3', {
    spans: [
      { text: 'Click ' },
      { text: 'New invoice', bold: true },
      { text: ' (see ' },
      { text: 'the policy', href: 'https://example.com/policy?a=1&b=2', italic: true },
      { text: ')' },
    ],
  });
  const warning = { ...createCallout('warning', 'Submitting cannot be undone.'), id: 'c2' };
  const s4 = step('s4', { spans: [{ text: 'Click ' }, { text: 'Submit → done', bold: true }] });
  return { ...g, blocks: [heading1, s1, s2, tip, heading2, s3, warning, s4] };
}

/** Pictures for s1, s2 and s4; s3 is text only. */
export function fixtureInput(): ExportInput {
  return {
    guide: fixtureGuide(),
    images: new Map([
      ['s1', image(8, 5, [200, 60, 20])],
      ['s2', image(6, 6, [20, 120, 200])],
      ['s4', image(10, 4, [40, 160, 80])],
    ]),
    logo: image(4, 2, [124, 58, 237]),
  };
}
