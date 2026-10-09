import { IDBFactory } from 'fake-indexeddb';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_EXTENSION,
  duplicateGuide,
  exportGuideArchive,
  importGuideArchive,
} from '../src/archive.js';
import { CaptureSession, attachScreenshot, type CaptureEvent } from '../src/capture/session.js';
import { isSensitiveField, isTextEntry } from '../src/dom/sensitive.js';
import { createGuide, createHeading, createStep } from '../src/factory.js';
import { actionBoxFor, autoCrop, clampRect, fitWidth } from '../src/geometry.js';
import { GuideFormatError, serializeGuide } from '../src/migrations.js';
import { plain, toMarkdown } from '../src/richText.js';
import type { Target } from '../src/schema.js';
import { IndexedDbStore } from '../src/storage/indexeddb.js';

const app = { kind: 'web' as const, url: 'http://localhost:5173/app/invoices/new' };
const at = '2026-10-09T00:00:00.000Z';
const t = (name: string, role = 'textbox', extra: Partial<Target> = {}): Target => ({
  role,
  name,
  selectors: [],
  bbox: { x: 100, y: 200, w: 300, h: 30 },
  point: { x: 250, y: 215 },
  ...extra,
});
const titles = (s: CaptureSession) => s.steps.map((x) => toMarkdown(x.human.title));
type EventInit = CaptureEvent extends infer E
  ? E extends CaptureEvent
    ? Omit<E, 'app' | 'at'> & { app?: CaptureEvent['app'] }
    : never
  : never;
const ev = (e: EventInit) => ({ app, at, ...e }) as CaptureEvent;

