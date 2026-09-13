import type { Page } from '@playwright/test';

import {
  CHANGED_PASSWORD,
  changedPassword as test,
  choose,
  expect,
  field,
} from './fixtures/world';

/**
 * Journeys 5, 6 and 8: reading the trail, adding to it, and the flagged row.
 *
 * The figures are §10's, arriving the long way — the legacy CSV, imported
 * through UC12 with its corrections applied, read back through the settlement
 * use case and rendered by the browser. Nothing in this file was written down
 * from the spreadsheet; if the importer, the arithmetic or the component
 * drifted, these are the assertions that would say so.
 */

test.beforeEach(async ({ page, world }) => {
  await world.signIn(page, CHANGED_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Payouts' })).toBeVisible();
});

/** Open TradeifyPayout001 from the list, the way a person would. */
async function openThePayout(page: Page): Promise<void> {
  await page
    .getByRole('table', { name: 'Payouts' })
    .getByText('TradeifyPayout001')
    .click();

  await expect(
    page.getByRole('heading', { name: /TradeifyPayout001/ }),
  ).toBeVisible();
}

// ---------- 5. The trail, ending at ₹84,642.93 ----------

test('follows TradeifyPayout001 from the award down to the net', async ({
  page,
}) => {
  await openThePayout(page);

  /*
    "Expand the trail" is a step this interface does not have, and
    deliberately: `TreeView` renders every node open, because a collapsed
    trail hides the hop somebody came to check and there are thirteen legs,
    not thirteen thousand. So the assertion is that the whole chain is on
    screen at once.
  */
  const trail = page.getByRole('tree', {
    name: 'Money trail for TradeifyPayout001',
  });
  await expect(trail).toBeVisible();
  await expect(trail.getByRole('treeitem')).toHaveCount(13);

  // The top of the chain: $1,008.01 awarded, less $100.79 of charges.
  await expect(page.getByText('Awarded')).toBeVisible();
  await expect(page.getByText('100.79')).toBeVisible();

  // And the bottom of it. The figure is asserted inside its own card, so
  // this cannot pass on some other number that happens to match.
  const net = page.getByTestId('settlement-net');
  await expect(net).toContainText('Net credited');
  await expect(net).toContainText('84,642.93');
  await expect(net).toContainText('INR');

  /*
    Rupees, written the way §10 writes them — but as `84,642.93 INR` rather
    than `₹84,642.93`. That is a deliberate choice recorded in the component:
    `₹` and `$` are each ambiguous across several currencies and `USDT` has no
    symbol at all, so every amount in this application carries its code.
  */

  // The arithmetic either side of it, so a wrong net cannot pass by matching
  // a gross that is also wrong.
  await expect(page.getByTestId('settlement-gross')).toContainText('86,027.56');
  await expect(page.getByTestId('settlement-fees')).toContainText('1,384.63');

  // Derived, never stored: a sale leg reached the bank.
  await expect(page.getByText('Settled')).toBeVisible();
  await expect(
    page.getByText('A sale has reached a bank account.'),
  ).toBeVisible();
});

// ---------- 6. Recording a leg moves the trail and the balances ----------

test('records a leg under an existing parent and moves both screens', async ({
  page,
}) => {
  await openThePayout(page);

  // What the balances say before anything is recorded — §10's two dust
  // figures, which this leg is about to move.
  await page.getByRole('link', { name: 'Balances' }).click();
  const balances = page.getByRole('table', { name: 'Account balances' });
  await expect(balances.getByText('1.33230000')).toBeVisible();
  await expect(balances.getByText('14.09080000')).toBeVisible();

  await page.getByRole('link', { name: 'Payouts' }).click();
  await openThePayout(page);

  const trail = page.getByRole('tree', {
    name: 'Money trail for TradeifyPayout001',
  });
  await expect(trail.getByRole('treeitem')).toHaveCount(13);

  await page.getByRole('button', { name: 'Record transaction' }).click();
  await expect(
    page.getByRole('heading', { name: 'Record transaction' }),
  ).toBeVisible();

  // A transfer of dust that was already sitting in the wallet, hanging off the
  // withdrawal that put it there.
  await choose(page, 'What happened').click();
  await page.getByRole('option', { name: /^Transfer/ }).click();

  await field(page, 'Reference code').fill('Transaction0014');
  await field(page, 'Date').fill('2025-03-21');

  await choose(page, 'Follows on from').click();
  await page.getByRole('option', { name: /Transaction002/ }).click();

  await choose(page, 'From account').click();
  await page.getByRole('option', { name: 'TrustWallet' }).click();
  await choose(page, 'Currency sent').click();
  await page.getByRole('option', { name: 'USDT' }).click();

  await choose(page, 'To account').click();
  await page.getByRole('option', { name: 'CoinDCX' }).click();
  await choose(page, 'Currency received').click();
  await page.getByRole('option', { name: 'USDT' }).click();

  // Both sides are USDT, so §7 says there is no rate to record and the form
  // stops asking for one.
  await expect(
    page.getByText('Both sides are USDT, so there is no rate to record.'),
  ).toBeVisible();

  await field(page, 'Amount sent').fill('1.00000000');
  await field(page, 'Amount received').fill('1.00000000');

  await page.getByRole('button', { name: 'Record transaction' }).click();
  await expect(page.getByText('Transaction recorded')).toBeVisible();

  // The trail has grown, and the new leg is in it.
  await expect(
    page.getByRole('heading', { name: /TradeifyPayout001/ }),
  ).toBeVisible();
  await expect(trail.getByRole('treeitem')).toHaveCount(14);
  await expect(trail.getByText('Transaction0014')).toBeVisible();

  /*
    And the balances moved with it — which is the half a trail-only assertion
    would miss. One USDT left the wallet and arrived at the exchange, so both
    of §10's dust figures are now different by exactly that, derived afresh
    from the movements rather than adjusted in place (UC7).
  */
  await page.getByRole('link', { name: 'Balances' }).click();
  await expect(balances.getByText('0.33230000')).toBeVisible();
  await expect(balances.getByText('15.09080000')).toBeVisible();
  await expect(balances.getByText('1.33230000')).toBeHidden();
});

// ---------- 8. The flagged dust row ----------

test('flags the leg that sends more than its parent delivered', async ({
  page,
}) => {
  await page.getByRole('link', { name: 'Data quality' }).click();

  const flagged = page.getByRole('table', { name: 'Flagged rows' });
  await expect(flagged).toBeVisible();

  /*
    The dust row, and it is **Transaction0011**, not Transaction0010.

    Transaction0011 is the sale that moves 741.72 USDT when the transfer above
    it delivered only 222.3877 — legitimate, because dust from three earlier
    transfers was still sitting at the exchange, which is exactly the case §7
    puts in a view rather than a constraint.

    Transaction0010 is a different row and a different §9 defect: it is the
    transfer that *sorts* before Transaction002 as text, which is why internal
    keys are integers. It is comfortably within its parent and nothing flags
    it — asserted below, so the distinction stays a fact rather than a memory.
  */
  await expect(flagged.getByText('Transaction0011')).toBeVisible();
  await expect(
    flagged.getByText(/sends 741\.72000000 USDT but 'Transaction0013'/),
  ).toBeVisible();
  await expect(flagged.getByText('Sends more than it received')).toBeVisible();

  await expect(flagged.getByText('Transaction0010')).toBeHidden();

  // A question, not a defect — and the screen has to say so.
  await expect(
    page.getByText(/worth reading, not fixing on sight/),
  ).toBeVisible();
});
