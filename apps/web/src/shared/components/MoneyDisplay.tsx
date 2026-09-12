import Typography from '@mui/material/Typography';

/**
 * Minor units in, a formatted figure out. Knows about money, not about
 * payouts: it has never heard of a fee, a transaction or a settlement.
 *
 * ```tsx
 * // 753.1777 USDT, held as 75317770000 minor units at scale 8
 * <MoneyDisplay minor="75317770000" currency="USDT" />        // 753.17770000
 * <MoneyDisplay minor={8464293} currency="INR" />             // 84,642.93
 * <MoneyDisplay minor="-100801" currency="USD" tone="auto" /> // -1,008.01, rust
 * <MoneyDisplay minor="8464293" currency="INR" showCurrency /> // 84,642.93 INR
 * <MoneyDisplay minor="1000" currency="AED" scale={2} />      // scale required
 * <MoneyDisplay minor="8464293" currency="INR" locale="en-US" /> // 84,642.93
 * ```
 */

/**
 * The scale of a currency: how many digits of the minor unit are decimals.
 *
 * ISO 4217 for the fiat entries, the token's own decimals for the crypto
 * ones. A currency that is not here has no default, and that is deliberate —
 * guessing 2 for an unknown code turns a USDT balance into a number a hundred
 * million times too large, and it would look perfectly reasonable on screen.
 * Pass `scale` explicitly instead.
 */
const SCALES: Readonly<Record<string, number>> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AUD: 2,
  CAD: 2,
  SGD: 2,
  AED: 2,
  CHF: 2,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
  USDT: 8,
  USDC: 6,
  BTC: 8,
  ETH: 18,
};

/**
 * Indian digit grouping, because this application is used from India and its
 * amounts are rupees — `1,00,80,100.00`, not `10,080,100.00`. Overridable per
 * instance; a USD column can ask for `en-US` if a lakh reads oddly there.
 */
export const DEFAULT_LOCALE = 'en-IN';

export class InvalidMinorAmountError extends Error {
  constructor(
    readonly value: unknown,
    reason: string,
  ) {
    super(`Cannot display ${String(value)} as money: ${reason}.`);
    this.name = 'InvalidMinorAmountError';
  }
}

/** The scale for a currency, from the table or from an explicit override. */
export function scaleFor(currency: string, override?: number): number {
  if (override !== undefined) {
    if (!Number.isInteger(override) || override < 0 || override > 30) {
      throw new InvalidMinorAmountError(
        override,
        'a scale must be a whole number between 0 and 30',
      );
    }
    return override;
  }

  const known = SCALES[currency.toUpperCase()];

  if (known === undefined) {
    throw new InvalidMinorAmountError(
      currency,
      `no known scale for '${currency}' — pass scale explicitly rather than letting it default, ` +
        'since the wrong scale is a factor-of-ten error that looks plausible',
    );
  }

  return known;
}

/** `-?\d+` — an integer, with no decimal point and no exponent. */
const INTEGER = /^-?\d+$/;

/**
 * Minor units to a decimal string, exactly.
 *
 * Every step is string or BigInt arithmetic. Nothing here divides by
 * `10 ** scale`: 75317770000 / 1e8 happens to be exact in float64 and a
 * number a few orders of magnitude larger is not, and the wrong digit would
 * appear without any error at all (N1).
 *
 * The grouping is `Intl`'s, but note what is handed to it: a *string*.
 * `Intl.NumberFormat#format` accepts an exact decimal string and formats it
 * digit for digit, so a value far beyond `Number.MAX_SAFE_INTEGER` still
 * renders correctly.
 */
