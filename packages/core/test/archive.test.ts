import { IDBFactory } from 'fake-indexeddb';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_LIMITS,
  GuideFormatError,
  IndexedDbStore,
  createGuide,
  createStep,
  exportGuideArchive,
  importGuideArchive,
  parseGuide,
  plain,
  type Redactor,
  type Step,
} from '../src/index.js';

const app = { kind: 'web' as const, url: 'https://ledger.test/' };
/** File entries of a zip (folders left out), sorted. */
const names = (files: Record<string, Uint8Array>) =>
  Object.keys(files)
    .filter((n) => !n.endsWith('/'))
    .sort();

/** A guide whose first step has a blurred, cropped picture, its page text and an old original. */
async function seeded() {
  const store = new IndexedDbStore(new IDBFactory(), { user: 'Alex' });
  const shot = (file: string) => ({ file, width: 1000, height: 800, dpr: 1 });
  const step: Step = createStep({
    action: 'click',
    app,
    human: {
      title: plain('Click Pay'),
      screenshot: { ...shot('img/s1.webp'), crop: { x: 100, y: 200, w: 500, h: 400 }, zoom: 2 },
      actionBox: { x: 150, y: 250, w: 100, h: 40 },
      blurs: [{ x: 300, y: 300, w: 80, h: 20 }],
      annotations: [
        { id: 'a', kind: 'arrow', from: { x: 100, y: 200 }, to: { x: 200, y: 300 }, color: '#f00' },
      ],
      original: { screenshot: shot('img/s1-original.webp') },
    },
    capture: { at: '2026-10-24T00:00:00Z', source: 'extension', tabId: 42 },
  });
  const guide = { ...createGuide({ title: 'Pay a bill', blocks: [step] }), updatedBy: 'Alex' };
  await store.saveGuide(guide);
  const put = (name: string, n: number) => store.putImage(guide.id, name, new Uint8Array([n]));
  await put('s1.webp', 1);
  await put('s1.thumb.webp', 2);
  await put('s1-original.webp', 3);
  await put('s1.webp.words.json', 4);
  await put('deleted-step.webp', 5);
  return { store, guide, step };
}

/** Stands in for the canvas: the crop becomes the picture, at its own size. */
const redact: Redactor = async (step) => {
  const crop = step.human.screenshot?.crop ?? { x: 0, y: 0, w: 1000, h: 800 };
  return {
    full: new Uint8Array([9]),
    thumb: new Uint8Array([8]),
    ext: 'webp',
    width: crop.w,
    height: crop.h,
    origin: { x: crop.x, y: crop.y },
    scale: 1,
  };
};

describe('guide files that leave the computer (H1)', () => {
  it('carry only redacted pictures the steps use, and nothing that was hidden', async () => {
    const { store, guide, step } = await seeded();
    const files = unzipSync(await exportGuideArchive(store, guide.id, { mode: 'share', redact }));
    expect(names(files)).toEqual(
      ['guide.json', `img/${step.id}.thumb.webp`, `img/${step.id}.webp`].sort(),
    );
    expect(files[`img/${step.id}.webp`]).toEqual(new Uint8Array([9]));
    const json = strFromU8(files['guide.json']!);
    const shared = parseGuide(JSON.parse(json));
    const s = shared.blocks[0] as Step;
    expect(s.human.blurs).toEqual([]);
    expect(s.human.original).toBeUndefined();
    expect(s.human.screenshot).toEqual({
      file: `img/${step.id}.webp`,
      width: 500,
      height: 400,
      dpr: 1,
    });
    // The highlight and annotations move with the crop.
    expect(s.human.actionBox).toEqual({ x: 50, y: 50, w: 100, h: 40 });
    expect(s.human.annotations[0]).toMatchObject({ from: { x: 0, y: 0 }, to: { x: 100, y: 100 } });
    expect(s.capture.tabId).toBeUndefined();
    expect(shared.updatedBy).toBeUndefined();
    expect(json).not.toContain('words.json');
  });

  it('refuse to share without a redactor; a backup keeps everything', async () => {
    const { store, guide } = await seeded();
    await expect(exportGuideArchive(store, guide.id, { mode: 'share' })).rejects.toThrow(
      /redacted/,
    );
    const files = unzipSync(await exportGuideArchive(store, guide.id, { mode: 'backup' }));
    expect(Object.keys(files)).toContain('img/s1.webp.words.json');
    expect(Object.keys(files)).toContain('img/s1-original.webp');
    const s = parseGuide(JSON.parse(strFromU8(files['guide.json']!))).blocks[0] as Step;
    expect(s.human.blurs).toHaveLength(1);
  });

  it('leave a picture out when it can’t be redacted', async () => {
    const { store, guide } = await seeded();
    const files = unzipSync(
      await exportGuideArchive(store, guide.id, { mode: 'share', redact: async () => undefined }),
    );
    expect(names(files)).toEqual(['guide.json']);
    const s = parseGuide(JSON.parse(strFromU8(files['guide.json']!))).blocks[0] as Step;
    expect(s.human.screenshot).toBeUndefined();
  });
});

