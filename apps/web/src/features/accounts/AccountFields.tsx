import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import type { CompanyJson } from '../../shared/api';

/**
 * The five things an account is, as fields — and nothing about where they sit.
 *
 * Recording one and correcting one ask exactly the same questions, so they
 * ask them once: this renders on the `/accounts/new` screen and inside the
 * edit dialog, which is what keeps the allow-list's explanation ("choose none
 * and it holds anything") from existing in two places and drifting in one.
 *
 * It fetches nothing and decides nothing — values in, values out, companies
 * and field errors as props. It stays in `features/accounts/` rather than
 * `shared/components/` because it is entirely about what an account is, and
 * §5 says a shared component must work on a screen that does not exist yet.
 */

export const ACCOUNT_TYPES = [
  { value: 'prop_firm', label: 'Prop firm — where the award is granted' },
  { value: 'processor', label: 'Processor — moves it off the platform' },
  { value: 'exchange', label: 'Exchange — where crypto becomes rupees' },
  { value: 'wallet', label: 'Wallet — crypto in transit' },
  { value: 'bank', label: 'Bank — the end of the trail' },
] as const;

/**
 * The currencies §6 declares. Hard-coded rather than fetched, because there
 * is no endpoint that lists them and adding one to fill a row of chips would
 * be a route built for a dropdown. The server checks the choice regardless —
 * this list only decides what is offered.
 */
export const CURRENCIES = ['INR', 'USD', 'USDT'] as const;

/** Everything as a string, because that is what an input holds. */
export interface AccountValues {
  readonly code: string;
  readonly name: string;
  readonly type: string;
  /** `''` means nobody in particular, which the command sends as null. */
  readonly companyId: string;
  readonly allowed: readonly string[];
}

export const EMPTY_ACCOUNT: AccountValues = {
  code: '',
  name: '',
  type: 'bank',
  companyId: '',
  allowed: [],
};

export interface AccountFieldsProps {
  readonly values: AccountValues;
  readonly onChange: (values: AccountValues) => void;
  /** The server's own `details.issues`, keyed by field name. */
  readonly errors: Readonly<Record<string, string>>;
  readonly companies: readonly CompanyJson[];
  readonly autoFocus?: boolean;
  readonly disabled?: boolean;
}

export function AccountFields({
  values,
  onChange,
  errors,
  companies,
  autoFocus = false,
  disabled = false,
}: AccountFieldsProps) {
  const set = (patch: Partial<AccountValues>): void => {
    onChange({ ...values, ...patch });
  };

  const toggleCurrency = (currency: string): void => {
    set({
      allowed: values.allowed.includes(currency)
        ? values.allowed.filter((one) => one !== currency)
        : [...values.allowed, currency],
    });
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TextField
          label="Name"
          value={values.name}
          onChange={(event) => {
            set({ name: event.target.value });
          }}
          fullWidth
          size="small"
          required
          autoFocus={autoFocus}
          disabled={disabled}
          error={errors['name'] !== undefined}
          helperText={errors['name'] ?? 'What you call it — HDFC, CoinDCX.'}
        />

        <TextField
          label="Code"
          value={values.code}
          onChange={(event) => {
            set({ code: event.target.value });
          }}
          fullWidth
          size="small"
          required
          disabled={disabled}
          error={errors['code'] !== undefined}
          helperText={errors['code'] ?? 'A short unique key: bank-hdfc.'}
        />
      </Box>

      <TextField
        select
        label="Kind"
        value={values.type}
        onChange={(event) => {
          set({ type: event.target.value });
        }}
        fullWidth
        size="small"
        sx={{ mt: 2 }}
        required
        disabled={disabled}
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
        value={values.companyId}
        onChange={(event) => {
          set({ companyId: event.target.value });
        }}
        fullWidth
        size="small"
        sx={{ mt: 2 }}
        disabled={disabled}
        error={errors['companyId'] !== undefined}
        helperText={
          errors['companyId'] ??
          'Only if the account belongs to one — a wallet or a bank does not.'
        }
      >
        <MenuItem value="">Nobody in particular</MenuItem>
        {companies.map((company) => (
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
          Choose none and it holds anything. Choose some and a transaction in
          any other currency is refused.
        </Typography>

        <Box sx={{ display: 'flex', gap: 1 }}>
          {CURRENCIES.map((currency) => {
            const on = values.allowed.includes(currency);

            return (
              <Chip
                key={currency}
                label={currency}
                variant={on ? 'filled' : 'outlined'}
                disabled={disabled}
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
    </Box>
  );
}

/** The command shape both writes send, from what the inputs hold. */
export function toAccountCommand(values: AccountValues): {
  code: string;
  name: string;
  type: 'bank';
  companyId?: number | null;
  allowedCurrencies?: readonly string[];
} {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    // The union is the server's to check; `ACCOUNT_TYPES` is where this one
    // came from, and a select cannot hold anything else.
    type: values.type as 'bank',
    ...(values.companyId === '' ? {} : { companyId: Number(values.companyId) }),
    ...(values.allowed.length === 0
      ? {}
      : { allowedCurrencies: values.allowed }),
  };
}
