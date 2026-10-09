import type { AppRef, Guide } from '../schema.js';

export const MAX_VERSIONS = 50;

export type SidecarKind = 'comments' | 'analytics';

export interface GuideSummary {
  id: string;
  title: string;
  description?: string;
  tags: string[];
  folderId?: string;
  createdAt: string;
  updatedAt: string;
  author?: string;
  updatedBy?: string;
  stepCount: number;
  /** Image name of the first step's thumbnail, for library cards. */
  cover?: string;
  apps: AppRef[];
  /** Step titles as plain text, for full-text search without loading every guide. */
  searchText: string;
  trashedAt?: string;
}

export interface VersionInfo {
  n: number;
  savedAt: string;
  title: string;
  savedBy?: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId?: string;
}

export interface SaveOptions {
  /** Also record a version in history (default true). Autosave can batch by passing false. */
  snapshot?: boolean;
}

/**
 * Where guides live. Implemented by IndexedDbStore (extension on its own) and FolderStore
 * (desktop app, extension via the bridge, and shared/synced folders).
 */
export interface GuideStore {
  readonly kind: 'indexeddb' | 'folder';

  listGuides(opts?: { includeTrashed?: boolean }): Promise<GuideSummary[]>;
  getGuide(id: string): Promise<Guide | undefined>;
  saveGuide(guide: Guide, opts?: SaveOptions): Promise<void>;
  trashGuide(id: string): Promise<void>;
  restoreGuide(id: string): Promise<void>;
  /** Permanently delete a guide and everything belonging to it. */
  purgeGuide(id: string): Promise<void>;

  listVersions(guideId: string): Promise<VersionInfo[]>;
  getVersion(guideId: string, n: number): Promise<Guide | undefined>;

  putImage(guideId: string, name: string, data: Uint8Array): Promise<void>;
  getImage(guideId: string, name: string): Promise<Uint8Array | undefined>;
  deleteImage(guideId: string, name: string): Promise<void>;
  listImages(guideId: string): Promise<string[]>;

  /** Per-user files, so synced folders never have two people writing the same file. */
  readSidecar<T = unknown>(
    guideId: string,
    kind: SidecarKind,
    user: string,
  ): Promise<T | undefined>;
  writeSidecar(guideId: string, kind: SidecarKind, user: string, data: unknown): Promise<void>;
  listSidecars<T = unknown>(
    guideId: string,
    kind: SidecarKind,
  ): Promise<{ user: string; data: T }[]>;

  listFolders(): Promise<Folder[]>;
  saveFolder(folder: Folder): Promise<void>;
  /** Delete a folder; its guides and subfolders move to the parent. */
  deleteFolder(id: string): Promise<void>;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Guard ids and file names that become path segments (no traversal, no odd characters). */
export function assertSafeName(name: string, what = 'name'): string {
  if (!SAFE_NAME.test(name) || name.includes('..')) {
    throw new StorageError(`Invalid ${what}: "${name}"`);
  }
  return name;
}

/** File-safe form of a user name for sidecar files, e.g. "Priya Raman" → "priya-raman". */
export function userSlug(user: string): string {
  const slug = user
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'user';
}
