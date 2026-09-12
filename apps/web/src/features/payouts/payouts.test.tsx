import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  answering,
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

    expect(
      await screen.findByText('FTDFYSLX50676373980'),
    ).toBeInTheDocument();
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
        { path: 'grossAmount', message: 'expected an amount greater than zero' },
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
