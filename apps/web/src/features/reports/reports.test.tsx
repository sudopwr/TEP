import { describe, expect, it } from 'vitest';

import { answering } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { computedColor } from '../../../test/render';
import { renderApp, renderFeature, screen, within } from '../../../test/renderApp';
import { INK, NEGATIVE } from '../../shared/theme';

import { SettlementPanel } from './SettlementPanel';

/**
 * The three reporting screens, against §10's own figures.
 *
 * Every number here is the server's. None of these components adds anything
 * up: totals are derived server-side (§13), and a second implementation in
 * the browser would be a second answer to the one question this application
 * exists to answer correctly.
 */

describe('the settlement panel', () => {
  it('shows §10 exactly: gross, fees, net', async () => {
    renderFeature(<SettlementPanel payoutId={1} />);

    expect(await screen.findByText('86,027.56')).toBeInTheDocument();
    expect(screen.getByText('1,384.63')).toBeInTheDocument();
    expect(screen.getByText('84,642.93')).toBeInTheDocument();
  });

  it('breaks the fees down into the three that took them', async () => {
    renderFeature(<SettlementPanel payoutId={1} />);
    await screen.findByText('86,027.56');

    expect(screen.getByText('868.88')).toBeInTheDocument();
    expect(screen.getByText('437.09')).toBeInTheDocument();
    expect(screen.getByText('78.66')).toBeInTheDocument();
  });

  it('reports settled, and says what makes it so', async () => {
    // Derived, never stored: a sale leg reached a bank account. The sentence
    // beside the chip is there so the status does not read as a flag
    // somebody set by hand.
    renderFeature(<SettlementPanel payoutId={1} />);

    expect(await screen.findByText('Settled')).toBeInTheDocument();
    expect(
      screen.getByText('A sale has reached a bank account.'),
    ).toBeInTheDocument();
  });

  it('reports open when no sale has landed yet', async () => {
    server.use(
      answering('/api/payouts/:id/settlement', {
        payout: { id: 2 },
        status: 'open',
        currency: 'INR',
        grossProceeds: { currency: 'INR', minor: '0', amount: '0.00' },
        feesByType: {},
        totalFees: { currency: 'INR', minor: '0', amount: '0.00' },
        netCredited: { currency: 'INR', minor: '0', amount: '0.00' },
      }),
    );

    renderFeature(<SettlementPanel payoutId={2} />);

    expect(await screen.findByText('Open')).toBeInTheDocument();
    expect(
      screen.getByText('No sale has reached a bank account yet.'),
    ).toBeInTheDocument();
  });
});

describe('account balances', () => {
  it('keeps eight decimal places on both dust figures', async () => {
    // The dust is evidence, not a rounding artefact: it is what a transfer
    // left behind, and §10 pins both figures.
    renderApp({ route: '/balances' });

    expect(await screen.findByText('14.09080000')).toBeInTheDocument();
    expect(screen.getByText('1.33230000')).toBeInTheDocument();
  });

  it('puts a rupee balance and a USDT balance in one aligned column', async () => {
    renderApp({ route: '/balances' });
    const bank = await screen.findByText('84,642.93');

    const cell = bank.closest('td');
    expect(window.getComputedStyle(cell as Element).textAlign).toBe('right');
    expect(window.getComputedStyle(bank).fontVariantNumeric).toContain(
      'tabular-nums',
    );
  });

  it('colours a negative balance, and leaves a positive one in ink', async () => {
    // Colour carries one meaning here — money that left. Spending it on
    // ordinary balances too would leave it meaning nothing.
    renderApp({ route: '/balances' });

    const owed = await screen.findByText('-1,008.01');
    expect(computedColor(owed)).toBe(NEGATIVE.toLowerCase());
    expect(computedColor(screen.getByText('84,642.93'))).toBe(
      INK.toLowerCase(),
    );
  });

  it('keeps the minus sign rather than using parentheses', async () => {
    // `(1,008.01)` cannot be pasted into a calculator or compared against a
    // statement by eye without translating it first.
    renderApp({ route: '/balances' });

    expect(await screen.findByText('-1,008.01')).toBeInTheDocument();
  });

  it('explains an empty ledger instead of showing a bare zero', async () => {
    server.use(answering('/api/accounts/balances', { balances: [] }));

    renderApp({ route: '/balances' });

    expect(
      await screen.findByText(
        'No movements recorded yet, so every account is at zero.',
      ),
    ).toBeInTheDocument();
  });
});

describe('the financial-year report', () => {
  it('totals credited, TDS and fees for the range', async () => {
    renderApp({ route: '/reports' });

    // Twice each, once in the card and once in Tradeify's row — this payout
    // is the only one in the range, so the two have to agree.
    expect(await screen.findAllByText('84,642.93')).toHaveLength(2);
    expect(screen.getAllByText('868.88')).toHaveLength(2);
    expect(screen.getAllByText('1,384.63')).toHaveLength(2);
  });

  it('breaks the same totals down by company', async () => {
    renderApp({ route: '/reports' });

    const table = await screen.findByRole('table', {
      name: 'Totals by company',
    });

    expect(await within(table).findByText('Tradeify')).toBeInTheDocument();
    expect(within(table).getByText('1')).toBeInTheDocument();
  });

  it('opens on a whole financial year, April to March', async () => {
    /*
      The year this report is filed against. A calendar-year default would
      produce a number that looks right and cannot be copied onto anything.

      Asserted by shape rather than against two literal dates, which would
      need editing every April — and a test that has to be edited on a
      schedule is a test that gets edited without being read.
    */
    renderApp({ route: '/reports' });
    await screen.findByRole('heading', { name: 'Financial year' });

    const from = (screen.getByLabelText('From') as HTMLInputElement).value;
    const to = (screen.getByLabelText('To') as HTMLInputElement).value;

    expect(from).toMatch(/^\d{4}-04-01$/);
    expect(to).toMatch(/^\d{4}-03-31$/);
    expect(Number(to.slice(0, 4))).toBe(Number(from.slice(0, 4)) + 1);
  });
});
