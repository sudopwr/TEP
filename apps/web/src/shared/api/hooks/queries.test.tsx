import { describe, expect, it, vi } from 'vitest';

import {
  BALANCES,
  ISSUES,
  OTHER_PAYOUT,
  PAYOUT,
  SETTLEMENT,
  TRADEIFY,
} from '../../../../test/msw/fixtures';
import {
  passwordChangeRequired,
  unreachable,
} from '../../../../test/msw/handlers';
import { server } from '../../../../test/msw/server';
import { renderHookWithClient, waitFor } from '../../../../test/renderHook';
import { queryKeys } from '../keys';
import { STALE_TIME_MS } from '../queryClient';

import {
  useAccountBalances,
  useCompanies,
  useDataQuality,
  useDocumentSearch,
  useFinancialYearReport,
  usePayoutTrail,
  usePayouts,
  useSettlement,
  useTransactions,
} from './queries';

/**
 * Every hook, against MSW. Nothing here stubs `useQuery`.
 *
 * That is the point of mocking at the network layer: the real `queryFn` runs,
 * the real cache is written, the real `select` unwraps the envelope, and the
 * real defaults apply. A test that replaced `useQuery` with a fake would still
 * pass if the query key were wrong, the envelope changed, or the cache were
 * never written — which are the three things most worth knowing.
 */

