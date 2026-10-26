import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGuide, createHeading, createStep } from '../src/factory.js';
import { nodeFileSystem } from '../src/node/fs.js';
import { plain } from '../src/richText.js';
import type { Guide } from '../src/schema.js';
import { FolderStore, type FileSystem } from '../src/storage/folder.js';
import { IndexedDbStore } from '../src/storage/indexeddb.js';
import {
  MAX_VERSIONS,
  StorageError,
  assertSafeName,
  userSlug,
  type GuideStore,
} from '../src/storage/types.js';

/** In-memory FileSystem, to test FolderStore logic independently of the disk. */
function memoryFs(): FileSystem & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const under = (dir: string) => (p: string) => p.startsWith(`${dir}/`);
  return {
    files,
    async readFile(p) {
      return files.get(p);
    },
    async writeFile(p, d) {
      files.set(p, d);
    },
    async rename(from, to) {
      for (const [p, d] of [...files]) {
        if (p === from) {
          files.delete(p);
          files.set(to, d);
        } else if (under(from)(p)) {
          files.delete(p);
          files.set(to + p.slice(from.length), d);
        }
      }
    },
    async mkdir() {},
    async readdir(dir) {
      const names = new Set<string>();
      for (const p of files.keys())
        if (under(dir)(p)) names.add(p.slice(dir.length + 1).split('/')[0]!);
      return [...names];
    },
    async remove(p) {
      for (const k of [...files.keys()]) if (k === p || under(p)(k)) files.delete(k);
    },
  };
}

function guideWithSteps(title = 'Create an invoice'): Guide {
  return createGuide({
    title,
    tags: ['ap'],
    apps: [{ kind: 'web', origin: 'http://localhost:5173' }],
    blocks: [
      createHeading('Start'),
      createStep({
        action: 'click',
        app: { kind: 'web', url: 'http://localhost:5173/app/' },
        human: { title: plain('Click New invoice'), description: plain('Opens the form') },
      }),
    ],
  });
}

type Backend = { name: string; make: () => GuideStore; cleanup: () => Promise<void> | void };

let tempDir = '';
const backends: Backend[] = [
  {
    name: 'IndexedDbStore',
    make: () => new IndexedDbStore(new IDBFactory(), { user: 'Priya Raman' }),
    cleanup: () => undefined,
  },
  {
    name: 'FolderStore (disk)',
    make: () => {
      tempDir = mkdtempSync(join(tmpdir(), 'ss-store-'));
      return new FolderStore(nodeFileSystem, tempDir.replace(/\\/g, '/'), { user: 'Priya Raman' });
    },
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  },
  {
    name: 'FolderStore (memory)',
    make: () => new FolderStore(memoryFs(), '/lib', { user: 'Priya Raman' }),
    cleanup: () => undefined,
  },
];

