import { _electron, type ElectronApplication } from '@playwright/test';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
    input(actions: InputAction[], requireForeground?: string): Promise<unknown>;
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

/** The built desktop app, launched with its own library, data and downloads folders. */
export class Desktop {
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
   * Real mouse and keyboard input, refused by the helper unless `app` is in front (and, for
   * clicks, under the pointer), so a test can never type into someone else's window.
   */
  input(actions: InputAction[], app = 'notepad'): Promise<unknown> {
    return this.app.evaluate(
      (_e, [a, p]) => (globalThis as unknown as Global).__trailmarkDesktop.helper.input(a, p),
      [actions, app] as const,
    );
  }

  find(query: Record<string, string>): Promise<UiaElementLite[]> {
    return this.app.evaluate(
      (_e, q) => (globalThis as unknown as Global).__trailmarkDesktop.helper.find(q),
      query,
    );
  }

  activate(processName: string): Promise<unknown> {
    return this.app.evaluate(
      (_e, p) =>
        (globalThis as unknown as Global).__trailmarkDesktop.helper.call('activate', {
          processName: p,
        }),
      processName,
    );
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
  async click(element: { rect: Rect }, app = 'notepad'): Promise<unknown> {
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
      return this.input([{ type: 'move', x, y }, { type: 'wait', ms: 80 }, { type: 'click' }], app);
    }
    throw new Error(`No visible part of ${app} to click (covered by ${[...seen].join(', ')})`);
  }

  async close(): Promise<void> {
    await this.app.close().catch(() => undefined);
    rmSync(this.dir, { recursive: true, force: true });
  }
}

const run = promisify(execFile);

export async function closeNotepad(): Promise<void> {
  await run('taskkill', ['/IM', 'notepad.exe', '/F']).catch(() => undefined);
}

/** Start Notepad, bring it to the front and return its text area. */
export async function openNotepad(
  desktop: Desktop,
): Promise<{ proc: ChildProcess; editor: UiaElementLite }> {
  await closeNotepad();
  await desktop.minimise();
  const proc = spawn('notepad.exe');
  for (let i = 0; i < 40; i++) {
    const [editor] = await desktop.find({ processName: 'notepad', controlType: 'Document' });
    if (editor) {
      if ((await desktop.activate('notepad')) !== true) {
        await closeNotepad();
        throw new Error('Could not bring Notepad to the front; no input was sent');
      }
      return { proc, editor };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Notepad did not open');
}

/** Playwright fixtures for desktop tests (Windows only). */
export const test = base.extend<{ desktop: Desktop }>({
  // eslint-disable-next-line no-empty-pattern
  desktop: async ({}, use, info) => {
    info.skip(process.platform !== 'win32', 'Windows only');
    const d = await Desktop.launch();
    await use(d);
    await d.close();
    await closeNotepad();
  },
});

export const expect = test.expect;
