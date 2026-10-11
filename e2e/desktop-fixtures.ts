import { _electron, type ElectronApplication } from '@playwright/test';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test as base } from './fixtures';

const DESKTOP = fileURLToPath(new URL('../apps/desktop', import.meta.url));
const ELECTRON = join(DESKTOP, 'node_modules', 'electron', 'dist', 'electron.exe');

type Rect = { x: number; y: number; w: number; h: number };

export interface UiaElementLite {
  name: string;
  controlType: string;
  automationId: string;
  rect: Rect;
  processName: string;
  windowTitle: string;
}

export type InputAction =
  | { type: 'move'; x: number; y: number }
  | { type: 'down' | 'up' | 'click' }
  | { type: 'text'; text: string }
  | { type: 'key'; vk: number }
  | { type: 'wait'; ms: number };

interface Hook {
  helper: {
    input(
      actions: InputAction[],
      requireForeground?: string,
      requireTitle?: string,
    ): Promise<unknown>;
    find(q: Record<string, string>): Promise<UiaElementLite[]>;
    call(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  };
  recorder: {
    current: { status: string; stepCount: number; shared: boolean; lastGuideId?: string };
  };
  guide: { active: boolean };
  bridge: { extensionConnected: boolean };
  startCapture(): Promise<void>;
  finishCapture(): Promise<void>;
  startGuide(id: string): Promise<void>;
  store(): {
    listGuides(): Promise<{ id: string; title: string }[]>;
    getGuide(id: string): Promise<unknown>;
    listImages(id: string): Promise<string[]>;
  };
}
// Evaluated inside the app (serialised), so each call names the global itself.
type Global = { __trailmarkDesktop: Hook };

/** The window a test may send input to: an app and (always, in tests) a unique window title. */
export interface InputTarget {
  app: string;
  title: string;
}

/** The built desktop app, launched with its own library, data and downloads folders. */
export class Desktop {
  /** Where `input` and `click` go by default (set by `openNotepad`). */
  target: InputTarget | undefined;
  /** Notepad processes this test started (the only ones it may close). */
  readonly started: ChildProcess[] = [];

  private constructor(
    readonly app: ElectronApplication,
    readonly dir: string,
  ) {}

  get library(): string {
    return join(this.dir, 'library');
  }

  get downloads(): string {
    return join(this.dir, 'downloads');
  }

  static async launch(): Promise<Desktop> {
    if (!existsSync(join(DESKTOP, 'dist', 'main', 'index.cjs'))) {
      throw new Error('The desktop app is not built. Run `pnpm build` first.');
    }
    const dir = mkdtempSync(join(tmpdir(), 'trailmark-desktop-'));
    mkdirSync(join(dir, 'downloads'));
    const app = await _electron.launch({
      executablePath: ELECTRON,
      args: [DESKTOP],
      env: {
        ...process.env,
        TRAILMARK_E2E: '1',
        TRAILMARK_LIBRARY: join(dir, 'library'),
        TRAILMARK_USER_DATA: join(dir, 'data'),
        TRAILMARK_DOWNLOADS: join(dir, 'downloads'),
      },
    });
    // Main-process errors show up in the test output.
    app.process().stderr?.on('data', (d: Buffer) => process.stderr.write(`[desktop] ${String(d)}`));
    await app.firstWindow();
    return new Desktop(app, dir);
  }

  /**
   * Real mouse and keyboard input, refused by the helper unless the target window (the test's
   * own, by its unique title) is in front, and for clicks under the pointer. A test can never
   * type into someone else's window.
   */
  input(actions: InputAction[], target = this.target): Promise<unknown> {
    if (!target) throw new Error('No input target: open the app under test first');
    return this.app.evaluate(
      (_e, [a, p, t]) => (globalThis as unknown as Global).__trailmarkDesktop.helper.input(a, p, t),
      [actions, target.app, target.title] as const,
    );
  }

  find(query: Record<string, string>): Promise<UiaElementLite[]> {
    return this.app.evaluate(
      (_e, q) => (globalThis as unknown as Global).__trailmarkDesktop.helper.find(q),
      query,
    );
  }

