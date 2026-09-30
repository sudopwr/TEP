import {
  CHANGED_PASSWORD,
  changedPassword as test,
  choose,
  expect,
  field,
} from './fixtures/world';

/**
 * Journey 7: a file goes in, comes back out of the search, and then goes.
 *
 * The one journey that crosses every layer at once — a multipart POST through
 * the proxy, a SHA-256 on the server, bytes written under the world's own
 * files root, a row in `documents`, an FTS5 index, and a handler streaming it
 * back. None of that is provable from either end alone, and neither is
 * undoing it: the delete has to take the row, the link on the leg, the index
 * and the file together, which the last assertions check one by one.
 */

/**
 * The smallest thing a PDF reader will accept, built here rather than kept as
 * a fixture file so the name can be unique per run and the search cannot pass
 * on something an earlier run left behind.
 */
function aPdf(title: string): Buffer {
  const body = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj',
    `% ${title}`,
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n');

  return Buffer.from(body, 'utf8');
}

test('attaches a statement to a leg, finds it by searching, then deletes it', async ({
  page,
  world,
}) => {
  // A word that appears nowhere in the imported sheet, so a match can only be
  // the file this test uploaded.
  const token = `zephyr${String(Date.now()).slice(-6)}`;
  const filename = `${token}-statement.pdf`;

  await world.signIn(page, CHANGED_PASSWORD);
  await page
    .getByRole('table', { name: 'Payouts' })
    .getByText('TradeifyPayout001')
    .click();

  /*
    A file usually belongs to a leg rather than to the payout — the exchange
    statement belongs to the sale it settles — so this journey attaches from
    the leg's own button in the trail. The documents that belong to no
    movement go on the payout itself (F23's own journey).
  */
  await page
    .getByRole('button', { name: 'Attach a document to Transaction003' })
    .click();

  const dialog = page.getByRole('dialog');
  await choose(dialog, 'Kind').click();
  await page.getByRole('option', { name: 'statement' }).click();

  /*
    By label, which reaches the input rather than the label that fronts it.

    `getByRole('button', { name: 'Choose a file' })` matches both: MUI renders
    the visible control as a `<label role="button">`, and the input borrows its
    accessible name from that same label. The input is the thing a file goes
    into, and it is deliberately clipped rather than `display: none` so that it
    stays reachable by keyboard — which is also what keeps it addressable here.
  */
  await dialog.getByLabel('Choose a file').setInputFiles({
    name: filename,
    mimeType: 'application/pdf',
    buffer: aPdf(token),
  });

  // Nothing is stored until it is named (F26): the file waits, under the
  // name it came with, for somebody to say go ahead.
  await expect(dialog.getByLabel('Filename')).toHaveValue(filename);
  await dialog.getByRole('button', { name: 'Attach document' }).click();

  await expect(page.getByText(`${filename} attached`)).toBeVisible();

  // It appears against the leg it was attached to, in the trail itself.
  await expect(
    page
      .getByRole('tree', { name: 'Money trail for TradeifyPayout001' })
      .getByRole('link', { name: filename }),
  ).toBeVisible();

  // ---------- and now find it again, from the other side ----------

  await page.getByRole('link', { name: 'Documents' }).click();
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();

  /*
    It is already there, without a word being typed (F31).

    Nothing dated it, so it sorts as just arrived — which is exactly where the
    reader who just uploaded it will look for it.
  */
  const register = page.getByRole('table', { name: 'Documents' });
  await expect(register.getByText(filename)).toBeVisible();

  await field(page, 'Search documents').fill(token);

  const results = register;
  await expect(results.getByText(filename)).toBeVisible();
  // Exact, because the filename contains the word too — the assertion is
  // about the Kind cell, which is what was chosen on the way in.
  await expect(results.getByText('statement', { exact: true })).toBeVisible();

  // Reading it back is the last link in the chain: the bytes are served by a
  // handler keyed on the id, behind both guards — never a static mount (§13).
  await results.getByText(filename).click();

  const frame = page.locator(`iframe[title="${filename}"]`);
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute('src', /^\/api\/documents\/\d+$/);

  const source = await frame.getAttribute('src');
  const served = await page.request.get(source as string);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toContain('application/pdf');
  expect((await served.body()).toString('utf8')).toContain(token);

  // ---------- and now take it back out of the world ----------

  /*
    The same chain in reverse, and the half no unit test can reach: the row,
    the link on the leg, the FTS5 index and the file on disk all have to go
    together. The last assertion is the strongest — the handler that served
    those bytes a moment ago now answers 404, because the row it was keyed on
    is gone.
  */
  await page.getByRole('button', { name: `Delete ${filename}` }).click();

  const confirmation = page.getByRole('dialog');
  await expect(confirmation).toContainText(`Delete ${filename}?`);
  await confirmation.getByRole('button', { name: 'Delete document' }).click();

  await expect(page.getByText(new RegExp(`${filename} deleted`))).toBeVisible();

  // Out of the search, because the `documents_ad` trigger took the FTS index
  // with the row.
  await expect(page.getByText(/Nothing matched/)).toBeVisible();

  // And off the leg it was evidence for.
  await page.getByRole('link', { name: 'Payouts' }).click();
  await page
    .getByRole('table', { name: 'Payouts' })
    .getByText('TradeifyPayout001')
    .click();
  await expect(
    page
      .getByRole('tree', { name: 'Money trail for TradeifyPayout001' })
      .getByRole('link', { name: filename }),
  ).toHaveCount(0);

  expect((await page.request.get(source as string)).status()).toBe(404);
});

/**
 * Journey 37: the register itself — every document on file, ten at a time.
 *
 * The sheet names eleven distinct files (§9), so the world this runs in has
 * two pages the moment it is imported, and no upload is needed to find out
 * whether paging works. Which is the point: the ten rows on screen are a page
 * of a list the server cut, not the whole list with the rest hidden, and the
 * only way to tell the two apart is to ask for the eleventh.
 */
test('lists every document on file, a page at a time', async ({ page, world }) => {
  await world.signIn(page, CHANGED_PASSWORD);

  await page.getByRole('link', { name: 'Documents' }).click();
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();

  // No search, and rows all the same: the register answers before it is asked.
  const register = page.getByRole('table', { name: 'Documents' });
  await expect(register.getByRole('row')).toHaveCount(11); // ten, plus the header
  await expect(page.getByText('1–10 of 11')).toBeVisible();
  await expect(page.getByText('Page 1 of 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();

  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByText('11–11 of 11')).toBeVisible();
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await expect(register.getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();

  // And the box narrows the same list rather than opening a different screen:
  // four wallet screenshots, on one page, counted.
  await field(page, 'Search documents').fill('trustwallet');

  await expect(page.getByText('1–4 of 4')).toBeVisible();
  await expect(register.getByText('trustwallet-1.png')).toBeVisible();

  // A fragment, not a whole word: `LIKE` on the filename beside the FTS index.
  await field(page, 'Search documents').fill('wallet-2');

  await expect(page.getByText('1–1 of 1')).toBeVisible();
});
