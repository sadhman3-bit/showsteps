import { readFileSync } from 'node:fs';
import { RELEASE_MANIFEST, expect, test } from './fixtures';

test('extension loads and its side panel renders', async ({ context, extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);

  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.getByRole('heading', { name: 'ABCXYZ' })).toBeVisible();
  await expect(page.getByText('Nothing is uploaded')).toBeVisible();
  expect(errors).toEqual([]);
});

test('release manifest asks for no host permissions at install', () => {
  const manifest = JSON.parse(readFileSync(RELEASE_MANIFEST, 'utf8'));
  expect(manifest.host_permissions ?? []).toEqual([]);
  expect(manifest.content_scripts ?? []).toEqual([]);
  expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
  expect(manifest.commands['toggle-capture'].suggested_key.default).toBe('Alt+Shift+R');
});
