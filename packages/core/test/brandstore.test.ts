import { IDBFactory } from 'fake-indexeddb';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BrandKitSchema,
  FolderBrandStore,
  GuideFormatError,
  IndexedDbBrandStore,
  SHOWSTEPS_KIT,
  checkAsset,
  exportBrandKit,
  importBrandKit,
  type BrandKit,
  type BrandStore,
} from '../src/index.js';
import { nodeFileSystem } from '../src/node/fs.js';
import { PDF_SANS_400 } from '../src/export/fonts.generated.js';

const dir = mkdtempSync(join(tmpdir(), 'showsteps-brand-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const FONT = Uint8Array.from(atob(PDF_SANS_400), (c) => c.charCodeAt(0));
const SVG = strToU8('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const acme: BrandKit = BrandKitSchema.parse({
  ...SHOWSTEPS_KIT,
  id: 'acme',
  name: 'Acme',
  logo: 'logo.png',
  fonts: { body: 'custom:body.ttf' },
});

const stores: [string, () => BrandStore][] = [
  ['IndexedDB', () => new IndexedDbBrandStore(new IDBFactory())],
  [
    'a folder',
    () => new FolderBrandStore(nodeFileSystem, mkdtempSync(join(dir, 'k-')).replace(/\\/g, '/')),
  ],
];

describe.each(stores)('brand kits in %s (B3)', (_name, make) => {
  it('saves, lists, sets the default and deletes kits with their assets', async () => {
    const store = make();
    expect(await store.listKits()).toEqual([]);
    await store.saveKit(acme);
    await store.putAsset('acme', 'logo.png', PNG);
    await store.setDefault('acme');
    expect((await store.listKits()).map((k) => k.id)).toEqual(['acme']);
    expect(await store.getDefault()).toBe('acme');
    expect(await store.getAsset('acme', 'logo.png')).toEqual(PNG);
    await store.deleteKit('acme');
    expect(await store.listKits()).toEqual([]);
    expect(await store.getDefault()).toBeUndefined();
    expect(await store.getAsset('acme', 'logo.png')).toBeUndefined();
    await expect(store.putAsset('acme', '../x.png', PNG)).rejects.toThrow();
  });
});

describe('.showsteps-brand files (B3)', () => {
  it('carry a kit and its assets to another library, under a new id when taken', async () => {
    const from = new IndexedDbBrandStore(new IDBFactory());
    await from.saveKit(acme);
    await from.putAsset('acme', 'logo.png', PNG);
    await from.putAsset('acme', 'body.ttf', FONT);
    const file = await exportBrandKit(from, 'acme');
    expect(
      Object.keys(unzipSync(file))
        .filter((n) => !n.endsWith('/'))
        .sort(),
    ).toEqual(['assets/body.ttf', 'assets/logo.png', 'kit.json']);
    const to = new IndexedDbBrandStore(new IDBFactory());
    const first = await importBrandKit(to, file);
    expect(first.id).toBe('acme');
    expect(await to.getAsset('acme', 'body.ttf')).toEqual(FONT);
    const second = await importBrandKit(to, file);
    expect(second.id).not.toBe('acme');
    expect(await to.listKits()).toHaveLength(2);
  });

  it('refuse SVG, scripts, unknown files and assets the kit doesn’t use', async () => {
    const kitJson = strToU8(JSON.stringify({ ...acme, fonts: {} }));
    const store = new IndexedDbBrandStore(new IDBFactory());
    const refused = (files: Record<string, Uint8Array>) =>
      expect(importBrandKit(store, zipSync(files))).rejects.toThrow(GuideFormatError);
    await refused({ 'kit.json': kitJson, 'assets/logo.png': SVG });
    await refused({ 'kit.json': kitJson, 'run.js': strToU8('alert(1)') });
    await refused({ 'kit.json': kitJson, 'assets/other.png': PNG });
    await refused({ 'kit.json': strToU8('{"id":"x"}') });
    await refused({ 'assets/logo.png': PNG });
    expect(await store.listKits()).toEqual([]);
  });

  it('check assets by their bytes', () => {
    expect(checkAsset(PNG)).toEqual({ kind: 'image' });
    expect(checkAsset(FONT)).toEqual({ kind: 'font' });
    expect(checkAsset(SVG)).toHaveProperty('error');
    expect(checkAsset(new Uint8Array([0x00, 0x01, 0x00, 0x00, 9, 9]))).toEqual({
      error: 'This font file can’t be read.',
    });
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    expect(checkAsset(big)).toHaveProperty('error');
  });
});
