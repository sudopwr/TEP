import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

/**
 * A labelled figure, and optionally how it moved.
 *
 * ```tsx
 * <StatCard label="Net credited" value={<MoneyDisplay minor="8464293" currency="INR" />} />
 *
 * <StatCard
 *   label="Total fees"
 *   value={<MoneyDisplay minor="138463" currency="INR" />}
 *   delta={{ text: '1.61% of proceeds', direction: 'down' }}
 *   hint="TDS, exchange fee and GST"
 * />
 *
 * <StatCard label="Flagged rows" value="1" delta={{ text: '+1 this week', direction: 'up' }} />
 * ```
 */

export interface StatDelta {
  /** Already-formatted text. The card does no arithmetic. */
  readonly text: string;
  /**
   * Which way it moved — not whether that is good. A rising fee total is
   * `up` and unwelcome; a rising net credited is `up` and welcome. The caller
   * says which reading applies with `tone`.
   */
  readonly direction?: 'up' | 'down' | 'flat';
  /** `auto` reads up as positive. Pass `inverse` where up is unwelcome. */
  readonly tone?: 'auto' | 'inverse' | 'plain';
}

export interface StatCardProps {
  readonly label: string;
  /** A slot, so the caller decides whether it is money, a count, or a date. */
  readonly value: ReactNode;
  readonly delta?: StatDelta;
  readonly hint?: string;
  /**
   * A handle for a test, put on the card rather than the value.
   *
   * The only selector that otherwise ties a figure to the label above it is
   * "the div two levels up from this heading", which breaks the first time
   * anybody adds a wrapper. Given one, an end-to-end test can say *net
   * credited is 84,642.93* instead of *84,642.93 appears somewhere*.
   */
  readonly testId?: string;
}

const ARROW: Readonly<Record<NonNullable<StatDelta['direction']>, string>> = {
  up: '↑',
  down: '↓',
  flat: '→',
};

function deltaColor(delta: StatDelta): string {
  const tone = delta.tone ?? 'auto';
  const direction = delta.direction ?? 'flat';

  if (tone === 'plain' || direction === 'flat') {
    return 'muted.main';
  }

  const good = tone === 'inverse' ? direction === 'down' : direction === 'up';

  return good ? 'positive.main' : 'negative.main';
}

/**
 * `value` is a slot rather than a string on purpose: the commonest thing to
 * put in one of these is a `MoneyDisplay`, and a card that took a string
 * would force the caller to format money somewhere else — which is exactly
 * how a second, subtly different money formatter gets written.
 */
export function StatCard({
  label,
  value,
  delta,
  hint,
  testId,
}: StatCardProps) {
  return (
    <Paper
      sx={{ p: 2, minWidth: 160 }}
      {...(testId === undefined ? {} : { 'data-testid': testId })}
    >
      <Typography variant="label" component="h3" sx={{ display: 'block' }}>
        {label}
      </Typography>

      <Box sx={{ mt: 0.75, fontSize: 17, fontWeight: 600 }}>{value}</Box>

      {delta === undefined ? null : (
        <Typography
          variant="numeric"
          component="p"
          sx={{ mt: 0.5, fontSize: 11, color: deltaColor(delta) }}
        >
          <Box component="span" aria-hidden sx={{ mr: 0.5 }}>
            {ARROW[delta.direction ?? 'flat']}
          </Box>
          {delta.text}
        </Typography>
      )}

      {hint === undefined ? null : (
        <Typography
          variant="body2"
          sx={{ mt: 0.5, color: 'muted.main', fontSize: 11 }}
        >
          {hint}
        </Typography>
      )}
    </Paper>
  );
}
