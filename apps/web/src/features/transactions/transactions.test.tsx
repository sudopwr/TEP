import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { REFERENCE_TRAIL } from '../../../test/msw/reference-payout';
import {
  answering,
  deleteFails,
  invalidRequest,
  unreachable,
} from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import {
  renderFeature,
  screen,
  waitFor,
  within,
} from '../../../test/renderApp';

import { RecordTransactionForm } from './RecordTransactionForm';
import { TransactionTree } from './TransactionTree';

/**
 * The centrepiece, against the real §10 tree.
 *
 * Every figure asserted here came out of the API's own test server (see
 * `test/msw/reference-payout.ts`), so these are not "does it render a tree"
 * tests — they are "can a person follow $1,008.01 from Tradeify to the
 * rupees in the bank, and check each hop on the way" tests.
 *
 * The chain, for reference while reading the assertions:
 *
 *   Tradeify --$1,008.01--> Rise
 *     Rise --4 withdrawals--> TrustWallet   (a flat network fee each)
 *       TrustWallet --4 transfers--> CoinDCX
 *         CoinDCX --4 sales--> HDFC          (TDS, exchange fee, GST each)
 */

const tree = async () => {
  renderFeature(<TransactionTree payoutId={1} />);

  return screen.findByRole('tree', {
    name: 'Money trail for TradeifyPayout001',
  });
};

