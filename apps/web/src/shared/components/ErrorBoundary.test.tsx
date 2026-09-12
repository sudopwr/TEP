import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '../../../test/render';

import { ErrorBoundary } from './ErrorBoundary';

function Boom({ when = true }: { when?: boolean }): JSX.Element {
  if (when) {
    throw new Error('the statement id was 1.43908E+19');
  }
  return <p>all well</p>;
}

describe('ErrorBoundary', () => {
  // React logs every caught error to the console. That is useful in a browser
  // and pure noise in a suite that is *expecting* the throw, so it is
  // silenced here and only here.
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      /* expected */
    });
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders its children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Boom when={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('all well')).toBeInTheDocument();
  });

  it('catches a throw instead of blanking the page', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('all well')).not.toBeInTheDocument();
  });

  it('never puts the thrown message on screen', () => {
    // A thrown message can carry an id, a path, or a fragment of whatever
    // was being rendered — and this component appears exactly when things
    // are least predictable. The message goes to `onError`, not the page.
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.queryByText(/1\.43908E\+19/)).not.toBeInTheDocument();
  });

  it('hands the error and its component stack to onError', () => {
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]?.[1]).toHaveProperty('componentStack');
  });

  it('recovers when the retry is used', async () => {
    const user = userEvent.setup();

    function Flaky(): JSX.Element {
      const [broken, setBroken] = useState(true);
      return (
        <ErrorBoundary
          fallback={(_error, reset) => (
            <button
              type="button"
              onClick={() => {
                setBroken(false);
                reset();
              }}
            >
              Fix it
            </button>
          )}
        >
          <Boom when={broken} />
        </ErrorBoundary>
      );
    }

    render(<Flaky />);
    await user.click(screen.getByRole('button', { name: 'Fix it' }));

    expect(screen.getByText('all well')).toBeInTheDocument();
  });

  it('clears itself when the resetKey changes', () => {
    // Without this a boundary that has caught once shows its fallback
    // forever: nothing about navigating to a different payout tells React
    // to attempt the render again.
    const { rerender } = render(
      <ErrorBoundary resetKey="payout-1">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="payout-2">
        <Boom when={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('all well')).toBeInTheDocument();
  });

  it('stays caught when the resetKey has not changed', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="payout-1">
        <Boom />
      </ErrorBoundary>,
    );

    rerender(
      <ErrorBoundary resetKey="payout-1">
        <Boom when={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('uses a custom fallback when one is given', () => {
    render(
      <ErrorBoundary fallback={() => <p>my own screen</p>}>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('my own screen')).toBeInTheDocument();
  });

  it('takes a title for the default fallback', () => {
    render(
      <ErrorBoundary title="Could not draw the trail">
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Could not draw the trail')).toBeInTheDocument();
  });

  it('wraps a thrown non-Error rather than crashing on it', () => {
    function ThrowString(): JSX.Element {
      throw 'a bare string';
    }

    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <ThrowString />
      </ErrorBoundary>,
    );

    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('contains an invalid amount instead of losing the whole screen', () => {
    // MoneyDisplay throws on input that is not integer minor units. The
    // point of pairing them: one bad row shows an error, the rest of the
    // application keeps working.
    function BadRow(): JSX.Element {
      throw new Error('InvalidMinorAmountError');
    }

    render(
      <div>
        <p>the rest of the page</p>
        <ErrorBoundary>
          <BadRow />
        </ErrorBoundary>
      </div>,
    );

    expect(screen.getByText('the rest of the page')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
