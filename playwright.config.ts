import { defineConfig, devices } from '@playwright/test';

const DEMO_PORT = Number(process.env.DEMO_PORT ?? 5173);

export default defineConfig({
  testDir: './e2e',
  // Agent Pack replays written by e2e/agent.spec.ts run in their own nested Playwright.
  testIgnore: '**/.replay/**',
  fullyParallel: false,
  // Recording tests take real screenshots; parallel browsers on small CI machines skew timing.
  workers: process.env.CI ? 1 : 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${DEMO_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [
        /desktop.*.spec.ts/,
        /agent-replay.spec.ts/,
        /store-images.spec.ts/,
        /design-shots.spec.ts/,
        '**/.replay/**',
      ],
    },
    // Starts a second Playwright and browser: after the extension tests, so it never slows them.
    { name: 'replay', testMatch: /agent-replay.spec.ts/, dependencies: ['chromium'] },
    // Chrome Web Store images, on demand: `pnpm store:images`.
    { name: 'store', testMatch: /store-images.spec.ts/, use: { ...devices['Desktop Chrome'] } },
    // Design review screenshots, on demand: `pnpm design:shots`.
    { name: 'design', testMatch: /design-shots.spec.ts/, use: { ...devices['Desktop Chrome'] } },
    // Windows only: drives the real mouse and keyboard, so it runs on its own (pnpm e2e:desktop).
    { name: 'desktop', testMatch: /desktop.*.spec.ts/ },
  ],
  webServer: {
    command: 'node fixtures/demo-app/server.mjs',
    url: `http://localhost:${DEMO_PORT}/login.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