  /** Bring an app's window to the front; true when it is in front afterwards. */
  activate(processName: string, windowTitle?: string): Promise<unknown> {
    return this.app.evaluate(
      (_e, [p, t]) =>
        (globalThis as unknown as Global).__trailmarkDesktop.helper.call('activate', {
          processName: p,
          ...(t ? { windowTitle: t } : {}),
        }),
      [processName, windowTitle] as const,
    );
  }

  /** The Guide Me overlay window's text while it is showing, else ''. */
  async overlayText(): Promise<string> {
    const overlay = this.app.windows().find((w) => w.url().includes('overlay.html'));
    if (!overlay) return '';
    const visible = await this.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(
        (w) => w.webContents.getURL().includes('overlay.html') && w.isVisible(),
      ),
    );
    return visible ? ((await overlay.locator('body').textContent()) ?? '') : '';
  }

  capture(): Promise<{ status: string; stepCount: number; shared: boolean; lastGuideId?: string }> {
    return this.app.evaluate(
      () => (globalThis as unknown as Global).__trailmarkDesktop.recorder.current,
    );
  }

  /** Minimise Trailmark's window so the app under test is in front. */
  async minimise(): Promise<void> {
    await this.app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) if (w.isVisible()) w.minimize();
    });
  }

  startCapture(): Promise<void> {
    return this.app.evaluate(() =>
      (globalThis as unknown as Global).__trailmarkDesktop.startCapture(),
    );
  }

  finishCapture(): Promise<void> {
    return this.app.evaluate(() =>
      (globalThis as unknown as Global).__trailmarkDesktop.finishCapture(),
    );
  }

  startGuide(id: string): Promise<void> {
    return this.app.evaluate(
      (_e, g) => (globalThis as unknown as Global).__trailmarkDesktop.startGuide(g),
      id,
    );
  }

  guideActive(): Promise<boolean> {
    return this.app.evaluate(
      () => (globalThis as unknown as Global).__trailmarkDesktop.guide.active,
    );
  }

  extensionConnected(): Promise<boolean> {
    return this.app.evaluate(
      () => (globalThis as unknown as Global).__trailmarkDesktop.bridge.extensionConnected,
    );
  }

  guides(): Promise<{ id: string; title: string }[]> {
    return this.app.evaluate(() =>
      (globalThis as unknown as Global).__trailmarkDesktop.store().listGuides(),
    );
  }

  guide<T>(id: string): Promise<T> {
    return this.app.evaluate(
      (_e, g) => (globalThis as unknown as Global).__trailmarkDesktop.store().getGuide(g),
      id,
    ) as Promise<T>;
  }

  images(id: string): Promise<string[]> {
    return this.app.evaluate(
      (_e, g) => (globalThis as unknown as Global).__trailmarkDesktop.store().listImages(g),
      id,
    );
  }

  /** The app that owns the top window at a screen point. */
  processAt(x: number, y: number): Promise<string> {
    return this.app.evaluate(
      async (_e, [px, py]) =>
        (
          (await (globalThis as unknown as Global).__trailmarkDesktop.helper.call('windowAt', {
            x: px,
            y: py,
          })) as { processName: string }
        ).processName,
      [x, y] as const,
    );
  }

  /**
   * Click a screen rectangle with the real mouse, at the point nearest its centre that `app`
   * owns (always-on-top windows such as picture-in-picture videos can cover part of it).
   */
  async click(element: { rect: Rect }, target = this.target): Promise<unknown> {
    if (!target) throw new Error('No input target: open the app under test first');
    const { app } = target;
    const { rect } = element;
    const points: [number, number][] = [];
    for (const fy of [0.5, 0.3, 0.7, 0.15, 0.85])
      for (const fx of [0.5, 0.3, 0.7, 0.15, 0.85])
        points.push([Math.round(rect.x + rect.w * fx), Math.round(rect.y + rect.h * fy)]);
    const seen = new Set<string>();
    for (const [x, y] of points) {
      const owner = (await this.processAt(x, y)).toLowerCase();
      seen.add(owner);
      if (owner !== app) continue;
      return this.input(
        [{ type: 'move', x, y }, { type: 'wait', ms: 80 }, { type: 'click' }],
        target,
      );
    }
    throw new Error(`No visible part of ${app} to click (covered by ${[...seen].join(', ')})`);
  }

  async close(): Promise<void> {
    await this.app.close().catch(() => undefined);
    await this.unregisterOwnHost();
    rmSync(this.dir, { recursive: true, force: true });
  }

  /**
   * The app registered its browser connection pointing into this test's temporary folder:
   * remove those registry entries (and only those), so nothing points at a deleted file.
   */
  private async unregisterOwnHost(): Promise<void> {
    for (const browser of ['Google\\Chrome', 'Chromium', 'Microsoft\\Edge']) {
      const key = `HKCU\\Software\\${browser}\\NativeMessagingHosts\\com.trailmark.host`;
      const out = await run('reg', ['query', key, '/ve']).catch(() => undefined);
      if (out?.stdout.toLowerCase().includes(this.dir.toLowerCase()))
        await run('reg', ['delete', key, '/f']).catch(() => undefined);
    }
  }
}

