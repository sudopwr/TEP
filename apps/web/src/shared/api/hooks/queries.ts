import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  fetchAccounts,
  fetchBalances,
  fetchCompanies,
  fetchDataQuality,
  fetchFinancialYear,
  fetchPayoutDocuments,
  fetchPayoutTrail,
  fetchPayouts,
  fetchSettlement,
  fetchTraders,
  fetchTransactions,
  searchDocuments,
} from '../endpoints';
import { queryKeys } from '../keys';
import { useScope } from '../ScopeProvider';
import type {
  AccountBalanceJson,
  AccountJson,
  CompanyJson,
  DataQualityIssueJson,
  DocumentJson,
  FinancialYearFilter,
  FinancialYearReportJson,
  PayoutFilter,
  PayoutJson,
  PayoutTrailJson,
  SettlementJson,
  TraderJson,
  TransactionJson,
} from '../types';

/**
 * One hook per endpoint, each returning the typed thing the caller wants.
 *
 * The envelopes the API sends (`{ payouts: [...] }`) are unwrapped here with
 * `select`, so a component receives `PayoutJson[]` and never writes
 * `data?.payouts ?? []`. `select` runs after caching, so the envelope stays in
 * the cache — which is what lets a mutation write to the cache in the same
 * shape the server would have sent.
 *
 * Every key comes from `queryKeys`. None is written inline.
 *
 * The four scoped reads (F24) take the selection from `useScope` rather than
 * from an argument, and fold it into both the key and the request. A screen
 * cannot forget it, and two screens showing the same selection share one
 * cache entry. `useTraders`, `useCompanies` and `useAccounts` are deliberately
 * *not* scoped: a company is a company whoever traded with it, and a scoped
 * account list would empty the destination dropdown of a form.
 */

export function useCompanies(): UseQueryResult<readonly CompanyJson[]> {
  return useQuery({
    queryKey: queryKeys.companies.list(),
    queryFn: ({ signal }) => fetchCompanies(signal),
    select: (data) => data.companies,
  });
}

/** F24 — who the ledger keeps payouts for. Never scoped: it *is* the scope. */
export function useTraders(): UseQueryResult<readonly TraderJson[]> {
  return useQuery({
    queryKey: queryKeys.traders.list(),
    queryFn: ({ signal }) => fetchTraders(signal),
    select: (data) => data.traders,
  });
}

/**
 * F1 — every account, including ones no money has moved through.
 *
 * Not `useAccountBalances`. That one is derived from movements (UC7), so an
 * account recorded a minute ago is absent from it — which is right for a
 * balance sheet and useless for a form that has to offer it as a destination.
 */
export function useAccounts(
  type?: string,
): UseQueryResult<readonly AccountJson[]> {
  return useQuery({
    queryKey: queryKeys.accounts.list(type),
    queryFn: ({ signal }) => fetchAccounts(type, signal),
    select: (data) => data.accounts,
  });
}

/**
 * F2's list, narrowed by the shared selection (F24).
 *
 * The caller's filter is this screen's own — the company — and the scope is
 * everybody's. The two are merged here, with the scope last: a screen cannot
 * hand-wave past the selection by passing a `traderId` of its own.
 */
export function usePayouts(
  filter: PayoutFilter = {},
): UseQueryResult<readonly PayoutJson[]> {
  const { filter: scope } = useScope();
  const scoped: PayoutFilter = { ...filter, ...scope };

  return useQuery({
    queryKey: queryKeys.payouts.list(scoped),
    queryFn: ({ signal }) => fetchPayouts(scoped, signal),
    select: (data) => data.payouts,
  });
}

/**
 * The years there is anything to show, newest first (F24).
 *
 * Deliberately reads the *unscoped* list: the year dropdown must offer 2024
 * while 2025 is selected, and a list narrowed to 2025 could only ever offer
 * 2025. When nothing is narrowed this is the very entry `usePayouts` already
 * holds, so the common case costs no second request.
 */
export function usePayoutYears(): UseQueryResult<readonly number[]> {
  return useQuery({
    queryKey: queryKeys.payouts.list({}),
    queryFn: ({ signal }) => fetchPayouts({}, signal),
    select: (data) =>
      [
        ...new Set(data.payouts.map((payout) => payout.payoutDate.slice(0, 4))),
      ]
        .map(Number)
        .sort((first, second) => second - first),
  });
}

