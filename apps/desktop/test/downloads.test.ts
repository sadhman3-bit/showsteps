import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MAX_DOWNLOAD_BYTES, readDownload } from '../src/main/downloads';

const dir = mkdtempSync(join(tmpdir(), 'showsteps-downloads-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const file = (name: string, bytes: Buffer | string) => {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
};
const refused = (args: unknown, now?: number) =>
  readDownload(args, now).then(
    () => 'read',
    (e: Error) => e.message,
  );

describe('reading a download for Run for me (1.2)', () => {
  it('reads a fresh regular file of the size Chrome reported', async () => {
    const path = file('statement.pdf', '%PDF-1.4');
    const bytes = await readDownload({ path, size: 8 });
    expect(Buffer.from(bytes).toString()).toBe('%PDF-1.4');
  });

  it('refuses a relative path, a folder, a link, a missing file and bad arguments', async () => {
    expect(await refused({ path: 'statement.pdf', size: 8 })).toBe('read-download: path');
    expect(await refused({ path: '', size: 8 })).toBe('read-download: path');
    expect(await refused(undefined)).toBe('read-download: path');
    expect(await refused({ path: join(dir, 'x.pdf'), size: -1 })).toBe('read-download: size');
    expect(await refused({ path: join(dir, 'gone.pdf'), size: 1 })).toBe('read-download: missing');
    const folder = join(dir, 'folder');
    mkdirSync(folder);
    expect(await refused({ path: folder, size: 0 })).toBe('read-download: not-a-file');
    // A junction needs no special rights on Windows; it is refused like any link.
    const junction = join(dir, 'junction');
    symlinkSync(folder, junction, 'junction');
    expect(await refused({ path: junction, size: 0 })).toBe('read-download: link');
  });

  it('refuses a size that doesn’t match, a file over 25 MB and an old file', async () => {
    const path = file('report.pdf', '%PDF-1.4');
    expect(await refused({ path, size: 9 })).toBe('read-download: size');
    const big = file('big.bin', Buffer.alloc(MAX_DOWNLOAD_BYTES + 1));
    expect(await refused({ path: big, size: MAX_DOWNLOAD_BYTES + 1 })).toBe(
      'read-download: too-big',
    );
    const old = file('old.pdf', '%PDF-1.4');
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    utimesSync(old, hourAgo, hourAgo);
    expect(await refused({ path: old, size: 8 })).toBe('read-download: old');
  });
});
