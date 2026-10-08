import { expect, test } from './fixtures';

test('extension loads and its side panel renders', async ({ context, extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);

  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.getByRole('heading', { name: 'Trailmark' })).toBeVisible();
  await expect(page.getByText('Nothing is uploaded')).toBeVisible();
  expect(errors).toEqual([]);
});

test('manifest asks for no host permissions at install', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/manifest.json`);
  const manifest = JSON.parse((await page.locator('body').innerText()) || '{}');
  expect(manifest.host_permissions ?? []).toEqual([]);
  expect(manifest.permissions).not.toContain('<all_urls>');
});
