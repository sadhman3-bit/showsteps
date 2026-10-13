import { expect, test } from './fixtures';

// Everything ShowSteps shows is bundled: no fonts, scripts or styles from the internet.
test('extension pages load nothing from outside the extension (fonts are bundled)', async ({
  context,
  extensionId,
}) => {
  const outside: string[] = [];
  context.on('request', (r) => {
    const url = r.url();
    if (!/^(chrome-extension|data|blob):/.test(url)) outside.push(url);
  });
  for (const path of ['library.html', 'sidepanel.html']) {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${path}`);
    await page.waitForLoadState('networkidle');
    // The interface fonts are the bundled ones.
    const families = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
    });
    expect(families.join()).toMatch(/Funnel Sans/);
    await page.close();
  }
  expect(outside.filter((u) => /fonts\.(googleapis|gstatic)\.com/.test(u))).toEqual([]);
  expect(outside).toEqual([]);
});
