import { IDBFactory } from 'fake-indexeddb';
import { createStep, plain, type Step } from '@showsteps/core';
import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_WINDOW_MS,
  RunAttachments,
  htmlAllowed,
  nameFromUrl,
  sameSite,
  type DownloadInfo,
} from '../lib/attachments';
import { blobToBase64, base64ToBytes, linkFileName } from '../lib/fileData';
import { MAX_FILE_BYTES, RunFileStore } from '../lib/runfiles';

const app = { kind: 'web' as const, url: 'https://reports.test/' };
const steps: Step[] = ['open', 'download', 'other', 'upload'].map((t) =>
  createStep({ action: 'click', app, human: { title: plain(t) } }),
);
const [, download, other] = steps as [Step, Step, Step, Step];

function setup(over: Partial<ConstructorParameters<typeof RunAttachments>[1]> = {}) {
  let now = 1000;
  const files = new RunFileStore(new IDBFactory());
  const refetched: DownloadInfo[] = [];
  const run = new RunAttachments(
    'run-1',
    {
      files,
      now: () => now,
      refetch: async (d) => {
        refetched.push(d);
        return new Blob(['%PDF-1.4'], { type: 'application/pdf' });
      },
      ...over,
    },
    () => 'https://reports.test/exports',
  );
  return { run, files, refetched, tick: (ms: number) => (now += ms) };
}

const item = (over: Partial<DownloadInfo> = {}): DownloadInfo => ({
  id: 1,
  url: 'https://reports.test/files/report.pdf',
  finalUrl: 'https://reports.test/files/report.pdf',
  referrer: 'https://reports.test/exports',
  filename: 'C:\\Users\\me\\Downloads\\report.pdf',
  mime: 'application/pdf',
  fileSize: 8,
  state: 'complete',
  ...over,
});

