import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

/**
 * 1.2: read a file Chrome just downloaded, for Run for me to attach (bridge method
 * `readDownload`, capability `read-download`). Only a regular file, of the size Chrome reported,
 * at most 25 MB, written in the last 15 minutes. Anything else is refused with a reason.
 */
export const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;
export const DOWNLOAD_FRESH_MS = 15 * 60_000;

export type ReadRefusal = 'path' | 'not-a-file' | 'link' | 'size' | 'too-big' | 'old' | 'missing';

export class ReadDownloadError extends Error {
  constructor(readonly reason: ReadRefusal) {
    super(`read-download: ${reason}`);
  }
}

export async function readDownload(args: unknown, now = Date.now()): Promise<Uint8Array> {
  const { path, size } = (args ?? {}) as { path?: unknown; size?: unknown };
  if (typeof path !== 'string' || !path || !isAbsolute(path) || path.includes('\0'))
    throw new ReadDownloadError('path');
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0)
    throw new ReadDownloadError('size');
  const info = await lstat(path).catch(() => undefined);
  if (!info) throw new ReadDownloadError('missing');
  // lstat doesn't follow links, so a symbolic link or a junction shows up as one.
  if (info.isSymbolicLink()) throw new ReadDownloadError('link');
  if (!info.isFile()) throw new ReadDownloadError('not-a-file');
  if (info.size > MAX_DOWNLOAD_BYTES) throw new ReadDownloadError('too-big');
  if (info.size !== size) throw new ReadDownloadError('size');
  if (now - info.mtimeMs > DOWNLOAD_FRESH_MS) throw new ReadDownloadError('old');
  const bytes = await readFile(path);
  // Changed while reading: not the file Chrome described.
  if (bytes.length !== size) throw new ReadDownloadError('size');
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
}
