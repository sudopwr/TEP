import type { Page } from '@playwright/test';

import {
  CHANGED_PASSWORD,
  changedPassword as test,
  choose,
  expect,
  field,
} from './fixtures/world';

/**
 * Journey 11: correcting an account, and the two answers to deleting one.
 *
 * The refusal is the reason this is driven in a browser rather than left to
 * the route tests. Both account columns on `transactions` are ON DELETE
 * RESTRICT, so the database would refuse a delete with "FOREIGN KEY
 * constraint failed" — a sentence nobody can act on. What the reader should
 * get instead is the count of legs and a way out, and that runs through the
 * use case, the 409, the query cache and the dialog before anyone sees it.
 */

test.beforeEach(async ({ page, world }) => {
  await world.signIn(page, CHANGED_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Payouts' })).toBeVisible();
  await page.getByRole('link', { name: 'Accounts' }).click();
  await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
});

/** The row for an account, found by the name in its first cell. */
function row(page: Page, name: string) {
  return page
    .getByRole('table', { name: 'Accounts' })
    .getByRole('row')
    .filter({ hasText: name });
}

test('renames an account, and the balance sheet says the new name', async ({
  page,
}) => {
  await row(page, 'CoinDCX').getByRole('button', { name: 'Edit' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Edit CoinDCX');

  // Filled in with what the account *is*, including the allow-list — a blank
  // dialog here would quietly empty it on save.
  await expect(field(dialog, 'Code')).toHaveValue('coindcx');
  await expect(
    dialog.getByRole('button', { name: 'USDT', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');

  await field(dialog, 'Name').fill('CoinDCX (INR desk)');
  await dialog.getByRole('button', { name: 'Save account' }).click();

  await expect(page.getByText('CoinDCX (INR desk) saved')).toBeVisible();
  await expect(row(page, 'CoinDCX (INR desk)')).toBeVisible();

  // The balances embed the account, so the edit has to reach that screen too
  // — this is the assertion behind `useEditAccount` invalidating them.
  await page.getByRole('link', { name: 'Balances' }).click();
  await expect(page.getByText('CoinDCX (INR desk)').first()).toBeVisible();
});

test('refuses to delete an account money has moved through, and says how much', async ({
  page,
}) => {
  await row(page, 'CoinDCX').getByRole('button', { name: 'Delete' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Delete account' }).click();

  // The count, not a constraint violation: §10's tree puts four sales through
  // CoinDCX, so the sentence names a number and a way out.
  await expect(dialog).toContainText(/is used by \d+ transactions/);
  await expect(dialog).toContainText('Delete those payouts first');

  // Still asking, and the account still there once the question is dropped.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(row(page, 'CoinDCX')).toBeVisible();
});

test('deletes an account nothing has moved through', async ({ page }) => {
  await page.getByRole('button', { name: 'Record account' }).click();
  await expect(
    page.getByRole('heading', { name: 'Record account' }),
  ).toBeVisible();

  await field(page, 'Name').fill('Spare HDFC');
  await field(page, 'Code').fill('bank-hdfc-2');
  await choose(page, 'Kind').click();
  await page.getByRole('option', { name: /^Bank/ }).click();
  await page.getByRole('button', { name: 'Record account' }).click();

  await expect(page.getByText('Account recorded')).toBeVisible();
  await expect(row(page, 'Spare HDFC')).toBeVisible();

  await row(page, 'Spare HDFC').getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete account' })
    .click();

  await expect(page.getByText('Spare HDFC deleted')).toBeVisible();
  await expect(row(page, 'Spare HDFC')).toHaveCount(0);
});