const run = promisify(execFile);

/** Close only the Notepad windows this test opened; anyone else's stay untouched. */
export async function closeNotepads(desktop: Desktop): Promise<void> {
  for (const proc of desktop.started.splice(0))
    if (proc.pid) await run('taskkill', ['/PID', String(proc.pid), '/F']).catch(() => undefined);
}

/**
 * Open Notepad on a new, uniquely named file, bring that window to the front and return its
 * text area. Input then goes only to that window (see `Desktop.input`).
 */
export async function openNotepad(
  desktop: Desktop,
): Promise<{ editor: UiaElementLite; title: string }> {
  await desktop.minimise();
  const title = `trailmark-e2e-${randomUUID().slice(0, 8)}`;
  const file = join(desktop.dir, `${title}.txt`);
  writeFileSync(file, '');
  const proc = spawn('notepad.exe', [file]);
  desktop.started.push(proc);
  for (let i = 0; i < 40; i++) {
    const [editor] = await desktop.find({
      processName: 'notepad',
      windowTitle: title,
      controlType: 'Document',
    });
    if (editor) {
      if ((await desktop.activate('notepad', title)) !== true) {
        await closeNotepads(desktop);
        throw new Error('Could not bring Notepad to the front; no input was sent');
      }
      desktop.target = { app: 'notepad', title };
      return { editor, title };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Notepad did not open');
}

const LOCK = join(tmpdir(), 'trailmark-desktop-e2e.lock');

/**
 * Desktop tests use the real screen, mouse and keyboard, and the app allows one instance: they
 * must never run at the same time, whatever the worker count. A lock file serialises them.
 */
async function takeLock(): Promise<() => void> {
  for (let waited = 0; ; waited += 500) {
    try {
      const fd = openSync(LOCK, 'wx');
      return () => {
        closeSync(fd);
        rmSync(LOCK, { force: true });
      };
    } catch {
      // Left behind by a run that crashed: older than any test.
      if (Date.now() - statSync(LOCK, { throwIfNoEntry: false })!.mtimeMs > 10 * 60_000)
        rmSync(LOCK, { force: true });
      if (waited > 10 * 60_000) throw new Error(`Another desktop test holds ${LOCK}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/** Playwright fixtures for desktop tests (Windows only). */
export const test = base.extend<{ desktop: Desktop }>({
  desktop: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, info) => {
      info.skip(process.platform !== 'win32', 'Windows only');
      const release = await takeLock();
      try {
        const d = await Desktop.launch();
        await use(d);
        await closeNotepads(d);
        await d.close();
      } finally {
        release();
      }
    },
    // Waiting for another desktop test to finish counts against this fixture, not the test.
    { timeout: 15 * 60_000 },
  ],
});

export const expect = test.expect;
