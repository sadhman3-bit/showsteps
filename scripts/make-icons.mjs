// Renders apps/extension/assets/icon.svg to the PNG sizes Chrome wants (public/icon/<size>.png)
// and the desktop app's icon (apps/desktop/resources/icon.png, 256 px for the Windows installer).
// Run: pnpm make:icons (needs pnpm setup:browsers once). Output is committed.
process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const { chromium } = await import('@playwright/test');

const svg = readFileSync(new URL('../apps/extension/assets/icon.svg', import.meta.url), 'utf8');
const out = fileURLToPath(new URL('../apps/extension/public/icon/', import.meta.url));
const desktopIcon = fileURLToPath(new URL('../apps/desktop/resources/icon.png', import.meta.url));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
try {
  const render = async (size) => {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`,
    );
    const png = await page.screenshot({ omitBackground: true });
    await page.close();
    return png;
  };
  for (const size of [16, 32, 48, 128]) writeFileSync(`${out}${size}.png`, await render(size));
  writeFileSync(desktopIcon, await render(256));
  console.log(`Icons written to ${out}`);
} finally {
  await browser.close();
}
