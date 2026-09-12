import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';

import { useAccountBalances, type AccountBalanceJson } from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import {
  CurrencyChip,
  DataTable,
  ErrorState,
  MoneyDisplay,
  type Column,
} from '../../shared/components';

/**
 * F10 — balance per account per currency, including crypto dust.
 *
 * Derived from every movement on each read and never stored (§13), which is
 * why there is no "recalculate" button: there is nothing to recalculate, and
 * a button implying otherwise would suggest the number on screen might be a
 * cached one.
 *
 * The dust is the point of the two crypto rows. `14.09080000` USDT is not a
 * rounding artefact — it is what a transfer left behind, and it is evidence.
 * Eight decimal places sit under a two-decimal rupee figure in the same
 * column, which only reads as a column because every figure is tabular.
 */

const TYPE_LABELS: Readonly<Record<string, string>> = {
  prop_firm: 'prop firm',
  processor: 'processor',
  exchange: 'exchange',
  wallet: 'wallet',
  bank: 'bank',
};

export function AccountBalances() {
  const balances = useAccountBalances();

  const columns: readonly Column<AccountBalanceJson>[] = useMemo(
    () => [
      {
        id: 'account',
        header: 'Account',
        cell: (entry) => entry.account.name,
        sortBy: (entry) => entry.account.name,
      },
      {
        id: 'type',
        header: 'Type',
        cell: (entry) => (
          <Typography variant="body2" sx={{ color: 'muted.main' }}>
            {TYPE_LABELS[entry.account.type] ?? entry.account.type}
          </Typography>
        ),
        sortBy: (entry) => entry.account.type,
      },
      {
        id: 'balance',
        header: 'Balance',
        align: 'right',
        cell: (entry) => (
          <MoneyDisplay
            minor={entry.balance.minor}
            currency={entry.balance.currency}
            tone="auto"
          />
        ),
        // On the integer, and as a BigInt: USDT dust is 1.3323e8 minor units
        // and a bank balance is 8.46e6 of a different scale, so sorting on
        // the rendered text would interleave them by their first digit.
        sortBy: (entry) => BigInt(entry.balance.minor),
      },
      {
        id: 'currency',
        header: 'Currency',
        cell: (entry) => <CurrencyChip code={entry.balance.currency} />,
        sortBy: (entry) => entry.balance.currency,
      },
    ],
    [],
  );

  if (balances.isError) {
    const failure = describeError(balances.error);

    return (
      <ErrorState
        message={failure.message}
        {...(failure.action === undefined ? {} : { detail: failure.action })}
        onRetry={() => {
          void balances.refetch();
        }}
      />
    );
  }

  return (
    <Box>
      <DataTable<AccountBalanceJson>
        rows={balances.data ?? []}
        columns={columns}
        rowKey={(entry) =>
          `${String(entry.account.id)}:${entry.balance.currency}`
        }
        loading={balances.isPending}
        caption="Account balances"
        empty={{
          message: 'No movements recorded yet, so every account is at zero.',
          hint: 'A balance here is the sum of what arrived less what left — record a payout and its legs, and the accounts appear.',
        }}
      />
    </Box>
  );
}
