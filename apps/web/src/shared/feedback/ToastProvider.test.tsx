import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { render, screen } from '../../../test/render';

import { ToastProvider, useToast } from './ToastProvider';

/**
 * The confirmation that something was recorded — and nothing more than that.
 */

function Recorder({ messages }: { readonly messages: readonly string[] }) {
  const { notify } = useToast();

  return (
    <button
      type="button"
      onClick={() => {
        for (const message of messages) notify(message);
      }}
    >
      Record
    </button>
  );
}

const withToasts = (messages: readonly string[]) =>
  render(
    <ToastProvider>
      <Recorder messages={messages} />
    </ToastProvider>,
  );

describe('ToastProvider', () => {
  it('says nothing until something happens', () => {
    withToasts(['Payout recorded']);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('confirms in the past tense of the button that was pressed', async () => {
    withToasts(['Payout recorded']);

    await userEvent.click(screen.getByRole('button', { name: 'Record' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Payout recorded',
    );
  });

  it('queues a second message rather than overwriting the first', async () => {
    /*
      Recording two legs in quick succession should confirm both. A toast that
      replaced the previous one would leave the reader unsure whether the
      first write happened at all — which, in an application that records
      money, is the worst thing an interface can leave someone wondering.
    */
    withToasts(['Transaction recorded', 'Document attached']);

    await userEvent.click(screen.getByRole('button', { name: 'Record' }));

    const first = await screen.findByRole('alert');
    expect(first).toHaveTextContent('Transaction recorded');

    await userEvent.click(
      screen.getByRole('button', { name: /close/i }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Document attached',
    );
  });

  it('throws outside the provider rather than quietly doing nothing', () => {
    // A silent no-op surfaces as "recording sometimes does not seem to do
    // anything", which is a bug report nobody can act on.
    expect(() => {
      render(<Recorder messages={['x']} />);
    }).toThrow(/useToast must be used inside/);
  });
});
