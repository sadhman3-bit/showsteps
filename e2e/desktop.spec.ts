import { expect, openNotepad, test } from './desktop-fixtures';

type Step = {
  kind: 'step';
  action: string;
  app: { kind: string; processName?: string };
  input?: { value?: string; sensitive: boolean };
  human: {
    title: { spans: { text: string }[] };
    screenshot?: { file: string; width: number; height: number };
    actionBox?: { x: number; y: number; w: number; h: number };
  };
  target?: { uia?: { controlType?: string; processName?: string } };
};
type Guide = {
  id: string;
  title: string;
  blocks: Step[];
  apps: { kind: string; processName?: string }[];
};
const titleOf = (s: Step) => s.human.title.spans.map((x) => x.text).join('');

test('desktop capture (C8): Notepad clicks and typing become steps with pre-click screenshots', async ({
  desktop,
}) => {
  test.setTimeout(120_000);
  const { editor } = await openNotepad(desktop);
  await desktop.startCapture();
  await expect.poll(async () => (await desktop.capture()).status).toBe('recording');

  // Click into the text area, type, then open the Format menu and close it.
  await desktop.click(editor);
  await desktop.input([
    { type: 'text', text: 'Invoice 1043 approved' },
    { type: 'wait', ms: 600 },
  ]);
  const [format] = await desktop.find({
    processName: 'notepad',
    controlType: 'MenuItem',
    name: 'Format',
  });
  expect(format).toBeTruthy();
  await desktop.click(format!);
  await desktop.input([
    { type: 'wait', ms: 500 },
    { type: 'key', vk: 0x1b },
    { type: 'wait', ms: 300 },
  ]);
  await expect
    .poll(async () => (await desktop.capture()).stepCount, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(2);

  await desktop.finishCapture();
  const [summary] = await desktop.guides();
  expect(summary).toBeTruthy();
  const guide = await desktop.guide<Guide>(summary!.id);
  const steps = guide.blocks.filter((b) => b.kind === 'step');
  // The click into the text box merges with the typing that follows it.
  expect(steps.map(titleOf)).toEqual([
    'Type Invoice 1043 approved into Text Editor',
    'Click Format',
    'Press Esc',
  ]);
  expect(steps[0]!.input).toEqual({
    mode: 'fixed',
    value: 'Invoice 1043 approved',
    sensitive: false,
  });
  expect(steps.every((s) => s.app.kind === 'desktop' && s.app.processName === 'notepad')).toBe(
    true,
  );
  expect(guide.apps).toContainEqual({ kind: 'desktop', processName: 'notepad' });

  // Screenshots at native resolution with the highlight on the element clicked.
  const first = steps[0]!;
  expect(first.human.screenshot?.file).toMatch(/^img\/.+\.png$/);
  expect(first.human.screenshot!.width).toBeGreaterThan(800);
  expect(first.human.actionBox!.w).toBeGreaterThan(100);
  const images = await desktop.images(guide.id);
  expect(images.filter((n) => !n.includes('.thumb.'))).toHaveLength(
    new Set(steps.map((s) => s.human.screenshot?.file)).size,
  );

  // The guide opens in the desktop app's editor.
  const win = await desktop.app.firstWindow();
  await win.evaluate((id) => (location.hash = `#/guide/${id}`), guide.id);
  await expect(win.getByRole('textbox', { name: 'Step 1 title' })).toHaveText(
    'Type Invoice 1043 approved into Text Editor',
  );
  await win.screenshot({ path: test.info().outputPath('desktop-editor.png') });
});