describe('TransactionTree', () => {
  it('starts at the award itself, not at the first leg', async () => {
    // Without this the tree begins at $1,008.01 *leaving* Tradeify and the
    // reader has to infer what was granted. The number they were told about
    // is the one the screen should open with.
    await tree();

    expect(screen.getByText('Awarded')).toBeInTheDocument();
    expect(screen.getAllByText('1,008.01').length).toBeGreaterThan(0);
    expect(screen.getByText('100.79')).toBeInTheDocument();
  });

  it('renders every leg of the tree — all thirteen', async () => {
    const root = await tree();

    expect(within(root).getAllByRole('treeitem')).toHaveLength(13);
  });

  it('nests four levels, and says so to a screen reader', async () => {
    const root = await tree();
    const items = within(root).getAllByRole('treeitem');

    const levels = new Set(
      items.map((item) => item.getAttribute('aria-level')),
    );

    // credit, withdrawal, transfer, sale.
    expect([...levels].sort()).toEqual(['1', '2', '3', '4']);
  });

  it('names the accounts rather than showing their row ids', async () => {
    // `4 → 5` is a database fact. `CoinDCX → HDFC` is the thing that happened.
    await tree();

    expect(screen.getAllByText('Tradeify').length).toBeGreaterThan(0);
    expect(screen.getAllByText('TrustWallet').length).toBe(8);
    expect(screen.getAllByText('CoinDCX').length).toBe(8);
    expect(screen.getAllByText('HDFC').length).toBe(4);
  });

  describe('following the money down', () => {
    it('shows the withdrawal in both currencies', async () => {
      await tree();

      // Two of the four withdrawals were for 226.81; the point is that both
      // sides of one are on screen, not that the figure is unique.
      expect(screen.getAllByText('226.81')).toHaveLength(2);
      expect(screen.getByText('222.78000000')).toBeInTheDocument();
    });

    it('keeps eight decimal places on the USDT legs', async () => {
      // Truncating to 222.78 would look tidier and destroy the evidence: the
      // difference between what was sent and what arrived is the dust.
      await tree();

      // Twice each: a transfer costs nothing, so what it sent and what it
      // delivered are the same figure, and seeing them agree is the check.
      expect(screen.getAllByText('222.44000000')).toHaveLength(2);
      expect(screen.getAllByText('222.38770000')).toHaveLength(2);
    });

    it('shows each sale arriving in rupees', async () => {
      await tree();

      for (const proceeds of [
        '4,444.28',
        '4,421.25',
        '4,278.45',
        '72,883.58',
      ]) {
        expect(screen.getByText(proceeds)).toBeInTheDocument();
      }
    });

    it('shows the rate at full precision, never rounded', async () => {
      // 98.26292937 is a rate scaled by 1e8. Shown as 98.26 the trail stops
      // reconciling, and a reader checking the arithmetic finds a gap that
      // is not really there.
      await tree();

      expect(screen.getByText(/98\.26292937/)).toBeInTheDocument();
      expect(screen.getAllByText(/INR per USDT/)).toHaveLength(4);
    });

    it('omits the rate where both sides are the same currency', async () => {
      // §7 makes that an impossible state rather than a suspicious one, so
      // there is nothing to show on the four USDT-to-USDT transfers.
      const root = await tree();
      const transfers = within(root)
        .getAllByRole('treeitem')
        .filter((item) => item.textContent?.includes('transfer') === true);

      expect(transfers).toHaveLength(4);
      for (const transfer of transfers) {
        expect(within(transfer).queryByText(/^at /)).toBeNull();
      }

      // The positive control, because an absence is only evidence if the
      // matcher can find the thing when it is there: the sales do show a rate.
      const sales = within(root)
        .getAllByRole('treeitem')
        .filter((item) => item.textContent?.includes('sale') === true);
      expect(sales).toHaveLength(4);
      for (const sale of sales) {
        expect(within(sale).getByText(/^at /)).toBeInTheDocument();
      }
    });
  });

  describe('the fees, on the leg that paid them', () => {
    it('shows each flat network fee separately, not as one total', async () => {
      // §8's complaint made visible: four withdrawals cost $16.31 where one
      // would have cost $4.03. A single "network fees $16.31" row would hide
      // exactly the decision that cost the money.
      await tree();

      expect(screen.getAllByText('less Network fee')).toHaveLength(4);
      expect(screen.getByText('4.03')).toBeInTheDocument();
      expect(screen.getByText('4.10')).toBeInTheDocument();
    });

    it('shows TDS, exchange fee and GST on each sale', async () => {
      await tree();

      expect(screen.getAllByText('less TDS')).toHaveLength(4);
      expect(screen.getAllByText('less Exchange fee')).toHaveLength(4);
      expect(screen.getAllByText('less GST')).toHaveLength(4);
      expect(screen.getByText('736.13')).toBeInTheDocument();
      expect(screen.getByText('370.29')).toBeInTheDocument();
      expect(screen.getByText('66.64')).toBeInTheDocument();
    });

    it('keeps each fee in its own currency', async () => {
      // The network fee is USD and TDS is INR. Adding them would be the
      // currency-mismatch error `Money` throws on, committed on screen.
      await tree();

      const networkFee = screen.getByText('4.03').closest('div');
      expect(networkFee?.textContent).toContain('USD');

      const tds = screen.getByText('736.13').closest('div');
      expect(tds?.textContent).toContain('INR');
    });
  });

  describe('the layout claims', () => {
    it('indents the label and never the amount', async () => {
      /*
        The structural claim `TreeView` exists to make: depth is left padding
        on the label column only. If the aside were nested too, the four sales
        would sit 60px further right than the credit and the column of figures
        would become a staircase.
      */
      const root = await tree();
      const items = within(root).getAllByRole('treeitem');

      const deepest = items.find(
        (item) => item.getAttribute('aria-level') === '4',
      );
      expect(deepest).toBeDefined();

      const [label, aside] = Array.from(deepest?.children ?? []);
      const labelPadding = window.getComputedStyle(
        label as Element,
      ).paddingLeft;
      const asidePadding = window.getComputedStyle(
        aside as Element,
      ).paddingLeft;

      // Three levels down, at 20px a level.
      expect(labelPadding).toBe('60px');
      expect(asidePadding).not.toBe(labelPadding);
    });

    it('is a flat list of items, so the asides share one column', async () => {
      // Nested <ul>s would be the obvious implementation and the wrong one.
      const root = await tree();

      expect(within(root).queryAllByRole('tree')).toHaveLength(0);
    });
  });

  describe('before and instead of the data', () => {
    it('shows a skeleton rather than an empty tree while loading', async () => {
      renderFeature(<TransactionTree payoutId={1} />);

      expect(
        screen.getByLabelText('Loading the money trail'),
      ).toBeInTheDocument();

      await screen.findByRole('tree', {
        name: 'Money trail for TradeifyPayout001',
      });
    });

    it('says the server is unreachable, and offers to try again', async () => {
      server.use(unreachable('/api/payouts/:id/trail'));

      renderFeature(<TransactionTree payoutId={1} />);

      expect(
        await screen.findByText(
          'The application could not reach the server.',
          {},
          { timeout: 5000 },
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Try again' }),
      ).toBeInTheDocument();
    });

    it('invites the first movement when a payout has none', async () => {
      server.use(
        answering('/api/payouts/:id/trail', {
          payout: REFERENCE_TRAIL.payout,
          roots: [],
        }),
      );

      renderFeature(<TransactionTree payoutId={1} />);

      await waitFor(() => {
        expect(
          screen.getByText('This payout has no movements yet.'),
        ).toBeInTheDocument();
      });
    });
  });
});

/**
 * The form, which is really two forms behind one kind selector — the same
 * discriminated union the API validates against.
 */
describe('RecordTransactionForm', () => {
  const open = async () => {
    renderFeature(
      <RecordTransactionForm
        payoutId={1}
        onRecorded={() => undefined}
        onCancel={() => undefined}
      />,
    );

    // Wait for the accounts, which arrive with the balances.
    await screen.findByRole('combobox', { name: /From account/ });
  };

  const choose = async (field: RegExp, option: RegExp | string) => {
    await userEvent.click(screen.getByRole('combobox', { name: field }));
    await userEvent.click(await screen.findByRole('option', { name: option }));
  };

  it('asks for a destination amount on a movement', async () => {
    await open();

    expect(screen.getByLabelText(/^Amount received/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^TDS withheld/)).not.toBeInTheDocument();
  });

  it('does not let a sale be given a destination amount', async () => {
    /*
      Gross proceeds are the from-amount times the rate, and the server
      computes them (§13). A box here would be an invitation to disagree with
      the exchange — and whichever number won, one of them would be wrong.
    */
    await open();
    await choose(/What happened/, /Sale/);

    expect(screen.queryByLabelText(/^Amount received/)).not.toBeInTheDocument();
    expect(
      screen.getByDisplayValue('Worked out from the rate'),
    ).toBeInTheDocument();
  });

  it('asks for TDS on a sale, and calls it what the statement calls it', async () => {
    await open();
    await choose(/What happened/, /Sale/);

    expect(screen.getByLabelText(/^TDS withheld/)).toBeInTheDocument();
    expect(
      screen.getByText('From the statement. Never computed.'),
    ).toBeInTheDocument();
  });

  it('drops the rate field when both sides are the same currency', async () => {
    // §7 makes `rate_applied IS NULL when from_currency = to_currency` a
    // database constraint. Offering a box the database will reject is a form
    // that spends a round trip to say no.
    await open();
    await choose(/From account/, 'TrustWallet');
    await choose(/Currency sent/, 'USDT');
    await choose(/To account/, 'CoinDCX');
    await choose(/Currency received/, 'USDT');

    expect(
      screen.getByText('Both sides are USDT, so there is no rate to record.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Rate/)).not.toBeInTheDocument();
  });

  it('offers only the currencies the chosen account may hold', async () => {
    // F4 and §7: a currency the destination cannot hold is rejected by the
    // domain, so the form does not offer it in the first place.
    await open();
    await choose(/From account/, 'HDFC');
    await userEvent.click(
      screen.getByRole('combobox', { name: /Currency sent/ }),
    );

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['INR']);
  });

  it('confirms a recorded movement in the past tense', async () => {
    await open();

    await userEvent.type(screen.getByLabelText(/^Reference code/), 'T14');
    await choose(/From account/, 'TrustWallet');
    await choose(/Currency sent/, 'USDT');
    await choose(/To account/, 'CoinDCX');
    await choose(/Currency received/, 'USDT');
    await userEvent.type(screen.getByLabelText(/^Amount sent/), '1.5');
    await userEvent.type(screen.getByLabelText(/^Amount received/), '1.5');

    await userEvent.click(
      screen.getByRole('button', { name: 'Record transaction' }),
    );

    expect(await screen.findByText('Transaction recorded')).toBeInTheDocument();
  });

  it('sends somebody with no accounts to the screen that makes one', async () => {
    /*
      This used to say, accurately, that accounts arrived only with the legacy
      import and there was no way to make one — which left a fresh database
      stuck after its first payout. Now it is a link.
    */
    server.use(answering('/api/accounts', { accounts: [] }));

    renderFeature(
      <RecordTransactionForm
        payoutId={1}
        onRecorded={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(await screen.findByText(/no accounts yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Record one first.' }),
    ).toHaveAttribute('href', '/accounts/new');
  });
});

describe('deleting a leg', () => {
  const askToDelete = async (code: string): Promise<HTMLElement> => {
    await tree();

    await userEvent.click(
      screen.getByRole('button', { name: `Delete ${code}` }),
    );

    return screen.findByRole('dialog');
  };

  it('offers a delete on each leg, named for that leg', async () => {
    // Thirteen buttons share this screen; "Delete" thirteen times tells a
    // screen reader nothing about which row it is on.
    await tree();

    expect(
      screen.getByRole('button', { name: 'Delete Transaction003' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete Transaction002' }),
    ).toBeInTheDocument();
  });

  it('says nothing hangs off a leaf', async () => {
    const dialog = await askToDelete('Transaction003');

    expect(
      within(dialog).getByText('Delete Transaction003?'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Nothing hangs off it/),
    ).toBeInTheDocument();
  });

  it('counts the legs below a parent, from the tree already on screen', async () => {
    // Withdrawal A carries transfer A, which carries sale 003: two below it,
    // counted without a second request.
    const dialog = await askToDelete('Transaction002');

    expect(
      within(dialog).getByText(/The 2 legs below it go too/),
    ).toBeInTheDocument();
  });

  it('deletes it and says what went', async () => {
    const dialog = await askToDelete('Transaction003');

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete leg' }),
    );

    expect(
      await screen.findByText('Transaction003 deleted'),
    ).toBeInTheDocument();
  });

  it('counts the subtree in the confirmation when one goes with it', async () => {
    const dialog = await askToDelete('Transaction002');

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete leg' }),
    );

    // The server's count, not the browser's guess: the two agree here, and
    // when they would not, the server is the one that is right.
    expect(
      await screen.findByText(/Transaction002 and \d+ below it deleted/),
    ).toBeInTheDocument();
  });

  it('deletes nothing when the question is declined', async () => {
    const dialog = await askToDelete('Transaction003');

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    );

    expect(
      await screen.findByRole('tree', {
        name: 'Money trail for TradeifyPayout001',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/deleted$/)).not.toBeInTheDocument();
  });

  it('shows the reason beside the question when the server refuses', async () => {
    server.use(
      deleteFails('/api/transactions/:id', {
        code: 'transaction_not_found',
        message: 'There is no transaction numbered 3.',
      }),
    );

    const dialog = await askToDelete('Transaction003');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete leg' }),
    );

    expect(
      await within(dialog).findByText(/There is no transaction numbered 3\./),
    ).toBeInTheDocument();
    expect(screen.getByText('Delete Transaction003?')).toBeInTheDocument();
  });
});

describe('editing a leg', () => {
  const openTheEditor = async (code: string): Promise<HTMLElement> => {
    await tree();

    await userEvent.click(screen.getByRole('button', { name: `Edit ${code}` }));

    return screen.findByRole('dialog');
  };

  it('opens filled in with what the leg is', async () => {
    // Transfer A: TrustWallet → CoinDCX, USDT both sides.
    const dialog = await openTheEditor('Transaction007');

    expect(within(dialog).getByText('Edit Transaction007')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Reference code/)).toHaveValue(
      'Transaction007',
    );
    expect(within(dialog).getByLabelText(/^Amount sent/)).not.toHaveValue('');
  });

  it('says what it will not touch, and what the checks will say', async () => {
    // The fees are the honest consequence: they stay as recorded, and §7
    // flags them rather than the edit recomputing them behind the reader.
    const dialog = await openTheEditor('Transaction007');

    expect(
      within(dialog).getByText(/fees on it stay as they were recorded/),
    ).toBeInTheDocument();
  });

  it('offers no kind, parent or payout — none of them is a correction', async () => {
    const dialog = await openTheEditor('Transaction007');

    expect(within(dialog).queryByLabelText(/What happened/)).toBeNull();
    expect(within(dialog).queryByLabelText(/Follows on from/)).toBeNull();
  });

  it('hides the rate when both sides are the same currency', async () => {
    // §7: `rate_applied IS NULL when from_currency = to_currency` is a
    // database constraint, so the field goes rather than being refused later.
    const dialog = await openTheEditor('Transaction007');

    expect(within(dialog).queryByLabelText(/^Rate/)).toBeNull();
  });

  it('shows the rate on a cross-currency leg, at full precision', async () => {
    // Stored as `9826120000` — scaled by 1e8 (§6) — and edited as the decimal
    // a person reads off a statement, with the eighth place intact, since it
    // is the difference between a trail that reconciles and one a rupee out.
    const dialog = await openTheEditor('Transaction003');

    expect(within(dialog).getByLabelText(/^Rate/)).toHaveValue('98.26120000');
  });

  it('refuses a leg that sends to the account it came from', async () => {
    const dialog = await openTheEditor('Transaction007');

    await userEvent.click(
      within(dialog).getByRole('combobox', { name: /To account/ }),
    );
    const options = await screen.findAllByRole('option');
    const trustwallet = options.find(
      (option) => option.textContent === 'TrustWallet',
    ) as HTMLElement;
    await userEvent.click(trustwallet);

    expect(
      within(dialog).getByText(/moves money between two different accounts/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Save leg' }),
    ).toBeDisabled();
  });

  it('saves the change and says so in the words the button used', async () => {
    const dialog = await openTheEditor('Transaction007');

    const amount = within(dialog).getByLabelText(/^Amount sent/);
    await userEvent.clear(amount);
    await userEvent.type(amount, '222.00000000');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Save leg' }),
    );

    expect(await screen.findByText('Transaction007 saved')).toBeInTheDocument();
  });

  it("puts the server's complaint under the field it is about", async () => {
    server.use(
      invalidRequest(
        '/api/transactions/:id',
        [{ path: 'fromAmount', message: 'expected a positive amount' }],
        'put',
      ),
    );

    const dialog = await openTheEditor('Transaction007');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Save leg' }),
    );

    expect(
      await screen.findByText('expected a positive amount'),
    ).toBeInTheDocument();
  });

  it('closes without saving when cancelled', async () => {
    const dialog = await openTheEditor('Transaction007');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel' }),
    );

    expect(
      await screen.findByRole('tree', {
        name: 'Money trail for TradeifyPayout001',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/saved$/)).not.toBeInTheDocument();
  });
});