/**
 * F6 — what is attached to the payout as a whole.
 *
 * Not the legs' documents: those arrive on their own nodes with the trail
 * (UC5), and asking for them twice would be two answers to one question. This
 * is the contract, or the platform's own statement for the award — the file
 * that belongs to none of the movements.
 */
export function usePayoutDocuments(
  payoutId: number,
): UseQueryResult<readonly DocumentJson[]> {
  return useQuery({
    queryKey: queryKeys.documents.forPayout(payoutId),
    queryFn: ({ signal }) => fetchPayoutDocuments(payoutId, signal),
    select: (data) => data.documents,
  });
}

/** F8 — the money trail as a tree. */
export function usePayoutTrail(
  payoutId: number | null,
): UseQueryResult<PayoutTrailJson> {
  return useQuery({
    // `payoutId ?? -1` would be a real key for an unreal payout, and the
    // cache would hold an entry nobody can ever invalidate. Disabled instead.
    queryKey: queryKeys.payouts.trail(payoutId ?? 0),
    queryFn: ({ signal }) => fetchPayoutTrail(payoutId as number, signal),
    enabled: payoutId !== null,
  });
}

/** F9 — gross proceeds, fees by type, net credited. Status is derived here. */
export function useSettlement(
  payoutId: number | null,
  currencyCode?: string,
): UseQueryResult<SettlementJson> {
  return useQuery({
    queryKey: queryKeys.payouts.settlement(payoutId ?? 0, currencyCode),
    queryFn: ({ signal }) =>
      fetchSettlement(payoutId as number, currencyCode, signal),
    enabled: payoutId !== null,
  });
}

export function useTransactions(
  payoutId?: number,
): UseQueryResult<readonly TransactionJson[]> {
  return useQuery({
    queryKey: queryKeys.transactions.list(payoutId),
    queryFn: ({ signal }) => fetchTransactions(payoutId, signal),
    select: (data) => data.transactions,
  });
}

/** F10 — balance per account per currency, including crypto dust. */
export function useAccountBalances(
  payoutId?: number,
): UseQueryResult<readonly AccountBalanceJson[]> {
  const { filter: scope } = useScope();

  return useQuery({
    queryKey: queryKeys.balances.list(payoutId, scope),
    queryFn: ({ signal }) => fetchBalances(payoutId, scope, signal),
    select: (data) => data.balances,
  });
}

/** F11 — the flagged rows. */
export function useDataQuality(
  payoutId?: number,
  tolerancePct?: number,
): UseQueryResult<readonly DataQualityIssueJson[]> {
  const { filter: scope } = useScope();

  return useQuery({
    queryKey: queryKeys.dataQuality.list(payoutId, tolerancePct, scope),
    queryFn: ({ signal }) =>
      fetchDataQuality(payoutId, tolerancePct, scope, signal),
    select: (data) => data.issues,
  });
}

/** F7 — FTS5 over filenames and extracted text. */
export function useDocumentSearch(
  query: string,
): UseQueryResult<readonly DocumentJson[]> {
  const trimmed = query.trim();

  return useQuery({
    queryKey: queryKeys.documents.search(trimmed),
    queryFn: ({ signal }) => searchDocuments(trimmed, signal),
    select: (data) => data.documents,
    // The API answers 400 to an empty query, and rightly — but a search box
    // is empty before anyone types, and that is not an error to render.
    enabled: trimmed.length > 0,
  });
}

/**
 * F13 — the financial-year report.
 *
 * Only the trader half of the scope applies: the range is this report's own
 * required argument, and a year chosen in the bar at the top must not
 * silently re-cut a report the reader asked for a financial year of.
 */
export function useFinancialYearReport(
  filter: FinancialYearFilter | null,
): UseQueryResult<FinancialYearReportJson> {
  const { traderId } = useScope();
  const scoped =
    filter === null
      ? null
      : { ...filter, ...(traderId === null ? {} : { traderId }) };

  return useQuery({
    queryKey: queryKeys.reports.financialYear(scoped ?? { from: '', to: '' }),
    queryFn: ({ signal }) =>
      fetchFinancialYear(scoped as FinancialYearFilter, signal),
    enabled: scoped !== null,
  });
}
