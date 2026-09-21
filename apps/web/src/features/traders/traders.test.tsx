import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { OTHER_TRADER } from '../../../test/msw/fixtures';
import {
  traderCanBeAdded,
  traderCodeTaken,
} from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { renderApp, screen, waitFor, within } from '../../../test/renderApp';

/**
 * F24 — the bar at the top, driven the way somebody drives it.
 *
 * Through the whole application rather than the component alone: the bar's
 * job is to change what every other screen shows, and a test that rendered it
 * on its own could only prove that a dropdown moves. These prove the list
 * below it changes with it.
 */

/** Open a select by its label and pick an item by name. */
const choose = async (
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp,
  option: string,
): Promise<void> => {
  await user.click(await screen.findByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
};

describe('the scope bar', () => {
  it('opens on everything, so nothing is hidden until somebody hides it', async () => {
    renderApp({ route: '/payouts' });

    const trader = await screen.findByRole('combobox', { name: /Trader/ });

    expect(trader).toHaveTextContent('All traders');
    expect(
      await screen.findByRole('combobox', { name: /Year/ }),
    ).toHaveTextContent('All time');
  });

  it('shows every trader’s payouts until one is chosen', async () => {
    renderApp({ route: '/payouts' });

    const table = await screen.findByRole('table', { name: 'Payouts' });

    expect(
      await within(table).findByText('TradeifyPayout001'),
    ).toBeInTheDocument();
    expect(within(table).getByText('TradeifyPayout900')).toBeInTheDocument();
  });

  it('narrows the list to the chosen trader', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/payouts' });

    const table = await screen.findByRole('table', { name: 'Payouts' });
    await within(table).findByText('TradeifyPayout001');

    await choose(user, /Trader/, 'Priya');

    await waitFor(() => {
      expect(
        within(table).queryByText('TradeifyPayout001'),
      ).not.toBeInTheDocument();
    });
    expect(within(table).getByText('TradeifyPayout900')).toBeInTheDocument();
  });

  it('narrows to a period, and needs a year before a month', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/payouts' });

    const table = await screen.findByRole('table', { name: 'Payouts' });
    await within(table).findByText('TradeifyPayout001');

    // The month select does nothing until a year is chosen — "March" of no
    // year is not a period this application can ask the server for.
    expect(
      await screen.findByRole('combobox', { name: /Month/ }),
    ).toHaveAttribute('aria-disabled', 'true');

    await choose(user, /Year/, '2025');
    await choose(user, /Month/, 'June');

    await waitFor(() => {
      expect(
        within(table).queryByText('TradeifyPayout001'),
      ).not.toBeInTheDocument();
    });
    expect(within(table).getByText('TradeifyPayout900')).toBeInTheDocument();
  });

  it('gives back everything when the selection is cleared', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/payouts' });

    const table = await screen.findByRole('table', { name: 'Payouts' });
    await within(table).findByText('TradeifyPayout001');

    await choose(user, /Trader/, 'Priya');
    await waitFor(() => {
      expect(
        within(table).queryByText('TradeifyPayout001'),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Show everything' }));

    expect(
      await within(table).findByText('TradeifyPayout001'),
    ).toBeInTheDocument();
  });

  it('stays on screen as the reader moves between screens', async () => {
    // The selection is shared (F24). A bar that appeared on the payout list
    // and not on the balances would leave a reader guessing which figures it
    // still applied to.
    renderApp({ route: '/balances' });

    expect(
      await screen.findByRole('combobox', { name: /Trader/ }),
    ).toBeInTheDocument();
  });

  it('scopes the balances to the chosen trader', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/balances' });

    await screen.findByText('84,642.93');

    await choose(user, /Trader/, 'Priya');

    // Priya has an award and no movements, so there is nothing of hers in an
    // account yet — and §10's rupees are emphatically not hers.
    await waitFor(() => {
      expect(screen.queryByText('84,642.93')).not.toBeInTheDocument();
    });
  });
});

describe('adding a trader', () => {
  const SAM = { id: 3, code: 'sam', name: 'Sam', notes: null };

  it('adds one from inside the dropdown and selects them', async () => {
    server.use(...traderCanBeAdded(SAM));
    const user = userEvent.setup();
    renderApp({ route: '/payouts' });

    await choose(user, /Trader/, 'Add a trader…');

    await user.type(
      await screen.findByRole('textbox', { name: /Trader name/ }),
      SAM.name,
    );
    await user.type(
      screen.getByRole('textbox', { name: /Trader code/ }),
      SAM.code,
    );
    await user.click(screen.getByRole('button', { name: 'Add trader' }));

    // Selected straight away: the next thing anybody does after adding
    // somebody is look at that person.
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /Trader/ })).toHaveTextContent(
        SAM.name,
      );
    });
  });

  it('says so plainly when the code is taken, and keeps the dialog open', async () => {
    server.use(traderCodeTaken(OTHER_TRADER.code));
    const user = userEvent.setup();
    renderApp({ route: '/payouts' });

    await choose(user, /Trader/, 'Add a trader…');
    await user.type(
      await screen.findByRole('textbox', { name: /Trader name/ }),
      'Priya Again',
    );
    await user.type(
      screen.getByRole('textbox', { name: /Trader code/ }),
      OTHER_TRADER.code,
    );
    await user.click(screen.getByRole('button', { name: 'Add trader' }));

    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: /Trader code/ }),
    ).toHaveValue(OTHER_TRADER.code);
  });

  it('never offers to give them a password, because a trader is not a user', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/payouts' });

    await choose(user, /Trader/, 'Add a trader…');
    await screen.findByRole('textbox', { name: /Trader name/ });

    // §5a: one account signs in. Adding a name to a dropdown must not be a
    // way to add a credential, and the copy says so out loud.
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByText(/not a sign-in/)).toBeInTheDocument();
  });
});
