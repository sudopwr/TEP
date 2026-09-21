import {
  CHANGED_PASSWORD,
  changedPassword as test,
  expect,
} from './fixtures/world';

/**
 * Journey 16: a screenshot goes from the clipboard to the ledger (F25).
 *
 * The shortest path a document can take — Ctrl + V, and the bytes are
 * hashed, stored and linked without ever being a file on disk. Driven in a
 * real browser because that is the only place a paste exists: the event, its
 * `DataTransfer`, the window listener that catches it and the multipart POST
 * that follows are four things no unit test holds together.
 *
 * The bytes are a real PNG, so what comes back out of `/api/documents/:id` is
 * what went in — same length, same magic number — rather than something that
 * merely has the right filename.
 */

/** The smallest valid PNG: one transparent pixel, as base64. */
const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
  'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('pastes a screenshot straight into the payout (F25)', async ({
  page,
  world,
}) => {
  await world.signIn(page, CHANGED_PASSWORD);
  await page
    .getByRole('table', { name: 'Payouts' })
    .getByText('TradeifyPayout001')
    .click();

  await expect(
    page.getByRole('heading', { name: 'Attach a document' }),
  ).toBeVisible();

  // The shortcut is on screen, because one nobody knows about is one nobody
  // uses. (⌘V on a Mac; the runner is not one.)
  await expect(page.getByText(/paste an image from the clipboard/i)).toBeVisible();

  /*
    A paste, as the browser delivers one.

    Playwright cannot put an image on the real system clipboard, so the event
    is constructed with the same shape a real one has — a `DataTransfer`
    carrying a `File` — and dispatched at the window, which is exactly where
    a real paste lands when neither dropzone has focus.
  */
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) =>
      character.charCodeAt(0),
    );
    // `image.png` is what a screenshot is called; the application renames it.
    const file = new File([bytes], 'image.png', { type: 'image/png' });

    const clipboard = new DataTransfer();
    clipboard.items.add(file);
    window.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, ONE_PIXEL_PNG);

  /*
    Named before it is stored (F26), and this is the paste that makes that
    matter: `image.png` says nothing, and the name it goes in under is the
    one the trail shows and F7 searches. The application proposes one; the
    reader types the one they will recognise.
  */
  const proposed = page.getByLabel('Filename');
  await expect(proposed).toHaveValue(/^pasted-.*\.png$/);

  await proposed.fill('hdfc-credit-10-march');
  await page.getByRole('button', { name: 'Attach document' }).click();

  await expect(page.getByText('Document attached')).toBeVisible();

  /*
    Stored under the typed name, with the ending kept.

    Typing over `image.png` means the name, not the format — a file saved out
    later with no extension is one nothing will open.

    Every screenshot has that name, so a ledger of them is a list nobody can
    read and a filename search (F7) that cannot help. The row below is the
    payout's own documents (F23), since the form defaulted to the payout.
  */
  const stored = page.getByRole('link', {
    name: 'hdfc-credit-10-march.png',
  });
  await expect(stored).toBeVisible();

  // ---------- and the bytes are the ones that were pasted ----------

  /*
    The list links straight at the handler, which is where the bytes live:
    `/api/documents/:id`, behind both guards, never a static mount (§13). So
    the link's own href is the thing to follow, and following it with the
    session's cookies is what proves the file is really stored.
  */
  const filename = (await stored.textContent()) ?? '';
  await expect(stored).toHaveAttribute('href', /^\/api\/documents\/\d+$/);

  const source = await stored.getAttribute('href');
  const served = await page.request.get(source as string);

  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toContain('image/png');
  expect(served.headers()['content-disposition']).toContain(filename);

  const body = await served.body();
  expect(body.length).toBe(Buffer.from(ONE_PIXEL_PNG, 'base64').length);
  // The PNG magic number, so this is the image and not an error page.
  expect(body.subarray(0, 4).toString('hex')).toBe('89504e47');
});

test('a text paste still goes where it was typed', async ({ page, world }) => {
  // The window listener must not swallow every Ctrl + V in the application:
  // a clipboard with no files on it is nothing to do with documents. This one
  // is a real clipboard and a real keystroke, which is the only way to prove
  // the browser still did its own work.
  await page
    .context()
    .grantPermissions(['clipboard-read', 'clipboard-write']);

  await world.signIn(page, CHANGED_PASSWORD);
  await page
    .getByRole('table', { name: 'Payouts' })
    .getByText('TradeifyPayout001')
    .click();

  await expect(
    page.getByRole('heading', { name: 'Attach a document' }),
  ).toBeVisible();

  // Inside the attach dialog, which is where a dropzone and a text field sit
  // together — the exact place a greedy paste handler would do damage.
  await page
    .getByRole('button', { name: 'Attach a document', exact: true })
    .click();

  const dialog = page.getByRole('dialog');
  const search = dialog.getByLabel('Search documents');
  await search.click();
  await page.evaluate(() => navigator.clipboard.writeText('coindcx'));
  await page.keyboard.press('ControlOrMeta+V');

  await expect(search).toHaveValue('coindcx');
  await expect(page.getByText('Document attached')).toBeHidden();
});
