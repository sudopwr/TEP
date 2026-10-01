import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { answering, invalidRequest } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp, screen, waitFor, within } from '../../../test/renderApp';

/**
 * F33 — the export and import screen.
 *
 * The browser's half of the feature is narrow and worth pinning anyway: it
 * counts what is on file before offering to destroy it, it asks once, it names
 * the file the server named, and it never sends a replacement nobody confirmed.
 */

/**
 * What a download turned into, without one actually happening.
 *
 * `URL.createObjectURL` does not exist in happy-dom and an anchor click would
 * do nothing anyway, so both are replaced for this file: the two methods are
 * *added* to `URL` rather than the global being swapped for an object, because
 * swapping it takes `new URL()` with it — and `client.ts` resolves every
 * request path through `new URL()`, so the screen stops loading at all.
 */
const downloads: { href: string; download: string }[] = [];

beforeEach(() => {
  downloads.length = 0;

  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:the-archive'),
    revokeObjectURL: vi.fn(),
  });

  // `restoreMocks` in the vitest web project puts this back after each test.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ href: this.href, download: this.download });
  });
});

const openScreen = async () => {
  renderApp({ route: '/transfer' });

  return screen.findByRole('heading', { name: 'Export and import' });
};

const chooseArchive = async (
  name = 'payout-tracker-2026-10-01.tar.gz',
): Promise<File> => {
  const file = new File(['gzipped-archive'], name, {
    type: 'application/gzip',
  });

  await userEvent.upload(screen.getByLabelText('Choose a file'), file);

  return file;
};

describe('exporting', () => {
  it('says what is on file before offering to export it', async () => {
    await openScreen();

    expect(
      await screen.findByText(/On file now: 1 trader, 2 companies/),
    ).toBeInTheDocument();
    expect(screen.getByText(/13 transactions/)).toBeInTheDocument();
  });

  it('counts in the singular when there is one of something', async () => {
    // "1 payouts" is the sort of thing that makes a reader doubt the rest.
    await openScreen();

    expect(await screen.findByText(/1 payout,/)).toBeInTheDocument();
  });

  it('downloads the archive under the name the server gave it', async () => {
    await openScreen();

    await userEvent.click(
      screen.getByRole('button', { name: 'Export everything' }),
    );

    await waitFor(() => {
      expect(downloads).toHaveLength(1);
    });
    // Not a name the browser made up: `content-disposition` is the authority,
    // so one export is one file with the date on it.
    expect(downloads[0]?.download).toBe('payout-tracker-2026-10-01.tar.gz');
    expect(downloads[0]?.href).toContain('blob:');
  });

  it('says what it exported, in the same words', async () => {
    await openScreen();

    await userEvent.click(
      screen.getByRole('button', { name: 'Export everything' }),
    );

    expect(await screen.findByText(/^Exported 1 trader/)).toBeInTheDocument();
  });

  it('shows the server reason when an export fails', async () => {
    server.use(
      http.get('/api/export', () =>
        HttpResponse.json(
          { code: 'internal_error', message: 'Something failed.' },
          { status: 500 },
        ),
      ),
    );

    await openScreen();
    await userEvent.click(
      screen.getByRole('button', { name: 'Export everything' }),
    );

    // Not a downloaded file containing an error message, which is what a plain
    // link would have produced.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('tells the reader the archive holds no password', async () => {
    // §5a. The one fact about the archive that changes what somebody does next
    // when they restore it on a new machine.
    await openScreen();

    expect(screen.getByText(/contains no password/i)).toBeInTheDocument();
  });

  it('says how to open the archive without importing it', async () => {
    await openScreen();

    expect(screen.getByText(/tar -xzf/)).toBeInTheDocument();
    expect(screen.getByText(/ledger\.json/)).toBeInTheDocument();
  });
});

