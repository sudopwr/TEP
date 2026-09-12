import { describe, expect, it } from 'vitest';

import { answering } from '../../../test/msw/handlers';
import { server } from '../../../test/msw/server';
import { computedColor } from '../../../test/render';
import { renderApp, screen, within } from '../../../test/renderApp';
import { FLAG, NEGATIVE } from '../../shared/theme';

/**
 * F11 — the flagged rows, against the checks the real §10 tree actually trips.
 *
 * Eight of them, and every one has a legitimate explanation. That is the
 * distinction the whole screen turns on, and these tests hold it: §7 puts
 * impossible states in constraints and suspicious ones in a view, and this
 * screen must not present the second as the first.
 */

/**
 * Render, and wait for real rows.
 *
 * The table appears before the data does, as three skeleton rows — which is
 * `DataTable` keeping "loading" and "empty" apart on purpose. Waiting for the
 * table alone would assert against the skeleton.
 */
const flaggedRows = async () => {
  renderApp({ route: '/data-quality' });

  const table = await screen.findByRole('table', { name: 'Flagged rows' });
  await within(table).findByText('Transaction004');

  return table;
};

describe('the data-quality screen', () => {
  it('lists every flagged row', async () => {
    const table = await flaggedRows();

    // Eight issues plus the header row.
    expect(within(table).getAllByRole('row')).toHaveLength(9);
  });

  it('shows the same row twice when two checks flag it', async () => {
    // Transaction005's exchange fee and its GST are both off schedule. One
    // row per *finding*, not per transaction — collapsing them would hide
    // the second reason behind the first.
    await flaggedRows();

    expect(screen.getAllByText('Transaction005')).toHaveLength(2);
  });

  it('explains what the check saw, not just that it fired', async () => {
    await flaggedRows();

    // Twice: two of the four withdrawals paid exactly $4.09 against a $4.00
    // schedule, which is §8's flat fee drifting rather than a defect.
    expect(
      screen.getAllByText(/schedule says 4\.00 USD, recorded 4\.09 USD/),
    ).toHaveLength(2);
    expect(
      screen.getByText(/legitimate if earlier dust was still in the account/),
    ).toBeInTheDocument();
  });

  it('uses the flag colour, never the one that means money left', async () => {
    /*
      Ochre, not rust. The negative token is for a fact — money that went. A
      flag is a question, and colouring a question like a fact teaches the
      reader to ignore both.
    */
    await flaggedRows();

    const flag = screen.getAllByText('Fee off schedule')[0];
    expect(computedColor(flag as Element)).toBe(FLAG.toLowerCase());
    expect(computedColor(flag as Element)).not.toBe(NEGATIVE.toLowerCase());
  });

  it('says these are questions rather than defects', async () => {
    renderApp({ route: '/data-quality' });

    expect(
      await screen.findByText(/worth reading, not fixing on sight/),
    ).toBeInTheDocument();
  });

  it('counts them, so the number is readable at a glance', async () => {
    await flaggedRows();

    expect(screen.getByText('Flagged rows')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('says what a clean run means rather than showing a blank screen', async () => {
    server.use(answering('/api/data-quality', { issues: [] }));

    renderApp({ route: '/data-quality' });

    expect(await screen.findByText('Nothing is flagged.')).toBeInTheDocument();
    expect(
      screen.getByText(/no leg sends more than it received/),
    ).toBeInTheDocument();
  });
});
