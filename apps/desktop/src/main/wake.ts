import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** The process Chrome runs as. */
export const CHROME_PROCESS = 'chrome.exe';
/** Where Windows records Chrome's install path (per user first, then for all users). */
const APP_PATHS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
];
/** setTimeout can't wait longer than about 24.8 days; longer waits re-arm in steps. */
const MAX_TIMER_MS = 2 ** 31 - 1;

export interface WakeDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Is the process running for this Windows user? */
  isRunning(processName: string): Promise<boolean>;
  /** Start Chrome with no URL and no arguments. */
  launch(): Promise<void>;
}

/**
 * S4: the extension tells the desktop app when the next scheduled run is due. At that time, if
 * Chrome isn't running for this user, the app starts it (and nothing else), so the extension's
 * start-up catch-up can run the schedule.
 */
export class ScheduleWake {
  private timer: unknown;
  private due: number | undefined;

  constructor(private readonly deps: WakeDeps) {}

  get nextDue(): number | undefined {
    return this.due;
  }

  /** The next due time (or none). Replaces any earlier one. */
  next(at: number | undefined): void {
    if (this.timer !== undefined) this.deps.clearTimer(this.timer);
    this.timer = undefined;
    this.due = at;
    if (at === undefined || !Number.isFinite(at)) return;
    this.arm();
  }

  private arm(): void {
    const due = this.due;
    if (due === undefined) return;
    const wait = Math.max(0, due - this.deps.now());
    this.timer = this.deps.setTimer(
      () => {
        this.timer = undefined;
        if (this.due !== due) return;
        if (due > this.deps.now()) this.arm();
        else void this.fire();
      },
      Math.min(wait, MAX_TIMER_MS),
    );
  }

  /** The run is due: start Chrome if it isn't running. Returns whether it was started. */
  async fire(): Promise<boolean> {
    this.due = undefined;
    if (await this.deps.isRunning(CHROME_PROCESS).catch(() => true)) return false;
    await this.deps.launch();
    return true;
  }
}

/** Whether `tasklist` CSV output lists the process (it prints an INFO line when none match). */
export function listsProcess(csv: string, processName: string): boolean {
  const name = processName.toLowerCase();
  return csv.split(/\r?\n/).some((line) => line.trim().toLowerCase().startsWith(`"${name}"`));
}

/** The path in a `reg query … /ve` reply ("(Default)    REG_SZ    C:\…\chrome.exe"). */
export function parseRegDefault(output: string): string | undefined {
  const m = /REG_(?:EXPAND_)?SZ\s+(.+\.exe)\s*$/im.exec(output);
  return m?.[1]?.trim();
}

/** Processes of this name running for the current Windows user. */
export async function isRunningForUser(processName: string): Promise<boolean> {
  const { stdout } = await run(
    'tasklist',
    [
      '/FI',
      `IMAGENAME eq ${processName}`,
      '/FI',
      `USERNAME eq ${process.env.USERDOMAIN ?? ''}\\${process.env.USERNAME ?? ''}`,
      '/FO',
      'CSV',
      '/NH',
    ],
    { windowsHide: true },
  );
  return listsProcess(stdout, processName);
}

/** Chrome's path from the registry (App Paths), or undefined if Chrome isn't installed. */
export async function chromePath(): Promise<string | undefined> {
  for (const key of APP_PATHS) {
    try {
      const { stdout } = await run('reg', ['query', key, '/ve'], { windowsHide: true });
      const path = parseRegDefault(stdout);
      if (path) return path;
    } catch {
      // not installed for this scope
    }
  }
  return undefined;
}

/** Start a program with no arguments, detached from the app. */
export function startDetached(path: string): void {
  spawn(path, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
}
