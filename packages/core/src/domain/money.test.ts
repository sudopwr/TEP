import { describe, expect, it } from 'vitest';

import { CurrencyRegistry, INR, USD, USDT } from './currency';
import {
  CurrencyMismatchError,
  InvalidBasisPointsError,
  InvalidDecimalStringError,
  InvalidMoneyAmountError,
  InvalidRateError,
} from './errors';
import { Money } from './money';

describe('Money', () => {
  describe('scale comes from the currency registry, not from Money', () => {
    it('reads two decimal places for INR and eight for USDT', () => {
      expect(Money.fromDecimalString('1.23', INR).minor).toBe(123n);
      expect(Money.fromDecimalString('1.23', USDT).minor).toBe(123000000n);
    });

    it('follows a scale Money has never seen before', () => {
      const gold = new CurrencyRegistry([{ code: 'XAU', scale: 5 }]).get('XAU');

      expect(Money.fromDecimalString('1.23456', gold).minor).toBe(123456n);
      expect(Money.fromMinor(123456n, gold).toDecimalString()).toBe('1.23456');
    });

    it('handles a currency with no decimal places at all', () => {
      const yen = new CurrencyRegistry([{ code: 'JPY', scale: 0 }]).get('JPY');

      expect(Money.fromDecimalString('1200', yen).minor).toBe(1200n);
      expect(Money.fromMinor(1200n, yen).toDecimalString()).toBe('1200');
    });
  });

  describe('fromMinor', () => {
    it('accepts a bigint', () => {
      expect(Money.fromMinor(4599n, INR).minor).toBe(4599n);
    });

    it('accepts a safe integer number', () => {
      expect(Money.fromMinor(4599, INR).minor).toBe(4599n);
    });

    it('accepts negative and zero amounts', () => {
      expect(Money.fromMinor(-4599n, INR).minor).toBe(-4599n);
      expect(Money.zero(INR).minor).toBe(0n);
    });

    it('throws on a non-integer minor amount', () => {
      expect(() => Money.fromMinor(45.99, INR)).toThrow(
        InvalidMoneyAmountError,
      );
    });

    it('throws on NaN and Infinity', () => {
      expect(() => Money.fromMinor(Number.NaN, INR)).toThrow(
        InvalidMoneyAmountError,
      );
      expect(() => Money.fromMinor(Number.POSITIVE_INFINITY, INR)).toThrow(
        InvalidMoneyAmountError,
      );
    });

    it('throws past MAX_SAFE_INTEGER rather than silently losing precision', () => {
      expect(() => Money.fromMinor(Number.MAX_SAFE_INTEGER + 1, INR)).toThrow(
        InvalidMoneyAmountError,
      );
      expect(() => Money.fromMinor(9007199254740993n, INR)).not.toThrow();
    });
  });

  describe('fromDecimalString', () => {
    it('reads 753.1777 USDT as 75317770000 minor units', () => {
      expect(Money.fromDecimalString('753.1777', USDT).minor).toBe(
        75317770000n,
      );
    });

    it('reads plain rupee amounts', () => {
      expect(Money.fromDecimalString('45.99', INR).minor).toBe(4599n);
      expect(Money.fromDecimalString('4417.32', INR).minor).toBe(441732n);
      expect(Money.fromDecimalString('0', INR).minor).toBe(0n);
    });

    it('pads a fraction shorter than the scale', () => {
      expect(Money.fromDecimalString('45.9', INR).minor).toBe(4590n);
      expect(Money.fromDecimalString('45', INR).minor).toBe(4500n);
    });

    it('reads negative amounts', () => {
      expect(Money.fromDecimalString('-12.34', INR).minor).toBe(-1234n);
    });

    it('normalises negative zero', () => {
      expect(Money.fromDecimalString('-0.00', INR).minor).toBe(0n);
      expect(Money.fromDecimalString('-0.00', INR).isNegative()).toBe(false);
    });

    it('throws when the string carries more precision than the currency holds', () => {
      expect(() => Money.fromDecimalString('1.234', INR)).toThrow(
        InvalidDecimalStringError,
      );
      expect(() => Money.fromDecimalString('1.123456789', USDT)).toThrow(
        InvalidDecimalStringError,
      );
    });

    it.each([
      '',
      ' ',
      'abc',
      '1.2.3',
      '.5',
      '1.',
      ' 1.00',
      '1.00 ',
      '+1.00',
      '1e3',
      '1,000.00',
      '-',
      'Infinity',
    ])('throws on the malformed input %o', (text) => {
      expect(() => Money.fromDecimalString(text, INR)).toThrow(
        InvalidDecimalStringError,
      );
    });
  });

  describe('toDecimalString', () => {
    it('always writes exactly the currency scale', () => {
      expect(Money.fromMinor(4599n, INR).toDecimalString()).toBe('45.99');
      expect(Money.fromMinor(4590n, INR).toDecimalString()).toBe('45.90');
      expect(Money.fromMinor(75317770000n, USDT).toDecimalString()).toBe(
        '753.17770000',
      );
    });

    it('pads amounts smaller than one unit', () => {
      expect(Money.fromMinor(7n, INR).toDecimalString()).toBe('0.07');
      expect(Money.fromMinor(0n, INR).toDecimalString()).toBe('0.00');
      expect(Money.fromMinor(1n, USDT).toDecimalString()).toBe('0.00000001');
    });

    it('keeps the sign on the whole amount', () => {
      expect(Money.fromMinor(-7n, INR).toDecimalString()).toBe('-0.07');
      expect(Money.fromMinor(-441732n, INR).toDecimalString()).toBe('-4417.32');
    });
  });

  describe('round-trips exactly', () => {
    const cases = [
      { minor: 0n, currency: INR },
      { minor: 1n, currency: INR },
      { minor: -1n, currency: INR },
      { minor: 4599n, currency: INR },
      { minor: 8602756n, currency: INR },
      { minor: -441732n, currency: INR },
      { minor: 100801n, currency: USD },
      { minor: 1n, currency: USDT },
      { minor: 75317770000n, currency: USDT },
      { minor: 133230000n, currency: USDT },
    ];

    it.each(cases)(
      'minor $minor $currency.code survives toDecimalString and back',
      ({ minor, currency }) => {
        const text = Money.fromMinor(minor, currency).toDecimalString();
        expect(Money.fromDecimalString(text, currency).minor).toBe(minor);
      },
    );

    it('survives a decimal string that is already canonical', () => {
      const text = '753.17770000';
      expect(Money.fromDecimalString(text, USDT).toDecimalString()).toBe(text);
    });
  });

  describe('add and subtract', () => {
    it('adds within a currency', () => {
      const sum = Money.fromMinor(4599n, INR).add(Money.fromMinor(401n, INR));
      expect(sum.minor).toBe(5000n);
    });

    it('subtracts within a currency, and may go negative', () => {
      const difference = Money.fromMinor(4599n, INR).subtract(
        Money.fromMinor(5000n, INR),
      );
      expect(difference.minor).toBe(-401n);
    });

    it('throws CurrencyMismatchError when adding different currencies', () => {
      expect(() =>
        Money.fromMinor(100n, INR).add(Money.fromMinor(100n, USD)),
      ).toThrow(CurrencyMismatchError);
    });

    it('throws CurrencyMismatchError when subtracting different currencies', () => {
      expect(() =>
        Money.fromMinor(100n, INR).subtract(Money.fromMinor(100n, USDT)),
      ).toThrow(CurrencyMismatchError);
    });

    it('names both currencies in the mismatch', () => {
      expect(() =>
        Money.fromMinor(100n, INR).add(Money.fromMinor(100n, USD)),
      ).toThrow(/INR/);
      expect(() =>
        Money.fromMinor(100n, INR).add(Money.fromMinor(100n, USD)),
      ).toThrow(/USD/);
    });

    it('leaves both operands untouched', () => {
      const left = Money.fromMinor(4599n, INR);
      const right = Money.fromMinor(401n, INR);

      left.add(right);

      expect(left.minor).toBe(4599n);
      expect(right.minor).toBe(401n);
    });
  });

  describe('multiplyByRate', () => {
    // The reference sale: 45.2292 USDT sold at ₹97.6652 per USDT.
    // 45.2292 * 97.6652 = 4417.31886384, which rounds to ₹4,417.32.
    const usdt = () => Money.fromDecimalString('45.2292', USDT);
    const rate = 9766520000n; // 97.6652 scaled by 1e8

    it('turns 45.2292 USDT at 97.6652 into 441732 INR minor', () => {
      const proceeds = usdt().multiplyByRate(rate, INR, 'half-up');

      expect(proceeds.minor).toBe(441732n);
      expect(proceeds.toDecimalString()).toBe('4417.32');
      expect(proceeds.currency.code).toBe('INR');
    });

    it('truncates instead when told to round toward zero', () => {
      expect(usdt().multiplyByRate(rate, INR, 'toward-zero').minor).toBe(
        441731n,
      );
    });

    it('accepts the rate as a safe integer number', () => {
      expect(usdt().multiplyByRate(9766520000, INR, 'half-up').minor).toBe(
        441732n,
      );
    });

    it('carries full precision through a large intermediate product', () => {
      // 1,000,000 USDT at 97.6652 is ₹97,665,200.00 exactly — far beyond
      // what a float64 could hold as an intermediate.
      const large = Money.fromDecimalString('1000000', USDT);
      expect(large.multiplyByRate(rate, INR, 'half-up').minor).toBe(
        9766520000n,
      );
    });

    it('preserves sign', () => {
      const negative = Money.fromDecimalString('-45.2292', USDT);
      expect(negative.multiplyByRate(rate, INR, 'half-up').minor).toBe(
        -441732n,
      );
      expect(negative.multiplyByRate(rate, INR, 'toward-zero').minor).toBe(
        -441731n,
      );
    });

    it('throws on a non-integer, zero, or negative rate', () => {
      expect(() => usdt().multiplyByRate(97.6652, INR, 'half-up')).toThrow(
        InvalidRateError,
      );
      expect(() => usdt().multiplyByRate(0n, INR, 'half-up')).toThrow(
        InvalidRateError,
      );
      expect(() => usdt().multiplyByRate(-1n, INR, 'half-up')).toThrow(
        InvalidRateError,
      );
    });
  });

  describe('percentage', () => {
    it('takes 50 bps of ₹4,417.32 as ₹22.09', () => {
      // 4417.32 * 0.005 = 22.0866
      const fee = Money.fromDecimalString('4417.32', INR).percentage(
        50,
        'half-up',
      );

      expect(fee.minor).toBe(2209n);
      expect(fee.toDecimalString()).toBe('22.09');
    });

    it('stays in the same currency', () => {
      const fee = Money.fromDecimalString('753.1777', USDT).percentage(
        50,
        'half-up',
      );
      // 0.5% of 753.1777 USDT is 3.7658885 USDT, exact at scale 8.
      expect(fee.currency.code).toBe('USDT');
      expect(fee.minor).toBe(376588850n);
    });

    it('takes 1800 bps of a fee as GST', () => {
      // 437.09 * 0.18 = 78.6762
      const gst = Money.fromDecimalString('437.09', INR).percentage(
        1800,
        'half-up',
      );
      expect(gst.toDecimalString()).toBe('78.68');
    });

    it('returns zero for zero basis points', () => {
      expect(
        Money.fromDecimalString('4417.32', INR).percentage(0, 'half-up').minor,
      ).toBe(0n);
    });

    it('throws on negative or non-integer basis points', () => {
      const money = Money.fromDecimalString('4417.32', INR);
      expect(() => money.percentage(-1, 'half-up')).toThrow(
        InvalidBasisPointsError,
      );
      expect(() => money.percentage(0.5, 'half-up')).toThrow(
        InvalidBasisPointsError,
      );
    });
  });

  describe('rounding modes', () => {
    // 50 bps of ₹1.00 is exactly 0.5 minor units — a true tie.
    const half = () => Money.fromMinor(100n, INR);
    // 50 bps of ₹3.00 is exactly 1.5 minor units — the other parity.
    const onePointFive = () => Money.fromMinor(300n, INR);

    it('half-up goes away from zero on a tie', () => {
      expect(half().percentage(50, 'half-up').minor).toBe(1n);
      expect(onePointFive().percentage(50, 'half-up').minor).toBe(2n);
    });

    it('half-even goes to the even neighbour on a tie', () => {
      expect(half().percentage(50, 'half-even').minor).toBe(0n);
      expect(onePointFive().percentage(50, 'half-even').minor).toBe(2n);
    });

    it('toward-zero truncates', () => {
      expect(half().percentage(50, 'toward-zero').minor).toBe(0n);
      expect(onePointFive().percentage(50, 'toward-zero').minor).toBe(1n);
    });

    it('away-from-zero takes any remainder to the next unit', () => {
      expect(half().percentage(50, 'away-from-zero').minor).toBe(1n);
      expect(onePointFive().percentage(50, 'away-from-zero').minor).toBe(2n);
    });

    it('rounds negatives symmetrically about zero', () => {
      const negative = Money.fromMinor(-100n, INR);

      expect(negative.percentage(50, 'half-up').minor).toBe(-1n);
      expect(negative.percentage(50, 'toward-zero').minor).toBe(0n);
      expect(negative.percentage(50, 'away-from-zero').minor).toBe(-1n);
      expect(negative.percentage(50, 'half-even').minor).toBe(0n);
    });

    it('leaves an exact result alone in every mode', () => {
      const exact = Money.fromMinor(20000n, INR);

      for (const mode of [
        'half-up',
        'half-even',
        'toward-zero',
        'away-from-zero',
      ] as const) {
        expect(exact.percentage(50, mode).minor).toBe(100n);
      }
    });
  });

  describe('comparison', () => {
    it('equals is true for the same amount and currency', () => {
      expect(
        Money.fromMinor(4599n, INR).equals(Money.fromMinor(4599n, INR)),
      ).toBe(true);
    });

    it('equals is false for a different amount', () => {
      expect(
        Money.fromMinor(4599n, INR).equals(Money.fromMinor(4600n, INR)),
      ).toBe(false);
    });

    it('equals is false across currencies rather than throwing', () => {
      expect(
        Money.fromMinor(100n, INR).equals(Money.fromMinor(100n, USD)),
      ).toBe(false);
    });

    it('reports zero', () => {
      expect(Money.zero(INR).isZero()).toBe(true);
      expect(Money.fromMinor(1n, INR).isZero()).toBe(false);
      expect(Money.fromMinor(-1n, INR).isZero()).toBe(false);
    });

    it('reports negative, and zero is not negative', () => {
      expect(Money.fromMinor(-1n, INR).isNegative()).toBe(true);
      expect(Money.zero(INR).isNegative()).toBe(false);
      expect(Money.fromMinor(1n, INR).isNegative()).toBe(false);
    });

    it('takes a magnitude, leaving a positive amount alone', () => {
      expect(Money.fromMinor(-441732n, INR).abs().minor).toBe(441732n);
      expect(Money.fromMinor(441732n, INR).abs().minor).toBe(441732n);
      expect(Money.zero(INR).abs().minor).toBe(0n);
      expect(Money.fromMinor(-1n, USDT).abs().currency.code).toBe('USDT');
    });

    it('reports positive, and zero is not positive', () => {
      expect(Money.fromMinor(1n, INR).isPositive()).toBe(true);
      expect(Money.zero(INR).isPositive()).toBe(false);
      expect(Money.fromMinor(-1n, INR).isPositive()).toBe(false);
    });

    it('compares as -1, 0, 1', () => {
      const smaller = Money.fromMinor(100n, INR);
      const larger = Money.fromMinor(200n, INR);

      expect(smaller.compare(larger)).toBe(-1);
      expect(larger.compare(smaller)).toBe(1);
      expect(smaller.compare(Money.fromMinor(100n, INR))).toBe(0);
    });

    it('compares negatives correctly', () => {
      expect(
        Money.fromMinor(-200n, INR).compare(Money.fromMinor(-100n, INR)),
      ).toBe(-1);
    });

    it('throws CurrencyMismatchError when comparing different currencies', () => {
      expect(() =>
        Money.fromMinor(100n, INR).compare(Money.fromMinor(100n, USD)),
      ).toThrow(CurrencyMismatchError);
    });

    it('sorts a list without a comparator of its own', () => {
      const sorted = [
        Money.fromMinor(300n, INR),
        Money.fromMinor(-100n, INR),
        Money.fromMinor(200n, INR),
      ]
        .sort((a, b) => a.compare(b))
        .map((money) => money.minor);

      expect(sorted).toEqual([-100n, 200n, 300n]);
    });
  });

  describe('the reference payout from CLAUDE.md §10', () => {
    it('nets ₹84,642.93 from ₹86,027.56 of proceeds', () => {
      const proceeds = Money.fromDecimalString('86027.56', INR);
      const tds = Money.fromDecimalString('868.88', INR);
      const exchangeFee = Money.fromDecimalString('437.09', INR);
      const gst = Money.fromDecimalString('78.66', INR);

      const net = proceeds.subtract(tds).subtract(exchangeFee).subtract(gst);

      expect(net.toDecimalString()).toBe('84642.93');
      expect(tds.add(exchangeFee).add(gst).toDecimalString()).toBe('1384.63');
    });
  });
});
