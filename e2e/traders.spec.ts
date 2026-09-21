import {
  CHANGED_PASSWORD,
  changedPassword as test,
  expect,
} from './fixtures/world';

/**
 * Journey 15: more than one person's payouts in one ledger (F24).
 *
 * The imported sheet belongs to the trader `004_traders.sql` created. This
 * journey adds a second person from inside the dropdown, records an award
 * against them, and then checks the thing the whole feature is for: that
 * switching between the two changes the list, the balances and the checks
 * together. A screen that honoured the selection and one beside it that did
 * not is precisely how the spreadsheet this replaces went wrong.
 *
 * Driven in a browser because the selection lives in three places at once —
 * the bar's state, four cache keys and four query strings — and only a real
 * click proves they are the same selection.
 */

test.beforeEach(async ({ page, world }) => {
  await world.signIn(page, CHANGED_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Payouts' })).toBeVisible();
});

test('adds a trader, records their payout, and keeps the two apart', async ({
  page,
}) => {
  const bar = page.getByRole('combobox', { name: /Trader/ }).first();

  // Everything, to begin with: the imported payout is on screen and nothing
  // is hidden until somebody hides it.
  await expect(bar).toContainText('All traders');
  await expect(page.getByText('TradeifyPayout001')).toBeVisible();

  // ---------- Add somebody, from inside the dropdown ----------
  await bar.click();
  await page.getByRole('option', { name: 'Add a trader…' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Trader name/).fill('Priya');
  await dialog.getByLabel(/Trader code/).fill('priya');
  await dialog.getByRole('button', { name: 'Add trader' }).click();

  // Selected straight away, and the list below narrows to them: they own
  // nothing yet, so it is empty rather than still showing somebody else's.
  await expect(bar).toContainText('Priya');
  await expect(page.getByText('TradeifyPayout001')).toBeHidden();

  // ---------- Record an award for them ----------
  await page.getByRole('link', { name: 'Payouts' }).click();
  await page.getByRole('button', { name: 'Record payout' }).click();

  await page.getByLabel(/^Payout code/).fill('TradeifyPayout900');
  await page.getByRole('combobox', { name: /Company/ }).click();
  await page.getByRole('option', { name: 'Tradeify' }).click();
  await page.getByLabel(/Payout date/).fill('2025-06-04');
  await page.getByLabel(/^Gross awarded/).fill('500.00');
  await page
    .getByRole('button', { name: 'Record payout', exact: true })
    .click();

  await expect(
    page.getByRole('heading', { name: /TradeifyPayout900/ }),
  ).toBeVisible();

  // ---------- Each person sees their own ----------
  await page.getByRole('link', { name: 'Payouts' }).click();
  await expect(page.getByText('TradeifyPayout900')).toBeVisible();
  await expect(page.getByText('TradeifyPayout001')).toBeHidden();

  // §10's ₹84,642.93 is emphatically not hers: she has an award and no
  // movements, so there is nothing of hers in any account.
  await page.getByRole('link', { name: 'Balances' }).click();
  await expect(page.getByText('84,642.93')).toBeHidden();

  await bar.click();
  await page.getByRole('option', { name: 'Me' }).click();
  await expect(page.getByText('84,642.93')).toBeVisible();

  await page.getByRole('link', { name: 'Payouts' }).click();
  await expect(page.getByText('TradeifyPayout001')).toBeVisible();
  await expect(page.getByText('TradeifyPayout900')).toBeHidden();

  // ---------- And "everything" still means everything ----------
  await page.getByRole('button', { name: 'Show everything' }).click();
  await expect(page.getByText('TradeifyPayout001')).toBeVisible();
  await expect(page.getByText('TradeifyPayout900')).toBeVisible();
});

test('narrows to a month, and back out again', async ({ page }) => {
  const year = page.getByRole('combobox', { name: /Year/ });
  const month = page.getByRole('combobox', { name: /Month/ });

  // The month is inert until a year gives it a meaning.
  await expect(month).toHaveAttribute('aria-disabled', 'true');

  await year.click();
  await page.getByRole('option', { name: '2025' }).click();

  // The sheet is dated March 2025, so March holds it and June does not.
  await month.click();
  await page.getByRole('option', { name: 'June' }).click();
  await expect(page.getByText('TradeifyPayout001')).toBeHidden();

  await month.click();
  await page.getByRole('option', { name: 'March' }).click();
  await expect(page.getByText('TradeifyPayout001')).toBeVisible();

  // Clearing the year clears the month with it: "March of no year" is not a
  // period, and the list goes back to everything.
  await year.click();
  await page.getByRole('option', { name: 'All time' }).click();
  await expect(month).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByText('TradeifyPayout001')).toBeVisible();
});
