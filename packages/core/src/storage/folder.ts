import { nowIso } from '../ids.js';
import { parseGuide, serializeGuide } from '../migrations.js';
import type { Guide } from '../schema.js';
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

/** Minimal file-system surface the folder store needs. Paths use "/" separators. */
export interface FileSystem {
  /** File contents, or undefined if the file does not exist. */
  readFile(path: string): Promise<Uint8Array | undefined>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Replace `to` atomically if it exists. */
  rename(from: string, to: string): Promise<void>;
  /** Create a directory and any missing parents. */
  mkdir(path: string): Promise<void>;
  /** Entry names in a directory, or [] if it does not exist. */
  readdir(path: string): Promise<string[]>;
  /** Remove a file or directory tree; no error if missing. */
  remove(path: string): Promise<void>;
}

const TRASH = '.trash';
const enc = new TextEncoder();
const dec = new TextDecoder();

type VersionFile = { savedAt: string; savedBy?: string; guide: unknown };

/**
 * Stores each guide as a folder:
 *   <root>/<guideId>/guide.json, img/<name>, versions/<n>.json, sidecars/<kind>.<user>.json
 * Trashed guides move to <root>/.trash/<guideId>/. Folders live in <root>/folders.json.
 * Every write goes to a temporary file first and is then renamed into place.
 */
export class FolderStore implements GuideStore {
  readonly kind = 'folder' as const;

  constructor(
    private readonly fs: FileSystem,
    private readonly root: string,
    private readonly opts: { user?: string; onError?: (path: string, error: unknown) => void } = {},
  ) {}

  private path(...parts: string[]): string {
    return [this.root.replace(/[\\/]+$/, ''), ...parts].join('/');
  }

  private async writeAtomic(path: string, data: Uint8Array): Promise<void> {
    const dir = path.slice(0, path.lastIndexOf('/'));
    await this.fs.mkdir(dir);
    const tmp = `${path}.tmp-${globalThis.crypto.randomUUID().slice(0, 8)}`;
    await this.fs.writeFile(tmp, data);
    try {
      await this.fs.rename(tmp, path);
    } catch (error) {
      await this.fs.remove(tmp);
      throw error;
    }
  }

  private async readJson<T>(path: string): Promise<T | undefined> {
    const bytes = await this.fs.readFile(path);
    if (!bytes) return undefined;
    return JSON.parse(dec.decode(bytes)) as T;
  }

  private writeJson(path: string, value: unknown): Promise<void> {
    return this.writeAtomic(path, enc.encode(JSON.stringify(value, null, 2)));
  }

  /** Folder of a guide, wherever it is (live or trashed). */
  private async locate(id: string): Promise<{ dir: string; trashed: boolean } | undefined> {
    assertSafeName(id, 'guide id');
    if (await this.fs.readFile(this.path(id, 'guide.json')))
      return { dir: this.path(id), trashed: false };
    if (await this.fs.readFile(this.path(TRASH, id, 'guide.json'))) {
      return { dir: this.path(TRASH, id), trashed: true };
    }
    return undefined;
  }

  private async summariesIn(base: string[], trashed: boolean): Promise<GuideSummary[]> {
    const out: GuideSummary[] = [];
    for (const name of await this.fs.readdir(this.path(...base))) {
      if (name.startsWith('.') || name.includes('.tmp-') || name === 'folders.json') continue;
      const file = this.path(...base, name, 'guide.json');
      try {
        const raw = await this.readJson(file);
        if (raw === undefined) continue;
        const guide = parseGuide(raw);
        const trashedAt = trashed
          ? ((await this.readJson<{ trashedAt: string }>(this.path(...base, name, 'trashed.json')))
              ?.trashedAt ?? guide.updatedAt)
          : undefined;
        out.push(summarize(guide, trashedAt));
      } catch (error) {
        this.opts.onError?.(file, error);
      }
    }
    return out;
  }

