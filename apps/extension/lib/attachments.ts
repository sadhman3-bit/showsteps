import type { AttachSource, Step } from '@showsteps/core';
import { MAX_FILE_BYTES, MAX_RUN_BYTES, type RunFileStore } from './runfiles';

/** A file the run keeps for an attach step (its contents are in `RunFileStore`). */
export interface RunFileMeta {
  stepId: string;
  name: string;
  type: string;
  size: number;
  /** The host it was downloaded from. */
  from?: string;
}

/** Why a step's download can't be attached. */
export type FileProblem = 'big' | 'ambiguous' | 'failed';

/** What a run knows about the file an attach step wants. */
export type FileLookup =
  | { kind: 'ready'; meta: RunFileMeta }
  | { kind: 'pending'; stepId: string; name?: string }
  | { kind: 'problem'; stepId: string; problem: FileProblem; name?: string }
  | { kind: 'none'; stepId?: string };

/** The parts of `chrome.downloads.DownloadItem` the watch reads. */
export interface DownloadInfo {
  id: number;
  url: string;
  finalUrl?: string;
  referrer?: string;
  filename: string;
  mime?: string;
  fileSize?: number;
  totalBytes?: number;
  byExtensionId?: string;
  state?: string;
}

export interface AttachDeps {
  files: RunFileStore;
  /** Fetch a completed download's URL again (with the site's cookies), checked; or undefined. */
  refetch(download: DownloadInfo): Promise<Blob | undefined>;
  /** The desktop app reads the downloaded file (capability `read-download`), when connected. */
  readDownload?(download: DownloadInfo): Promise<Blob | undefined>;
  now(): number;
}

/** Downloads that start this long after a Run for me click belong to it. */
export const DOWNLOAD_WINDOW_MS = 10_000;

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? '';

/** A file name from a URL's last path segment, when it looks like one (has an extension). */
export function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return '';
    const last = decodeURIComponent(u.pathname.split('/').pop() ?? '');
    return /\.[a-z0-9]{1,8}$/i.test(last) ? last : '';
  } catch {
    return '';
  }
}

/** The host of a URL, or ''. */
export function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
}

