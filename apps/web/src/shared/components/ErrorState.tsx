import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

/**
 * Something went wrong, said plainly, with a way to try again.
 *
 * ```tsx
 * <ErrorState message="The server is not reachable." />
 *
 * <ErrorState
 *   title="Could not load balances"
 *   message="The server is not reachable."
 *   onRetry={reload}
 * />
 *
 * // A detail the reader can quote in a bug report, folded out of the way.
 * <ErrorState message="That payout does not exist." detail="payout_not_found" />
 * ```
 */

export interface ErrorStateProps {
  /** What happened, as a sentence. The only required prop. */
  readonly message: string;
  /** Optional heading when the message alone does not say what failed. */
  readonly title?: string;
  /**
   * A machine-readable code or short technical note. Rendered small and
   * monospaced so it is obviously not prose and can be copied accurately.
   * Never a stack trace — those do not leave the server (see the API's
   * error handler).
   */
  readonly detail?: string;
  /** Omit and no button appears. Present and retrying is one click. */
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
  readonly busy?: boolean;
}

/**
 * Rust, not a red that shouts. The palette's `negative` is the same colour an
 * outgoing amount uses, which is the point: one red, one meaning.
 *
 * `role="alert"` so a screen reader announces it when it replaces a table
 * that was there a moment ago.
 */
export function ErrorState({
  message,
  title,
  detail,
  onRetry,
  retryLabel = 'Try again',
  busy = false,
}: ErrorStateProps) {
  return (
    <Alert
      severity="error"
      variant="outlined"
      role="alert"
      sx={{ alignItems: 'flex-start' }}
      action={
        onRetry === undefined ? undefined : (
          <Button
            color="inherit"
            size="small"
            onClick={onRetry}
            disabled={busy}
          >
            {busy ? 'Retrying…' : retryLabel}
          </Button>
        )
      }
    >
      {title === undefined ? null : <AlertTitle>{title}</AlertTitle>}

      <Box>
        <Typography variant="body2" component="p">
          {message}
        </Typography>

        {detail === undefined ? null : (
          <Typography
            variant="numeric"
            component="p"
            sx={{ color: 'muted.main', mt: 0.5, fontSize: 11 }}
          >
            {detail}
          </Typography>
        )}
      </Box>
    </Alert>
  );
}
