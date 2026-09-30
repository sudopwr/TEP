import { describe, expect, it } from 'vitest';

import { impliedCharge } from './charge';

describe('impliedCharge', () => {
  it('is the gap between what was sent and what arrived', () => {
    // §8's Rise withdrawal: a flat fee, visible only as a difference.
    expect(impliedCharge('250.00', '245.97')).toBe('4.03');
  });

  it('is the platform charge on the award itself', () => {
    // §10: $1,008.01 awarded, $907.22 credited, $100.79 charged for it.
    expect(impliedCharge('1008.01', '907.22')).toBe('100.79');
  });

  it('keeps eight decimals when a token needs them', () => {
    // USDT is scale 8 (§6), and dust lives in the last of those places.
    expect(impliedCharge('753.17770000', '753.00000000')).toBe('0.17770000');
  });

  it('works to the finer of the two scales', () => {
    // Somebody types the round side without the zeros. The subtraction is
    // still exact, because both sides are lifted before it happens.
    expect(impliedCharge('250', '245.97')).toBe('4.03');
    expect(impliedCharge('1.00000001', '1')).toBe('0.00000001');
  });

  it('never loses a digit to a float', () => {
    // 0.1 + 0.2 arithmetic, in the direction that matters here: this sum is
    // 0.07000000000000006 in IEEE 754 and 0.07 as integers.
    expect(impliedCharge('0.30', '0.23')).toBe('0.07');
    expect(impliedCharge('4501.15', '4500.05')).toBe('1.10');
  });

  it('says nothing when nothing was kept', () => {
    // A zero fee is a fact worth recording on purpose, not one to fill in for
    // somebody who has recorded a leg that cost nothing.
    expect(impliedCharge('100.00', '100.00')).toBeNull();
    expect(impliedCharge('100', '100.000')).toBeNull();
  });

  it('says nothing when more arrived than was sent', () => {
    // Dust from an earlier hop joining this one (§7), not a negative fee.
    expect(impliedCharge('100.00', '140.00')).toBeNull();
  });

  it('reads a trailing point as the whole number it already is', () => {
    // `AmountField` lets "12." stand while somebody is typing the decimals,
    // and 12 is unambiguously what is there so far.
    expect(impliedCharge('12.', '1.00')).toBe('11.00');
  });

  it('says nothing about a field somebody is still typing', () => {
    for (const half of ['', '.', 'abc', '-5.00', '1e3', ' ']) {
      expect(impliedCharge(half, '1.00')).toBeNull();
      expect(impliedCharge('100.00', half)).toBeNull();
    }
  });

  it('takes the amounts with the spaces a paste leaves behind', () => {
    expect(impliedCharge(' 250.00 ', '245.97')).toBe('4.03');
  });

  describe('through a rate', () => {
    it('finds the flat fee on a USD-out, USDT-in withdrawal', () => {
      // §10's Transaction002, exactly as the sheet has it: $226.81 leaves
      // Rise, 222.78 USDT arrives at the wallet, the rate is 1.00000000, and
      // the $4.03 between them is the flat network fee §8 complains about.
      expect(impliedCharge('226.81', '222.78', '1.00000000')).toBe('4.03');
    });

    it('takes the arrival back through a rate that is not one', () => {
      // 99 USD-worth arrived of 100 sent, at ₹80 to the dollar.
      expect(impliedCharge('100.00', '7920.00', '80')).toBe('1.00');
    });

    it('answers in the currency that was charged, at its scale', () => {
      // A token amount carries eight decimals where the dollars it came from
      // carry two, and the fee is quoted in dollars.
      expect(impliedCharge('226.81', '222.78000000', '1.00000000')).toBe(
        '4.03',
      );
    });

    it('rounds the division the way Money does, not by truncating', () => {
      // 33.335 USD-worth back through a rate of 3: half-up, so 11.112 rather
      // than 11.111, and the charge is a hundredth smaller for it.
      expect(impliedCharge('11.500', '33.336', '3')).toBe('0.388');
    });

    it('says nothing about a rate it cannot divide by', () => {
      // §7 lets a cross-currency leg be recorded before its rate is known, so
      // a half-typed or impossible rate is a normal state of the form and not
      // an occasion to subtract two amounts in different currencies.
      for (const unusable of ['', '   ', 'abc', '0', '0.00', '-1', '.']) {
        expect(impliedCharge('226.81', '222.78', unusable)).toBeNull();
      }
    });

    it('reads an absent rate as both sides being the same money', () => {
      // Which is what the caller means by leaving it out: the currencies
      // matched, so there was no rate to record in the first place (§7). A
      // blank string is the other thing entirely — a rate that belongs here
      // and has not been typed — and answers nothing.
      expect(impliedCharge('250.00', '245.97')).toBe('4.03');
      expect(impliedCharge('250.00', '245.97', null)).toBe('4.03');
      expect(impliedCharge('250.00', '245.97', '')).toBeNull();
    });

    it('says nothing when the rate accounts for all of it', () => {
      expect(impliedCharge('100.00', '8000.00', '80')).toBeNull();
      expect(impliedCharge('100.00', '8080.00', '80')).toBeNull();
    });
  });

  it('handles figures far larger than a float holds exactly', () => {
    // Nine-figure rupees at scale 2 is past 2^53 in minor units.
    expect(impliedCharge('99999999999.99', '99999999999.98')).toBe('0.01');
  });
});
