import {
  CHANGED_PASSWORD,
  changedPassword as test,
  expect,
} from './fixtures/world';

/**
 * Journey 10: deleting the payout, and everything derived from it going too.
 *
 * The one destructive thing this application can do, and the one worth
 * driving in a real browser against a real database: §10's tree is thirteen
 * legs four levels deep, and `transactions.parent_id` is ON DELETE RESTRICT,
 * so the naive delete fails outright (see `sqlite-payout-repository.test.ts`).
 * Here that SQL runs where it will actually run — through the route, the
 * guards and the cache — with the imported sheet as its subject.
 *
 * The balances are the assertion that matters. F10 is derived from movements,
 * never stored: ₹84,642.93 in the bank exists only because those legs do, so a
 * balance still standing after the delete would be the spreadsheet's own bug
 * back again, a figure with nothing behind it.
 */

test.beforeEach(async ({ page, world }) => {
  await world.signIn(page, CHANGED_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Payouts' })).toBeVisible();
});

test('deletes the imported payout, and the balances it derived', async ({
  page,
}) => {
  // The balance is there before anything is deleted, so the assertion after
  // the delete is a change rather than an empty screen that was always empty.
  await page.getByRole('link', { name: 'Balances' }).click();
  await expect(page.getByText('84,642.93')).toBeVisible();

  await page.getByRole('link', { name: 'Payouts' }).click();
  await page
    .getByRole('table', { name: 'Payouts' })
    .getByText('TradeifyPayout001')
    .click();

  await expect(
    page.getByRole('heading', { name: /TradeifyPayout001/ }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Delete payout' }).click();

  // The confirmation counts, which is the whole reason it interrupts.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Delete TradeifyPayout001?');
  await expect(dialog).toContainText('13 legs');

  await dialog.getByRole('button', { name: 'Delete payout' }).click();

  // Named in the confirmation, and back on the list with nothing on it.
  await expect(page.getByText('TradeifyPayout001 deleted')).toBeVisible();
  await expect(page.getByText('No payouts recorded yet.')).toBeVisible();

  // And the derived figures with it: no legs, so no balance.
  await page.getByRole('link', { name: 'Balances' }).click();
  await expect(page.getByText('84,642.93')).toBeHidden();
});

test('cancelling the confirmation deletes nothing', async ({ page }) => {
  await page
    .getByRole('table', { name: 'Payouts' })
    .getByText('TradeifyPayout001')
    .click();

  await page.getByRole('button', { name: 'Delete payout' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await expect(
    page.getByRole('heading', { name: /TradeifyPayout001/ }),
  ).toBeVisible();
  await expect(page.getByTestId('settlement-net')).toContainText('84,642.93');
});
