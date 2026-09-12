import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

/**
 * An empty screen is an invitation to act, not an apology.
 *
 * ```tsx
 * <EmptyState message="No payouts recorded yet." />
 *
 * <EmptyState
 *   message="No payouts recorded yet."
 *   hint="A payout is the award a prop firm pays out; everything else hangs off one."
 *   action={{ label: 'Record a payout', onClick: openForm }}
 * />
 *
 * <EmptyState message="Nothing matched “kraken”." action={{ label: 'Clear the search', onClick: reset }} />
 * ```
 */

export interface EmptyStateAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}

export interface EmptyStateProps {
  /** One sentence saying what is not here. The only required prop. */
  readonly message: string;
  /** Optional second line: why it matters, or what the thing is. */
  readonly hint?: string;
  /** The way out. Omit only when there is genuinely nothing to do. */
  readonly action?: EmptyStateAction;
  /** Anything richer than a single button. */
  readonly children?: ReactNode;
}

/**
 * No illustration, no shrug, no "Oops!".
 *
 * The wording rule this component exists to enforce: say what is not there
 * and offer the next step. "No payouts yet" plus a button beats "You have no
 * data" every time, and the component makes the button the obvious thing to
 * supply rather than an afterthought.
 */
export function EmptyState({
  message,
  hint,
  action,
  children,
}: EmptyStateProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        py: 6,
        px: 3,
        textAlign: 'center',
      }}
    >
      <Typography sx={{ color: 'text.primary', fontWeight: 600 }}>
        {message}
      </Typography>

      {hint === undefined ? null : (
        <Typography variant="body2" sx={{ color: 'muted.main', maxWidth: 420 }}>
          {hint}
        </Typography>
      )}

      {action === undefined ? null : (
        <Button
          variant="outlined"
          onClick={action.onClick}
          disabled={action.disabled ?? false}
          sx={{ mt: 1 }}
        >
          {action.label}
        </Button>
      )}

      {children}
    </Box>
  );
}
