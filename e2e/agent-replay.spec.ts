import { agentPackFiles } from '@showsteps/core/export';
import { createGuide, createStep, parseGuide, plain, type Guide } from '@showsteps/core';
import { strFromU8, unzipSync } from 'fflate';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// U10: the Agent Pack's Playwright replay, run against the demo app. It starts its own
// Playwright and browser, so it runs as its own project after the extension tests.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SAMPLE = join(ROOT, 'apps/extension/public/samples/create-invoice.showsteps');

/** Writes the guide's Agent Pack to `e2e/.replay/<dir>` and returns a runner for its replay. */
function packFor(guide: Guide, folder: string) {
  const { name, files } = agentPackFiles({ guide, images: new Map() });
  const dir = join(ROOT, 'e2e', '.replay', folder);
  rmSync(dir, { recursive: true, force: true });
  for (const [path, bytes] of Object.entries(files)) {
    const out = join(dir, name, path);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, bytes);
  }
  writeFileSync(
    join(dir, 'replay.config.mjs'),
    `export default { testDir: '.', testMatch: '**/replay.spec.ts', outputDir: 'results', reporter: [['json', { outputFile: 'results.json' }]], use: { headless: true } };
`,
  );
  return (env: Record<string, string>) => {
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
}

test('the Agent Pack’s Playwright replay runs the demo flow and stops before confirm steps (U10)', async () => {
  test.setTimeout(180_000);
  const guide = parseGuide(JSON.parse(strFromU8(unzipSync(readFileSync(SAMPLE))['guide.json']!)));
  const run = packFor(guide, 'invoice');
  // Without approval it stops before "Submit invoice".
  const stopped = run({});
  expect(stopped.status, stopped.out).toBe('passed');
  expect(stopped.annotations).toContainEqual({
    type: 'stopped',
    description: 'Step 17 needs confirmation: set SHOWSTEPS_ALLOW_CONFIRM=1 to do it',
  });
  // With approval it submits, and the recorded expectations (address, message) hold.
  const done = run({ SHOWSTEPS_ALLOW_CONFIRM: '1' });
  expect(done.status, done.out).toBe('passed');
  expect(done.annotations).toEqual([]);
});

test('the replay attaches the file an earlier step downloaded (1.2)', async () => {
  test.setTimeout(120_000);
  const box = { bbox: { x: 0, y: 0, w: 1, h: 1 }, point: { x: 0, y: 0 }, selectors: [] };
  const exportsPage = { kind: 'web' as const, url: 'http://localhost:5173/exports.html' };
  const sendPage = { kind: 'web' as const, url: 'http://localhost:5173/send.html' };
  const download = createStep({
    action: 'click',
    app: exportsPage,
    target: { ...box, role: 'link', name: 'Download PDF' },
    human: { title: plain('Click Download PDF') },
  });
  const guide = createGuide({
    title: 'Send the monthly report',
    blocks: [
      createStep({ action: 'navigate', app: exportsPage, human: { title: plain('Open Exports') } }),
      download,
      createStep({ action: 'navigate', app: sendPage, human: { title: plain('Open Send') } }),
      createStep({
        action: 'upload',
        app: sendPage,
        target: { ...box, label: 'Attachment' },
        input: {
          mode: 'fixed',
          value: 'report.pdf',
          sensitive: false,
          from: { download: download.id },
        },
        human: { title: plain('Upload report.pdf') },
        agent: {
          timeoutMs: 10_000,
          confirm: false,
          visualOnly: false,
          expect: [{ type: 'text', contains: 'report.pdf (' }],
        },
      }),
    ],
  });
  const result = packFor(guide, 'attach')({});
  expect(result.status, result.out).toBe('passed');
  expect(result.annotations).toEqual([]);
});
