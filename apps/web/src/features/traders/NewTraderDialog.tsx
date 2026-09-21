import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { useState, type FormEvent } from 'react';

import { useRecordTrader, type TraderJson } from '../../shared/api';
import { describeError, fieldErrors } from '../../shared/api/errors';
import { ErrorState } from '../../shared/components';

/**
 * F24 — add a person whose payouts this ledger will keep.
 *
 * The copy says plainly what adding one does *not* do. A dialog that asks for
 * a name and a code, in an application whose other account concept is a
 * sign-in, invites the reading that this is a second login; it is not, and
 * nothing here asks for a password because there is nowhere to put one (§5a).
 *
 * Like `NewCompanyDialog`, the mutation invalidates the trader list and
 * TanStack awaits that invalidation before `onCreated` runs — so a caller
 * selecting the new id finds it already in the dropdown rather than in an
 * empty box.
 */

export interface NewTraderDialogProps {
  readonly open: boolean;
  readonly onCreated: (trader: TraderJson) => void;
  readonly onCancel: () => void;
}

export function NewTraderDialog({
  open,
  onCreated,
  onCancel,
}: NewTraderDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      aria-labelledby="new-trader-title"
      maxWidth="xs"
      fullWidth
    >
      {/* Mounted only while open, so each opening starts on a blank sheet. */}
      {open ? (
        <NewTraderForm onCreated={onCreated} onCancel={onCancel} />
      ) : null}
    </Dialog>
  );
}

function NewTraderForm({
  onCreated,
  onCancel,
}: Omit<NewTraderDialogProps, 'open'>) {
  const record = useRecordTrader();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');

  const errors = fieldErrors(record.error);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (record.isPending) return;

    record.mutate(
      {
        code: code.trim(),
        name: name.trim(),
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
      },
      {
        onSuccess: (result) => {
          onCreated(result.trader);
        },
      },
    );
  };

  const failure =
    record.error === null || Object.keys(errors).length > 0
      ? null
      : describeError(record.error);

  return (
    <Box component="form" onSubmit={submit} noValidate>
      <DialogTitle id="new-trader-title">Add a trader</DialogTitle>

      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Somebody whose payouts you track here. This is not a sign-in: they
          have no password and cannot open the application.
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
          error={errors['name'] !== undefined}
          helperText={errors['name'] ?? 'How they appear in the dropdown.'}
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
        <Button color="inherit" onClick={onCancel} disabled={record.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={record.isPending}>
          {record.isPending ? 'Adding…' : 'Add trader'}
        </Button>
      </DialogActions>
    </Box>
  );
}
