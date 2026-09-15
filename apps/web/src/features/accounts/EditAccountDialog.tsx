import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useState, type FormEvent } from 'react';

import {
  useCompanies,
  useEditAccount,
  type AccountJson,
} from '../../shared/api';
import { describeError, fieldErrors } from '../../shared/api/errors';
import { ErrorState } from '../../shared/components';

import {
  AccountFields,
  toAccountCommand,
  type AccountValues,
} from './AccountFields';

/**
 * F1 — correct an account, in place on the list it is read from.
 *
 * A dialog rather than a screen of its own, because an edit here is nearly
 * always a correction spotted while reading the table — a renamed bank, a
 * currency the exchange turned out to hold — and a round trip through another
 * address would lose the row the reader had their eye on.
 *
 * It sends the whole account, not the fields that changed. The server's PUT
 * says the same thing, and the reason is the allow-list: its empty value
 * means "holds anything", so under a patch there would be no way to express
 * the one edit people most often want to make.
 */

export interface EditAccountDialogProps {
  /** The account to edit. `null` closes the dialog. */
  readonly account: AccountJson | null;
  readonly onClose: () => void;
  readonly onSaved: (account: AccountJson) => void;
}

export function EditAccountDialog({
  account,
  onClose,
  onSaved,
}: EditAccountDialogProps) {
  return (
    <Dialog
      open={account !== null}
      onClose={onClose}
      aria-labelledby="edit-account-title"
      maxWidth="sm"
      fullWidth
    >
      {/*
        Keyed by the account, and mounted only while one is being edited: the
        fields start from the row that was clicked, every time, without an
        effect copying five values across on open. Opening the next account
        after cancelling this one is a fresh form, not the last one's leftovers.
      */}
      {account === null ? null : (
        <EditAccountForm
          key={account.id}
          account={account}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  );
}

function EditAccountForm({
  account,
  onClose,
  onSaved,
}: {
  readonly account: AccountJson;
  readonly onClose: () => void;
  readonly onSaved: (account: AccountJson) => void;
}) {
  const companies = useCompanies();
  const edit = useEditAccount();

  const [values, setValues] = useState<AccountValues>({
    code: account.code,
    name: account.name,
    type: account.type,
    companyId: account.companyId === null ? '' : String(account.companyId),
    allowed: account.allowedCurrencies,
  });

  const errors = fieldErrors(edit.error);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (edit.isPending) return;

    edit.mutate(
      { accountId: account.id, ...toAccountCommand(values) },
      {
        onSuccess: (result) => {
          onSaved(result.account);
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
      <DialogTitle id="edit-account-title">Edit {account.name}</DialogTitle>

      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          What the account is now. Narrowing what it can hold does not change
          anything already recorded — it only means the data-quality checks will
          flag a leg that contradicts it.
        </DialogContentText>

        <AccountFields
          values={values}
          onChange={setValues}
          errors={errors}
          companies={companies.data ?? []}
          disabled={edit.isPending}
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
          {edit.isPending ? 'Saving…' : 'Save account'}
        </Button>
      </DialogActions>
    </Box>
  );
}
