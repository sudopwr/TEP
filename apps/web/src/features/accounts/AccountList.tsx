import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAccounts, useCompanies, type AccountJson } from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import {
  CurrencyChip,
  DataTable,
  ErrorState,
  type Column,
} from '../../shared/components';

/**
 * F1 — everywhere money can sit.
 *
 * Deliberately separate from Balances, which looks similar and answers a
 * different question. A balance is derived from movements (UC7), so an
 * account recorded a minute ago is simply absent from that screen; this one
 * is the register of accounts themselves, and it is where a new one is added.
 *
 * The currencies column is the one that earns its place. §7 makes a currency
 * the destination cannot hold an *impossible* state rather than a suspicious
 * one, so the allow-list decides what a transaction form will even offer —
 * and an empty list means "anything", which is a real choice and has to read
 * as one rather than as a blank cell.
 */

const TYPE_LABELS: Readonly<Record<string, string>> = {
  prop_firm: 'prop firm',
  processor: 'processor',
  exchange: 'exchange',
  wallet: 'wallet',
  bank: 'bank',
};

export function AccountList() {
  const accounts = useAccounts();
  const companies = useCompanies();
  const navigate = useNavigate();

  const companyNames = useMemo(() => {
    const byId = new Map<number, string>();

    for (const company of companies.data ?? []) {
      byId.set(company.id, company.name);
    }

    return byId;
  }, [companies.data]);

  const columns: readonly Column<AccountJson>[] = useMemo(
    () => [
      {
        id: 'name',
        header: 'Account',
        cell: (account) => account.name,
        sortBy: (account) => account.name,
      },
      {
        id: 'code',
        header: 'Code',
        cell: (account) => (
          <Typography variant="numeric" sx={{ color: 'muted.main' }}>
            {account.code}
          </Typography>
        ),
        sortBy: (account) => account.code,
      },
      {
        id: 'type',
        header: 'Type',
        cell: (account) => (
          <Typography variant="body2" sx={{ color: 'muted.main' }}>
            {TYPE_LABELS[account.type] ?? account.type}
          </Typography>
        ),
        sortBy: (account) => account.type,
      },
      {
        id: 'company',
        header: 'Company',
        cell: (account) =>
          account.companyId === null ? (
            <Typography variant="body2" sx={{ color: 'muted.main' }}>
              —
            </Typography>
          ) : (
            (companyNames.get(account.companyId) ??
            `Company ${String(account.companyId)}`)
          ),
        sortBy: (account) =>
          account.companyId === null
            ? null
            : (companyNames.get(account.companyId) ?? ''),
      },
      {
        id: 'currencies',
        header: 'Holds',
        cell: (account) =>
          account.allowedCurrencies.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'muted.main' }}>
              anything
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {account.allowedCurrencies.map((code) => (
                <CurrencyChip key={code} code={code} />
              ))}
            </Box>
          ),
        sortBy: (account) => account.allowedCurrencies.join(','),
      },
    ],
    [companyNames],
  );

  if (accounts.isError) {
    const failure = describeError(accounts.error);

    return (
      <ErrorState
        message={failure.message}
        {...(failure.action === undefined ? {} : { detail: failure.action })}
        onRetry={() => {
          void accounts.refetch();
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
            Accounts
          </Typography>
          <Typography sx={{ color: 'muted.main' }}>
            Everywhere money sits on its way from the firm to the bank.
          </Typography>
        </Box>

        <Button
          variant="contained"
          onClick={() => {
            void navigate('/accounts/new');
          }}
        >
          Record account
        </Button>
      </Box>

      <DataTable<AccountJson>
        rows={accounts.data ?? []}
        columns={columns}
        rowKey={(account) => account.id}
        loading={accounts.isPending}
        caption="Accounts"
        empty={{
          message: 'No accounts recorded yet.',
          hint: 'A transaction moves money between two of these, so a payout cannot be traced until they exist.',
          action: {
            label: 'Record the first account',
            onClick: () => {
              void navigate('/accounts/new');
            },
          },
        }}
      />
    </Box>
  );
}
