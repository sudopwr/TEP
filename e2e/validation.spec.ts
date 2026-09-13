import {
  CHANGED_PASSWORD,
  changedPassword as test,
  choose,
  expect,
  field,
} from './fixtures/world';

/**
 * Journey 9: a leg that sends money to itself.
 *
 * §7's first invariant is `from_account_id <> to_account_id`, and it is a
 * database constraint — so the question this journey answers is not whether
 * the row can be written, which is already settled, but whether a person who
 * tries is told *where* they went wrong and whether anything survives the
 * attempt.
 */

test('refuses a leg from an account to itself, and writes nothing', async ({
  page,
  world,
}) => {
  await world.signIn(page, CHANGED_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Payouts' })).toBeVisible();

  // What the ledger holds before the attempt. Read through the API with the
  // browser's own session, so this counts the same rows the screen would.
  const before = await page.request.get('/api/transactions?payoutId=1');
  expect(before.status()).toBe(200);
  const countBefore = ((await before.json()) as { transactions: unknown[] })
    .transactions.length;
  expect(countBefore).toBe(13);

  await page
    .getByRole('table', { name: 'Payouts' })
    .getByText('TradeifyPayout001')
    .click();
  await page.getByRole('button', { name: 'Record transaction' }).click();

  await field(page, 'Reference code').fill('Transaction0099');
  await field(page, 'Date').fill('2025-03-21');

  // The same account on both sides.
  await choose(page, 'From account').click();
  await page.getByRole('option', { name: 'CoinDCX' }).click();
  await choose(page, 'To account').click();
  await page.getByRole('option', { name: 'CoinDCX' }).click();

  /*
    The complaint arrives under the field that is wrong, not as a banner over
    the form. Asserting it through the label is what makes that a real claim:
    `describedby` is how the message is tied to the input, so this passes only
    if a screen reader would also read the two together.
  */
  const destination = choose(page, 'To account');
  await expect(destination).toHaveAccessibleDescription(
    /two different accounts/,
  );
  await expect(
    page.getByText(
      'A leg moves money between two different accounts. Choose another.',
    ),
  ).toBeVisible();

  // And there is nothing to press, so the round trip is not even spent.
  await expect(
    page.getByRole('button', { name: 'Record transaction' }),
  ).toBeDisabled();

  // Choosing a different destination clears it — the message was about the
  // pair, not a permanent mark against the field.
  await choose(page, 'To account').click();
  await page.getByRole('option', { name: 'HDFC' }).click();
  await expect(
    page.getByText(
      'A leg moves money between two different accounts. Choose another.',
    ),
  ).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Record transaction' }),
  ).toBeEnabled();

  // Nothing was written on the way through.
  const after = await page.request.get('/api/transactions?payoutId=1');
  const countAfter = ((await after.json()) as { transactions: unknown[] })
    .transactions.length;
  expect(countAfter).toBe(countBefore);

  // And the server would have refused it anyway, which is what actually
  // guarantees the invariant — the field-level message is a courtesy the
  // browser pays, not the rule itself.
  const refused = await page.request.post('/api/transactions', {
    data: {
      kind: 'transfer',
      code: 'Transaction0099',
      payoutId: 1,
      txnDate: '2025-03-21',
      fromAccountId: 4,
      toAccountId: 4,
      fromAmount: '1.00000000',
      fromCurrencyCode: 'USDT',
      toAmount: '1.00000000',
      toCurrencyCode: 'USDT',
    },
  });

  expect(refused.status()).toBe(400);
  expect(await refused.json()).toMatchObject({ code: 'same_account_transfer' });
});
