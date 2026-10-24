import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The e2e build: identical to the release build plus localhost access and a test hook. */
export const EXTENSION_PATH = fileURLToPath(
  new URL('../apps/extension/.output/chrome-mv3-e2e', import.meta.url),
);
export const RELEASE_MANIFEST = fileURLToPath(
  new URL('../apps/extension/.output/chrome-mv3/manifest.json', import.meta.url),
);

/**
 * A fresh Chromium profile with the extension loaded. The `context` fixture is one; tests that
 * pass a file between two people open a second one.
 */
export async function launchProfile(headed = false) {
  if (!existsSync(join(EXTENSION_PATH, 'manifest.json'))) {
    throw new Error('The extension is not built. Run `pnpm build` before `pnpm e2e`.');
  }
  const userDataDir = mkdtempSync(join(tmpdir(), 'showsteps-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !headed,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      // A headed window covered by another app must keep rendering (desktop tests).
      ...(headed
        ? [
            '--disable-backgrounding-occluded-windows',
            '--disable-features=CalculateNativeWinOcclusion',
          ]
        : []),
    ],
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  return {
    context,
    serviceWorker: worker,
    extensionId: new URL(worker.url()).host,
    close: async () => {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

/** Playwright fixtures that launch Chromium with the built, unpacked extension loaded. */
export const test = base.extend<{
  /** Show a real browser window (desktop tests switch between it and other apps). */
  headed: boolean;
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}>({
  headed: [false, { option: true }],
  context: async ({ headed }, use) => {
    const profile = await launchProfile(headed);
    await use(profile.context);
    await profile.close();
  },
  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
});

export const expect = test.expect;
