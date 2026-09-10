import type { Currency } from './currency';
import {
  CurrencyMismatchError,
  InvalidBasisPointsError,
  InvalidDecimalStringError,
  InvalidMoneyAmountError,
  InvalidRateError,
  InvalidRoundingModeError,
} from './errors';

/**
 * How a division that does not come out exactly should resolve.
 *
 * There is no default. Every fee and every conversion in this application is
 * a division, and picking the mode silently is how a spreadsheet ends up two
 * paise adrift from a bank statement with nobody able to say which is right.
 */
export type RoundingMode =
  'half-up' | 'half-even' | 'toward-zero' | 'away-from-zero';

/** Rates are stored scaled by 1e8, matching `transactions.rate_applied`. */
export const RATE_SCALE = 8;

const RATE_DIVISOR = 10n ** BigInt(RATE_SCALE);
const BASIS_POINT_DIVISOR = 10_000n;

/** An optional sign, whole digits, and at most one run of fraction digits. */
const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

function tenToThe(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/**
 * Divide exactly, then resolve the remainder by the stated mode.
 *
 * Sign is handled by working on magnitudes, so every mode behaves
 * symmetrically about zero: 'toward-zero' truncates -0.5 to 0 exactly as it
 * truncates 0.5, and 'half-up' takes both to a full unit.
 */
function divideRounded(
  numerator: bigint,
  denominator: bigint,
  rounding: RoundingMode,
): bigint {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;

  const quotient = magnitude / denominator;
  const remainder = magnitude % denominator;

  if (remainder === 0n) {
    return negative ? -quotient : quotient;
  }

  // Compare 2r against d rather than r against d/2: d/2 is itself a division.
  const twiceRemainder = remainder * 2n;
  let rounded: bigint;

  switch (rounding) {
    case 'toward-zero':
      rounded = quotient;
      break;
    case 'away-from-zero':
      rounded = quotient + 1n;
      break;
    case 'half-up':
      rounded = twiceRemainder >= denominator ? quotient + 1n : quotient;
      break;
    case 'half-even':
      if (twiceRemainder > denominator) {
        rounded = quotient + 1n;
      } else if (twiceRemainder < denominator) {
        rounded = quotient;
      } else {
        rounded = quotient % 2n === 0n ? quotient : quotient + 1n;
      }
      break;
    default: {
      const unreachable: never = rounding;
      throw new InvalidRoundingModeError(unreachable);
    }
  }

  return negative ? -rounded : rounded;
}

/**
 * Coerce a caller-supplied integer to bigint, refusing anything that has
 * already lost precision by the time it reaches us.
 */
function toWholeNumber(
  value: bigint | number,
  fail: (reason: string) => Error,
): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (!Number.isFinite(value)) {
    throw fail('it is not a finite number');
  }
  if (!Number.isInteger(value)) {
    throw fail('it is not a whole number');
  }
  if (!Number.isSafeInteger(value)) {
    throw fail('it exceeds Number.MAX_SAFE_INTEGER — pass a bigint instead');
  }
  return BigInt(value);
}

/**
 * An exact amount of money: an integer count of minor units, plus the
 * currency that says what a minor unit is worth.
 *
 * Every value is a bigint and every operation is integer division with a
 * stated rounding mode. There is no float anywhere in this file, and no
 * decimal ever exists except as a string at the boundary. A sale of 45.2292
 * USDT at ₹97.6652 produces an intermediate of 4.4e19 — beyond float64's
 * exact range, and the exact reason `number` is not an option here.
 *
 * Instances are immutable; every operation returns a new Money.
 */
export class Money {
  readonly #minor: bigint;
  readonly #currency: Currency;

  private constructor(minor: bigint, currency: Currency) {
    this.#minor = minor;
    this.#currency = currency;
  }

  /** Build from a count of minor units: 4599 INR is ₹45.99. */
  static fromMinor(amount: bigint | number, currency: Currency): Money {
    const minor = toWholeNumber(
      amount,
      (reason) => new InvalidMoneyAmountError(amount, reason),
    );
    return new Money(minor, currency);
  }

