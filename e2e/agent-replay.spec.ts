import { agentPackFiles } from '@trailmark/core/export';
import { parseGuide } from '@trailmark/core';
import { strFromU8, unzipSync } from 'fflate';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// U10: the Agent Pack's Playwright replay, run against the demo app. It starts its own
// Playwright and browser, so it runs as its own project after the extension tests.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SAMPLE = join(ROOT, 'apps/extension/public/samples/create-invoice.trailmark');

test('the Agent Pack’s Playwright replay runs the demo flow and stops before confirm steps (U10)', async () => {
  test.setTimeout(180_000);
  const guide = parseGuide(JSON.parse(strFromU8(unzipSync(readFileSync(SAMPLE))['guide.json']!)));
  const { name, files } = agentPackFiles({ guide, images: new Map() });
  const dir = join(ROOT, 'e2e', '.replay');
  rmSync(dir, { recursive: true, force: true });
  for (const [path, bytes] of Object.entries(files)) {
    const out = join(dir, name, path);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, bytes);
  }
  writeFileSync(
    join(dir, 'replay.config.mjs'),
    `export default { testDir: '.', testMatch: '**/replay.spec.ts', outputDir: 'results', reporter: [['json', { outputFile: 'results.json' }]], use: { headless: true } };\n`,
  );
  const run = (env: Record<string, string>) => {
    const result = spawnSync(
      process.execPath,
      [join(ROOT, 'scripts/playwright.mjs'), 'test', '-c', join(dir, 'replay.config.mjs')],
      { cwd: dir, env: { ...process.env, TM_PASSWORD: 'demo-password', ...env }, encoding: 'utf8' },
    );
    const report = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8')) as {
      suites: {
        specs: {
          tests: {
            results: { status: string }[];
            annotations: { type: string; description: string }[];
          }[];
        }[];
      }[];
    };
    const t = report.suites[0]!.specs[0]!.tests[0]!;
    return {
      code: result.status,
      status: t.results[0]!.status,
      annotations: t.annotations,
      out: result.stdout,
    };
  };
  // Without approval it stops before "Submit invoice".
  const stopped = run({});
  expect(stopped.status, stopped.out).toBe('passed');
  expect(stopped.annotations).toContainEqual({
    type: 'stopped',
    description: 'Step 17 needs confirmation: set TRAILMARK_ALLOW_CONFIRM=1 to do it',
  });
  // With approval it submits, and the recorded expectations (address, message) hold.
  const done = run({ TRAILMARK_ALLOW_CONFIRM: '1' });
  expect(done.status, done.out).toBe('passed');
  expect(done.annotations).toEqual([]);
});
