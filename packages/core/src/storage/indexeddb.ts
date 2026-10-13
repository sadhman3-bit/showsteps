import { nowIso } from '../ids.js';
import { parseGuide, serializeGuide } from '../migrations.js';
import type { Guide } from '../schema.js';
import { withFolder, withParent } from './folder.js';
import { summarize } from './summary.js';
import {
  MAX_VERSIONS,
  StorageError,
  assertSafeName,
  userSlug,
  type Folder,
  type GuideStore,
  type GuideSummary,
  type SaveOptions,
  type SidecarKind,
  type VersionInfo,
} from './types.js';

const DB_VERSION = 1;

type GuideRow = { id: string; guide: unknown; trashedAt?: string };
type VersionRow = {
  guideId: string;
  n: number;
  savedAt: string;
  savedBy?: string;
  title: string;
  guide: unknown;
};
type ImageRow = { guideId: string; name: string; data: Uint8Array };
type SidecarRow = { guideId: string; kind: SidecarKind; user: string; data: unknown };

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new StorageError('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new StorageError('IndexedDB transaction failed'));
  });
}

/** Browser storage for the extension on its own. Pass the page's or worker's `indexedDB`. */
export class IndexedDbStore implements GuideStore {
  readonly kind = 'indexeddb' as const;
  private dbPromise: Promise<IDBDatabase> | undefined;

