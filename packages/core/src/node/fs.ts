// Node.js implementation of the FolderStore file-system surface. Imported via
// "@trailmark/core/node" so browser bundles never pull in node: modules.
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import type { FileSystem } from '../storage/folder.js';

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * Renames can fail briefly on Windows while OneDrive, antivirus or the indexer holds the
 * target open; retry a few times with backoff before giving up.
 */
async function renameWithRetry(from: string, to: string, attempts = 6): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!RETRYABLE.has(code) || i >= attempts - 1) throw error;
      await new Promise((r) => setTimeout(r, 25 * 2 ** i));
    }
  }
}

export const nodeFileSystem: FileSystem = {
  async readFile(path) {
    try {
      return new Uint8Array(await readFile(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  },
  async writeFile(path, data) {
    await writeFile(path, data);
  },
  rename: renameWithRetry,
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  },
  async readdir(path) {
    try {
      return await readdir(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  },
  async remove(path) {
    await rm(path, { recursive: true, force: true, maxRetries: 3 });
  },
};
