import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import { useId } from 'react';

/**
 * A text input for a decimal amount, kept as a string from end to end.
 *
 * ```tsx
 * <AmountField label="Gross" value={gross} onChange={setGross} currency="USD" />
 * <AmountField label="Rate" value={rate} onChange={setRate} suffix="INR per USDT" decimals={8} />
 * <AmountField label="Charges" value={charges} onChange={setCharges} error="expected a decimal number" />
 * <AmountField label="TDS" value={tds} onChange={setTds} currency="INR" allowEmpty />
 * ```
 *
 * **Why not `type="number"`.** A number input hands back a `value` the browser
 * has already parsed and re-rendered — it accepts `1e3`, it localises the
 * decimal separator on some platforms, and its spinner invites arrow-key
 * edits to a figure that was copied from a statement. N1 says money is never
 * a float, and the cheapest way to keep that promise is never to let anything
 * parse the digits between the keyboard and `Money.fromDecimalString`.
 *
 * So this is a text field that *filters* keystrokes to the characters a
 * decimal is made of and otherwise passes the string through untouched. It
 * does no rounding, no padding and no validation beyond shape: whether
 * `0.005` is an acceptable amount is a question for the domain, and the
 * server answers it.
 */

/** Digits, at most one point, an optional leading minus. Nothing else. */
const SHAPE = /^-?\d*(\.\d*)?$/;

export interface AmountFieldProps {
  readonly label: string;
  /** The decimal string. Never a number. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Shown as a suffix, so the reader can see what they are typing. */
  readonly currency?: string;
  /** Any other trailing hint — "INR per USDT" on a rate. */
  readonly suffix?: string;
  /** Maximum decimal places accepted. 8 for a rate (§6), 2 for rupees. */
  readonly decimals?: number;
  /** Allow a negative sign. Off by default: §7 says amounts are positive. */
  readonly allowNegative?: boolean;
  readonly helperText?: string;
  /** A message in the negative colour. Overrides `helperText`. */
  readonly error?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  readonly name?: string;
}

/** True when `candidate` is a prefix of a decimal somebody is still typing. */
export function isPartialDecimal(
  candidate: string,
  options: { decimals?: number; allowNegative?: boolean } = {},
): boolean {
  if (candidate === '') return true;
  if (!SHAPE.test(candidate)) return false;
  if (!(options.allowNegative ?? false) && candidate.startsWith('-')) {
    return false;
  }

  const fraction = candidate.split('.')[1];

  return fraction === undefined || fraction.length <= (options.decimals ?? 8);
}

export function AmountField({
  label,
  value,
  onChange,
  currency,
  suffix,
  decimals = 8,
  allowNegative = false,
  helperText,
  error,
  required = false,
  disabled = false,
  autoFocus = false,
  name,
}: AmountFieldProps) {
  const fieldId = useId();
  const trailing = suffix ?? currency;

  return (
    <TextField
      id={fieldId}
      label={label}
      value={value}
      {...(name === undefined ? {} : { name })}
      required={required}
      disabled={disabled}
      autoFocus={autoFocus}
      fullWidth
      size="small"
      error={error !== undefined}
      helperText={error ?? helperText}
      // `decimal` rather than `numeric`: a phone keypad with no point on it
      // makes an amount unenterable, and `numeric` is the one without.
      slotProps={{
        htmlInput: {
          inputMode: 'decimal',
          autoComplete: 'off',
          spellCheck: false,
          // Right-aligned and tabular, so a column of these fields lines up
          // the same way the table they end up in will.
          style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
        },
        input: {
          endAdornment:
            trailing === undefined ? undefined : (
              <InputAdornment position="end" sx={{ color: 'muted.main' }}>
                {trailing}
              </InputAdornment>
            ),
        },
      }}
      sx={{
        '& .MuiInputBase-input': {
          fontFamily: (theme) => theme.typography.numeric.fontFamily,
        },
      }}
      onChange={(event) => {
        const next = event.target.value.trim();

        // A rejected keystroke leaves the field exactly as it was, rather
        // than clearing it or silently repairing it: somebody pasting
        // "1,008.01" should see their text refused, not see it become "1".
        if (isPartialDecimal(next, { decimals, allowNegative })) {
          onChange(next);
        }
      }}
    />
  );
}