  /**
   * Build from a decimal string. The string must fit the currency's scale
   * exactly — '1.234' is not a rupee amount, and rounding it here would hide
   * a data-entry mistake rather than surface it.
   */
  static fromDecimalString(text: string, currency: Currency): Money {
    const match = DECIMAL_PATTERN.exec(text);

    if (match === null) {
      throw new InvalidDecimalStringError(
        text,
        currency.code,
        'expected digits with an optional leading minus and a single decimal point',
      );
    }

    const sign = match[1] ?? '';
    const whole = match[2] ?? '0';
    const fraction = match[3] ?? '';

    if (fraction.length > currency.scale) {
      throw new InvalidDecimalStringError(
        text,
        currency.code,
        `${currency.code} holds ${currency.scale} decimal place(s) but ${fraction.length} were given`,
      );
    }

    const minor = BigInt(`${whole}${fraction.padEnd(currency.scale, '0')}`);
    return new Money(sign === '-' ? -minor : minor, currency);
  }

  static zero(currency: Currency): Money {
    return new Money(0n, currency);
  }

  get minor(): bigint {
    return this.#minor;
  }

  get currency(): Currency {
    return this.#currency;
  }

  /** Canonical decimal text, always padded to the currency's full scale. */
  toDecimalString(): string {
    const { scale } = this.#currency;
    const negative = this.#minor < 0n;
    const digits = (negative ? -this.#minor : this.#minor)
      .toString()
      .padStart(scale + 1, '0');

    const split = digits.length - scale;
    const whole = digits.slice(0, split);
    const body = scale === 0 ? whole : `${whole}.${digits.slice(split)}`;

    return negative ? `-${body}` : body;
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.#currency.code}`;
  }

  add(other: Money): Money {
    this.#assertSameCurrency(other, 'add');
    return new Money(this.#minor + other.#minor, this.#currency);
  }

  subtract(other: Money): Money {
    this.#assertSameCurrency(other, 'subtract');
    return new Money(this.#minor - other.#minor, this.#currency);
  }

  /**
   * Convert into `target` at `rate`, where `rate` is scaled by 1e8.
   *
   * minor_to = minor_from x rate x 10^scale_to / (10^scale_from x 1e8)
   *
   * The numerator is built in full before any division, so precision is lost
   * exactly once, at the end, in the way the caller asked for.
   */
  multiplyByRate(
    rate: bigint | number,
    target: Currency,
    rounding: RoundingMode,
  ): Money {
    const scaledRate = toWholeNumber(
      rate,
      (reason) => new InvalidRateError(rate, reason),
    );

    if (scaledRate <= 0n) {
      throw new InvalidRateError(rate, 'a rate must be greater than zero');
    }

    const numerator = this.#minor * scaledRate * tenToThe(target.scale);
    const denominator = tenToThe(this.#currency.scale) * RATE_DIVISOR;

    return new Money(divideRounded(numerator, denominator, rounding), target);
  }

  /**
   * A share of this amount in basis points, staying in the same currency.
   * 50 bps is 0.50%, 1800 bps is 18% — the two rates in `fee_schedules`.
   */
  percentage(bps: bigint | number, rounding: RoundingMode): Money {
    const basisPoints = toWholeNumber(
      bps,
      (reason) => new InvalidBasisPointsError(bps, reason),
    );

    if (basisPoints < 0n) {
      throw new InvalidBasisPointsError(bps, 'basis points cannot be negative');
    }

    return new Money(
      divideRounded(this.#minor * basisPoints, BASIS_POINT_DIVISOR, rounding),
      this.#currency,
    );
  }

  /** Same amount and same currency. Never throws — a mismatch is just false. */
  equals(other: Money): boolean {
    return (
      this.#currency.code === other.#currency.code &&
      this.#minor === other.#minor
    );
  }

  isZero(): boolean {
    return this.#minor === 0n;
  }

  isNegative(): boolean {
    return this.#minor < 0n;
  }

  isPositive(): boolean {
    return this.#minor > 0n;
  }

  /** Magnitude, for "how far off is this" without caring which way. */
  abs(): Money {
    return this.#minor < 0n ? new Money(-this.#minor, this.#currency) : this;
  }

  /** Ordering within a currency. Across currencies there is no answer. */
  compare(other: Money): -1 | 0 | 1 {
    this.#assertSameCurrency(other, 'compare');

    if (this.#minor < other.#minor) return -1;
    if (this.#minor > other.#minor) return 1;
    return 0;
  }

  #assertSameCurrency(other: Money, operation: string): void {
    if (this.#currency.code !== other.#currency.code) {
      throw new CurrencyMismatchError(
        operation,
        this.#currency.code,
        other.#currency.code,
      );
    }
  }
}