  async listGuides(opts: { includeTrashed?: boolean } = {}): Promise<GuideSummary[]> {
    const live = await this.summariesIn([], false);
    return opts.includeTrashed ? [...live, ...(await this.summariesIn([TRASH], true))] : live;
  }

  async getGuide(id: string): Promise<Guide | undefined> {
    const where = await this.locate(id);
    if (!where) return undefined;
    return parseGuide(await this.readJson(`${where.dir}/guide.json`));
  }

  async saveGuide(guide: Guide, opts: SaveOptions = {}): Promise<void> {
    assertSafeName(guide.id, 'guide id');
    const where = await this.locate(guide.id);
    if (where?.trashed)
      throw new StorageError('Restore this guide from the Trash before editing it.');
    const toSave: Guide = { ...guide, updatedAt: nowIso() };
    if (this.opts.user) toSave.updatedBy = this.opts.user;
    const json = serializeGuide(toSave);
    await this.writeAtomic(this.path(guide.id, 'guide.json'), enc.encode(json));
    if (opts.snapshot !== false) await this.addVersion(toSave);
  }

  private async versionNumbers(guideId: string, dir = this.path(guideId)): Promise<number[]> {
    return (await this.fs.readdir(`${dir}/versions`))
      .map((f) => /^(\d+)\.json$/.exec(f)?.[1])
      .filter((n): n is string => !!n)
      .map(Number)
      .sort((a, b) => a - b);
  }

  private async addVersion(guide: Guide): Promise<void> {
    const numbers = await this.versionNumbers(guide.id);
    const n = (numbers[numbers.length - 1] ?? 0) + 1;
    const file: VersionFile = { savedAt: guide.updatedAt, guide };
    if (guide.updatedBy) file.savedBy = guide.updatedBy;
    await this.writeJson(this.path(guide.id, 'versions', `${n}.json`), file);
    const excess = numbers.length + 1 - MAX_VERSIONS;
    for (const old of numbers.slice(0, Math.max(0, excess))) {
      await this.fs.remove(this.path(guide.id, 'versions', `${old}.json`));
    }
  }

  async listVersions(guideId: string): Promise<VersionInfo[]> {
    const where = await this.locate(guideId);
    if (!where) return [];
    const out: VersionInfo[] = [];
    for (const n of await this.versionNumbers(guideId, where.dir)) {
      const v = await this.readJson<VersionFile>(`${where.dir}/versions/${n}.json`);
      if (!v) continue;
      const info: VersionInfo = {
        n,
        savedAt: v.savedAt,
        title: String((v.guide as { title?: unknown }).title ?? ''),
      };
      if (v.savedBy) info.savedBy = v.savedBy;
      out.push(info);
    }
    return out.reverse();
  }

  async getVersion(guideId: string, n: number): Promise<Guide | undefined> {
    const where = await this.locate(guideId);
    if (!where || !Number.isInteger(n)) return undefined;
    const v = await this.readJson<VersionFile>(`${where.dir}/versions/${n}.json`);
    return v ? parseGuide(v.guide) : undefined;
  }

  async trashGuide(id: string): Promise<void> {
    const where = await this.locate(id);
    if (!where || where.trashed) return;
    await this.fs.mkdir(this.path(TRASH));
    await this.fs.remove(this.path(TRASH, id));
    await this.fs.rename(where.dir, this.path(TRASH, id));
    await this.writeJson(this.path(TRASH, id, 'trashed.json'), { trashedAt: nowIso() });
  }

  async restoreGuide(id: string): Promise<void> {
    const where = await this.locate(id);
    if (!where?.trashed) return;
    await this.fs.remove(`${where.dir}/trashed.json`);
    await this.fs.rename(where.dir, this.path(id));
  }

  async purgeGuide(id: string): Promise<void> {
    assertSafeName(id, 'guide id');
    await this.fs.remove(this.path(id));
    await this.fs.remove(this.path(TRASH, id));
  }

  private async guideDir(guideId: string): Promise<string> {
    const where = await this.locate(guideId);
    return where?.dir ?? this.path(guideId);
  }

