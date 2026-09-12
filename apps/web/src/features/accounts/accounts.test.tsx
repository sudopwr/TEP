import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { answering, invalidRequest } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp, screen, within } from '../../../test/renderApp';

/**
 * F1's other half — the register of accounts, and the form that adds one.
 *
 * The point of the whole feature is the last test here: before it existed, a
 * fresh database could hold a company and a payout and then had nowhere to
 * move money between, because accounts arrived only with the legacy import.
 */

describe('the account list', () => {
  it('shows every account, with what it can hold', async () => {
    renderApp({ route: '/accounts' });

    const table = await screen.findByRole('table', { name: 'Accounts' });

    expect(await within(table).findByText('HDFC')).toBeInTheDocument();
    expect(within(table).getByText('CoinDCX')).toBeInTheDocument();
    expect(within(table).getAllByText('USDT').length).toBeGreaterThan(0);
  });

  it('shows an account no money has ever moved through', async () => {
    /*
      The difference between this screen and Balances, in one assertion.
      Balances are derived from movements (UC7), so Rise — which the §10 tree
      passes money *through* but never leaves any in — has no balance row at
      all, and would be invisible if this screen were built on that endpoint.
    */
    renderApp({ route: '/accounts' });
    const table = await screen.findByRole('table', { name: 'Accounts' });
    await within(table).findByText('HDFC');

    // By code, not by name: the account is called Rise and so is the company
    // it belongs to, so the name appears twice in the same row.
    expect(within(table).getByText('rise')).toBeInTheDocument();
  });

  it('says "anything" for an empty allow-list, not nothing', async () => {
    // An empty list is a real choice — `Account.allows` treats it as
    // permissive — so a blank cell would read as the opposite of the truth.
    server.use(
      answering('/api/accounts', {
        accounts: [
          {
            id: 9,
            code: 'multi',
            name: 'Multi',
            type: 'exchange',
            companyId: null,
            allowedCurrencies: [],
          },
        ],
      }),
    );

    renderApp({ route: '/accounts' });

    expect(await screen.findByText('anything')).toBeInTheDocument();
  });

  it('invites the first account rather than apologising', async () => {
    server.use(answering('/api/accounts', { accounts: [] }));

    renderApp({ route: '/accounts' });

    expect(
      await screen.findByText('No accounts recorded yet.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Record the first account' }),
    ).toBeInTheDocument();
  });
});

describe('recording an account', () => {
  const fill = async (): Promise<void> => {
    await userEvent.type(screen.getByLabelText(/^Name/), 'HDFC');
    await userEvent.type(screen.getByLabelText(/^Code/), 'bank-hdfc');
  };

  it('confirms in the words the button used', async () => {
    renderApp({ route: '/accounts/new' });
    await screen.findByRole('heading', { name: 'Record account' });

    await fill();
    await userEvent.click(
      screen.getByRole('button', { name: 'Record account' }),
    );

    expect(await screen.findByText('Account recorded')).toBeInTheDocument();
  });

  it('says plainly what choosing no currency means', async () => {
    // Left implicit, somebody fills the allow-list in defensively and then
    // finds §7 refusing the transaction they meant to record.
    renderApp({ route: '/accounts/new' });
    await screen.findByRole('heading', { name: 'Record account' });

    expect(
      screen.getByText(/Choose none and it holds anything/),
    ).toBeInTheDocument();
  });

  it('toggles a currency on and off, and says which are on', async () => {
    renderApp({ route: '/accounts/new' });
    await screen.findByRole('heading', { name: 'Record account' });

    const inr = screen.getByRole('button', { name: 'INR' });
    expect(inr).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(inr);
    expect(inr).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(inr);
    expect(inr).toHaveAttribute('aria-pressed', 'false');
  });

  it("puts the server's complaint under the field it is about", async () => {
    server.use(
      invalidRequest('/api/accounts', [
        { path: 'code', message: 'expected at least 1 character' },
      ]),
    );

    renderApp({ route: '/accounts/new' });
    await screen.findByRole('heading', { name: 'Record account' });

    await fill();
    await userEvent.click(
      screen.getByRole('button', { name: 'Record account' }),
    );

    expect(
      await screen.findByText('expected at least 1 character'),
    ).toBeInTheDocument();
  });
});

describe('the gap this closes', () => {
  it('offers every account on the transaction form, balance or not', async () => {
    renderApp({ route: '/payouts/1/transactions/new' });

    await userEvent.click(
      await screen.findByRole('combobox', { name: /From account/ }),
    );

    // Rise included: it has no balance, and it is still somewhere money goes.
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toContain('Rise');
  });
});
