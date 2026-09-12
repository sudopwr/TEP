import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import type { ReactNode } from 'react';

/**
 * Ask before doing something that cannot be undone.
 *
 * ```tsx
 * <ConfirmDialog
 *   open={asking}
 *   title="Remove this document?"
 *   message="The file stays on disk; only the link to this transaction goes."
 *   onConfirm={remove}
 *   onCancel={() => { setAsking(false); }}
 * />
 *
 * <ConfirmDialog
 *   open={asking}
 *   title="Sign out everywhere?"
 *   message="Every other session is revoked immediately."
 *   confirmLabel="Sign out everywhere"
 *   destructive
 *   busy={working}
 *   onConfirm={revokeAll}
 *   onCancel={close}
 * />
 * ```
 */

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  /** A sentence saying what will happen. Prose, or any node. */
  readonly message?: ReactNode;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /**
   * Name the verb, do not say "OK".
   *
   * "Remove document" is a label somebody can read and understand from the
   * button alone; "OK" means the reader has to have read and retained the
   * title, which after the fourth dialog of the day they have not.
   */
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** Colours the confirm button with the negative token. */
  readonly destructive?: boolean;
  /** Disables both buttons and says so, while the action is in flight. */
  readonly busy?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      // Escape and the backdrop both cancel, which is the safe direction:
      // the accidental outcome of dismissing a confirmation should be that
      // nothing happened.
      onClose={busy ? undefined : onCancel}
      aria-labelledby="confirm-dialog-title"
      {...(message === undefined
        ? {}
        : { 'aria-describedby': 'confirm-dialog-message' })}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id="confirm-dialog-title" sx={{ fontSize: 17 }}>
        {title}
      </DialogTitle>

      {message === undefined ? null : (
        <DialogContent>
          <DialogContentText id="confirm-dialog-message" sx={{ fontSize: 13 }}>
            {message}
          </DialogContentText>
        </DialogContent>
      )}

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} disabled={busy} color="inherit">
          {cancelLabel}
        </Button>
        <Button
          onClick={onConfirm}
          disabled={busy}
          variant="contained"
          // Cancel is the default-focused, low-effort choice; confirming is
          // the deliberate one. Autofocusing the destructive button is how a
          // stray Enter deletes something.
          color={destructive ? 'error' : 'primary'}
        >
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
