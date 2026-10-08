// Runs the Playwright CLI with browsers kept inside node_modules (PLAYWRIGHT_BROWSERS_PATH=0).
// Why: on some Windows 10 machines Playwright's full Chromium fails to start from
// %LOCALAPPDATA%\ms-playwright ("side-by-side configuration is incorrect"), which breaks
// extension tests. Keeping browsers in the project avoids it and makes the setup self-contained.
// Usage: node scripts/playwright.mjs <playwright args...>
import { spawnSync } from 'node:child_process';

const result = spawnSync('pnpm', ['exec', 'playwright', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' },
});
process.exit(result.status ?? 1);