export function formatMinor(
  minor: string | bigint | number,
  scale: number,
  locale: string = DEFAULT_LOCALE,
): string {
  const digits = toIntegerString(minor);

  const negative = digits.startsWith('-');
  const magnitude = negative ? digits.slice(1) : digits;

  // Pad so there is at least one digit to the left of the point: 5 paise is
  // `0.05`, not `.05`.
  const padded = magnitude.padStart(scale + 1, '0');
  const whole = padded.slice(0, padded.length - scale);
  const fraction = scale === 0 ? '' : padded.slice(padded.length - scale);

  const exact = `${negative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
    useGrouping: true,
    // `format` accepts an exact decimal string at runtime (Intl.NumberFormat
    // V3), but its type is the template-literal `StringNumericLiteral`, which
    // no runtime-built string can satisfy statically. The cast asserts what
    // the spec guarantees; the alternative is `Number(exact)`, which is the
    // float this whole function exists to avoid.
  }).format(exact as Intl.StringNumericLiteral);
}

function toIntegerString(minor: string | bigint | number): string {
  if (typeof minor === 'bigint') {
    return minor.toString();
  }

  if (typeof minor === 'number') {
    if (!Number.isInteger(minor)) {
      throw new InvalidMinorAmountError(minor, 'minor units are whole numbers');
    }
    if (!Number.isSafeInteger(minor)) {
      // Past 2^53 a JS number has already lost digits before this component
      // was called. Pass a string or a bigint.
      throw new InvalidMinorAmountError(
        minor,
        'outside the safe integer range — pass a string or a bigint',
      );
    }
    return minor.toString();
  }

  const trimmed = minor.trim();

  if (!INTEGER.test(trimmed)) {
    throw new InvalidMinorAmountError(
      minor,
      'expected an integer number of minor units, with no decimal point',
    );
  }

  return trimmed;
}

/** `plain` never colours. `auto` colours by sign. The rest are explicit. */
export type MoneyTone = 'plain' | 'auto' | 'positive' | 'negative';

export interface MoneyDisplayProps {
  /** Integer minor units. A string or bigint for anything large. */
  readonly minor: string | bigint | number;
  /** `INR`, `USDT`, ... Used to look up the scale unless `scale` is given. */
  readonly currency: string;
  /** Overrides the scale table. Required for a currency it does not know. */
  readonly scale?: number;
  readonly locale?: string;
  /**
   * Colour is off by default. A fee of ₹22.09 is a positive number that means
   * money left, so `auto` would colour it the wrong way — the caller knows
   * which it is and says so.
   */
  readonly tone?: MoneyTone;
  /** Append the currency code, muted. Off inside a single-currency column. */
  readonly showCurrency?: boolean;
  readonly bold?: boolean;
  /** Right by default: a column of figures aligns on its last digit. */
  readonly align?: 'left' | 'right';
  readonly title?: string;
}

function colorFor(tone: MoneyTone, negative: boolean): string {
  if (tone === 'positive') return 'positive.main';
  if (tone === 'negative') return 'negative.main';
  if (tone === 'auto') return negative ? 'negative.main' : 'text.primary';
  return 'text.primary';
}

/**
 * One amount, in tabular figures.
 *
 * The sign is never stripped and parentheses are never used. `(1,008.01)` is
 * the accounting convention and it cannot be pasted into a calculator or
 * compared against a statement by eye without translating it first.
 *
 * Invalid input throws rather than rendering a placeholder. A dash where a
 * number should be is survivable; a *plausible* wrong number in an audit tool
 * is not, and the two failures are one typo apart. `ErrorBoundary` is the
 * component that exists to contain this.
 */
export function MoneyDisplay({
  minor,
  currency,
  scale,
  locale = DEFAULT_LOCALE,
  tone = 'plain',
  showCurrency = false,
  bold = false,
  align = 'right',
  title,
}: MoneyDisplayProps) {
  const formatted = formatMinor(minor, scaleFor(currency, scale), locale);
  const negative = formatted.trimStart().startsWith('-');

  return (
    <Typography
      variant="numeric"
      component="span"
      title={title ?? `${formatted} ${currency}`}
      sx={{
        color: colorFor(tone, negative),
        fontWeight: bold ? 600 : 400,
        whiteSpace: 'nowrap',
        display: 'inline-block',
        textAlign: align,
      }}
    >
      {formatted}
      {showCurrency ? (
        <Typography
          component="span"
          variant="numeric"
          sx={{ color: 'muted.main', ml: 0.75, fontWeight: 400 }}
        >
          {currency}
        </Typography>
      ) : null}
    </Typography>
  );
}
