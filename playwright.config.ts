import { defineConfig, devices } from '@playwright/test';

const DEMO_PORT = Number(process.env.DEMO_PORT ?? 5173);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${DEMO_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node fixtures/demo-app/server.mjs',
    url: `http://localhost:${DEMO_PORT}/login.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
