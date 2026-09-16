import type { Page } from '@playwright/test';

import {
  CHANGED_PASSWORD,
  changedPassword as test,
  expect,
  field,
} from './fixtures/world';

/**
 * Journey 13: correcting a leg, and the figures that follow it.
 *
 * Two things only a real browser against a real database can show. The first
 * is that the settlement moves: §10's ₹84,642.93 is derived from the legs on
 * every read, so changing one has to change it — a net that held still would
 * mean the total was stored somewhere, which §13 forbids.
 *
 * The second is the flag. An edit leaves the fees exactly as recorded (TDS
 * came off a statement), so halving a sale's proceeds puts its exchange fee
 * well off §8's 0.5% schedule — and §7 says that is *suspicious rather than
 * impossible*, which means the save succeeds and the data-quality screen says
 * so. An edit that quietly re-derived the fees would be the version that lies.
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

function trail(page: Page) {
  return page.getByRole('tree', { name: 'Money trail for TradeifyPayout001' });
}

test('corrects a transfer, and the trail shows the new amount', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Edit Transaction007' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Edit Transaction007');

  // Filled in with what the leg is — a blank dialog would rewrite it blank.
  await expect(field(dialog, 'Reference code')).toHaveValue('Transaction007');

  // USDT on both sides, so there is no rate to offer: §7 makes one a
  // constraint violation rather than a matter of taste.
  await expect(field(dialog, 'Rate')).toHaveCount(0);

  await field(dialog, 'Amount sent').fill('200.00000000');
  await dialog.getByRole('button', { name: 'Save leg' }).click();

  await expect(page.getByText('Transaction007 saved')).toBeVisible();
  await expect(trail(page).getByText('200.00000000')).toBeVisible();

  // Still thirteen legs, still under the same parent: an edit corrects a row,
  // it does not re-file the tree.
  await expect(trail(page).getByRole('treeitem')).toHaveCount(13);
});

test('halving a sale moves the net and flags what it left behind', async ({
  page,
}) => {
  await expect(page.getByTestId('settlement-net')).toContainText('84,642.93');

  await page.getByRole('button', { name: 'Edit Transaction003' }).click();

  const dialog = page.getByRole('dialog');

  /*
    The amount *sent*, not the amount received.

    §4: gross proceeds are `from_amount × rate`, and the net is that minus the
    fees — so the settlement follows the USDT that left the exchange and the
    rate it went at. Editing the rupees received moves the row and not the
    total, which is the same decision as §13's "gross proceeds come from the
    rate rather than the request".
  */
  await field(dialog, 'Amount sent').fill('22.00000000');
  await dialog.getByRole('button', { name: 'Save leg' }).click();

  await expect(page.getByText('Transaction003 saved')).toBeVisible();

  // Derived on every read, so the net follows the leg.
  await expect(page.getByTestId('settlement-net')).not.toContainText(
    '84,642.93',
  );

  /*
    And what was recorded stays recorded, which is the point: the fees came
    off a statement and the rupees received are still on the row, so the leg
    now says it sold 22 USDT at 98.26 and received 4,444.28. §7 calls that
    suspicious rather than impossible — the save succeeds and the checks
    report it, rather than the edit rewriting the evidence to agree.
  */
  await page.getByRole('link', { name: 'Data quality' }).click();
  const flagged = page.getByRole('table', { name: 'Flagged rows' });
  await expect(flagged.getByText('Transaction003').first()).toBeVisible();
});
