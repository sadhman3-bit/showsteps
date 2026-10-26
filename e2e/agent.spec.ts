import type { Page, Worker } from '@playwright/test';
import { validateAgentPack } from '@showsteps/core/export';
import { strFromU8, unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

// M7: the Agent view, input modes, confirm flags and captured expectations in the editor, and
// the Agent Pack from Share. The pack's replay runs in agent-replay.spec.ts.

type Hook = {
  installSamples(): Promise<string[]>;
  store: {
    listGuides(): Promise<{ id: string; title: string }[]>;
    getGuide(id: string): Promise<{ variables: { name: string }[] }>;
  };
};
declare const __showsteps: Hook;

const INVOICE = 'Create a supplier invoice in Ledgerline';

async function openSample(page: Page, sw: Worker, extensionId: string): Promise<string> {
  const id = await sw.evaluate(async (title) => {
    await __showsteps.installSamples();
    return (await __showsteps.store.listGuides()).find((g) => g.title === title)!.id;
  }, INVOICE);
  await page.goto(`chrome-extension://${extensionId}/library.html#/guide/${id}`);
  await expect(page.getByRole('textbox', { name: 'Guide title' })).toHaveValue(INVOICE);
  return id;
}

test('Agent view, input modes, confirm flags, expectations and the Agent Pack (U1–U5)', async ({
  context,
  serviceWorker: sw,
  extensionId,
}) => {
  const page = await context.newPage();
  const id = await openSample(page, sw, extensionId);

  // U4: the editor suggests asking for values that change.
  const invoiceNo = page.locator('.ss-eblock', {
    has: page.getByRole('textbox', { name: 'Step 7 title' }),
  });
  await expect(invoiceNo).toContainText('Looks like a value that changes.');
  await invoiceNo.getByRole('button', { name: 'Ask every run' }).click();
  await expect(page.getByRole('textbox', { name: 'Step 7 title' })).toHaveText(
    'Type {{invoice_no}} into Invoice no.',
  );
  await expect(page.getByRole('combobox', { name: 'Value: Step 7 title' })).toHaveValue('ask');
  await expect(invoiceNo).toContainText('Variable {{invoice_no}}');
  // Passwords are secrets: no value controls.
  await expect(
    page.locator('.ss-eblock', { has: page.getByRole('textbox', { name: 'Step 3 title' }) }),
  ).toContainText('Secret: never stored.');

  // U1: the Agent view.
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What an agent reads' })).toBeVisible();
  const warnings = page.getByRole('region', { name: /things? to check/ });
  await expect(warnings).toContainText('Step 8 types a fixed value that looks like it changes.');
  await expect(warnings).not.toContainText('Step 7 types');
  // U5: Submit invoice asks a person first; U6: what each action changed was recorded.
  const submit = page.getByRole('listitem', { name: 'Step 17: Click Submit invoice' });
  await expect(
    submit.getByRole('checkbox', { name: 'Ask a person before doing this step' }),
  ).toBeChecked();
  await expect(submit).toContainText('Address matches /app/invoices/done$');
  await expect(submit).toContainText('Text “Invoice submitted” appears');
  const review = page.getByRole('listitem', { name: 'Step 16: Click Review invoice' });
  await expect(review).toContainText('dialog “Review invoice” appears');
  await review.getByRole('button', { name: 'Add text that appears' }).click();
  await review
    .getByRole('textbox', { name: 'Text that appears after this step' })
    .fill('Check the details');
  await review.getByRole('button', { name: 'Add text that appears' }).click();
  await expect(review).toContainText('Text “Check the details” appears');
  await review.getByRole('textbox', { name: 'If it fails: Step 16' }).fill('Ask the AP team.');
  const strategies = page.getByRole('listitem', {
    name: 'Step 12: Select CC-110 Finance from Cost centre lookup',
  });
  await expect(strategies).toContainText('iframe iframe[title="Cost centre lookup"]');
  await page.screenshot({ path: test.info().outputPath('agent-view.png'), fullPage: true });
  await expect(page.getByRole('status').filter({ hasText: /^(Saved|Saving…)$/ })).toHaveText(
    'Saved',
  );
  expect((await sw.evaluate((g) => __showsteps.store.getGuide(g), id)).variables).toEqual([
    expect.objectContaining({ name: 'invoice_no' }),
  ]);

  // U2: Agent Pack from Share.
  await page.getByRole('button', { name: 'Share' }).click();
  const download = page.waitForEvent('download');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Agent Pack/ })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`${INVOICE} (Agent Pack).zip`);
  const zipPath = test.info().outputPath('pack.zip');
  await file.saveAs(zipPath);
  const zip = unzipSync(readFileSync(zipPath));
  const folder = 'create-a-supplier-invoice-in-ledgerline';
  const files = Object.fromEntries(
    Object.entries(zip).map(([p, bytes]) => [p.slice(folder.length + 1), bytes]),
  );
  expect(validateAgentPack(folder, files)).toEqual([]);
  const skill = strFromU8(files['SKILL.md']!);
  expect(skill).toContain('7. Type {{invoice_no}} into `Invoice no.`');
  expect(skill).toContain('17. **CONFIRM** Click `Submit invoice`');
  expect(skill).toContain('On failure: Ask the AP team.');
  expect(skill).toContain('the text `Check the details` appears');
  expect(Object.keys(files).filter((p) => p.startsWith('assets/screenshots/'))).toHaveLength(17);
});
