import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCompanies, useRecordPayout } from '../../shared/api';
import { describeError, fieldErrors } from '../../shared/api/errors';
import { AmountField, ErrorState } from '../../shared/components';
import { useToast } from '../../shared/feedback';

/**
 * F2 — record a payout: company, date, gross, charges, reference.
 *
 * Every amount is a string from the keyboard to `Money.fromDecimalString`.
 * Nothing here parses a decimal, and nothing rounds one — `AmountField`
 * filters keystrokes to the characters a decimal is made of and passes the
 * text through untouched, which is the cheapest way to keep N1's promise at
 * the one place a person can break it.
 *
 * Field-level errors come from the server's own `details.issues`, which
 * `apps/api/src/routes/validate.ts` sends as `{ path, message }` pairs for
 * precisely this. "Invalid request body" under a form of eight fields would
 * make the reader guess which one.
 */
export function RecordPayoutForm() {
  const companies = useCompanies();
  const record = useRecordPayout();
  const navigate = useNavigate();
  const { notify } = useToast();

  const [code, setCode] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [payoutDate, setPayoutDate] = useState('');
  const [grossAmount, setGrossAmount] = useState('');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [charges, setCharges] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const errors = fieldErrors(record.error);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (record.isPending) return;

    record.mutate(
      {
        code: code.trim(),
        companyId: Number(companyId),
        grossAmount,
        currencyCode: currencyCode.trim().toUpperCase(),
        ...(payoutDate === '' ? {} : { payoutDate }),
        ...(charges.trim() === '' ? {} : { charges }),
        ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
        ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
      },
      {
        onSuccess: (result) => {
          notify('Payout recorded');
          // Straight to the payout's own screen: the next thing anybody does
          // after recording an award is record the leg that moved it.
          void navigate(`/payouts/${String(result.payout.id)}`, {
            replace: true,
          });
        },
      },
    );
  };

  const failure =
    record.error === null || Object.keys(errors).length > 0
      ? null
      : describeError(record.error);

  return (
    <Box>
      <Typography variant="h1" sx={{ mb: 0.5 }}>
        Record payout
      </Typography>
      <Typography sx={{ color: 'muted.main', mb: 3 }}>
        One award from one company. The movements that follow are recorded on
        its own screen.
      </Typography>

      <Paper sx={{ p: 3, maxWidth: 620 }}>
        <Box component="form" onSubmit={submit} noValidate>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="Payout code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
              }}
              fullWidth
              size="small"
              required
              autoFocus
              error={errors['code'] !== undefined}
              helperText={
                errors['code'] ?? 'How you refer to it — TradeifyPayout001.'
              }
            />

            <TextField
              select
              label="Company"
              value={companyId}
              onChange={(event) => {
                setCompanyId(event.target.value);
              }}
              fullWidth
              size="small"
              required
              error={errors['companyId'] !== undefined}
              helperText={errors['companyId']}
            >
              {(companies.data ?? []).map((company) => (
                <MenuItem key={company.id} value={String(company.id)}>
                  {company.name}
                </MenuItem>
              ))}
            </TextField>
          </Box>

          <TextField
            label="Payout date"
            type="date"
            value={payoutDate}
            onChange={(event) => {
              setPayoutDate(event.target.value);
            }}
            fullWidth
            size="small"
            sx={{ mt: 2 }}
            slotProps={{ inputLabel: { shrink: true } }}
            error={errors['payoutDate'] !== undefined}
            helperText={
              errors['payoutDate'] ?? 'Defaults to today if left blank.'
            }
          />

          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
            <AmountField
              label="Gross awarded"
              value={grossAmount}
              onChange={setGrossAmount}
              decimals={8}
              required
              currency={currencyCode}
              {...(errors['grossAmount'] === undefined
                ? {}
                : { error: errors['grossAmount'] })}
            />

            <TextField
              label="Currency"
              value={currencyCode}
              onChange={(event) => {
                setCurrencyCode(event.target.value.toUpperCase());
              }}
              size="small"
              sx={{ width: 140 }}
              required
              error={errors['currencyCode'] !== undefined}
              helperText={errors['currencyCode']}
            />
          </Box>

          <Box sx={{ mt: 2 }}>
            <AmountField
              label="Platform charges"
              value={charges}
              onChange={setCharges}
              decimals={8}
              currency={currencyCode}
              helperText="What the firm kept before paying. Leave blank if none."
              {...(errors['charges'] === undefined
                ? {}
                : { error: errors['charges'] })}
            />
          </Box>

          <TextField
            label="Reference"
            value={reference}
            onChange={(event) => {
              setReference(event.target.value);
            }}
            fullWidth
            size="small"
            sx={{ mt: 2 }}
            error={errors['reference'] !== undefined}
            helperText={
              errors['reference'] ??
              'Kept as text, exactly as given — long digit strings included.'
            }
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
              {record.isPending ? 'Recording…' : 'Record payout'}
            </Button>
            <Button
              color="inherit"
              onClick={() => {
                void navigate('/payouts');
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
