import { describe, expect, it } from 'vitest';

import {
  REFERENCE_BALANCES,
  passwordChangeRequired,
  unauthenticated,
  unreachable,
} from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { computedColor, render, screen, within } from '../../../test/render';
import { INK, MONO_STACK, NEGATIVE } from '../../shared/theme';

import { AccountBalances } from './AccountBalances';

const BALANCES = '/api/accounts/balances';

/**
 * The proof that the stack is wired: React renders, MUI's theme applies, the
 * component's real `fetch` goes out, MSW answers it, and jsdom shows the
 * result.
 *
 * Nothing inside the component is stubbed. `request` is the real client and
 * `fetch` is the real fetch — MSW intercepts below both — so a regression in
 * the client's error handling fails here too.
 */
describe('AccountBalances', () => {
  it('renders the §10 balances the server returned', async () => {
    render(<AccountBalances />);

    expect(await screen.findByText('84,642.93')).toBeInTheDocument();
  });

  it('shows a loading state before the answer arrives', () => {
    render(<AccountBalances />);

    expect(screen.getByLabelText('Loading balances')).toBeInTheDocument();
  });

  it('renders one row per account, and no more', async () => {
    render(<AccountBalances />);
    const table = await screen.findByRole('table', {
      name: 'Account balances',
    });

    const rows = within(table).getAllByRole('row');

    // Four balances plus the header row.
    expect(rows).toHaveLength(REFERENCE_BALANCES.balances.length + 1);
  });

  it('keeps eight decimal places on crypto dust', async () => {
    // The figure §10 pins. Truncating it to 14.09 would look tidier and be
    // wrong: the dust is the evidence that a transfer left a residue.
    render(<AccountBalances />);

    expect(await screen.findByText('14.09080000')).toBeInTheDocument();
    expect(screen.getByText('1.33230000')).toBeInTheDocument();
  });

  it('formats from the integer minor units, not the server string', async () => {
    // The server sends both `minor` and `amount`. The browser renders from
    // `minor`, so grouping and locale are a presentation decision made here
    // — but the *value* is still the server's integer, digit for digit.
    render(<AccountBalances />);
    await screen.findByText('84,642.93');

    for (const entry of REFERENCE_BALANCES.balances) {
      const grouped = entry.balance.amount.replace(
        /^(-?)(\d+)/,
        (_all, sign: string, whole: string) =>
          sign + Number(whole).toLocaleString('en-IN'),
      );
      expect(screen.getByText(grouped)).toBeInTheDocument();
    }
  });

  describe('the numeric column', () => {
    it('renders every amount in the tabular mono stack', async () => {
      // This is what makes a column of figures a column. A proportional font
      // here looks almost right and misaligns by a fraction of a digit a row.
      render(<AccountBalances />);
      const bank = await screen.findByText('84,642.93');

      const style = window.getComputedStyle(bank);
      expect(style.fontFamily).toBe(MONO_STACK);
      expect(style.fontVariantNumeric).toContain('tabular-nums');
    });

    it('slashes the zero, so 0 and O are not a judgement call', async () => {
      render(<AccountBalances />);
      const dust = await screen.findByText('14.09080000');

      expect(window.getComputedStyle(dust).fontVariantNumeric).toContain(
        'slashed-zero',
      );
    });

    it('right-aligns the balance cell', async () => {
      render(<AccountBalances />);
      const dust = await screen.findByText('14.09080000');

      const cell = dust.closest('td');
      expect(cell).not.toBeNull();
      expect(window.getComputedStyle(cell as Element).textAlign).toBe('right');
    });
  });

  describe('a negative balance', () => {
    it('keeps the minus sign rather than using parentheses', async () => {
      // `(1008.01)` cannot be pasted into a calculator or compared against a
      // statement by eye without translating it first.
      render(<AccountBalances />);

      expect(await screen.findByText('-1,008.01')).toBeInTheDocument();
    });

    it('colours it with the negative token, not a hard-coded red', async () => {
      render(<AccountBalances />);
      const owed = await screen.findByText('-1,008.01');

      // Compared against the token itself, not a colour written out again:
      // restating the hex here would just be a second place to change it.
      expect(computedColor(owed)).toBe(NEGATIVE.toLowerCase());
    });

    it('leaves a positive balance in ink, so colour stays meaningful', async () => {
      render(<AccountBalances />);
      const bank = await screen.findByText('84,642.93');

      expect(computedColor(bank)).toBe(INK.toLowerCase());
    });
  });

  describe('failure', () => {
    it('shows the server sentence on a 401 rather than a blank table', async () => {
      server.use(unauthenticated(BALANCES));
      render(<AccountBalances />);

      expect(
        await screen.findByText('Sign in to continue.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('shows F15 message when the default password is still in place', async () => {
      server.use(passwordChangeRequired(BALANCES));
      render(<AccountBalances />);

      expect(
        await screen.findByText(/default password is still in place/i),
      ).toBeInTheDocument();
    });

    it('says the server is unreachable rather than showing nothing', async () => {
      server.use(unreachable(BALANCES));
      render(<AccountBalances />);

      expect(
        await screen.findByText('The server is not reachable.'),
      ).toBeInTheDocument();
    });
  });
});
