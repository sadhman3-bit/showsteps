import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHROME_PROCESS, ScheduleWake, listsProcess, parseRegDefault } from '../src/main/wake';

function harness(processes: string[]) {
  const launched: number[] = [];
  const checked: string[] = [];
  const wake = new ScheduleWake({
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    isRunning: async (name) => {
      checked.push(name);
      return processes.includes(name);
    },
    launch: async () => void launched.push(Date.now()),
  });
  return { wake, launched, checked, processes };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T22:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('opening Chrome for a due run', () => {
  it('starts Chrome at the due time when it isn’t running', async () => {
    const h = harness(['explorer.exe']);
    h.wake.next(Date.now() + 60_000);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(h.launched).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.checked).toEqual([CHROME_PROCESS]);
    expect(h.launched).toHaveLength(1);
    // Once only.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.launched).toHaveLength(1);
  });

  it('does nothing when Chrome is already running (the extension runs it)', async () => {
    const h = harness(['chrome.exe']);
    h.wake.next(Date.now() + 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.launched).toEqual([]);
  });

  it('follows the latest due time, and none clears it', async () => {
    const h = harness([]);
    h.wake.next(Date.now() + 60_000);
    h.wake.next(Date.now() + 120_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.launched).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.launched).toHaveLength(1);
    h.wake.next(Date.now() + 60_000);
    h.wake.next(undefined);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.launched).toHaveLength(1);
    expect(h.wake.nextDue).toBeUndefined();
  });

  it('waits more than 24.8 days by re-arming, and fires at once for a time already past', async () => {
    const h = harness([]);
    const in30Days = Date.now() + 30 * 86_400_000;
    h.wake.next(in30Days);
    await vi.advanceTimersByTimeAsync(29 * 86_400_000);
    expect(h.launched).toEqual([]);
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(h.launched).toEqual([in30Days]);

    const late = harness([]);
    late.wake.next(Date.now() - 5_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(late.launched).toHaveLength(1);
  });

  it('doesn’t start Chrome when it can’t tell whether Chrome is running', async () => {
    const launched: number[] = [];
    const wake = new ScheduleWake({
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      isRunning: async () => {
        throw new Error('tasklist failed');
      },
      launch: async () => void launched.push(1),
    });
    expect(await wake.fire()).toBe(false);
    expect(launched).toEqual([]);
  });
});

describe('Windows output', () => {
  it('reads tasklist CSV', () => {
    const csv =
      '"chrome.exe","1234","Console","1","250,000 K"\r\n"chrome.exe","5678","Console","1","80,000 K"\r\n';
    expect(listsProcess(csv, 'chrome.exe')).toBe(true);
    expect(
      listsProcess('INFO: No tasks are running which match the specified criteria.', 'chrome.exe'),
    ).toBe(false);
    expect(listsProcess('"chromedriver.exe","1","Console","1","1 K"', 'chrome.exe')).toBe(false);
  });

  it('reads Chrome’s path from App Paths', () => {
    const out =
      '\r\nHKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe\r\n    (Default)    REG_SZ    C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\r\n';
    expect(parseRegDefault(out)).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    expect(
      parseRegDefault('ERROR: The system was unable to find the specified registry key'),
    ).toBeUndefined();
  });
});
