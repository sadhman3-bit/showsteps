import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from './desktop-fixtures';

// S4: when a scheduled run is due and Chrome isn't running, the desktop app starts Chrome.
// The owner's Chrome is never touched: the app is pointed at a stand-in that only writes a file
// and exits, and is told Chrome's process is one that never runs.
const DIR = fileURLToPath(new URL('../test-results/fake-chrome/', import.meta.url));
const EXE = join(DIR, 'FakeChrome.exe');
const MARKER = join(DIR, 'started.txt');

test.use({
  desktopEnv: {
    SHOWSTEPS_TEST_CHROME: EXE,
    SHOWSTEPS_TEST_CHROME_PROCESS: 'showsteps-no-such-process.exe',
    SHOWSTEPS_FAKE_CHROME_MARKER: MARKER,
  },
});

test.beforeAll(() => {
  test.skip(process.platform !== 'win32', 'Windows only');
  mkdirSync(DIR, { recursive: true });
  rmSync(MARKER, { force: true });
  const source = join(DIR, 'FakeChrome.cs');
  writeFileSync(
    source,
    `class FakeChrome {
  static void Main(string[] args) {
    var marker = System.Environment.GetEnvironmentVariable("SHOWSTEPS_FAKE_CHROME_MARKER");
    if (!string.IsNullOrEmpty(marker)) System.IO.File.WriteAllText(marker, "args=" + args.Length);
  }
}
`,
  );
  const csc = join(
    process.env.WINDIR ?? 'C:\\Windows',
    'Microsoft.NET',
    'Framework64',
    'v4.0.30319',
    'csc.exe',
  );
  execFileSync(csc, ['/nologo', '/target:winexe', `/out:${EXE}`, source], { stdio: 'ignore' });
});

test('a due run starts Chrome (with no arguments) when Chrome is closed', async ({ desktop }) => {
  test.setTimeout(60_000);
  // What the extension sends over the bridge: the next run is due in two seconds.
  await desktop.app.evaluate(
    (_e, at) => {
      const d = (
        globalThis as unknown as { __showstepsDesktop: { bridge: { emit(...a: unknown[]): void } } }
      ).__showstepsDesktop;
      d.bridge.emit('event', 'schedule-next', { at });
    },
    new Date(Date.now() + 2000).toISOString(),
  );
  await expect.poll(() => existsSync(MARKER), { timeout: 20_000 }).toBe(true);
  expect(readFileSync(MARKER, 'utf8')).toBe('args=0');
  // The due time is remembered for a restart, then cleared once used.
  const saved = await desktop.app.evaluate(
    () =>
      (globalThis as unknown as { __showstepsDesktop: { wake: { nextDue?: number } } })
        .__showstepsDesktop.wake.nextDue,
  );
  expect(saved).toBeUndefined();
});
