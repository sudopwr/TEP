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
  const bar = page.getByRole('combobox', { name: 'Trader' });

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

test('cuts the ledger to a financial year, April to March', async ({ page }) => {
  // The reason the period has two ends: a tax year does not start in
  // January. The imported sheet is dated 10 March 2025, so it belongs to the
  // year that began in April 2024 — and to the one that began in April 2025
  // it does not.
  const fromMonth = page.getByRole('combobox', { name: 'From month' });
  const fromYear = page.getByRole('combobox', { name: 'From year' });
  const toMonth = page.getByRole('combobox', { name: 'To month' });
  const toYear = page.getByRole('combobox', { name: 'To year' });

  const pick = async (
    field: ReturnType<typeof page.getByRole>,
    option: string,
  ): Promise<void> => {
    await field.click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };

  await pick(fromYear, '2024');
  await pick(fromMonth, 'April');
  await pick(toYear, '2025');
  await pick(toMonth, 'March');

  await expect(page.getByText('TradeifyPayout001')).toBeVisible();

  // The year after it: same months, one year on, and the sheet drops out.
  await pick(fromYear, '2025');
  await pick(toYear, '2026');

  await expect(page.getByText('TradeifyPayout001')).toBeHidden();

  // Clearing one end clears the period, because half a range is not one.
  await pick(fromMonth, 'All time');
  await expect(toYear).toContainText('All time');
  await expect(page.getByText('TradeifyPayout001')).toBeVisible();
});

test('a single month is both ends at once', async ({ page }) => {
  const fromMonth = page.getByRole('combobox', { name: 'From month' });
  const toMonth = page.getByRole('combobox', { name: 'To month' });

  await page.getByRole('combobox', { name: 'From year' }).click();
  await page.getByRole('option', { name: '2025', exact: true }).click();
  await fromMonth.click();
  await page.getByRole('option', { name: 'March', exact: true }).click();

  // The far end followed, visibly, rather than sitting empty while the
  // screen quietly showed everything.
  await expect(toMonth).toContainText('March');
  await expect(page.getByText('TradeifyPayout001')).toBeVisible();

  await fromMonth.click();
  await page.getByRole('option', { name: 'June', exact: true }).click();
  await expect(page.getByText('TradeifyPayout001')).toBeHidden();
});
