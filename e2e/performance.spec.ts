import { expect, test } from './fixtures';

// M9: a guide of 50+ steps (with pictures) stays smooth: it opens quickly, typing keeps up,
// and the Agent view and reader render without long waits.

type Guide = { id: string; title: string; blocks: { kind: string; id: string }[] };
declare const __trailmark: {
  installSamples(): Promise<string[]>;
  store: {
    listGuides(): Promise<{ id: string; title: string }[]>;
    getGuide(id: string): Promise<Guide>;
    saveGuide(g: Guide): Promise<void>;
    listImages(id: string): Promise<string[]>;
    getImage(id: string, name: string): Promise<Uint8Array | undefined>;
    putImage(id: string, name: string, bytes: Uint8Array): Promise<void>;
  };
};

test('a 68-step guide opens, edits and renders smoothly', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  test.setTimeout(120_000);
  // Four copies of the 17-step sample in one guide, pictures included.
  const id = await sw.evaluate(async () => {
    await __trailmark.installSamples();
    const summary = (await __trailmark.store.listGuides()).find((g) =>
      g.title.startsWith('Create a supplier invoice'),
    )!;
    const g = await __trailmark.store.getGuide(summary.id);
    const copy: Guide = { ...g, id: crypto.randomUUID(), title: 'Long guide', blocks: [] };
    for (let round = 0; round < 4; round++)
      for (const b of g.blocks)
        copy.blocks.push({ ...structuredClone(b), id: crypto.randomUUID() });
    for (const name of await __trailmark.store.listImages(g.id)) {
      const bytes = await __trailmark.store.getImage(g.id, name);
      if (bytes) await __trailmark.store.putImage(copy.id, name, bytes);
    }
    await __trailmark.store.saveGuide(copy);
    return copy.id;
  });

  const page = await context.newPage();
  const started = Date.now();
  await page.goto(`chrome-extension://${extensionId}/library.html#/guide/${id}`);
  await expect(page.getByRole('textbox', { name: 'Step 68 title' })).toBeAttached();
  const openMs = Date.now() - started;

  // Typing into a step title near the end: each keystroke shows straight away.
  const title = page.getByRole('textbox', { name: 'Step 60 title' });
  await title.click();
  await page.keyboard.press('End');
  const typed = ' and check it';
  const t0 = Date.now();
  await page.keyboard.type(typed, { delay: 0 });
  await expect(title).toContainText(typed);
  const typeMs = Date.now() - t0;

  // Long tasks while scrolling through the whole guide.
  const longTasks = await page.evaluate(async () => {
    let worst = 0;
    const observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) worst = Math.max(worst, e.duration);
    });
    observer.observe({ type: 'longtask', buffered: false });
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    await new Promise((r) => setTimeout(r, 300));
    observer.disconnect();
    return worst;
  });

  const a0 = Date.now();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByRole('listitem', { name: /^Step 68:/ })).toBeAttached();
  const agentMs = Date.now() - a0;

  const r0 = Date.now();
  await page.goto(`chrome-extension://${extensionId}/library.html#/guide/${id}/view`);
  await expect(page.getByRole('heading', { name: 'Long guide' })).toBeVisible();
  await expect(page.locator('.tm-step').last()).toBeAttached();
  const readerMs = Date.now() - r0;

  console.log('PERF', JSON.stringify({ openMs, typeMs, longTasks, agentMs, readerMs }));
  test.info().annotations.push({
    type: 'performance',
    description: JSON.stringify({ openMs, typeMs, longTasks, agentMs, readerMs }),
  });
  expect(openMs).toBeLessThan(3000);
  expect(typeMs).toBeLessThan(1500);
  expect(longTasks).toBeLessThan(200);
  expect(agentMs).toBeLessThan(1500);
  expect(readerMs).toBeLessThan(3000);
});
