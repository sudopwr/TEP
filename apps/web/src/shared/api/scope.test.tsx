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
import { describePeriod, periodRange, useScope } from './ScopeProvider';

/**
 * F24 — whose money, and when, honoured by every screen that shows money.
 *
 * The MSW handlers behind these filter for real: `/api/payouts` answers from
 * two people's payouts in two months, and the balances and checks answer
 * empty for anybody but §10's trader. So a hook that folded the scope into
 * its cache key but forgot to send it fails here rather than looking right.
 */

const JUNE = {
  traderId: null,
  from: { year: 2025, month: 6 },
  to: { year: 2025, month: 6 },
};

/** The Indian financial year §13's report is cut by: 1 April to 31 March. */
const FINANCIAL_YEAR = {
  traderId: null,
  from: { year: 2024, month: 4 },
  to: { year: 2025, month: 3 },
};

describe('the scope', () => {
  it('opens on everything', () => {
    const { result } = renderHookWithClient(() => useScope());

    expect(result.current.traderId).toBeNull();
    expect(result.current.from).toBeNull();
    expect(result.current.to).toBeNull();
    expect(result.current.filter).toEqual({});
    expect(result.current.isNarrowed).toBe(false);
  });

  it('turns two months into one inclusive range', () => {
    expect(
      periodRange({ year: 2025, month: 6 }, { year: 2025, month: 6 }),
    ).toEqual({ from: '2025-06-01', to: '2025-06-30' });

    expect(periodRange({ year: 2025, month: 1 }, null)).toBeNull();
    expect(periodRange(null, { year: 2025, month: 1 })).toBeNull();
  });

  it('spans the tax year, which does not start in January', () => {
    // The whole reason the period is two ends: 1 April 2024 to 31 March 2025
    // is one financial year and two calendar ones.
    expect(
      periodRange({ year: 2024, month: 4 }, { year: 2025, month: 3 }),
    ).toEqual({ from: '2024-04-01', to: '2025-03-31' });
  });

  it('gets February right, leap year included', () => {
    // The month lengths are not a table here; they come from the calendar.
    expect(
      periodRange({ year: 2025, month: 2 }, { year: 2025, month: 2 })?.to,
    ).toBe('2025-02-28');
    expect(
      periodRange({ year: 2024, month: 2 }, { year: 2024, month: 2 })?.to,
    ).toBe('2024-02-29');
  });

  it('reads a period back as a sentence', () => {
    expect(describePeriod(null, null)).toBe('All time');
    expect(
      describePeriod({ year: 2025, month: 6 }, { year: 2025, month: 6 }),
    ).toBe('June 2025');
    expect(
      describePeriod({ year: 2024, month: 4 }, { year: 2025, month: 3 }),
    ).toBe('April 2024 – March 2025');
  });

  it('carries the other end along when one is set for the first time', () => {
    // A start with no end is not a period the server can be asked for, and
    // an empty second select beside a filled first one reads as broken.
    const { result } = renderHookWithClient(() => useScope());

    act(() => {
      result.current.setFrom({ year: 2024, month: 4 });
    });

    expect(result.current.to).toEqual({ year: 2024, month: 4 });
    expect(result.current.filter).toEqual({
      from: '2024-04-01',
      to: '2024-04-30',
    });
  });

  it('opens the range out when the second end is moved', () => {
    const { result } = renderHookWithClient(() => useScope());

    act(() => {
      result.current.setFrom({ year: 2024, month: 4 });
    });
    act(() => {
      result.current.setTo({ year: 2025, month: 3 });
    });

    expect(result.current.filter).toEqual({
      from: '2024-04-01',
      to: '2025-03-31',
    });
  });

  it('corrects an end that falls before its start, rather than refusing it', () => {
    const { result } = renderHookWithClient(() => useScope(), {
      scope: FINANCIAL_YEAR,
    });

    act(() => {
      result.current.setTo({ year: 2023, month: 5 });
    });

    expect(result.current.from).toEqual({ year: 2023, month: 5 });
    expect(result.current.to).toEqual({ year: 2023, month: 5 });
  });

  it('clears both ends together, since half a range is not a period', () => {
    const { result } = renderHookWithClient(() => useScope(), { scope: JUNE });

    act(() => {
      result.current.setFrom(null);
    });

    expect(result.current.from).toBeNull();
    expect(result.current.to).toBeNull();
    expect(result.current.filter).toEqual({});
  });

  it('keeps the trader when the period changes, and the other way round', () => {
    const { result } = renderHookWithClient(() => useScope(), {
      scope: { ...FINANCIAL_YEAR, traderId: 2 },
    });

    act(() => {
      result.current.setTo({ year: 2025, month: 6 });
    });

    expect(result.current.filter).toEqual({
      traderId: 2,
      from: '2024-04-01',
      to: '2025-06-30',
    });
  });
});

describe('the scoped reads', () => {
  it('lists one trader’s payouts, not everybody’s', async () => {
    const { result } = renderHookWithClient(() => usePayouts(), {
      scope: { traderId: OTHER_PAYOUT.traderId, from: null, to: null },
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

  it('narrows to a financial year, taking in both calendar years', async () => {
    // §10's tree is dated March 2025 — inside FY 2024-25 — while Priya's
    // June 2025 award is in the year after it.
    const { result } = renderHookWithClient(() => usePayouts(), {
      scope: FINANCIAL_YEAR,
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([PAYOUT]);
    });
  });

  it('caches each selection separately', async () => {
    const scope = { traderId: 2, from: '2025-06-01', to: '2025-06-30' };
    const { result, client } = renderHookWithClient(() => usePayouts(), {
      scope: { ...JUNE, traderId: 2 },
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
      scope: { traderId: OTHER_PAYOUT.traderId, from: null, to: null },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // §10's ₹84,642.93 belongs to the other trader entirely.
    expect(result.current.data).toEqual([]);
  });

  it('shows the balances again for the trader they belong to', async () => {
    const { result } = renderHookWithClient(() => useAccountBalances(), {
      scope: { traderId: PAYOUT.traderId, from: null, to: null },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.length).toBeGreaterThan(0);
  });

  it('scopes the checks', async () => {
    const { result } = renderHookWithClient(() => useDataQuality(), {
      scope: { traderId: OTHER_PAYOUT.traderId, from: null, to: null },
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it('carries the trader into the financial-year report, but not the period', async () => {
    // The report's range is its own required argument: a period chosen in
    // the bar must not silently re-cut a year somebody asked for.
    const { result, client } = renderHookWithClient(
      () => useFinancialYearReport({ from: '2024-04-01', to: '2025-03-31' }),
      { scope: { ...JUNE, traderId: 2 } },
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
      // Narrowed to a month, and still offering every year: a year list built
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
      scope: { ...JUNE, traderId: 2 },
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
