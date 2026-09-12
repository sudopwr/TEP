import Typography from '@mui/material/Typography';

/**
 * The shape money arrives in from the API.
 *
 * `minor` is the integer in minor units, as a string, because it is a bigint
 * on the server and JSON has no bigint. `amount` is the same value already
 * formatted by the domain's own `toDecimalString`.
 */
export interface MoneyJson {
  readonly currency: string;
  readonly minor: string;
  readonly amount: string;
}

export type AmountTone = 'auto' | 'plain' | 'positive' | 'negative';

export interface AmountProps {
  readonly value: MoneyJson;
  /**
   * `auto` colours by sign, which is right for a balance and wrong for a fee:
   * a fee of ₹22.09 is a positive number that represents money leaving. Pass
   * `negative` explicitly there and let the label carry the rest.
   */
  readonly tone?: AmountTone;
  /** Show the currency code after the figure. Off inside a single-currency column. */
  readonly currency?: boolean;
  readonly bold?: boolean;
  readonly title?: string;
}

/** True when the minor-unit integer is below zero. Never parsed as a float. */
function isNegative(minor: string): boolean {
  return minor.trimStart().startsWith('-');
}

function toneColor(tone: AmountTone, minor: string): string {
  if (tone === 'positive') return 'positive.main';
  if (tone === 'negative') return 'negative.main';
  if (tone === 'plain') return 'text.primary';
  return isNegative(minor) ? 'negative.main' : 'text.primary';
}

/**
 * One amount, in tabular figures, right-aligned.
 *
 * Three decisions worth keeping:
 *
 * **The sign is never stripped.** A minus is the primary signal that money
 * left; colour only reinforces it. Accounting parentheses were the other
 * option and were rejected — `(16.31)` cannot be pasted into a calculator or
 * compared against a statement by eye without translation.
 *
 * **`amount` is displayed, never recomputed.** The server already formatted it
 * from the integer with the currency's own scale. Reformatting here would mean
 * a second implementation of §6's scale rules living in the browser, and the
 * first time the two disagreed the screen would be wrong and confident. The
 * `minor` string is used only to read the sign.
 *
 * **`variant="numeric"` is not optional.** It carries `tabular-nums` and the
 * mono stack, which is what makes a column of these line up. Plain `body1`
 * here would look almost right and misalign by a fraction of a digit per row.
 */
export function Amount({
  value,
  tone = 'auto',
  currency = false,
  bold = false,
  title,
}: AmountProps) {
  return (
    <Typography
      variant="numeric"
      component="span"
      title={title ?? `${value.amount} ${value.currency}`}
      sx={{
        color: toneColor(tone, value.minor),
        fontWeight: bold ? 600 : 400,
        whiteSpace: 'nowrap',
        display: 'inline-block',
        textAlign: 'right',
      }}
    >
      {value.amount}
      {currency ? (
        <Typography
          component="span"
          variant="numeric"
          sx={{ color: 'muted.main', ml: 0.75, fontWeight: 400 }}
        >
          {value.currency}
        </Typography>
      ) : null}
    </Typography>
  );
}
