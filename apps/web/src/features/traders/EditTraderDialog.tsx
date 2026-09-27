import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { useState, type FormEvent } from 'react';

import { useEditTrader, type TraderJson } from '../../shared/api';
import { describeError, fieldErrors } from '../../shared/api/errors';
import { ErrorState } from '../../shared/components';

/**
 * F27 — correct a trader, in place on the register it is read from.
 *
 * The same three fields `NewTraderDialog` asks for, and the same absence: no
 * password, because there is still nothing to give one to (§5a). A dialog
 * rather than a screen, like an account's edit, because this is nearly always
 * a correction spotted while reading the list — most often the first one
 * anybody makes, turning the migration's `default` / `Me` into their own
 * name.
 *
 * It sends the whole trader. What it leaves out is cleared, which is how the
 * notes the migration wrote into the default row are got rid of.
 */

export interface EditTraderDialogProps {
  /** The trader to edit. `null` closes the dialog. */
  readonly trader: TraderJson | null;
  readonly onClose: () => void;
  readonly onSaved: (trader: TraderJson) => void;
}

export function EditTraderDialog({
  trader,
  onClose,
  onSaved,
}: EditTraderDialogProps) {
  return (
    <Dialog
      open={trader !== null}
      onClose={onClose}
      aria-labelledby="edit-trader-title"
      maxWidth="xs"
      fullWidth
    >
      {/*
        Keyed by the trader and mounted only while one is open, so the fields
        start from the row that was clicked every time — no effect copying
        props into state, and nothing left over from the last one.
      */}
      {trader === null ? null : (
        <EditTraderForm
          key={trader.id}
          trader={trader}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  );
}

function EditTraderForm({
  trader,
  onClose,
  onSaved,
}: {
  readonly trader: TraderJson;
  readonly onClose: () => void;
  readonly onSaved: (trader: TraderJson) => void;
}) {
  const edit = useEditTrader();

  const [name, setName] = useState(trader.name);
  const [code, setCode] = useState(trader.code);
  const [notes, setNotes] = useState(trader.notes ?? '');

  const errors = fieldErrors(edit.error);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (edit.isPending) return;

    edit.mutate(
      {
        traderId: trader.id,
        code: code.trim(),
        name: name.trim(),
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
      },
      {
        onSuccess: (result) => {
          onSaved(result.trader);
        },
      },
    );
  };

  const failure =
    edit.error === null || Object.keys(errors).length > 0
      ? null
      : describeError(edit.error);

  return (
    <Box component="form" onSubmit={submit} noValidate>
      <DialogTitle id="edit-trader-title">Edit {trader.name}</DialogTitle>

      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Their payouts stay with them: an edit changes the name on the money,
          never which money is theirs.
        </DialogContentText>

        <TextField
          label="Trader name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          fullWidth
          size="small"
          required
          autoFocus
          disabled={edit.isPending}
          error={errors['name'] !== undefined}
          helperText={errors['name']}
        />

        <TextField
          label="Trader code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
          }}
          fullWidth
          size="small"
          required
          sx={{ mt: 2 }}
          disabled={edit.isPending}
          error={errors['code'] !== undefined}
          helperText={errors['code'] ?? 'A short handle, unique to them.'}
        />

        <TextField
          label="Notes"
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
          }}
          fullWidth
          size="small"
          multiline
          minRows={2}
          sx={{ mt: 2 }}
          disabled={edit.isPending}
          error={errors['notes'] !== undefined}
          helperText={errors['notes']}
        />

        {failure === null ? null : (
          <Box sx={{ mt: 2 }}>
            <ErrorState
              message={failure.message}
              {...(failure.action === undefined
                ? {}
                : { detail: failure.action })}
            />
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={edit.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={edit.isPending}>
          {edit.isPending ? 'Saving…' : 'Save trader'}
        </Button>
      </DialogActions>
    </Box>
  );
}
