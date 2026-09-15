import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  accountInUse,
  answering,
  invalidRequest,
} from '../../../test/msw/handlers';
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

describe('editing an account', () => {
  const openTheEditor = async (name: string): Promise<HTMLElement> => {
    renderApp({ route: '/accounts' });
    const table = await screen.findByRole('table', { name: 'Accounts' });
    await within(table).findByText(name);

    const row = within(table).getByText(name).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }));

    return screen.findByRole('dialog');
  };

  it('opens on the row that was clicked, filled in with what it is', async () => {
    const dialog = await openTheEditor('CoinDCX');

    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue('CoinDCX');
    expect(within(dialog).getByLabelText(/^Code/)).toHaveValue('coindcx');
    // The allow-list arrives as toggles already on, not as an empty row that
    // would quietly clear it on save.
    expect(
      within(dialog).getByRole('button', { name: 'USDT' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('saves the change and says so in the words the button used', async () => {
    const dialog = await openTheEditor('CoinDCX');

    const name = within(dialog).getByLabelText(/^Name/);
    await userEvent.clear(name);
    await userEvent.type(name, 'CoinDCX (INR)');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Save account' }),
    );

    expect(await screen.findByText('CoinDCX (INR) saved')).toBeInTheDocument();
  });

  it("puts the server's complaint under the field it is about", async () => {
    server.use(
      invalidRequest(
        '/api/accounts/:id',
        [{ path: 'code', message: 'expected at least 1 character' }],
        'put',
      ),
    );

    const dialog = await openTheEditor('CoinDCX');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Save account' }),
    );

    expect(
      await screen.findByText('expected at least 1 character'),
    ).toBeInTheDocument();
  });

  it('closes without saving when cancelled', async () => {
    const dialog = await openTheEditor('CoinDCX');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    );

    expect(
      await screen.findByRole('table', { name: 'Accounts' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/saved$/)).not.toBeInTheDocument();
  });
});

describe('deleting an account', () => {
  const askToDelete = async (name: string): Promise<HTMLElement> => {
    renderApp({ route: '/accounts' });
    const table = await screen.findByRole('table', { name: 'Accounts' });
    await within(table).findByText(name);

    const row = within(table).getByText(name).closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }));

    return screen.findByRole('dialog');
  };

  it('asks first, naming the account and what goes with it', async () => {
    const dialog = await askToDelete('CoinDCX');

    expect(within(dialog).getByText('Delete CoinDCX?')).toBeInTheDocument();
    expect(
      within(dialog).getByText(/fee schedules on it go with it/),
    ).toBeInTheDocument();
  });

  it('deletes it and says which one went', async () => {
    const dialog = await askToDelete('CoinDCX');

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete account' }),
    );

    expect(await screen.findByText('CoinDCX deleted')).toBeInTheDocument();
  });

  it('shows the refusal next to the question when money has moved through it', async () => {
    // 409, not a 500 and not a silent no-op: both account columns on
    // `transactions` are ON DELETE RESTRICT, and the sentence has to carry the
    // count so the reader knows how much history they are being asked about.
    server.use(accountInUse(13));

    const dialog = await askToDelete('CoinDCX');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete account' }),
    );

    expect(
      await screen.findByText(
        /is used by 13 transactions and cannot be deleted/,
      ),
    ).toBeInTheDocument();
    // Still asking, and nothing pretended to succeed.
    expect(screen.getByText('Delete CoinDCX?')).toBeInTheDocument();
    expect(screen.queryByText(/deleted$/)).not.toBeInTheDocument();
  });

  it('deletes nothing when the question is declined', async () => {
    const dialog = await askToDelete('CoinDCX');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    );

    expect(
      await screen.findByRole('table', { name: 'Accounts' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/deleted$/)).not.toBeInTheDocument();
  });
});