describe('importing', () => {
  it('will not import until a file has been chosen', async () => {
    await openScreen();

    expect(
      screen.getByRole('button', { name: 'Import and replace everything' }),
    ).toBeDisabled();
  });

  it('names the chosen file back, so the wrong one is visible', async () => {
    await openScreen();
    await chooseArchive('last-year.tar.gz');

    expect(await screen.findByText(/last-year\.tar\.gz/)).toBeInTheDocument();
  });

  it('asks before replacing anything, and names what would go', async () => {
    await openScreen();
    await screen.findByText(/On file now/);
    await chooseArchive();

    await userEvent.click(
      screen.getByRole('button', { name: 'Import and replace everything' }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/Replace everything in this ledger\?/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/13 transactions/)).toBeInTheDocument();
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
  });

  it('sends nothing when the question is declined', async () => {
    const posted = vi.fn();
    server.use(
      http.post('/api/import', () => {
        posted();
        return HttpResponse.json({});
      }),
    );

    await openScreen();
    await chooseArchive();
    await userEvent.click(
      screen.getByRole('button', { name: 'Import and replace everything' }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Cancel',
      }),
    );

    expect(posted).not.toHaveBeenCalled();
  });

  it('sends the archive and the replacement flag together', async () => {
    const sent = new Promise<FormData>((resolve) => {
      server.use(
        http.post('/api/import', async ({ request }) => {
          resolve(await request.formData());

          return HttpResponse.json({
            counts: { payouts: 1, transactions: 13 },
            filesRestored: 2,
            replaced: { payouts: 1 },
            createdAt: '2026-09-30T18:00:00.000Z',
          });
        }),
      );
    });

    await openScreen();
    await chooseArchive();
    await userEvent.click(
      screen.getByRole('button', { name: 'Import and replace everything' }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Replace the ledger',
      }),
    );

    const body = await sent;
    // One body, so the file and the permission to replace it cannot be
    // separated on the way to the server.
    expect(body.get('replace')).toBe('true');
    expect((body.get('file') as File).name).toBe(
      'payout-tracker-2026-10-01.tar.gz',
    );
  });

  it('reports what came back, including the files written', async () => {
    await openScreen();
    await chooseArchive();
    await userEvent.click(
      screen.getByRole('button', { name: 'Import and replace everything' }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Replace the ledger',
      }),
    );

    // Twice over, and on purpose: the toast says it happened, and the panel
    // stays on screen afterwards for somebody checking the figures.
    expect(await screen.findAllByText(/^Imported /)).toHaveLength(2);
    expect(
      await screen.findByText(/2 files written back/),
    ).toBeInTheDocument();
    // The date the archive was made, which is the one a reader wants to check.
    expect(screen.getByText(/2026-09-30/)).toBeInTheDocument();
  });

  it('passes the server reason through when the file is not an archive', async () => {
    server.use(
      http.post('/api/import', () =>
        HttpResponse.json(
          {
            code: 'archive_unreadable',
            message:
              'This file is not a payout tracker export: it is not a gzipped tar archive.',
          },
          { status: 422 },
        ),
      ),
    );

    await openScreen();
    await chooseArchive('holiday-photo.jpg');
    await userEvent.click(
      screen.getByRole('button', { name: 'Import and replace everything' }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Replace the ledger',
      }),
    );

    expect(
      await screen.findByText(/not a payout tracker export/),
    ).toBeInTheDocument();
  });

  it('says the import replaces everything, before anything is chosen', async () => {
    // The warning is the screen's, not the dialog's: somebody who reads one
    // sentence should read the one that matters.
    await openScreen();

    expect(
      screen.getByText(/Importing replaces everything in this ledger/),
    ).toBeInTheDocument();
    expect(screen.getByText(/It is a restore, not a merge/)).toBeInTheDocument();
  });

  it('says the new machine keeps its own password', async () => {
    await openScreen();

    expect(
      screen.getByText(/Sign in afterwards with the password of/),
    ).toBeInTheDocument();
    expect(screen.getByText(/archive carries no credentials/)).toBeInTheDocument();
  });

  it('says there is nothing to lose when the ledger is empty', async () => {
    server.use(
      answering('/api/import/state', {
        counts: {
          traders: 0,
          companies: 0,
          accounts: 0,
          payouts: 0,
          transactions: 0,
          fees: 0,
          feeSchedules: 0,
          documents: 0,
          documentLinks: 0,
        },
      }),
    );

    await openScreen();
    await screen.findByText(/On file now: nothing yet/);
    await chooseArchive();
    await userEvent.click(
      screen.getByRole('button', { name: 'Import and replace everything' }),
    );

    expect(
      within(await screen.findByRole('dialog')).getByText(
        /nothing to lose/,
      ),
    ).toBeInTheDocument();
  });
});

describe('getting there', () => {
  beforeEach(() => {
    server.use(invalidRequest('/api/nothing', []));
  });

  it('is in the rail, where somebody looking for a backup would look', async () => {
    renderApp({ route: '/payouts' });

    const link = await screen.findByRole('link', { name: 'Export & import' });

    expect(link).toHaveAttribute('href', '/transfer');
  });
});
