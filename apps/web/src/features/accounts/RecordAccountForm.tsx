import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCompanies, useRecordAccount } from '../../shared/api';
import { describeError, fieldErrors } from '../../shared/api/errors';
import { ErrorState } from '../../shared/components';
import { useToast } from '../../shared/feedback';

import {
  AccountFields,
  EMPTY_ACCOUNT,
  toAccountCommand,
  type AccountValues,
} from './AccountFields';

/**
 * F1 — record somewhere money can sit.
 *
 * The fields themselves live in `AccountFields`, shared with the edit dialog:
 * recording an account and correcting one ask the same five questions, and
 * the allow-list's explanation should exist once. What is left here is what
 * makes this a *screen* — where it goes afterwards, and what it says when the
 * server refuses.
 *
 * The allow-list is the field that needs explaining, and the form explains it
 * rather than assuming: leaving it empty means the account holds anything,
 * which is a real choice (`Account.allows` treats an empty list as
 * permissive, mirroring `v_data_quality`). Left implicit, somebody would fill
 * it in defensively and then find that §7 refuses the transaction they meant
 * to record.
 */
export function RecordAccountForm() {
  const companies = useCompanies();
  const record = useRecordAccount();
  const navigate = useNavigate();
  const { notify } = useToast();

  const [values, setValues] = useState<AccountValues>(EMPTY_ACCOUNT);

  const errors = fieldErrors(record.error);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (record.isPending) return;

    record.mutate(toAccountCommand(values), {
      onSuccess: () => {
        notify('Account recorded');
        void navigate('/accounts', { replace: true });
      },
    });
  };

  const failure =
    record.error === null || Object.keys(errors).length > 0
      ? null
      : describeError(record.error);

  return (
    <Box>
      <Typography variant="h1" sx={{ mb: 0.5 }}>
        Record account
      </Typography>
      <Typography sx={{ color: 'muted.main', mb: 3 }}>
        A prop firm, a processor, an exchange, a wallet or a bank.
      </Typography>

      <Paper sx={{ p: 3, maxWidth: 620 }}>
        <Box component="form" onSubmit={submit} noValidate>
          <AccountFields
            values={values}
            onChange={setValues}
            errors={errors}
            companies={companies.data ?? []}
            autoFocus
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

          <Box sx={{ display: 'flex', gap: 1, mt: 3 }}>
            <Button
              type="submit"
              variant="contained"
              disabled={record.isPending}
            >
              {record.isPending ? 'Recording…' : 'Record account'}
            </Button>
            <Button
              color="inherit"
              onClick={() => {
                void navigate('/accounts');
              }}
            >
              Cancel
            </Button>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}
