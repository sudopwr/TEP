import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  answering,
  deleteFails,
  documentAlreadyStored,
} from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import {
  renderApp,
  renderFeature,
  screen,
  within,
} from '../../../test/renderApp';

import { DocumentUpload } from './DocumentUpload';

/**
 * Search, preview and upload — F6 and F7.
 */

describe('searching documents', () => {
  it('asks nothing until there is something to search for', async () => {
    // The API answers 400 to an empty query and is right to, but an empty
    // search box is the normal state of a search box.
    renderApp({ route: '/documents' });

    expect(
      await screen.findByText('Search for a document.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('table', { name: 'Search results' }),
    ).not.toBeInTheDocument();
  });

  it('shows what matched once a term is typed', async () => {
    renderApp({ route: '/documents' });
    await screen.findByText('Search for a document.');

    await userEvent.type(screen.getByLabelText('Search documents'), 'coindcx');

    expect(await screen.findByText('coindcx-march.pdf')).toBeInTheDocument();
    expect(screen.getByText('20 KB')).toBeInTheDocument();
  });

  it('names the term that found nothing, and offers a way out', async () => {
    server.use(answering('/api/documents/search', { documents: [] }));

    renderApp({ route: '/documents' });
    await screen.findByText('Search for a document.');

    await userEvent.type(screen.getByLabelText('Search documents'), 'kraken');

    expect(await screen.findByText(/kraken/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Clear the search' }),
    ).toBeInTheDocument();
  });
});

describe('previewing a document', () => {
  it('invites a choice rather than showing an empty frame', async () => {
    renderApp({ route: '/documents' });

    expect(
      await screen.findByText('No document selected.'),
    ).toBeInTheDocument();
  });

  it('serves the file through the route, by id', async () => {
    /*
      Never a static mount (§13). Mounting `data/files` would publish every
      stored statement to anybody who can guess a hash — and the hashes are
      printed in these very results.
    */
    renderApp({ route: '/documents' });
    await screen.findByText('Search for a document.');

    await userEvent.type(screen.getByLabelText('Search documents'), 'coindcx');
    await userEvent.click(await screen.findByText('coindcx-march.pdf'));

    const frame = await screen.findByTitle('coindcx-march.pdf');
    expect(frame).toHaveAttribute('src', '/api/documents/10');
  });

  it('shows the hash in full, since that is what identifies the bytes', async () => {
    renderApp({ route: '/documents' });
    await screen.findByText('Search for a document.');

    await userEvent.type(screen.getByLabelText('Search documents'), 'coindcx');
    await userEvent.click(await screen.findByText('coindcx-march.pdf'));

    expect(
      await screen.findByText(`sha256 ${'a'.repeat(64)}`),
    ).toBeInTheDocument();
  });
});

describe('attaching a document', () => {
  it('asks which leg it belongs to before it will take a file', async () => {
    // A file attached to the payout as a whole is filing; a file attached to
    // the sale it settles is evidence.
    renderFeature(<DocumentUpload payoutId={1} />);

    expect(
      await screen.findByText('Choose the leg it belongs to first.'),
    ).toBeInTheDocument();
    // The input itself, not the label that fronts it: a label cannot be
    // disabled, and asserting on one would pass however the input behaved.
    expect(screen.getByLabelText('Choose a file')).toBeDisabled();
  });

  it('accepts a file once a leg is chosen, and says it was attached', async () => {
    renderFeature(<DocumentUpload payoutId={1} />);
    await screen.findByText('Choose the leg it belongs to first.');

    await userEvent.click(
      screen.getByRole('combobox', { name: /To which leg/ }),
    );
    await userEvent.click(
      await screen.findByRole('option', { name: /Transaction003/ }),
    );

    const file = new File(['bytes'], 'march.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText('Choose a file'), file);

    expect(await screen.findByText('Document attached')).toBeInTheDocument();
  });

  it('says plainly when the bytes were already on file', async () => {
    // UC4 dedupes by SHA-256 and links the existing document. "Attached" and
    // "already stored, now linked here too" are different facts, and the
    // second is reassuring rather than alarming.
    server.use(documentAlreadyStored());

    renderFeature(<DocumentUpload payoutId={1} />);
    await screen.findByText('Choose the leg it belongs to first.');

    await userEvent.click(
      screen.getByRole('combobox', { name: /To which leg/ }),
    );
    await userEvent.click(
      await screen.findByRole('option', { name: /Transaction003/ }),
    );

    await userEvent.upload(
      screen.getByLabelText('Choose a file'),
      new File(['bytes'], 'march.pdf', { type: 'application/pdf' }),
    );

    expect(await screen.findByText(/already stored/)).toBeInTheDocument();
  });
});

describe('deleting a document', () => {
  const askToDelete = async (): Promise<HTMLElement> => {
    renderApp({ route: '/documents' });
    // The screen is behind the auth probe: wait for it before typing.
    await screen.findByText('Search for a document.');

    await userEvent.type(screen.getByLabelText('Search documents'), 'coindcx');
    await screen.findByRole('table', { name: 'Search results' });

    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete coindcx-march.pdf' }),
    );

    return screen.findByRole('dialog');
  };

  it('asks first, naming the file and what else loses it', async () => {
    // F6: one file may be evidence for several things, so "delete" here is
    // wider than the row the reader is looking at, and has to say so.
    const dialog = await askToDelete();

    expect(
      within(dialog).getByText('Delete coindcx-march.pdf?'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /every attachment to a company, a payout or a leg/,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
  });

  it('deletes it and says how many attachments went', async () => {
    const dialog = await askToDelete();

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete document' }),
    );

    expect(
      await screen.findByText('coindcx-march.pdf deleted, from 2 attachments'),
    ).toBeInTheDocument();
  });

  it('does not open the preview when the delete button is clicked', async () => {
    // The row selects a document to preview; the button inside it must not,
    // or deleting would first show the reader what it is about to remove.
    renderApp({ route: '/documents' });
    await screen.findByText('Search for a document.');

    await userEvent.type(screen.getByLabelText('Search documents'), 'coindcx');
    await screen.findByRole('table', { name: 'Search results' });

    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete coindcx-march.pdf' }),
    );

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('No document selected.')).toBeInTheDocument();
  });

  it('deletes nothing when the question is declined', async () => {
    const dialog = await askToDelete();

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    );

    expect(
      await screen.findByRole('table', { name: 'Search results' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/deleted/)).not.toBeInTheDocument();
  });

  it('shows the reason beside the question when the server refuses', async () => {
    server.use(
      deleteFails('/api/documents/:id', {
        code: 'document_not_found',
        message: 'No document with id 10.',
      }),
    );

    const dialog = await askToDelete();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete document' }),
    );

    expect(
      await within(dialog).findByText('No document with id 10.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Delete coindcx-march.pdf?')).toBeInTheDocument();
  });
});
