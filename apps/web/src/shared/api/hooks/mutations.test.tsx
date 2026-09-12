import type { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { SETTLEMENT } from '../../../../test/msw/fixtures';
import { postFails } from '../../../../test/msw/handlers';
import { server } from '../../../../test/msw/server';
import { renderHookWithClient, waitFor } from '../../../../test/renderHook';
import { createQueryClient } from '../queryClient';
import { queryKeys } from '../keys';
import type { CreateSaleCommand, SettlementJson } from '../types';

import {
  useAttachDocument,
  useRecordCompany,
  useRecordPayout,
  useRecordTransaction,
  useSettlePayout,
} from './mutations';

/**
 * Which caches each write disturbs, and — more importantly — which it leaves
 * alone.
 *
 * Every assertion below is made against a real `QueryClient` after a real
 * mutation ran against MSW. Nothing spies on `invalidateQueries`: a spy would
 * confirm that a function was called with an array, where what matters is
 * whether the *cache entry a component is reading* was actually marked stale.
 */

/** Seed a cache entry and record whether invalidation reached it. */
function seed(client: QueryClient, key: readonly unknown[], value: unknown) {
  client.setQueryData(key, value);
}

const isStale = (client: QueryClient, key: readonly unknown[]): boolean =>
  client.getQueryCache().find({ queryKey: key })?.isStale() ?? false;

const SALE: CreateSaleCommand = {
  kind: 'sale',
  code: 'Transaction003',
  payoutId: 1,
  txnDate: '2025-03-12',
  fromAccountId: 4,
  toAccountId: 5,
  fromAmount: '45.00000000',
  fromCurrencyCode: 'USDT',
  rate: '98.30',
  settlementCurrencyCode: 'INR',
};

describe('useRecordTransaction', () => {
  /**
   * The list in the brief: a transaction invalidates that payout's trail and
   * settlement, the balances and the data-quality checks. Each is asserted
   * separately so a failure names the one that broke.
   */
  async function recordAgainstSeededCache(): Promise<QueryClient> {
    const client = createQueryClient();

    seed(client, queryKeys.payouts.trail(1), { payout: {}, roots: [] });
    seed(client, queryKeys.payouts.settlement(1), SETTLEMENT);
    seed(client, queryKeys.balances.list(), { balances: [] });
    seed(client, queryKeys.dataQuality.list(), { issues: [] });
    // Should survive untouched:
    seed(client, queryKeys.payouts.list(), { payouts: [] });
    seed(client, queryKeys.companies.list(), { companies: [] });
    seed(client, queryKeys.documents.search('x'), { documents: [] });
    seed(client, queryKeys.payouts.trail(2), { payout: {}, roots: [] });
    seed(client, queryKeys.payouts.settlement(2), SETTLEMENT);

    const { result } = renderHookWithClient(() => useRecordTransaction(), {
      client,
    });

    result.current.mutate({
      kind: 'transfer',
      code: 'T1',
      payoutId: 1,
      txnDate: '2025-03-16',
      fromAccountId: 3,
      toAccountId: 4,
      fromAmount: '1.00',
      fromCurrencyCode: 'USDT',
      toAmount: '1.00',
      toCurrencyCode: 'USDT',
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    return client;
  }

  it("invalidates that payout's trail", async () => {
    const client = await recordAgainstSeededCache();

    expect(isStale(client, queryKeys.payouts.trail(1))).toBe(true);
  });

  it("invalidates that payout's settlement", async () => {
    const client = await recordAgainstSeededCache();

    expect(isStale(client, queryKeys.payouts.settlement(1))).toBe(true);
  });

  it('invalidates the balances — money moved', async () => {
    const client = await recordAgainstSeededCache();

    expect(isStale(client, queryKeys.balances.list())).toBe(true);
  });

  it('invalidates the data-quality checks — a new row can be flagged', async () => {
    const client = await recordAgainstSeededCache();

    expect(isStale(client, queryKeys.dataQuality.list())).toBe(true);
  });

  it('leaves the payout LIST alone', async () => {
    // The list carries gross, charges and reference. A transaction touches
    // none of them, and status is derived and lives only in the settlement.
    const client = await recordAgainstSeededCache();

    expect(isStale(client, queryKeys.payouts.list())).toBe(false);
  });

  it('leaves companies, documents and other payouts alone', async () => {
    const client = await recordAgainstSeededCache();

    expect(isStale(client, queryKeys.companies.list())).toBe(false);
    expect(isStale(client, queryKeys.documents.search('x'))).toBe(false);
    expect(isStale(client, queryKeys.payouts.trail(2))).toBe(false);
    expect(isStale(client, queryKeys.payouts.settlement(2))).toBe(false);
  });
});

describe('useRecordPayout', () => {
  it('invalidates the payout lists and nothing about an existing payout', async () => {
    const client = createQueryClient();
    seed(client, queryKeys.payouts.list(), { payouts: [] });
    seed(client, queryKeys.payouts.trail(1), { payout: {}, roots: [] });
    seed(client, queryKeys.balances.list(), { balances: [] });

    const { result } = renderHookWithClient(() => useRecordPayout(), {
      client,
    });
    result.current.mutate({
      code: 'P2',
      companyId: 1,
      grossAmount: '10.00',
      currencyCode: 'USD',
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(isStale(client, queryKeys.payouts.list())).toBe(true);
    // A brand-new payout has not changed payout 1's tree, nor any balance.
    expect(isStale(client, queryKeys.payouts.trail(1))).toBe(false);
    expect(isStale(client, queryKeys.balances.list())).toBe(false);
  });
});

describe('useRecordCompany', () => {
  it('invalidates the company list and nothing else', async () => {
    const client = createQueryClient();
    seed(client, queryKeys.companies.list(), { companies: [] });
    seed(client, queryKeys.payouts.list(), { payouts: [] });

    const { result } = renderHookWithClient(() => useRecordCompany(), {
      client,
    });
    result.current.mutate({ code: 'C', name: 'C' });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(isStale(client, queryKeys.companies.list())).toBe(true);
    expect(isStale(client, queryKeys.payouts.list())).toBe(false);
  });
});

describe('useAttachDocument', () => {
  it('invalidates the trail and the searches, not the money', async () => {
    // A document moves nothing, so no balance and no settlement changes.
    const client = createQueryClient();
    seed(client, queryKeys.payouts.trail(1), { payout: {}, roots: [] });
    seed(client, queryKeys.documents.search('march'), { documents: [] });
    seed(client, queryKeys.balances.list(), { balances: [] });
    seed(client, queryKeys.payouts.settlement(1), SETTLEMENT);

    const { result } = renderHookWithClient(() => useAttachDocument(), {
      client,
    });
    result.current.mutate({
      payoutId: 1,
      transactionId: 3,
      file: new File(['bytes'], 'march.pdf', { type: 'application/pdf' }),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(isStale(client, queryKeys.payouts.trail(1))).toBe(true);
    expect(isStale(client, queryKeys.documents.search('march'))).toBe(true);
    expect(isStale(client, queryKeys.balances.list())).toBe(false);
    expect(isStale(client, queryKeys.payouts.settlement(1))).toBe(false);
  });
});

describe('useSettlePayout — the optimistic one', () => {
  const settlementOf = (client: QueryClient): SettlementJson | undefined =>
    client.getQueryData<SettlementJson>(queryKeys.payouts.settlement(1));

  it('flips the cached status to settled before the server answers', async () => {
    const client = createQueryClient();
    seed(client, queryKeys.payouts.settlement(1), SETTLEMENT);
    expect(settlementOf(client)?.status).toBe('open');

    const { result } = renderHookWithClient(() => useSettlePayout(), {
      client,
    });
    result.current.mutate(SALE);

    // Before the POST resolves. This is the whole point of the hook: the one
    // consequence the browser can be sure of lands immediately.
    await waitFor(() => {
      expect(settlementOf(client)?.status).toBe('settled');
    });
  });

  it('leaves the amounts alone while it guesses the status', async () => {
    // The fee schedule lives on the server. Optimistically inventing an
    // exchange fee would be the version of this that lies.
    const client = createQueryClient();
    seed(client, queryKeys.payouts.settlement(1), SETTLEMENT);

    const { result } = renderHookWithClient(() => useSettlePayout(), {
      client,
    });
    result.current.mutate(SALE);

    await waitFor(() => {
      expect(settlementOf(client)?.status).toBe('settled');
    });

    expect(settlementOf(client)?.netCredited.amount).toBe('84642.93');
    expect(settlementOf(client)?.totalFees.amount).toBe('1384.63');
  });

  it('rolls back exactly when the server refuses', async () => {
    server.use(postFails('/api/transactions'));

    const client = createQueryClient();
    seed(client, queryKeys.payouts.settlement(1), SETTLEMENT);

    const { result } = renderHookWithClient(() => useSettlePayout(), {
      client,
    });
    result.current.mutate(SALE);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Not merely "open" — the snapshot, restored entry for entry.
    expect(settlementOf(client)).toEqual(SETTLEMENT);
  });

  it('writes through every currency variant of the same settlement', async () => {
    // A settlement fetched with no currency and one fetched as INR are two
    // cache entries of the same fact. Flipping one and not the other is how
    // two open tabs disagree.
    const client = createQueryClient();
    seed(client, queryKeys.payouts.settlement(1), SETTLEMENT);
    seed(client, queryKeys.payouts.settlement(1, 'INR'), SETTLEMENT);

    const { result } = renderHookWithClient(() => useSettlePayout(), {
      client,
    });
    result.current.mutate(SALE);

    await waitFor(() => {
      expect(
        client.getQueryData<SettlementJson>(
          queryKeys.payouts.settlement(1, 'INR'),
        )?.status,
      ).toBe('settled');
    });
  });

  it('does not touch another payout on the way', async () => {
    const client = createQueryClient();
    seed(client, queryKeys.payouts.settlement(1), SETTLEMENT);
    seed(client, queryKeys.payouts.settlement(2), SETTLEMENT);

    const { result } = renderHookWithClient(() => useSettlePayout(), {
      client,
    });
    result.current.mutate(SALE);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(
      client.getQueryData<SettlementJson>(queryKeys.payouts.settlement(2))
        ?.status,
    ).toBe('open');
  });

  it('invalidates on success, so the guess is replaced by the answer', async () => {
    const client = createQueryClient();
    seed(client, queryKeys.payouts.settlement(1), SETTLEMENT);
    seed(client, queryKeys.balances.list(), { balances: [] });

    const { result } = renderHookWithClient(() => useSettlePayout(), {
      client,
    });
    result.current.mutate(SALE);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(isStale(client, queryKeys.payouts.settlement(1))).toBe(true);
    expect(isStale(client, queryKeys.balances.list())).toBe(true);
  });

  it('invalidates on failure too — a rollback is still a guess to discard', async () => {
    server.use(postFails('/api/transactions'));

    const client = createQueryClient();
    seed(client, queryKeys.payouts.settlement(1), SETTLEMENT);

    const { result } = renderHookWithClient(() => useSettlePayout(), {
      client,
    });
    result.current.mutate(SALE);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(isStale(client, queryKeys.payouts.settlement(1))).toBe(true);
  });

  it('does nothing to a settlement that was never cached', async () => {
    // `setQueriesData` must not conjure an entry out of undefined: a
    // half-built settlement in the cache would render as a real one.
    const client = createQueryClient();

    const { result } = renderHookWithClient(() => useSettlePayout(), {
      client,
    });
    result.current.mutate(SALE);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(
      client.getQueryData(queryKeys.payouts.settlement(1)),
    ).toBeUndefined();
  });
});