describe('CaptureSession', () => {
  it('turns click-into-field then typing into one Type step', () => {
    const s = new CaptureSession();
    s.apply(ev({ kind: 'click', button: 'left', target: t('Supplier'), element: 'f1:1' }));
    const r = s.apply(
      ev({
        kind: 'type',
        target: t('Supplier'),
        element: 'f1:1',
        value: 'Harbour Paper Co.',
        sensitive: false,
      }),
    );
    expect(r.change).toBe('updated');
    expect(r.wantsShot).toBe(true);
    expect(titles(s)).toEqual(['Type **Harbour Paper Co.** into **Supplier**']);
  });

  it('never keeps a value for sensitive fields', () => {
    const s = new CaptureSession();
    s.apply(
      ev({
        kind: 'type',
        target: t('Password'),
        element: 'f1:2',
        value: 'hunter2',
        sensitive: true,
      }),
    );
    expect(s.steps[0]?.input).toEqual({ mode: 'fixed', sensitive: true });
    expect(JSON.stringify(s.steps)).not.toContain('hunter2');
    expect(titles(s)).toEqual(['Enter your password']);
  });

  it('re-typing into the same field updates the step', () => {
    const s = new CaptureSession();
    s.apply(ev({ kind: 'type', target: t('Amount'), element: 'a', value: '12', sensitive: false }));
    s.apply(
      ev({ kind: 'type', target: t('Amount'), element: 'a', value: '1280.50', sensitive: false }),
    );
    expect(titles(s)).toEqual(['Type **1280.50** into **Amount**']);
  });

  it('merges a dropdown click with the chosen option', () => {
    const s = new CaptureSession();
    s.apply(ev({ kind: 'click', button: 'left', target: t('Currency', 'combobox'), element: 'c' }));
    const r = s.apply(
      ev({ kind: 'select', target: t('Currency', 'combobox'), element: 'c', value: 'NZD' }),
    );
    expect(r.wantsShot).toBe(false);
    expect(titles(s)).toEqual(['Select **NZD** from **Currency**']);
  });

  it('records checkboxes and radios with their new state, merging the change event', () => {
    const s = new CaptureSession();
    s.apply(
      ev({
        kind: 'click',
        button: 'left',
        target: t('Includes GST', 'checkbox'),
        element: 'g',
        toggle: { role: 'checkbox', checked: true },
      }),
    );
    s.apply(
      ev({
        kind: 'check',
        target: t('Includes GST', 'checkbox'),
        element: 'g',
        checked: true,
        role: 'checkbox',
      }),
    );
    s.apply(
      ev({
        kind: 'check',
        target: t('Urgent', 'checkbox'),
        element: 'u',
        checked: false,
        role: 'checkbox',
      }),
    );
    s.apply(
      ev({
        kind: 'click',
        button: 'left',
        target: t('Cheque', 'radio'),
        element: 'r',
        toggle: { role: 'radio', checked: true },
      }),
    );
    expect(titles(s)).toEqual([
      'Check **Includes GST**',
      'Uncheck **Urgent**',
      'Select **Cheque**',
    ]);
  });

  it('collapses the two clicks of a double-click', () => {
    const s = new CaptureSession();
    s.apply(
      ev({ kind: 'click', button: 'left', target: t('Q3 report.xlsx', 'row'), element: 'q' }),
    );
    s.apply(
      ev({ kind: 'click', button: 'left', target: t('Q3 report.xlsx', 'row'), element: 'q' }),
    );
    const r = s.apply(ev({ kind: 'dblclick', target: t('Q3 report.xlsx', 'row'), element: 'q' }));
    expect(r.removed).toHaveLength(1);
    expect(titles(s)).toEqual(['Double-click **Q3 report.xlsx**']);
  });

  it('records right clicks, keys, uploads and navigations', () => {
    const s = new CaptureSession();
    s.apply(
      ev({ kind: 'navigate', app: { kind: 'web', url: 'https://contoso.sharepoint.com/sites/x' } }),
    );
    s.apply(ev({ kind: 'click', button: 'right', target: t('Invoices', 'link'), element: 'l' }));
    s.apply(
      ev({
        kind: 'click',
        button: 'left',
        target: t('Attach invoice PDF', 'button'),
        element: 'f',
      }),
    );
    s.apply(
      ev({
        kind: 'upload',
        target: t('Attach invoice PDF', 'button'),
        element: 'f',
        files: ['invoice.pdf'],
      }),
    );
    s.apply(ev({ kind: 'key', key: 'Enter' }));
    expect(titles(s)).toEqual([
      'Go to **contoso.sharepoint.com**',
      'Right-click **Invoices**',
      'Upload **invoice.pdf**',
      'Press **Enter**',
    ]);
  });

  it('does not merge events on different elements', () => {
    const s = new CaptureSession();
    s.apply(ev({ kind: 'click', button: 'left', target: t('Supplier'), element: 'a' }));
    s.apply(
      ev({
        kind: 'type',
        target: t('Invoice no.'),
        element: 'b',
        value: 'INV-1',
        sensitive: false,
      }),
    );
    expect(s.count).toBe(2);
  });

  it('deletes the last step and clears', () => {
    const s = new CaptureSession();
    s.apply(ev({ kind: 'key', key: 'Escape' }));
    s.apply(ev({ kind: 'key', key: 'Enter' }));
    expect(s.deleteLast()?.key).toBe('Enter');
    expect(s.count).toBe(1);
    expect(s.clear()).toHaveLength(1);
    expect(s.count).toBe(0);
  });

  it('inserts captured steps at a chosen position (capture more)', () => {
    const guide = createGuide({ blocks: [createHeading('A'), createHeading('B')] });
    const s = new CaptureSession(1);
    s.apply(ev({ kind: 'key', key: 'Enter' }));
    const out = s.applyTo(guide, guide.blocks);
    expect(out.blocks.map((b) => b.kind)).toEqual(['heading', 'step', 'heading']);
    const end = new CaptureSession().applyTo(guide, guide.blocks);
    expect(end.blocks).toHaveLength(2);
  });
});

describe('screenshots', () => {
  it('computes the Action Box in image pixels and an auto-crop', () => {
    const step = createStep({
      action: 'click',
      app,
      target: t('Save', 'button', { bbox: { x: 100, y: 100, w: 80, h: 30 } }),
    });
    attachScreenshot(step, { file: 'img/s.webp', width: 2560, height: 1600, dpr: 2, scale: 2 });
    expect(step.human.actionBox).toEqual({ x: 192, y: 192, w: 176, h: 76 });
    expect(step.human.screenshot?.zoom).toBe(2);
    const crop = step.human.screenshot?.crop;
    expect(crop).toBeDefined();
    // The crop contains the action box and stays inside the image.
    expect(crop!.x).toBeLessThanOrEqual(192);
    expect(crop!.x + crop!.w).toBeGreaterThanOrEqual(368);
    expect(crop!.x).toBeGreaterThanOrEqual(0);
  });

  it('keeps the whole image when the target is large', () => {
    expect(autoCrop({ x: 0, y: 0, w: 1800, h: 900 }, 2000, 1000).zoom).toBe(1);
  });

  it('records reuse of an earlier screenshot', () => {
    const step = createStep({ action: 'key', app, key: 'Enter' });
    attachScreenshot(step, {
      file: 'img/a.webp',
      width: 100,
      height: 100,
      dpr: 1,
      scale: 1,
      reusedFromStepId: 'a',
    });
    expect(step.human.screenshot).toMatchObject({ file: 'img/a.webp', reusedFromStepId: 'a' });
    expect(step.human.actionBox).toBeUndefined();
  });

  it('clamps and fits', () => {
    expect(clampRect({ x: -10, y: 5, w: 50, h: 500 }, 30, 100)).toEqual({
      x: 0,
      y: 5,
      w: 30,
      h: 95,
    });
    expect(actionBoxFor({ x: 0, y: 0, w: 10, h: 10 }, 1, 8, 8, 0)).toEqual({
      x: 0,
      y: 0,
      w: 8,
      h: 8,
    });
    expect(fitWidth(1280, 800, 320)).toEqual({ width: 320, height: 200 });
    expect(fitWidth(200, 100, 320)).toEqual({ width: 200, height: 100 });
  });
});

