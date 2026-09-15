import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  useAccounts,
  useCompanies,
  useDeleteAccount,
  type AccountJson,
} from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import {
  ConfirmDialog,
  CurrencyChip,
  DataTable,
  ErrorState,
  type Column,
} from '../../shared/components';
import { useToast } from '../../shared/feedback';

import { EditAccountDialog } from './EditAccountDialog';

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
  const remove = useDeleteAccount();
  const navigate = useNavigate();
  const { notify } = useToast();

  /*
    Two dialogs, each holding the row it is about rather than an id.

    An id would have to be looked up again on every render, and the lookup
    would come back undefined at exactly the wrong moment — the instant after
    a delete succeeds and before the dialog closes.
  */
  const [editing, setEditing] = useState<AccountJson | null>(null);
  const [deleting, setDeleting] = useState<AccountJson | null>(null);

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
      {
        id: 'actions',
        header: '',
        align: 'right',
        // No `sortBy`: a column of buttons has nothing to sort on, which
        // `DataTable` expresses by the field simply being absent.
        cell: (account) => (
          <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
            <Button
              size="small"
              color="inherit"
              onClick={() => {
                setEditing(account);
              }}
            >
              Edit
            </Button>
            <Button
              size="small"
              color="error"
              onClick={() => {
                setDeleting(account);
              }}
            >
              Delete
            </Button>
          </Box>
        ),
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

      <EditAccountDialog
        account={editing}
        onClose={() => {
          setEditing(null);
        }}
        onSaved={(account) => {
          setEditing(null);
          notify(`${account.name} saved`);
        }}
      />

      {/*
        The refusal is shown inside the dialog, not as a toast: an account
        money has moved through cannot be deleted at all (409), and the
        sentence explaining why belongs next to the question it answers.
        `ToastTone` has no error tone — confirmations are not where failures
        are reported.
      */}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? 'this account'}?`}
        message={
          <>
            Nothing that has been recorded changes. Its addresses and any fee
            schedules on it go with it, and an account money has moved through
            cannot be deleted at all.
            {remove.error === null ? null : (
              <Box sx={{ mt: 2 }}>
                <ErrorState message={describeError(remove.error).message} />
              </Box>
            )}
          </>
        }
        confirmLabel="Delete account"
        destructive
        busy={remove.isPending}
        onConfirm={() => {
          if (deleting === null || remove.isPending) return;

          remove.mutate(deleting.id, {
            onSuccess: (result) => {
              setDeleting(null);
              notify(`${result.account.name} deleted`);
            },
          });
        }}
        onCancel={() => {
          setDeleting(null);
          remove.reset();
        }}
      />
    </Box>
  );
}
