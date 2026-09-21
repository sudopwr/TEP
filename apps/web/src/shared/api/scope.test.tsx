import { describe, expect, it } from 'vitest';

import { OTHER_PAYOUT, PAYOUT } from '../../../test/msw/fixtures';
import { act, renderHookWithClient, waitFor } from '../../../test/renderHook';

import {
  useAccountBalances,
  useDataQuality,
  useFinancialYearReport,
  usePayoutYears,
  usePayouts,
  useTraders,
} from './hooks/queries';
import { queryKeys } from './keys';
import { periodRange, useScope } from './ScopeProvider';

/**
 * F24 — whose money, and when, honoured by every screen that shows money.
 *
 * The MSW handlers behind these filter for real: `/api/payouts` answers from
 * two people's payouts in two months, and the balances and checks answer
 * empty for anybody but §10's trader. So a hook that folded the scope into
 * its cache key but forgot to send it fails here rather than looking right.
 */

const JUNE = { traderId: null, year: 2025, month: 6 };

describe('the scope', () => {
  it('opens on everything', () => {
    const { result } = renderHookWithClient(() => useScope());

    expect(result.current.traderId).toBeNull();
    expect(result.current.year).toBeNull();
    expect(result.current.month).toBeNull();
    expect(result.current.filter).toEqual({});
    expect(result.current.isNarrowed).toBe(false);
  });

  it('turns a year and a month into an inclusive range', () => {
    expect(periodRange(2025, null)).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
    expect(periodRange(2025, 6)).toEqual({
      from: '2025-06-01',
      to: '2025-06-30',
    });
    expect(periodRange(null, 6)).toBeNull();
  });

  it('gets February right, leap year included', () => {
    // The month lengths are not a table here; they come from the calendar.
    expect(periodRange(2025, 2)?.to).toBe('2025-02-28');
    expect(periodRange(2024, 2)?.to).toBe('2024-02-29');
  });

  it('drops the month when the year is cleared', () => {
    // "March of no year" is not a period, and leaving it set would put a
    // month in the dropdown that describes nothing.
    const { result } = renderHookWithClient(() => useScope(), { scope: JUNE });

    act(() => {
      result.current.setYear(null);
    });

    expect(result.current.month).toBeNull();
    expect(result.current.filter).toEqual({});
  });

  it('keeps the trader when the period changes, and the other way round', () => {
    const { result } = renderHookWithClient(() => useScope(), {
      scope: { traderId: 2, year: 2025, month: null },
    });

    act(() => {
      result.current.setMonth(6);
    });

    expect(result.current.filter).toEqual({
      traderId: 2,
      from: '2025-06-01',
      to: '2025-06-30',
    });
  });
});

describe('the scoped reads', () => {
  it('lists one trader’s payouts, not everybody’s', async () => {
    const { result } = renderHookWithClient(() => usePayouts(), {
      scope: { traderId: OTHER_PAYOUT.traderId, year: null, month: null },
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([OTHER_PAYOUT]);
    });
  });

  it('narrows to a month', async () => {
    const { result } = renderHookWithClient(() => usePayouts(), {
      scope: JUNE,
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([OTHER_PAYOUT]);
    });
  });

  it('caches each selection separately', async () => {
    const scope = { traderId: 2, from: '2025-06-01', to: '2025-06-30' };
    const { result, client } = renderHookWithClient(() => usePayouts(), {
      scope: { traderId: 2, year: 2025, month: 6 },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(client.getQueryData(queryKeys.payouts.list(scope))).toBeDefined();
    // Another selection is another question, and must not read this answer.
    expect(client.getQueryData(queryKeys.payouts.list())).toBeUndefined();
  });

  it('scopes the balances, so one person’s money is not shown under another', async () => {
    const { result } = renderHookWithClient(() => useAccountBalances(), {
      scope: { traderId: OTHER_PAYOUT.traderId, year: null, month: null },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // §10's ₹84,642.93 belongs to the other trader entirely.
    expect(result.current.data).toEqual([]);
  });

  it('shows the balances again for the trader they belong to', async () => {
    const { result } = renderHookWithClient(() => useAccountBalances(), {
      scope: { traderId: PAYOUT.traderId, year: null, month: null },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.length).toBeGreaterThan(0);
  });

  it('scopes the checks', async () => {
    const { result } = renderHookWithClient(() => useDataQuality(), {
      scope: { traderId: OTHER_PAYOUT.traderId, year: null, month: null },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it('carries the trader into the financial-year report, but not the period', async () => {
    // The report's range is its own required argument: a month chosen in the
    // bar must not silently re-cut a year somebody asked for.
    const { result, client } = renderHookWithClient(
      () => useFinancialYearReport({ from: '2024-04-01', to: '2025-03-31' }),
      { scope: { traderId: 2, year: 2025, month: 6 } },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(
      client.getQueryData(
        queryKeys.reports.financialYear({
          from: '2024-04-01',
          to: '2025-03-31',
          traderId: 2,
        }),
      ),
    ).toBeDefined();
  });

  it('offers the years there is something to show, newest first', async () => {
    const { result } = renderHookWithClient(() => usePayoutYears(), {
      // Narrowed to a month, and still offering both years: a year list built
      // from the scoped list could only ever offer the year already chosen.
      scope: JUNE,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([2025]);
  });

  it('leaves the trader list unscoped — it is the scope', async () => {
    const { result } = renderHookWithClient(() => useTraders(), {
      scope: { traderId: 2, year: 2025, month: 6 },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.map((trader) => trader.name)).toEqual([
      'Me',
      'Priya',
    ]);
  });
});
