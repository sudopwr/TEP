import { describe, expect, it } from 'vitest';

import { computedColor, render, screen } from '../../../test/render';
import { INK, MONO_STACK, NEGATIVE, POSITIVE } from '../theme';

import {
  InvalidMinorAmountError,
  MoneyDisplay,
  formatMinor,
  scaleFor,
} from './MoneyDisplay';

describe('MoneyDisplay', () => {
  describe('the two figures this project is built on', () => {
    it('renders 75317770000 USDT as 753.17770000', () => {
      // §6's own example. Eight decimal places, and every one of them kept:
      // the trailing zeros carry the scale, and trimming them to `753.1777`
      // would make a USDT balance look like a two-decimal one.
      render(<MoneyDisplay minor="75317770000" currency="USDT" />);

      expect(screen.getByText('753.17770000')).toBeInTheDocument();
    });

    it('renders 8464293 INR as 84,642.93', () => {
      // §10's net credited, from the integer number of paise.
      render(<MoneyDisplay minor="8464293" currency="INR" />);

      expect(screen.getByText('84,642.93')).toBeInTheDocument();
    });

    it('takes those same two as numbers and as bigints', () => {
      render(
        <>
          <MoneyDisplay minor={75317770000} currency="USDT" />
          <MoneyDisplay minor={8464293n} currency="INR" />
        </>,
      );

      expect(screen.getByText('753.17770000')).toBeInTheDocument();
      expect(screen.getByText('84,642.93')).toBeInTheDocument();
    });
  });

  describe('scale', () => {
    it('uses the currency table when no scale is given', () => {
      expect(scaleFor('INR')).toBe(2);
      expect(scaleFor('USDT')).toBe(8);
      expect(scaleFor('JPY')).toBe(0);
    });

    it('is case-insensitive about the code', () => {
      expect(scaleFor('usdt')).toBe(8);
    });

    it('lets an explicit scale win over the table', () => {
      render(<MoneyDisplay minor="100000" currency="INR" scale={4} />);

      expect(screen.getByText('10.0000')).toBeInTheDocument();
    });

    it('refuses an unknown currency rather than guessing 2', () => {
      // The failure this prevents: assuming 2 for a token with 8 decimals
      // renders a balance a million times too large, and it looks entirely
      // reasonable on screen.
      expect(() => scaleFor('XYZ')).toThrow(InvalidMinorAmountError);
      expect(() => scaleFor('XYZ')).toThrow(/no known scale/);
    });

    it('accepts an unknown currency once the scale is supplied', () => {
      render(<MoneyDisplay minor="123456" currency="XYZ" scale={3} />);

      expect(screen.getByText('123.456')).toBeInTheDocument();
    });

    it('renders a zero-decimal currency with no point at all', () => {
      render(<MoneyDisplay minor="5000" currency="JPY" />);

      expect(screen.getByText('5,000')).toBeInTheDocument();
    });
  });

  describe('formatMinor', () => {
    it('pads a value smaller than one unit', () => {
      expect(formatMinor('5', 2)).toBe('0.05');
      expect(formatMinor('1', 8)).toBe('0.00000001');
    });

    it('renders zero at the right scale', () => {
      expect(formatMinor('0', 2)).toBe('0.00');
      expect(formatMinor('0', 8)).toBe('0.00000000');
    });

    it('keeps the minus sign in front of the digits', () => {
      expect(formatMinor('-100801', 2)).toBe('-1,008.01');
      expect(formatMinor('-5', 2)).toBe('-0.05');
    });

    it('is exact far beyond Number.MAX_SAFE_INTEGER', () => {
      // 9007199254740993 is 2^53 + 1, the first integer a float64 cannot
      // hold. Dividing by 100 to format would silently return ...92.
      const beyond = '900719925474099301';

      expect(formatMinor(beyond, 2)).toBe('9,00,71,99,25,47,40,993.01');
    });

    it('never routes a value through a float', () => {
      // The same value as a string and as a bigint must agree exactly.
      const huge = '123456789012345678901234567890';

      expect(formatMinor(huge, 8)).toBe(formatMinor(BigInt(huge), 8));
    });

    describe('locale', () => {
      it('groups Indian-style by default', () => {
        // ₹1,00,80,100.00 — lakhs, because the person using this is in India
        // and these are rupees.
        expect(formatMinor('1008010000', 2)).toBe('1,00,80,100.00');
      });

      it('groups Western-style when asked', () => {
        expect(formatMinor('1008010000', 2, 'en-US')).toBe('10,080,100.00');
      });

      it('agrees with both conventions below a lakh', () => {
        // 84,642.93 is grouped identically either way, which is why §10's
        // figures do not settle the question on their own.
        expect(formatMinor('8464293', 2)).toBe('84,642.93');
        expect(formatMinor('8464293', 2, 'en-US')).toBe('84,642.93');
      });
    });

    describe('rejecting what cannot be money', () => {
      it('refuses a decimal point in minor units', () => {
        expect(() => formatMinor('84642.93', 2)).toThrow(
          InvalidMinorAmountError,
        );
      });

      it('refuses exponent notation', () => {
        // §9's third defect began as `1.43908E+19`.
        expect(() => formatMinor('1.43908E+19', 2)).toThrow(
          InvalidMinorAmountError,
        );
      });

      it('refuses a non-integer number', () => {
        expect(() => formatMinor(84642.93, 2)).toThrow(InvalidMinorAmountError);
      });

      it('refuses a number that has already lost digits', () => {
        expect(() => formatMinor(2 ** 53 + 2, 2)).toThrow(/safe integer range/);
      });

      it.each(['', '  ', 'abc', '1,008', '0x10', '+5', 'NaN', 'Infinity'])(
        'refuses %s',
        (value) => {
          expect(() => formatMinor(value, 2)).toThrow(InvalidMinorAmountError);
        },
      );

      it('trims surrounding whitespace rather than refusing it', () => {
        expect(formatMinor('  8464293  ', 2)).toBe('84,642.93');
      });
    });
  });

  describe('presentation', () => {
    it('renders in the tabular mono stack, so a column aligns', () => {
      render(<MoneyDisplay minor="8464293" currency="INR" />);
      const style = window.getComputedStyle(screen.getByText('84,642.93'));

      expect(style.fontFamily).toBe(MONO_STACK);
      expect(style.fontVariantNumeric).toContain('tabular-nums');
    });

    it('right-aligns by default and left-aligns on request', () => {
      const { rerender } = render(
        <MoneyDisplay minor="8464293" currency="INR" />,
      );
      expect(
        window.getComputedStyle(screen.getByText('84,642.93')).textAlign,
      ).toBe('right');

      rerender(<MoneyDisplay minor="8464293" currency="INR" align="left" />);
      expect(
        window.getComputedStyle(screen.getByText('84,642.93')).textAlign,
      ).toBe('left');
    });

    it('appends the currency only when asked', () => {
      const { rerender } = render(
        <MoneyDisplay minor="8464293" currency="INR" />,
      );
      expect(screen.queryByText('INR')).not.toBeInTheDocument();

      rerender(<MoneyDisplay minor="8464293" currency="INR" showCurrency />);
      expect(screen.getByText('INR')).toBeInTheDocument();
    });

    it('carries the amount and currency in a title, for hover and copy', () => {
      render(<MoneyDisplay minor="8464293" currency="INR" />);

      expect(screen.getByText('84,642.93')).toHaveAttribute(
        'title',
        '84,642.93 INR',
      );
    });
  });

  describe('sign colouring, which is opt-in', () => {
    it('leaves a negative in ink unless asked', () => {
      // Colour is off by default: a fee of ₹22.09 is a positive number that
      // means money left, so colouring by sign automatically would be wrong
      // more often than right.
      render(<MoneyDisplay minor="-100801" currency="USD" />);

      expect(computedColor(screen.getByText('-1,008.01'))).toBe(
        INK.toLowerCase(),
      );
    });

    it('colours a negative rust under tone="auto"', () => {
      render(<MoneyDisplay minor="-100801" currency="USD" tone="auto" />);

      expect(computedColor(screen.getByText('-1,008.01'))).toBe(
        NEGATIVE.toLowerCase(),
      );
    });

    it('leaves a positive in ink under tone="auto"', () => {
      render(<MoneyDisplay minor="8464293" currency="INR" tone="auto" />);

      expect(computedColor(screen.getByText('84,642.93'))).toBe(
        INK.toLowerCase(),
      );
    });

    it('takes an explicit tone regardless of sign', () => {
      render(
        <>
          <MoneyDisplay minor="2209" currency="INR" tone="negative" />
          <MoneyDisplay minor="8464293" currency="INR" tone="positive" />
        </>,
      );

      expect(computedColor(screen.getByText('22.09'))).toBe(
        NEGATIVE.toLowerCase(),
      );
      expect(computedColor(screen.getByText('84,642.93'))).toBe(
        POSITIVE.toLowerCase(),
      );
    });

    it('never uses parentheses for a negative', () => {
      render(<MoneyDisplay minor="-100801" currency="USD" tone="auto" />);

      expect(screen.queryByText('(1,008.01)')).not.toBeInTheDocument();
      expect(screen.getByText('-1,008.01')).toBeInTheDocument();
    });
  });

  it('renders with only its required props', () => {
    render(<MoneyDisplay minor="0" currency="INR" />);

    expect(screen.getByText('0.00')).toBeInTheDocument();
  });
});