describe('field detection', () => {
  const w = new Window();
  const doc = w.document as unknown as Document;
  const make = (html: string) => {
    doc.body.innerHTML = html;
    return doc.body.firstElementChild!;
  };

  it('flags password, one-time-code and payment fields', () => {
    expect(isSensitiveField(make('<input type="password">'))).toBe(true);
    expect(isSensitiveField(make('<input autocomplete="one-time-code">'))).toBe(true);
    expect(isSensitiveField(make('<input autocomplete="new-password">'))).toBe(true);
    expect(isSensitiveField(make('<input autocomplete="billing cc-number">'))).toBe(true);
    expect(isSensitiveField(make('<select autocomplete="cc-exp-month"></select>'))).toBe(true);
    expect(isSensitiveField(make('<input autocomplete="username">'))).toBe(false);
    expect(isSensitiveField(make('<button>Password</button>'))).toBe(false);
  });

  it('knows which elements take typing', () => {
    expect(isTextEntry(make('<input>'))).toBe(true);
    expect(isTextEntry(make('<input type="date">'))).toBe(true);
    expect(isTextEntry(make('<textarea></textarea>'))).toBe(true);
    expect(isTextEntry(make('<div contenteditable="true"></div>'))).toBe(true);
    expect(isTextEntry(make('<input type="checkbox">'))).toBe(false);
    expect(isTextEntry(make('<input type="file">'))).toBe(false);
  });
});

describe('.trailmark archives', () => {
  async function seeded() {
    const store = new IndexedDbStore(new IDBFactory());
    const step = createStep({ action: 'click', app, human: { title: plain('Click Save') } });
    const guide = createGuide({ title: 'Original', blocks: [step] });
    await store.saveGuide(guide);
    await store.putImage(guide.id, `${step.id}.webp`, new Uint8Array([1, 2, 3]));
    return { store, guide, step };
  }

  it('round-trips a guide with its images into another library', async () => {
    const { store, guide, step } = await seeded();
    const bytes = await exportGuideArchive(store, guide.id);
    expect(ARCHIVE_EXTENSION).toBe('.trailmark');
    const other = new IndexedDbStore(new IDBFactory());
    const result = await importGuideArchive(other, bytes);
    expect(result).toEqual({ guideId: guide.id, renamed: false });
    expect((await other.getGuide(guide.id))?.title).toBe('Original');
    expect(await other.getImage(guide.id, `${step.id}.webp`)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('assigns a new id when importing a guide that already exists', async () => {
    const { store, guide } = await seeded();
    const result = await importGuideArchive(store, await exportGuideArchive(store, guide.id));
    expect(result.renamed).toBe(true);
    expect(result.guideId).not.toBe(guide.id);
    expect(await store.listGuides()).toHaveLength(2);
  });

  it('rejects files that are not guides', async () => {
    const store = new IndexedDbStore(new IDBFactory());
    await expect(importGuideArchive(store, new Uint8Array([1, 2, 3]))).rejects.toThrow(
      GuideFormatError,
    );
    const { zipSync, strToU8 } = await import('fflate');
    await expect(importGuideArchive(store, zipSync({ 'x.txt': strToU8('hi') }))).rejects.toThrow(
      /no guide.json/,
    );
    const evil = zipSync({
      'guide.json': strToU8(serializeGuide(createGuide())),
      img: { '..%2f..%2fx': strToU8('x') },
    });
    await expect(importGuideArchive(store, evil)).rejects.toThrow(/Invalid image name/);
  });

  it('duplicates a guide with its images', async () => {
    const { store, guide, step } = await seeded();
    const copyId = await duplicateGuide(store, guide.id, 'Copy of Original');
    expect(copyId).not.toBe(guide.id);
    expect((await store.getGuide(copyId))?.title).toBe('Copy of Original');
    expect(await store.getImage(copyId, `${step.id}.webp`)).toEqual(new Uint8Array([1, 2, 3]));
  });
});