  async putImage(guideId: string, name: string, data: Uint8Array): Promise<void> {
    assertSafeName(name, 'image name');
    await this.writeAtomic(`${await this.guideDir(guideId)}/img/${name}`, data);
  }

  async getImage(guideId: string, name: string): Promise<Uint8Array | undefined> {
    assertSafeName(name, 'image name');
    return this.fs.readFile(`${await this.guideDir(guideId)}/img/${name}`);
  }

  async deleteImage(guideId: string, name: string): Promise<void> {
    assertSafeName(name, 'image name');
    await this.fs.remove(`${await this.guideDir(guideId)}/img/${name}`);
  }

  async listImages(guideId: string): Promise<string[]> {
    const names = await this.fs.readdir(`${await this.guideDir(guideId)}/img`);
    return names.filter((n) => !n.includes('.tmp-')).sort();
  }

  private sidecarName(kind: SidecarKind, user: string): string {
    return `${kind}.${userSlug(user)}.json`;
  }

  async readSidecar<T = unknown>(
    guideId: string,
    kind: SidecarKind,
    user: string,
  ): Promise<T | undefined> {
    return this.readJson<T>(
      `${await this.guideDir(guideId)}/sidecars/${this.sidecarName(kind, user)}`,
    );
  }

  async writeSidecar(
    guideId: string,
    kind: SidecarKind,
    user: string,
    data: unknown,
  ): Promise<void> {
    await this.writeJson(
      `${await this.guideDir(guideId)}/sidecars/${this.sidecarName(kind, user)}`,
      data,
    );
  }

  async listSidecars<T = unknown>(
    guideId: string,
    kind: SidecarKind,
  ): Promise<{ user: string; data: T }[]> {
    const dir = `${await this.guideDir(guideId)}/sidecars`;
    const out: { user: string; data: T }[] = [];
    for (const name of (await this.fs.readdir(dir)).sort()) {
      const m = new RegExp(`^${kind}\\.(.+)\\.json$`).exec(name);
      if (!m) continue;
      try {
        const data = await this.readJson<T>(`${dir}/${name}`);
        if (data !== undefined && m[1]) out.push({ user: m[1], data });
      } catch (error) {
        this.opts.onError?.(`${dir}/${name}`, error);
      }
    }
    return out;
  }

  async listFolders(): Promise<Folder[]> {
    return (await this.readJson<Folder[]>(this.path('folders.json'))) ?? [];
  }

  async saveFolder(folder: Folder): Promise<void> {
    assertSafeName(folder.id, 'folder id');
    const folders = (await this.listFolders()).filter((f) => f.id !== folder.id);
    await this.writeJson(this.path('folders.json'), [...folders, folder]);
  }

  async deleteFolder(id: string): Promise<void> {
    const folders = await this.listFolders();
    const gone = folders.find((f) => f.id === id);
    if (!gone) return;
    const rest = folders
      .filter((f) => f.id !== id)
      .map((f) => (f.parentId === id ? withParent(f, gone.parentId) : f));
    await this.writeJson(this.path('folders.json'), rest);
    for (const s of await this.listGuides({ includeTrashed: true })) {
      if (s.folderId !== id) continue;
      const guide = await this.getGuide(s.id);
      if (!guide) continue;
      const moved = withFolder(guide, gone.parentId);
      if (s.trashedAt) {
        await this.writeJson(
          this.path(TRASH, s.id, 'guide.json'),
          JSON.parse(serializeGuide(moved)),
        );
      } else {
        await this.saveGuide(moved, { snapshot: false });
      }
    }
  }
}

export function withParent(folder: Folder, parentId: string | undefined): Folder {
  const rest = { ...folder };
  delete rest.parentId;
  return parentId ? { ...rest, parentId } : rest;
}

export function withFolder(guide: Guide, folderId: string | undefined): Guide {
  const rest = { ...guide };
  delete rest.folderId;
  return folderId ? { ...rest, folderId } : rest;
}