  constructor(
    private readonly factory: IDBFactory,
    private readonly opts: { name?: string; user?: string } = {},
  ) {}

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const open = this.factory.open(this.opts.name ?? 'trailmark', DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore('guides', { keyPath: 'id' });
        db.createObjectStore('versions', { keyPath: ['guideId', 'n'] }).createIndex(
          'byGuide',
          'guideId',
        );
        db.createObjectStore('images', { keyPath: ['guideId', 'name'] }).createIndex(
          'byGuide',
          'guideId',
        );
        db.createObjectStore('sidecars', { keyPath: ['guideId', 'kind', 'user'] }).createIndex(
          'byGuideKind',
          ['guideId', 'kind'],
        );
        db.createObjectStore('folders', { keyPath: 'id' });
      };
      open.onsuccess = () => {
        const db = open.result;
        // Another page is deleting or upgrading the database: let go, reopen on next use.
        db.onversionchange = () => {
          db.close();
          this.dbPromise = undefined;
        };
        resolve(db);
      };
      open.onerror = () => reject(open.error ?? new StorageError('Could not open ABCXYZ storage'));
      open.onblocked = () => reject(new StorageError('ABCXYZ storage is busy in another window'));
    });
    return this.dbPromise;
  }

  private async tx(stores: string[], mode: IDBTransactionMode = 'readonly') {
    return (await this.db()).transaction(stores, mode);
  }

  /** Close the database connection (tests, and before deleting all data). */
  async close(): Promise<void> {
    if (this.dbPromise) (await this.dbPromise).close();
    this.dbPromise = undefined;
  }

  async listGuides(opts: { includeTrashed?: boolean } = {}): Promise<GuideSummary[]> {
    const rows = await req(
      (await this.tx(['guides'])).objectStore('guides').getAll() as IDBRequest<GuideRow[]>,
    );
    const out: GuideSummary[] = [];
    for (const row of rows) {
      if (row.trashedAt && !opts.includeTrashed) continue;
      try {
        out.push(summarize(parseGuide(row.guide), row.trashedAt));
      } catch {
        // A damaged record must not hide the rest of the library.
      }
    }
    return out;
  }

  private async row(id: string): Promise<GuideRow | undefined> {
    return req(
      (await this.tx(['guides'])).objectStore('guides').get(id) as IDBRequest<GuideRow | undefined>,
    );
  }

  async getGuide(id: string): Promise<Guide | undefined> {
    const row = await this.row(id);
    return row ? parseGuide(row.guide) : undefined;
  }

  async saveGuide(guide: Guide, opts: SaveOptions = {}): Promise<void> {
    assertSafeName(guide.id, 'guide id');
    const existing = await this.row(guide.id);
    if (existing?.trashedAt)
      throw new StorageError('Restore this guide from the Trash before editing it.');
    const toSave: Guide = { ...guide, updatedAt: nowIso() };
    if (this.opts.user) toSave.updatedBy = this.opts.user;
    const plain = JSON.parse(serializeGuide(toSave)) as unknown;

    const versionNumbers = opts.snapshot === false ? [] : await this.versionNumbers(guide.id);
    const tx = await this.tx(['guides', 'versions'], 'readwrite');
    tx.objectStore('guides').put({ id: guide.id, guide: plain } satisfies GuideRow);
    if (opts.snapshot !== false) {
      const n = (versionNumbers[versionNumbers.length - 1] ?? 0) + 1;
      const row: VersionRow = {
        guideId: guide.id,
        n,
        savedAt: toSave.updatedAt,
        title: toSave.title,
        guide: plain,
      };
      if (toSave.updatedBy) row.savedBy = toSave.updatedBy;
      const versions = tx.objectStore('versions');
      versions.put(row);
      const excess = versionNumbers.length + 1 - MAX_VERSIONS;
      for (const old of versionNumbers.slice(0, Math.max(0, excess)))
        versions.delete([guide.id, old]);
    }
    await done(tx);
  }

  private async versionNumbers(guideId: string): Promise<number[]> {
    const keys = await req(
      (await this.tx(['versions'])).objectStore('versions').index('byGuide').getAllKeys(guideId),
    );
    return (keys as [string, number][]).map((k) => k[1]).sort((a, b) => a - b);
  }

  async listVersions(guideId: string): Promise<VersionInfo[]> {
    const rows = (await req(
      (await this.tx(['versions'])).objectStore('versions').index('byGuide').getAll(guideId),
    )) as VersionRow[];
    return rows
      .sort((a, b) => b.n - a.n)
      .map((r) => {
        const info: VersionInfo = { n: r.n, savedAt: r.savedAt, title: r.title };
        if (r.savedBy) info.savedBy = r.savedBy;
        return info;
      });
  }

  async getVersion(guideId: string, n: number): Promise<Guide | undefined> {
    const row = (await req(
      (await this.tx(['versions'])).objectStore('versions').get([guideId, n]),
    )) as VersionRow | undefined;
    return row ? parseGuide(row.guide) : undefined;
  }

  async trashGuide(id: string): Promise<void> {
    const row = await this.row(id);
    if (!row || row.trashedAt) return;
    const tx = await this.tx(['guides'], 'readwrite');
    tx.objectStore('guides').put({ ...row, trashedAt: nowIso() });
    await done(tx);
  }

  async restoreGuide(id: string): Promise<void> {
    const row = await this.row(id);
    if (!row?.trashedAt) return;
    const tx = await this.tx(['guides'], 'readwrite');
    tx.objectStore('guides').put({ id: row.id, guide: row.guide } satisfies GuideRow);
    await done(tx);
  }

  async purgeGuide(id: string): Promise<void> {
    const stores = ['guides', 'versions', 'images', 'sidecars'];
    const tx = await this.tx(stores, 'readwrite');
    tx.objectStore('guides').delete(id);
    for (const name of ['versions', 'images']) {
      const index = tx.objectStore(name).index('byGuide');
      const keys = await req(index.getAllKeys(id));
      for (const key of keys) tx.objectStore(name).delete(key);
    }
    for (const kind of ['comments', 'analytics'] as const) {
      const keys = await req(
        tx.objectStore('sidecars').index('byGuideKind').getAllKeys([id, kind]),
      );
      for (const key of keys) tx.objectStore('sidecars').delete(key);
    }
    await done(tx);
  }

  async putImage(guideId: string, name: string, data: Uint8Array): Promise<void> {
    assertSafeName(name, 'image name');
    const tx = await this.tx(['images'], 'readwrite');
    tx.objectStore('images').put({ guideId, name, data } satisfies ImageRow);
    await done(tx);
  }

  async getImage(guideId: string, name: string): Promise<Uint8Array | undefined> {
    const row = (await req(
      (await this.tx(['images'])).objectStore('images').get([guideId, name]),
    )) as ImageRow | undefined;
    return row ? new Uint8Array(row.data) : undefined;
  }

  async deleteImage(guideId: string, name: string): Promise<void> {
    const tx = await this.tx(['images'], 'readwrite');
    tx.objectStore('images').delete([guideId, name]);
    await done(tx);
  }

  async listImages(guideId: string): Promise<string[]> {
    const keys = await req(
      (await this.tx(['images'])).objectStore('images').index('byGuide').getAllKeys(guideId),
    );
    return (keys as [string, string][]).map((k) => k[1]).sort();
  }

  async readSidecar<T = unknown>(
    guideId: string,
    kind: SidecarKind,
    user: string,
  ): Promise<T | undefined> {
    const row = (await req(
      (await this.tx(['sidecars'])).objectStore('sidecars').get([guideId, kind, userSlug(user)]),
    )) as SidecarRow | undefined;
    return row?.data as T | undefined;
  }

  async writeSidecar(
    guideId: string,
    kind: SidecarKind,
    user: string,
    data: unknown,
  ): Promise<void> {
    const tx = await this.tx(['sidecars'], 'readwrite');
    tx.objectStore('sidecars').put({
      guideId,
      kind,
      user: userSlug(user),
      data,
    } satisfies SidecarRow);
    await done(tx);
  }

  async listSidecars<T = unknown>(
    guideId: string,
    kind: SidecarKind,
  ): Promise<{ user: string; data: T }[]> {
    const rows = (await req(
      (await this.tx(['sidecars']))
        .objectStore('sidecars')
        .index('byGuideKind')
        .getAll([guideId, kind]),
    )) as SidecarRow[];
    return rows
      .sort((a, b) => a.user.localeCompare(b.user))
      .map((r) => ({ user: r.user, data: r.data as T }));
  }

  async listFolders(): Promise<Folder[]> {
    return (await req((await this.tx(['folders'])).objectStore('folders').getAll())) as Folder[];
  }

  async saveFolder(folder: Folder): Promise<void> {
    assertSafeName(folder.id, 'folder id');
    const tx = await this.tx(['folders'], 'readwrite');
    tx.objectStore('folders').put(folder);
    await done(tx);
  }

  async deleteFolder(id: string): Promise<void> {
    const folders = await this.listFolders();
    const gone = folders.find((f) => f.id === id);
    if (!gone) return;
    const rows = (await req(
      (await this.tx(['guides'])).objectStore('guides').getAll(),
    )) as GuideRow[];
    const tx = await this.tx(['folders', 'guides'], 'readwrite');
    tx.objectStore('folders').delete(id);
    for (const f of folders) {
      if (f.parentId === id) tx.objectStore('folders').put(withParent(f, gone.parentId));
    }
    for (const row of rows) {
      const guide = parseGuide(row.guide);
      if (guide.folderId !== id) continue;
      const moved = JSON.parse(serializeGuide(withFolder(guide, gone.parentId))) as unknown;
      tx.objectStore('guides').put({ ...row, guide: moved });
    }
    await done(tx);
  }
}
