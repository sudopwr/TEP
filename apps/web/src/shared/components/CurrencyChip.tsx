import Chip from '@mui/material/Chip';

/**
 * A currency code as a small, quiet label.
 *
 * ```tsx
 * <CurrencyChip code="INR" />
 * <CurrencyChip code="USDT" tone="muted" />
 * <CurrencyChip code="USD" title="United States dollar" />
 * <CurrencyChip code="inr" />                 // renders INR
 * ```
 */

export interface CurrencyChipProps {
  /** Rendered upper-case whatever is passed — `inr` and `INR` look alike. */
  readonly code: string;
  /**
   * `muted` by default. A currency code is context, not news: it sits beside
   * an amount that is already carrying whatever colour the row needs, and a
   * second coloured thing would compete with it for the reader's attention.
   */
  readonly tone?: 'muted' | 'outlined';
  readonly title?: string;
}

/**
 * Deliberately not a currency *symbol*. `₹` and `$` are ambiguous across
 * several currencies each, and `USDT` has no symbol at all — a three-to-four
 * letter code is unambiguous and the same width every time, which matters in
 * a column.
 */
export function CurrencyChip({
  code,
  tone = 'muted',
  title,
}: CurrencyChipProps) {
  const label = code.toUpperCase();

  return (
    <Chip
      label={label}
      size="small"
      variant="outlined"
      title={title ?? label}
      sx={{
        fontFamily: (theme) => theme.typography.numeric.fontFamily,
        letterSpacing: '0.02em',
        color: tone === 'muted' ? 'muted.main' : 'text.primary',
        borderColor: 'divider',
        height: 20,
        '& .MuiChip-label': { px: 0.75 },
      }}
    />
  );
}