describe.each(backends)('$name contract', (backend) => {
  let store: GuideStore;
  beforeEach(() => {
    store = backend.make();
  });
  afterEach(async () => {
    if (store instanceof IndexedDbStore) await store.close();
    await backend.cleanup();
  });

  it('saves, lists and loads guides', async () => {
    const g = guideWithSteps();
    await store.saveGuide(g);
    const loaded = await store.getGuide(g.id);
    expect(loaded?.title).toBe('Create an invoice');
    expect(loaded?.updatedBy).toBe('Priya Raman');
    expect(loaded?.blocks).toEqual(g.blocks);

    const [summary] = await store.listGuides();
    expect(summary).toMatchObject({
      id: g.id,
      title: 'Create an invoice',
      stepCount: 1,
      tags: ['ap'],
    });
    expect(summary?.searchText).toContain('Click New invoice');
    expect(summary?.searchText).toContain('Opens the form');
    expect(await store.getGuide('missing')).toBeUndefined();
  });

  it('keeps a version per save, newest first, capped at the limit', async () => {
    const g = guideWithSteps('v1');
    await store.saveGuide(g);
    await store.saveGuide({ ...g, title: 'v2' });
    await store.saveGuide({ ...g, title: 'v3' }, { snapshot: false });
    let versions = await store.listVersions(g.id);
    expect(versions.map((v) => v.title)).toEqual(['v2', 'v1']);
    expect(versions[0]?.savedBy).toBe('Priya Raman');
    expect((await store.getVersion(g.id, versions[1]!.n))?.title).toBe('v1');
    expect((await store.getGuide(g.id))?.title).toBe('v3');

    for (let i = 0; i < MAX_VERSIONS + 3; i++) await store.saveGuide({ ...g, title: `t${i}` });
    versions = await store.listVersions(g.id);
    expect(versions).toHaveLength(MAX_VERSIONS);
    expect(versions[0]?.title).toBe(`t${MAX_VERSIONS + 2}`);
  });

  it('moves guides to the trash, restores and purges them', async () => {
    const g = guideWithSteps();
    await store.saveGuide(g);
    await store.putImage(g.id, 'step.webp', new Uint8Array([1, 2, 3]));
    await store.trashGuide(g.id);

    expect(await store.listGuides()).toEqual([]);
    const trashed = await store.listGuides({ includeTrashed: true });
    expect(trashed[0]?.trashedAt).toBeTruthy();
    await expect(store.saveGuide(g)).rejects.toThrow(/Restore this guide/);
    expect(await store.getImage(g.id, 'step.webp')).toEqual(new Uint8Array([1, 2, 3]));

    await store.restoreGuide(g.id);
    expect((await store.listGuides()).map((s) => s.id)).toEqual([g.id]);
    expect((await store.listGuides())[0]?.trashedAt).toBeUndefined();
    expect(await store.listVersions(g.id)).toHaveLength(1);

    await store.purgeGuide(g.id);
    expect(await store.listGuides({ includeTrashed: true })).toEqual([]);
    expect(await store.getImage(g.id, 'step.webp')).toBeUndefined();
    expect(await store.listVersions(g.id)).toEqual([]);
  });

  it('stores images per guide', async () => {
    const g = guideWithSteps();
    await store.saveGuide(g);
    await store.putImage(g.id, 'b.webp', new Uint8Array([9]));
    await store.putImage(g.id, 'a.thumb.webp', new Uint8Array([8]));
    expect(await store.listImages(g.id)).toEqual(['a.thumb.webp', 'b.webp']);
    await store.deleteImage(g.id, 'b.webp');
    expect(await store.listImages(g.id)).toEqual(['a.thumb.webp']);
    await expect(store.putImage(g.id, '../escape.webp', new Uint8Array())).rejects.toThrow(
      StorageError,
    );
  });

  it('keeps sidecars separate per user', async () => {
    const g = guideWithSteps();
    await store.saveGuide(g);
    await store.writeSidecar(g.id, 'comments', 'Priya Raman', [{ text: 'Nice' }]);
    await store.writeSidecar(g.id, 'comments', 'Tom Whitlock', [{ text: 'Step 2 is out of date' }]);
    await store.writeSidecar(g.id, 'analytics', 'Tom Whitlock', { views: 3 });
    expect(await store.readSidecar(g.id, 'comments', 'Priya Raman')).toEqual([{ text: 'Nice' }]);
    expect(await store.listSidecars(g.id, 'comments')).toEqual([
      { user: 'priya-raman', data: [{ text: 'Nice' }] },
      { user: 'tom-whitlock', data: [{ text: 'Step 2 is out of date' }] },
    ]);
    expect(await store.listSidecars(g.id, 'analytics')).toHaveLength(1);
  });

  it('manages nested folders; deleting one moves its contents up', async () => {
    await store.saveFolder({ id: 'finance', name: 'Finance' });
    await store.saveFolder({ id: 'ap', name: 'Accounts payable', parentId: 'finance' });
    await store.saveFolder({ id: 'invoices', name: 'Invoices', parentId: 'ap' });
    const g = { ...guideWithSteps(), folderId: 'ap' };
    await store.saveGuide(g);

    await store.saveFolder({ id: 'ap', name: 'AP', parentId: 'finance' });
    expect((await store.listFolders()).find((f) => f.id === 'ap')?.name).toBe('AP');

    await store.deleteFolder('ap');
    const folders = await store.listFolders();
    expect(folders.map((f) => f.id).sort()).toEqual(['finance', 'invoices']);
    expect(folders.find((f) => f.id === 'invoices')?.parentId).toBe('finance');
    expect((await store.getGuide(g.id))?.folderId).toBe('finance');
  });
});

