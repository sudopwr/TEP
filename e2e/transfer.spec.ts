import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  CHANGED_PASSWORD,
  changedPassword as test,
  expect,
} from './fixtures/world';

/**
 * Journey 39: out to a file, destroyed, and back again.
 *
 * The only test that can answer the question F33 exists for — *is my data
 * actually recoverable?* — because it is the only one that does the whole of
 * it: a real browser presses the button, a real archive lands on disk, the
 * ledger is then genuinely destroyed, and the same file is handed back through
 * the same screen. The assertion at the end is §10's net credited, which is
 * only right if every amount, rate, fee and relationship came back exactly.
 *
 * A unit test can prove the bytes round-trip. It cannot prove that the download
 * reaches the disk, that the file picker and the archive agree, or that the
 * confirmation gates the destruction — and those are the parts that fail.
 */
test('exports the ledger to a file, then restores it from that file', async ({
  page,
  world,
}) => {
  await world.signIn(page, CHANGED_PASSWORD);

  const payouts = page.getByRole('table', { name: 'Payouts' });
  await expect(payouts.getByText('TradeifyPayout001')).toBeVisible();

  // ---------- export ----------

  await page.getByRole('link', { name: 'Export & import' }).click();
  await expect(
    page.getByRole('heading', { name: 'Export and import' }),
  ).toBeVisible();

  // Counted in the database, which is why these are the whole ledger's figures
  // and not the scoped lists' (F24).
  await expect(page.getByText(/^On file now: 1 trader,/)).toBeVisible();
  await expect(page.getByText(/1 payout, 13 transactions/)).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export everything' }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(
    /^payout-tracker-\d{4}-\d{2}-\d{2}\.tar\.gz$/,
  );

  const archive = path.join(
    mkdtempSync(path.join(tmpdir(), 'payout-e2e-export-')),
    download.suggestedFilename(),
  );
  await download.saveAs(archive);

  await expect(page.getByText(/^Exported 1 trader/)).toBeVisible();

  // ---------- destroy ----------

  /*
    Through the API rather than the interface, with the browser's own session.

    The point of this step is that the data is really gone — not that the delete
    button works, which `delete-payout.spec.ts` covers. Deleting the payout takes
    its thirteen legs and their fees with it (F18), which is as thorough a loss
    as this ledger can arrange in one request.
  */
  const deleted = await page.request.delete('/api/payouts/1');
  expect(deleted.status()).toBe(200);

  await page.reload();
  await expect(page.getByText(/1 payout, 13 transactions/)).toBeHidden();

  await page.getByRole('link', { name: 'Payouts' }).click();
  await expect(page.getByText('TradeifyPayout001')).toHaveCount(0);

  // ---------- restore ----------

  await page.getByRole('link', { name: 'Export & import' }).click();
  await page.getByLabel('Choose a file').setInputFiles(archive);

  await expect(page.getByText(download.suggestedFilename())).toBeVisible();

  await page
    .getByRole('button', { name: 'Import and replace everything' })
    .click();

  // It asks first, every time, and says what is at stake.
  const confirmation = page.getByRole('dialog');
  await expect(confirmation).toContainText('Replace everything in this ledger?');
  await confirmation.getByRole('button', { name: 'Replace the ledger' }).click();

  await expect(page.getByText(/^Imported /).first()).toBeVisible();

  // ---------- and it is all back ----------

  await page.getByRole('link', { name: 'Payouts' }).click();
  await page
    .getByRole('table', { name: 'Payouts' })
    .getByText('TradeifyPayout001')
    .click();

  /*
    §10, through the screen.

    ₹84,642.93 is gross proceeds minus TDS, the exchange fee and GST, over four
    sales whose amounts, rates and fees all had to survive the round trip for
    this one number to come out right. The tree is the other half: thirteen legs
    in the same shape, each still under the parent it belonged to.
  */
  await expect(page.getByText('84,642.93')).toBeVisible();
  await expect(
    page
      .getByRole('tree', { name: 'Money trail for TradeifyPayout001' })
      .getByRole('treeitem'),
  ).toHaveCount(13);
});

/**
 * Journey 40: the file that is not an archive.
 *
 * The commonest way an import goes wrong is the wrong file, and the only
 * acceptable outcome is that nothing happens and the reader is told why. Worth
 * a journey of its own because "nothing happens" is a claim about the whole
 * stack: the upload is parsed, the archive is rejected, and the ledger that was
 * there a moment ago is still there.
 */
test('refuses a file that is not an export, and keeps the ledger', async ({
  page,
  world,
}) => {
  await world.signIn(page, CHANGED_PASSWORD);

  await page.getByRole('link', { name: 'Export & import' }).click();

  await page.getByLabel('Choose a file').setInputFiles({
    name: 'holiday-photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('\xff\xd8\xff\xe0 not an archive', 'binary'),
  });

  await page
    .getByRole('button', { name: 'Import and replace everything' })
    .click();

  const confirmation = page.getByRole('dialog');
  await confirmation.getByRole('button', { name: 'Replace the ledger' }).click();

  /*
    The reason appears inside the question, not behind it.

    MUI marks the rest of the page `aria-hidden` while a dialog is open, so a
    message rendered on the screen underneath would be unreadable and
    unreachable — which is how this journey found it the first time.
  */
  await expect(confirmation).toContainText(/not a payout tracker export/);

  await confirmation.getByRole('button', { name: 'Cancel' }).click();

  // Still there, every leg of it.
  await page.getByRole('link', { name: 'Payouts' }).click();
  await expect(
    page.getByRole('table', { name: 'Payouts' }).getByText('TradeifyPayout001'),
  ).toBeVisible();
});
