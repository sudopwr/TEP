import type { Page } from '@playwright/test';

import {
  CHANGED_PASSWORD,
  changedPassword as test,
  expect,
} from './fixtures/world';

/**
 * Journey 12: removing a leg, and the figures that move with it.
 *
 * The settlement is the assertion that matters. §10's ₹84,642.93 is four
 * sales added up, so deleting one has to change it — a net that stayed put
 * after a leg was removed would mean the total was stored somewhere rather
 * than derived, which §13 forbids and which is how the spreadsheet this
 * replaced came to hold two figures for the same money.
 *
 * The second test is the subtree. `transactions.parent_id` is ON DELETE
 * RESTRICT, so the SQL peels the subtree leaf-first; here that runs through
 * the use case, the route and the cache, with the imported sheet as its
 * subject.
 */

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

/** The trail, which is also how many legs are left. */
function trail(page: Page) {
  return page.getByRole('tree', {
    name: 'Money trail for TradeifyPayout001',
  });
}

test('deletes one sale, and the net credited moves with it', async ({
  page,
}) => {
  await expect(trail(page).getByRole('treeitem')).toHaveCount(13);
  await expect(page.getByTestId('settlement-net')).toContainText('84,642.93');

  await page.getByRole('button', { name: 'Delete Transaction003' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Delete Transaction003?');
  await expect(dialog).toContainText('Nothing hangs off it');

  await dialog.getByRole('button', { name: 'Delete leg' }).click();

  await expect(page.getByText('Transaction003 deleted')).toBeVisible();
  await expect(trail(page).getByRole('treeitem')).toHaveCount(12);

  // Derived, never stored: one sale fewer, a smaller net.
  await expect(page.getByTestId('settlement-net')).not.toContainText(
    '84,642.93',
  );
});

test('deletes a withdrawal with the two legs below it', async ({ page }) => {
  await page.getByRole('button', { name: 'Delete Transaction002' }).click();

  // Counted from the tree on screen, before anything is sent.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('The 2 legs below it go too');

  await dialog.getByRole('button', { name: 'Delete leg' }).click();

  await expect(
    page.getByText(/Transaction002 and 2 below it deleted/),
  ).toBeVisible();
  await expect(trail(page).getByRole('treeitem')).toHaveCount(10);

  // The transfer and the sale that hung off it, gone with their parent.
  await expect(trail(page).getByText('Transaction007')).toBeHidden();
  await expect(trail(page).getByText('Transaction003')).toBeHidden();

  // And the siblings untouched, which is the other half of "the subtree".
  await expect(trail(page).getByText('Transaction0010')).toBeVisible();
});