describe('FolderStore on disk', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ss-layout-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes the documented folder layout and leaves no temp files', async () => {
    const store = new FolderStore(nodeFileSystem, dir, { user: 'Priya Raman' });
    const g = guideWithSteps();
    await store.saveGuide(g);
    await store.putImage(g.id, 'step1.webp', new Uint8Array([1]));
    await store.putImage(g.id, 'step1.thumb.webp', new Uint8Array([2]));
    await store.writeSidecar(g.id, 'comments', 'Priya Raman', []);

    const gdir = join(dir, g.id);
    expect(readdirSync(gdir).sort()).toEqual(['guide.json', 'img', 'sidecars', 'versions']);
    expect(readdirSync(join(gdir, 'img')).sort()).toEqual(['step1.thumb.webp', 'step1.webp']);
    expect(readdirSync(join(gdir, 'versions'))).toEqual(['1.json']);
    expect(readdirSync(join(gdir, 'sidecars'))).toEqual(['comments.priya-raman.json']);
    expect(JSON.parse(readFileSync(join(gdir, 'guide.json'), 'utf8')).schemaVersion).toBe(1);
  });

  it('skips a damaged guide instead of failing the whole library', async () => {
    const errors: string[] = [];
    const fs = memoryFs();
    const store = new FolderStore(fs, '/lib', { onError: (p) => errors.push(p) });
    const g = guideWithSteps();
    await store.saveGuide(g);
    fs.files.set('/lib/broken/guide.json', new TextEncoder().encode('{"not": "a guide"'));
    expect((await store.listGuides()).map((s) => s.id)).toEqual([g.id]);
    expect(errors).toEqual(['/lib/broken/guide.json']);
  });

  it('keeps the old file if a write fails midway', async () => {
    const fs = memoryFs();
    const store = new FolderStore(fs, '/lib');
    const g = guideWithSteps('original');
    await store.saveGuide(g);
    fs.rename = async () => {
      throw new Error('disk full');
    };
    await expect(store.saveGuide({ ...g, title: 'changed' })).rejects.toThrow('disk full');
    fs.rename = memoryFs().rename; // restore a working rename for reads (reads do not rename)
    expect((await store.getGuide(g.id))?.title).toBe('original');
    expect([...fs.files.keys()].some((k) => k.includes('.tmp-'))).toBe(false);
  });
});

describe('storage helpers', () => {
  it('rejects unsafe names', () => {
    for (const bad of ['', '..', '../x', 'a/b', 'a\\b', '.hidden', 'x'.repeat(200)]) {
      expect(() => assertSafeName(bad)).toThrow(StorageError);
    }
    expect(assertSafeName('3f2a-step.thumb.webp')).toBe('3f2a-step.thumb.webp');
  });

  it('slugs user names for sidecar file names', () => {
    expect(userSlug('Priya Raman')).toBe('priya-raman');
    expect(userSlug('Zoë  O’Brien')).toBe('zoe-o-brien');
    expect(userSlug('../../etc')).toBe('etc');
    expect(userSlug('***')).toBe('user');
  });
});

describe('a team folder marks guides others saved last (H4)', () => {
  it('reads them as received from the shared folder, and the person’s own as theirs', async () => {
    const fs = memoryFs();
    const priya = new FolderStore(fs, '/team', { user: 'Priya Raman', othersAreReceived: true });
    const alex = new FolderStore(fs, '/team', { user: 'Alex', othersAreReceived: true });
    const g = createGuide({ title: 'Pay a supplier' });
    await priya.saveGuide(g);
    expect((await priya.getGuide(g.id))!.received).toBeUndefined();
    const seen = (await alex.getGuide(g.id))!;
    expect(seen.received).toMatchObject({ from: 'shared-folder' });
    // Alex trusts it (a save without the mark): now it's Alex's, and received for Priya.
    const { received: _r, ...trusted } = seen;
    await alex.saveGuide(trusted);
    expect((await alex.getGuide(g.id))!.received).toBeUndefined();
    expect((await priya.getGuide(g.id))!.received?.from).toBe('shared-folder');
    // A personal library never marks.
    const own = new FolderStore(fs, '/team', { user: 'Alex' });
    expect((await own.getGuide(g.id))!.received?.from).toBeUndefined();
  });
});
