import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { DOCUMENTS } from '../../../test/msw/fixtures';
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
  it('defaults to the payout itself, which needs no leg chosen', async () => {
    // The contract and the firm's own summary belong to the award rather
    // than to any movement, and before F23 there was nowhere to put them.
    renderFeature(<DocumentUpload payoutId={1} />);

    expect(
      await screen.findByRole('combobox', { name: /Attach to/ }),
    ).toHaveTextContent('The payout itself');
    // The input itself, not the label that fronts it: a label cannot be
    // disabled, and asserting on one would pass however the input behaved.
    expect(screen.getByLabelText('Choose a file')).not.toBeDisabled();
  });

  it('takes a file for the payout as a whole', async () => {
    renderFeature(<DocumentUpload payoutId={1} />);
    await screen.findByRole('combobox', { name: /Attach to/ });

    await userEvent.upload(
      screen.getByLabelText('Choose a file'),
      new File(['bytes'], 'contract.pdf', { type: 'application/pdf' }),
    );

    expect(await screen.findByText('Document attached')).toBeInTheDocument();
  });

  it('takes a file for one leg, when a leg is chosen', async () => {
    // A file attached to the payout as a whole is filing; a file attached to
    // the sale it settles is evidence.
    renderFeature(<DocumentUpload payoutId={1} />);
    await screen.findByRole('combobox', { name: /Attach to/ });

    await userEvent.click(screen.getByRole('combobox', { name: /Attach to/ }));
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
    server.use(...documentAlreadyStored());

    renderFeature(<DocumentUpload payoutId={1} />);
    await screen.findByRole('combobox', { name: /Attach to/ });

    await userEvent.upload(
      screen.getByLabelText('Choose a file'),
      new File(['bytes'], 'march.pdf', { type: 'application/pdf' }),
    );

    expect(await screen.findByText(/already stored/)).toBeInTheDocument();
  });
});

describe('pasting a screenshot (F25)', () => {
  /** A screenshot on the clipboard, as the browser hands one over. */
  const pasteScreenshot = (name = 'image.png'): void => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        files: [new File(['png bytes'], name, { type: 'image/png' })],
        items: [],
      },
    });
    window.dispatchEvent(event);
  };

  it('stores it against the payout, without it ever touching the disk', async () => {
    renderFeature(<DocumentUpload payoutId={1} />);
    await screen.findByRole('combobox', { name: /Attach to/ });

    pasteScreenshot();

    expect(await screen.findByText('Document attached')).toBeInTheDocument();
  });

  it('sends it to the leg the form is pointed at', async () => {
    // The paste is another way to hand over a file, not another way to
    // decide what it is evidence for: the form above still says that.
    const sent = new Promise<string>((resolve) => {
      server.use(
        http.post('/api/transactions/:id/documents', ({ params }) => {
          resolve(String(params['id']));

          return HttpResponse.json(
            { document: DOCUMENTS[0], created: true },
            { status: 201 },
          );
        }),
      );
    });

    renderFeature(<DocumentUpload payoutId={1} />);
    await userEvent.click(
      await screen.findByRole('combobox', { name: /Attach to/ }),
    );
    await userEvent.click(
      await screen.findByRole('option', { name: /Transaction003/ }),
    );

    pasteScreenshot();

    expect(await sent).toBe('3');
  });

  it('carries the kind and the date chosen beside it', async () => {
    const sent = new Promise<FormData>((resolve) => {
      server.use(
        http.post('/api/payouts/:id/documents', async ({ request }) => {
          resolve(await request.formData());

          return HttpResponse.json(
            { document: DOCUMENTS[0], created: true },
            { status: 201 },
          );
        }),
      );
    });

    renderFeature(<DocumentUpload payoutId={1} />);
    await userEvent.click(await screen.findByRole('combobox', { name: 'Kind' }));
    await userEvent.click(await screen.findByRole('option', { name: 'receipt' }));

    pasteScreenshot();

    const form = await sent;
    expect(form.get('docType')).toBe('receipt');
    expect((form.get('file') as File).name).toMatch(/^pasted-/);
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

describe('documents on the payout screen (F23)', () => {
  const payoutDocuments = (documents: readonly unknown[]) =>
    answering('/api/payouts/:id/documents', { documents });

  const openThePayout = async (): Promise<void> => {
    renderApp({ route: '/payouts/1' });
    await screen.findByRole('heading', { name: /TradeifyPayout001/ });
  };

  it('says plainly when nothing is attached to the payout itself', async () => {
    // The distinction the panel exists for: a receipt for one movement
    // belongs on its leg, not here.
    await openThePayout();

    expect(
      await screen.findByText('Nothing is attached to this payout itself.'),
    ).toBeInTheDocument();
  });

  it('lists what is attached to the payout, with a way to open it', async () => {
    server.use(payoutDocuments([DOCUMENTS[0]]));

    await openThePayout();

    const link = await screen.findByRole('link', {
      name: 'coindcx-march.pdf',
    });
    // Served by the handler, behind both guards — never a static mount.
    expect(link).toHaveAttribute('href', '/api/documents/10');
  });

  it('opens one dialog that can upload a file or choose one on record', async () => {
    // The two ways in are the same intention, so they are one dialog: the
    // file is either on the desk or already on file.
    await openThePayout();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Attach a document' }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/Attach a document to this payout/),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Choose a file')).toBeInTheDocument();
    expect(
      within(dialog).getByLabelText('Search documents'),
    ).toBeInTheDocument();
  });

  it('attaches one that is already on record, without uploading anything', async () => {
    await openThePayout();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Attach a document' }),
    );

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(
      within(dialog).getByLabelText('Search documents'),
      'coindcx',
    );
    await userEvent.click(
      await within(dialog).findByRole('button', {
        name: 'Attach coindcx-march.pdf',
      }),
    );

    expect(
      await screen.findByText('coindcx-march.pdf attached'),
    ).toBeInTheDocument();
  });

  it('removes one from the payout, saying the file stays on record', async () => {
    // "Remove", not "Delete": F23 breaks one attachment, F22 deletes the
    // file. The copy has to carry that difference, or the reader cannot tell
    // which of the two they just did.
    server.use(payoutDocuments([DOCUMENTS[0]]));

    await openThePayout();
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Remove coindcx-march.pdf from this payout',
      }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/The file stays on\s+record/),
    ).toBeInTheDocument();

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Remove document' }),
    );

    expect(
      await screen.findByText(/coindcx-march.pdf removed/),
    ).toBeInTheDocument();
  });

  it('says when the last thing lets go, which is not a deletion', async () => {
    server.use(payoutDocuments([DOCUMENTS[0]]));

    await openThePayout();
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Remove coindcx-march.pdf from this payout',
      }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Remove document',
      }),
    );

    expect(
      await screen.findByText(/still on record, attached to nothing/),
    ).toBeInTheDocument();
  });

  it('keeps the document when the question is declined', async () => {
    server.use(payoutDocuments([DOCUMENTS[0]]));

    await openThePayout();
    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Remove coindcx-march.pdf from this payout',
      }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Cancel',
      }),
    );

    expect(
      await screen.findByRole('link', { name: 'coindcx-march.pdf' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/removed/)).not.toBeInTheDocument();
  });
});
