import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';

import { ApiError, request } from '../../shared/api/client';
import { Amount, type MoneyJson } from '../../shared/components/Amount';

interface AccountJson {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly type: string;
}

interface BalanceJson {
  readonly account: AccountJson;
  readonly balance: MoneyJson;
}

interface BalancesResponse {
  readonly balances: readonly BalanceJson[];
}

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly balances: readonly BalanceJson[] }
  | { readonly status: 'failed'; readonly error: ApiError };

/**
 * F10 — balance per account per currency, including crypto dust.
 *
 * The first real screen, and it is here mainly because it is the smallest
 * thing that exercises every part of the setup at once: the client, the
 * theme's semantic colours, and a column of tabular figures where the dust
 * (`14.09080000` USDT, eight places) has to line up under the bank balance
 * (`84,642.93` INR, two places). If those two align, the font stack is right.
 */
export function AccountBalances() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    /**
     * The `try` wraps the request and nothing else, deliberately.
     *
     * `request(...).then(render).catch(showError)` reads the same and is not:
     * `.catch` chained after `.then` also catches anything the *success* path
     * throws, so a rendering bug is reported to the user as "the server is not
     * reachable". That is a false accusation against the one component that is
     * working, and it is exactly the wrong place to be sent during an incident.
     */
    const load = async (): Promise<void> => {
      let response: BalancesResponse;

      try {
        response = await request<BalancesResponse>('/api/accounts/balances', {
          signal: controller.signal,
        });
      } catch (error: unknown) {
        // An aborted request is a component unmounting, not a failure.
        if (!live || controller.signal.aborted) return;

        setState({
          status: 'failed',
          error:
            error instanceof ApiError
              ? error
              : new ApiError(
                  0,
                  'network_error',
                  'The server is not reachable.',
                ),
        });
        return;
      }

      if (live) {
        setState({ status: 'ready', balances: response.balances });
      }
    };

    void load();

    return () => {
      live = false;
      controller.abort();
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress size={20} aria-label="Loading balances" />
      </Box>
    );
  }

  if (state.status === 'failed') {
    return (
      <Alert severity="error" variant="outlined" sx={{ mt: 2 }}>
        {state.error.message}
      </Alert>
    );
  }

  if (state.balances.length === 0) {
    return (
      <Typography sx={{ color: 'muted.main', mt: 2 }}>
        No movements recorded yet, so every account is at zero.
      </Typography>
    );
  }

  return (
    <Table size="small" aria-label="Account balances">
      <TableHead>
        <TableRow>
          <TableCell>Account</TableCell>
          <TableCell>Type</TableCell>
          <TableCell align="right">Balance</TableCell>
          <TableCell>Currency</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {state.balances.map((entry) => (
          <TableRow
            key={`${String(entry.account.id)}:${entry.balance.currency}`}
          >
            <TableCell>{entry.account.name}</TableCell>
            <TableCell sx={{ color: 'muted.main' }}>
              {entry.account.type.replace('_', ' ')}
            </TableCell>
            {/*
              Right-aligned and tabular, so the decimal points of a two-place
              rupee figure and an eight-place USDT dust figure sit in a line.
            */}
            <TableCell align="right">
              <Amount value={entry.balance} />
            </TableCell>
            <TableCell>
              <Typography variant="numeric" sx={{ color: 'muted.main' }}>
                {entry.balance.currency}
              </Typography>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
