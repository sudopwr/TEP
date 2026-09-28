import {
  CHANGED_PASSWORD,
  STUB_RECIPIENT,
  STUB_SENDER,
  changedPassword as test,
  choose,
  expect,
  field,
} from './fixtures/world';

/**
 * Journey 18: the two ends of a chain hop, and the page it can be read on.
 *
 * F28's columns have been in `001_initial.sql` since the first migration and
 * nothing above the schema ever wrote them. This drives the whole way down —
 * the fields appear because a wallet is on one side, what is typed reaches
 * SQLite, and the trail shows it back with a link anyone can follow.
 *
 * The link is the part worth a browser: it is rendered as an anchor, so this
 * checks the attributes that decide what a click actually does.
 */

const ADDRESSES = {
  from: 'TQ5NMqJjW3kG4pM4Y7mHs2jWc1ZLsz9Xsa',
  to: '0x8f3a1c4b2d5e6f708192a3b4c5d6e7f809a1b2c3',
  link: 'https://tronscan.org/#/transaction/9f2caa01',
  /** The link from the request, doubled slash and all (F29). */
  link2:
    'https://etherscan.io/tx//0xe167419f8be1f9383aae00ca0508b1c85cf0a0cf31c187d38ecf18e53fcc7a94',
} as const;

test.beforeEach(async ({ page, world }) => {
  await world.signIn(page, CHANGED_PASSWORD);
  await page
    .getByRole('table', { name: 'Payouts' })
    .getByText('TradeifyPayout001')
    .click();
  await expect(
    page.getByRole('heading', { name: /TradeifyPayout001/ }),
  ).toBeVisible();
});

test('records a wallet hop with both addresses and its link', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Record transaction' }).click();

  await choose(page, 'What happened').click();
  await page.getByRole('option', { name: /Transfer/ }).click();

  await field(page, 'Reference code').fill('Transaction900');

  // Nothing on screen yet: a leg with no wallet and no token has no chain.
  await expect(page.getByLabel('From wallet address')).toBeHidden();

  await choose(page, 'From account').click();
  await page.getByRole('option', { name: 'TrustWallet' }).click();

  // TrustWallet is a wallet, so the three fields arrive with it.
  await expect(page.getByLabel('From wallet address')).toBeVisible();

  await choose(page, 'Currency sent').click();
  await page.getByRole('option', { name: 'USDT' }).click();
  await choose(page, 'To account').click();
  await page.getByRole('option', { name: 'CoinDCX' }).click();
  await choose(page, 'Currency received').click();
  await page.getByRole('option', { name: 'USDT' }).click();

  await field(page, 'Amount sent').fill('10.00000000');
  await field(page, 'Amount received').fill('10.00000000');

  await page.getByLabel('From wallet address').fill(ADDRESSES.from);
  await page.getByLabel('To wallet address').fill(ADDRESSES.to);
  await page.getByLabel('Transaction link or hash').fill(ADDRESSES.link);

  await page.getByRole('button', { name: 'Record transaction' }).click();
  await expect(page.getByText('Transaction recorded')).toBeVisible();

  // ---------- and it is on the leg, in the trail ----------
  const trail = page.getByRole('tree', { name: /Money trail/ });

  // Middle-truncated on screen, whole in the title: the ends are what a
  // reader compares against a wallet app.
  const address = trail.getByTitle(ADDRESSES.from);
  await expect(address).toBeVisible();
  await expect(address).toContainText('TQ5NMqJj');

  const link = trail.getByRole('link', { name: 'View on explorer' });
  await expect(link).toHaveAttribute('href', ADDRESSES.link);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noreferrer/);

  // ---------- and on the way back out of the database ----------
  const served = await page.request.get('/api/transactions?payoutId=1');
  const stored = (
    (await served.json()) as {
      transactions: { code: string; toAddress: string | null }[];
    }
  ).transactions.find((one) => one.code === 'Transaction900');

  expect(stored?.toAddress).toBe(ADDRESSES.to);
});

