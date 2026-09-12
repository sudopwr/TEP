import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCompanies, usePayouts, type PayoutJson } from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import {
  DataTable,
  ErrorState,
  MoneyDisplay,
  type Column,
} from '../../shared/components';

/**
 * F2 — every payout, newest first, one row each.
 *
 * The columns are chosen for scanning rather than for completeness: a person
 * arriving here is looking for one award among a few dozen, and they find it
 * by company, date or amount. Everything else about a payout is one click
 * away on the detail screen, and putting it here would make the amounts
 * harder to compare, which is the one thing the list is for.
 *
 * Sorting is on the integer minor units, not on the rendered string — a money
 * column sorted as text puts `9.00` after `84,642.93`. `DataTable` keeps
 * `sortBy` separate from `cell` for exactly this.
 */
export function PayoutList() {
  const payouts = usePayouts();
  const companies = useCompanies();
  const navigate = useNavigate();

  const companyNames = useMemo(() => {
    const byId = new Map<number, string>();

    for (const company of companies.data ?? []) {
      byId.set(company.id, company.name);
    }

    return byId;
  }, [companies.data]);

  const columns: readonly Column<PayoutJson>[] = useMemo(
    () => [
      {
        id: 'code',
        header: 'Payout',
        cell: (payout) => (
          <Typography variant="numeric">{payout.code}</Typography>
        ),
        sortBy: (payout) => payout.code,
      },
      {
        id: 'company',
        header: 'Company',
        cell: (payout) =>
          companyNames.get(payout.companyId) ??
          `Company ${String(payout.companyId)}`,
        sortBy: (payout) => companyNames.get(payout.companyId) ?? '',
      },
      {
        id: 'date',
        header: 'Date',
        // ISO, so the column sorts chronologically as text and reads
        // unambiguously — `03/04` is two different days either side of an
        // ocean, and this application is read alongside foreign statements.
        cell: (payout) => (
          <Typography variant="numeric">{payout.payoutDate}</Typography>
        ),
        sortBy: (payout) => payout.payoutDate,
      },
      {
        id: 'gross',
        header: 'Gross',
        align: 'right',
        cell: (payout) => (
          <MoneyDisplay
            minor={payout.gross.minor}
            currency={payout.gross.currency}
            showCurrency
          />
        ),
        sortBy: (payout) => BigInt(payout.gross.minor),
      },
      {
        id: 'charges',
        header: 'Charges',
        align: 'right',
        cell: (payout) => (
          <MoneyDisplay
            minor={payout.charges.minor}
            currency={payout.charges.currency}
            tone="negative"
          />
        ),
        sortBy: (payout) => BigInt(payout.charges.minor),
      },
      {
        id: 'reference',
        header: 'Reference',
        cell: (payout) => (
          <Typography variant="numeric" sx={{ color: 'muted.main' }}>
            {payout.reference ?? '—'}
          </Typography>
        ),
        sortBy: (payout) => payout.reference,
      },
    ],
    [companyNames],
  );

  if (payouts.isError) {
    const failure = describeError(payouts.error);

    return (
      <ErrorState
        message={failure.message}
        {...(failure.action === undefined ? {} : { detail: failure.action })}
        onRetry={() => {
          void payouts.refetch();
        }}
      />
    );
  }

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          mb: 3,
        }}
      >
        <Box>
          <Typography variant="h1" sx={{ mb: 0.5 }}>
            Payouts
          </Typography>
          <Typography sx={{ color: 'muted.main' }}>
            Every award, from what was granted to what reached the bank.
          </Typography>
        </Box>

        <Button
          variant="contained"
          onClick={() => {
            void navigate('/payouts/new');
          }}
        >
          Record payout
        </Button>
      </Box>

      <DataTable<PayoutJson>
        rows={payouts.data ?? []}
        columns={columns}
        rowKey={(payout) => payout.id}
        loading={payouts.isPending}
        caption="Payouts"
        initialSort={{ columnId: 'date', direction: 'desc' }}
        onRowClick={(payout) => {
          void navigate(`/payouts/${String(payout.id)}`);
        }}
        empty={{
          message: 'No payouts recorded yet.',
          hint: 'A payout is one award from one company — the root of the tree that ends in your bank account.',
          action: {
            label: 'Record the first payout',
            onClick: () => {
              void navigate('/payouts/new');
            },
          },
        }}
      />
    </Box>
  );
}
