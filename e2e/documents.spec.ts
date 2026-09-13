import {
  CHANGED_PASSWORD,
  changedPassword as test,
  choose,
  expect,
  field,
} from './fixtures/world';

/**
 * Journey 7: a file goes in, and comes back out of the search.
 *
 * The one journey that crosses every layer at once — a multipart POST through
 * the proxy, a SHA-256 on the server, bytes written under the world's own
 * files root, a row in `documents`, an FTS5 index, and a handler streaming it
 * back. None of that is provable from either end alone.
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

test('attaches a statement to a leg, then finds it by searching', async ({
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

  await expect(
    page.getByRole('heading', { name: 'Attach a document' }),
  ).toBeVisible();

  // A file belongs to a leg, not to the payout — the exchange statement
  // belongs to the sale it settles. So the form asks which, first.
  await expect(
    page.getByText('Choose the leg it belongs to first.'),
  ).toBeVisible();

  await choose(page, 'To which leg').click();
  await page.getByRole('option', { name: /Transaction003/ }).click();

  await choose(page, 'Kind').click();
  await page.getByRole('option', { name: 'statement' }).click();

  /*
    By label, which reaches the input rather than the label that fronts it.

    `getByRole('button', { name: 'Choose a file' })` matches both: MUI renders
    the visible control as a `<label role="button">`, and the input borrows its
    accessible name from that same label. The input is the thing a file goes
    into, and it is deliberately clipped rather than `display: none` so that it
    stays reachable by keyboard — which is also what keeps it addressable here.
  */
  await page.getByLabel('Choose a file').setInputFiles({
    name: filename,
    mimeType: 'application/pdf',
    buffer: aPdf(token),
  });

  await expect(page.getByText('Document attached')).toBeVisible();

  // It appears against the leg it was attached to, in the trail itself.
  await expect(
    page
      .getByRole('tree', { name: 'Money trail for TradeifyPayout001' })
      .getByRole('link', { name: filename }),
  ).toBeVisible();

  // ---------- and now find it again, from the other side ----------

  await page.getByRole('link', { name: 'Documents' }).click();
  await expect(
    page.getByRole('heading', { name: 'Documents' }),
  ).toBeVisible();

  // Nothing is searched until something is typed: the API answers 400 to an
  // empty query, and an empty search box is the normal state of one.
  await expect(page.getByText('Search for a document.')).toBeVisible();

  await field(page, 'Search documents').fill(token);

  const results = page.getByRole('table', { name: 'Search results' });
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
});
