import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { computedColor, render, screen } from '../../../test/render';
import { FLAG, MONO_STACK, NEGATIVE, POSITIVE } from '../theme';

import { CurrencyChip } from './CurrencyChip';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { MoneyDisplay } from './MoneyDisplay';
import { StatCard } from './StatCard';

describe('CurrencyChip', () => {
  it('renders with only its required props', () => {
    render(<CurrencyChip code="INR" />);

    expect(screen.getByText('INR')).toBeInTheDocument();
  });

  it('upper-cases the code, so inr and INR look alike', () => {
    render(<CurrencyChip code="usdt" />);

    expect(screen.getByText('USDT')).toBeInTheDocument();
  });

  it('uses the numeric stack, so a column of codes is one width', () => {
    render(<CurrencyChip code="INR" />);

    expect(window.getComputedStyle(screen.getByText('INR')).fontFamily).toBe(
      MONO_STACK,
    );
  });

  it('shows a code rather than a symbol', () => {
    // `₹` and `$` each belong to several currencies, and USDT has no symbol
    // at all. A code is unambiguous and a fixed width.
    render(<CurrencyChip code="INR" />);

    expect(screen.queryByText('₹')).not.toBeInTheDocument();
  });

  it('carries a title for hover', () => {
    render(<CurrencyChip code="USD" title="United States dollar" />);

    expect(screen.getByTitle('United States dollar')).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders with only a message', () => {
    render(<EmptyState message="No payouts recorded yet." />);

    expect(screen.getByText('No payouts recorded yet.')).toBeInTheDocument();
  });

  it('shows no button when there is nothing to do', () => {
    render(<EmptyState message="Nothing here." />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers the action, because an empty screen is an invitation', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <EmptyState
        message="No payouts recorded yet."
        action={{ label: 'Record a payout', onClick }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Record a payout' }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('can disable the action without hiding it', () => {
    // Still visible, so the reader knows what they will be able to do — but
    // genuinely disabled, not a button that looks live and does nothing.
    const onClick = vi.fn();

    render(
      <EmptyState
        message="No payouts yet."
        action={{ label: 'Record a payout', onClick, disabled: true }}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Record a payout' }),
    ).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows a hint when one is given', () => {
    render(
      <EmptyState message="No payouts yet." hint="Everything hangs off one." />,
    );

    expect(screen.getByText('Everything hangs off one.')).toBeInTheDocument();
  });

  it('renders children for anything richer than a button', () => {
    render(
      <EmptyState message="No payouts yet.">
        <a href="/import">Import the legacy sheet</a>
      </EmptyState>,
    );

    expect(
      screen.getByRole('link', { name: 'Import the legacy sheet' }),
    ).toBeInTheDocument();
  });
});

describe('ErrorState', () => {
  it('renders with only a message', () => {
    render(<ErrorState message="The server is not reachable." />);

    expect(
      screen.getByText('The server is not reachable.'),
    ).toBeInTheDocument();
  });

  it('announces itself, since it usually replaces something', () => {
    render(<ErrorState message="The server is not reachable." />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('offers no retry unless one was supplied', () => {
    render(<ErrorState message="That payout does not exist." />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('retries when asked', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(<ErrorState message="Could not load." onRetry={onRetry} />);
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('disables the retry while one is in flight, and says so', () => {
    // Without this, an impatient second click fires a second request and the
    // two race to set the same state.
    const onRetry = vi.fn();

    render(<ErrorState message="Could not load." onRetry={onRetry} busy />);

    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('shows a machine-readable detail in the numeric face', () => {
    render(
      <ErrorState
        message="That payout does not exist."
        detail="payout_not_found"
      />,
    );

    const detail = screen.getByText('payout_not_found');
    expect(window.getComputedStyle(detail).fontFamily).toBe(MONO_STACK);
  });

  it('takes a title when the message alone does not say what failed', () => {
    render(<ErrorState title="Could not load balances" message="Timed out." />);

    expect(screen.getByText('Could not load balances')).toBeInTheDocument();
  });
});

describe('StatCard', () => {
  it('renders with only a label and a value', () => {
    render(<StatCard label="Flagged rows" value="1" />);

    expect(screen.getByText('Flagged rows')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('takes a node as its value, so money stays money', () => {
    // A card that took a string would push money formatting out to every
    // caller, which is how a second, subtly different formatter gets written.
    render(
      <StatCard
        label="Net credited"
        value={<MoneyDisplay minor="8464293" currency="INR" />}
      />,
    );

    expect(screen.getByText('84,642.93')).toBeInTheDocument();
  });

  it('shows no delta unless one is given', () => {
    render(<StatCard label="Net credited" value="₹0" />);

    expect(screen.queryByText('↑')).not.toBeInTheDocument();
  });

  it('reads up as good by default', () => {
    render(
      <StatCard
        label="Net credited"
        value="x"
        delta={{ text: '+12%', direction: 'up' }}
      />,
    );

    expect(computedColor(screen.getByText(/\+12%/))).toBe(
      POSITIVE.toLowerCase(),
    );
  });

  it('reads up as bad when the caller inverts it', () => {
    // A rising fee total is up and unwelcome. The card cannot know which
    // reading applies, so the caller says.
    render(
      <StatCard
        label="Total fees"
        value="x"
        delta={{ text: '+12%', direction: 'up', tone: 'inverse' }}
      />,
    );

    expect(computedColor(screen.getByText(/\+12%/))).toBe(
      NEGATIVE.toLowerCase(),
    );
  });

  it('leaves a flat delta muted', () => {
    render(
      <StatCard
        label="Payouts"
        value="3"
        delta={{ text: 'no change', direction: 'flat' }}
      />,
    );

    expect(computedColor(screen.getByText(/no change/))).not.toBe(
      POSITIVE.toLowerCase(),
    );
  });

  it('does no arithmetic — the delta text is rendered verbatim', () => {
    render(
      <StatCard label="Fees" value="x" delta={{ text: '1.61% of proceeds' }} />,
    );

    expect(screen.getByText(/1\.61% of proceeds/)).toBeInTheDocument();
  });

  it('shows a hint when one is given', () => {
    render(
      <StatCard
        label="Total fees"
        value="x"
        hint="TDS, exchange fee and GST"
      />,
    );

    expect(screen.getByText('TDS, exchange fee and GST')).toBeInTheDocument();
  });

  it('uses the flag colour for nothing here, so flag stays for suspicion', () => {
    // A guard on the palette's meaning: `flag` belongs to §7's "suspicious",
    // not to an ordinary metric moving.
    render(
      <StatCard
        label="Net"
        value="x"
        delta={{ text: '+1', direction: 'up' }}
      />,
    );

    expect(computedColor(screen.getByText(/\+1/))).not.toBe(FLAG.toLowerCase());
  });
});
