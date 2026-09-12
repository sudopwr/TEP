import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '../../../test/render';

import { AmountField, isPartialDecimal } from './AmountField';

/**
 * The field that keeps N1's promise at the one place a person can break it.
 *
 * Nothing between this input and `Money.fromDecimalString` parses a decimal,
 * so the only defence against a float is never accepting a string that is not
 * one. Everything below is that claim, from both ends: the pure predicate,
 * and the behaviour a typist actually sees.
 */

/** A controlled wrapper, since the field is deliberately not self-storing. */
function Controlled(props: { readonly decimals?: number; readonly allowNegative?: boolean }) {
  const [value, setValue] = useState('');

  return (
    <AmountField label="Amount" value={value} onChange={setValue} {...props} />
  );
}

describe('isPartialDecimal', () => {
  it('accepts a decimal, and the half-typed prefixes of one', () => {
    // A predicate that only accepted finished decimals would reject `1.`
    // mid-keystroke and make the point impossible to type at all.
    for (const candidate of ['', '1', '1.', '1.0', '1008.01', '0.00000001']) {
      expect(isPartialDecimal(candidate)).toBe(true);
    }
  });

  it('rejects anything that is not on the way to being a decimal', () => {
    for (const candidate of ['1,008.01', '1e3', '1.2.3', 'abc', '1 008']) {
      expect(isPartialDecimal(candidate)).toBe(false);
    }
  });

  it('rejects a negative unless one was asked for', () => {
    // §7: amounts are positive. A rate or a correction may not be.
    expect(isPartialDecimal('-1')).toBe(false);
    expect(isPartialDecimal('-1', { allowNegative: true })).toBe(true);
  });

  it('holds the caller to the scale it asked for', () => {
    expect(isPartialDecimal('1.23', { decimals: 2 })).toBe(true);
    expect(isPartialDecimal('1.234', { decimals: 2 })).toBe(false);
    expect(isPartialDecimal('98.26292937', { decimals: 8 })).toBe(true);
  });
});

describe('AmountField', () => {
  it('takes the digits and the point', async () => {
    render(<Controlled />);
    const field = screen.getByLabelText('Amount');

    await userEvent.type(field, '1008.01');

    expect(field).toHaveValue('1008.01');
  });

  it('drops a grouping comma without eating what follows it', async () => {
    // Somebody pasting `1,008.01` from a statement should see the comma
    // refused, not see the field silently "repair" their figure into `1`.
    render(<Controlled />);
    const field = screen.getByLabelText('Amount');

    await userEvent.type(field, '1,008.01');

    expect(field).toHaveValue('1008.01');
  });

  it('refuses a second decimal point', async () => {
    render(<Controlled />);
    const field = screen.getByLabelText('Amount');

    await userEvent.type(field, '1.0.1');

    expect(field).toHaveValue('1.01');
  });

  it('is a text field, never a number field', () => {
    /*
      `type="number"` hands back a value the browser has already parsed: it
      accepts `1e3`, localises the separator on some platforms, and invites
      arrow-key edits to a figure copied off a statement.
    */
    render(<Controlled />);

    expect(screen.getByLabelText('Amount')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Amount')).toHaveAttribute(
      'inputmode',
      'decimal',
    );
  });

  it('shows the currency beside what is being typed', () => {
    render(
      <AmountField
        label="Gross"
        value="1008.01"
        onChange={vi.fn()}
        currency="USD"
      />,
    );

    expect(screen.getByText('USD')).toBeInTheDocument();
  });

  it('replaces the hint with the problem when there is one', () => {
    render(
      <AmountField
        label="Gross"
        value="0"
        onChange={vi.fn()}
        helperText="What the firm awarded."
        error="expected an amount greater than zero"
      />,
    );

    expect(
      screen.getByText('expected an amount greater than zero'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('What the firm awarded.'),
    ).not.toBeInTheDocument();
  });
});
