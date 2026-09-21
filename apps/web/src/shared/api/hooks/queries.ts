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
  fetchTransactions,
  searchDocuments,
} from '../endpoints';
import { queryKeys } from '../keys';
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
 */

export function useCompanies(): UseQueryResult<readonly CompanyJson[]> {
  return useQuery({
    queryKey: queryKeys.companies.list(),
    queryFn: ({ signal }) => fetchCompanies(signal),
    select: (data) => data.companies,
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

export function usePayouts(
  filter: PayoutFilter = {},
): UseQueryResult<readonly PayoutJson[]> {
  return useQuery({
    queryKey: queryKeys.payouts.list(filter),
    queryFn: ({ signal }) => fetchPayouts(filter, signal),
    select: (data) => data.payouts,
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
  return useQuery({
    queryKey: queryKeys.balances.list(payoutId),
    queryFn: ({ signal }) => fetchBalances(payoutId, signal),
    select: (data) => data.balances,
  });
}

/** F11 — the flagged rows. */
export function useDataQuality(
  payoutId?: number,
  tolerancePct?: number,
): UseQueryResult<readonly DataQualityIssueJson[]> {
  return useQuery({
    queryKey: queryKeys.dataQuality.list(payoutId, tolerancePct),
    queryFn: ({ signal }) => fetchDataQuality(payoutId, tolerancePct, signal),
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

/** F13 — the financial-year report. */
export function useFinancialYearReport(
  filter: FinancialYearFilter | null,
): UseQueryResult<FinancialYearReportJson> {
  return useQuery({
    queryKey: queryKeys.reports.financialYear(filter ?? { from: '', to: '' }),
    queryFn: ({ signal }) =>
      fetchFinancialYear(filter as FinancialYearFilter, signal),
    enabled: filter !== null,
  });
}