test('corrects a mistyped address from the trail', async ({ page }) => {
  // Transaction007 is TrustWallet -> CoinDCX in USDT: a chain hop, recorded
  // before the fields existed, so this is the retrofit in miniature.
  await page.getByRole('button', { name: 'Edit Transaction007' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('From wallet address').fill('TWrongAddress0000000');
  await dialog.getByRole('button', { name: 'Save leg' }).click();
  await expect(page.getByText('Transaction007 saved')).toBeVisible();

  await page.getByRole('button', { name: 'Edit Transaction007' }).click();
  const again = page.getByRole('dialog');
  await expect(again.getByLabel('From wallet address')).toHaveValue(
    'TWrongAddress0000000',
  );

  await again.getByLabel('From wallet address').fill(ADDRESSES.from);
  await again.getByRole('button', { name: 'Save leg' }).click();

  await expect(
    page.getByRole('tree', { name: /Money trail/ }).getByTitle(ADDRESSES.from),
  ).toBeVisible();
});

test('refuses a link that is not a web address', async ({ page }) => {
  // The column is rendered as an anchor, so the edge only takes http and
  // https — a `javascript:` link in a ledger would be a script the reader
  // runs by clicking their own evidence.
  await page.getByRole('button', { name: 'Edit Transaction007' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Transaction link or hash').fill('javascript:alert(1)');
  await dialog.getByRole('button', { name: 'Save leg' }).click();

  await expect(dialog).toContainText('http or https');
  // Still open, and nothing was saved.
  await expect(dialog.getByLabel('Transaction link or hash')).toHaveValue(
    'javascript:alert(1)',
  );
});

test('fills both addresses from the transaction link (F29)', async ({
  page,
}) => {
  /*
    The point of the feature: the link is already in the clipboard of
    anybody who has just made the transfer, and an address typed by hand is
    how a ledger ends up with one that is *almost* right.

    The explorer here is the world's own stand-in (`fixtures/world.ts`) —
    the request still leaves the server through the real adapter, over real
    HTTP, with the real parse in front of it.
  */
  await page.getByRole('button', { name: 'Edit Transaction007' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('From wallet address')).toHaveValue('');

  await dialog.getByLabel('Transaction link or hash').fill(ADDRESSES.link2);

  await expect(dialog.getByLabel('From wallet address')).toHaveValue(
    STUB_SENDER,
    { timeout: 10_000 },
  );
  await expect(dialog.getByLabel('To wallet address')).toHaveValue(
    STUB_RECIPIENT,
  );
  await expect(dialog).toContainText('Filled in from ethereum');

  // Editable afterwards, which is the other half of the promise: only the
  // reader knows which of the two wallets was theirs.
  await dialog.getByLabel('To wallet address').fill('TMyOwnWallet');
  await dialog.getByRole('button', { name: 'Save leg' }).click();

  await expect(page.getByText('Transaction007 saved')).toBeVisible();
  await expect(
    page.getByRole('tree', { name: /Money trail/ }).getByTitle('TMyOwnWallet'),
  ).toBeVisible();
});

test('says so, and stays typeable, when the link is one it cannot read', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Edit Transaction007' }).click();

  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Transaction link')
    .fill('https://example.com/tx/0xabc');

  await expect(dialog).toContainText('not one this application can read', {
    timeout: 10_000,
  });

  // And nothing was filled in, so the fields are still the reader's.
  await expect(dialog.getByLabel('From wallet address')).toHaveValue('');
});

test('takes a bare transaction hash and turns it into a link (F29)', async ({
  page,
}) => {
  /*
    What an exchange actually gives you is a hash. The chain is worked out
    by asking — Ethereum first, since that is the shape — and the field
    takes back the canonical page, which is also the only thing that column
    can store: it is rendered as an anchor and the edge takes only http(s).
  */
  const hash =
    '0xe167419f8be1f9383aae00ca0508b1c85cf0a0cf31c187d38ecf18e53fcc7a94';

  await page.getByRole('button', { name: 'Edit Transaction007' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Transaction link or hash').fill(hash);

  await expect(dialog.getByLabel('Transaction link or hash')).toHaveValue(
    `https://etherscan.io/tx/${hash}`,
    { timeout: 10_000 },
  );
  await expect(dialog.getByLabel('From wallet address')).toHaveValue(
    STUB_SENDER,
  );

  // And it saves, which a bare hash in that column would not have done.
  await dialog.getByRole('button', { name: 'Save leg' }).click();
  await expect(page.getByText('Transaction007 saved')).toBeVisible();
  await expect(
    page
      .getByRole('tree', { name: /Money trail/ })
      .getByRole('link', { name: 'View on explorer' }),
  ).toHaveAttribute('href', `https://etherscan.io/tx/${hash}`);
});

test('fills the amount that moved, off the token transfer (F30)', async ({
  page,
}) => {
  /*
    What Etherscan prints as "ERC-20 Tokens Transferred", which is the row
    a ledger wants: the transaction's own `to` is whatever contract was
    called — a bridge proxy, an exchange's withdrawal contract — while the
    receipt's `Transfer` event says which address the tokens left, which
    address received them, and how many.
  */
  await page.getByRole('button', { name: 'Record transaction' }).click();

  await choose(page, 'What happened').click();
  await page.getByRole('option', { name: /Transfer/ }).click();
  await field(page, 'Reference code').fill('Transaction901');

  await choose(page, 'From account').click();
  await page.getByRole('option', { name: 'TrustWallet' }).click();
  await choose(page, 'Currency sent').click();
  await page.getByRole('option', { name: 'USDT' }).click();
  await choose(page, 'To account').click();
  await page.getByRole('option', { name: 'CoinDCX' }).click();
  await choose(page, 'Currency received').click();
  await page.getByRole('option', { name: 'USDT' }).click();

  await page.getByLabel('Transaction link or hash').fill(ADDRESSES.link2);

  // Both ends and the amount, none of it typed.
  await expect(page.getByLabel('From wallet address')).toHaveValue(
    STUB_SENDER,
    { timeout: 10_000 },
  );
  await expect(page.getByLabel('To wallet address')).toHaveValue(
    STUB_RECIPIENT,
  );
  await expect(page.getByLabel(/^Amount sent/)).toHaveValue('45.9571');
  await expect(page.getByLabel(/^Amount received/)).toHaveValue('45.9571');
  await expect(page.getByText(/45\.9571 USDT/)).toBeVisible();

  await page.getByRole('button', { name: 'Record transaction' }).click();
  await expect(page.getByText('Transaction recorded')).toBeVisible();

  // And it is the figure that was stored, not something rounded on the way.
  const served = await page.request.get('/api/transactions?payoutId=1');
  const stored = (
    (await served.json()) as {
      transactions: { code: string; fromAmount: { amount: string } }[];
    }
  ).transactions.find((one) => one.code === 'Transaction901');

  expect(stored?.fromAmount.amount).toBe('45.95710000');
});