describe('pictures with nothing hidden (H1)', () => {
  it('go as stored, with their thumbnail, without redrawing', async () => {
    const { store, guide, step } = await seeded();
    const g = await store.getGuide(guide.id);
    const s = g!.blocks[0] as Step;
    await store.saveGuide({
      ...g!,
      blocks: [
        { ...s, human: { ...s.human, blurs: [], screenshot: { ...s.human.screenshot!, zoom: 1 } } },
      ],
    });
    let calls = 0;
    const files = unzipSync(
      await exportGuideArchive(store, guide.id, {
        mode: 'share',
        redact: async (...a) => {
          calls++;
          return redact(...a);
        },
      }),
    );
    expect(calls).toBe(0);
    expect(names(files)).toEqual([
      'guide.json',
      `img/${step.id}.thumb.webp`,
      `img/${step.id}.webp`,
    ]);
    expect(files[`img/${step.id}.webp`]).toEqual(new Uint8Array([1]));
    expect(files[`img/${step.id}.thumb.webp`]).toEqual(new Uint8Array([2]));
    const shared = parseGuide(JSON.parse(strFromU8(files['guide.json']!))).blocks[0] as Step;
    expect(shared.human.actionBox).toEqual({ x: 150, y: 250, w: 100, h: 40 });
    expect(shared.human.original).toBeUndefined();
  });
});

describe('import limits (H8)', () => {
  /** A real guide file, plus extra entries. */
  async function withEntries(extra: Record<string, Uint8Array>) {
    const { store, guide } = await seeded();
    const files = unzipSync(await exportGuideArchive(store, guide.id, { mode: 'backup' }));
    return zipSync({ ...files, ...extra }, { level: 6 });
  }

  /** Make the zip's central directory claim `size` bytes for `name` (a zip bomb's lie). */
  function claim(zip: Uint8Array, name: string, size: number): Uint8Array {
    const out = zip.slice();
    const view = new DataView(out.buffer);
    for (let i = 0; i + 46 < out.length; i++) {
      if (view.getUint32(i, true) !== 0x02014b50) continue;
      const len = view.getUint16(i + 28, true);
      if (strFromU8(out.subarray(i + 46, i + 46 + len)) === name)
        view.setUint32(i + 24, size, true);
    }
    return out;
  }

  it('imports a normal guide file', async () => {
    const zip = await withEntries({});
    const to = new IndexedDbStore(new IDBFactory());
    const { guideId } = await importGuideArchive(to, zip);
    expect(await to.getGuide(guideId)).toBeDefined();
  });

  it('refuses a small file that claims to unpack past the limit, before unpacking it', async () => {
    const zip = claim(
      await withEntries({ 'img/big.png': new Uint8Array(1024 * 1024) }),
      'img/big.png',
      ARCHIVE_LIMITS.total + 1,
    );
    expect(zip.length).toBeLessThan(2 * 1024 * 1024);
    await expect(importGuideArchive(new IndexedDbStore(new IDBFactory()), zip)).rejects.toThrow(
      GuideFormatError,
    );
    const json = claim(await withEntries({}), 'guide.json', ARCHIVE_LIMITS.guideJson + 1);
    await expect(importGuideArchive(new IndexedDbStore(new IDBFactory()), json)).rejects.toThrow(
      /too large/,
    );
  });

  it('refuses too many entries and anything but guide.json and pictures', async () => {
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i < ARCHIVE_LIMITS.entries; i++)
      many[`img/p${i}.png`] = new Uint8Array([i % 256]);
    await expect(
      importGuideArchive(new IndexedDbStore(new IDBFactory()), await withEntries(many)),
    ).rejects.toThrow(/too many/);
    for (const name of ['schedules.json', 'img/sub/x.png', '../evil.png', 'img/..png'])
      await expect(
        importGuideArchive(
          new IndexedDbStore(new IDBFactory()),
          await withEntries({ [name]: new Uint8Array([1]) }),
        ),
        name,
      ).rejects.toThrow(GuideFormatError);
  });
});