describe('query hooks', () => {
  it('useCompanies unwraps the envelope to a typed array', async () => {
    const { result } = renderHookWithClient(() => useCompanies());

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Not `data.companies` — the hook's `select` already unwrapped it, so no
    // component ever writes `data?.companies ?? []`.
    expect(result.current.data).toEqual([TRADEIFY, expect.anything()]);
  });

  it('usePayouts returns the payout list', async () => {
    const { result } = renderHookWithClient(() => usePayouts());

    await waitFor(() => {
      expect(result.current.data).toEqual([PAYOUT, OTHER_PAYOUT]);
    });
  });

  it('usePayouts keys separately per filter', async () => {
    const { result, client } = renderHookWithClient(() =>
      usePayouts({ companyId: 1 }),
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(
      client.getQueryData(queryKeys.payouts.list({ companyId: 1 })),
    ).toBeDefined();
    // A different filter is a different question and must not read this cache.
    expect(client.getQueryData(queryKeys.payouts.list())).toBeUndefined();
  });

  it('useSettlement returns the §10 figures', async () => {
    const { result } = renderHookWithClient(() => useSettlement(1));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.netCredited.amount).toBe('84642.93');
    expect(result.current.data?.totalFees.amount).toBe('1384.63');
    // Derived, never stored: a sale leg reached the bank, so it is settled.
    expect(result.current.data?.status).toBe('settled');
  });

  it('usePayoutTrail returns the whole nested tree', async () => {
    const { result } = renderHookWithClient(() => usePayoutTrail(1));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // §10's tree is four levels deep: one credit at the root, four
    // withdrawals under it, a transfer under each of those, and a sale under
    // each transfer.
    const roots = result.current.data?.roots;
    expect(roots).toHaveLength(1);
    expect(roots?.[0]?.transaction.kind).toBe('payout_credit');
    expect(roots?.[0]?.children).toHaveLength(4);
    expect(roots?.[0]?.children[0]?.transaction.kind).toBe('withdrawal');
    expect(roots?.[0]?.children[0]?.children[0]?.transaction.kind).toBe(
      'transfer',
    );
    expect(
      roots?.[0]?.children[0]?.children[0]?.children[0]?.transaction.kind,
    ).toBe('sale');
  });

  it('useAccountBalances keeps both dust figures', async () => {
    const { result } = renderHookWithClient(() => useAccountBalances());

    await waitFor(() => {
      expect(result.current.data).toEqual(BALANCES);
    });
  });

  it('useTransactions returns the ledger', async () => {
    const { result } = renderHookWithClient(() => useTransactions(1));

    await waitFor(() => {
      expect(result.current.data).toHaveLength(13);
    });
  });

  it('useDataQuality returns the flagged rows', async () => {
    const { result } = renderHookWithClient(() => useDataQuality());

    await waitFor(() => {
      expect(result.current.data).toEqual(ISSUES);
    });
  });

  describe('queries that wait for an argument', () => {
    it('usePayoutTrail asks nothing until it has a payout', () => {
      const { result } = renderHookWithClient(() => usePayoutTrail(null));

      expect(result.current.fetchStatus).toBe('idle');
      expect(result.current.isPending).toBe(true);
    });

    it('useSettlement asks nothing until it has a payout', () => {
      const { result } = renderHookWithClient(() => useSettlement(null));

      expect(result.current.fetchStatus).toBe('idle');
    });

    it('useDocumentSearch asks nothing for an empty box', () => {
      // The API answers 400 to an empty query, and rightly — but a search box
      // is empty before anyone types, and that is not an error to render.
      const { result } = renderHookWithClient(() => useDocumentSearch('   '));

      expect(result.current.fetchStatus).toBe('idle');
    });

    it('useDocumentSearch searches once there is a term', async () => {
      const { result } = renderHookWithClient(() =>
        useDocumentSearch('coindcx'),
      );

      await waitFor(() => {
        expect(result.current.data).toHaveLength(1);
      });
    });

    it('useFinancialYearReport asks nothing without a range', () => {
      const { result } = renderHookWithClient(() =>
        useFinancialYearReport(null),
      );

      expect(result.current.fetchStatus).toBe('idle');
    });
  });

  describe('the defaults', () => {
    it('holds data fresh for 30 seconds', async () => {
      const { result, client } = renderHookWithClient(() => usePayouts());

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(client.getDefaultOptions().queries?.staleTime).toBe(STALE_TIME_MS);
      expect(STALE_TIME_MS).toBe(30_000);
      // And behaviourally: freshly fetched data is not stale.
      expect(result.current.isStale).toBe(false);
    });

    it('does not refetch when the window regains focus', async () => {
      // Local data, not a live feed. Alt-tabbing back should not put a
      // spinner in front of somebody.
      const { result, client } = renderHookWithClient(() => usePayouts());

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(
        false,
      );
      expect(client.getDefaultOptions().queries?.refetchOnReconnect).toBe(
        false,
      );
    });

    it('does not retry a 4xx, which will answer the same way twice', async () => {
      // A 403 rather than a 401 on purpose: a 401 clears the whole cache (see
      // queryClient.test), so the query never settles into an error state and
      // there would be nothing left to count retries on.
      server.use(passwordChangeRequired('/api/payouts'));
      const queried = vi.fn();
      server.events.on('request:start', queried);

      const { result } = renderHookWithClient(() => usePayouts());

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      const payoutCalls = queried.mock.calls.filter(([event]) =>
        String((event as { request: Request }).request.url).includes(
          '/api/payouts',
        ),
      );
      expect(payoutCalls).toHaveLength(1);

      server.events.removeListener('request:start', queried);
    });

    it('retries a network failure once, then gives up', async () => {
      server.use(unreachable('/api/payouts'));
      const queried = vi.fn();
      server.events.on('request:start', queried);

      const { result } = renderHookWithClient(() => usePayouts());

      await waitFor(
        () => {
          expect(result.current.isError).toBe(true);
        },
        { timeout: 5000 },
      );

      const payoutCalls = queried.mock.calls.filter(([event]) =>
        String((event as { request: Request }).request.url).includes(
          '/api/payouts',
        ),
      );
      // The attempt plus exactly one retry.
      expect(payoutCalls).toHaveLength(2);

      server.events.removeListener('request:start', queried);
    });
  });

  it('caches under the key the factory produced, never an inline one', async () => {
    const { result, client } = renderHookWithClient(() => useSettlement(1));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // If a hook wrote its own array, this lookup would miss and a mutation
    // invalidating the factory key would never reach it.
    expect(client.getQueryData(queryKeys.payouts.settlement(1))).toEqual(
      SETTLEMENT,
    );
  });
});
