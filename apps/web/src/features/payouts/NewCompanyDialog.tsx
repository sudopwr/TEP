import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { useState, type FormEvent } from 'react';

import { useRecordCompany, type CompanyJson } from '../../shared/api';
import { describeError, fieldErrors } from '../../shared/api/errors';
import { ErrorState } from '../../shared/components';

/**
 * F1 — record a company without leaving the payout being recorded.
 *
 * The first payout from a new prop firm is exactly the moment its company row
 * does not exist yet, and sending somebody to another screen to make one
 * costs them the form they had half filled in. So the same use case is called
 * from here, and `onCreated` hands the new row back to the field that asked
 * for it.
 *
 * `useRecordCompany` invalidates the company list, and TanStack awaits that
 * invalidation before this `onSuccess` runs — so by the time the caller
 * selects the new id, the list it is selecting from already holds it.
 * Selecting any earlier would leave a select holding a value none of its
 * options carry, which MUI renders as an empty box.
 */

export interface NewCompanyDialogProps {
  readonly open: boolean;
  readonly onCreated: (company: CompanyJson) => void;
  readonly onCancel: () => void;
}

export function NewCompanyDialog({
  open,
  onCreated,
  onCancel,
}: NewCompanyDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      aria-labelledby="new-company-title"
      maxWidth="xs"
      fullWidth
    >
      {/*
        Mounted only while open, so every opening starts on a blank sheet —
        the fields, and the failure from last time, which would otherwise
        greet the reader before they had typed anything. An effect resetting
        five pieces of state by hand is the other way to get this, and it is
        the way that goes stale when a sixth field is added.
      */}
      {open ? (
        <NewCompanyForm onCreated={onCreated} onCancel={onCancel} />
      ) : null}
    </Dialog>
  );
}

function NewCompanyForm({
  onCreated,
  onCancel,
}: Omit<NewCompanyDialogProps, 'open'>) {
  const record = useRecordCompany();

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
          onCreated(result.company);
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
      <DialogTitle id="new-company-title">Add a company</DialogTitle>

      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          The prop firm or processor this payout came from. Its contract and
          statements can be attached to it afterwards.
        </DialogContentText>

        <TextField
          label="Company code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
          }}
          fullWidth
          size="small"
          required
          autoFocus
          error={errors['code'] !== undefined}
          helperText={errors['code'] ?? 'How you refer to it — Tradeify001.'}
        />

        <TextField
          label="Company name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          fullWidth
          size="small"
          required
          sx={{ mt: 2 }}
          error={errors['name'] !== undefined}
          helperText={errors['name']}
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
          {record.isPending ? 'Adding…' : 'Add company'}
        </Button>
      </DialogActions>
    </Box>
  );
}
