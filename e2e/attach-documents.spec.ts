import type { Page } from '@playwright/test';

import {
  CHANGED_PASSWORD,
  changedPassword as test,
  expect,
  field,
} from './fixtures/world';

/**
 * Journey 14: a document comes off a leg, and goes back on.
 *
 * The distinction this journey exists to prove is between *removing* and
 * *deleting*. F22 deletes the file — row, attachments and bytes. F23 breaks
 * one attachment and leaves everything else standing, which is what makes it
 * undoable: the same document is chosen again from the dialog's search,
 * without anybody finding the original on disk.
 *
 * The second test is the payout's own documents, which have no leg to hang
 * on: the contract, or the firm's summary of the award. Before F23 the API
 * could attach one and no screen could show it.
 */

function aPdf(title: string): Buffer {
  const body = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj',
    `% ${title}`,
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n');

  return Buffer.from(body, 'utf8');
}

test.beforeEach(async ({ page, world }) => {
  await world.signIn(page, CHANGED_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Payouts' })).toBeVisible();

  await page
    .getByRole('table', { name: 'Payouts' })
    .getByText('TradeifyPayout001')
    .click();
  await expect(
    page.getByRole('heading', { name: /TradeifyPayout001/ }),
  ).toBeVisible();
});

function trail(page: Page) {
  return page.getByRole('tree', { name: 'Money trail for TradeifyPayout001' });
}

test('takes a document off a leg, then puts it back from the search', async ({
  page,
}) => {
  const filename = `sale-${String(Date.now())}.pdf`;

  // ---------- on ----------

  await page
    .getByRole('button', { name: 'Attach a document to Transaction003' })
    .click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Choose a file').setInputFiles({
    name: filename,
    mimeType: 'application/pdf',
    buffer: aPdf('coindcx march statement'),
  });

  await expect(page.getByText(`${filename} attached`)).toBeVisible();
  await expect(trail(page).getByRole('link', { name: filename })).toBeVisible();

  // ---------- off ----------

  await trail(page)
    .getByRole('button', { name: `Remove ${filename}` })
    .click();

  const asking = page.getByRole('dialog');
  await expect(asking).toContainText('The file stays on record');
  await asking.getByRole('button', { name: 'Remove document' }).click();

  // Off the leg, and the toast says the file did not go with it.
  await expect(
    page.getByText(/still on record, attached to nothing/),
  ).toBeVisible();
  await expect(trail(page).getByRole('link', { name: filename })).toHaveCount(
    0,
  );

  // ---------- and on again, the file never having left ----------

  await page
    .getByRole('button', { name: 'Attach a document to Transaction003' })
    .click();

  const again = page.getByRole('dialog');
  await field(again, 'Search documents').fill(filename.replace('.pdf', ''));
  await again.getByRole('button', { name: `Attach ${filename}` }).click();

  await expect(page.getByText(`${filename} attached`)).toBeVisible();
  await expect(trail(page).getByRole('link', { name: filename })).toBeVisible();
});

test('attaches a contract to the payout itself, and removes it again', async ({
  page,
}) => {
  const filename = `contract-${String(Date.now())}.pdf`;

  await expect(
    page.getByText('Nothing is attached to this payout itself.'),
  ).toBeVisible();

  // Exact, because every leg has an "Attach a document to Transaction00X"
  // button and a substring match would find all fourteen.
  await page
    .getByRole('button', { name: 'Attach a document', exact: true })
    .click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Attach a document to this payout');
  await dialog.getByLabel('Choose a file').setInputFiles({
    name: filename,
    mimeType: 'application/pdf',
    buffer: aPdf('the funded account agreement'),
  });

  await expect(page.getByText(`${filename} attached`)).toBeVisible();

  // Listed against the payout, and nowhere in the trail: it belongs to the
  // award rather than to any one movement.
  await expect(page.getByRole('link', { name: filename })).toBeVisible();
  await expect(trail(page).getByRole('link', { name: filename })).toHaveCount(
    0,
  );

  await page
    .getByRole('button', { name: `Remove ${filename} from this payout` })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Remove document' })
    .click();

  await expect(
    page.getByText('Nothing is attached to this payout itself.'),
  ).toBeVisible();
});
