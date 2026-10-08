import { expect, test } from '@playwright/test';

// Smoke test for the demo app itself: every awkward feature the recorder will face works.
test('create-invoice flow works end to end', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login\.html$/);

  await page.getByLabel('Username').fill('alex');
  await page.getByLabel('Password').fill('not-a-real-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Full page load into the SPA, then the slow section arrives after ~1.5 s.
  await expect(page).toHaveURL(/\/app\/$/);
  await expect(page.getByText('Signed in as alex')).toBeVisible();
  await expect(page.getByText('Loading recent invoices…')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'INV-1042' })).toBeVisible({ timeout: 5000 });

  // SPA navigation via the history API (no reload).
  const navId = await page.evaluate(() => performance.getEntriesByType('navigation').length);
  await page.getByTestId('new-invoice').click();
  await expect(page).toHaveURL(/\/app\/invoices\/new$/);
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(navId);

  await page.getByLabel('Supplier').fill('Harbour Paper Co.');
  await page.getByLabel('Invoice no.').fill('INV-1043');
  await page.getByLabel('Amount').fill('1280.50');
  await page.getByLabel('Currency').selectOption('NZD');
  await page.getByLabel('Invoice date').fill('2026-10-01');
  await page.getByLabel('Includes GST').check();
  await page.getByLabel('Cheque').check();
  await expect(page.getByLabel('Card number')).toBeHidden();
  await page.getByLabel('Attach invoice PDF').setInputFiles({
    name: 'invoice.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 demo'),
  });

  // Cross-origin iframe posts its choice back to the parent.
  const widget = page.frameLocator('iframe[title="Cost centre lookup"]');
  await widget.getByLabel('Cost centre lookup').selectOption('CC-220 Operations');
  await widget.getByRole('button', { name: 'Use this cost centre' }).click();
  await expect(page.getByLabel('Cost centre')).toHaveValue('CC-220 Operations');

  // Same-origin iframe.
  const notes = page.frameLocator('iframe[title="Internal note"]');
  await notes.getByLabel('Note for approver').fill('Please approve by Friday.');

  // Shadow DOM (Playwright pierces open shadow roots).
  await page.getByRole('searchbox', { name: 'Search approvers' }).fill('mei');
  await page.getByRole('button', { name: 'Mei Chen' }).click();
  await expect(page.getByRole('button', { name: 'Mei Chen' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Modal dialog with an irreversible action.
  await page.getByRole('button', { name: 'Review invoice' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review invoice' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('CC-220 Operations');
  await expect(dialog).toContainText('Mei Chen');
  await dialog.getByRole('button', { name: 'Submit invoice' }).click();

  await expect(page).toHaveURL(/\/app\/invoices\/done$/);
  await expect(page.getByRole('status')).toContainText('INV-1043');
});

test('IDs and classes change on every load', async ({ page }) => {
  await page.goto('/login.html');
  const first = await page.getByLabel('Username').getAttribute('id');
  await page.reload();
  const second = await page.getByLabel('Username').getAttribute('id');
  expect(first).not.toBe(second);
});

test('reports page is a separate full page load', async ({ page }) => {
  await page.goto('/reports.html');
  await page.getByLabel('Period').selectOption('Last month');
  await page.getByRole('button', { name: 'Run report' }).click();
  await expect(page.getByRole('status')).toHaveText('Report ready for last month.');
});