describe('a run’s downloaded files (1.2)', () => {
  it('keeps the file a click downloaded and finds it for the attach step', async () => {
    const { run, refetched } = setup();
    run.noteClick(download.id);
    expect(run.downloadCreated(item())).toBe(true);
    expect(run.lookup({ download: download.id }, steps, 3)).toEqual({
      kind: 'pending',
      stepId: download.id,
      name: 'report.pdf',
    });
    await run.downloadEnded(item());
    expect(refetched).toHaveLength(1);
    const found = run.lookup({ download: 'latest' }, steps, 3);
    expect(found).toEqual({
      kind: 'ready',
      meta: {
        stepId: download.id,
        name: 'report.pdf',
        type: 'application/pdf',
        size: 8,
        from: 'reports.test',
      },
    });
    const blob = found.kind === 'ready' ? await run.blob(found.meta) : undefined;
    expect(await blob?.text()).toBe('%PDF-1.4');
  });

  it('ignores downloads that are late, from an extension, or from another site', () => {
    const late = setup();
    late.run.noteClick(download.id);
    late.tick(DOWNLOAD_WINDOW_MS + 1);
    expect(late.run.downloadCreated(item())).toBe(false);
    const { run } = setup();
    expect(run.downloadCreated(item())).toBe(false); // no click yet
    run.noteClick(download.id);
    expect(run.downloadCreated(item({ byExtensionId: 'abc' }))).toBe(false);
    expect(run.downloadCreated(item({ referrer: 'https://elsewhere.test/' }))).toBe(false);
    expect(run.downloadCreated(item({ referrer: 'https://app.reports.test/' }))).toBe(true);
  });

  it('attaches neither of two downloads from one click', async () => {
    const { run } = setup();
    run.noteClick(download.id);
    run.downloadCreated(item({ id: 1 }));
    run.downloadCreated(item({ id: 2, url: 'https://reports.test/files/b.pdf' }));
    await run.downloadEnded(item({ id: 1 }));
    expect(run.lookup({ download: download.id }, steps, 3)).toMatchObject({
      kind: 'problem',
      problem: 'ambiguous',
    });
  });

  it('refuses files over the cap, failed downloads and refused fetches', async () => {
    const big = setup();
    big.run.noteClick(download.id);
    big.run.downloadCreated(item({ fileSize: MAX_FILE_BYTES + 1 }));
    expect(big.run.lookup({ download: download.id }, steps, 3)).toMatchObject({ problem: 'big' });

    const failed = setup();
    failed.run.noteClick(download.id);
    failed.run.downloadCreated(item());
    await failed.run.downloadEnded(item({ state: 'interrupted' }));
    expect(failed.run.lookup({ download: 'latest' }, steps, 3)).toMatchObject({
      problem: 'failed',
    });

    const refused = setup({ refetch: async () => undefined });
    refused.run.noteClick(download.id);
    refused.run.downloadCreated(item());
    await refused.run.downloadEnded(item());
    expect(refused.run.lookup({ download: download.id }, steps, 3)).toMatchObject({
      kind: 'problem',
      problem: 'failed',
      name: 'report.pdf',
    });
  });

  it('prefers the desktop app’s copy, and the page’s own file over a download', async () => {
    const desktop = setup({ readDownload: async () => new Blob(['from desktop']) });
    desktop.run.noteClick(download.id);
    desktop.run.downloadCreated(item({ url: 'https://reports.test/api/export', finalUrl: '' }));
    await desktop.run.downloadEnded(
      item({ url: 'https://reports.test/api/export', finalUrl: '', fileSize: 12 }),
    );
    expect(desktop.refetched).toHaveLength(0);
    expect(desktop.run.lookup({ download: 'latest' }, steps, 3)).toMatchObject({
      meta: { name: 'report.pdf', size: 12 },
    });

    const page = setup();
    page.run.noteClick(download.id);
    await page.run.keep(download.id, new Blob(['a,b']), 'invoices.csv');
    expect(page.run.downloadCreated(item({ url: 'blob:https://reports.test/x' }))).toBe(true);
    expect(page.run.lookup({ download: 'latest' }, steps, 3)).toMatchObject({
      meta: { name: 'invoices.csv' },
    });
  });

  it('keeps at most 50 MB a run, finds the latest file, and deletes them all at the end', async () => {
    const { run, files } = setup();
    const mb = (n: number) => new Blob([new Uint8Array(n * 1024 * 1024)]);
    expect(await run.keep(download.id, mb(25), 'a.bin')).toBe(true);
    expect(await run.keep(other.id, mb(25), 'b.bin')).toBe(true);
    expect(run.lookup({ download: 'latest' }, steps, 3)).toMatchObject({ meta: { name: 'b.bin' } });
    expect(await run.keep(steps[0]!.id, mb(1), 'c.bin')).toBe(false);
    expect(await files.count()).toBe(2);
    expect(run.lookup({ download: other.id }, steps, 1)).toMatchObject({ kind: 'ready' });
    // Before step 2, the newest is step 1's file, which was over the run's cap.
    expect(run.lookup({ download: 'latest' }, steps, 1)).toMatchObject({ problem: 'big' });
    expect(run.lookup({ download: 'latest' }, steps, 0)).toEqual({ kind: 'none' });
    await run.dispose();
    expect(await files.count()).toBe(0);
  });

  it('cleans up files of runs that ended without a goodbye', async () => {
    const files = new RunFileStore(new IDBFactory());
    await files.put('old', 's1', new Blob(['x']));
    await files.put('live', 's1', new Blob(['y']));
    await files.deleteExcept('live');
    expect(await files.count()).toBe(1);
    expect(await (await files.get('live', 's1'))?.text()).toBe('y');
    await files.deleteExcept(undefined);
    expect(await files.count()).toBe(0);
  });
});

describe('helpers', () => {
  it('names files, compares sites and spots sign-in pages', async () => {
    expect(nameFromUrl('https://x.test/files/report.pdf?x=1')).toBe('report.pdf');
    expect(nameFromUrl('https://x.test/api/export')).toBe('');
    expect(nameFromUrl('blob:https://x.test/abc')).toBe('');
    expect(linkFileName('invoices.csv', 'blob:x')).toBe('invoices.csv');
    expect(linkFileName('', 'https://x.test/a/b%20c.pdf')).toBe('b c.pdf');
    expect(linkFileName(null, 'data:text/plain,hi')).toBe('download');
    expect(sameSite('a.example.com', 'example.com')).toBe(true);
    expect(sameSite('example.com', 'badexample.com')).toBe(false);
    expect(htmlAllowed({ mime: 'text/html', filename: 'x' })).toBe(true);
    expect(htmlAllowed({ mime: 'application/pdf', filename: 'report.pdf' })).toBe(false);
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect([...base64ToBytes(await blobToBase64(new Blob([bytes])))]).toEqual([...bytes]);
  });
});
