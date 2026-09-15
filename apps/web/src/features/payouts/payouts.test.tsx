import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  answering,
  companyCanBeAdded,
  deleteFails,
  invalidRequest,
  unreachable,
} from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp, screen, within } from '../../../test/renderApp';

/**
 * The list, the detail and the form — driven by URL through the real router.
 */

describe('the payout list', () => {
  it('shows the payout with its company and its gross', async () => {
    renderApp({ route: '/payouts' });

    const table = await screen.findByRole('table', { name: 'Payouts' });

    // `find`, not `get`: the table renders first as skeleton rows, which is
    // the point of keeping loading and empty apart.
    expect(
      await within(table).findByText('TradeifyPayout001'),
    ).toBeInTheDocument();
    expect(within(table).getByText('Tradeify')).toBeInTheDocument();
    expect(within(table).getByText('1,008.01')).toBeInTheDocument();
  });

  it('shows the reference as text, digit for digit', async () => {
    // §9 defect 3: Excel turned a reference of this shape into `1.43908E+19`
    // and destroyed it. Every reference column is TEXT, and so is this cell.
    renderApp({ route: '/payouts' });

    expect(await screen.findByText('FTDFYSLX50676373980')).toBeInTheDocument();
  });

  it('opens the payout when its row is clicked', async () => {
    renderApp({ route: '/payouts' });
    const table = await screen.findByRole('table', { name: 'Payouts' });

    await userEvent.click(await within(table).findByText('TradeifyPayout001'));

    expect(
      await screen.findByRole('heading', { name: /TradeifyPayout001/ }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Settlement')).toBeInTheDocument();
  });

  it('invites the first payout rather than apologising for an empty table', async () => {
    server.use(answering('/api/payouts', { payouts: [] }));

    renderApp({ route: '/payouts' });

    expect(
      await screen.findByText('No payouts recorded yet.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Record the first payout' }),
    ).toBeInTheDocument();
  });

  it('says what happened and what to do when the server is down', async () => {
    server.use(unreachable('/api/payouts'));

    renderApp({ route: '/payouts' });

    expect(
      await screen.findByText(
        'The application could not reach the server.',
        {},
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Check that the API is running on 127\.0\.0\.1:3000/),
    ).toBeInTheDocument();
  });
});

describe('recording a payout', () => {
  const fill = async (): Promise<void> => {
    await userEvent.type(
      screen.getByLabelText(/^Payout code/),
      'TradeifyPayout002',
    );
    await userEvent.type(screen.getByLabelText(/^Gross awarded/), '1008.01');
  };

  it('confirms in the words the button used', async () => {
    // The button says "Record payout"; the confirmation says "Payout
    // recorded". Anything else makes the reader check whether the thing they
    // pressed is the thing that happened.
    renderApp({ route: '/payouts/new' });
    await screen.findByRole('heading', { name: 'Record payout' });

    await fill();
    await userEvent.click(
      screen.getByRole('button', { name: 'Record payout' }),
    );

    expect(await screen.findByText('Payout recorded')).toBeInTheDocument();
  });

  it('goes straight to the payout it just created', async () => {
    // The next thing anybody does after recording an award is record the leg
    // that moved it, and that lives on the payout's own screen.
    renderApp({ route: '/payouts/new' });
    await screen.findByRole('heading', { name: 'Record payout' });

    await fill();
    await userEvent.click(
      screen.getByRole('button', { name: 'Record payout' }),
    );

    expect(
      await screen.findByRole('heading', { name: /TradeifyPayout001/ }),
    ).toBeInTheDocument();
  });

  it("puts the server's complaint under the field it is about", async () => {
    server.use(
      invalidRequest('/api/payouts', [
        {
          path: 'grossAmount',
          message: 'expected an amount greater than zero',
        },
      ]),
    );

    renderApp({ route: '/payouts/new' });
    await screen.findByRole('heading', { name: 'Record payout' });

    await fill();
    await userEvent.click(
      screen.getByRole('button', { name: 'Record payout' }),
    );

    const message = await screen.findByText(
      'expected an amount greater than zero',
    );
    expect(message).toBeInTheDocument();

    // And not as a wall of text at the top instead.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('refuses a keystroke that would make the amount not a decimal', async () => {
    // N1 reaches the keyboard: nothing between here and
    // `Money.fromDecimalString` parses the digits, so the field never accepts
    // anything that is not a decimal in the first place.
    renderApp({ route: '/payouts/new' });
    await screen.findByRole('heading', { name: 'Record payout' });

    const amount = screen.getByLabelText(/^Gross awarded/);
    await userEvent.type(amount, '1,008.01');

    // The comma is rejected and the rest keeps going, rather than the field
    // silently "repairing" the paste into something else.
    expect(amount).toHaveValue('1008.01');
  });
});

describe('adding a company while recording a payout', () => {
  const FUNDED_NEXT = {
    id: 99,
    code: 'FundedNext001',
    name: 'FundedNext',
    notes: null,
  };

  const openTheDialog = async (): Promise<void> => {
    renderApp({ route: '/payouts/new' });
    await screen.findByRole('heading', { name: 'Record payout' });

    await userEvent.click(screen.getByRole('combobox', { name: /Company/ }));
    await userEvent.click(
      await screen.findByRole('option', { name: 'Add a company…' }),
    );
  };

  it('offers the choice that is missing, inside the list of choices', async () => {
    // The moment somebody needs a company that is not there is the moment
    // they have the dropdown open — so that is where the way to add one is.
    renderApp({ route: '/payouts/new' });
    await screen.findByRole('heading', { name: 'Record payout' });

    await userEvent.click(screen.getByRole('combobox', { name: /Company/ }));

    expect(
      await screen.findByRole('option', { name: 'Tradeify' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Add a company…' }),
    ).toBeInTheDocument();
  });

  it('selects the company it just added, without losing the form', async () => {
    server.use(...companyCanBeAdded(FUNDED_NEXT));

    await openTheDialog();
    await userEvent.type(
      screen.getByLabelText(/^Company code/),
      'FundedNext001',
    );
    await userEvent.type(screen.getByLabelText(/^Company name/), 'FundedNext');
    await userEvent.click(screen.getByRole('button', { name: 'Add company' }));

    // The list was refetched before the selection was made, so the select
    // shows a name rather than an empty box holding an id nothing matches.
    expect(
      await screen.findByRole('combobox', { name: /Company/ }),
    ).toHaveTextContent('FundedNext');
    expect(await screen.findByText('FundedNext added')).toBeInTheDocument();
  });

  it('records no payout when the company form is submitted', async () => {
    // A dialog renders through a portal, but React propagates its events
    // along its own tree: with the dialog inside the payout's <form>, adding
    // a company submitted the payout too.
    server.use(...companyCanBeAdded(FUNDED_NEXT));

    await openTheDialog();
    await userEvent.type(screen.getByLabelText(/^Company code/), 'FN001');
    await userEvent.type(screen.getByLabelText(/^Company name/), 'FundedNext');
    await userEvent.click(screen.getByRole('button', { name: 'Add company' }));

    await screen.findByText('FundedNext added');
    expect(screen.queryByText('Payout recorded')).not.toBeInTheDocument();

    // `find`, not `get`: while the dialog plays its closing transition the
    // modal still holds `aria-hidden` on everything behind it, and a role
    // query skips hidden nodes.
    expect(
      await screen.findByRole('heading', { name: 'Record payout' }),
    ).toBeInTheDocument();
  });

  it('leaves the form exactly as it was when the dialog is cancelled', async () => {
    renderApp({ route: '/payouts/new' });
    await screen.findByRole('heading', { name: 'Record payout' });

    await userEvent.type(
      screen.getByLabelText(/^Payout code/),
      'TradeifyPayout002',
    );
    await userEvent.click(screen.getByRole('combobox', { name: /Company/ }));
    await userEvent.click(
      await screen.findByRole('option', { name: 'Tradeify' }),
    );

    await userEvent.click(screen.getByRole('combobox', { name: /Company/ }));
    await userEvent.click(
      await screen.findByRole('option', { name: 'Add a company…' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // The company still chosen, the code still typed: the create item is an
    // action, not a choice that overwrites what was picked before it.
    expect(
      await screen.findByRole('combobox', { name: /Company/ }),
    ).toHaveTextContent('Tradeify');
    expect(screen.getByLabelText(/^Payout code/)).toHaveValue(
      'TradeifyPayout002',
    );
  });

  it("puts the server's complaint under the field it is about", async () => {
    server.use(
      invalidRequest('/api/companies', [
        { path: 'code', message: 'a company with that code already exists' },
      ]),
    );

    await openTheDialog();
    await userEvent.type(screen.getByLabelText(/^Company code/), 'Tradeify001');
    await userEvent.type(screen.getByLabelText(/^Company name/), 'Tradeify');
    await userEvent.click(screen.getByRole('button', { name: 'Add company' }));

    expect(
      await screen.findByText('a company with that code already exists'),
    ).toBeInTheDocument();
  });
});

describe('deleting a payout', () => {
  const openThePayout = async (): Promise<void> => {
    renderApp({ route: '/payouts/1' });
    await screen.findByRole('heading', { name: /TradeifyPayout001/ });
  };

  it('asks first, naming the payout and what goes with it', async () => {
    await openThePayout();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete payout' }),
    );

    expect(
      await screen.findByText('Delete TradeifyPayout001?'),
    ).toBeInTheDocument();
    // The count is the point of the sentence: it is what stops somebody
    // deleting the payout below the one they meant.
    expect(screen.getByText(/13 legs/)).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
  });

  it('deletes nothing when the question is declined', async () => {
    await openThePayout();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete payout' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      await screen.findByRole('heading', { name: /TradeifyPayout001/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/deleted/)).not.toBeInTheDocument();
  });

  it('returns to the list and says what it deleted', async () => {
    await openThePayout();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete payout' }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Delete payout',
      }),
    );

    // Named, not "Payout deleted": the reader needs to see which one went.
    expect(
      await screen.findByText('TradeifyPayout001 deleted'),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Payouts' }),
    ).toBeInTheDocument();
  });

  it('says what happened when the server refuses', async () => {
    server.use(deleteFails('/api/payouts/:id'));

    await openThePayout();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete payout' }),
    );
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Delete payout',
      }),
    );

    // The server's own sentence, passed through (§12), not "Something went
    // wrong" — and under the question, which is still live: the payout is
    // still there, and the answer is still "delete it".
    expect(
      await screen.findByText(/There is no payout numbered 1\./),
    ).toBeInTheDocument();
    expect(screen.getByText('Delete TradeifyPayout001?')).toBeInTheDocument();
    expect(screen.queryByText(/deleted$/)).not.toBeInTheDocument();
  });
});
