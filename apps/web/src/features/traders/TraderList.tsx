import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';

import { useAllPayouts, useTraders, type TraderJson } from '../../shared/api';
import { describeError } from '../../shared/api/errors';
import { DataTable, ErrorState, type Column } from '../../shared/components';
import { useToast } from '../../shared/feedback';

import { EditTraderDialog } from './EditTraderDialog';
import { NewTraderDialog } from './NewTraderDialog';

/**
 * F27 — the register of people this ledger keeps payouts for.
 *
 * The bar at the top of every screen can add one and switch between them,
 * which is what it is for; this is where they are *read* — who exists, what
 * their code is, what was noted about them, and how many payouts are theirs.
 * The count is the column that earns its place: it is the difference between
 * a name somebody typed twice and the person the money belongs to.
 *
 * Nothing deletes here. `payouts.trader_id` is ON DELETE RESTRICT, so a
 * trader with payouts cannot go without taking a ledger with them, and one
 * without payouts costs a line in a dropdown.
 */
export function TraderList() {
  const traders = useTraders();
  /*
    `useAllPayouts`, never `usePayouts`.

    This screen is the register, not a view of the selection: "three payouts"
    must mean three, whoever the bar is showing and whatever period it is cut
    to. `usePayouts` folds the scope in — which is right everywhere else and
    wrong here, and a test switches the bar to prove the counts do not move.
  */
  const everyPayout = useAllPayouts();
  const { notify } = useToast();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TraderJson | null>(null);

  const payoutCounts = useMemo(() => {
    const byTrader = new Map<number, number>();

    for (const payout of everyPayout.data ?? []) {
      byTrader.set(payout.traderId, (byTrader.get(payout.traderId) ?? 0) + 1);
    }

    return byTrader;
  }, [everyPayout.data]);

  const columns: readonly Column<TraderJson>[] = useMemo(
    () => [
      {
        id: 'name',
        header: 'Trader',
        cell: (trader) => trader.name,
        sortBy: (trader) => trader.name,
      },
      {
        id: 'code',
        header: 'Code',
        cell: (trader) => (
          <Typography variant="numeric" sx={{ color: 'muted.main' }}>
            {trader.code}
          </Typography>
        ),
        sortBy: (trader) => trader.code,
      },
      {
        id: 'payouts',
        header: 'Payouts',
        align: 'right',
        cell: (trader) => (
          <Typography variant="numeric">
            {String(payoutCounts.get(trader.id) ?? 0)}
          </Typography>
        ),
        sortBy: (trader) => payoutCounts.get(trader.id) ?? 0,
      },
      {
        id: 'notes',
        header: 'Notes',
        cell: (trader) =>
          trader.notes === null ? (
            <Typography variant="body2" sx={{ color: 'muted.main' }}>
              —
            </Typography>
          ) : (
            <Typography variant="body2" sx={{ color: 'muted.main' }}>
              {trader.notes}
            </Typography>
          ),
        sortBy: (trader) => trader.notes,
      },
      {
        id: 'actions',
        header: '',
        align: 'right',
        // No `sortBy`: a column of buttons has nothing to sort on.
        cell: (trader) => (
          <Button
            size="small"
            color="inherit"
            onClick={() => {
              setEditing(trader);
            }}
          >
            Edit
          </Button>
        ),
      },
    ],
    [payoutCounts],
  );

  if (traders.isError) {
    const failure = describeError(traders.error);

    return (
      <ErrorState
        message={failure.message}
        {...(failure.action === undefined ? {} : { detail: failure.action })}
        onRetry={() => {
          void traders.refetch();
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
            Traders
          </Typography>
          <Typography sx={{ color: 'muted.main' }}>
            The people these payouts belong to. Not sign-ins: one account
            keeps this ledger, and a trader has no password.
          </Typography>
        </Box>

        <Button
          variant="contained"
          onClick={() => {
            setAdding(true);
          }}
        >
          Add trader
        </Button>
      </Box>

      <DataTable<TraderJson>
        rows={traders.data ?? []}
        columns={columns}
        rowKey={(trader) => trader.id}
        loading={traders.isPending}
        caption="Traders"
        empty={{
          message: 'No traders yet.',
          hint: 'Every payout belongs to somebody, so there is always at least one.',
          action: {
            label: 'Add the first trader',
            onClick: () => {
              setAdding(true);
            },
          },
        }}
      />

      <NewTraderDialog
        open={adding}
        onCreated={(trader) => {
          setAdding(false);
          notify(`${trader.name} added`);
        }}
        onCancel={() => {
          setAdding(false);
        }}
      />

      <EditTraderDialog
        trader={editing}
        onClose={() => {
          setEditing(null);
        }}
        onSaved={(trader) => {
          setEditing(null);
          notify(`${trader.name} saved`);
        }}
      />
    </Box>
  );
}