/** Same site: the same host, or one inside the other (app.example.com and example.com). */
export function sameSite(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/** Whether an HTML response is the file (an .html download) rather than, say, a sign-in page. */
export function htmlAllowed(download: Pick<DownloadInfo, 'mime' | 'filename'>): boolean {
  return /html/i.test(download.mime ?? '') || /\.html?$/i.test(download.filename);
}

/**
 * One run's downloaded files: from Run for me's own clicks only. A file comes either from the
 * page (a `blob:`/`data:` link read before the click) or from Chrome's downloads, matched to the
 * click that started them.
 */
export class RunAttachments {
  private files: RunFileMeta[];
  private problems = new Map<string, { problem: FileProblem; name?: string }>();
  /** Downloads in progress, by download ID: the step whose click started each. */
  private pending = new Map<number, { stepId: string; name?: string }>();
  /** Steps whose click started a download (to tell "didn't arrive" from "nothing seen"). */
  private seen = new Set<string>();
  private lastClick: { stepId: string; at: number } | undefined;

  constructor(
    readonly runId: string,
    private readonly deps: AttachDeps,
    /** The run tab's site: downloads referred from elsewhere aren't the run's. */
    private site: () => string,
    files: readonly RunFileMeta[] = [],
  ) {
    this.files = [...files];
  }

  /** What the run keeps, for `PersistedGuidance`. */
  get metas(): RunFileMeta[] {
    return [...this.files];
  }

  private get total(): number {
    return this.files.reduce((n, f) => n + f.size, 0);
  }

  /** Run for me is about to click a step's element: downloads soon after belong to it. */
  noteClick(stepId: string): void {
    this.lastClick = { stepId, at: this.deps.now() };
  }

  /** Keep a file for a step, within the caps. */
  async keep(stepId: string, blob: Blob, name: string, from?: string): Promise<boolean> {
    if (blob.size > MAX_FILE_BYTES || this.total + blob.size > MAX_RUN_BYTES) {
      this.problems.set(stepId, { problem: 'big', name });
      return false;
    }
    await this.deps.files.put(this.runId, stepId, blob);
    this.files = [
      ...this.files.filter((f) => f.stepId !== stepId),
      {
        stepId,
        name: name || 'download',
        type: blob.type,
        size: blob.size,
        ...(from ? { from } : {}),
      },
    ];
    this.problems.delete(stepId);
    this.seen.add(stepId);
    return true;
  }

  /** A file the page handed over was too big to read. */
  tooBig(stepId: string, name: string): void {
    this.problems.set(stepId, { problem: 'big', name });
    this.seen.add(stepId);
  }

  /** `downloads.onCreated`: claim it for the last click if it's the run's own. */
  downloadCreated(item: DownloadInfo): boolean {
    const click = this.lastClick;
    if (!click || this.deps.now() - click.at > DOWNLOAD_WINDOW_MS) return false;
    if (item.byExtensionId) return false;
    const referrer = hostOf(item.referrer);
    if (referrer && !sameSite(referrer, hostOf(this.site()))) return false;
    // The page already handed this step's file over (a blob: link): nothing more to fetch.
    if (this.files.some((f) => f.stepId === click.stepId)) return true;
    const name = nameFromUrl(item.finalUrl || item.url) || baseName(item.filename) || undefined;
    // Two downloads from one click: which one the person meant can't be told, so neither.
    if (
      [...this.pending.values()].some((p) => p.stepId === click.stepId) ||
      this.seen.has(click.stepId)
    ) {
      this.problems.set(click.stepId, { problem: 'ambiguous', ...(name ? { name } : {}) });
      for (const [id, p] of this.pending) if (p.stepId === click.stepId) this.pending.delete(id);
      return true;
    }
    this.seen.add(click.stepId);
    this.pending.set(item.id, { stepId: click.stepId, ...(name ? { name } : {}) });
    if ((item.fileSize ?? item.totalBytes ?? 0) > MAX_FILE_BYTES) {
      this.pending.delete(item.id);
      this.problems.set(click.stepId, { problem: 'big', ...(name ? { name } : {}) });
    }
    return true;
  }

  /** The download finished (or failed): fetch its file. */
  async downloadEnded(item: DownloadInfo): Promise<void> {
    const p = this.pending.get(item.id);
    if (!p) return;
    this.pending.delete(item.id);
    if (item.state !== 'complete') {
      this.problems.set(p.stepId, { problem: 'failed', ...(p.name ? { name: p.name } : {}) });
      return;
    }
    const name = nameFromUrl(item.finalUrl || item.url) || baseName(item.filename) || 'download';
    if ((item.fileSize ?? 0) > MAX_FILE_BYTES) {
      this.problems.set(p.stepId, { problem: 'big', name });
      return;
    }
    const blob =
      (await this.deps.readDownload?.(item).catch(() => undefined)) ??
      (await this.deps.refetch(item).catch(() => undefined));
    if (!blob) {
      this.problems.set(p.stepId, { problem: 'failed', name });
      return;
    }
    const typed = blob.type || !item.mime ? blob : new Blob([blob], { type: item.mime });
    await this.keep(p.stepId, typed, name, hostOf(item.finalUrl || item.url) || undefined);
  }

  /** Whether downloads were seen for a step. */
  sawDownload(stepId: string): boolean {
    return this.seen.has(stepId);
  }

  /** The file an attach step wants: `steps` are the guide's steps, `index` the attach step's. */
  lookup(from: AttachSource, steps: readonly Step[], index: number): FileLookup {
    let stepId: string | undefined;
    if (from.download === 'latest') {
      // The most recent of the earlier steps that produced (or tried to produce) a file.
      stepId = steps
        .slice(0, Math.max(index, 0))
        .reverse()
        .find(
          (s) =>
            this.files.some((f) => f.stepId === s.id) ||
            this.problems.has(s.id) ||
            [...this.pending.values()].some((p) => p.stepId === s.id),
        )?.id;
      if (!stepId) return { kind: 'none' };
    } else stepId = from.download;
    const meta = this.files.find((f) => f.stepId === stepId);
    if (meta) return { kind: 'ready', meta };
    const pending = [...this.pending.values()].find((p) => p.stepId === stepId);
    if (pending)
      return { kind: 'pending', stepId, ...(pending.name ? { name: pending.name } : {}) };
    const problem = this.problems.get(stepId);
    if (problem) return { kind: 'problem', stepId, ...problem };
    return { kind: 'none', stepId };
  }

  async blob(meta: RunFileMeta): Promise<Blob | undefined> {
    return this.deps.files.get(this.runId, meta.stepId);
  }

  /** The run ended: delete its files. */
  async dispose(): Promise<void> {
    this.files = [];
    this.pending.clear();
    await this.deps.files.deleteRun(this.runId).catch(() => undefined);
  }
}
