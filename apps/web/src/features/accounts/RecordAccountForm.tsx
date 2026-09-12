import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCompanies, useRecordAccount } from '../../shared/api';
import { describeError, fieldErrors } from '../../shared/api/errors';
import { ErrorState } from '../../shared/components';
import { useToast } from '../../shared/feedback';

/**
 * F1 — record somewhere money can sit.
 *
 * The allow-list is the only field here that needs explaining, and the form
 * explains it rather than assuming: leaving it empty means the account holds
 * anything, which is a real choice (`Account.allows` treats an empty list as
 * permissive, mirroring `v_data_quality`). Left implicit, somebody would fill
 * it in defensively and then find that §7 refuses the transaction they meant
 * to record.
 *
 * The currencies come from the ledger's own table rather than a free-text
 * box, because `account_currencies.currency_code` is a foreign key — typing
 * `usdt` here would otherwise be a constraint violation dressed up as a
 * server fault.
 */

const ACCOUNT_TYPES = [
  { value: 'prop_firm', label: 'Prop firm — where the award is granted' },
  { value: 'processor', label: 'Processor — moves it off the platform' },
  { value: 'exchange', label: 'Exchange — where crypto becomes rupees' },
  { value: 'wallet', label: 'Wallet — crypto in transit' },
  { value: 'bank', label: 'Bank — the end of the trail' },
] as const;

/**
 * The currencies §6 declares. Hard-coded here rather than fetched, because
 * there is no endpoint that lists them and adding one to fill a select would
 * be a route built for a dropdown. The server checks the choice regardless —
 * this list only decides what is offered.
 */
const CURRENCIES = ['INR', 'USD', 'USDT'] as const;

export function RecordAccountForm() {
  const companies = useCompanies();
  const record = useRecordAccount();
  const navigate = useNavigate();
  const { notify } = useToast();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('bank');
  const [companyId, setCompanyId] = useState('');
  const [allowed, setAllowed] = useState<readonly string[]>([]);

  const errors = fieldErrors(record.error);

  const toggleCurrency = (currency: string): void => {
    setAllowed((current) =>
      current.includes(currency)
        ? current.filter((one) => one !== currency)
        : [...current, currency],
    );
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (record.isPending) return;

    record.mutate(
      {
        code: code.trim(),
        name: name.trim(),
        type: type as 'bank',
        ...(companyId === '' ? {} : { companyId: Number(companyId) }),
        ...(allowed.length === 0 ? {} : { allowedCurrencies: allowed }),
      },
      {
        onSuccess: () => {
          notify('Account recorded');
          void navigate('/accounts', { replace: true });
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
        Record account
      </Typography>
      <Typography sx={{ color: 'muted.main', mb: 3 }}>
        A prop firm, a processor, an exchange, a wallet or a bank.
      </Typography>

      <Paper sx={{ p: 3, maxWidth: 620 }}>
        <Box component="form" onSubmit={submit} noValidate>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="Name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              fullWidth
              size="small"
              required
              autoFocus
              error={errors['name'] !== undefined}
              helperText={errors['name'] ?? 'What you call it — HDFC, CoinDCX.'}
            />

            <TextField
              label="Code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
              }}
              fullWidth
              size="small"
              required
              error={errors['code'] !== undefined}
              helperText={errors['code'] ?? 'A short unique key: bank-hdfc.'}
            />
          </Box>

          <TextField
            select
            label="Kind"
            value={type}
            onChange={(event) => {
              setType(event.target.value);
            }}
            fullWidth
            size="small"
            sx={{ mt: 2 }}
            required
            error={errors['type'] !== undefined}
            helperText={errors['type']}
          >
            {ACCOUNT_TYPES.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Company"
            value={companyId}
            onChange={(event) => {
              setCompanyId(event.target.value);
            }}
            fullWidth
            size="small"
            sx={{ mt: 2 }}
            error={errors['companyId'] !== undefined}
            helperText={
              errors['companyId'] ??
              'Only if the account belongs to one — a wallet or a bank does not.'
            }
          >
            <MenuItem value="">Nobody in particular</MenuItem>
            {(companies.data ?? []).map((company) => (
              <MenuItem key={company.id} value={String(company.id)}>
                {company.name}
              </MenuItem>
            ))}
          </TextField>

          <Box sx={{ mt: 3 }}>
            <Typography variant="label" component="h3" sx={{ display: 'block' }}>
              Currencies it can hold
            </Typography>
            <Typography variant="body2" sx={{ color: 'muted.main', mb: 1 }}>
              Choose none and it holds anything. Choose some and a transaction
              in any other currency is refused.
            </Typography>

            <Box sx={{ display: 'flex', gap: 1 }}>
              {CURRENCIES.map((currency) => {
                const on = allowed.includes(currency);

                return (
                  <Chip
                    key={currency}
                    label={currency}
                    variant={on ? 'filled' : 'outlined'}
                    onClick={() => {
                      toggleCurrency(currency);
                    }}
                    // `aria-pressed` rather than a checkbox role: these are
                    // toggles, and a screen reader should say which are on.
                    aria-pressed={on}
                    sx={{
                      fontFamily: (theme) => theme.typography.numeric.fontFamily,
                      cursor: 'pointer',
                    }}
                  />
                );
              })}
            </Box>

            {errors['allowedCurrencies'] === undefined ? null : (
              <Typography variant="body2" sx={{ color: 'negative.main', mt: 1 }}>
                {errors['allowedCurrencies']}
              </Typography>
            )}
          </Box>

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
            <Button type="submit" variant="contained" disabled={record.isPending}>
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
